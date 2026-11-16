import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AuthProvider, useAuth } from '../context/AuthContext'
import Login from './Login'

vi.mock('../api', () => ({ login: vi.fn(), getMe: vi.fn(), getNetworkInfo: vi.fn() }))
vi.mock('../components/LegalViewerModal', () => ({ openLegalModal: vi.fn() }))
const key = 'sb_publishable_fixture_only_abcdefghijkl'

function Home() {
  const { user, logoutUser } = useAuth()
  return user ? <><p>{user.name}</p><button onClick={logoutUser}>Sign out</button></> : <p>Signed out</p>
}

function screenForSignIn() {
  render(<AuthProvider><MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<Home />} />
  </Routes></MemoryRouter></AuthProvider>)
}

beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

test('an unavailable server leaves CineVault login as the available option', async () => {
  fetch.mockResolvedValue(new Response(null, { status: 404 }))
  screenForSignIn()
  expect(await screen.findByRole('button', { name: 'Sign In' })).toBeEnabled()
  expect(screen.queryByLabelText('Sign-in method')).not.toBeInTheDocument()
})

test('the Supabase login form starts a memory-only session and signs out', async () => {
  fetch.mockResolvedValueOnce(Response.json({ publishableKey: key }))
    .mockResolvedValueOnce(Response.json({ access_token: 'cloud-token' }))
    .mockResolvedValueOnce(Response.json({ token: 'local-token', expiresAt: Math.floor(Date.now() / 1000) + 120 }))
    .mockResolvedValueOnce(Response.json({ _id: 'home', name: 'Home' }))
    .mockResolvedValue(new Response(null, { status: 204 }))
  screenForSignIn()
  fireEvent.change(await screen.findByLabelText('Sign-in method'), { target: { value: 'cloud' } })
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'test@example.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Supabase' }))
  expect(await screen.findByText('Home')).toBeInTheDocument()
  expect(localStorage.getItem('cv_token')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(screen.getByText('Signed out')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/v1/auth/exchange/logout', expect.objectContaining({
    headers: { 'x-auth-token': 'local-token' },
  }))
})

test('a Supabase account requiring a password change completes the password update and signs in', async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 120
  fetch
    // 1. Config check
    .mockResolvedValueOnce(Response.json({ publishableKey: key }))
    // 2. Initial sign-in with temporary password
    .mockResolvedValueOnce(Response.json({ access_token: 'temp-token-1' }))
    // 3. Exchange rejects with 403 password_change_required
    .mockResolvedValueOnce(Response.json({ error: 'password_change_required' }, { status: 403 }))
    // 4. Logout temp-token-1
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    // 5. Re-authenticate with temporary password for complete-password-change
    .mockResolvedValueOnce(Response.json({ access_token: 'temp-token-2' }))
    // 6. cinevault-account-admin complete-password-change succeeds
    .mockResolvedValueOnce(Response.json({ state: 'COMPLETED', mustChangePassword: false }))
    // 7. Logout temp-token-2
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    // 8. Sign in with new password
    .mockResolvedValueOnce(Response.json({ access_token: 'fresh-token-3' }))
    // 9. Exchange succeeds
    .mockResolvedValueOnce(Response.json({ token: 'local-token-after-change', expiresAt }))
    // 10. Load /api/v1/users/me
    .mockResolvedValueOnce(Response.json({ _id: 'home', name: 'Home' }))
    // 11. Logout fresh-token-3
    .mockResolvedValue(new Response(null, { status: 204 }))

  screenForSignIn()
  fireEvent.change(await screen.findByLabelText('Sign-in method'), { target: { value: 'cloud' } })
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'reset-user@example.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'TemporaryPass-123!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Supabase' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'You must change your temporary password before signing in.'
  )
  expect(screen.getByLabelText('Email address')).toBeDisabled()

  // Mismatched confirmation is caught client-side before sending another network call
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPermanentPass-456!' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'MismatchPass-789!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Update password and sign in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('New password and confirmation do not match.')

  // Matching confirmation completes the change via cinevault-account-admin and opens Home
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPermanentPass-456!' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPermanentPass-456!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Update password and sign in' }))

  expect(await screen.findByText('Home')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith(
    'https://uouydbapluktfrylligo.supabase.co/functions/v1/cinevault-account-admin',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        apikey: key,
        Authorization: 'Bearer temp-token-2',
      }),
    })
  )
})
