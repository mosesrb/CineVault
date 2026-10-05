# CineVault pairing/configuration protocol model

This is an isolated research prototype, not a server feature or deployable broker.
Nothing in application startup, login, routes or frontend imports it. There are
no network calls, Supabase packages, users or cloud mutations. The protocol
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
