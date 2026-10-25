# Cloud control-plane recovery

This is the runbook for the **prepared, default-off** Phase 3 control plane.
The hosted broker, owner approval page and their private installation bindings
must be commissioned separately before enabling it. Existing local login,
users and media are independent; cloud recovery does not migrate them.

## Rules that apply to every incident

- Keep the permanent CineVault instance UUID. Never delete the MongoDB identity,
  reset credentials, create a second cloud server, or adopt an arbitrary mapping
  to make a status message disappear.
- Preserve the protected state directory, its ACLs, pending operations and any
  temporary files. Do not edit JSON, relax permissions, import a copied secret,
  or delete an apparent orphan. A stale second process must stop, not overwrite.
- Never send passwords, state files, polling capabilities, operational secrets,
  project/service-role keys or database passwords in chat, logs or support tickets.
  Setup request/proof belongs only on the exact commissioned owner-approval page.
- Local ADMIN/session/CSRF authority starts recovery; a separate current cloud
  owner authorizes enrollment/replacement. Neither substitutes for the other.
- Do not run a keepalive cron, artificial requests or idle heartbeat to avoid
  free-tier pausing. Retry only real work or an explicit administrator action.

## Supported recovery paths

| Observed condition | Action | Required result |
| --- | --- | --- |
| Cloud disabled | Leave it disabled until commissioning gates pass. | Local login/media continue independently. |
| Temporary outage or rate limit | Allow bounded work-triggered retries; after service restoration use **Retry cloud recovery**. | Same durable heartbeat/outbox, not a new operation. Respect retry delay. |
| Explicit project-paused response, or pause confirmed in dashboard | Owner resumes the **existing** Supabase project in its dashboard, waits for restoration, then retries. A generic network failure alone is not proof of pause. | Existing project/instance/mapping retained. No plan upgrade or re-created project. |
| Setup awaiting owner, challenge still valid | Prepare one-time setup to redisplay the same request, approve it on the trusted page, then **Check owner approval**. | No new candidate or background polling timer. |
| Initial setup challenge expired, intact pairing state | Confirm and choose **Prepare owner recovery**, approve the new challenge on the trusted page, then check approval. | Same instance, candidate credential ID, secret and polling capability; fresh pair ID/idempotency/expiry/proof. No proof returned before durable save. |
| Enrollment/replacement reply lost, challenge still valid | Check owner approval again, including after normal restart. | Exact saved candidate/request; one mapping or one replacement epoch, unchanged lifetime. |
| Enrolled credential expired/revoked; intact active state | Confirm and prepare owner recovery, approve the exact replacement, then check approval. | Old cloud activity pauses; same instance/cloud server/user/membership identities; new operational credential, epoch old+1. |
| Replacement challenge expired, intact previous/candidate envelope | Prepare owner recovery, obtain fresh owner approval, then check approval. | Keep both saved credentials and previous mapping. If candidate already issued and still valid, recover it with no second epoch or lifetime extension. |

Keep the owner approval page signed in until redemption succeeds: current owner,
session, profile, installation and grant are rechecked. Use its explicit Finish
action afterwards; closing a tab is not proof of server-side sign-out. Initial
grant renewal may use a fresh current owner session. A live different approval
cannot be overwritten. Old challenge bodies/proofs cannot redeem the new grant.

An initial renewal can reconcile only the **same still-valid initial credential**
(epoch 1). It cannot revive an expired/revoked/superseded credential. A disabled
grant, changed installation owner, missing profile, banned/blocked user or missing
session denies recovery. Do not repeatedly reset setup in response to these denials.

## Explicit disaster restore: missing/damaged state or invalid interrupted issue

Use **Prepare disaster restore** in the local ADMIN control-plane page only when
ordinary recovery cannot reconcile the saved state. This is a fresh operational
rotation, not an import of old secrets, identity reset or automatic repair.

1. Obtain this PC's permanent `serverId` from `/api/v1/identity`. Separately verify
   its existing cloud-server UUID in the intended owner's `servers` record. These
   are different identifiers; the Supabase project reference is neither one.
2. Enter both identifiers, confirm the warning, and prepare disaster restore.
   Safe readable original bytes (including malformed JSON) are preserved in a
   protected `state.recovery.<sha256>.json` archive before the new candidate is
   saved. Missing state creates no fabricated backup. No proof is shown before
   durable persistence; old cloud work pauses. Local login/media are unchanged.
3. On the separate trusted owner page, sign in as the existing cloud owner and
   separately confirm both instance and cloud-server IDs. Approve the restore
   request. No current operational secret, editable metadata or local administrator
   alone can authorize it. The server/mapping must already exist under that owner.
4. Check owner approval on the PC. Cloud SQL freezes the actual current credential
   ID/epoch at approval and rotates it exactly once at redemption. An expired or
   revoked **old** credential can be replaced; an invalid already-issued **new**
   candidate cannot be revived. Duplicate/lost-response retries retain the same
   mapping, new epoch and lifetime while the grant/current owner session is valid.
5. Reopening a still-valid saved restore shows the same candidate. If that short
   grant expires, explicitly preparing disaster restore again stages fresh keys
   and requires new owner approval. This may perform another intentional rotation
   if the earlier candidate was issued; it is not the ordinary same-key renewal
   flow. A live different enrollment/replacement/restore grant conflicts rather
   than being silently overwritten. Owner revocation cancels grant authority
   immediately, but does not change a live saved local restore candidate: wait
   for its expiry before preparing fresh keys. Never delete state to bypass it.

The same existing cloud server, permanent instance, users and memberships are
preserved. Old operational proofs/receipts and grants are invalidated when the new
issue commits; endpoint verification is withdrawn, never asserted by restore.

Archives contain sensitive old credentials, are owner/SYSTEM ACL-protected (not
encrypted), and are never sent to the browser or automatically deleted. At most
eight distinct originals are retained; further staging stops for explicitly
approved operator maintenance. Do not restore an archive over a newer active
credential or use it as an arbitrary import facility.

## Stop and escalate: filesystem or ownership trust failure

Unexpected ACLs/reparse points/hardlinks, invalid UTF8, oversized state, orphan
temporary files, untrusted archives or exhausted archive retention remain blocked.
No missing cloud mapping, wrong owner or mismatched known cloud-server ID can be
adopted by this flow. Never relax guards to bypass a denial.

1. Stop cloud retries and leave control-plane configuration disabled during
   investigation; change configuration/restart only through an authorized normal
   maintenance window. Do not stop or reset the media database for this purpose.
2. Preserve local evidence in place without exporting secrets. Record only status,
   timestamps, known permanent instance/cloud-server identifiers and which last
   acknowledged operation is known. Mark missing facts unknown.
3. A trusted operator checks current installation owner/profile/session, mapping,
   credential epoch/revocation/expiry and outstanding grants in the private hosted
   control plane. This is read-only diagnosis, not authority to edit those rows.
4. If exposure is suspected, obtain scoped approval to revoke the exact cloud
   credential/grants and withdraw its endpoints. Do not delete users, memberships,
   the server or its permanent identity. Revocation alone does not restore state.
5. Stop here until the specific filesystem/ownership problem and exact proposed
   maintenance have been reviewed/approved. No manual SQL/JSON recipe, ownership
   transfer or secret import is provided. Recovery implementation is prepared,
   not proof of actual hosted commissioning or OS power-loss durability.

## Verification and completion

Confirm the same instance/cloud-server identifiers, expected credential epoch,
current expiry and absence of duplicate mappings. Confirm local login/media still
work. A broker acknowledgment is **not** proof of public HTTPS reachability:
endpoint identity/TLS verification and discovery publication are separate work.

Record actual commands, candidate commit and observed results, including failures.
Synthetic PostgreSQL/WASM, local driver and emulator tests do not establish hosted
Auth/Supavisor/Edge Runtime parity, physical-TV support or release qualification.

Before deployment, approve the exact owner/bootstrap/install binding, dedicated
hosted login/secret storage, Pages origin/password-vs-PKCE choice, credential
lifetime, admission limits and CLI-generated migrations. Never put hosted
privileged credentials or owner refresh tokens on the CineVault PC.
