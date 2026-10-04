import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest'

vi.hoisted(() => { window.Capacitor = { isNativePlatform: () => true } })
import Detail from './Detail'
import Profile from './Profile'
import Navbar from '../components/Navbar'
import { getMovie, getTVShow, getMe, getSeasonEpisodes } from '../api'
import { OfflineStorageService } from '../services/OfflineStorageService'
import { useAuth } from '../context/AuthContext'

vi.mock('../api', () => ({
  getMovie: vi.fn(), getTVShow: vi.fn(), getMe: vi.fn(), getSeasonEpisodes: vi.fn(),
  addToWatchlist: vi.fn(), deleteMovie: vi.fn(), deleteTVShow: vi.fn(), deleteEpisode: vi.fn(),
  getStreamTicket: vi.fn(), resolveUrl: value => value, updateProfile: vi.fn(), getWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(), getNetworkInfo: vi.fn(), search: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../services/OfflineCacheService', () => ({ OfflineCacheService: {} }))
vi.mock('../services/OfflineStorageService', () => ({ OfflineStorageService: {
  getAllDownloads: vi.fn(), getActiveDownloadId: vi.fn(), deleteDownload: vi.fn(),
} }))
vi.mock('../components/DownloadButton', () => ({ default: props =>
  <button aria-label={`Download ${props.mediaId}`} data-type={props.type} data-show-id={props.metadata.showId}>Download</button> }))
vi.mock('../components/ImageViewerModal', () => ({ default: () => null }))

const movie = { id: 'qa-movie', type: 'movie', status: 'completed', path: 'synthetic-movie', metadata: { title: 'Synthetic movie' } }
const episode = { ...movie, id: 'qa-episode', type: 'episode', metadata: { title: 'Synthetic episode', showId: 'qa-show' } }
const legacy = { ...episode, id: 'qa-legacy', metadata: { title: 'Synthetic legacy' } }
const setUser = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { name: 'Synthetic user', history: [] }, setUser, logoutUser: vi.fn() })
  getMe.mockResolvedValue({ data: { watchlist: [] } })
  getTVShow.mockResolvedValue({ data: { _id: 'qa-show', title: 'Synthetic show', genres: [], totalSeasons: 1 } })
  getSeasonEpisodes.mockResolvedValue({ data: [{ _id: 'qa-episode', title: 'Synthetic episode', season: 1, episode: 1 }] })
  OfflineStorageService.getActiveDownloadId.mockReturnValue(null)
  OfflineStorageService.getAllDownloads.mockResolvedValue([movie, episode, legacy])
})
afterEach(() => { cleanup(); localStorage.clear() })
const openDetail = (path = '/detail/tvshow/qa-show') => render(<MemoryRouter initialEntries={[path]}>
  <Routes><Route path="/detail/:type/:id" element={<Detail />} /></Routes>
</MemoryRouter>)

describe('native download routes', () => {
  it('records the parent show when downloading an episode', async () => {
    openDetail()
    const button = await screen.findByRole('button', { name: 'Download qa-episode' })
    expect(button).toHaveAttribute('data-type', 'episode')
    expect(button).toHaveAttribute('data-show-id', 'qa-show')
    expect(getSeasonEpisodes).toHaveBeenCalledOnce()
  })
  it('uses canonical links for Profile poster and action, and preserves legacy records', async () => {
    render(<MemoryRouter initialEntries={['/profile?tab=downloads']}><Profile /></MemoryRouter>)
    const links = await screen.findAllByRole('link', { name: 'Play downloaded Synthetic episode' })
    expect(links).toHaveLength(2)
    links.forEach(link => expect(link).toHaveAttribute('href', '/watch/tvshow/qa-show?ep=qa-episode'))
    screen.getAllByRole('link', { name: 'Play downloaded Synthetic movie' }).forEach(link =>
      expect(link).toHaveAttribute('href', '/watch/movie/qa-movie'))
    const buttons = screen.getAllByRole('button', { name: 'Play downloaded Synthetic legacy' })
    expect(buttons).toHaveLength(2)
    buttons.forEach(button => { expect(button).toBeDisabled(); expect(button).toHaveAccessibleDescription(/Open the original show/) })
    expect(screen.getByText(/Open the original show/, { selector: 'p' })).toBeVisible()
    expect(OfflineStorageService.deleteDownload).not.toHaveBeenCalled()
  })
  it('uses the same route and visible legacy guidance in Navbar', async () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    expect(await screen.findByRole('link', { name: 'Play downloaded Synthetic episode' }))
      .toHaveAttribute('href', '/watch/tvshow/qa-show?ep=qa-episode')
    expect(screen.getByRole('button', { name: 'Play downloaded Synthetic legacy' })).toBeDisabled()
    expect(screen.getByText(/Open the original show/, { selector: '.download-item-meta' })).toBeVisible()
    expect(OfflineStorageService.deleteDownload).not.toHaveBeenCalled()
  })
})

describe('bounded metadata caller failures', () => {
  it('shows a generic Detail metadata failure without leaking the error', async () => {
    getMovie.mockRejectedValue(new Error('synthetic-private-path'))
    openDetail('/detail/movie/qa-movie')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load this title')
    expect(screen.queryByText(/synthetic-private-path/)).not.toBeInTheDocument()
  })
  it('settles season failure without an unhandled rejection', async () => {
    getSeasonEpisodes.mockRejectedValue(new Error('synthetic-private-path'))
    openDetail()
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load episodes')
    expect(screen.queryByText(/synthetic-private-path/)).not.toBeInTheDocument()
  })
  it('settles Profile history failure without replacing the session', async () => {
    getMe.mockRejectedValue(new Error('synthetic-private-path'))
    render(<MemoryRouter initialEntries={['/profile?tab=history']}><Profile /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to refresh history')
    expect(setUser).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText(/synthetic-private-path/)).not.toBeInTheDocument())
  })
})
