import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ControlPlane from './ControlPlane'
const response = (body, ok = true) => ({ ok, json: async () => body })
const status = { mode: 'not_enrolled', enabled: true, guidance: 'Prepare setup' }
describe('cloud administration page', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('cv_token', 'synthetic-local-token'); vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  it('reads live no-store status without shared API cache or custom remote server selection', async () => {
    localStorage.setItem('cv_server_url', 'https://foreign.example'); fetch.mockResolvedValue(response(status))
    render(<ControlPlane />); await screen.findByText('Status: not_enrolled')
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/admin/control-plane')
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', redirect: 'error', credentials: 'omit' })
  })
  it('keeps all mutation buttons disabled while cloud is disabled', async () => {
    fetch.mockResolvedValue(response({ mode: 'disabled', enabled: false })); render(<ControlPlane />)
    await screen.findByText('Status: disabled'); for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })
  it('requires explicit replacement confirmation and sends only same-origin CSRF action', async () => {
    const setup={alreadyEnrolled:false,request:{replacement:{epoch:1}},approvalProof:'replacement-proof',expiresAt:Date.now()+10000}
    fetch.mockResolvedValueOnce(response({...status,mode:'credential_expired'})).mockResolvedValueOnce(response({csrfToken:'replace-csrf'}))
      .mockResolvedValueOnce(response(setup)).mockResolvedValueOnce(response({...status,mode:'awaiting_replacement_owner'}))
    render(<ControlPlane />); await screen.findByText('Status: credential_expired')
    const button=screen.getByText('Prepare credential replacement'); expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button)
    await screen.findByDisplayValue('replacement-proof')
    expect(fetch.mock.calls[2][0]).toBe('/api/v1/admin/control-plane/recover')
    expect(fetch.mock.calls[2][1]).toMatchObject({body:'{}',headers:{'x-cinevault-csrf':'replace-csrf'}})
    expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(localStorage.length).toBe(1)
  })
  it('obtains fresh CSRF then shows pairing proof only in memory', async () => {
    const setup = { alreadyEnrolled: false, request: { pairId: 'synthetic-pair' }, approvalProof: 'synthetic-proof', expiresAt: Date.now() + 10000 }
    fetch.mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response({ csrfToken: 'synthetic-csrf' }))
      .mockResolvedValueOnce(response(setup)).mockResolvedValueOnce(response({ ...status, mode: 'awaiting_owner' }))
    render(<ControlPlane />); await screen.findByText('Status: not_enrolled'); fireEvent.click(screen.getByText('Prepare one-time setup'))
    await screen.findByDisplayValue('synthetic-proof'); expect(fetch.mock.calls[2][1].headers['x-cinevault-csrf']).toBe('synthetic-csrf')
    expect(localStorage.length).toBe(1); expect(localStorage.getItem('cv_token')).toBe('synthetic-local-token')
    expect(fetch.mock.calls.every(([url]) => !url.includes('synthetic-proof'))).toBe(true)
  })
  it('clears the displayed proof at expiry without auto polling', async () => {
    vi.useFakeTimers(); const setup = { alreadyEnrolled: false, request: {}, approvalProof: 'expire-proof', expiresAt: Date.now() + 1000 }
    fetch.mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(response(setup)).mockResolvedValueOnce(response(status))
    render(<ControlPlane />); await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(screen.getByText('Prepare one-time setup')) })
    expect(screen.getByDisplayValue('expire-proof')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(1000) }); expect(screen.queryByDisplayValue('expire-proof')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(4)
  })
  it('shows explicit live-read failure, not cached success', async () => {
    fetch.mockRejectedValue(Error('network')); render(<ControlPlane />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No cached status is used')
  })
  it('failed mutation leaves current login untouched and surfaces owner guidance', async () => {
    fetch.mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(response({ error: 'Owner recovery required' }, false)).mockResolvedValueOnce(response({ ...status, mode: 'conflict' }))
    render(<ControlPlane />); await screen.findByText('Status: not_enrolled'); fireEvent.click(screen.getByText('Retry cloud recovery'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Owner recovery required'))
    expect(localStorage.getItem('cv_token')).toBe('synthetic-local-token')
  })
})
