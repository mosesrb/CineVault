import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  cloudSignInError,
  completeCloudPasswordChange,
  getCloudSignInConfig,
  signInWithCloud,
} from './cloudSignIn'
import { clearCloudSession, getCloudSession, setCloudSession } from './cloudSession'

const key = 'sb_publishable_fixture_only_abcdefghijkl'
beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { clearCloudSession(); localStorage.clear(); vi.unstubAllGlobals() })

test('a custom server connection hides cloud sign-in and receives no credentials', async () => {
  localStorage.setItem('cv_server_url', 'https://elsewhere.example')
  expect(await getCloudSignInConfig()).toBeNull()
  await expect(signInWithCloud('person@example.test', 'fixture-password', key)).rejects.toThrow('unavailable')
  expect(fetch).not.toHaveBeenCalled()
})

test('exchanges a cloud token for a local session and scopes logout to the cloud session', async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 120
  fetch.mockResolvedValueOnce(Response.json({ publishableKey: key }))
    .mockResolvedValueOnce(Response.json({ access_token: 'cloud-token', refresh_token: 'unused' }))
    .mockResolvedValueOnce(Response.json({ token: 'local-token', expiresAt }))
    .mockResolvedValueOnce(Response.json({ _id: 'home', isAdmin: true }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  expect(await getCloudSignInConfig()).toBe(key)
  const session = await signInWithCloud('person@example.test', 'fixture-password', key)
  expect(session).toEqual({ token: 'local-token', expiresAt, user: { _id: 'home', isAdmin: false } })
  expect(fetch.mock.calls[1][0]).toBe('https://uouydbapluktfrylligo.supabase.co/auth/v1/token?grant_type=password')
  expect(fetch.mock.calls[2]).toEqual(['/api/v1/auth/exchange', expect.objectContaining({
    headers: { Authorization: 'Bearer cloud-token' }, redirect: 'error'
  })])
  expect(fetch.mock.calls[3][1].headers).toEqual({ 'x-auth-token': 'local-token' })
  expect(fetch.mock.calls[4][0]).toMatch(/logout\?scope=local$/)
  expect(localStorage.length).toBe(0)
  setCloudSession(session.token, session.expiresAt)
  expect(getCloudSession()?.token).toBe('local-token')
  expect(clearCloudSession('old-token')).toBe(false)
  localStorage.setItem('cv_server_url', 'https://elsewhere.example')
  expect(getCloudSession()).toBeNull()
})

test('an unlinked cloud account gets a specific error and still signs out upstream', async () => {
  fetch.mockResolvedValueOnce(Response.json({ access_token: 'cloud-token' }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  await expect(signInWithCloud('person@example.test', 'fixture-password', key)).rejects.toThrow('approved CineVault link')
  expect(fetch.mock.calls[2][0]).toMatch(/logout\?scope=local$/)
  expect(getCloudSession()).toBeNull()
})

test('a cloud account with must_change_password gets password_change_required and signs out upstream', async () => {
  fetch.mockResolvedValueOnce(Response.json({ access_token: 'temp-cloud-token' }))
    .mockResolvedValueOnce(Response.json({ error: 'password_change_required' }, { status: 403 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  await expect(signInWithCloud('person@example.test', 'TempPassword-123!', key)).rejects.toMatchObject({
    code: 'password_change_required',
    message: 'You must change your temporary password before signing in.',
  })
  expect(fetch.mock.calls[2][0]).toMatch(/logout\?scope=local$/)
  expect(getCloudSession()).toBeNull()
})

test('completeCloudPasswordChange validates new password locally and completes change + fresh exchange', async () => {
  await expect(
    completeCloudPasswordChange('person@example.test', 'TempPassword-123!', 'short', key)
  ).rejects.toThrow('New password must be 12 to 72 characters without control characters.')
  await expect(
    completeCloudPasswordChange('person@example.test', 'TempPassword-123!', 'TempPassword-123!', key)
  ).rejects.toThrow('New password must be different from your temporary password.')
  expect(fetch).not.toHaveBeenCalled()

  const expiresAt = Math.floor(Date.now() / 1000) + 120
  fetch
    // 1. Authenticate with temporary password to obtain fresh S_temp token
    .mockResolvedValueOnce(Response.json({ access_token: 'temp-session-token' }))
    // 2. Call cinevault-account-admin complete-password-change
    .mockResolvedValueOnce(Response.json({ state: 'COMPLETED', mustChangePassword: false }))
    // 3. Logout temporary upstream session
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    // 4. Sign in with new password
    .mockResolvedValueOnce(Response.json({ access_token: 'fresh-session-token' }))
    // 5. Exchange at /api/v1/auth/exchange
    .mockResolvedValueOnce(Response.json({ token: 'local-after-change-token', expiresAt }))
    // 6. Load /api/v1/users/me
    .mockResolvedValueOnce(Response.json({ _id: 'home', name: 'Home', isAdmin: false }))
    // 7. Logout fresh upstream session
    .mockResolvedValueOnce(new Response(null, { status: 204 }))

  const session = await completeCloudPasswordChange(
    'person@example.test',
    'TempPassword-123!',
    'UpdatedViewerPass-456!',
    key
  )
  expect(session).toEqual({
    token: 'local-after-change-token',
    expiresAt,
    user: { _id: 'home', name: 'Home', isAdmin: false },
  })
  expect(fetch.mock.calls[0][0]).toBe('https://uouydbapluktfrylligo.supabase.co/auth/v1/token?grant_type=password')
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    email: 'person@example.test',
    password: 'TempPassword-123!',
  })
  expect(fetch.mock.calls[1][0]).toBe('https://uouydbapluktfrylligo.supabase.co/functions/v1/cinevault-account-admin')
  expect(fetch.mock.calls[1][1].headers).toEqual({
    apikey: key,
    Authorization: 'Bearer temp-session-token',
    'Content-Type': 'application/json',
  })
  const adminPayload = JSON.parse(fetch.mock.calls[1][1].body)
  expect(adminPayload).toEqual({
    operation: 'complete-password-change',
    projectRef: 'uouydbapluktfrylligo',
    operationId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    newPassword: 'UpdatedViewerPass-456!',
  })
  expect(fetch.mock.calls[2][0]).toMatch(/logout\?scope=local$/)
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({
    email: 'person@example.test',
    password: 'UpdatedViewerPass-456!',
  })
})

test('completeCloudPasswordChange surfaces unresolved password reset block and signs out upstream', async () => {
  fetch
    .mockResolvedValueOnce(Response.json({ access_token: 'temp-session-token' }))
    .mockResolvedValueOnce(Response.json({ error: 'password_reset_unresolved' }, { status: 409 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))

  let caught
  try {
    await completeCloudPasswordChange(
      'person@example.test',
      'TempPassword-123!',
      'UpdatedViewerPass-456!',
      key
    )
  } catch (err) {
    caught = err
  }
  expect(cloudSignInError(caught)).toBe(
    'Password change is temporarily blocked for this account. Contact your administrator.'
  )
  expect(fetch.mock.calls[2][0]).toMatch(/logout\?scope=local$/)
})
