# Cloud owner and installation provisioning

This operator workflow uses the private provisioning function installed by
migration `20261104022207_control_plane_broker_commissioning.sql`. The first
hosted owner and installation binding has been verified.

The Supabase dashboard account and a user in the project's **Authentication →
Users** list are different identities. Dashboard access alone does not create a
CineVault cloud owner. The ordinary PC must never receive the project's database
password, service-role key, broker database password or the owner's refresh token.

## Before hosted commissioning

1. Obtain approval for the exact project, permanent Auth account, installation
   UUID, display name, SQL/migrations and hosted secret operations. Do not choose
   the first sign-in, match an email to a local administrator, or trust editable
   Auth metadata. Do not reuse disposable QA accounts.
2. Create or select the intended permanent account through supported Supabase
   Auth administration. The owner controls its password in the trusted provider
   interface; never place it in chat, SQL, source, terminal history or a worklog.
   Confirm the correct account UUID and confirmed email. Provisioning does not
   create/modify Auth users or mark an email confirmed. A confirmed account alone
   does not establish that the prepared password-grant page can sign in; its
   authentication method/protocol needs separate qualification and approval.
3. Independently confirm the installation's permanent UUID from local ADMIN
   setup. Public `/api/v1/identity` is identification, not proof of ownership.
   Confirm the project is `uouydbapluktfrylligo`. Review the current hosted schema,
   migration history, role privileges and security advisors. Confirm that hosted
   history contains version `20261104022207` before provisioning.
4. In the trusted operator's bounded transaction, invoke the private function
   using parameterized values: `cp_provision_installation(project, owner UUID,
   installation UUID, display name)`. Use `cinevault_private` as its explicit
   schema. Set `lock_timeout=2s`, `statement_timeout=8s` and
   `transaction_timeout=10s` for this transaction. The function uses invoker
   privileges and is not granted to any ordinary API, service-role or broker
   caller. It must run as the explicitly approved schema administrator.

The operation creates only a missing profile and one enabled installation/owner
binding. It requires a current nonanonymous, nondeleted, unbanned account with a
confirmed nonempty email. Existing blocked/password-change-required profiles,
different display names, disabled installations, another owner or an unbound
existing cloud server fail. It never clears those restrictions or adopts a server.
For an existing profile, use its actual approved display name rather than renaming
it through provisioning. Exact retries preserve names, timestamps, counters,
credentials and policy. Concurrent first provisioning serializes the absent-row
case; only one owner can win. Errors roll the transaction back, including any
new profile. A compatible registered installation can be checked again without
reviving expired/revoked operational credentials.

## Dedicated hosted database login

The hosted migration created `cv_control_broker_login` **NOLOGIN**, with no password,
no automatic inherited broker privileges, no superuser/role/database creation,
replication or RLS bypass, and a four-connection cap. Its sole membership permits
explicit `SET LOCAL ROLE cv_control_broker`, without ADMIN or INHERIT options.
The existing broker driver already uses that transaction-local role and its
allowlisted private functions. The login has no owner-provisioning permission.
Existing role names cause SQL to fail rather than overwrite an unknown role.

Migration `20261105122309_broker_login_activation.sql` enables LOGIN after
checking the privately set SCRAM password, restricted attributes and exact
reviewed membership. It preserves the password and existing grants.

After separate exact approval, a trusted operator must generate a strong dedicated
password in a secure secret workflow, configure SCRAM authentication, enable LOGIN
and place only the dedicated connection URL in hosted function secret storage.
Never put a password/verifier in a migration, command argument, checked-in file,
ordinary PC environment or evidence. Copy the actual regional pool host from the
provider Connect dialog; do not guess its cluster index. The runtime requires
the custom `cv_control_broker_login.uouydbapluktfrylligo` shared-pool username,
transaction port6543, certificate-verified TLS and prepared statements disabled.
The broker uses the public CA supplied in the project's Supabase Database
Settings. An operator using `psql` should use that CA with `sslmode=verify-full`
on the session pooler and set the dedicated password with `\password`.
Test actual pool authentication, transaction-local role reset and effective
permissions before enabling the broker. The disposable loopback fixture uses
trust authentication and does not qualify production passwords, TLS or Supavisor.

Profile/install provisioning issues no enrollment grant, operational credential,
cloud server, membership, endpoint or ONLINE status. The separate owner approval
and durable PC enrollment still have to run. Provisioning does not transfer
ownership or repair a disabled/corrupt mapping; investigate and authorize an exact
maintenance operation instead of changing rows or resetting the local identity.

## Remaining commissioning gates

Database preparation is complete for project `uouydbapluktfrylligo`
(`ap-southeast-2`). The hosted migration bundles the five broker SQL sources in
one transaction and creates the private broker objects, quota state and
passwordless NOLOGIN role. Its SHA256 is
`89db474fbaff9874d33182f53394654e7f5cd9ad58db5a5cc17da7784f131c42`.
Use the tracked migration as the database history record.

Hosted broker login activation, the exact free Pages origin, the owner sign-in
protocol, credential lifetime and admission policy, and runtime deployment are
pending. Then verify hosted enrollment, activity reporting, and recovery from
outages and pauses. Device and release qualification are separate.

## Hosted account administration and password reset recovery (`CV-P4-5`)

Prepared SQL (`supabase/broker/account_administration.sql`) and the dedicated
`cinevault-account-admin` Edge Function (`supabase/account-admin/`) provide
hosted Supabase account creation, installation membership management, and
password reset administration without expanding `cv_control_broker`:

1. **Dedicated Roles and Boundary**: `cv_account_admin_login` (`NOLOGIN` in
   prepared SQL until secret provisioning, `NOINHERIT`, `NOBYPASSRLS`,
   `CONNECTION LIMIT 2`) connects via Supavisor transaction mode (`6543`) and
   executes `SET LOCAL ROLE cv_account_admin` inside bounded transactions. It
   has `EXECUTE` only on the seven account-administration RPCs in
   `cinevault_private` and zero access to enrollment, replacement, restoration,
   or heartbeat functions/tables.
2. **Project Administrator Provisioning**: A trusted schema operator provisions
   or disables project administrators in a bounded transaction via
   `cinevault_private.cp_provision_project_admin(p_project, p_admin_uuid,
   p_display_name, p_enabled)`.
3. **Caller-Bound Installation Membership**: Authenticated installation owners
   manage `public.server_users` for their own installation via
   `public.manage_server_member(p_project, p_instance, p_user, p_role,
   p_enabled, p_remote_stream_allowed, p_download_allowed)`, which binds the
   caller to `auth.uid()` and a live `auth.sessions` row via `cp_owner`.
   Trusted schema operators can use the `SECURITY INVOKER` helper
   `cinevault_private.cp_operator_upsert_server_member(...)`.
4. **Pre-Write Password Claim and Uncertain Outcome Escalation**: Before calling
   `PUT /auth/v1/admin/users/{id}`, `cinevault-account-admin` commits
   `cinevault_private.cp_claim_password_write(...)` to lock the target user's
   `cp_password_resets` row, verify `reset_id`, and obtain a single-use
   `write_ticket`. If the outbound Auth Admin API request times out or fails
   with an indeterminate outcome, the service commits
   `cinevault_private.cp_mark_password_write_uncertain(...)` (`state =
   'WRITE_OUTCOME_UNCERTAIN'`). Because Supabase Auth Admin API provides no
   idempotency key or in-flight operation status query to prove that an earlier
   timed-out write has finished or cannot still apply, password writes remain
   permanently blocked for that account (`409 password_reset_unresolved`). To
   recover service for the affected viewer:
   - **Stage 1 (Containment)**: Run
     `cinevault_private.cp_quarantine_uncertain_account(p_project, p_user_uuid,
     p_reset_id, p_operation_id)` as the schema operator to set
     `profiles.blocked = true`, disable all `server_users` memberships, and
     revoke `auth.sessions` while preserving the `WRITE_OUTCOME_UNCERTAIN`
     lock.
   - **Stage 2 (Clean Account Replacement)**: Provision a fresh Supabase
     account via `cinevault-account-admin` (`admin-create-user`), enable
     installation membership (`public.manage_server_member`), and re-link the
     local CineVault user (`npm run migrate:identity-link-write -- rollback ...`
     followed by `apply`).

References: [Supabase users](https://supabase.com/docs/guides/auth/users),
[database roles](https://supabase.com/docs/guides/database/postgres/roles),
[database connections](https://supabase.com/docs/guides/database/connecting-to-postgres),
[PostgreSQL role creation](https://www.postgresql.org/docs/17/sql-createrole.html).
