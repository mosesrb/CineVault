-- DISPOSABLE RESEARCH ONLY. Not a migration; NEVER apply to a hosted project.
-- Requires the test Auth contract and unchanged public foundation. Trusted fixture
-- provisioning supplies installations/approvals/grants, never an ordinary caller.
-- Broker parameters are detached, verified request/proof digests from the trusted
-- adapter, NOT user-JWT claims or permission to accept digest-only public requests.
create schema cv_enrollment_lab;
create role cv_enrollment_lab_broker nologin;
revoke all on schema cv_enrollment_lab from public, anon, authenticated, service_role;
grant usage on schema cv_enrollment_lab to cv_enrollment_lab_broker;

create table cv_enrollment_lab.installations (
    instance_id uuid primary key,
    project_ref text not null check (project_ref ~ '^[a-z]{20}$'),
    owner_id uuid not null references public.profiles(id) on delete cascade,
    enabled boolean not null default true
);
create index installations_owner_idx on cv_enrollment_lab.installations(owner_id);
create table cv_enrollment_lab.approvals (
    id uuid primary key,
    instance_id uuid not null references cv_enrollment_lab.installations(instance_id) on delete cascade,
    owner_id uuid not null,
    session_id uuid not null,
    binding_digest bytea not null check (octet_length(binding_digest)=32),
    jwt_expires_at timestamptz not null,
    enabled boolean not null default true
);
create index approvals_instance_idx on cv_enrollment_lab.approvals(instance_id);
create table cv_enrollment_lab.grants (
    id uuid primary key,
    approval_id uuid not null unique references cv_enrollment_lab.approvals(id) on delete cascade,
    credential_id uuid not null unique,
    secret_digest bytea not null check (octet_length(secret_digest)=32),
    poll_digest bytea not null check (octet_length(poll_digest)=32),
    issued_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null,
    revoked boolean not null default false,
    consumed_at timestamptz,
    check (expires_at>issued_at and expires_at<=issued_at+interval '5 minutes')
);
create table cv_enrollment_lab.credentials (
    id uuid primary key,
    instance_id uuid not null unique references cv_enrollment_lab.installations(instance_id) on delete cascade,
    server_id uuid not null unique references public.servers(id) on delete cascade,
    secret_digest bytea not null check (octet_length(secret_digest)=32),
    epoch bigint not null check (epoch=1),
    expires_at timestamptz not null,
    revoked boolean not null default false
);
alter table cv_enrollment_lab.installations enable row level security;
alter table cv_enrollment_lab.approvals enable row level security;
alter table cv_enrollment_lab.grants enable row level security;
alter table cv_enrollment_lab.credentials enable row level security;
revoke all on all tables in schema cv_enrollment_lab from public, anon, authenticated, service_role, cv_enrollment_lab_broker;

-- Shared installation row lock first, then current user/session/profile locks.
-- Auth deletion/profile updates acquire conflicting native row locks. Privileged
-- multi-row Auth operations can still deadlock: abort/retry, never bypass checks.
create function cv_enrollment_lab.current_owner(p_instance uuid,p_owner uuid,p_session uuid)
returns void language plpgsql security definer set search_path='' as $$
declare i cv_enrollment_lab.installations; u auth.users; s auth.sessions; p public.profiles;
begin
    select * into i from cv_enrollment_lab.installations where instance_id=p_instance for update;
    if not found or not i.enabled or i.owner_id is distinct from p_owner then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
    select * into u from auth.users where id=p_owner for share;
    if not found or u.is_anonymous is distinct from false or u.deleted_at is not null
        or u.banned_until>clock_timestamp() then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
    select * into s from auth.sessions where id=p_session and user_id=p_owner for share;
    if not found or s.not_after<=clock_timestamp() then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
    select * into p from public.profiles where id=p_owner for share;
    if not found or p.blocked or p.must_change_password then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
end;
$$;

create function cv_enrollment_lab.consume(p_grant uuid,p_project text,p_instance uuid,p_binding bytea,p_poll bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g cv_enrollment_lab.grants; a cv_enrollment_lab.approvals;
    prior_a cv_enrollment_lab.approvals;
    c cv_enrollment_lab.credentials; server_row public.servers; check_time timestamptz;
begin
    -- Preliminary read routes to the guard; it never establishes authority.
    select * into g from cv_enrollment_lab.grants where id=p_grant;
    if not found then raise exception 'enrollment_denied' using errcode='42501'; end if;
    select * into a from cv_enrollment_lab.approvals where id=g.approval_id;
    if not found or a.instance_id is distinct from p_instance then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
    prior_a:=a;
    perform cv_enrollment_lab.current_owner(p_instance,a.owner_id,a.session_id);
    -- Re-read everything after acquiring the shared installation guard.
    select * into a from cv_enrollment_lab.approvals where id=g.approval_id for update;
    if not found or not a.enabled or a.instance_id is distinct from p_instance
        or a.owner_id is distinct from prior_a.owner_id or a.session_id is distinct from prior_a.session_id
        or a.binding_digest is distinct from p_binding then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
    select * into g from cv_enrollment_lab.grants where id=p_grant for update;
    check_time:=clock_timestamp(); -- NOT transaction-start now() after lock waits.
    if not found or g.approval_id is distinct from a.id or g.revoked or g.poll_digest is distinct from p_poll
        or g.expires_at<=check_time or g.issued_at>check_time or a.jwt_expires_at<=check_time
        or not exists(select 1 from cv_enrollment_lab.installations
            where instance_id=p_instance and project_ref=p_project) then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
    select * into c from cv_enrollment_lab.credentials where instance_id=p_instance for update;
    if g.consumed_at is not null then
        if not found or c.id is distinct from g.credential_id or c.secret_digest is distinct from g.secret_digest
            or c.revoked or c.expires_at<=check_time then
            raise exception 'enrollment_denied' using errcode='42501';
        end if;
        select * into server_row from public.servers where id=c.server_id for share;
        if not found or server_row.owner_user_id is distinct from a.owner_id
            or server_row.server_instance_id is distinct from p_instance then
            raise exception 'enrollment_denied' using errcode='42501';
        end if;
    else
        -- No automatic replacement, clone adoption, recovery or credential rotation.
        if found or exists(select 1 from public.servers where server_instance_id=p_instance) then
            raise exception 'enrollment_denied' using errcode='42501';
        end if;
        insert into public.servers(id,owner_user_id,server_instance_id,name,status)
            values(pg_catalog.gen_random_uuid(),a.owner_id,p_instance,'CineVault','OFFLINE') returning * into server_row;
        insert into cv_enrollment_lab.credentials(id,instance_id,server_id,secret_digest,epoch,expires_at)
            values(g.credential_id,p_instance,server_row.id,g.secret_digest,1,check_time+interval '30 days') returning * into c;
        update cv_enrollment_lab.grants set consumed_at=check_time where id=p_grant;
    end if;
    -- Expiry can pass while waiting for a later row lock. Recheck before disclosure.
    perform cv_enrollment_lab.current_owner(p_instance,a.owner_id,a.session_id);
    check_time:=clock_timestamp();
    if g.expires_at<=check_time or a.jwt_expires_at<=check_time or c.expires_at<=check_time then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
    return jsonb_build_object('serverId',c.server_id,'serverInstanceId',c.instance_id,'credentialId',c.id,'epoch',c.epoch);
end;
$$;

-- Trusted human broker only: caller owner/session MUST come from verified Auth,
-- never from a PC credential or request body. Same guard as consumption.
create function cv_enrollment_lab.revoke(p_instance uuid,p_owner uuid,p_session uuid,p_jwt_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare c cv_enrollment_lab.credentials; server_row public.servers;
begin
    perform cv_enrollment_lab.current_owner(p_instance,p_owner,p_session);
    if p_jwt_expires_at is null or p_jwt_expires_at<=clock_timestamp() then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
    perform 1 from cv_enrollment_lab.approvals where instance_id=p_instance order by id for update;
    perform 1 from cv_enrollment_lab.grants where approval_id in
        (select id from cv_enrollment_lab.approvals where instance_id=p_instance) order by id for update;
    select * into c from cv_enrollment_lab.credentials where instance_id=p_instance for update;
    if found then
        select * into server_row from public.servers where id=c.server_id for update;
        if not found or server_row.server_instance_id is distinct from p_instance
            or server_row.owner_user_id is distinct from p_owner then
            raise exception 'enrollment_denied' using errcode='42501';
        end if;
    elsif exists(select 1 from public.servers where server_instance_id=p_instance) then
        -- A conflicting/preexisting mapping requires explicit owner recovery.
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
    update cv_enrollment_lab.grants set revoked=true where approval_id in
        (select id from cv_enrollment_lab.approvals where instance_id=p_instance);
    update cv_enrollment_lab.credentials set revoked=true where instance_id=p_instance;
    update public.servers set status='OFFLINE' where id=c.server_id;
    -- Withhold any existing endpoint; neither users nor media permissions change.
    update public.server_endpoints set status='OFFLINE',verified_at=null where server_id=c.server_id;
    perform cv_enrollment_lab.current_owner(p_instance,p_owner,p_session);
    if p_jwt_expires_at<=clock_timestamp() then
        raise exception 'enrollment_denied' using errcode='42501';
    end if;
end;
$$;
revoke all on all functions in schema cv_enrollment_lab from public, anon, authenticated, service_role, cv_enrollment_lab_broker;
grant execute on function cv_enrollment_lab.consume(uuid,text,uuid,bytea,bytea),
    cv_enrollment_lab.revoke(uuid,uuid,uuid,timestamptz) to cv_enrollment_lab_broker;
