-- PREPARED ONLY: apply after schema.sql + admission.sql in disposable tests.
-- Not a tracked migration/deployment. One retained grant per installation;
-- expired grants are replaced only by explicit fresh owner approval, no timer.
begin;
create table cinevault_private.cp_replacements (
    instance_id uuid primary key references cinevault_private.cp_installations(instance_id) on delete cascade,
    request jsonb not null, binding_digest bytea not null check(octet_length(binding_digest)=32),
    owner_id uuid not null, session_id uuid not null, jwt_expires_at timestamptz not null,
    expires_at timestamptz not null, enabled boolean not null default true,
    result jsonb
);
alter table cinevault_private.cp_replacements enable row level security;
revoke all on cinevault_private.cp_replacements from public,anon,authenticated,service_role,cv_control_broker;

create function cinevault_private.cp_replacement_request(p_request jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r jsonb; field text; epoch numeric;
begin
    perform cinevault_private.cp_request(p_request-'replacement');
    r:=p_request->'replacement';
    if r is null or jsonb_typeof(r)<>'object' or (select count(*) from jsonb_object_keys(r))<>3
        or r-array['credentialId','cloudServerId','epoch']<>'{}'::jsonb then
        raise exception 'cp_denied' using errcode='42501'; end if;
    foreach field in array array['credentialId','cloudServerId'] loop
        if jsonb_typeof(r->field) is distinct from 'string' or r->>field !~
            '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
            raise exception 'cp_denied' using errcode='42501'; end if;
    end loop;
    if jsonb_typeof(r->'epoch') is distinct from 'number' or r->>'credentialId'=p_request->>'credentialId' then
        raise exception 'cp_denied' using errcode='42501'; end if;
    epoch:=(r->>'epoch')::numeric;
    if epoch<>floor(epoch) or epoch not between 1 and 9007199254740989 then
        raise exception 'cp_denied' using errcode='42501'; end if;
end;
$$;
-- Installation lock is held by cp_owner/guard before this helper. Recovery may
-- replace an expired/revoked OLD credential, never revive a revoked candidate.
-- Candidate-already-current allows a new short grant after lost-reply expiry;
-- it preserves that candidate's epoch/lifetime rather than rotating twice.
create function cinevault_private.cp_replacement_current(p_request jsonb,p_owner uuid)
returns cinevault_private.cp_credentials language plpgsql security definer set search_path='' as $$
declare c cinevault_private.cp_credentials; s public.servers; r jsonb:=p_request->'replacement';
begin
    select * into c from cinevault_private.cp_credentials where instance_id=(p_request->>'serverInstanceId')::uuid for update;
    if not found then raise exception 'cp_conflict' using errcode='P0001'; end if;
    select * into s from public.servers where id=c.server_id for update;
    if not found or s.owner_user_id is distinct from p_owner or s.server_instance_id is distinct from c.instance_id
        or s.id::text is distinct from r->>'cloudServerId' then
        raise exception 'cp_conflict' using errcode='P0001'; end if;
    if c.id::text=r->>'credentialId' and c.epoch=(r->>'epoch')::bigint then return c; end if;
    if c.id::text=p_request->>'credentialId' and c.epoch=(r->>'epoch')::bigint+1
        and encode(c.secret_digest,'hex')=p_request->>'secretDigest' and not c.revoked and c.expires_at>clock_timestamp() then return c; end if;
    raise exception 'cp_conflict' using errcode='P0001';
end;
$$;
create function cinevault_private.cp_replace_approve(p_user uuid,p_session uuid,p_expiry timestamptz,
    p_request jsonb,p_binding bytea,p_proof bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare instance uuid; c cinevault_private.cp_credentials; grant_row cinevault_private.cp_replacements;
begin
    perform cinevault_private.cp_replacement_request(p_request);instance:=(p_request->>'serverInstanceId')::uuid;
    perform cinevault_private.cp_owner(instance,p_user,p_session,p_expiry);
    if p_binding is null or octet_length(p_binding)<>32 or p_proof is null
        or encode(p_proof,'hex') is distinct from p_request->>'approvalDigest' then
        raise exception 'cp_denied' using errcode='42501'; end if;
    c:=cinevault_private.cp_replacement_current(p_request,p_user);
    select * into grant_row from cinevault_private.cp_replacements where instance_id=instance for update;
    if found and grant_row.request is distinct from p_request and grant_row.enabled
        and grant_row.expires_at>clock_timestamp() and grant_row.result is null then
        raise exception 'cp_conflict' using errcode='P0001'; end if;
    -- Fresh owner approval may renew only the grant, never an issued lifetime.
    insert into cinevault_private.cp_replacements(instance_id,request,binding_digest,owner_id,session_id,jwt_expires_at,expires_at)
        values(instance,p_request,p_binding,p_user,p_session,p_expiry,to_timestamp((p_request->>'expiresAt')::double precision/1000))
        on conflict(instance_id) do update set request=excluded.request,binding_digest=excluded.binding_digest,
            owner_id=excluded.owner_id,session_id=excluded.session_id,jwt_expires_at=excluded.jwt_expires_at,
            expires_at=excluded.expires_at,enabled=true,
            result=case when cp_replacements.request=excluded.request then cp_replacements.result else null end;
    -- Retire old expired enrollment capability only during real authorized work.
    delete from cinevault_private.cp_pairings where instance_id=instance and expires_at<=clock_timestamp();
    perform cinevault_private.cp_owner(instance,p_user,p_session,p_expiry);
    perform cinevault_private.cp_replacement_request(p_request);
    return jsonb_build_object('approved',true,'pairId',p_request->>'pairId','expiresAt',(p_request->>'expiresAt')::bigint);
end;
$$;
create function cinevault_private.cp_replace(p_request jsonb,p_binding bytea,p_poll bytea,p_proof bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare instance uuid; owner uuid; c cinevault_private.cp_credentials; grant_row cinevault_private.cp_replacements; mapping jsonb;
begin
    perform cinevault_private.cp_replacement_request(p_request);instance:=(p_request->>'serverInstanceId')::uuid;
    owner:=cinevault_private.cp_guard(instance);
    c:=cinevault_private.cp_replacement_current(p_request,owner);
    select * into grant_row from cinevault_private.cp_replacements where instance_id=instance for update;
    if not found then return null; end if;
    if not grant_row.enabled or grant_row.request is distinct from p_request or grant_row.owner_id is distinct from owner
        or grant_row.binding_digest is distinct from p_binding or p_poll is null or p_proof is null
        or encode(p_poll,'hex') is distinct from p_request->>'pollDigest'
        or encode(p_proof,'hex') is distinct from p_request->>'approvalDigest' then
        raise exception 'cp_denied' using errcode='42501'; end if;
    perform cinevault_private.cp_owner(instance,owner,grant_row.session_id,grant_row.jwt_expires_at);
    if c.id::text=p_request->'replacement'->>'credentialId' then
        if grant_row.result is not null then raise exception 'cp_conflict' using errcode='P0001'; end if;
        -- Old operational proofs/receipts cannot follow the replacement ID.
        delete from cinevault_private.cp_heartbeats where credential_id=c.id;
        update cinevault_private.cp_credentials set id=(p_request->>'credentialId')::uuid,
            secret_digest=decode(p_request->>'secretDigest','hex'),epoch=epoch+1,
            expires_at=clock_timestamp()+interval '30 days',revoked=false,sequence=0,last_received_at=null
            where id=c.id returning * into c;
        update cinevault_private.cp_pairings set enabled=false where instance_id=instance;
        update public.servers set status='OFFLINE',updated_at=clock_timestamp() where id=c.server_id;
        update public.server_endpoints set status='OFFLINE',verified_at=null where server_id=c.server_id;
    end if;
    mapping:=jsonb_build_object('projectRef','uouydbapluktfrylligo','serverInstanceId',instance,
        'credentialId',c.id,'cloudServerId',c.server_id,'epoch',c.epoch,
        'credentialExpiresAt',floor(extract(epoch from c.expires_at)*1000)::bigint);
    if grant_row.result is not null and grant_row.result is distinct from mapping then
        raise exception 'cp_conflict' using errcode='P0001'; end if;
    update cinevault_private.cp_replacements set result=mapping where instance_id=instance;
    perform cinevault_private.cp_owner(instance,owner,grant_row.session_id,grant_row.jwt_expires_at);
    perform cinevault_private.cp_replacement_request(p_request);
    if grant_row.expires_at<=clock_timestamp() or c.expires_at<=clock_timestamp() then
        raise exception 'cp_denied' using errcode='42501'; end if;
    return mapping;
end;
$$;
-- Revocation also cancels any pending replacement receipt; old approvals cannot
-- silently undo explicit human revocation. A NEW fresh owner approval is required.
create or replace function cinevault_private.cp_revoke(p_instance uuid,p_user uuid,p_session uuid,p_expiry timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare c cinevault_private.cp_credentials; server public.servers;
begin
    perform cinevault_private.cp_owner(p_instance,p_user,p_session,p_expiry);
    perform 1 from cinevault_private.cp_pairings where instance_id=p_instance for update;
    select * into c from cinevault_private.cp_credentials where instance_id=p_instance for update;
    if found then
        select * into server from public.servers where id=c.server_id for update;
        if not found or server.server_instance_id is distinct from p_instance or server.owner_user_id is distinct from p_user then
            raise exception 'cp_conflict' using errcode='P0001'; end if;
    end if;
    update cinevault_private.cp_pairings set enabled=false where instance_id=p_instance;
    update cinevault_private.cp_replacements set enabled=false where instance_id=p_instance;
    update cinevault_private.cp_credentials set revoked=true where instance_id=p_instance;
    update public.servers set status='OFFLINE' where id=c.server_id;
    update public.server_endpoints set status='OFFLINE',verified_at=null where server_id=c.server_id;
    perform cinevault_private.cp_owner(p_instance,p_user,p_session,p_expiry);
end;
$$;
revoke all on function cinevault_private.cp_replacement_request(jsonb),
    cinevault_private.cp_replacement_current(jsonb,uuid),
    cinevault_private.cp_replace_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_replace(jsonb,bytea,bytea,bytea)
    from public,anon,authenticated,service_role,cv_control_broker;
grant execute on function cinevault_private.cp_replace_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_replace(jsonb,bytea,bytea,bytea) to cv_control_broker;
commit;
