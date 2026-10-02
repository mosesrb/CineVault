import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Player from './Player'

const mocks = vi.hoisted(() => ({ getMovie: vi.fn(), local: vi.fn(), props: null }))
vi.mock('../api', () => ({
  getMovie: mocks.getMovie,
  getTVShow: vi.fn(), getEpisodes: vi.fn(), saveProgress: vi.fn().mockResolvedValue({}),
  getStreamInfo: vi.fn().mockResolvedValue({ data: {} }),
  getStreamTicket: vi.fn().mockResolvedValue({ data: { ticket: 'synthetic-test-ticket' } }),
}))
vi.mock('../services/OfflineStorageService', () => ({
  OfflineStorageService: { getLocalUrl: mocks.local },
}))
vi.mock('../components/CinemaPlayer', () => ({ default: props => {
  mocks.props = props
  return <button onClick={() => props.onAudioChange(1)}>Select alternate audio</button>
} }))

const mount = async (vaultPath, saved = 0, localUrl = null) => {
  mocks.getMovie.mockResolvedValue({ data: {
    _id: 'synthetic', title: 'Synthetic', vaultPath, duration: 60,
    userProgress: { progressSeconds: saved },
  } })
  mocks.local.mockResolvedValue(localUrl)
  render(<MemoryRouter initialEntries={['/watch/movie/synthetic']}>
    <Routes><Route path="/watch/:type/:id" element={<Player />} /></Routes>
  </MemoryRouter>)
  await screen.findByRole('button', { name: 'Select alternate audio' })
  await waitFor(() => expect(mocks.props).not.toBeNull())
}
beforeEach(() => { mocks.props = null; localStorage.clear() })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Player stream mode matches transport', () => {
  it('keeps fresh MP4 direct and marks alternate audio as transcoding', async () => {
    await mount('Inbox/synthetic.mp4')
    expect(mocks.props.isTranscoding).toBe(false)
    expect(mocks.props.src.src).not.toContain('transcode=true')
    fireEvent.click(screen.getByRole('button', { name: 'Select alternate audio' }))
    expect(mocks.props.isTranscoding).toBe(true)
    expect(mocks.props.src.src).toContain('transcode=true')
    expect(mocks.props.src.src).toContain('audio=1')
  })

  it('reconstructs a resumed MP4 seek instead of seeking the fragmented video directly', async () => {
    await mount('Inbox/synthetic.mp4', 18)
    expect(mocks.props.isTranscoding).toBe(true)
    expect(mocks.props.seekOffset).toBe(18)
    expect(mocks.props.src.src).toContain('seek=18')
    fireEvent.click(screen.getByRole('button', { name: 'Select alternate audio' }))
    expect(mocks.props.isTranscoding).toBe(true)
    // CinemaPlayer delegates significant seeks back to this page.
    act(() => mocks.props.onUserSeek(23))
    await waitFor(() => expect(mocks.props.src.src).toContain('seek=23'))
  })

  it('marks incompatible formats as transcoding', async () => {
    await mount('Inbox/synthetic.mkv')
    expect(mocks.props.isTranscoding).toBe(true)
    expect(mocks.props.src.src).toContain('transcode=true')
  })

  it('keeps offline playback direct even with saved progress or another audio index', async () => {
    await mount('Inbox/synthetic.mkv', 18, 'blob:synthetic-offline')
    await waitFor(() => expect(mocks.props.src.src).toBe('blob:synthetic-offline'))
    expect(mocks.props.isTranscoding).toBe(false)
    expect(mocks.props.audioTracks).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Select alternate audio' }))
    expect(mocks.props.isTranscoding).toBe(false)
    expect(mocks.props.src.src).toBe('blob:synthetic-offline')
  })
})
