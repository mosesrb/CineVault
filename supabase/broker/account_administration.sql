-- PREPARED HOSTED ACCOUNT ADMINISTRATION SQL, NOT DEPLOYED WITHOUT REVIEW/APPROVAL.
-- Apply after schema.sql, admission.sql, replacement.sql, restoration.sql, provisioning.sql.
-- Existing broker SQL files and commissioning migration remain untouched.
begin;

create role cv_account_admin nologin;
grant usage on schema cinevault_private to cv_account_admin;

create role cv_account_admin_login nologin noinherit nosuperuser nocreatedb
    nocreaterole noreplication nobypassrls connection limit 2 password null;
grant connect on database postgres to cv_account_admin_login;
grant cv_account_admin to cv_account_admin_login
    with admin false, inherit false, set true;

create table cinevault_private.cp_project_admins (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    project_ref text not null check(project_ref='uouydbapluktfrylligo'),
    enabled boolean not null default true,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
);

create table cinevault_private.cp_password_resets (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    project_ref text not null check(project_ref='uouydbapluktfrylligo'),
    reset_id uuid not null,
    reset_generation bigint not null check(reset_generation>0),
    state text not null check(state in (
        'RESERVED',
        'ADMIN_RESET_CLAIMED',
        'AWAITING_USER_CHANGE',
        'USER_CHANGE_CLAIMED',
        'WRITE_OUTCOME_UNCERTAIN',
        'COMPLETED'
    )),
    in_flight_operation_id uuid,
    claimed_kind text check(claimed_kind is null or claimed_kind in ('ADMIN_RESET','USER_CHANGE')),
    write_ticket_digest bytea check(write_ticket_digest is null or octet_length(write_ticket_digest)=32),
    uncertain_reason text check(uncertain_reason is null or char_length(uncertain_reason) between 1 and 128),
    claimed_at timestamptz,
    uncertain_at timestamptz,
    updated_at timestamptz not null default clock_timestamp(),
    completed_at timestamptz,
    check(
        (state in ('ADMIN_RESET_CLAIMED','USER_CHANGE_CLAIMED')
            and in_flight_operation_id is not null
            and claimed_kind is not null
            and write_ticket_digest is not null
            and claimed_at is not null)
        or
        (state='WRITE_OUTCOME_UNCERTAIN'
            and in_flight_operation_id is not null
            and claimed_kind is not null
            and write_ticket_digest is null
            and uncertain_reason is not null
            and uncertain_at is not null)
        or
        (state in ('RESERVED','AWAITING_USER_CHANGE','COMPLETED')
            and write_ticket_digest is null)
    )
);

alter table cinevault_private.cp_project_admins enable row level security;
alter table cinevault_private.cp_password_resets enable row level security;

revoke all on cinevault_private.cp_project_admins, cinevault_private.cp_password_resets
    from public, anon, authenticated, service_role,
         cv_control_broker, cv_control_broker_login,
         cv_account_admin, cv_account_admin_login;

revoke all on cinevault_private.cp_installations, cinevault_private.cp_pairings,
    cinevault_private.cp_credentials, cinevault_private.cp_heartbeats,
    cinevault_private.cp_admission, cinevault_private.cp_replacements,
    cinevault_private.cp_restores
    from cv_account_admin, cv_account_admin_login;

revoke all on public.profiles, public.servers, public.server_users, public.server_endpoints
    from cv_account_admin, cv_account_admin_login;

-- Verify that the caller is an enabled, unblocked Project Administrator with a live session.
create function cinevault_private.cp_verify_project_admin(
    p_project text, p_admin uuid, p_session uuid, p_expiry timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare admin_row cinevault_private.cp_project_admins; u auth.users; p public.profiles; s auth.sessions;
begin
    if p_project is distinct from 'uouydbapluktfrylligo' or p_admin is null or p_session is null
        or p_expiry is null or p_expiry<=clock_timestamp() then
        raise exception 'cp_admin_denied' using errcode='42501'; end if;
    select * into admin_row from cinevault_private.cp_project_admins
        where user_id=p_admin and project_ref=p_project for share;
    if not found or not admin_row.enabled then
        raise exception 'cp_admin_denied' using errcode='42501'; end if;
    select * into u from auth.users where id=p_admin for share;
    if not found or u.is_anonymous is distinct from false or u.deleted_at is not null
        or u.banned_until>clock_timestamp() or u.email is null or btrim(u.email)=''
        or u.email_confirmed_at is null or u.email_confirmed_at>clock_timestamp() then
        raise exception 'cp_admin_denied' using errcode='42501'; end if;
    select * into p from public.profiles where id=p_admin for share;
    if not found or p.blocked or p.must_change_password then
        raise exception 'cp_admin_denied' using errcode='42501'; end if;
    select * into s from auth.sessions where id=p_session and user_id=p_admin for share;
    if not found or s.not_after<=clock_timestamp() then
        raise exception 'cp_admin_denied' using errcode='42501'; end if;
end;
$$;

-- Operator-only SECURITY INVOKER function to provision or disable a project administrator.
create function cinevault_private.cp_provision_project_admin(
    p_project text, p_admin uuid, p_display_name text, p_enabled boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u auth.users; p public.profiles;
begin
    if current_user is distinct from session_user
        or current_user in ('anon','authenticated','service_role','cv_control_broker','cv_control_broker_login','cv_account_admin','cv_account_admin_login')
        or not pg_catalog.has_table_privilege(current_user,'cinevault_private.cp_installations','UPDATE') then
        raise exception 'cp_operator_denied' using errcode='42501'; end if;
    if p_project is distinct from 'uouydbapluktfrylligo' or p_admin is null or p_enabled is null
        or p_display_name is null or char_length(p_display_name) not between 1 and 128
        or p_display_name<>btrim(p_display_name) or p_display_name ~ '[[:cntrl:]]' then
        raise exception 'cp_provision_denied' using errcode='42501'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'cinevault-project-admin-v1:'||p_admin::text,0));
    select * into u from auth.users where id=p_admin for share;
    if not found or u.is_anonymous is distinct from false or u.deleted_at is not null
        or u.banned_until>clock_timestamp() or u.email is null or btrim(u.email)=''
        or u.email_confirmed_at is null or u.email_confirmed_at>clock_timestamp() then
        raise exception 'cp_provision_denied' using errcode='42501'; end if;
    insert into public.profiles(id,display_name) values(p_admin,p_display_name)
        on conflict(id) do nothing;
    select * into p from public.profiles where id=p_admin for share;
    if not found or p.blocked or p.must_change_password or p.display_name is distinct from p_display_name then
        raise exception 'cp_provision_denied' using errcode='42501'; end if;
    insert into cinevault_private.cp_project_admins(user_id,project_ref,enabled,updated_at)
        values(p_admin,p_project,p_enabled,clock_timestamp())
        on conflict(user_id) do update set
            enabled=excluded.enabled,
            updated_at=clock_timestamp();
    return jsonb_build_object('projectRef',p_project,'adminUserId',p_admin,'enabled',p_enabled);
end;
$$;

-- Installation-scoped membership administration bound to the authenticated installation owner.
create function cinevault_private.cp_manage_server_member(
    p_project text, p_instance uuid, p_user uuid,
    p_role text default 'USER', p_enabled boolean default true,
    p_remote_stream_allowed boolean default false, p_download_allowed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_caller_uid uuid; v_claims_raw text; v_claims jsonb; v_session_id uuid;
    v_jwt_exp timestamptz; v_server public.servers; v_account auth.users;
    v_profile public.profiles; v_membership public.server_users;
begin
    v_caller_uid:=auth.uid();
    v_claims_raw:=nullif(current_setting('request.jwt.claims',true),'');
    if v_caller_uid is null or v_claims_raw is null then
        raise exception 'cp_member_denied' using errcode='42501'; end if;
    begin
        v_claims:=v_claims_raw::jsonb;
        if jsonb_typeof(v_claims->'session_id')<>'string' or jsonb_typeof(v_claims->'exp')<>'number' then
            raise exception 'cp_member_denied' using errcode='42501'; end if;
        v_session_id:=(v_claims->>'session_id')::uuid;
        v_jwt_exp:=to_timestamp((v_claims->>'exp')::double precision);
    exception when others then
        raise exception 'cp_member_denied' using errcode='42501';
    end;
    perform cinevault_private.cp_owner(p_instance,v_caller_uid,v_session_id,v_jwt_exp);

    if p_project is distinct from 'uouydbapluktfrylligo' or p_user is null
        or p_role is null or p_role not in ('ADMIN','USER')
        or p_enabled is null or p_remote_stream_allowed is null or p_download_allowed is null then
        raise exception 'cp_member_denied' using errcode='42501'; end if;
    if p_user=v_caller_uid and not p_enabled then
        raise exception 'cp_member_denied' using errcode='42501'; end if;

    select * into v_server from public.servers where server_instance_id=p_instance for share;
    if not found or v_server.owner_user_id is distinct from v_caller_uid then
        raise exception 'cp_member_conflict' using errcode='P0001'; end if;

    select * into v_account from auth.users where id=p_user for share;
    if not found or v_account.is_anonymous is distinct from false or v_account.deleted_at is not null
        or v_account.banned_until>clock_timestamp() or v_account.email is null or btrim(v_account.email)=''
        or v_account.email_confirmed_at is null or v_account.email_confirmed_at>clock_timestamp() then
        raise exception 'cp_member_denied' using errcode='42501'; end if;

    select * into v_profile from public.profiles where id=p_user for share;
    if not found or v_profile.blocked then
        raise exception 'cp_member_denied' using errcode='42501'; end if;

    insert into public.server_users(
        server_id,user_id,role,enabled,remote_stream_allowed,download_allowed,updated_at)
    values(
        v_server.id,p_user,p_role,p_enabled,p_remote_stream_allowed,p_download_allowed,clock_timestamp())
    on conflict(server_id,user_id) do update set
        role=excluded.role,
        enabled=excluded.enabled,
        remote_stream_allowed=excluded.remote_stream_allowed,
        download_allowed=excluded.download_allowed,
        updated_at=clock_timestamp()
    returning * into v_membership;

    perform cinevault_private.cp_owner(p_instance,v_caller_uid,v_session_id,v_jwt_exp);
    return jsonb_build_object(
        'projectRef',p_project,
        'serverInstanceId',p_instance,
        'cloudServerId',v_server.id,
        'userId',v_membership.user_id,
        'role',v_membership.role,
        'enabled',v_membership.enabled,
        'remoteStreamAllowed',v_membership.remote_stream_allowed,
        'downloadAllowed',v_membership.download_allowed
    );
end;
$$;

create function public.manage_server_member(
    p_project text, p_instance uuid, p_user uuid,
    p_role text default 'USER', p_enabled boolean default true,
    p_remote_stream_allowed boolean default false, p_download_allowed boolean default false)
returns jsonb language sql security definer set search_path='' as $$
    select cinevault_private.cp_manage_server_member(
        p_project,p_instance,p_user,p_role,p_enabled,p_remote_stream_allowed,p_download_allowed);
$$;

-- Operator-only SECURITY INVOKER function for direct database membership provisioning/updates.
create function cinevault_private.cp_operator_upsert_server_member(
    p_project text, p_instance uuid, p_user uuid, p_display_name text,
    p_role text default 'USER', p_enabled boolean default true,
    p_remote_stream_allowed boolean default false, p_download_allowed boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_owner uuid; v_server public.servers; v_account auth.users;
    v_profile public.profiles; v_membership public.server_users;
begin
    if current_user is distinct from session_user
        or current_user in ('anon','authenticated','service_role','cv_control_broker','cv_control_broker_login','cv_account_admin','cv_account_admin_login')
        or not pg_catalog.has_table_privilege(current_user,'cinevault_private.cp_installations','UPDATE') then
        raise exception 'cp_operator_denied' using errcode='42501'; end if;
    if p_project is distinct from 'uouydbapluktfrylligo' or p_instance is null or p_user is null
        or p_display_name is null or char_length(p_display_name) not between 1 and 128
        or p_display_name<>btrim(p_display_name) or p_display_name ~ '[[:cntrl:]]'
        or p_role is null or p_role not in ('ADMIN','USER')
        or p_enabled is null or p_remote_stream_allowed is null or p_download_allowed is null then
        raise exception 'cp_member_denied' using errcode='42501'; end if;

    v_owner:=cinevault_private.cp_guard(p_instance);
    if p_user=v_owner and not p_enabled then
        raise exception 'cp_member_denied' using errcode='42501'; end if;

    select * into v_server from public.servers where server_instance_id=p_instance for share;
    if not found or v_server.owner_user_id is distinct from v_owner then
        raise exception 'cp_member_conflict' using errcode='P0001'; end if;

    select * into v_account from auth.users where id=p_user for share;
    if not found or v_account.is_anonymous is distinct from false or v_account.deleted_at is not null
        or v_account.banned_until>clock_timestamp() or v_account.email is null or btrim(v_account.email)=''
        or v_account.email_confirmed_at is null or v_account.email_confirmed_at>clock_timestamp() then
        raise exception 'cp_member_denied' using errcode='42501'; end if;

    insert into public.profiles(id,display_name) values(p_user,p_display_name)
        on conflict(id) do nothing;
    select * into v_profile from public.profiles where id=p_user for share;
    if not found or v_profile.blocked or v_profile.display_name is distinct from p_display_name then
        raise exception 'cp_member_denied' using errcode='42501'; end if;

    insert into public.server_users(
        server_id,user_id,role,enabled,remote_stream_allowed,download_allowed,updated_at)
    values(
        v_server.id,p_user,p_role,p_enabled,p_remote_stream_allowed,p_download_allowed,clock_timestamp())
    on conflict(server_id,user_id) do update set
        role=excluded.role,
        enabled=excluded.enabled,
        remote_stream_allowed=excluded.remote_stream_allowed,
        download_allowed=excluded.download_allowed,
        updated_at=clock_timestamp()
    returning * into v_membership;

    return jsonb_build_object(
        'projectRef',p_project,
        'serverInstanceId',p_instance,
        'cloudServerId',v_server.id,
        'userId',v_membership.user_id,
        'role',v_membership.role,
        'enabled',v_membership.enabled,
        'remoteStreamAllowed',v_membership.remote_stream_allowed,
        'downloadAllowed',v_membership.download_allowed
    );
end;
$$;

-- Initialize a newly created Supabase user's profile with must_change_password=true and initial reset state.
create function cinevault_private.cp_init_provisioned_user_profile(
    p_project text, p_admin uuid, p_session uuid, p_expiry timestamptz,
    p_user uuid, p_display_name text, p_reset_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users;
begin
    perform cinevault_private.cp_verify_project_admin(p_project,p_admin,p_session,p_expiry);
    if p_user is null or p_reset_id is null or p_user=p_admin
        or p_reset_id::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
        or p_display_name is null or char_length(p_display_name) not between 1 and 128
        or p_display_name<>btrim(p_display_name) or p_display_name ~ '[[:cntrl:]]' then
        raise exception 'cp_init_denied' using errcode='42501'; end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'cinevault-password-reset-v1:'||p_user::text,0));

    if exists(select 1 from cinevault_private.cp_installations where owner_id=p_user)
        or exists(select 1 from cinevault_private.cp_project_admins where user_id=p_user) then
        raise exception 'cp_init_denied' using errcode='42501'; end if;

    select * into u from auth.users where id=p_user for update;
    if not found or u.is_anonymous is distinct from false or u.deleted_at is not null
        or u.banned_until>clock_timestamp() or u.email is null or btrim(u.email)=''
        or u.email_confirmed_at is null or u.email_confirmed_at>clock_timestamp() then
        raise exception 'cp_init_denied' using errcode='42501'; end if;

    if exists(select 1 from public.profiles where id=p_user) then
        raise exception 'cp_profile_exists' using errcode='P0001'; end if;

    insert into public.profiles(id,display_name,blocked,must_change_password,created_at,updated_at)
        values(p_user,p_display_name,false,true,clock_timestamp(),clock_timestamp());

    insert into cinevault_private.cp_password_resets(
        user_id,project_ref,reset_id,reset_generation,state,updated_at)
    values(
        p_user,p_project,p_reset_id,1,'AWAITING_USER_CHANGE',clock_timestamp());

    delete from auth.sessions where user_id=p_user;
    return jsonb_build_object(
        'projectRef',p_project,
        'userId',p_user,
        'displayName',p_display_name,
        'resetId',p_reset_id,
        'resetGeneration',1,
        'state','AWAITING_USER_CHANGE',
        'mustChangePassword',true
    );
end;
$$;

-- Step 1 of admin password reset: reserve reset_id, set must_change_password=true, delete auth.sessions.
create function cinevault_private.cp_begin_password_reset(
    p_project text, p_admin uuid, p_session uuid, p_expiry timestamptz,
    p_user uuid, p_reset_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users; p public.profiles; existing cinevault_private.cp_password_resets;
    v_next_gen bigint; v_revoked integer;
begin
    perform cinevault_private.cp_verify_project_admin(p_project,p_admin,p_session,p_expiry);
    if p_user is null or p_reset_id is null or p_user=p_admin
        or p_reset_id::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
        raise exception 'cp_reset_denied' using errcode='42501'; end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'cinevault-password-reset-v1:'||p_user::text,0));

    if exists(select 1 from cinevault_private.cp_installations where owner_id=p_user)
        or exists(select 1 from cinevault_private.cp_project_admins where user_id=p_user) then
        raise exception 'cp_reset_denied' using errcode='42501'; end if;

    select * into u from auth.users where id=p_user for update;
    if not found or u.is_anonymous is distinct from false or u.deleted_at is not null
        or u.banned_until>clock_timestamp() or u.email is null or btrim(u.email)=''
        or u.email_confirmed_at is null or u.email_confirmed_at>clock_timestamp() then
        raise exception 'cp_reset_denied' using errcode='42501'; end if;

    select * into existing from cinevault_private.cp_password_resets
        where user_id=p_user for update;
    if found then
        if existing.state in ('ADMIN_RESET_CLAIMED','USER_CHANGE_CLAIMED','WRITE_OUTCOME_UNCERTAIN') then
            raise exception 'cp_reset_unresolved' using errcode='P0001'; end if;
        if existing.reset_id=p_reset_id then
            raise exception 'cp_reset_duplicate' using errcode='P0001'; end if;
        v_next_gen:=existing.reset_generation+1;
    else
        v_next_gen:=1;
    end if;

    select * into p from public.profiles where id=p_user for update;
    if not found or p.blocked then
        raise exception 'cp_reset_denied' using errcode='42501'; end if;

    insert into cinevault_private.cp_password_resets(
        user_id,project_ref,reset_id,reset_generation,state,
        in_flight_operation_id,claimed_kind,write_ticket_digest,uncertain_reason,
        claimed_at,uncertain_at,updated_at,completed_at)
    values(
        p_user,p_project,p_reset_id,v_next_gen,'RESERVED',
        null,null,null,null,null,null,clock_timestamp(),null)
    on conflict(user_id) do update set
        reset_id=excluded.reset_id,
        reset_generation=excluded.reset_generation,
        state='RESERVED',
        in_flight_operation_id=null,
        claimed_kind=null,
        write_ticket_digest=null,
        uncertain_reason=null,
        claimed_at=null,
        uncertain_at=null,
        updated_at=clock_timestamp(),
        completed_at=null;

    update public.profiles
        set must_change_password=true, updated_at=clock_timestamp()
        where id=p_user;

    with deleted as (
        delete from auth.sessions where user_id=p_user returning 1
    )
    select count(*)::int into v_revoked from deleted;

    return jsonb_build_object(
        'projectRef',p_project,
        'userId',p_user,
        'resetId',p_reset_id,
        'resetGeneration',v_next_gen,
        'state','RESERVED',
        'mustChangePassword',true,
        'revokedSessions',v_revoked
    );
end;
$$;

-- Pre-write claim committed immediately before PUT /auth/v1/admin/users/{id}.
-- Prevents delayed older resets from writing and blocks overlapping/unresolved writes.
create function cinevault_private.cp_claim_password_write(
    p_project text, p_user uuid, p_reset_id uuid, p_operation_id uuid,
    p_kind text, p_caller_user uuid, p_caller_session uuid, p_caller_expiry timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r cinevault_private.cp_password_resets; u auth.users; p public.profiles;
    s auth.sessions; v_next_state text; v_ticket uuid; v_digest bytea;
begin
    if p_project is distinct from 'uouydbapluktfrylligo' or p_user is null or p_reset_id is null
        or p_operation_id is null or p_kind is null or p_kind not in ('ADMIN_RESET','USER_CHANGE')
        or p_operation_id::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
        raise exception 'cp_claim_denied' using errcode='42501'; end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'cinevault-password-reset-v1:'||p_user::text,0));

    select * into r from cinevault_private.cp_password_resets
        where user_id=p_user and project_ref=p_project for update;
    if not found then
        raise exception 'cp_claim_denied' using errcode='42501'; end if;
    if r.state in ('ADMIN_RESET_CLAIMED','USER_CHANGE_CLAIMED','WRITE_OUTCOME_UNCERTAIN') then
        raise exception 'cp_reset_unresolved' using errcode='P0001'; end if;
    if r.reset_id is distinct from p_reset_id then
        raise exception 'cp_reset_superseded' using errcode='42501'; end if;

    if exists(select 1 from cinevault_private.cp_installations where owner_id=p_user)
        or exists(select 1 from cinevault_private.cp_project_admins where user_id=p_user) then
        raise exception 'cp_claim_denied' using errcode='42501'; end if;

    select * into u from auth.users where id=p_user for update;
    if not found or u.is_anonymous is distinct from false or u.deleted_at is not null
        or u.banned_until>clock_timestamp() or u.email is null or btrim(u.email)=''
        or u.email_confirmed_at is null or u.email_confirmed_at>clock_timestamp() then
        raise exception 'cp_claim_denied' using errcode='42501'; end if;

    select * into p from public.profiles where id=p_user for update;
    if not found or p.blocked then
        raise exception 'cp_claim_denied' using errcode='42501'; end if;

    if p_kind='ADMIN_RESET' then
        if r.state<>'RESERVED' then
            raise exception 'cp_reset_state_invalid' using errcode='42501'; end if;
        perform cinevault_private.cp_verify_project_admin(
            p_project,p_caller_user,p_caller_session,p_caller_expiry);
        v_next_state:='ADMIN_RESET_CLAIMED';
    else
        if r.state<>'AWAITING_USER_CHANGE' or not p.must_change_password then
            raise exception 'cp_reset_state_invalid' using errcode='42501'; end if;
        if p_caller_user is distinct from p_user or p_caller_session is null
            or p_caller_expiry is null or p_caller_expiry<=clock_timestamp() then
            raise exception 'cp_claim_denied' using errcode='42501'; end if;
        select * into s from auth.sessions where id=p_caller_session and user_id=p_user for share;
        if not found or s.not_after<=clock_timestamp() then
            raise exception 'cp_claim_denied' using errcode='42501'; end if;
        v_next_state:='USER_CHANGE_CLAIMED';
    end if;

    v_ticket:=gen_random_uuid();
    v_digest:=pg_catalog.sha256(pg_catalog.convert_to(v_ticket::text,'UTF8'));

    update cinevault_private.cp_password_resets set
        state=v_next_state,
        in_flight_operation_id=p_operation_id,
        claimed_kind=p_kind,
        write_ticket_digest=v_digest,
        uncertain_reason=null,
        claimed_at=clock_timestamp(),
        uncertain_at=null,
        updated_at=clock_timestamp()
    where user_id=p_user;

    update public.profiles
        set must_change_password=true, updated_at=clock_timestamp()
        where id=p_user;

    return jsonb_build_object(
        'projectRef',p_project,
        'userId',p_user,
        'resetId',p_reset_id,
        'resetGeneration',r.reset_generation,
        'operationId',p_operation_id,
        'state',v_next_state,
        'writeTicket',v_ticket
    );
end;
$$;

-- Durable unresolved state committed on timeout, lost response, or uncertain Auth Admin error.
-- Destroys write_ticket_digest, keeps must_change_password=true, and permanently blocks password writes.
create function cinevault_private.cp_mark_password_write_uncertain(
    p_project text, p_user uuid, p_reset_id uuid, p_operation_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r cinevault_private.cp_password_resets; v_revoked integer;
begin
    if p_project is distinct from 'uouydbapluktfrylligo' or p_user is null
        or p_reset_id is null or p_operation_id is null
        or p_reason is null or char_length(p_reason) not between 1 and 128
        or p_reason<>btrim(p_reason) or p_reason ~ '[[:cntrl:]]' then
        raise exception 'cp_uncertain_denied' using errcode='42501'; end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'cinevault-password-reset-v1:'||p_user::text,0));

    select * into r from cinevault_private.cp_password_resets
        where user_id=p_user and project_ref=p_project for update;
    if not found or r.reset_id is distinct from p_reset_id
        or r.in_flight_operation_id is distinct from p_operation_id
        or r.state not in ('ADMIN_RESET_CLAIMED','USER_CHANGE_CLAIMED','WRITE_OUTCOME_UNCERTAIN') then
        raise exception 'cp_uncertain_denied' using errcode='42501'; end if;

    update cinevault_private.cp_password_resets set
        state='WRITE_OUTCOME_UNCERTAIN',
        write_ticket_digest=null,
        uncertain_reason=p_reason,
        uncertain_at=coalesce(r.uncertain_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where user_id=p_user;

    update public.profiles
        set must_change_password=true, updated_at=clock_timestamp()
        where id=p_user;

    with deleted as (
        delete from auth.sessions where user_id=p_user returning 1
    )
    select count(*)::int into v_revoked from deleted;

    return jsonb_build_object(
        'projectRef',p_project,
        'userId',p_user,
        'resetId',p_reset_id,
        'resetGeneration',r.reset_generation,
        'operationId',p_operation_id,
        'state','WRITE_OUTCOME_UNCERTAIN',
        'mustChangePassword',true,
        'revokedSessions',v_revoked
    );
end;
$$;

-- Redeem single-use write_ticket after verified HTTP 200 OK from ADMIN_RESET PUT /auth/v1/admin/users/{id}.
create function cinevault_private.cp_seal_password_reset(
    p_project text, p_user uuid, p_reset_id uuid, p_operation_id uuid, p_write_ticket uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r cinevault_private.cp_password_resets; p public.profiles; v_digest bytea; v_revoked integer;
begin
    if p_project is distinct from 'uouydbapluktfrylligo' or p_user is null
        or p_reset_id is null or p_operation_id is null or p_write_ticket is null then
        raise exception 'cp_seal_denied' using errcode='42501'; end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'cinevault-password-reset-v1:'||p_user::text,0));

    select * into r from cinevault_private.cp_password_resets
        where user_id=p_user and project_ref=p_project for update;
    if not found then
        raise exception 'cp_seal_denied' using errcode='42501'; end if;
    if r.state='WRITE_OUTCOME_UNCERTAIN' then
        raise exception 'cp_reset_unresolved' using errcode='P0001'; end if;

    v_digest:=pg_catalog.sha256(pg_catalog.convert_to(p_write_ticket::text,'UTF8'));
    if r.reset_id is distinct from p_reset_id
        or r.state<>'ADMIN_RESET_CLAIMED'
        or r.claimed_kind<>'ADMIN_RESET'
        or r.in_flight_operation_id is distinct from p_operation_id
        or r.write_ticket_digest is null
        or r.write_ticket_digest is distinct from v_digest then
        raise exception 'cp_seal_denied' using errcode='42501'; end if;

    select * into p from public.profiles where id=p_user for update;
    if not found or p.blocked then
        raise exception 'cp_seal_denied' using errcode='42501'; end if;

    update cinevault_private.cp_password_resets set
        state='AWAITING_USER_CHANGE',
        in_flight_operation_id=null,
        claimed_kind=null,
        write_ticket_digest=null,
        uncertain_reason=null,
        claimed_at=null,
        uncertain_at=null,
        updated_at=clock_timestamp()
    where user_id=p_user;

    update public.profiles
        set must_change_password=true, updated_at=clock_timestamp()
        where id=p_user;

    with deleted as (
        delete from auth.sessions where user_id=p_user returning 1
    )
    select count(*)::int into v_revoked from deleted;

    return jsonb_build_object(
        'projectRef',p_project,
        'userId',p_user,
        'resetId',p_reset_id,
        'resetGeneration',r.reset_generation,
        'state','AWAITING_USER_CHANGE',
        'mustChangePassword',true,
        'revokedSessions',v_revoked
    );
end;
$$;

-- Redeem single-use write_ticket after verified HTTP 200 OK from USER_CHANGE PUT /auth/v1/admin/users/{id}.
-- Clears must_change_password=false and revokes temporary sessions.
create function cinevault_private.cp_complete_password_change(
    p_project text, p_user uuid, p_reset_id uuid, p_operation_id uuid, p_write_ticket uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r cinevault_private.cp_password_resets; u auth.users; p public.profiles;
    v_digest bytea; v_revoked integer;
begin
    if p_project is distinct from 'uouydbapluktfrylligo' or p_user is null
        or p_reset_id is null or p_operation_id is null or p_write_ticket is null then
        raise exception 'cp_complete_denied' using errcode='42501'; end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'cinevault-password-reset-v1:'||p_user::text,0));

    select * into r from cinevault_private.cp_password_resets
        where user_id=p_user and project_ref=p_project for update;
    if not found then
        raise exception 'cp_complete_denied' using errcode='42501'; end if;
    if r.state='WRITE_OUTCOME_UNCERTAIN' then
        raise exception 'cp_reset_unresolved' using errcode='P0001'; end if;

    v_digest:=pg_catalog.sha256(pg_catalog.convert_to(p_write_ticket::text,'UTF8'));
    if r.reset_id is distinct from p_reset_id
        or r.state<>'USER_CHANGE_CLAIMED'
        or r.claimed_kind<>'USER_CHANGE'
        or r.in_flight_operation_id is distinct from p_operation_id
        or r.write_ticket_digest is null
        or r.write_ticket_digest is distinct from v_digest then
        raise exception 'cp_complete_denied' using errcode='42501'; end if;

    select * into u from auth.users where id=p_user for update;
    if not found or u.is_anonymous is distinct from false or u.deleted_at is not null
        or u.banned_until>clock_timestamp() then
        raise exception 'cp_complete_denied' using errcode='42501'; end if;

    select * into p from public.profiles where id=p_user for update;
    if not found or p.blocked or not p.must_change_password then
        raise exception 'cp_complete_denied' using errcode='42501'; end if;

    update public.profiles
        set must_change_password=false, updated_at=clock_timestamp()
        where id=p_user;

    update cinevault_private.cp_password_resets set
        state='COMPLETED',
        in_flight_operation_id=null,
        claimed_kind=null,
        write_ticket_digest=null,
        uncertain_reason=null,
        claimed_at=null,
        uncertain_at=null,
        completed_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where user_id=p_user;

    with deleted as (
        delete from auth.sessions where user_id=p_user returning 1
    )
    select count(*)::int into v_revoked from deleted;

    return jsonb_build_object(
        'projectRef',p_project,
        'userId',p_user,
        'resetId',p_reset_id,
        'resetGeneration',r.reset_generation,
        'state','COMPLETED',
        'mustChangePassword',false,
        'revokedSessions',v_revoked
    );
end;
$$;

-- Operator-only SECURITY INVOKER containment & quarantine function for uncertain password writes.
-- Keeps state='WRITE_OUTCOME_UNCERTAIN' (permanently blocking password writes), sets profiles.blocked=true
-- and must_change_password=true, disables all server_users memberships, and deletes auth.sessions.
create function cinevault_private.cp_quarantine_uncertain_account(
    p_project text, p_user uuid, p_expected_reset_id uuid, p_expected_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r cinevault_private.cp_password_resets; p public.profiles;
    v_disabled_memberships integer; v_revoked_sessions integer;
begin
    if current_user is distinct from session_user
        or current_user in ('anon','authenticated','service_role','cv_control_broker','cv_control_broker_login','cv_account_admin','cv_account_admin_login')
        or not pg_catalog.has_table_privilege(current_user,'cinevault_private.cp_installations','UPDATE') then
        raise exception 'cp_operator_denied' using errcode='42501'; end if;
    if p_project is distinct from 'uouydbapluktfrylligo' or p_user is null
        or p_expected_reset_id is null or p_expected_operation_id is null then
        raise exception 'cp_quarantine_denied' using errcode='42501'; end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'cinevault-password-reset-v1:'||p_user::text,0));

    select * into r from cinevault_private.cp_password_resets
        where user_id=p_user and project_ref=p_project for update;
    if not found
        or r.reset_id is distinct from p_expected_reset_id
        or r.in_flight_operation_id is distinct from p_expected_operation_id
        or r.state not in ('WRITE_OUTCOME_UNCERTAIN','ADMIN_RESET_CLAIMED','USER_CHANGE_CLAIMED') then
        raise exception 'cp_quarantine_conflict' using errcode='P0001'; end if;

    select * into p from public.profiles where id=p_user for update;
    if not found then
        raise exception 'cp_quarantine_conflict' using errcode='P0001'; end if;

    update cinevault_private.cp_password_resets set
        state='WRITE_OUTCOME_UNCERTAIN',
        write_ticket_digest=null,
        uncertain_reason=coalesce(r.uncertain_reason,'operator_quarantined'),
        uncertain_at=coalesce(r.uncertain_at,clock_timestamp()),
        updated_at=clock_timestamp()
    where user_id=p_user;

    update public.profiles set
        blocked=true,
        must_change_password=true,
        updated_at=clock_timestamp()
    where id=p_user;

    with disabled as (
        update public.server_users
            set enabled=false, updated_at=clock_timestamp()
            where user_id=p_user and enabled=true
            returning 1
    )
    select count(*)::int into v_disabled_memberships from disabled;

    with deleted as (
        delete from auth.sessions where user_id=p_user returning 1
    )
    select count(*)::int into v_revoked_sessions from deleted;

    return jsonb_build_object(
        'projectRef',p_project,
        'userId',p_user,
        'resetId',p_expected_reset_id,
        'resetGeneration',r.reset_generation,
        'operationId',p_expected_operation_id,
        'state','WRITE_OUTCOME_UNCERTAIN',
        'blocked',true,
        'mustChangePassword',true,
        'disabledMemberships',v_disabled_memberships,
        'revokedSessions',v_revoked_sessions
    );
end;
$$;

-- Operator-only SECURITY INVOKER function to block/unblock a non-owner member profile.
create function cinevault_private.cp_set_member_profile_state(
    p_project text, p_user uuid, p_blocked boolean, p_must_change_password boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.profiles; v_revoked integer := 0;
begin
    if current_user is distinct from session_user
        or current_user in ('anon','authenticated','service_role','cv_control_broker','cv_control_broker_login','cv_account_admin','cv_account_admin_login')
        or not pg_catalog.has_table_privilege(current_user,'cinevault_private.cp_installations','UPDATE') then
        raise exception 'cp_operator_denied' using errcode='42501'; end if;
    if p_project is distinct from 'uouydbapluktfrylligo' or p_user is null
        or p_blocked is null or p_must_change_password is null then
        raise exception 'cp_profile_state_denied' using errcode='42501'; end if;
    if exists(select 1 from cinevault_private.cp_installations where owner_id=p_user) then
        raise exception 'cp_profile_state_denied' using errcode='42501'; end if;

    select * into p from public.profiles where id=p_user for update;
    if not found then
        raise exception 'cp_profile_state_denied' using errcode='42501'; end if;

    update public.profiles set
        blocked=p_blocked,
        must_change_password=p_must_change_password,
        updated_at=clock_timestamp()
    where id=p_user;

    if p_blocked or p_must_change_password then
        with deleted as (
            delete from auth.sessions where user_id=p_user returning 1
        )
        select count(*)::int into v_revoked from deleted;
    end if;

    return jsonb_build_object(
        'projectRef',p_project,
        'userId',p_user,
        'blocked',p_blocked,
        'mustChangePassword',p_must_change_password,
        'revokedSessions',v_revoked
    );
end;
$$;

-- Revoke all privileges on existing broker functions from account-admin roles.
revoke all on function
    cinevault_private.cp_guard(uuid),
    cinevault_private.cp_owner(uuid,uuid,uuid,timestamptz),
    cinevault_private.cp_request(jsonb),
    cinevault_private.cp_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_register(jsonb,bytea,bytea,bytea),
    cinevault_private.cp_verifier(uuid),
    cinevault_private.cp_heartbeat(uuid,bytea,jsonb),
    cinevault_private.cp_revoke(uuid,uuid,uuid,timestamptz),
    cinevault_private.cp_admit_request(),
    cinevault_private.cp_admit(text,uuid),
    cinevault_private.cp_replace_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_replace(jsonb,bytea,bytea,bytea),
    cinevault_private.cp_restore_approve(uuid,uuid,timestamptz,jsonb,bytea,bytea),
    cinevault_private.cp_restore(jsonb,bytea,bytea,bytea),
    cinevault_private.cp_provision_installation(text,uuid,uuid,text)
    from cv_account_admin, cv_account_admin_login;

-- Revoke all privileges on new functions from all untrusted / non-designated roles.
revoke all on function
    cinevault_private.cp_verify_project_admin(text,uuid,uuid,timestamptz),
    cinevault_private.cp_provision_project_admin(text,uuid,text,boolean),
    cinevault_private.cp_manage_server_member(text,uuid,uuid,text,boolean,boolean,boolean),
    public.manage_server_member(text,uuid,uuid,text,boolean,boolean,boolean),
    cinevault_private.cp_operator_upsert_server_member(text,uuid,uuid,text,text,boolean,boolean,boolean),
    cinevault_private.cp_init_provisioned_user_profile(text,uuid,uuid,timestamptz,uuid,text,uuid),
    cinevault_private.cp_begin_password_reset(text,uuid,uuid,timestamptz,uuid,uuid),
    cinevault_private.cp_claim_password_write(text,uuid,uuid,uuid,text,uuid,uuid,timestamptz),
    cinevault_private.cp_mark_password_write_uncertain(text,uuid,uuid,uuid,text),
    cinevault_private.cp_seal_password_reset(text,uuid,uuid,uuid,uuid),
    cinevault_private.cp_complete_password_change(text,uuid,uuid,uuid,uuid),
    cinevault_private.cp_quarantine_uncertain_account(text,uuid,uuid,uuid),
    cinevault_private.cp_set_member_profile_state(text,uuid,boolean,boolean)
    from public, anon, authenticated, service_role,
         cv_control_broker, cv_control_broker_login,
         cv_account_admin, cv_account_admin_login;

-- Grant public.manage_server_member exclusively to authenticated callers.
grant execute on function
    public.manage_server_member(text,uuid,uuid,text,boolean,boolean,boolean)
    to authenticated;

-- Grant only the allowlisted account-admin workflow functions to cv_account_admin.
grant execute on function
    cinevault_private.cp_verify_project_admin(text,uuid,uuid,timestamptz),
    cinevault_private.cp_init_provisioned_user_profile(text,uuid,uuid,timestamptz,uuid,text,uuid),
    cinevault_private.cp_begin_password_reset(text,uuid,uuid,timestamptz,uuid,uuid),
    cinevault_private.cp_claim_password_write(text,uuid,uuid,uuid,text,uuid,uuid,timestamptz),
    cinevault_private.cp_mark_password_write_uncertain(text,uuid,uuid,uuid,text),
    cinevault_private.cp_seal_password_reset(text,uuid,uuid,uuid,uuid),
    cinevault_private.cp_complete_password_change(text,uuid,uuid,uuid,uuid)
    to cv_account_admin;

commit;
