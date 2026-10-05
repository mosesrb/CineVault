# CineVault pairing/configuration protocol model

This is an isolated research prototype, not a server feature or deployable broker.
Nothing in application startup, login, routes or frontend imports it. The pairing
model has no network calls, Supabase packages, users or cloud mutations. The protocol
model itself has no filesystem calls; the separate Windows storage research
adapter below writes only to an explicitly supplied directory beneath this
checkout's ignored `runtime/` root; neither interface admits tracked/outside paths.

Run `node --test supabase/tests/pairing.test.js`. The normal control-plane test
gate also runs it. Node built-ins only; no new dependency or lockfile change.

Proposed handoff: an authenticated local administrator initiates setup, the PC
durably saves two independent random 256-bit secrets plus the exact pending
operation, then submits only their digests and installation binding. The human
visits a trusted hosted approval page, signs in there, and explicitly compares
the installation challenge/identity against their local admin UI. The PC polls
over TLS with a separate short-lived pairing capability; only a non-secret
mapping is returned. The durable operational secret never needs to be returned
by the broker. No owner Auth token or arbitrary local callback URL is needed.

This is inspired by the separated-device approval pattern in
[RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html), **not** an OAuth device
grant implementation or a claim that Supabase supplies that grant. PKCE, where
applicable to hosted owner login, stays in that browser: Supabase requires its
code exchange to use the initiating browser's verifier.
[Supabase PKCE documentation](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
Strict sensitive-operation checks must include current session authority, not
only a signed JWT. [Supabase sessions](https://supabase.com/docs/guides/auth/sessions).

The executable model tests configuration confinement, stable pending identity,
lost responses, local acknowledgment failures, expiry, rate limits, explicit
approval, current authority denial, clone conflicts and malformed responses.
Approval/checkOwner and writeAtomic are **injected test adapters**, not real
ADMIN/CSRF/session/bootstrap/ownership checks or atomic protected disk storage.
The simulator uses synchronous in-memory maps, not Postgres locking or RLS.
An active local mapping is not evidence its cloud credential is still valid.
No operational authentication, heartbeat, endpoint verification or discovery
freshness is implemented here. The simulator revoke method is a fixture control,
not an externally exposed credential-revocation API.

Before integration: real trusted hosted UI and exact login redirect/state/nonce
checks; local ADMIN + CSRF and meaningful pairing comparison/proof; rate-limited
human approval and polling admission; durable owner/SYSTEM-only ACL storage with
atomic write/fsync/crash recovery and interprocess serialization; authoritative
session/profile/owner bootstrap; private transactional replay/revocation guards;
bounded retained grants/cleanup; transport timeouts/backoff; specialist/prerequisite
acceptance and exact owner-approved deployment. This prototype intentionally
does not solve those production boundaries with boolean body fields.

## Windows protected-state research adapter

`protected_state_store.js` calls the fixed local PowerShell helper using stdin,
never secret command-line arguments. `ProtectedState.cs` creates a new NTFS
directory and files with explicit protected owner/SYSTEM-only DACLs **at creation**,
then checks ACLs, owner, reparse flags and file link count before reading/writing.
Existing unsafe permissions fail closed without automatic repair. Every existing
ancestor is pinned without DELETE sharing during the operation; junctions and
symlinks are refused. File data is bounded to16KiB, flushed with WriteThrough and
Flush(true), then replaced on the same volume with no backup/metadata-error bypass.
Only pending-to-active or identical updates are allowed; no implicit rotation.

An exclusive protected lock file serializes native operations across processes;
a digest compare-and-set rejects stale coordinators between separate reads and
writes. The adapter does not hold a lock across network activity or guarantee
one entire application coordinator. A concurrent caller gets a sanitized error,
not indefinite waiting or automatic identity reset. Unexpected `state.tmp` is
preserved and blocks adoption: an interrupted initial write cannot silently create
a second pending credential. Explicit owner recovery remains to be implemented.

Native tests use disposable ignored `runtime/qa/protected-store-tests/case-*`
directories and synthetic credentials only; exact owned roots are removed after
tests. Windows tests are explicitly skipped on other platforms, not equivalent
Linux/CI qualification. Run `node --test supabase/tests/protected_state.test.js`.
Tests kill a native child at creation/flush/replacement checkpoints; they do not
prove sudden power-loss durability, hardware cache behavior, unauthorized-token
access denial, every filesystem race, backup protection or protection from a
compromised owner/SYSTEM/admin. Owner/SYSTEM plaintext storage is not encryption.
The current app, .env, users, Mongo identity and hosted project remain untouched.

## Enrollment authorization research adapters

`enrollment_authority.js` is not imported by the app or a deployed function.
It uses the existing pinned jsonwebtoken library and trusted public ES256/RS256
keys, never token-provided key URLs or a Supabase project signing secret.
The static trusted key snapshot expires within five minutes; real fixed-origin
JWKS acquisition/rotation is still required before deployment. Authorization
also makes a bounded, no-redirect, no-cache Auth `/user` read at the configured
project, followed by an injected current-session/profile/owner-approval reader.
Neither token metadata nor a saved approval supplies current authority.

The current-row reader is a trusted contract, **not deployed SQL**. It must read
the exact signed subject/session, current unblocked profile and an enabled owner
approval bound to the complete pending request digest. No profile/owner bootstrap
is supplied. A preflight decision is not safe to cache or use after revocation:
the consuming private transaction must recheck these rows under its shared guard.
Current reader test fixtures and mocked Auth responses are not hosted acceptance.

The local gate verifies the existing access-JWT contract, then current user and
session rows; stream tickets/body ADMIN claims cannot provision. CSRF tokens are
short-lived/session-bound HMACs with a random nonce and per-process key. Exact
configured Origin/Host, same-origin fetch metadata, POST and JSON are required.
HTTP is allowed only for loopback origin; HTTPS is required otherwise. This is
not yet wired to existing auth/CORS/routes/UI, and is not an Auth cutover.

`challenge()` derives a separate approval proof using domain-separated HMAC of
the durable polling capability and full pending binding. Begin carries only its
digest, never the operational or polling secret. A future trusted local ADMIN UI
shows the proof; the hosted owner supplies it only on that trusted approval page.
Public UUID alone is not proof. This does not prove hardware honesty or establish
the first cloud owner, and it does not make broker grants transactional/single-use.
UI/PKCE/proof handoff, admission limits, private transactions, owner recovery,
specialist/prerequisite acceptance and exact deployment approval still precede
live enrollment. Run `node --test supabase/tests/enrollment_authority.test.js`.

## Disposable private enrollment transactions

`enrollment_transactions.sql` is explicitly **not a migration**. It uses a
test-only `cv_enrollment_lab` schema/NOLOGIN broker role and must never be applied
to the hosted project. Existing deployed migration bodies remain unchanged.
Run `node --test supabase/tests/enrollment_transactions.test.js`; PGlite executes
actual PostgreSQL transactions against disposable foundation/Auth-shape fixtures.

Trusted fixture provisioning supplies an installation owner, request-bound human
approval and at most five-minute one-use grant. No public grant issuance or owner
bootstrap is implemented. The consuming function locks the installation guard,
rechecks current Auth user/session/profile and exact approval/project/binding/
polling digest, then creates one OFFLINE mapping and digest-only credential. It
returns only non-secret mapping fields. Exact retry returns the same mapping
only while grant, approval/JWT, session, profile and credential remain valid.
Rollback consumes nothing; clone/second-grant conflicts never adopt or rotate.
The initial epoch=1/30-day credential lifetime is a research fixture choice,
not an accepted lifetime policy. No users/memberships/endpoints are created.

Owner revocation uses the same installation guard and current human authority;
it resolves the exact credential/server/owner mapping before mutation, refuses
foreign clone conflicts, revokes grants/credential and withholds that endpoint.
Current authority and wall-clock expiry are rechecked after later SQL steps;
expiry raises an exception and rolls back the operation. Ordinary clients
and service_role have no lab CRUD/EXECUTE, and the test broker has EXECUTE only
for consume/revoke, not the private current-owner helper. Definer functions are
private, explicitly revoke PUBLIC defaults and pin an empty search_path; RLS is
defense in depth, not a substitute for restricted grants. This NOLOGIN role is
not issued to a PC, nor is it a deployed broker credential.

SQL inputs are trusted adapter outputs: the future broker must detach/validate
the full request, verify raw capabilities using constant-time digest comparison,
verify human JWT/Auth claims and admission limits, and supply only those derived
bindings. Digest-only public requests would be unsafe. SQL bytea equality is an
internal consistency check, not constant-time capability authentication. The
existing JS adapter is not wired to these functions; tests use synthetic digests.
No real owner provisioning, Auth refresh/PKCE/UI, JWKS, grant retention/cleanup,
rotation/recovery, operational credential authentication, heartbeat or endpoint
publication is implemented. Do not expose this schema via PostgREST.

Native row locks retain current authority through consumption; use wall-clock
expiry after lock waits, not transaction-start now(). Lock installation first,
then user/session/profile, approval, grant and credential. Privileged Auth work
can deadlock with cascade operations: abort and bounded retry, never bypass.
No HTTP call belongs inside the transaction. PGlite has one connection; queued
tests do **not** qualify two-connection races, Auth lock interactions, cancellation,
hosted permissions/advisors or provider durability. Those plus specialist and
original prerequisite acceptance and exact deployment approval remain required.
[PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html)
and [Supabase current-session checks](https://supabase.com/docs/guides/auth/sessions)
inform this boundary, not a claim of provider qualification.
