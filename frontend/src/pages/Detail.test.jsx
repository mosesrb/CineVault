import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest'
import Detail from './Detail'
import { getMovie, getTVShow, getMe, getSeasonEpisodes } from '../api'

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
