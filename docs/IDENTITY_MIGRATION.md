# Identity migration preflight

Phase 4 starts with an administrator-run, read-only preflight. It inventories the
current installation and local users and checks explicit ID mapping proposals.
It does not change login, users, passwords, sessions, indexes or library data.

Run the inventory from the CineVault repository:

```powershell
npm run migrate:identity-links
```

The command uses the existing private MongoDB configuration. It accepts no URI
argument, prints no password or email, imports no application models and performs
no automatic collection/index creation. `--help` explains usage without connecting.

To check a proposed mapping, create a JSON manifest outside tracked source:

```json
{
  "schemaVersion": 1,
  "migrationId": "004_supabase_identity_links",
  "serverInstanceId": "11111111-1111-4111-8111-111111111111",
  "links": [
    {
      "localUserId": "aaaaaaaaaaaaaaaaaaaaaaaa",
      "supabaseUserId": "22222222-2222-4222-8222-222222222222"
    }
  ]
}
```

These are synthetic examples. Obtain actual stable IDs through the administrator
workflow. Do not put passwords, tokens, private connection strings or email-based
matching instructions in a manifest. The operator must review identity ownership;
the preflight does not contact Supabase or prove that the operator owns an account.

```powershell
npm run migrate:identity-links -- --manifest runtime/identity-links.json
```

The manifest must identify this exact installation. Version 1 permits only the
documented fields and canonical lowercase ObjectId/UUIDv4 identifiers. Duplicate
local/cloud IDs, case-insensitive duplicate emails, missing users, conflicting
existing links and unknown/inconsistent user schema states block the proposal.
An identical existing supported mapping is reported as `already_linked`.

Local legacy users have absent `authSchemaVersion` (interpreted as version 1).
The proposed future linked state has `authSchemaVersion: 2`, `supabaseUserId`, and
`identityMigration: { id: "004_supabase_identity_links", version: 1,
serverInstanceId: "..." }`. This document defines that contract; this preflight
does not deploy user fields or apply the transition.

Output is `inventory_only`, `proposal` or `blocked`. Exit codes are 0 for a valid
inventory/proposal, 2 for detected blockers and 1 for configuration/input/read
failure. A successful proposal always has `cloudIdentityVerified: false` and
`cutoverReady: false`. Its SHA-256 snapshot fingerprint supports comparison; it
is not a database lock, executable write payload or authorization proof. Reads
are not a transactionally frozen snapshot of a running installation.

Inputs are bounded to 1 MiB/10,000 proposed links and 50,000 inventory users;
database selection and reads have five-second limits. Reports contain stable
identity IDs, so keep actual reports private. No report is saved automatically.
`--apply`, URI arguments and unknown flags are rejected before connecting.

Before any future apply/cutover: verify current cloud identity and enabled server
membership, review exact local mappings, back up and prove restoration, re-read
current state with compare-and-set/unique ownership guards, record a durable
versioned migration result and qualify rollback. Existing role, approval, bans,
history and watchlist remain local authority. Clearing test users/sessions and
switching Supabase-primary login require their own concrete execution boundary.

## Local session exchange

An installation can test an existing version 2 link through
`POST /api/v1/auth/exchange`. The experimental server switch is
`CV_AUTH_EXCHANGE_ENABLED=true`. This switch binds the server listener to
`127.0.0.1` for direct testing on the server PC. Keep the listener private
and outside tunnel and reverse proxy forwarding during this test. Use the
existing control-plane project and publishable key configuration.

Send the Supabase access token in the Authorization bearer header on an
empty POST. CineVault checks the token with the configured Supabase Auth
endpoint and reads current membership under the same user's row-level
permissions. Membership must match the installation and an approved,
unbanned local user with exactly one stored link for that subject.

The response supplies a revocable CineVault access token and an
`expiresAt` Unix timestamp in seconds. The local token expires within
five minutes or at the upstream expiry, whichever comes first. CineVault
checks the current link and local account on each authenticated request.
Existing cloud-backed sessions carry the membership download grant
until expiry. Stream tickets share the parent session's expiry and
revocation checks. Cloud-only logout or membership changes take effect
on the next exchange, with the local expiry bounding previously issued
sessions. A local session can also be revoked through the existing
session administration.

The pilot covers ordinary account and media access. Administrator routes
and local password changes require a legacy CineVault session during the pilot.

Live testing requires a verified stored link and enabled membership.
The preflight reports candidate links for review. Applying links,
validating real-account exchange, and switching the sign-in UI are
subsequent rollout steps.
