import { CONFIG } from './config.mjs'
import { createOwnerSession } from './protocol.mjs'
const el = id => document.getElementById(id)
let session, timer, busy = false
function clearProof() { for (const id of ['request', 'proof', 'instance']) el(id).value = ''; el('confirm').checked = false }
function message(text) { el('status').textContent = text }
function error(text = '') { el('error').textContent = text }
function controls(disabled) { for (const id of ['signin', 'approve', 'signout']) el(id).disabled = disabled }
function clean() {
  clearTimeout(timer); clearProof(); el('password').value = ''; el('email').value = ''
  el('approval').hidden = true; el('signout').hidden = true; el('instructions').hidden = true
}
async function signOut() {
  clean(); controls(true); const current = session; session = null
  const result = await current?.signOut()
  message(result?.revoked ? 'Signed out. Reload to start a new setup.' :
    'Local secrets cleared; server sign-out could not be confirmed. Revoke this session from the owner account before leaving an uncertain approval.')
}
try {
  if (location.search || location.hash || window.self !== window.top) throw Error()
  session = createOwnerSession({ config: CONFIG, origin: location.origin })
  el('signin').disabled = false; message('Trusted origin verified. Owner provisioning and hosted broker must be commissioned first.')
} catch { message('Not commissioned, unexpected URL or unapproved origin. Sign-in is disabled.'); controls(true) }
el('login').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !session) return
  busy = true; controls(true); error()
  const password = el('password').value; el('password').value = ''
  try {
    const result = await session.signIn(el('email').value.trim(), password)
    el('login').hidden = true; el('approval').hidden = false; el('signout').hidden = false
    message('Signed in for this short setup window. Authorization is checked by the broker, not your token metadata.')
    timer = setTimeout(() => { signOut().catch(() => {}); }, Math.max(0, result.expiresAt - Date.now()))
  } catch { error('Sign-in failed or expired. No account was created.'); }
  finally { busy = false; if (session) controls(false) }
})
el('approval').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !session || !el('confirm').checked) return
  busy = true; controls(true); error()
  try {
    await session.approve(el('request').value, el('proof').value, el('instance').value.trim())
    clearProof(); el('approval').hidden = true; el('instructions').hidden = false
    message('Approval acknowledged. Now check owner approval on your PC; keep this page open until it succeeds.')
  } catch { error('Approval unavailable or denied. A lost response may have committed; retry the identical PC request, never reset the identity.'); }
  finally { busy = false; if (session) controls(false) }
})
el('signout').addEventListener('click', () => { if (!busy) signOut().catch(() => {}) })
window.addEventListener('pagehide', () => { clean(); session?.dispose(); session = null })
