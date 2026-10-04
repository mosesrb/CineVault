-- Disposable test engine only; NEVER apply this file to a hosted project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Mimic legacy Supabase defaults: the migration must explicitly revoke writes.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
