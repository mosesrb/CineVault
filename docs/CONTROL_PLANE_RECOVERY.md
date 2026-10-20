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

## Stop and escalate: no automatic repair/import facility

These cases intentionally have **no self-service recovery operation** yet:

- Protected file/directory missing after prior enrollment, invalid JSON/schema,
  unexpected ACL/link/hardlink, orphan temporary state or untrusted restore.
- Unknown/mismatched installation, cloud mapping, owner, credential ID or epoch.
- An issued candidate expired or was revoked before its mapping was saved locally.
- Initial grant missing/disabled while a cloud mapping already exists, or state
  cannot prove whether an earlier enrollment occurred.

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
5. Stop here until an exact identity-preserving restoration/rebinding design,
   protected-storage method and affected-row approval have been reviewed. No
   manual SQL/JSON recipe, new owner bootstrap or secret import is provided by
   this runbook. These unresolved cases remain commissioning gates.

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
