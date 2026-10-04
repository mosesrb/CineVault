# CineVault control-plane foundation

This folder prepares identity, membership and endpoint discovery only. It does not
move media, history or fine-grained authorization out of CineVault. Nothing here
automatically connects to or migrates a hosted Supabase project.

## Local identity

After MongoDB is ready, normal server startup atomically initializes a singleton
`server_identity` record with a random UUID, schema version, name and creation
date. Repeated starts preserve it. Invalid existing records fail startup rather
than silently rotating identity. `GET /api/v1/identity` (legacy `/api/identity`)
returns only `serverId` and `schemaVersion`, without authentication or caching;
missing/unavailable identity returns a generic503 and GET never initializes it.

The additive operator migration is `npm run migrate:identity` (read-only check),
or `npm run migrate:identity -- --apply` (initialize/preserve). Startup performs the
same initialization before listening; users, media and current login stay intact.
Back up MongoDB including this collection. A restored backup retains its identity;
a clone intended to be a different server needs an explicit re-identification
workflow, not an automatically generated new UUID. No reset endpoint is provided.
An ID is not a secret or a cryptographic ownership proof. Endpoint validation must
still use TLS and a trusted expected identity; signed challenges remain future work.

`servers.id` is the cloud record ID; `servers.server_instance_id` maps to the local
`serverId`. Their equality is not assumed by the runtime.

## SQL security boundary

`migrations/20261004161756_control_plane_foundation.sql` creates the four tables
with RLS and explicit grants in one transaction. It intentionally fails if an
object already exists; migration tracking, schema inventory and review precede
any deployment, rather than overwriting an existing installation.

The additive `20261004161817_control_plane_hardening.sql` indexes the owner foreign
key and revokes PUBLIC/anon/authenticated execution of an existing
`public.rls_auto_enable()` event-trigger function. It leaves its body, owner and
trigger unchanged; projects without this optional helper are supported. An
unexpected function return type stops deployment for inspection.

The owner-approved hosted deployment used MCP migration tracking, which assigned
versions `20261004161756` and `20261004161817`. Filenames now match that observed
history; foundation SQL is unchanged from its original `20261004000100` version.
The hardening file was generated with pinned CLI2.119.0 before deployment, then
renamed from `20261004161210` to the actual hosted version. Do not reapply either
file to this project; verify remote migration history before any future CLI push.

- Profiles: authenticated users read their own profile, including blocked status.
- Memberships: unblocked users read only their own assignments; disabled users can
  see their own disabled assignment but cannot discover server/endpoint rows.
- Servers: only enabled, unblocked members read assigned-server status.
- Remote endpoints: additionally require `remote_stream_allowed`, ONLINE and a
  verification timestamp. URLs are untrusted until TLS/expected-server verification.
- All client writes are denied, including ADMIN/owner membership. No self-service
  role, approval, block, password flag, heartbeat, endpoint or generation changes.

A non-exposed private-schema, fixed-search-path helper checks current membership
and profile state. Default function/table privileges are explicitly revoked.
`service_role` is reserved for trusted control-plane provisioning, not a normal
client or a credential distributed to every server PC. A narrowly scoped server
registration/heartbeat design must be reviewed separately; this foundation does
not enforce generation compare-and-set, register servers or emit heartbeats.
The endpoint URL constraint checks shape, not network safety or ownership.

No auth.users trigger, initial administrator, actual account, server registration
or user cutover is created. Missing profiles/subjects cannot discover anything.
Supabase free-tier inactivity handling remains future work: real registration/
heartbeat and normal recovery, never synthetic traffic to avoid pausing.

Before deployment, verify `cinevault_private` is excluded from the effective Data
API exposed schemas; an empty database role-setting query is not proof. Signed-out
`anon` and anonymously signed-in Auth users are different: the latter use the
`authenticated` role. Provisioning must decide eligibility explicitly; this
foundation does not create profiles or memberships automatically.

## Tests

```
npm ci --prefix supabase/tests --ignore-scripts
npm run test:control-plane
npm run verify:web
```

The isolated test package pins PGlite0.5.8, PostgreSQL compiled to WASM, and is not
a runtime/frontend dependency. It runs the actual migration/grants/RLS against
synthetic rows and roles in memory, using `tests/bootstrap.sql` to simulate
`auth.uid()`. That bootstrap is TEST ONLY and must never be applied remotely.
This proves local SQL semantics, not hosted Supabase Auth/JWT/PostgREST behavior,
real project schema compatibility or production deployment. Re-run against a
disposable Supabase environment before accepting the hosted gate. Ordinary Jest
integration tests exercise MongoDB singleton races and a separate Node process.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[migration workflow](https://supabase.com/docs/guides/local-development/database-migrations),
[PGlite API](https://pglite.dev/docs/api).
