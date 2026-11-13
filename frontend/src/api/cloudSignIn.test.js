import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getCloudSignInConfig, signInWithCloud } from './cloudSignIn'
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
