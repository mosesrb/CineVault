-- PREPARED ONLY, apply after schema.sql in disposable tests. Not a migration.
-- Fixed storage: one global row + three counters per provisioned installation.
-- No IP/user-agent/body-selected keys, periodic jobs or artificial keepalive.
begin;
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
commit;
