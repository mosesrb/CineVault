# CineVault development-only deepmerge backport

Private local fork of deepmerge4.3.1, distributed under its original MIT license.
This is **not an upstream fixed release**. Package identity is
@cinevault/deepmerge-guard1.0.0 and it is never published. Only jest-config30.5.1's
transitive deepmerge request is replaced via the root npm override. No production
application import or lifecycle install script is added.

The local package is an explicit root development dependency. npm11 resolves the
scoped override's file path from node_modules/jest-config, so that override uses
file:../../vendor/deepmerge-guard. The committed lock must resolve both aliases
to file:vendor/deepmerge-guard. The root .npmrc enables packed local packages
(install-links=true); ordinary npm ci must use that same mode. It contains no
account or authentication configuration. Symlink mode failed npm's clean-install
validation for the differently named local fork. The regression test compares
installed code with the reviewed vendor source and verifies actual Jest resolution;
clean-install and Linux CI checks must catch future tree/layout changes. This is
scoped to jest-config30.5.1 deliberately; requalify before upgrading the runner.

Provenance: the unmodified npm4.3.1 CommonJS distribution has SHA256
2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d. Its registry tarball integrity is retained in the prior lockfile
and session evidence. index.js preserves that distribution except an unconditional
__proto__ key skip at the start of each target-copy/source-merge loop. Original
license is in LICENSE. No constructor/prototype rule or other merge behavior is
changed. No version is invented to look like an official patched release.

The flaw can replace the returned object's prototype when a target has no
prototype, contains a null placeholder, or itself carries an own __proto__ key;
global Object.prototype need not change. The unconditional check covers both
loops before reading the forbidden value and applies during recursive cloning.
This follows the small fix proposed in the unmerged upstream PR274, reviewed
locally with independent regression vectors. Options remain trusted callbacks;
this patch is not validation of arbitrary executable getters or merge callbacks.

Run npm run test:dependency-guards for poisoning/compatibility and actual Jest
resolution checks; verify:web and CI run it alongside the unchanged full audit.
A zero audit result alone does not validate this private code: retain regression
tests, license/provenance, source review and clean-install verification.

Remove the scoped override/local package only after an official compatible fixed
release or runner removes the affected library, then rerun these checks and the
full test gate. Maintain this small fork until then; do not upgrade Jest past the
scoped version without rechecking dependency resolution.

Sources:
- https://github.com/TehShrike/deepmerge/tree/v4.3.1
- https://github.com/advisories/GHSA-gcqx-w48m-w2h4
- https://github.com/TehShrike/deepmerge/pull/274
