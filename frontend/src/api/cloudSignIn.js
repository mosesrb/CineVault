const authUrl = 'https://uouydbapluktfrylligo.supabase.co/auth/v1'
const exchangePath = '/api/v1/auth/exchange'
const messages = {
  unavailable: 'Cloud sign-in is unavailable on this connection.',
  rejected: 'Supabase could not sign you in. Check your email and password.',
  unlinked: 'This Supabase account needs an approved CineVault link.',
}

export function canUseCloudSignIn() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) &&
    !window.Capacitor?.isNativePlatform?.() && !localStorage.getItem('cv_server_url') &&
    !import.meta.env.VITE_API_URL
}

function request(url, options) {
  return fetch(url, {
    credentials: 'omit', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(10000), ...options,
  })
}

export async function getCloudSignInConfig() {
  if (!canUseCloudSignIn()) return null
  try {
    const response = await request(exchangePath + '/config')
    if (!response.ok) return null
    const { publishableKey } = await response.json()
    return /^sb_publishable_[\w-]{16,256}$/.test(publishableKey) ? publishableKey : null
  } catch {
    return null
  }
}

export async function signInWithCloud(email, password, publishableKey) {
  if (!canUseCloudSignIn() || !/^sb_publishable_[\w-]{16,256}$/.test(publishableKey)) {
    throw new Error(messages.unavailable)
  }
  const headers = { apikey: publishableKey }
  const response = await request(authUrl + '/token?grant_type=password', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ?
    messages.rejected : messages.unavailable)
  const { access_token: upstream } = await response.json()
  if (typeof upstream !== 'string' || !upstream || upstream.length > 8192) throw new Error(messages.unavailable)

  let localToken
  try {
    const exchange = await request(exchangePath, {
      method: 'POST', headers: { Authorization: 'Bearer ' + upstream },
    })
    if (!exchange.ok) throw new Error(exchange.status === 403 ? messages.unlinked : messages.unavailable)
    const { token, expiresAt } = await exchange.json()
    if (typeof token === 'string' && token) localToken = token
    if (typeof token !== 'string' || !token || !Number.isSafeInteger(expiresAt) ||
        expiresAt * 1000 <= Date.now() || expiresAt * 1000 > Date.now() + 300000) {
      throw new Error(messages.unavailable)
    }
    const profile = await request('/api/v1/users/me', { headers: { 'x-auth-token': token } })
    if (!profile.ok || expiresAt * 1000 <= Date.now()) throw new Error(messages.unavailable)
    const user = await profile.json()
    if (typeof user?._id !== 'string') throw new Error(messages.unavailable)
    return { token, expiresAt, user: { ...user, isAdmin: false } }
  } catch (error) {
    if (localToken) void revokeCloudSession(localToken).catch(() => {})
    throw error
  } finally {
    // Supabase is only needed at exchange time. End this specific cloud session.
    void request(authUrl + '/logout?scope=local', {
      method: 'POST', headers: { ...headers, Authorization: 'Bearer ' + upstream },
    }).catch(() => {})
  }
}

export function cloudSignInError(error) {
  return Object.values(messages).includes(error?.message) ? error.message : messages.unavailable
}

export function revokeCloudSession(token) {
  return request(exchangePath + '/logout', { method: 'POST', headers: { 'x-auth-token': token } })
}
