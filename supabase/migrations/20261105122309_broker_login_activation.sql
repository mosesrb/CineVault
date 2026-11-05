-- Operator commissioning. Set the dedicated SCRAM password privately first.
begin;
do $$
begin
    if not exists (
        select 1 from pg_catalog.pg_authid
        where rolname = 'cv_control_broker_login'
          and not rolinherit and not rolsuper and not rolcreatedb
          and not rolcreaterole and not rolreplication and not rolbypassrls
          and rolconnlimit = 4 and rolpassword like 'SCRAM-SHA-256$%'
          and (rolvaliduntil is null or rolvaliduntil > clock_timestamp())
    ) then
        raise exception 'Broker login prerequisites are not satisfied';
    end if;

    if (
        select count(*) from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles member on member.oid = m.member
        where member.rolname = 'cv_control_broker_login'
    ) <> 1 or not exists (
        select 1 from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles member on member.oid = m.member
        join pg_catalog.pg_roles granted on granted.oid = m.roleid
        where member.rolname = 'cv_control_broker_login'
          and granted.rolname = 'cv_control_broker'
          and not m.admin_option and not m.inherit_option and m.set_option
    ) then
        raise exception 'Broker login membership differs from the reviewed role';
    end if;
end;
$$;
alter role cv_control_broker_login login;
commit;
