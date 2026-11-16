-- Require a live Supabase Auth session in addition to existing Data API policies.
begin;

create function cinevault_private.has_live_data_api_session()
returns boolean language sql stable security definer set search_path = '' as $$
    with caller as (
        select auth.uid() as user_id, auth.jwt() ->> 'session_id' as session_claim
    )
    select exists (
        select 1
        from auth.sessions as session
        join caller on session.user_id = caller.user_id
        where session.id = case
            when caller.session_claim ~ '^[[:xdigit:]]{8}(-[[:xdigit:]]{4}){3}-[[:xdigit:]]{12}$'
                then caller.session_claim::uuid
        end
        and (session.not_after is null or session.not_after > statement_timestamp())
    );
$$;

revoke all on function cinevault_private.has_live_data_api_session()
    from public, anon, authenticated, service_role;
grant execute on function cinevault_private.has_live_data_api_session() to authenticated;

create policy require_live_auth_session on public.profiles
    as restrictive for select to authenticated
    using ((select cinevault_private.has_live_data_api_session()));
create policy require_live_auth_session on public.server_users
    as restrictive for select to authenticated
    using ((select cinevault_private.has_live_data_api_session()));
create policy require_live_auth_session on public.servers
    as restrictive for select to authenticated
    using ((select cinevault_private.has_live_data_api_session()));
create policy require_live_auth_session on public.server_endpoints
    as restrictive for select to authenticated
    using ((select cinevault_private.has_live_data_api_session()));

commit;
