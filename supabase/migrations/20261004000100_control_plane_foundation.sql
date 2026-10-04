-- Development foundation only. No media, history, local policy or credentials.
-- Apply once through migration tracking; existing objects fail rather than overwrite.
begin;

create schema cinevault_private;
revoke all on schema cinevault_private from public, anon, authenticated;
grant usage on schema cinevault_private to authenticated;

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '' check (char_length(display_name) <= 128),
    blocked boolean not null default false,
    must_change_password boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.servers (
    id uuid primary key,
    owner_user_id uuid not null references public.profiles(id),
    server_instance_id uuid unique not null,
    name text not null check (char_length(name) between 1 and 128),
    status text not null default 'OFFLINE' check (status in ('ONLINE', 'DEGRADED', 'OFFLINE')),
    last_heartbeat_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.server_users (
    server_id uuid not null references public.servers(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    role text not null default 'USER' check (role in ('ADMIN', 'USER')),
    enabled boolean not null default false,
    remote_stream_allowed boolean not null default false,
    download_allowed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (server_id, user_id)
);
create index server_users_user_id_idx on public.server_users(user_id);

create table public.server_endpoints (
    server_id uuid primary key references public.servers(id) on delete cascade,
    provider text not null check (char_length(provider) between 1 and 64),
    mode text not null check (mode in ('PRIVATE_REMOTE', 'PUBLIC_REMOTE', 'DIRECT_HTTPS')),
    -- Shape restriction only; trusted publication must validate TLS/host/identity.
    endpoint_url text not null check (
        char_length(endpoint_url) <= 2048 and
        endpoint_url ~ '^https://[^/@?#[:space:]]+(/[^?#[:space:]]*)?$'
    ),
    generation bigint not null check (generation >= 0),
    status text not null check (status in ('STARTING', 'ONLINE', 'DEGRADED', 'RECONNECTING', 'OFFLINE')),
    verified_at timestamptz,
    updated_at timestamptz not null default now(),
    check (status <> 'ONLINE' or verified_at is not null)
);

alter table public.profiles enable row level security;
alter table public.servers enable row level security;
alter table public.server_users enable row level security;
alter table public.server_endpoints enable row level security;

-- Revoke inherited/default privileges in the same transaction as RLS.
revoke all on public.profiles, public.servers, public.server_users, public.server_endpoints
    from public, anon, authenticated;
grant select on public.profiles, public.servers, public.server_users, public.server_endpoints
    to authenticated;
-- This role is for trusted control-plane provisioning, not a normal PC/client.
grant select, insert, update, delete on public.profiles, public.servers,
    public.server_users, public.server_endpoints to service_role;

create function cinevault_private.can_read_server(p_server_id uuid, p_remote boolean)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.server_users as membership
        join public.profiles as profile on profile.id = membership.user_id
        where membership.server_id = p_server_id
          and membership.user_id = (select auth.uid())
          and membership.enabled and not profile.blocked
          and (not p_remote or membership.remote_stream_allowed)
    );
$$;
revoke all on function cinevault_private.can_read_server(uuid, boolean) from public, anon;
grant execute on function cinevault_private.can_read_server(uuid, boolean) to authenticated;

create policy profiles_read_self on public.profiles for select to authenticated
    using (id = (select auth.uid()));
create policy memberships_read_self on public.server_users for select to authenticated
    using (user_id = (select auth.uid()) and exists (
        select 1 from public.profiles where id = (select auth.uid()) and not blocked
    ));
create policy servers_read_member on public.servers for select to authenticated
    using (cinevault_private.can_read_server(id, false));
create policy endpoints_read_remote_member on public.server_endpoints for select to authenticated
    using (status = 'ONLINE' and verified_at is not null and
           cinevault_private.can_read_server(server_id, true));

-- No authenticated write policies or RPCs. Owner/admin membership is not authority
-- to forge a heartbeat, endpoint or privilege. Scoped registration comes later.
commit;
