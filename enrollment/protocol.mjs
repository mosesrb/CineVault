const REF = 'uouydbapluktfrylligo'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX = /^[a-f0-9]{64}$/
const fields = ['projectRef', 'serverInstanceId', 'pairId', 'credentialId', 'secretDigest',
  'pollDigest', 'expiresAt', 'idempotencyKey', 'approvalDigest']
const fail = () => { throw new Error('Enrollment validation failed. Restart the approved setup flow.') }
const exact = (value, keys) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail()
}
const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map(v => v.toString(16).padStart(2, '0')).join('')
export function configuration(config, origin) {
  const snapshot = structuredClone(config)
  exact(snapshot, ['projectRef', 'projectUrl', 'publishableKey', 'approvedOrigin'])
  if (snapshot.projectRef !== REF || snapshot.projectUrl !== `https://${REF}.supabase.co` ||
    !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(snapshot.publishableKey) ||
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/.test(snapshot.approvedOrigin) ||
    origin !== snapshot.approvedOrigin) fail()
  return Object.freeze(snapshot)
}
export async function validatePairing(text, proof, instance, now = Date.now()) {
  if (typeof text !== 'string' || text.length > 8192 || typeof proof !== 'string' || !HEX.test(proof) ||
    typeof instance !== 'string' || !UUID.test(instance)) fail()
  const request = JSON.parse(text)
  const replacing=Object.hasOwn(request,'replacement'),restoring=Object.hasOwn(request,'recovery')
  exact(request, restoring?[...fields,'recovery']:replacing?[...fields,'replacement']:fields)
  if(restoring){exact(request.recovery,['cloudServerId']);if(typeof request.recovery.cloudServerId!=='string'||!UUID.test(request.recovery.cloudServerId))fail()}
  if(replacing){
    exact(request.replacement,['credentialId','cloudServerId','epoch'])
    if(!['credentialId','cloudServerId'].every(k=>typeof request.replacement[k]==='string'&&UUID.test(request.replacement[k])) ||
      request.replacement.credentialId===request.credentialId || !Number.isSafeInteger(request.replacement.epoch) ||
      request.replacement.epoch<1 || request.replacement.epoch>=Number.MAX_SAFE_INTEGER-1)fail()
  }
  if (request.projectRef !== REF || request.serverInstanceId !== instance ||
    !['serverInstanceId', 'pairId', 'credentialId', 'idempotencyKey'].every(k => typeof request[k] === 'string' && UUID.test(request[k])) ||
    !['secretDigest', 'pollDigest', 'approvalDigest'].every(k => typeof request[k] === 'string' && HEX.test(request[k])) ||
    !Number.isSafeInteger(now) || !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now || request.expiresAt > now + 300000 ||
    await sha(proof) !== request.approvalDigest) fail()
  return Object.freeze(request)
}
/** Password Auth goes directly to the fixed Supabase origin, never the PC.
 * No redirect/token-bearing callback, signup, refresh, session storage or SDK CDN.
 * Password grant is an explicit deployment candidate, not claimed PKCE support. */
export function createOwnerSession({ config, origin, fetchImpl = fetch, now = Date.now }) {
  const checked = configuration(config, origin)
  let accessToken = null, validUntil = 0, disposed = false, controller = null
  async function jsonRequest(url, body, authorization) {
    controller = new AbortController()
    const began = performance.now(), started = now()
    let timer
    try {
      const read = (async () => {
        const response = await fetchImpl(url, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          referrerPolicy: 'no-referrer', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', apikey: checked.publishableKey,
            ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, body: JSON.stringify(body) })
        if (!response.ok || response.redirected || (response.url && response.url !== url) ||
          !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) fail()
        const reader = response.body.getReader(), chunks = []
        let size = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > 16384) fail()
            chunks.push(value)
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      })()
      const result = await Promise.race([read, new Promise((_, reject) => {
        timer = setTimeout(() => { controller?.abort(); reject(new Error('Enrollment service unavailable.')) }, 10000)
      })])
      if (disposed || controller.signal.aborted || performance.now() - began >= 10000 || now() - started >= 10000) fail()
      return result
    } finally { clearTimeout(timer); controller?.abort(); controller = null }
  }
  let busy = false
  async function exclusive(action) {
    if (busy || disposed) fail()
    busy = true
    try { return await action() } finally { busy = false }
  }
  return Object.freeze({
    signIn: (email, password) => exclusive(async () => {
      accessToken = null; validUntil = 0
      if (typeof email !== 'string' || email.length > 255 || !email.includes('@') ||
        typeof password !== 'string' || password.length < 1 || password.length > 1024) fail()
      const started = now()
      const result = await jsonRequest(`${checked.projectUrl}/auth/v1/token?grant_type=password`, { email, password })
      if (typeof result.access_token !== 'string' || result.access_token.length > 8192 || result.token_type !== 'bearer' ||
        !Number.isSafeInteger(result.expires_in) || result.expires_in <= 0 || typeof result.user?.id !== 'string' || !UUID.test(result.user.id) ||
        result.user.is_anonymous !== false) fail()
      accessToken = result.access_token
      // Deliberately discard refresh_token. Reauthentication, never background refresh.
      validUntil = Math.min(started + result.expires_in * 1000, started + 300000)
      if (validUntil <= now()) { accessToken = null; fail() }
      return { userId: result.user.id, expiresAt: validUntil }
    }),
    approve: (text, proof, confirmedInstanceId, confirmedCloudServerId) => exclusive(async () => {
      if (!accessToken || now() >= validUntil) { accessToken = null; fail() }
      const request = await validatePairing(text, proof, confirmedInstanceId, now())
      if(request.recovery && confirmedCloudServerId!==request.recovery.cloudServerId)fail()
      const result = await jsonRequest(`${checked.projectUrl}/functions/v1/cinevault-control-plane`,
        { operation: request.recovery?'approve-restore':request.replacement?'approve-replacement':'approve', request, approvalProof: proof, confirmedInstanceId,
          ...(request.recovery?{confirmedCloudServerId}:{}) }, accessToken)
      exact(result, ['approved', 'pairId', 'expiresAt'])
      if (result.approved !== true || result.pairId !== request.pairId || !Number.isSafeInteger(result.expiresAt) ||
        result.expiresAt > request.expiresAt || result.expiresAt <= now() || now() >= validUntil) fail()
      return result
    }),
    async signOut() {
      const token = accessToken
      accessToken = null; validUntil = 0; disposed = true; controller?.abort()
      if (!token) return { revoked: true }
      try {
        const response = await fetchImpl(`${checked.projectUrl}/auth/v1/logout?scope=local`, {
          method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
          signal: AbortSignal.timeout(10000), headers: { apikey: checked.publishableKey, Authorization: `Bearer ${token}` },
        })
        return { revoked: response.status === 204 && !response.redirected }
      } catch { return { revoked: false } }
    },
    dispose() { disposed = true; accessToken = null; validUntil = 0; controller?.abort() },
  })
}
