-- Additive follow-up; preserve the existing automatic-RLS function and trigger.
begin;

create index servers_owner_user_id_idx on public.servers(owner_user_id);

do $$
begin
    if to_regprocedure('public.rls_auto_enable()') is not null then
        if (select prorettype <> 'pg_catalog.event_trigger'::regtype
            from pg_proc where oid = to_regprocedure('public.rls_auto_enable()')) then
            raise exception 'Unexpected automatic-RLS helper type; inspect before deploying';
        end if;
        revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
    end if;
end;
$$;

commit;
