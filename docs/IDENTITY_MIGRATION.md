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

### Opt-in HTTPS browser pilot

Set `CV_AUTH_EXCHANGE_ENABLED=true` and `CV_AUTH_EXCHANGE_HTTPS_ORIGIN` to the
exact HTTPS origin browser clients will visit. Set `CV_AUTH_EXCHANGE_TLS_CERT_FILE`
and `CV_AUTH_EXCHANGE_TLS_KEY_FILE` to the local PEM certificate chain and key.
The certificate must be trusted by the browsers and valid for the hostname.
The HTTPS origin's port must differ from the existing HTTP listener port.
Use the HTTPS listener directly. Forwarding headers are rejected for exchange
and cloud-bound sessions. The ordinary HTTP listener still serves local account
sign-in. To restore the direct loopback pilot, unset the HTTPS origin and TLS
file settings and restart. To disable all cloud sign-in, turn off the pilot flag.

On the HTTPS browser pilot, the sign-in selector appears after the same-origin
capability check succeeds. Completing a required password change also needs this
exact HTTPS origin on the hosted Account Admin allowlist.

For Android phones and Android TV, also set `CV_AUTH_EXCHANGE_ANDROID_ENABLED=true`.
Configure the app's server address as the exact HTTPS origin, including its port
when applicable. The app shows Supabase sign-in after that server advertises the
capability and sends local session requests only to the selected HTTPS origin.
The server accepts the Android app's `https://localhost` WebView origin only on
the configured direct TLS listener. Android temporary-password changes in the
app require `https://localhost` on the hosted Account Admin allowlist. Users can
also finish the password change in an approved browser before signing in on Android.

The response supplies a revocable CineVault access token with `issuedAt` and
`expiresAt` as Unix timestamps in seconds. The browser measures elapsed time
using that server-issued lifetime. The local token expires within five minutes
or at the upstream expiry, whichever comes first. CineVault
checks the current link and local account on each authenticated request.
Existing cloud-backed sessions carry the membership download grant
until expiry. Stream tickets share the parent session's expiry and
revocation checks. Cloud-only logout or membership changes take effect
on the next exchange, with the local expiry bounding previously issued
sessions. A local session can also be revoked through the existing
session administration.

The pilot covers ordinary account and media access. Administrator routes
and local password changes require a legacy CineVault session during the pilot.

### Before making Supabase the default

- Have a reviewer independently check the identity mapping, session revocation,
  backup and restore rehearsal, and cutover rollback procedure.
- Implement and verify sign-in, sign-out and recovery on Android phones,
  Android TV and browsers connecting from another device. The current pilot
  is qualified on the server PC's browser.
- Define and verify the administrator workflow for cloud account creation,
  membership changes and password resets. Email recovery is deferred.

### Administrator account controls

Open **Administration → Users** with a local administrator account. You can
create an approved standard local account, enable or disable access, reset a
local password, or sign a user out of all devices. Reset, disable and sign-out
invalidate previously issued CineVault sessions and media tickets for that user.
Sign-out allows a new login when the account is enabled. An administrator can
also remove a supported Supabase link from the account's **Manage** panel.
Unlinking preserves the local account and library data and revokes sessions
that depend on the removed link.

### Hosted Supabase account administration (`CV-P4-5`)

Hosted account administration separates installation-scoped membership from
project-wide Supabase identity credentials:

1. **Installation Membership (`public.manage_server_member`)**: Only the
   authenticated installation owner (`auth.uid()` verified against a live
   `auth.sessions` row and `cinevault_private.cp_installations.owner_id` via
   `cp_owner`) or a verified schema operator
   (`cinevault_private.cp_operator_upsert_server_member`) can grant, update, or
   disable `public.server_users` membership for a specific CineVault
   installation. An installation owner cannot create Supabase accounts or reset
   project-wide Supabase passwords.
2. **Project-Wide Account Creation, Password Resets & Required Password-Change Flow (`cinevault-account-admin`)**:
   Only a verified Project Administrator listed in
   `cinevault_private.cp_project_admins` can invoke `admin-create-user` or
   `admin-reset-password` on the dedicated `cinevault-account-admin` Edge
   Function. When a linked user with `public.profiles.must_change_password =
   true` signs in on `http://127.0.0.1:3000/login` with their temporary
   password, `POST /api/v1/auth/exchange` returns HTTP `403` with
   `{ "error": "password_change_required" }` (without issuing a CineVault
   session), and the login form prompts for a new password (`12..72` UTF-8
   bytes). Submitting the form authenticates the temporary password, invokes
   `complete-password-change` on `cinevault-account-admin` to clear
   `must_change_password = false` and revoke temporary `auth.sessions`, and
   completes a fresh sign-in and exchange with the new password. Because
   Supabase Edge Function secrets (`Deno.env`) are project-wide across all Edge
   Functions in `uouydbapluktfrylligo`, `cinevault-account-admin` uses
   dedicated `CV_ACCOUNT_ADMIN_*` secret names and connects to Postgres via
   `cv_account_admin_login` (`SET LOCAL ROLE cv_account_admin`), while
   `cinevault-control-plane` reads only `CV_BROKER_*` secrets and connects via
   `cv_control_broker_login` (`SET LOCAL ROLE cv_control_broker`). Neither the
   CineVault server PC nor client browsers ever hold
   `CV_ACCOUNT_ADMIN_SERVICE_ROLE_KEY` or database passwords.
3. **Password-Specific Reset Proof & Uncertain Write Blocking**: Every
   password write commits a pre-write claim (`cp_claim_password_write`) that
   locks the per-user reset row (`cinevault_private.cp_password_resets`),
   verifies the current `reset_id`, and issues a single-use `write_ticket`
   before calling the Supabase Auth Admin API. Neither normal sign-in hash
   rewrites on `auth.users.encrypted_password` nor unrelated `auth.users` /
   `public.profiles` updates can clear `must_change_password`. If an Auth Admin
   password write times out or returns an uncertain response, the service
   records `state = 'WRITE_OUTCOME_UNCERTAIN'`, keeps
   `must_change_password = true`, never retries automatically, and permanently
   blocks further password writes for that account until operator containment
   (`cp_quarantine_uncertain_account`) and clean replacement account
   re-linking.
4. **Access Termination Timeline**:
   - **New Supabase password sign-ins**: Blocked as soon as the Auth Admin
     password write completes (or when the account is quarantined).
   - **Already-issued Supabase tokens at `POST /api/v1/auth/exchange`**:
     Blocked immediately when `cp_begin_password_reset` or
     `cp_complete_password_change` deletes `auth.sessions` rows and sets
     `must_change_password = true`, or when `public.manage_server_member` sets
     `server_users.enabled = false`. Neither pre-reset tokens nor
     temporary-password tokens can obtain a CineVault session after
     `must_change_password` clears.
   - **Active CineVault sessions & stream tickets**: Bounded by their 5-minute
     (`300s`) TTL on cloud-only membership disable or password reset, or
     terminated immediately when a local administrator invokes
     `POST /api/v1/users/:id/revoke-sessions` (which revokes all local and
     cloud-backed sessions for that `User._id`) or unlinks the cloud generation
     (which revokes only sessions for that `cloudLinkGeneration`). An
     already-open HTTP media stream response continues only for the bytes of
     that single in-flight HTTP range request; the next HTTP range request,
     HLS segment request, or API call runs `middleware/auth.js` and is rejected
     with `401 Unauthorized` once the session expires or is revoked.

### Apply and roll back one account link

Before a wider migration, stop application writes while taking the MongoDB
backup with `npm run backup:mongo`. The backup includes private user and session
records. Keep it in restricted storage. Rehearse `npm run restore:mongo` with
`--source`, `--uri` and `--database` against an empty isolated target. Run the
dry run first to validate file hashes and document counts, then repeat with
`--apply`. Compare the restored preflight digest and verify indexes and account
data before considering a cutover. Use the link-specific rollback below for an
individual link. A full restore can bring older sessions and authorization
state back. Before serving a fully restored database, rotate the local JWT
signing key and invalidate the restored sessions.

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
