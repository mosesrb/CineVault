import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '../../api'
import AdminUsers from './AdminUsers'

vi.mock('../../api', () => ({
  getUsers: vi.fn(), getGenres: vi.fn(), createUser: vi.fn(), approveUser: vi.fn(),
  resetUserPassword: vi.fn(), revokeUserSessions: vi.fn(), unlinkUser: vi.fn(),
  banUser: vi.fn(), setUserGenres: vi.fn(), deleteUser: vi.fn()
}))

describe('administrator account controls', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    api.getUsers.mockResolvedValue({ data: [{ _id: 'viewer', name: 'Viewer', email: 'viewer@example.com',
      isApproved: true, cloudLinked: true, cloudLinkGeneration: 'generation' }] })
    api.getGenres.mockResolvedValue({ data: [] })
  })

  afterEach(() => vi.restoreAllMocks())

  it('creates a local viewer from the administrator page', async () => {
    api.createUser.mockResolvedValue({ data: { _id: 'new', name: 'New Viewer', email: 'new@example.com' } })
    render(<MemoryRouter><AdminUsers /></MemoryRouter>)
    await screen.findByText('Viewer')
    fireEvent.click(screen.getByRole('button', { name: 'Create local account' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Viewer' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Initial local password'), { target: { value: 'fixture-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByText('New Viewer')
    expect(api.createUser).toHaveBeenCalledWith({ name: 'New Viewer', email: 'new@example.com', password: 'fixture-password' })
    expect(screen.queryByLabelText('Initial local password')).toBeNull()
  })

  it('shows successful access changes and clears the password after a reset failure', async () => {
    api.approveUser.mockResolvedValue({ data: { isApproved: false } })
    api.resetUserPassword.mockRejectedValue({ response: { status: 400, data: 'Password too long.' } })
    api.unlinkUser.mockResolvedValue({})
    const { container } = render(<MemoryRouter><AdminUsers /></MemoryRouter>)
    await screen.findByText('Viewer')
    const row = within(container.querySelector('.card'))
    fireEvent.click(row.getByRole('button', { name: 'Manage' }))
    fireEvent.click(row.getByRole('button', { name: 'Disable access' }))
    await row.findByRole('button', { name: 'Enable access' })
    expect(api.approveUser).toHaveBeenCalledWith('viewer', false)
    const password = row.getByLabelText('New local password')
    fireEvent.change(password, { target: { value: 'fixture-password' } })
    fireEvent.click(row.getByRole('button', { name: 'Reset local password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Password too long.')
    expect(password).toHaveValue('')
    fireEvent.click(row.getByRole('button', { name: 'Remove Supabase link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Supabase sign-in removed')
    expect(api.unlinkUser).toHaveBeenCalledWith('viewer', 'generation')
    expect(row.queryByText('Supabase linked')).toBeNull()
  })
})
