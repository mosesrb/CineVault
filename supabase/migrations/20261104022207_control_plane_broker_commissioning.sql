-- REVIEWED SOURCE BUNDLE; hosted application requires separate exact approval.
-- CLI-created migration identity; one transaction for all five source sections.
-- No Auth account creation, password, LOGIN enablement, runtime or local cutover.
-- source: supabase/broker/schema.sql sha256:848822b902c475f94f3b192e20e4bfbb08544210553d5ec18fd1abce9395e1a9
-- source: supabase/broker/admission.sql sha256:d4276da7ea5a14ce50bab3fb4796a5c863177ac4ab69c474d22239023178d88b
-- source: supabase/broker/replacement.sql sha256:7043c5b0f1dca042040ef198214cc38e3a7804e43f01f86ed0fe8eaabf662c00
-- source: supabase/broker/restoration.sql sha256:e275cbbd5b358b4b06c8da9bb4cd5218a0076fa8fc0eb24429581be43909d02a
-- source: supabase/broker/provisioning.sql sha256:a6f382546fc1ec208bbfc598385baa72915351eab3ace9ea13528057d46b2d65
begin;

-- BEGIN SOURCE schema.sql
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
declare instance uuid; pair cinevault_private.cp_pairings; c cinevault_private.cp_credentials;
    server public.servers;
begin
    perform cinevault_private.cp_request(p_request);
    instance:=(p_request->>'serverInstanceId')::uuid;
    perform cinevault_private.cp_owner(instance,p_user,p_session,p_expiry);
    if p_binding is null or octet_length(p_binding)<>32 or p_proof is null
        or encode(p_proof,'hex') is distinct from p_request->>'approvalDigest' then
        raise exception 'cp_denied' using errcode='42501'; end if;
    select * into pair from cinevault_private.cp_pairings where instance_id=instance for update;
    if found then
        if not pair.enabled or pair.owner_id is distinct from p_user then
            raise exception 'cp_conflict' using errcode='P0001'; end if;
        if pair.request=p_request and pair.binding_digest=p_binding and pair.session_id=p_session then
            -- Exact retry cannot extend grant/session/credential lifetime.
            if pair.jwt_expires_at<=clock_timestamp() then raise exception 'cp_denied' using errcode='42501'; end if;
        else
            -- Explicit fresh owner approval may renew an expired initial grant,
            -- never overwrite a live grant or change its saved candidate keys.
            if pair.expires_at>clock_timestamp() or pair.request->>'pairId'=p_request->>'pairId'
                or pair.request->>'idempotencyKey'=p_request->>'idempotencyKey'
                or (pair.request-array['pairId','idempotencyKey','expiresAt','approvalDigest']) is distinct from
                   (p_request-array['pairId','idempotencyKey','expiresAt','approvalDigest']) then
                raise exception 'cp_conflict' using errcode='P0001'; end if;
            select * into c from cinevault_private.cp_credentials where instance_id=instance for update;
            if found then
                -- Lost reply: reconcile only the same still-valid initial issue.
                -- Never revive a revoked/expired/superseded operational credential.
                if c.id::text is distinct from p_request->>'credentialId' or c.epoch<>1 or c.revoked
                    or c.expires_at<=clock_timestamp() or encode(c.secret_digest,'hex') is distinct from p_request->>'secretDigest' then
                    raise exception 'cp_denied' using errcode='42501'; end if;
                select * into server from public.servers where id=c.server_id for share;
                if not found or server.owner_user_id is distinct from p_user or server.server_instance_id is distinct from instance then
                    raise exception 'cp_conflict' using errcode='P0001'; end if;
            elsif exists(select 1 from public.servers where server_instance_id=instance) then
                raise exception 'cp_conflict' using errcode='P0001'; end if;
            update cinevault_private.cp_pairings set pair_id=(p_request->>'pairId')::uuid,request=p_request,
                binding_digest=p_binding,session_id=p_session,jwt_expires_at=p_expiry,
                expires_at=to_timestamp((p_request->>'expiresAt')::double precision/1000) where instance_id=instance;
        end if;
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
    if c.id is not null and c.expires_at<=clock_timestamp() then raise exception 'cp_denied' using errcode='42501'; end if;
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
-- END SOURCE schema.sql

-- BEGIN SOURCE admission.sql
create table cinevault_private.cp_admission (
    id boolean primary key check(id),
    window_at timestamptz not null,
    used integer not null check(used between 0 and 120)
);
insert into cinevault_private.cp_admission values(true,'1970-01-01 UTC',0);
alter table cinevault_private.cp_admission enable row level security;
revoke all on cinevault_private.cp_admission from public,anon,authenticated,service_role,cv_control_broker;
alter table cinevault_private.cp_installations
    add admission_at timestamptz not null default '1970-01-01 UTC',
    add admission_counts jsonb not null default '{"approve":0,"register":0,"heartbeat":0}';

create function cinevault_private.cp_admit_request()
returns boolean language plpgsql security definer set search_path='' as $$
declare stamp timestamptz; gate cinevault_private.cp_admission;
begin
    select * into gate from cinevault_private.cp_admission where id=true for update;
    if not found then return false; end if;
    stamp:=clock_timestamp();
    if stamp<gate.window_at then return false; end if;
    if stamp>=gate.window_at+interval '1 minute' then
        update cinevault_private.cp_admission set window_at=stamp,used=1 where id=true;
    elsif gate.used<120 then
        update cinevault_private.cp_admission set used=used+1 where id=true;
    else return false;
    end if;
    return true;
end;
$$;
create function cinevault_private.cp_admit(p_operation text,p_identity uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare instance uuid; row cinevault_private.cp_installations; stamp timestamptz;
    counts jsonb; used integer; budget integer;
begin
    if p_identity is null or p_operation is null or p_operation not in ('approve','register','heartbeat') then return false; end if;
    if p_operation='heartbeat' then
        select instance_id into instance from cinevault_private.cp_credentials where id=p_identity;
        if not found then return false; end if;
    else instance:=p_identity; end if;
    select * into row from cinevault_private.cp_installations where instance_id=instance for update;
    if not found or not row.enabled then return false; end if;
    stamp:=clock_timestamp();if stamp<row.admission_at then return false; end if;
    counts:=case when stamp>=row.admission_at+interval '1 minute'
        then '{"approve":0,"register":0,"heartbeat":0}'::jsonb else row.admission_counts end;
    used:=(counts->>p_operation)::integer;
    budget:=case when p_operation='approve' then 4 else 10 end;
    if used is null or used<0 or used>=budget then return false; end if;
    update cinevault_private.cp_installations set
        admission_at=case when stamp>=row.admission_at+interval '1 minute' then stamp else row.admission_at end,
        admission_counts=jsonb_set(counts,array[p_operation],to_jsonb(used+1)) where instance_id=instance;
    return true;
end;
$$;
revoke all on function cinevault_private.cp_admit_request(),cinevault_private.cp_admit(text,uuid)
    from public,anon,authenticated,service_role,cv_control_broker;
grant execute on function cinevault_private.cp_admit_request(),cinevault_private.cp_admit(text,uuid) to cv_control_broker;
-- END SOURCE admission.sql

-- BEGIN SOURCE replacement.sql
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
-- END SOURCE replacement.sql

-- BEGIN SOURCE restoration.sql
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
-- END SOURCE restoration.sql

-- BEGIN SOURCE provisioning.sql

-- Deliberately unusable until separately approved hosted password/LOGIN setup.
-- No password literal/verifier belongs in migration history or on the local PC.
create role cv_control_broker_login nologin noinherit nosuperuser nocreatedb
    nocreaterole noreplication nobypassrls connection limit 4 password null;
grant connect on database postgres to cv_control_broker_login;
grant cv_control_broker to cv_control_broker_login
    with admin false, inherit false, set true;

-- Operator-only SECURITY INVOKER: no privilege elevation, no broker grant.
-- Inputs are independently confirmed Auth/installation UUIDs, never HTTP claims,
-- editable user metadata, email matching, or an operational credential.
create function cinevault_private.cp_provision_installation(
    p_project text,p_owner uuid,p_instance uuid,p_display_name text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare installation cinevault_private.cp_installations; account auth.users;
    profile public.profiles; server public.servers; credential cinevault_private.cp_credentials;
begin
    if p_project is distinct from 'uouydbapluktfrylligo' or p_owner is null or p_instance is null
        or p_instance::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
        or p_display_name is null or char_length(p_display_name) not between 1 and 128
        or p_display_name<>btrim(p_display_name) or p_display_name ~ '[[:cntrl:]]' then
        raise exception 'cp_provision_denied' using errcode='42501'; end if;

    -- Serialize even the absent-row case. Existing runtime operations still use
    -- their installation -> Auth user -> profile lock order. Collisions only wait.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'cinevault-provision-v1:'||p_instance::text,0));
    select * into installation from cinevault_private.cp_installations
        where instance_id=p_instance for update;
    if found and (installation.project_ref is distinct from p_project
        or installation.owner_id is distinct from p_owner or not installation.enabled) then
        raise exception 'cp_provision_conflict' using errcode='P0001'; end if;

    select * into account from auth.users where id=p_owner for share;
    if not found or account.is_anonymous is distinct from false or account.deleted_at is not null
        or account.banned_until>clock_timestamp() or account.email is null or btrim(account.email)=''
        or account.email_confirmed_at is null or account.email_confirmed_at>clock_timestamp() then
        raise exception 'cp_provision_denied' using errcode='42501'; end if;

    insert into public.profiles(id,display_name) values(p_owner,p_display_name)
        on conflict(id) do nothing;
    select * into profile from public.profiles where id=p_owner for share;
    if not found or profile.blocked or profile.must_change_password
        or profile.display_name is distinct from p_display_name then
        raise exception 'cp_provision_denied' using errcode='42501'; end if;

    select * into server from public.servers where server_instance_id=p_instance for share;
    if found then
        -- Never adopt an existing server into a newly provisioned installation.
        if installation.instance_id is null or server.owner_user_id is distinct from p_owner then
            raise exception 'cp_provision_conflict' using errcode='P0001'; end if;
        select * into credential from cinevault_private.cp_credentials where instance_id=p_instance for share;
        if not found or credential.server_id is distinct from server.id then
            raise exception 'cp_provision_conflict' using errcode='P0001'; end if;
    elsif exists(select 1 from cinevault_private.cp_credentials where instance_id=p_instance) then
        raise exception 'cp_provision_conflict' using errcode='P0001';
    end if;

    if installation.instance_id is null then
        insert into cinevault_private.cp_installations(instance_id,project_ref,owner_id)
            values(p_instance,p_project,p_owner);
    end if;
    -- No existing policy, names, admission counters, grants, credentials or
    -- timestamps are reset on retry. No membership/server/endpoint is issued.
    return jsonb_build_object('projectRef',p_project,'ownerId',p_owner,
        'serverInstanceId',p_instance,'enabled',true);
end;
$$;
revoke all on function cinevault_private.cp_provision_installation(text,uuid,uuid,text)
    from public,anon,authenticated,service_role,cv_control_broker,cv_control_broker_login;
-- END SOURCE provisioning.sql

commit;
