-- PREPARED HOSTED BROKER SCHEMA, NOT A TRACKED MIGRATION OR DEPLOYMENT.
-- Generate a new migration with the Supabase CLI only after qualification/review.
-- Existing two migrations and ordinary-client policies stay unchanged.
begin;
create role cv_control_broker nologin;
grant usage on schema cinevault_private to cv_control_broker;
create table cinevault_private.cp_installations (
    instance_id uuid primary key,
    project_ref text not null check(project_ref='uouydbapluktfrylligo'),
    owner_id uuid not null references public.profiles(id) on delete cascade,
    enabled boolean not null default true
);
create index cp_installations_owner_idx on cinevault_private.cp_installations(owner_id);
create table cinevault_private.cp_pairings (
    instance_id uuid primary key references cinevault_private.cp_installations(instance_id) on delete cascade,
    pair_id uuid not null unique,
    request jsonb not null,
    binding_digest bytea not null check(octet_length(binding_digest)=32),
    owner_id uuid not null,
    session_id uuid not null,
    jwt_expires_at timestamptz not null,
    expires_at timestamptz not null,
    enabled boolean not null default true
);
create table cinevault_private.cp_credentials (
    id uuid primary key,
    instance_id uuid not null unique references cinevault_private.cp_installations(instance_id) on delete cascade,
    server_id uuid not null unique references public.servers(id) on delete cascade,
    secret_digest bytea not null check(octet_length(secret_digest)=32),
    epoch bigint not null check(epoch>0),
    expires_at timestamptz not null,
    revoked boolean not null default false,
    sequence bigint not null default 0 check(sequence between 0 and 9007199254740990),
    last_received_at timestamptz
);
create table cinevault_private.cp_heartbeats (
    credential_id uuid not null references cinevault_private.cp_credentials(id) on delete cascade,
    sequence bigint not null check(sequence between 1 and 9007199254740990),
    idempotency_key uuid not null,
    request jsonb not null,
    acknowledgment jsonb not null,
    primary key(credential_id,sequence), unique(credential_id,idempotency_key)
);
alter table cinevault_private.cp_installations enable row level security;
alter table cinevault_private.cp_pairings enable row level security;
alter table cinevault_private.cp_credentials enable row level security;
alter table cinevault_private.cp_heartbeats enable row level security;
revoke all on cinevault_private.cp_installations,cinevault_private.cp_pairings,
    cinevault_private.cp_credentials,cinevault_private.cp_heartbeats
    from public,anon,authenticated,service_role,cv_control_broker;

-- Private provisioning alone creates owner/install bindings. Never bootstrap from
-- user_metadata, body owner IDs, public instance UUIDs, or the operational secret.
-- Every mutation shares installation -> Auth user -> session/profile -> own rows.
create function cinevault_private.cp_guard(p_instance uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare i cinevault_private.cp_installations; u auth.users; p public.profiles;
begin
    select * into i from cinevault_private.cp_installations where instance_id=p_instance for update;
    if not found or not i.enabled then raise exception 'cp_denied' using errcode='42501'; end if;
    select * into u from auth.users where id=i.owner_id for share;
    if not found or u.is_anonymous is distinct from false or u.deleted_at is not null
        or u.banned_until>clock_timestamp() then raise exception 'cp_denied' using errcode='42501'; end if;
    select * into p from public.profiles where id=i.owner_id for share;
    if not found or p.blocked or p.must_change_password then raise exception 'cp_denied' using errcode='42501'; end if;
    return i.owner_id;
end;
$$;
create function cinevault_private.cp_owner(p_instance uuid,p_user uuid,p_session uuid,p_expiry timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare owner uuid; s auth.sessions;
begin
    owner:=cinevault_private.cp_guard(p_instance);
    if owner is distinct from p_user or p_expiry is null or p_expiry<=clock_timestamp() then
        raise exception 'cp_denied' using errcode='42501'; end if;
    select * into s from auth.sessions where id=p_session and user_id=p_user for share;
    if not found or s.not_after<=clock_timestamp() then raise exception 'cp_denied' using errcode='42501'; end if;
end;
$$;
create function cinevault_private.cp_request(p_request jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare field text; expires numeric;
begin
    if p_request is null or jsonb_typeof(p_request)<>'object' or
        (select count(*) from jsonb_object_keys(p_request))<>9 or
        p_request-array['projectRef','serverInstanceId','pairId','credentialId','secretDigest',
            'pollDigest','expiresAt','idempotencyKey','approvalDigest']<>'{}'::jsonb then
        raise exception 'cp_denied' using errcode='42501'; end if;
    foreach field in array array['projectRef','serverInstanceId','pairId','credentialId','secretDigest','pollDigest','idempotencyKey','approvalDigest'] loop
        if jsonb_typeof(p_request->field)<>'string' then raise exception 'cp_denied' using errcode='42501'; end if;
    end loop;
    if p_request->>'projectRef'<>'uouydbapluktfrylligo' then raise exception 'cp_denied' using errcode='42501'; end if;
    foreach field in array array['serverInstanceId','pairId','credentialId','idempotencyKey'] loop
        if p_request->>field !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
            raise exception 'cp_denied' using errcode='42501'; end if;
    end loop;
    foreach field in array array['secretDigest','pollDigest','approvalDigest'] loop
        if p_request->>field !~ '^[a-f0-9]{64}$' then raise exception 'cp_denied' using errcode='42501'; end if;
    end loop;
    if jsonb_typeof(p_request->'expiresAt')<>'number' then raise exception 'cp_denied' using errcode='42501'; end if;
    expires:=(p_request->>'expiresAt')::numeric;
    if expires<>floor(expires) or expires>9007199254740991 or
        expires<=extract(epoch from clock_timestamp())*1000 or
        expires>extract(epoch from clock_timestamp())*1000+300000 then
        raise exception 'cp_denied' using errcode='42501'; end if;
end;
$$;

-- p_user/session/expiry are trusted verified Auth outputs, never HTTP body fields.
create function cinevault_private.cp_approve(p_user uuid,p_session uuid,p_expiry timestamptz,
    p_request jsonb,p_binding bytea,p_proof bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare instance uuid; pair cinevault_private.cp_pairings;
begin
    perform cinevault_private.cp_request(p_request);
    instance:=(p_request->>'serverInstanceId')::uuid;
    perform cinevault_private.cp_owner(instance,p_user,p_session,p_expiry);
    if p_binding is null or octet_length(p_binding)<>32 or p_proof is null
        or encode(p_proof,'hex') is distinct from p_request->>'approvalDigest' then
        raise exception 'cp_denied' using errcode='42501'; end if;
    select * into pair from cinevault_private.cp_pairings where instance_id=instance for update;
    if found then
        if not pair.enabled or pair.request is distinct from p_request or pair.binding_digest is distinct from p_binding
            or pair.owner_id is distinct from p_user or pair.session_id is distinct from p_session then
            raise exception 'cp_conflict' using errcode='P0001'; end if;
        -- Exact approval retry cannot extend grant/session/credential lifetime.
        if pair.jwt_expires_at<=clock_timestamp() then raise exception 'cp_denied' using errcode='42501'; end if;
    else
        if exists(select 1 from cinevault_private.cp_credentials where instance_id=instance)
            or exists(select 1 from public.servers where server_instance_id=instance) then
            raise exception 'cp_conflict' using errcode='P0001'; end if;
        insert into cinevault_private.cp_pairings(instance_id,pair_id,request,binding_digest,
            owner_id,session_id,jwt_expires_at,expires_at)
        values(instance,(p_request->>'pairId')::uuid,p_request,p_binding,p_user,p_session,p_expiry,
            to_timestamp((p_request->>'expiresAt')::double precision/1000));
    end if;
    perform cinevault_private.cp_owner(instance,p_user,p_session,p_expiry);
    perform cinevault_private.cp_request(p_request);
    return jsonb_build_object('approved',true,'pairId',p_request->>'pairId','expiresAt',(p_request->>'expiresAt')::bigint);
end;
$$;
create function cinevault_private.cp_register(p_request jsonb,p_binding bytea,p_poll bytea,p_proof bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare instance uuid; pair cinevault_private.cp_pairings; c cinevault_private.cp_credentials;
    server public.servers; owner uuid;
begin
    perform cinevault_private.cp_request(p_request);
    instance:=(p_request->>'serverInstanceId')::uuid;
    owner:=cinevault_private.cp_guard(instance);
    select * into pair from cinevault_private.cp_pairings where instance_id=instance for update;
    if not found then return null; end if;
    if not pair.enabled or pair.request is distinct from p_request or pair.owner_id is distinct from owner
        or pair.binding_digest is distinct from p_binding or p_poll is null or
        encode(p_poll,'hex') is distinct from pair.request->>'pollDigest' or p_proof is null or
        encode(p_proof,'hex') is distinct from pair.request->>'approvalDigest' then
        raise exception 'cp_denied' using errcode='42501'; end if;
    perform cinevault_private.cp_owner(instance,pair.owner_id,pair.session_id,pair.jwt_expires_at);
    select * into c from cinevault_private.cp_credentials where instance_id=instance for update;
    if found then
        if c.id is distinct from (p_request->>'credentialId')::uuid or c.revoked or c.expires_at<=clock_timestamp()
            or encode(c.secret_digest,'hex') is distinct from p_request->>'secretDigest' then
            raise exception 'cp_denied' using errcode='42501'; end if;
        select * into server from public.servers where id=c.server_id for share;
        if not found or server.owner_user_id is distinct from owner or server.server_instance_id is distinct from instance then
            raise exception 'cp_conflict' using errcode='P0001'; end if;
    else
        if exists(select 1 from public.servers where server_instance_id=instance) then
            raise exception 'cp_conflict' using errcode='P0001'; end if;
        insert into public.servers(id,owner_user_id,server_instance_id,name,status)
            values(gen_random_uuid(),owner,instance,'CineVault','OFFLINE') returning * into server;
        insert into cinevault_private.cp_credentials(id,instance_id,server_id,secret_digest,epoch,expires_at)
            values((p_request->>'credentialId')::uuid,instance,server.id,decode(p_request->>'secretDigest','hex'),
                1,clock_timestamp()+interval '30 days') returning * into c;
    end if;
    perform cinevault_private.cp_owner(instance,pair.owner_id,pair.session_id,pair.jwt_expires_at);
    perform cinevault_private.cp_request(p_request);
    if pair.expires_at<=clock_timestamp() or c.expires_at<=clock_timestamp() then
        raise exception 'cp_denied' using errcode='42501'; end if;
    return jsonb_build_object('projectRef','uouydbapluktfrylligo','serverInstanceId',instance,
        'credentialId',c.id,'cloudServerId',c.server_id,'epoch',c.epoch,
        'credentialExpiresAt',floor(extract(epoch from c.expires_at)*1000)::bigint);
end;
$$;

-- Exactly one bounded verifier lookup before authentication; digest only.
create function cinevault_private.cp_verifier(p_credential uuid)
returns text language sql security definer set search_path='' as $$
    select encode(secret_digest,'hex') from cinevault_private.cp_credentials where id=p_credential;
$$;
create function cinevault_private.cp_heartbeat(p_credential uuid,p_secret bytea,p_body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare instance uuid; owner uuid; c cinevault_private.cp_credentials; server public.servers;
    prior cinevault_private.cp_heartbeats; seq bigint; key uuid; received timestamptz; ack jsonb; field text;
begin
    select instance_id into instance from cinevault_private.cp_credentials where id=p_credential;
    if not found then raise exception 'cp_denied' using errcode='42501'; end if;
    owner:=cinevault_private.cp_guard(instance);
    select * into c from cinevault_private.cp_credentials where id=p_credential for update;
    if not found or c.instance_id is distinct from instance or c.revoked or c.expires_at<=clock_timestamp()
        or p_secret is null or c.secret_digest is distinct from p_secret then
        raise exception 'cp_denied' using errcode='42501'; end if;
    foreach field in array array['operation','idempotencyKey','activity','projectRef','serverInstanceId','credentialId'] loop
        if p_body is null or jsonb_typeof(p_body->field) is distinct from 'string' then
            raise exception 'cp_denied' using errcode='42501'; end if;
    end loop;
    if p_body is null or jsonb_typeof(p_body)<>'object' or (select count(*) from jsonb_object_keys(p_body))<>8
        or p_body-array['operation','idempotencyKey','sequence','activity','projectRef','serverInstanceId','credentialId','epoch']<>'{}'::jsonb
        or p_body->>'operation'<>'heartbeat' or p_body->>'projectRef'<>'uouydbapluktfrylligo'
        or p_body->>'serverInstanceId' is distinct from instance::text or p_body->>'credentialId' is distinct from c.id::text
        or jsonb_typeof(p_body->'epoch')<>'number' or (p_body->>'epoch')::numeric<>c.epoch
        or jsonb_typeof(p_body->'sequence')<>'number'
        or p_body->>'activity' not in ('authenticated-request','media-work','startup','shutdown','admin-retry')
        or p_body->>'idempotencyKey' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
        raise exception 'cp_denied' using errcode='42501'; end if;
    if (p_body->>'sequence')::numeric<>floor((p_body->>'sequence')::numeric)
        or (p_body->>'sequence')::numeric not between 1 and 9007199254740990 then
        raise exception 'cp_denied' using errcode='42501'; end if;
    seq:=(p_body->>'sequence')::bigint; key:=(p_body->>'idempotencyKey')::uuid;
    select * into server from public.servers where id=c.server_id for update;
    if not found or server.server_instance_id is distinct from instance or server.owner_user_id is distinct from owner then
        raise exception 'cp_conflict' using errcode='P0001'; end if;
    select * into prior from cinevault_private.cp_heartbeats where credential_id=c.id and idempotency_key=key;
    if found then
        if seq<>c.sequence or prior.sequence<>seq or prior.request is distinct from p_body then
            raise exception 'cp_conflict' using errcode='P0001'; end if;
        ack:=prior.acknowledgment; -- exact retry never advances liveness timestamps
    else
        if seq<>c.sequence+1 then raise exception 'cp_conflict' using errcode='P0001'; end if;
        received:=clock_timestamp();
        if c.last_received_at is not null and received<c.last_received_at+interval '1 minute' then
            raise exception 'cp_rate_limited' using errcode='P0001'; end if;
        ack:=jsonb_build_object('idempotencyKey',key,'sequence',seq,'cloudServerId',c.server_id,
            'epoch',c.epoch,'receivedAt',received);
        insert into cinevault_private.cp_heartbeats values(c.id,seq,key,p_body,ack);
        update cinevault_private.cp_credentials set sequence=seq,last_received_at=received where id=c.id;
        -- Reporting activity is not TLS/endpoint verification. Never set ONLINE.
        update public.servers set last_heartbeat_at=received,updated_at=received where id=c.server_id;
    end if;
    perform cinevault_private.cp_guard(instance);
    if c.expires_at<=clock_timestamp() then raise exception 'cp_denied' using errcode='42501'; end if;
    return ack;
end;
$$;
create function cinevault_private.cp_revoke(p_instance uuid,p_user uuid,p_session uuid,p_expiry timestamptz)
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
    update cinevault_private.cp_credentials set revoked=true where instance_id=p_instance;
    update public.servers set status='OFFLINE' where id=c.server_id;
    update public.server_endpoints set status='OFFLINE',verified_at=null where server_id=c.server_id;
    perform cinevault_private.cp_owner(p_instance,p_user,p_session,p_expiry);
end;
$$;
revoke all on function cinevault_private.cp_guard(uuid),cinevault_private.cp_owner(uuid,uuid,uuid,timestamptz),
    cinevault_private.cp_request(jsonb),cinevault_private.cp_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_register(jsonb,bytea,bytea,bytea),cinevault_private.cp_verifier(uuid),
    cinevault_private.cp_heartbeat(uuid,bytea,jsonb),cinevault_private.cp_revoke(uuid,uuid,uuid,timestamptz)
    from public,anon,authenticated,service_role,cv_control_broker;
grant execute on function cinevault_private.cp_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_register(jsonb,bytea,bytea,bytea),cinevault_private.cp_verifier(uuid),
    cinevault_private.cp_heartbeat(uuid,bytea,jsonb),cinevault_private.cp_revoke(uuid,uuid,uuid,timestamptz)
    to cv_control_broker;
commit;
