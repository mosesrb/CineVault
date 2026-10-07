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

Runtime entry/secret provisioning/Pages origin, admission limits across isolates,
effective headers/CORS and real hosted pool/Deno/Auth/concurrency qualification
remain commissioning gates. No arbitrary SQL proxy or automatic owner bootstrap.
Rotation/recovery/expired-grant cleanup are not implemented by a destructive reset;
they need explicit owner-authorized flow preserving server identity/epochs. Existing
login/users stay unchanged, and no media/tunnel traffic enters this broker.

References: [Supabase database connections](https://supabase.com/docs/guides/functions/connect-to-postgres),
[Postgres.js transactions](https://github.com/porsager/postgres#transactions),
[function authentication](https://supabase.com/docs/guides/functions/auth),
[session revocation](https://supabase.com/docs/guides/auth/sessions).
