# CineVault control-plane setup and recovery

## Current implementation boundary

Local Phase 3 integration supplies a disabled-by-default cloud subsystem,
protected Windows/NTFS pending state and outbox, admin-only setup/status/retry
controls, and real-activity-triggered registration/heartbeat transport. It is
**not yet an end-to-end hosted enrollment service**. The trusted owner approval
page, hosted broker/private schema, exact owner provisioning and hosted
transaction/rotation/recovery qualification must precede enabling it.

Existing CineVault accounts, local login, Mongo readiness and media authorization
remain unchanged. Phase 4 authentication cutover and later endpoint discovery
are separate. The new page does not publish or validate remote endpoints.

## Configuration after reviewed hosted commissioning

Keep `CV_CONTROL_PLANE_ENABLED=false` until the exact deployment is approved,
performed and qualified. Ordinary users need no extra application. Setup is a
one-time server-owner browser action; Android/TV setup is not required.

| Setting | Contract |
| --- | --- |
| `CV_CONTROL_PLANE_ENABLED` | Omitted/empty/`false` disables all cloud/store work; only `true` opts in |
| `CV_CONTROL_PLANE_PROJECT_REF` | Exactly `uouydbapluktfrylligo` |
| `CV_CONTROL_PLANE_PROJECT_URL` | Exactly `https://uouydbapluktfrylligo.supabase.co` |
| `CV_CONTROL_PLANE_PUBLISHABLE_KEY` | `sb_publishable_…` routing key, never secret/service-role/DB credentials |
| `CV_CONTROL_PLANE_ADMIN_ORIGIN` | Exact browser origin, no path; HTTPS or HTTP loopback only |

Use the existing protected environment file/configuration procedure; never send
secrets in chat. Restart normally after configuration changes. Configuration
errors disable only cloud work, not local startup. Broker URL is derived from the
fixed project, not a browser-supplied URL or discovered endpoint.

The PC uses `http://localhost:3000/admin/control-plane` for loopback setup (or an
explicit HTTPS origin). Vite can rewrite Host; do not weaken exact Origin/Host
checks to accommodate that proxy. Use the built frontend on the server port.
The admin page intentionally ignores `cv_server_url`, remote APK base URLs and
offline caches. Local session/current administrator checks plus a short-lived
session-bound CSRF token protect every mutation.

## Enrollment contract

1. An existing approved local administrator opens Cloud status. Prepare creates a
   five-minute request and 256-bit operational/polling secrets under
   `runtime/control-plane`, with protected owner/SYSTEM ACLs before bytes. Secrets
   never enter MongoDB, frontend, URLs, argv, logs or governance documents.
2. Repeat Prepare returns the same saved request/proof, not new credentials.
   A separate trusted hosted page must obtain current cloud-owner approval for
   the exact project/installation/full request and proof. It is not yet deployed.
   The local page never receives cloud-owner passwords, access/refresh tokens or
   project privileged keys. Do not approve using public UUID alone.
3. Check owner approval sends the same persisted request plus polling capability
   over fixed-project HTTPS. A 202 `{pending:true}` response remains pending;
   there is deliberately no background polling. A validated mapping/credential
   expiry is atomically saved before any heartbeat is possible.
4. A lost response retains all pending identity/secret/idempotency fields. Retry
   the same operation. Once a pairing expires, stop for explicit owner recovery;
   never delete the file, generate another secret against an uncertain grant,
   adopt a restored clone or silently rotate the local identity.

Private state uses a native exclusive lock, digest compare-and-swap, restrictive
ACL validation, reparse/hard-link refusal and flush/atomic replacement. Corruption,
unexpected ACLs, orphan temporary files and stale separate writers fail closed;
there is no automatic repair. This is plaintext ACL protection, not encryption
or protection from a compromised owner/SYSTEM. Runtime backups must preserve
identity/credential pairing. Real power-loss/unauthorized-token qualification is
not established by native synthetic process tests.

## Activity and recovery

Startup may submit one health transition after an active credential exists.
Successful authenticated application responses trigger coalesced health reports,
at most once per minute. Anonymous requests, health checks and Cloud status
polling do not. There is no periodic idle timer, cron or artificial keepalive.

Heartbeat sequence/idempotency/body are durably saved before transport. Success
clears only the exact acknowledged operation; lost replies, cancellation and
restart keep it. Hosted mutations must lock/recheck the current installation,
digest, credential epoch, owner status and revocation on **every** mutation and
cached replay. Local preflight is not remote authority. Heartbeat acknowledgment
must match credential-bound server ID/epoch/sequence/key. It does not prove
endpoint TLS, freshness, reachability or ONLINE status.

Requests have a ten-second header/body deadline, bounded 16KiB JSON, no redirects
or cookies. Recovery has five attempts per genuine work cycle, full-jitter
exponential backoff starting at two seconds/capped at sixty, with bounded
Retry-After. It then stops until new genuine activity or explicit admin retry.
401/403 and conflicts stop automatic retries for owner reconciliation. Local
identity and outbox never auto-reset.

Unknown network/gateway failure means unavailable, **not known paused**. Only an
explicit application paused response yields dashboard-resume guidance. The PC
holds no project-management credential and cannot resume/upgrade a project.
Free-tier inactivity remains legitimate; no always-on reliability promise.

## Hosted wire contract (not deployed)

Fixed POST target: `/functions/v1/cinevault-control-plane`; publishable `apikey`
is routing, never authority. Registration carries `{operation:'register',
request, pollSecret}`; request fields match the existing v1 full-bound challenge.
Its successful response contains only `projectRef`, `serverInstanceId`,
`credentialId`, `cloudServerId`, `epoch`, `credentialExpiresAt` (integer epoch ms).
Heartbeat uses an `x-cinevault-credential` header and exact body fields
`operation`, `idempotencyKey`, `sequence`, `activity`, `projectRef`,
`serverInstanceId`, `credentialId`, `epoch`. Its acknowledgment contains only
`idempotencyKey`, `sequence`, `cloudServerId`, `epoch`, `receivedAt` (ISO timestamp).
Do not log credential headers, capabilities, proof, request bodies or owner JWTs.

No broad SQL/RPC/table proxy, client write policy, user mutation, endpoint
publication, Auth cutover or media relay belongs in this operational contract.
