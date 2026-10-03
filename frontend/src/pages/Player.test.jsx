import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Player from './Player'

const mocks = vi.hoisted(() => ({ getMovie: vi.fn(), local: vi.fn(), ticket: vi.fn(), props: null }))
vi.mock('../api', () => ({
  getMovie: mocks.getMovie,
  getTVShow: vi.fn(), getEpisodes: vi.fn(), saveProgress: vi.fn().mockResolvedValue({}),
  getStreamInfo: vi.fn().mockResolvedValue({ data: {} }),
  getStreamTicket: mocks.ticket,
}))
vi.mock('../services/OfflineStorageService', () => ({
  OfflineStorageService: { getLocalUrl: mocks.local },
}))
vi.mock('../components/CinemaPlayer', () => ({ default: props => {
  mocks.props = props
  return <button onClick={() => props.onAudioChange(1)}>Select alternate audio</button>
} }))

const mount = async (vaultPath, saved = 0, localUrl = null, extra = {}) => {
  mocks.getMovie.mockResolvedValue({ data: {
    _id: 'synthetic', title: 'Synthetic', vaultPath, duration: 60,
    userProgress: { progressSeconds: saved },
    ...extra,
  } })
  mocks.local.mockResolvedValue(localUrl)
  render(<MemoryRouter initialEntries={['/watch/movie/synthetic']}>
    <Routes><Route path="/watch/:type/:id" element={<Player />} /></Routes>
  </MemoryRouter>)
  await screen.findByRole('button', { name: 'Select alternate audio' })
  await waitFor(() => expect(mocks.props).not.toBeNull())
}
beforeEach(() => {
  mocks.props = null; localStorage.clear()
  let request = 0
  mocks.ticket.mockReset().mockImplementation(async () => ({ data: { ticket: `synthetic-ticket-${++request}` } }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Player stream mode matches transport', () => {
  it('keeps fresh MP4 direct and marks alternate audio as transcoding', async () => {
    await mount('Inbox/synthetic.mp4')
    expect(mocks.props.isTranscoding).toBe(false)
    expect(mocks.props.src.src).not.toContain('transcode=true')
    fireEvent.click(screen.getByRole('button', { name: 'Select alternate audio' }))
    await waitFor(() => expect(mocks.props.src.src).toContain('audio=1'))
    expect(mocks.props.isTranscoding).toBe(true)
    expect(mocks.props.src.src).toContain('transcode=true')
  })

  it('reconstructs a resumed MP4 seek instead of seeking the fragmented video directly', async () => {
    await mount('Inbox/synthetic.mp4', 18)
    expect(mocks.props.isTranscoding).toBe(true)
    expect(mocks.props.seekOffset).toBe(18)
    expect(mocks.props.src.src).toContain('seek=18')
    fireEvent.click(screen.getByRole('button', { name: 'Select alternate audio' }))
    await waitFor(() => expect(mocks.props.src.src).toContain('audio=1'))
    // CinemaPlayer delegates significant seeks back to this page.
    await act(async () => mocks.props.onUserSeek(23))
    await waitFor(() => expect(mocks.props.src.src).toContain('seek=23'))
  })

  it('marks incompatible formats as transcoding', async () => {
    await mount('Inbox/synthetic.mkv')
    expect(mocks.props.isTranscoding).toBe(true)
    expect(mocks.props.src.src).toContain('transcode=true')
  })

  it('keeps sidecar availability independent of the selected embedded source', async () => {
    await mount('Inbox/synthetic.mkv', 18, null, { hasSidecarSubtitles: true })
    expect(mocks.props.hasSidecarSubtitles).toBe(true)
    expect(mocks.props.subtitlesUrl).toContain('/stream/subtitles?')
    expect(mocks.props.subtitlesUrl).toContain('seek=18')
    await act(async () => mocks.props.onSubtitleChange(0))
    expect(mocks.props.hasSidecarSubtitles).toBe(true)
    expect(mocks.props.subtitlesUrl).toContain('/stream/subtitles/vtt?')
    expect(mocks.props.subtitlesUrl).toContain('index=0&seek=18')
    await act(async () => mocks.props.onUserSeek(23))
    expect(mocks.props.subtitlesUrl).toContain('index=0&seek=23')
    await act(async () => mocks.props.onSubtitleChange('sidecar'))
    expect(mocks.props.subtitlesUrl).toContain('/stream/subtitles?')
    expect(mocks.props.subtitlesUrl).toContain('seek=23')
  })

  it('keeps offline playback direct even with saved progress or another audio index', async () => {
    await mount('Inbox/synthetic.mkv', 18, 'blob:synthetic-offline')
    await waitFor(() => expect(mocks.props.src.src).toBe('blob:synthetic-offline'))
    expect(mocks.props.isTranscoding).toBe(false)
    expect(mocks.props.audioTracks).toEqual([])
    expect(mocks.props.hasSidecarSubtitles).toBe(false)
    expect(mocks.props.subtitlesUrl).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Select alternate audio' }))
    expect(mocks.props.isTranscoding).toBe(false)
    expect(mocks.props.src.src).toBe('blob:synthetic-offline')
  })

  it('gets a new scoped ticket before changing seek/audio and even replaying offset zero', async () => {
    await mount('Inbox/synthetic.mkv')
    const first = mocks.props.src.src
    await act(async () => mocks.props.onUserSeek(0))
    expect(mocks.ticket).toHaveBeenCalledTimes(2)
    expect(mocks.ticket).toHaveBeenLastCalledWith('Inbox/synthetic.mkv')
    expect(mocks.props.src.src).not.toBe(first)
    expect(mocks.props.seekOffset).toBe(0)
    await act(async () => mocks.props.onAudioChange(1))
    expect(mocks.ticket).toHaveBeenCalledTimes(3)
    expect(mocks.props.activeAudio).toBe(1)
  })

  it('renews subtitle authorization without restarting the advancing video', async () => {
    await mount('Inbox/synthetic.mkv', 18, null, { hasSidecarSubtitles: true })
    const source = mocks.props.src.src
    await act(async () => mocks.props.onSubtitleChange(0))
    expect(mocks.ticket).toHaveBeenCalledTimes(2)
    expect(mocks.props.src.src).toBe(source)
    expect(mocks.props.subtitlesUrl).toContain('token=synthetic-ticket-2')
    expect(mocks.props.subtitlesUrl).toContain('seek=18')
    await act(async () => mocks.props.onSubtitleChange('off'))
    expect(mocks.ticket).toHaveBeenCalledTimes(2)
    expect(mocks.props.subtitlesUrl).toBeNull()
  })

  it('keeps the old source/selection on authorization failure and permits retry', async () => {
    await mount('Inbox/synthetic.mkv', 18)
    const source = mocks.props.src.src
    mocks.ticket.mockRejectedValueOnce(new Error('synthetic-sensitive-detail'))
    await act(async () => mocks.props.onUserSeek(23))
    expect(mocks.props.src.src).toBe(source)
    expect(mocks.props.seekOffset).toBe(18)
    expect(screen.getByRole('alert')).not.toHaveTextContent('synthetic-sensitive-detail')
    await act(async () => mocks.props.onUserSeek(23))
    expect(mocks.props.seekOffset).toBe(23)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('discards late seek responses instead of overwriting the latest user intent', async () => {
    await mount('Inbox/synthetic.mkv')
    let older, latest
    mocks.ticket.mockImplementationOnce(() => new Promise(resolve => { older = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { latest = resolve }))
    act(() => { mocks.props.onUserSeek(18); mocks.props.onUserSeek(23) })
    expect(mocks.props.seekOffset).toBe(0)
    await act(async () => latest({ data: { ticket: 'synthetic-latest' } }))
    expect(mocks.props.seekOffset).toBe(23)
    await act(async () => older({ data: { ticket: 'synthetic-older' } }))
    expect(mocks.props.seekOffset).toBe(23)
    expect(mocks.props.src.src).toContain('synthetic-latest')
  })

  it('rejects empty tickets and cancels pending subtitle selection when turned off', async () => {
    await mount('Inbox/synthetic.mkv', 0, null, { hasSidecarSubtitles: true })
    const source = mocks.props.src.src
    mocks.ticket.mockResolvedValueOnce({ data: {} })
    await act(async () => mocks.props.onAudioChange(1))
    expect(mocks.props.src.src).toBe(source)
    expect(mocks.props.activeAudio).toBe(0)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    let resolve
    mocks.ticket.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    act(() => { mocks.props.onSubtitleChange(0) })
    await act(async () => mocks.props.onSubtitleChange('off'))
    await act(async () => resolve({ data: { ticket: 'synthetic-stale-subtitle' } }))
    expect(mocks.props.activeSubtitle).toBe('off')
    expect(mocks.props.subtitlesUrl).toBeNull()
  })

  it('retains a pending audio choice when a newer seek overtakes its ticket request', async () => {
    await mount('Inbox/synthetic.mkv')
    let older, latest
    mocks.ticket.mockImplementationOnce(() => new Promise(resolve => { older = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { latest = resolve }))
    act(() => { mocks.props.onAudioChange(1); mocks.props.onUserSeek(23) })
    await act(async () => latest({ data: { ticket: 'synthetic-latest-audio' } }))
    expect(mocks.props.seekOffset).toBe(23)
    expect(mocks.props.activeAudio).toBe(1)
    await act(async () => older({ data: { ticket: 'synthetic-older-audio' } }))
    expect(mocks.props.src.src).toContain('synthetic-latest-audio')
    expect(mocks.props.activeAudio).toBe(1)
  })
})
