# Hosted broker preparation — not deployed

This directory implements the narrow hosted SQL/HTTP/driver boundary for the
existing PC transport and trusted owner page. Nothing here is imported by the
ordinary CineVault server. It is **not commissioned** or a tracked migration;
the schema requires CLI-generated migration identity after review/qualification.
Do not deploy the disposable `scripts/prototypes` lab SQL instead.

The HTTP API accepts only approve/register/heartbeat. Human approval requires
exact configured Pages origin, signed fixed-project JWT, fresh Auth/user read,
explicit confirmed installation UUID/proof, then SQL-locked current user/session/
profile and privately provisioned installation owner. Editable metadata is ignored.
Registration verifies full pending HMAC with the private polling capability, then
matches the entire stored request. Replays require still-current grant and owner
session; expiration cannot be bypassed by cached mapping results. New mapping is
OFFLINE and creates no memberships/users/endpoints. Heartbeat authenticates only
the bound credential and updates server-received activity time, never ONLINE or
endpoint verification. All cached heartbeat results recheck revocation/current
owner/epoch/expiry; they do not advance time. Old sequences and same-key changed
bodies deny; new reports at most one/minute. Per-credential 30-day lifetime and
one/minute limit bound stored heartbeat rows to roughly43,201; one pairing per
installation. Thirty-day lifetime is an explicit **deployment policy candidate**,
not an approved rotation/lifetime policy. Owner-only SQL revocation uses the same
guard, withdraws endpoints and changes no media/user membership.

The dedicated `cv_control_broker` NOLOGIN role gets only five private EXECUTE
functions, no table CRUD/helper/core access; PUBLIC/anon/authenticated/service_role
cannot call them. The login role/password is a separate exact-approved hosted
provisioning step. No service-role/project key, DB password or owner refresh token
belongs on the PC/client. Driver URL is fixed to the intended project/regional
Supavisor transaction pool and dedicated login; TLS verifies certificates,
prepare=false/max2, bounded connect/statement/lock/transaction timeouts. Transaction
errors settle rollback, with no implicit retry or Promise.race around writes.
Late/lost COMMIT response is uncertain; replay the same durable operation.

`npm test --prefix supabase/tests` includes synthetic signed-JWT/HTTP and actual
PostgreSQL/WASM cases. Separately, `CV_QA_POSTGRES_PORT=<temporary loopback port>
npm run test:driver --prefix supabase/tests` exercises pinned Postgres.js against
a **fresh disposable PostgreSQL17 container only**. It refuses a database already
containing the private schema, uses synthetic Auth rows, and does not drop any
existing database. Without the port it explicitly skips, never qualifies a pool.
The internal transaction-adapter test seam accepts a trusted driver; production
must use the strict hosted factory. Lost-reply test deliberately discards a settled
commit response: it is not a real network break during COMMIT. Two-connection
guard tests exercise committed profile/session/credential revocation, not every
privileged Auth cascade/deadlock permutation. Request bodies have a five-second
side-effect-free read bound; trusted admission/runtime construction is still gated.

The prepared `supabase/functions/cinevault-control-plane` entry composes one
pool/verifier per isolate, exact provider-internal route and the existing guards.
It requires all five hosted `CV_BROKER_*` configuration values: ENABLED must be
literal `true`, PROJECT_REF fixed, DATABASE_URL the dedicated hosted pool secret,
APPROVAL_ORIGIN exact Pages origin and PUBLISHABLE_KEY a public key. Missing or
invalid configuration returns generic503 without opening a pool/provider request.
No secrets/config are returned or logged; ordinary PC/app imports remain unchanged.

Apply prepared `admission.sql` after `schema.sql` only in disposable tests until
an exact migration/deployment is approved. It adds one private RLS global counter
row and three counters per **already provisioned** installation, no arbitrary IP/
caller-key rows. A request consumes the shared120/minute budget before reading its
body; valid-shaped operations also consume4approve/10register/10heartbeat per
installation per minute, before expensive Auth or business transactions. Budget
transactions settle independently, so denied business work cannot roll back its
attempt. Clock regression denies rather than resetting quota. Each isolate has
only two active handlers/no queue; missing/exhausted state fails closed. These
limits are deployment candidates, not a guaranteed provider billing/DoS shield.
Attackers knowing an installation UUID can exhaust its pre-auth budget; global
exhaustion can deny legitimate work. Provider/gateway abuse controls and accepted
availability/cost limits still need explicit commissioning decisions. Denied
function invocations still consume provider resources. No idle timer/job runs.

Pinned Deno2.9.6 local qualification checks actual crypto/JWT and Postgres.js
role/bytea/JSON transport against a synthetic loopback fixture, not Supabase's
deployed Edge Runtime/Supavisor/TLS/Auth. `deno.json`/generated integrity lock are
function-local, npm packages pinned, Deno audit is separate from four npm audits.
CI prepares the same frozen check/audit/test step using an exact official action
commit; new workflow not yet pushed/run. Test driver env/network permissions are
named PG options plus the synthetic port/loopback, never unrestricted permissions.
The node suite adds actual SQL budgets/full composition and the separate driver
suite races global/per-install counters across real connections.

Secret provisioning/Pages origin, gateway settings/actual route compatibility,
effective deployed headers/CORS and real hosted pool/runtime/Auth qualification
remain commissioning gates. No arbitrary SQL proxy or automatic owner bootstrap.
Rotation/recovery/expired-grant cleanup are not implemented by a destructive reset;
they need explicit owner-authorized flow preserving server identity/epochs. Existing
login/users stay unchanged, and no media/tunnel traffic enters this broker.

References: [Supabase database connections](https://supabase.com/docs/guides/functions/connect-to-postgres),
[Postgres.js transactions](https://github.com/porsager/postgres#transactions),
[function authentication](https://supabase.com/docs/guides/functions/auth),
[session revocation](https://supabase.com/docs/guides/auth/sessions).
Runtime references: [function-local dependencies](https://supabase.com/docs/guides/functions/dependencies),
[gateway routing](https://supabase.com/docs/guides/functions/routing),
[resource limits](https://supabase.com/docs/guides/functions/limits).
