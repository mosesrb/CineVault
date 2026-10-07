# Trusted owner approval candidate — not deployed

This directory is a dependency-free static Cloudflare Pages candidate. The owner
approved preparation, not publishing, account creation, Auth settings or broker
deployment. Source config has blank public key/origin and denies all sign-in.
There is no workflow or automatic hosting/push. Pages carries no media/tunnel.

The separate exact HTTPS Pages origin keeps owner passwords/Auth tokens outside
CineVault PC app code. Password Auth goes straight to the fixed Supabase project;
tokens remain only in page memory for at most five minutes, no refresh/storage,
signup or callback to the PC. Close clears local memory but is **not confirmed
server sign-out**. Explicit Finish attempts scoped logout and reports uncertainty.
Keep the page signed in until the PC's pending redemption succeeds: live Auth
session checks must deny signed-out/expired owner approvals.

## Protocol decision for exact deployment approval

The frozen early design proposed PKCE/state/nonce/exact redirect. This candidate
uses password grant with no redirect at all; it **does not implement or claim
PKCE**. It avoids OAuth provider/SMTP configuration and automatic user creation,
matching the current admin-managed password direction. Supabase documents
[password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
separately from [PKCE callback exchange](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
Owner approval of this explicit protocol choice is required before deployment.
If OAuth/email links are selected instead, implement/test PKCE + state/nonce +
exact redirect separately; do not reuse this password implementation as proof.

Approval still binds full pending request, raw approval proof, explicitly checked
installation UUID, exact project, five-minute expiry, current human session and
privately provisioned installation owner. Client validation is not authority;
the broker must revalidate everything and lock current rows for grant issuance.

## Commissioning gates

- Review/test static page and prepare narrow hosted approve/register/heartbeat
  broker, private grants/credential/idempotency schema, admission and retention.
- Complete real driver/two-connection/cancellation/commit uncertainty, rotation,
  recovery and provider validation with disposable exact fixtures.
- Obtain exact deployment/account/protocol/secret-storage approval. Bootstrap
  the intended permanent cloud-owner Auth/profile/install binding without
  migrating existing local users or enabling arbitrary signup/metadata ownership.
- Choose/create a single free production Pages project (availability unknown).
  Set only its exact `https://<chosen>.pages.dev` origin and public publishable
  key in generated config, never project secrets. Preview/other origins deny.
- Deploy `_headers` alongside page assets and verify effective CSP/no-store/
  no-referrer/frame denial, HTTPS and actual sign-in/approval/cleanup in browser.
- Allow only that exact origin at hosted approval endpoint. No wildcard CORS,
  public owner/RPC/bootstrap authority or token-bearing callbacks.

Supabase functions on the default domain rewrite HTML to text; custom domains are
a paid add-on, so they are not our free enrollment-page solution.
[Supabase limits](https://supabase.com/docs/guides/functions/limits),
[custom domains](https://supabase.com/docs/guides/platform/custom-domains).
GitHub Pages advises against password transactions, so it is not used here.
[GitHub policy](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
Purely static Pages requests are free; no Pages Functions required.
[Cloudflare pricing](https://developers.cloudflare.com/pages/functions/pricing/).
