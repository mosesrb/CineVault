# Cloud owner and installation provisioning

This is a prepared operator workflow, not an enabled account-registration screen.
`supabase/broker/provisioning.sql` is tested locally and is **not a tracked
migration or deployed change**. Existing local CineVault sign-in remains in use.

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
   migration history, role privileges and security advisors before applying the
   CLI-created, reviewed migration. The local candidate is
   `20261026045823_control_plane_broker_commissioning.sql`, not yet applied.
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

The prepared SQL creates `cv_control_broker_login` **NOLOGIN**, with no password,
no automatic inherited broker privileges, no superuser/role/database creation,
replication or RLS bypass, and a four-connection cap. Its sole membership permits
explicit `SET LOCAL ROLE cv_control_broker`, without ADMIN or INHERIT options.
The existing broker driver already uses that transaction-local role and its
allowlisted private functions. The login has no owner-provisioning permission.
Existing role names cause SQL to fail rather than overwrite an unknown role.

After separate exact approval, a trusted operator must generate a strong dedicated
password in a secure secret workflow, configure SCRAM authentication, enable LOGIN
and place only the dedicated connection URL in hosted function secret storage.
Never put a password/verifier in a migration, command argument, checked-in file,
ordinary PC environment or evidence. Copy the actual regional pool host from the
provider Connect dialog; do not guess its cluster index. The runtime requires
the custom `cv_control_broker_login.uouydbapluktfrylligo` shared-pool username,
transaction port6543, certificate-verified TLS and prepared statements disabled.
Test actual pool authentication, transaction-local role reset and effective
permissions before enabling the broker. The disposable loopback fixture uses
trust authentication and does not qualify production passwords, TLS or Supavisor.

Profile/install provisioning issues no enrollment grant, operational credential,
cloud server, membership, endpoint or ONLINE status. The separate owner approval
and durable PC enrollment still have to run. Provisioning does not transfer
ownership or repair a disabled/corrupt mapping; investigate and authorize an exact
maintenance operation instead of changing rows or resetting the local identity.

## Remaining commissioning gates

The first proposed hosted step is **database preparation only** in project
`uouydbapluktfrylligo` (`ap-southeast-2`): apply the CLI-created migration above,
SHA256 `89db474fbaff9874d33182f53394654e7f5cd9ad58db5a5cc17da7784f131c42`.
It bundles the existing five broker SQL sources in one transaction. Local tests
compare the resulting functions, tables, constraints, columns, grants and roles
with sequential source application, and prove a late role conflict rolls back
all new objects. Unknown existing role/schema objects must fail rather than be
adopted or overwritten. Inspect hosted migrations/schema/advisors again when
the resumed project is ready before applying the approved candidate.

This step creates only private broker objects, quota state and the passwordless
NOLOGIN role. It does not create an Auth user, bind an installation, enable LOGIN,
issue a password, deploy a function or page, or enable local cloud integration.
Those operations require subsequent exact commissioning approval. Never apply
the five standalone preparation files a second time after this migration.

Permanent Auth user creation/selection, actual binding and hosted login activation
have not been performed. Exact free Pages origin, password-vs-PKCE protocol,
credential lifetime/admission policy, CLI migrations/deployment and hosted
enrollment/activity/outage/pause recovery remain required. No artificial keepalive
or premium plan is introduced. Device and release qualification are separate.

References: [Supabase users](https://supabase.com/docs/guides/auth/users),
[database roles](https://supabase.com/docs/guides/database/postgres/roles),
[database connections](https://supabase.com/docs/guides/database/connecting-to-postgres),
[PostgreSQL role creation](https://www.postgresql.org/docs/17/sql-createrole.html).
