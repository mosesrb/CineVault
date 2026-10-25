-- PREPARED ONLY. Apply after schema/admission/replacement in disposable tests.
-- Not a migration or deployment. No account creation, identity adoption or reset.
begin;
create table cinevault_private.cp_restores (
    instance_id uuid primary key references cinevault_private.cp_installations(instance_id) on delete cascade,
    request jsonb not null, binding_digest bytea not null check(octet_length(binding_digest)=32),
    owner_id uuid not null, session_id uuid not null, jwt_expires_at timestamptz not null,
    expires_at timestamptz not null, enabled boolean not null default true,
    previous_id uuid not null, previous_epoch bigint not null, result jsonb
);
alter table cinevault_private.cp_restores enable row level security;
revoke all on cinevault_private.cp_restores from public,anon,authenticated,service_role,cv_control_broker;
create function cinevault_private.cp_restore_request(p_request jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
    perform cinevault_private.cp_request(p_request-'recovery');
    if p_request->'recovery' is null or jsonb_typeof(p_request->'recovery')<>'object'
        or (select count(*) from jsonb_object_keys(p_request->'recovery'))<>1
        or jsonb_typeof(p_request->'recovery'->'cloudServerId') is distinct from 'string'
        or p_request->'recovery'->>'cloudServerId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
        raise exception 'cp_denied' using errcode='42501'; end if;
end;
$$;
create function cinevault_private.cp_restore_current(p_request jsonb,p_owner uuid)
returns cinevault_private.cp_credentials language plpgsql security definer set search_path='' as $$
declare c cinevault_private.cp_credentials; s public.servers;
begin
    select * into c from cinevault_private.cp_credentials where instance_id=(p_request->>'serverInstanceId')::uuid for update;
    if not found or c.epoch not between 1 and 9007199254740990 then raise exception 'cp_conflict' using errcode='P0001'; end if;
    select * into s from public.servers where id=c.server_id for update;
    if not found or s.owner_user_id is distinct from p_owner or s.server_instance_id is distinct from c.instance_id
        or s.id::text is distinct from p_request->'recovery'->>'cloudServerId' then
        raise exception 'cp_conflict' using errcode='P0001'; end if;
    return c;
end;
$$;
-- All flows serialize on installation first. Preserve the original initial/
-- replacement implementations, but hide core EXECUTE from the broker role.
alter function cinevault_private.cp_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea) rename to cp_initial_approve_core;
alter function cinevault_private.cp_replace_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea) rename to cp_replace_approve_core;
revoke all on function cinevault_private.cp_initial_approve_core(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_replace_approve_core(uuid,uuid,timestamptz,jsonb,bytea,bytea) from public,anon,authenticated,service_role,cv_control_broker;
create function cinevault_private.cp_restore_pending(p_instance uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
    if exists(select 1 from cinevault_private.cp_restores where instance_id=p_instance and enabled
        and expires_at>clock_timestamp() and result is null) then raise exception 'cp_conflict' using errcode='P0001'; end if;
end;
$$;
create function cinevault_private.cp_approve(p_user uuid,p_session uuid,p_expiry timestamptz,p_request jsonb,p_binding bytea,p_proof bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
    perform cinevault_private.cp_owner((p_request->>'serverInstanceId')::uuid,p_user,p_session,p_expiry);
    perform cinevault_private.cp_restore_pending((p_request->>'serverInstanceId')::uuid);
    return cinevault_private.cp_initial_approve_core(p_user,p_session,p_expiry,p_request,p_binding,p_proof);
end;
$$;
create function cinevault_private.cp_replace_approve(p_user uuid,p_session uuid,p_expiry timestamptz,p_request jsonb,p_binding bytea,p_proof bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
    perform cinevault_private.cp_owner((p_request->>'serverInstanceId')::uuid,p_user,p_session,p_expiry);
    perform cinevault_private.cp_restore_pending((p_request->>'serverInstanceId')::uuid);
    return cinevault_private.cp_replace_approve_core(p_user,p_session,p_expiry,p_request,p_binding,p_proof);
end;
$$;
create function cinevault_private.cp_restore_approve(p_user uuid,p_session uuid,p_expiry timestamptz,p_request jsonb,p_binding bytea,p_proof bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare instance uuid; c cinevault_private.cp_credentials; g cinevault_private.cp_restores; retry boolean:=false;
begin
    perform cinevault_private.cp_restore_request(p_request);instance:=(p_request->>'serverInstanceId')::uuid;
    perform cinevault_private.cp_owner(instance,p_user,p_session,p_expiry);
    if p_binding is null or octet_length(p_binding)<>32 or p_proof is null
        or encode(p_proof,'hex') is distinct from p_request->>'approvalDigest' then raise exception 'cp_denied' using errcode='42501'; end if;
    c:=cinevault_private.cp_restore_current(p_request,p_user);
    select * into g from cinevault_private.cp_restores where instance_id=instance for update;
    if found and g.request=p_request then
        retry:=true;
        -- Exact approval retry cannot silently refresh authority or reanchor epoch.
        if not g.enabled or g.owner_id<>p_user or g.session_id<>p_session or g.binding_digest<>p_binding
            or g.jwt_expires_at<=clock_timestamp() or g.expires_at<=clock_timestamp() then raise exception 'cp_denied' using errcode='42501'; end if;
        if g.result is null then
            if c.id<>g.previous_id or c.epoch<>g.previous_epoch then raise exception 'cp_conflict' using errcode='P0001'; end if;
        elsif c.id::text is distinct from p_request->>'credentialId' or c.epoch<>g.previous_epoch+1
            or c.revoked or c.expires_at<=clock_timestamp() or encode(c.secret_digest,'hex') is distinct from p_request->>'secretDigest' then
            raise exception 'cp_denied' using errcode='42501'; end if;
    else
        if c.id::text=p_request->>'credentialId' or c.epoch>9007199254740989 then raise exception 'cp_denied' using errcode='42501'; end if;
        if (g.enabled and g.expires_at>clock_timestamp() and g.result is null)
            or exists(select 1 from cinevault_private.cp_replacements where instance_id=instance and enabled and expires_at>clock_timestamp() and result is null)
            or exists(select 1 from cinevault_private.cp_pairings where instance_id=instance and enabled and expires_at>clock_timestamp()
                and request->>'credentialId' is distinct from c.id::text) then raise exception 'cp_conflict' using errcode='P0001'; end if;
        insert into cinevault_private.cp_restores(instance_id,request,binding_digest,owner_id,session_id,jwt_expires_at,expires_at,previous_id,previous_epoch)
            values(instance,p_request,p_binding,p_user,p_session,p_expiry,to_timestamp((p_request->>'expiresAt')::double precision/1000),c.id,c.epoch)
            on conflict(instance_id) do update set request=excluded.request,binding_digest=excluded.binding_digest,owner_id=excluded.owner_id,
                session_id=excluded.session_id,jwt_expires_at=excluded.jwt_expires_at,expires_at=excluded.expires_at,
                previous_id=excluded.previous_id,previous_epoch=excluded.previous_epoch,enabled=true,result=null;
    end if;
    perform cinevault_private.cp_owner(instance,p_user,p_session,p_expiry);perform cinevault_private.cp_restore_request(p_request);
    if retry then
        perform cinevault_private.cp_owner(instance,p_user,g.session_id,g.jwt_expires_at);
        if g.result is not null and c.expires_at<=clock_timestamp() then raise exception 'cp_denied' using errcode='42501'; end if;
    end if;
    return jsonb_build_object('approved',true,'pairId',p_request->>'pairId','expiresAt',(p_request->>'expiresAt')::bigint);
end;
$$;
create function cinevault_private.cp_restore(p_request jsonb,p_binding bytea,p_poll bytea,p_proof bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare instance uuid; owner uuid; c cinevault_private.cp_credentials; g cinevault_private.cp_restores; mapping jsonb;
begin
    perform cinevault_private.cp_restore_request(p_request);instance:=(p_request->>'serverInstanceId')::uuid;
    owner:=cinevault_private.cp_guard(instance);c:=cinevault_private.cp_restore_current(p_request,owner);
    select * into g from cinevault_private.cp_restores where instance_id=instance for update;
    if not found then return null; end if;
    if not g.enabled or g.request is distinct from p_request or g.owner_id is distinct from owner or g.binding_digest is distinct from p_binding
        or p_poll is null or p_proof is null or encode(p_poll,'hex') is distinct from p_request->>'pollDigest'
        or encode(p_proof,'hex') is distinct from p_request->>'approvalDigest' then raise exception 'cp_denied' using errcode='42501'; end if;
    perform cinevault_private.cp_owner(instance,owner,g.session_id,g.jwt_expires_at);
    if g.result is null then
        if c.id<>g.previous_id or c.epoch<>g.previous_epoch or c.id::text=p_request->>'credentialId' then raise exception 'cp_conflict' using errcode='P0001'; end if;
        delete from cinevault_private.cp_heartbeats where credential_id=c.id;
        update cinevault_private.cp_credentials set id=(p_request->>'credentialId')::uuid,secret_digest=decode(p_request->>'secretDigest','hex'),
            epoch=epoch+1,expires_at=clock_timestamp()+interval '30 days',revoked=false,sequence=0,last_received_at=null where id=c.id returning * into c;
        update cinevault_private.cp_pairings set enabled=false where instance_id=instance;
        update cinevault_private.cp_replacements set enabled=false where instance_id=instance;
        update public.servers set status='OFFLINE',updated_at=clock_timestamp() where id=c.server_id;
        update public.server_endpoints set status='OFFLINE',verified_at=null where server_id=c.server_id;
    elsif c.id::text is distinct from p_request->>'credentialId' or c.epoch<>g.previous_epoch+1 or c.revoked
        or c.expires_at<=clock_timestamp() or encode(c.secret_digest,'hex') is distinct from p_request->>'secretDigest' then
        raise exception 'cp_denied' using errcode='42501'; end if;
    mapping:=jsonb_build_object('projectRef','uouydbapluktfrylligo','serverInstanceId',instance,'credentialId',c.id,
        'cloudServerId',c.server_id,'epoch',c.epoch,'credentialExpiresAt',floor(extract(epoch from c.expires_at)*1000)::bigint);
    if g.result is not null and g.result is distinct from mapping then raise exception 'cp_conflict' using errcode='P0001'; end if;
    update cinevault_private.cp_restores set result=mapping where instance_id=instance;
    perform cinevault_private.cp_owner(instance,owner,g.session_id,g.jwt_expires_at);perform cinevault_private.cp_restore_request(p_request);
    if g.expires_at<=clock_timestamp() or c.expires_at<=clock_timestamp() then raise exception 'cp_denied' using errcode='42501'; end if;
    return mapping;
end;
$$;
-- Retain existing owner-guarded revocation and cancel this flow as well.
alter function cinevault_private.cp_revoke(uuid,uuid,uuid,timestamptz) rename to cp_revoke_core;
revoke all on function cinevault_private.cp_revoke_core(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role,cv_control_broker;
create function cinevault_private.cp_revoke(p_instance uuid,p_user uuid,p_session uuid,p_expiry timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
    perform cinevault_private.cp_revoke_core(p_instance,p_user,p_session,p_expiry);
    update cinevault_private.cp_restores set enabled=false where instance_id=p_instance;
    perform cinevault_private.cp_owner(p_instance,p_user,p_session,p_expiry);
end;
$$;
revoke all on function cinevault_private.cp_restore_request(jsonb),cinevault_private.cp_restore_current(jsonb,uuid),
    cinevault_private.cp_restore_pending(uuid),cinevault_private.cp_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_replace_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),cinevault_private.cp_restore_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_restore(jsonb,bytea,bytea,bytea),cinevault_private.cp_revoke(uuid,uuid,uuid,timestamptz)
    from public,anon,authenticated,service_role,cv_control_broker;
grant execute on function cinevault_private.cp_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),cinevault_private.cp_replace_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_restore_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),cinevault_private.cp_restore(jsonb,bytea,bytea,bytea),
    cinevault_private.cp_revoke(uuid,uuid,uuid,timestamptz) to cv_control_broker;
commit;
