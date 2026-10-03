import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest'
import Detail from './Detail'
import { getMovie, getTVShow, getMe, getSeasonEpisodes, getStreamTicket } from '../api'

vi.mock('../api', () => ({
  getMovie: vi.fn(), getTVShow: vi.fn(), getMe: vi.fn(), getSeasonEpisodes: vi.fn(),
  addToWatchlist: vi.fn(), deleteMovie: vi.fn(), deleteTVShow: vi.fn(),
  deleteEpisode: vi.fn(), getStreamTicket: vi.fn(), resolveUrl: value => value,
}))
vi.mock('../components/DownloadButton', () => ({ default: () => null }))
vi.mock('../components/ImageViewerModal', () => ({ default: () => null }))
vi.mock('../components/ConfirmModal', () => ({ default: () => null }))

describe('detail primary playback action', () => {
  const media = { _id: 'qa-1', title: 'Synthetic QA movie', genres: [] }
  beforeEach(() => {
    vi.clearAllMocks()
    getMe.mockResolvedValue({ data: { watchlist: [] } })
    getSeasonEpisodes.mockResolvedValue({ data: [{ _id: 'ep-1', season: 1, episode: 1 }] })
  })
  afterEach(cleanup)

  it.each([
    ['movie', media, 'Play', '/watch/movie/qa-1'],
    ['movie', { ...media, userProgress: { progressSeconds: 10, completed: false } }, 'Resume Movie', '/watch/movie/qa-1'],
    ['tvshow', { ...media, resumePoint: { episodeId: 'ep-1', season: 1, episode: 1 } }, 'Resume S1:E1', '/watch/tvshow/qa-1?ep=ep-1'],
  ])('marks only %s primary action for mobile navigation clearance', async (type, value, label, href) => {
    getMovie.mockResolvedValue({ data: value })
    getTVShow.mockResolvedValue({ data: value })
    render(<MemoryRouter initialEntries={[`/detail/${type}/qa-1`]}>
      <Routes><Route path="/detail/:type/:id" element={<Detail />} /></Routes>
    </MemoryRouter>)
    const play = await screen.findByRole('link', { name: label })
    expect(play).toHaveClass('detail-play')
    expect(play).toHaveAttribute('href', href)
    expect(screen.getByRole('button', { name: 'Watchlist' })).not.toHaveClass('detail-play')
  })
})

describe('detail browser downloads', () => {
  const media = { _id: 'qa-show', title: 'Synthetic QA show', genres: [], totalSeasons: 1 }
  const episode = { _id: 'qa-episode', season: 1, episode: 1, vaultPath: 'Inbox/QA episode.mkv' }
  let downloadClick
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('cv_token', 'synthetic-account-token')
    localStorage.setItem('cv_server_url', 'https://qa.example')
    getTVShow.mockResolvedValue({ data: media })
    getMe.mockResolvedValue({ data: { watchlist: [] } })
    getSeasonEpisodes.mockResolvedValue({ data: [episode] })
    downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    downloadClick.mockRestore()
    localStorage.clear()
  })
  const openDetail = () => render(<MemoryRouter initialEntries={['/detail/tvshow/qa-show']}>
    <Routes><Route path="/detail/:type/:id" element={<Detail />} /></Routes>
  </MemoryRouter>)

  it('never renders the account token in an episode URL and requests a scoped download ticket', async () => {
    getStreamTicket.mockResolvedValue({ data: { ticket: 'synthetic-download-ticket' } })
    openDetail()
    const download = await screen.findByTitle('Download episode')
    expect(download.getAttribute('href') || '').not.toContain('synthetic-account-token')
    fireEvent.click(download)
    await waitFor(() => expect(downloadClick).toHaveBeenCalledOnce())
    expect(getStreamTicket).toHaveBeenCalledWith(episode.vaultPath, 'download')
    const link = downloadClick.mock.instances[0]
    const url = new URL(link.href)
    expect(url.origin).toBe('https://qa.example')
    expect(url.searchParams.get('path')).toBe(episode.vaultPath)
    expect(url.searchParams.get('token')).toBe('synthetic-download-ticket')
    expect(url.searchParams.get('download')).toBe('true')
    expect(link.isConnected).toBe(false)
  })

  it.each(['failure', 'empty ticket'])('does not download after %s', async mode => {
    if (mode === 'failure') getStreamTicket.mockRejectedValue(new Error('Synthetic authorization failure'))
    else getStreamTicket.mockResolvedValue({ data: {} })
    openDetail()
    fireEvent.click(await screen.findByTitle('Download episode'))
    await screen.findByText(mode === 'failure' ? 'Synthetic authorization failure' : 'A download ticket was not returned.')
    expect(downloadClick).not.toHaveBeenCalled()
    expect(getStreamTicket).toHaveBeenCalledWith(episode.vaultPath, 'download')
  })
})
