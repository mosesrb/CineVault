# Release credentials: owner checklist

This is a preparation checklist. No key/password/token has been created, changed,
used for signing, revoked or published by preparing it. Current local sign-in,
installed apps and CI remain unchanged. Account/key operations need the owner's
approval for the exact target and distribution plan.

## What the repository establishes

- `frontend/android/app/build.gradle` reads four environment variables:
  `CINEVAULT_KEYSTORE_PATH`, `CINEVAULT_KEYSTORE_PASSWORD`, `CINEVAULT_KEY_ALIAS`,
  `CINEVAULT_KEY_PASSWORD`. Current source has no literal signing passwords.
- Historical Gradle revisions contain signing-password literals. No keystore
  appears in the inspected Android Git history. This establishes password
  exposure; it does not establish that the private signing key was published or
  that every external copy is safe. Do not copy historical values into this plan.
- CI assembles debug and processes the release manifest. It does not assemble
  or sign a release, publish npm packages, or reference npm auth/signing secrets.
  A passing debug job is not release-signing evidence.
- Gradle assigns release signing only when all four values are present. An
  unsigned release output is possible when configuration is missing. Never infer
  successful signing from a build exit code or an APK filename.
- Local APKs include an older, verifiably signed release file. Its build commit
  and actual distribution are unverified. Public certificate fingerprints can be
  recorded privately; they are not private keys or passwords.

## Owner decisions before any key change

Confirm the distribution history for `com.cinevault.app`, whether Play App Signing
is enabled, the role of each old key, and whether update/data continuity is
required. Also confirm whether the private keystore could have been copied.
Until those facts are known, no rotation branch is selected.

| Confirmed situation | Proposed route requiring exact approval |
| --- | --- |
| No release distributed | Prepare a fresh production key before first release; plan separately for existing debug-test installs. |
| Play upload key affected | Request an upload-key reset; preserve the Play-managed app signing identity. |
| Play app signing key affected | Review the supported Play key-upgrade route and older-device implications. |
| Sideloaded release already used | Assess supported signing lineage/device compatibility or an explicitly approved migration; do not promise ordinary in-place updates with an unrelated new key. |
| Distribution or key custody unknown | Gather owner/certificate evidence first. |

Changing a keystore password does not create a new signing identity. An upload-key
reset and app-signing-key replacement are different operations. See
[Android signing guidance](https://developer.android.com/studio/publish/app-signing)
and the [Play signing-key procedures](https://support.google.com/googleplay/android-developer/answer/9842756).

## Proposed key-creation and signing sequence

These are commands for a later approved owner-controlled signing session. They
have not been executed. The owner must approve a new destination, alias, key role,
backup custody and update plan. Do not overwrite or delete an existing keystore.

1. Choose a protected folder outside the checkout and shared/synced locations.
   Verify restricted filesystem access before writing key material. Retain old
   files securely until the owner approves their disposition.
2. For a fresh key, review this candidate command in an interactive terminal:

   ```text
   keytool -genkeypair -storetype PKCS12 -keystore "<approved-new-keystore>.p12" -alias cinevault-release-v2 -keyalg RSA -keysize 4096 -validity 10000
   ```

   Enter the password privately when prompted. Do not add password arguments,
   paste it into chat, or put it in source/history/logs. Use the password behavior
   required by the chosen keystore format; PKCS12 may use one password for both
   store and key. Record only the public certificate SHA256, alias, date and role.
3. Back up the new key and recovery information in owner-controlled protected
   storage. Confirm the backup is usable through an approved private check.
4. Set the four existing Gradle variables through a protected, temporary signing
   session. Inspect neither their values nor the environment in build logs. Use
   fresh secrets; do not reuse historical exposed passwords. No release secrets
   are currently provisioned by this checklist.
5. After web/native inputs and the release version are approved, build from the
   identified commit with signing configured. A future command candidate is:

   ```text
   gradlew.bat :app:assembleRelease --no-daemon --no-configuration-cache --console=plain
   ```

   Run from `frontend/android`. Existing local Gradle limitations remain unresolved;
   a future CI signing job needs its own protected-secret/environment approval.
6. Independently verify the resulting APK using the installed Android SDK:

   ```text
   java -jar "<Android-SDK>/build-tools/36.1.0/lib/apksigner.jar" verify --print-certs "<approved-release.apk>"
   ```

   Require a valid signature, the approved new public certificate, expected package
   and version, and no unintended debug signer. Record the APK hash and source
   commit. A public certificate is identification, not proof of private-key custody.
   Follow [apksigner verification](https://developer.android.com/tools/apksigner).
7. Test the explicitly approved upgrade/install and data-preservation route on
   representative phone/TV devices. Do not automatically uninstall existing apps,
   change package IDs, install an APK or publish a release to finish this checklist.

## npm token disposition

The inspected project/user/Node-global `.npmrc` locations and inspection-process
`NPM_TOKEN`/`NODE_AUTH_TOKEN` variables contain no credentials. This does not prove
account-side revocation or exclude other custom configurations/processes.

The owner must identify the account and exact old token using nonsecret metadata
such as its dashboard name/ID, creation/expiry date and permissions. Do not replay
the historical token, create a replacement for this check, revoke every token,
or paste token listings/values into chat. Current build CI has no npm publishing
step, so it has no demonstrated need for a new publishing token.

1. Open the correct npm account's **Access Tokens** page privately.
2. Identify the exact affected token. If it is active, approve deleting only that
   token, then confirm its removal according to
   [npm's revocation procedure](https://docs.npmjs.com/revoking-access-tokens/).
3. If already expired/revoked, record the account owner's sanitized confirmation,
   token identifier/name and date. Missing local configuration alone is insufficient.
4. If it was a **classic** token, npm reports that all classic tokens were revoked
   on **December 9, 2025**. “Legacy” in an old project note does not establish that
   type; confirm classification before using that policy as disposition evidence.
   [Official completion notice](https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/).

## Completion evidence

Keep a sanitized record of owner authorization, affected token ID/name and status,
key role/distribution decision, new public certificate SHA256, protected-storage
and backup checks, identified build/APK hash, signature verification and approved
device update/data checks. Record each unverified item explicitly. Never attach
tokens, passwords, private keystores, recovery material or account screenshots
containing credentials. Preparation is not CV-SEC-1 acceptance, completed rotation,
registry revocation or release qualification. No Git history rewriting is included.
