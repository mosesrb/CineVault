const projectRef = 'uouydbapluktfrylligo'
const authUrl = `https://${projectRef}.supabase.co/auth/v1`
const accountAdminUrl = `https://${projectRef}.supabase.co/functions/v1/cinevault-account-admin`
const exchangePath = '/api/v1/auth/exchange'
const messages = {
  unavailable: 'Cloud sign-in is unavailable on this connection.',
  rejected: 'Supabase could not sign you in. Check your email and password.',
  unlinked: 'This Supabase account needs an approved CineVault link.',
  passwordChangeRequired: 'You must change your temporary password before signing in.',
  passwordInvalid: 'New password must be 12 to 72 characters without control characters.',
  passwordUnchanged: 'New password must be different from your temporary password.',
  passwordResetUnresolved: 'Password change is temporarily blocked for this account. Contact your administrator.',
}

export function canUseCloudSignIn() {
  return (window.location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) &&
    !window.Capacitor?.isNativePlatform?.() && !localStorage.getItem('cv_server_url') &&
    !import.meta.env.VITE_API_URL
}

function request(url, options) {
  return fetch(url, {
    credentials: 'omit', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(10000), ...options,
  })
}

function isValidNewPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || /\p{Cc}/u.test(password)) {
    return false
  }
  const byteLength = new TextEncoder().encode(password).byteLength
  return byteLength >= 12 && byteLength <= 72
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
    const exchangeStartedAt = performance.now()
    const exchange = await request(exchangePath, {
      method: 'POST', headers: { Authorization: 'Bearer ' + upstream },
    })
    if (!exchange.ok) {
      if (exchange.status === 403) {
        let payload = null
        try {
          if (/^application\/json(?:\s*;|$)/i.test(exchange.headers?.get?.('content-type') || '')) {
            payload = await exchange.json()
          }
        } catch {
          payload = null
        }
        if (payload?.error === 'password_change_required') {
          const requiredError = new Error(messages.passwordChangeRequired)
          requiredError.code = 'password_change_required'
          throw requiredError
        }
        throw new Error(messages.unlinked)
      }
      throw new Error(messages.unavailable)
    }
    const { token, issuedAt, expiresAt } = await exchange.json()
    if (typeof token === 'string' && token) localToken = token
    // Older same-origin servers supply their clock through the HTTP Date header.
    const serverTime = issuedAt ?? Math.floor(Date.parse(exchange.headers.get('date')) / 1000)
    const lifetime = expiresAt - serverTime
    const deadline = exchangeStartedAt + lifetime * 1000
    if (!localToken || !Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(serverTime) ||
        serverTime <= 0 || lifetime <= 0 || lifetime > 300 || deadline <= performance.now()) {
      throw new Error(messages.unavailable)
    }
    const profile = await request('/api/v1/users/me', { headers: { 'x-auth-token': token } })
    if (!profile.ok) throw new Error(messages.unavailable)
    const user = await profile.json()
    if (typeof user?._id !== 'string' || deadline <= performance.now()) throw new Error(messages.unavailable)
    return { token, deadline, user: { ...user, isAdmin: false } }
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

export async function completeCloudPasswordChange(email, currentPassword, newPassword, publishableKey) {
  if (!canUseCloudSignIn() || !/^sb_publishable_[\w-]{16,256}$/.test(publishableKey)) {
    throw new Error(messages.unavailable)
  }
  if (typeof currentPassword !== 'string' || !currentPassword) {
    throw new Error(messages.rejected)
  }
  if (!isValidNewPassword(newPassword)) {
    throw new Error(messages.passwordInvalid)
  }
  if (newPassword === currentPassword) {
    throw new Error(messages.passwordUnchanged)
  }

  const headers = { apikey: publishableKey }
  const response = await request(authUrl + '/token?grant_type=password', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: currentPassword }),
  })
  if (!response.ok) {
    throw new Error(response.status === 400 || response.status === 401 ? messages.rejected : messages.unavailable)
  }
  const { access_token: upstream } = await response.json()
  if (typeof upstream !== 'string' || !upstream || upstream.length > 8192) {
    throw new Error(messages.unavailable)
  }

  try {
    const changeResponse = await request(accountAdminUrl, {
      method: 'POST',
      headers: {
        ...headers,
        Authorization: 'Bearer ' + upstream,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operation: 'complete-password-change',
        projectRef,
        operationId: crypto.randomUUID(),
        newPassword,
      }),
    })
    if (!changeResponse.ok) {
      let payload = null
      try {
        if (/^application\/json(?:\s*;|$)/i.test(changeResponse.headers?.get?.('content-type') || '')) {
          payload = await changeResponse.json()
        }
      } catch {
        payload = null
      }
      if (
        payload?.error === 'password_reset_unresolved' ||
        payload?.error === 'password_write_outcome_uncertain'
      ) {
        throw new Error(messages.passwordResetUnresolved)
      }
      throw new Error(messages.unavailable)
    }
  } finally {
    void request(authUrl + '/logout?scope=local', {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer ' + upstream },
    }).catch(() => {})
  }

  return await signInWithCloud(email, newPassword, publishableKey)
}

export function cloudSignInError(error) {
  return Object.values(messages).includes(error?.message) ? error.message : messages.unavailable
}

export function revokeCloudSession(token) {
  return request(exchangePath + '/logout', { method: 'POST', headers: { 'x-auth-token': token } })
}
