-- PREPARED ONLY. Apply after schema/admission/replacement/restoration in tests.
-- Not a tracked migration, Auth account creator, first-visitor bootstrap or RPC.
begin;

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
commit;
