import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DownloadButton from './DownloadButton'
import { OfflineStorageService } from '../services/OfflineStorageService'

vi.mock('../services/OfflineStorageService', () => ({ OfflineStorageService: {
  isDownloading: vi.fn(), getDownloadRecord: vi.fn(), subscribe: vi.fn(),
  downloadMedia: vi.fn(), deleteDownload: vi.fn(),
} }))
const view = () => render(<DownloadButton mediaId="synthetic" url="/stream/synthetic" type="movie" metadata={{ title: 'Synthetic' }} />)
beforeEach(() => {
  vi.clearAllMocks()
  OfflineStorageService.isDownloading.mockReturnValue(false)
  OfflineStorageService.getDownloadRecord.mockResolvedValue(undefined)
  OfflineStorageService.subscribe.mockReturnValue(vi.fn())
})
afterEach(cleanup)
describe('truthful download completion', () => {
  it('does not restore completed UI when a retired operation resolves null', async () => {
    let resolve
    OfflineStorageService.downloadMedia.mockReturnValue(new Promise(done => { resolve = done }))
    view()
    fireEvent.click(await screen.findByRole('button', { name: 'Download for offline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agree & Download' }))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('cv_download_change', { detail: { id: 'synthetic', status: 'cancelled' } }))
      resolve(null)
    })
    expect(screen.getByRole('button', { name: 'Download for offline' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Downloaded (Click to remove)' })).not.toBeInTheDocument()
  })
  it('keeps completed UI on deletion failure and displays generic retry guidance', async () => {
    OfflineStorageService.getDownloadRecord.mockResolvedValue({ status: 'completed' })
    OfflineStorageService.deleteDownload.mockRejectedValue(new Error('synthetic-private-path'))
    view()
    fireEvent.click(await screen.findByRole('button', { name: 'Downloaded (Click to remove)' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Unable to remove the local download. Please retry.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Downloaded (Click to remove)' })).toBeInTheDocument()
    expect(screen.queryByText(/synthetic-private-path/)).not.toBeInTheDocument()
  })
})
