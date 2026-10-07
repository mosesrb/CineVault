-- DISPOSABLE LAB ONLY. Not a migration/deployed RPC/owner bootstrap.
-- Append after enrollment_transactions.sql. Private trusted broker role only;
-- signed subject/session parameters come from the JS verifier, NOT PC bodies.
-- These limited definer reads need underlying private/Auth visibility, not
-- ordinary-client auth.uid semantics. No PUBLIC/default/client EXECUTE or CRUD.
create function cv_enrollment_lab.pending(p_pair uuid,p_instance uuid)
returns jsonb language sql security definer set search_path='' as $$
    select jsonb_build_object('grantId',g.id,'projectRef',i.project_ref,
        'credentialId',g.credential_id,'bindingDigest',encode(a.binding_digest,'hex'),
        'pollDigest',encode(g.poll_digest,'hex'),'secretDigest',encode(g.secret_digest,'hex'),
        'expiresAt',floor(extract(epoch from g.expires_at)*1000)::bigint)
    from cv_enrollment_lab.approvals a
    join cv_enrollment_lab.installations i on i.instance_id=a.instance_id
    join cv_enrollment_lab.grants g on g.approval_id=a.id
    where a.id=p_pair and a.instance_id=p_instance;
$$;

-- Read-only preflight; not mutation authority. consume() still rechecks under
-- installation/current-owner locks. No HTTP while those mutation locks are held.
create function cv_enrollment_lab.read_current(p_user uuid,p_session uuid,p_project text,p_instance uuid,p_binding bytea)
returns jsonb language sql security definer set search_path='' as $$
    select case when count(*)=1 then jsonb_agg(hit.result)->0 else null end from (
    select jsonb_build_object(
        'session',jsonb_build_object('id',s.id,'user_id',s.user_id,'not_after',s.not_after),
        'profile',jsonb_build_object('id',p.id,'blocked',p.blocked,'must_change_password',p.must_change_password),
        'approval',jsonb_build_object('owner_user_id',a.owner_id,'enabled',a.enabled and i.enabled,
            'project_ref',i.project_ref,'server_instance_id',i.instance_id,'binding_digest',encode(a.binding_digest,'hex'))) as result
    from cv_enrollment_lab.installations i
    join cv_enrollment_lab.approvals a on a.instance_id=i.instance_id
    join auth.sessions s on s.id=a.session_id and s.user_id=a.owner_id
    join public.profiles p on p.id=a.owner_id
    where i.instance_id=p_instance and i.project_ref=p_project and i.owner_id=p_user
        and a.owner_id=p_user and a.session_id=p_session and a.binding_digest=p_binding
        and a.jwt_expires_at>clock_timestamp()
    limit 2) hit;
$$;
-- Extend the unchanged core research transaction without editing its frozen
-- source: all core row locks remain held until this wrapper/transaction returns.
-- A changed grant credential/digest after the preliminary JS read must roll back
-- even if core consume already inserted its mapping. No new lock ordering.
create function cv_enrollment_lab.consume_bound(p_grant uuid,p_project text,p_instance uuid,
    p_binding bytea,p_poll bytea,p_credential uuid,p_secret bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; approval cv_enrollment_lab.approvals;
begin
    result:=cv_enrollment_lab.consume(p_grant,p_project,p_instance,p_binding,p_poll);
    select a.* into approval from cv_enrollment_lab.grants g
        join cv_enrollment_lab.approvals a on a.id=g.approval_id where g.id=p_grant;
    perform cv_enrollment_lab.current_owner(p_instance,approval.owner_id,approval.session_id);
    if p_credential is null or p_secret is null or octet_length(p_secret)<>32 or not exists(
        select 1 from cv_enrollment_lab.grants g
        join cv_enrollment_lab.credentials c on c.id=g.credential_id
        where g.id=p_grant and g.credential_id=p_credential and g.secret_digest=p_secret
            and c.secret_digest=p_secret and c.instance_id=p_instance
            and c.server_id=(result->>'serverId')::uuid
            and g.expires_at>clock_timestamp() and c.expires_at>clock_timestamp()
            and approval.jwt_expires_at>clock_timestamp()
    ) then raise exception 'enrollment_denied' using errcode='42501'; end if;
    return result;
end;
$$;
revoke all on function cv_enrollment_lab.pending(uuid,uuid),
    cv_enrollment_lab.read_current(uuid,uuid,text,uuid,bytea),
    cv_enrollment_lab.consume_bound(uuid,text,uuid,bytea,bytea,uuid,bytea)
    from public,anon,authenticated,service_role;
grant execute on function cv_enrollment_lab.pending(uuid,uuid),
    cv_enrollment_lab.read_current(uuid,uuid,text,uuid,bytea),
    cv_enrollment_lab.consume_bound(uuid,text,uuid,bytea,bytea,uuid,bytea) to cv_enrollment_lab_broker;
-- Broker can no longer accidentally bypass the added full-binding guard.
revoke execute on function cv_enrollment_lab.consume(uuid,text,uuid,bytea,bytea) from cv_enrollment_lab_broker;
