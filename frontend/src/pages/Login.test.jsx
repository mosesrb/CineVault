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
