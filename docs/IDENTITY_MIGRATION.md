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
The linked state has `authSchemaVersion: 2`, `supabaseUserId`, and
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

Before cutover, verify a real account exchange and rehearse rollback. Existing
roles, approvals, bans, history and watchlists remain under local authority.

## Local session exchange

An installation can test an existing version 2 link through
`POST /api/v1/auth/exchange`. The experimental server switch is
`CV_AUTH_EXCHANGE_ENABLED=true`. This switch binds the server listener to
`127.0.0.1` for direct testing on the server PC. Keep the listener private
and outside tunnel and reverse proxy forwarding during this test. Use the
existing control-plane project and publishable key configuration.

For the sign-in screen, build the frontend with `npm run build:frontend`,
then open the direct backend URL `http://127.0.0.1:3000/login` on the server PC.
Choose **Supabase account** under **Sign-in method** and use the linked account's
Supabase credentials. The option appears when the direct backend reports pilot
availability. The browser keeps the CineVault session in memory for up to five
minutes. Reloading the page requires sign-in again. Use **Sign out** to end the
session on the server. A separate CineVault account option supports local sign-in.

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

### Administrator account controls

Open **Administration → Users** with a local administrator account. You can
create an approved standard local account, enable or disable access, reset a
local password, or sign a user out of all devices. Reset, disable and sign-out
invalidate previously issued CineVault sessions and media tickets for that user.
Sign-out allows a new login when the account is enabled. An administrator can
also remove a supported Supabase link from the account's **Manage** panel. That
removes cloud-backed CineVault access for the current link and preserves the
local account and its data.

Provision Supabase accounts and memberships separately. Apply new links through
the reviewed explicit-ID procedure below. The local password controls apply to
the CineVault password. Supabase passwords are managed in Supabase.

### Apply and roll back one account link

Review a manifest with exactly one explicit local/cloud account pair. Run
the read-only preflight and save its snapshot digest. Confirm the target
cloud user has enabled membership for this installation. Choose an operation
UUID and keep it with the manifest and preflight result.

Run the apply command with the target user's fresh Supabase access token
supplied as raw text on standard input by a private credential source.

```text
npm run migrate:identity-link-write -- apply <manifest-path> <snapshot-digest> <operation-uuid>
```

The command verifies the membership with Supabase, rechecks the reviewed
inventory, and creates the unique subject index. The account update writes
the link and a minimal before-image together with a journaled write. The
receipt includes the installation, local account, operation and link
generation IDs. Keep the receipt for rollback. After interrupted output, use
the read-only receipt command to recover those IDs before deciding to retry.

```text
npm run migrate:identity-link-write -- receipt <installation-uuid> <local-user-id> <operation-uuid>
npm run migrate:identity-link-write -- rollback <installation-uuid> <local-user-id> <operation-uuid> <generation-uuid>
```

Rollback restores the identity fields for the exact recorded link. It
preserves unrelated account edits and the uniqueness index. Existing pilot
sessions and media tickets lose access when their link generation disappears.
Validate exchange using the linked account before switching the sign-in UI.
