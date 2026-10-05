# CineVault pairing/configuration protocol model

This is an isolated research prototype, not a server feature or deployable broker.
Nothing in application startup, login, routes or frontend imports it. There are
no network calls, file writes, Supabase packages, users or cloud mutations.

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
