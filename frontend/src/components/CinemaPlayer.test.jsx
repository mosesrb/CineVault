import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CinemaPlayer from './CinemaPlayer'

vi.mock('@capacitor/screen-orientation', () => ({
  ScreenOrientation: { lock: vi.fn(), unlock: vi.fn() },
}))

let video, play, pause
const props = {
  src: { src: '/synthetic.mp4' }, title: 'Synthetic QA', duration: 60,
  subtitlesUrl: '/synthetic.vtt',
  audioTracks: [
    { index: 0, title: 'Original', language: 'en' },
    { index: 1, title: 'Alternate', language: 'fr' },
  ],
}
const key = (element, value) => fireEvent.keyDown(element, { key: value })
const focus = element => act(() => element.focus())
const mount = (extra = {}) => {
  const view = render(<CinemaPlayer {...props} {...extra} />)
  video = view.container.querySelector('video')
  Object.defineProperty(video, 'paused', { configurable: true, value: true })
  return view
}

beforeEach(() => {
  localStorage.clear()
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CinemaPlayer remote focus', () => {
  it('keeps a reconstructed seek paused and resets the previous local timeline', () => {
    const onUserSeek = vi.fn()
    const view = mount({ isTranscoding: true, onUserSeek, seekOffset: 18 })
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.play(video)
    video.currentTime = 3
    fireEvent.timeUpdate(video)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
    fireEvent.pause(video)
    fireEvent.click(screen.getByRole('button', { name: 'Jump forward 5 seconds' }))
    expect(onUserSeek).toHaveBeenCalledWith(26)
    view.rerender(<CinemaPlayer {...props} isTranscoding onUserSeek={onUserSeek}
      src={{ src: '/synthetic-seek-26.mp4' }} seekOffset={26} />)
    expect(video.autoplay).toBe(false)
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuenow', '26')
    fireEvent.canPlay(video)
    expect(play).not.toHaveBeenCalled()
    // Guard an old queued autoplay event as well as the new source attribute.
    fireEvent.play(video)
    expect(pause).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(play).toHaveBeenCalledTimes(1)
    expect(video.autoplay).toBe(true)
  })

  it('continues a playing reconstruction despite transport-generated pause events', () => {
    const view = mount({ isTranscoding: true })
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.play(video)
    view.rerender(<CinemaPlayer {...props} isTranscoding src={{ src: '/synthetic-seek-5.mp4' }} seekOffset={5} />)
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
    fireEvent.pause(video)
    expect(video.autoplay).toBe(true)
    fireEvent.canPlay(video)
    expect(play).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()
  })

  it('preserves paused intent when selecting alternate audio', () => {
    const onAudioChange = vi.fn()
    const view = mount({ onAudioChange })
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.play(video)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
    fireEvent.pause(video)
    fireEvent.click(screen.getByRole('button', { name: 'Audio tracks menu' }))
    fireEvent.click(screen.getByRole('button', { name: /Alternate/ }))
    expect(onAudioChange).toHaveBeenCalledWith(1)
    view.rerender(<CinemaPlayer {...props} onAudioChange={onAudioChange} activeAudio={1}
      isTranscoding src={{ src: '/synthetic-audio-1.mp4' }} />)
    fireEvent.canPlay(video)
    expect(video.autoplay).toBe(false)
    expect(play).not.toHaveBeenCalled()
  })

  it('allows replay after an ended stream and tolerates rejected autoplay', async () => {
    mount()
    play.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'))
    fireEvent.canPlay(video)
    await act(async () => {})
    fireEvent.ended(video)
    expect(video.autoplay).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    expect(video.autoplay).toBe(true)
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('paints a paused reconstructed first frame once without starting playback', () => {
    const view = mount({ isTranscoding: true })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.play(video)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    Object.defineProperty(video, 'paused', { configurable: true, value: true })
    view.rerender(<CinemaPlayer {...props} isTranscoding src={{ src: '/paused-seek.mp4' }} seekOffset={13} />)
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
    play.mockClear()
    fireEvent.canPlay(video)
    expect(video.currentTime).toBe(0.001)
    expect(video.autoplay).toBe(false)
    expect(play).not.toHaveBeenCalled()
    video.currentTime = 0
    fireEvent.canPlay(video)
    expect(video.currentTime).toBe(0)
    view.rerender(<CinemaPlayer {...props} isTranscoding src={{ src: '/another-paused-seek.mp4' }} seekOffset={18} />)
    fireEvent.canPlay(video)
    expect(video.currentTime).toBe(0.001)
  })

  it('reconstructs even a small fragmented seek outside the current segment', () => {
    const onUserSeek = vi.fn()
    mount({ isTranscoding: true, onUserSeek, seekOffset: 18 })
    const bar = screen.getByRole('slider', { name: 'Playback position' })
    // A click at absolute17 is only one second back but lies before this segment.
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 60 })
    fireEvent.mouseDown(bar, { clientX: 17 })
    fireEvent.mouseUp(document, { clientX: 17 })
    expect(onUserSeek).toHaveBeenCalledWith(17)
    expect(video.currentTime).toBe(0)
  })

  it('replays a fragmented response from title zero, not its previous offset', () => {
    const onUserSeek = vi.fn()
    mount({ isTranscoding: true, onUserSeek, seekOffset: 59 })
    fireEvent.ended(video)
    expect(screen.getByRole('button', { name: 'Replay' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    expect(onUserSeek).toHaveBeenCalledWith(0)
    expect(video.autoplay).toBe(true)
    expect(play).not.toHaveBeenCalled()
    Object.defineProperty(video, 'ended', { configurable: true, value: true })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(onUserSeek).toHaveBeenCalledTimes(2)
    expect(play).not.toHaveBeenCalled()
  })

  it('does not log ticket-bearing media URLs or browser error messages', () => {
    mount({ src: { src: '/stream?token=synthetic-sensitive' } })
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 2, message: 'synthetic-sensitive' } })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    fireEvent.error(video)
    expect(log).toHaveBeenCalledWith('[CinemaPlayer] VIDEO ERROR:', { code: 2, readyState: 0 })
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-sensitive')
  })

  it('enters controls, navigates without seeking, then seeks on the progress bar', () => {
    mount()
    const surface = screen.getByRole('button', { name: /Video playback/ })
    focus(surface)
    key(surface, 'ArrowDown')
    const playButton = screen.getByRole('button', { name: 'Play' })
    expect(playButton).toHaveFocus()
    key(playButton, 'ArrowRight')
    const seekButton = screen.getByRole('button', { name: 'Jump back 5 seconds' })
    expect(seekButton).toHaveFocus()
    expect(video.currentTime).toBe(0)
    key(seekButton, 'ArrowUp')
    const bar = screen.getByRole('slider', { name: 'Playback position' })
    expect(bar).toHaveFocus()
    key(bar, 'ArrowRight')
    expect(video.currentTime).toBe(5)
    fireEvent.timeUpdate(video)
    expect(bar).toHaveAttribute('aria-valuenow', '5')
    key(bar, 'ArrowDown')
    expect(playButton).toHaveFocus()
    key(playButton, 'ArrowDown')
    expect(surface).toHaveFocus()
    key(surface, 'ArrowRight')
    expect(video.currentTime).toBe(10)
  })

  it('leaves Enter/Space on buttons to native activation, without a global playback toggle', () => {
    mount()
    const button = screen.getByRole('button', { name: 'Jump forward 5 seconds' })
    focus(button)
    expect(key(button, 'Enter')).toBe(true)
    expect(key(button, ' ')).toBe(true)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    // jsdom does not synthesize the browser click for Enter; emulate that click.
    fireEvent.click(button)
    expect(video.currentTime).toBe(5)
    expect(play).not.toHaveBeenCalled()
  })

  it('does not steal keys from links outside the player or native volume input', () => {
    render(<a href="/">Back to library</a>)
    mount()
    const link = screen.getByRole('link')
    focus(link)
    key(link, 'Enter')
    key(link, 'ArrowRight')
    const volume = screen.getByRole('slider', { name: 'Volume slider' })
    focus(volume)
    expect(key(volume, 'ArrowRight')).toBe(true)
    expect(video.currentTime).toBe(0)
    expect(play).not.toHaveBeenCalled()
  })

  it('keeps background playback/theater shortcuts single-action and leaves modified keys alone', () => {
    const onTheaterToggle = vi.fn()
    mount({ onTheaterToggle })
    const surface = screen.getByRole('button', { name: /Video playback/ })
    focus(surface)
    key(surface, 'Enter')
    expect(play).toHaveBeenCalledTimes(1)
    key(surface, 't')
    expect(onTheaterToggle).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(surface, { key: 't', ctrlKey: true })
    expect(onTheaterToggle).toHaveBeenCalledTimes(1)
  })

  it('skips controls whose ancestors are hidden, as on phone layouts', () => {
    mount()
    document.querySelectorAll('.cp-desktop-only').forEach(node => { node.style.display = 'none' })
    const button = screen.getByRole('button', { name: 'Play' })
    focus(button)
    key(button, 'ArrowRight')
    expect(screen.getByRole('button', { name: 'Subtitles menu' })).toHaveFocus()
    expect(video.currentTime).toBe(0)
  })

  it('reaches and leaves the volume range without trapping remote focus', () => {
    mount()
    const mute = screen.getByRole('button', { name: 'Mute' })
    focus(mute)
    key(mute, 'ArrowRight')
    const volume = screen.getByRole('slider', { name: 'Volume slider' })
    expect(volume).toHaveFocus()
    expect(key(volume, 'ArrowRight')).toBe(true)
    fireEvent.change(volume, { target: { value: '0.5' } })
    expect(video.volume).toBe(0.5)
    key(volume, 'ArrowUp')
    expect(mute).toHaveFocus()
    key(mute, 'ArrowRight')
    key(volume, 'ArrowDown')
    expect(screen.getByRole('button', { name: 'Subtitles menu' })).toHaveFocus()
    expect(video.currentTime).toBe(0)
  })

  it('reaches fullscreen by horizontal navigation and handles focused Escape', () => {
    const { container } = mount()
    let current = screen.getByRole('button', { name: 'Play' })
    focus(current)
    for (let i = 0; i < 12 && current.getAttribute('aria-label') !== 'Enter fullscreen'; i++) {
      key(current, current.type === 'range' ? 'ArrowDown' : 'ArrowRight')
      current = document.activeElement
    }
    expect(current).toBe(screen.getByRole('button', { name: 'Enter fullscreen' }))
    key(current, 'Enter')
    expect(play).not.toHaveBeenCalled()
    fireEvent.click(current)
    expect(container.firstChild).toHaveClass('cp--fs')
    key(current, 'Escape')
    expect(container.firstChild).not.toHaveClass('cp--fs')
  })

  it('clamps accessible position seeks and preserves transcoding callbacks', () => {
    const onUserSeek = vi.fn()
    mount({ isTranscoding: true, onUserSeek, seekOffset: 20 })
    const bar = screen.getByRole('slider', { name: 'Playback position' })
    focus(bar)
    key(bar, 'Home')
    key(bar, 'End')
    expect(onUserSeek.mock.calls).toEqual([[0], [59]])
    expect(video.currentTime).toBe(0)
  })

  it('focuses the active audio track, selects another, and restores the opener', () => {
    const onAudioChange = vi.fn()
    mount({ onAudioChange })
    const opener = screen.getByRole('button', { name: 'Audio tracks menu' })
    focus(opener)
    fireEvent.click(opener)
    const original = screen.getByRole('button', { name: /Original/ })
    expect(original).toHaveFocus()
    key(original, 'ArrowDown')
    const alternate = screen.getByRole('button', { name: /Alternate/ })
    expect(alternate).toHaveFocus()
    key(alternate, 'ArrowRight')
    expect(video.currentTime).toBe(0)
    key(alternate, 'Enter')
    expect(play).not.toHaveBeenCalled()
    fireEvent.click(alternate)
    expect(onAudioChange).toHaveBeenCalledExactlyOnceWith(1)
    expect(opener).toHaveFocus()
    expect(opener).toHaveAttribute('aria-expanded', 'false')
  })

  it('restores subtitle focus on Escape and on the accessible close button', () => {
    mount()
    const opener = screen.getByRole('button', { name: 'Subtitles menu' })
    fireEvent.click(opener)
    const external = screen.getByRole('button', { name: 'External' })
    expect(external).toHaveFocus()
    key(external, 'Escape')
    expect(opener).toHaveFocus()
    expect(screen.queryByRole('group', { name: 'Subtitles' })).not.toBeInTheDocument()
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Close Subtitles menu' }))
    expect(opener).toHaveFocus()
  })

  it('keeps External available after switching to embedded subtitles and supports Off', () => {
    const onSubtitleChange = vi.fn()
    const tracks = [{ index: 0, title: 'Synthetic captions', language: 'en', codec: 'subrip' }]
    const view = mount({ hasSidecarSubtitles: true, subtitleTracks: tracks, onSubtitleChange })
    const textTrack = { mode: 'disabled' }
    Object.defineProperty(video, 'textTracks', { configurable: true, value: [textTrack] })
    const opener = screen.getByRole('button', { name: 'Subtitles menu' })
    fireEvent.click(opener)
    const external = screen.getByRole('button', { name: 'External' })
    key(external, 'ArrowDown')
    const embedded = screen.getByRole('button', { name: 'EN (Synthetic captions)' })
    expect(embedded).toHaveFocus()
    fireEvent.click(embedded)
    expect(onSubtitleChange).toHaveBeenCalledWith(0)
    view.rerender(<CinemaPlayer {...props} hasSidecarSubtitles subtitleTracks={tracks}
      activeSubtitle={0} subtitlesUrl="/synthetic-embedded.vtt" onSubtitleChange={onSubtitleChange} />)
    expect(textTrack.mode).toBe('showing')
    fireEvent.click(opener)
    expect(screen.getByRole('button', { name: 'EN (Synthetic captions)' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'External' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(onSubtitleChange).toHaveBeenLastCalledWith('off')
    expect(textTrack.mode).toBe('disabled')
    fireEvent.click(opener)
    expect(screen.getByRole('button', { name: 'Off' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'External' }))
    expect(onSubtitleChange).toHaveBeenLastCalledWith('sidecar')
    expect(textTrack.mode).toBe('showing')
    expect(opener).toHaveFocus()
    expect(play).not.toHaveBeenCalled()
  })

  it('keeps focused controls visible beyond the hide timeout and mouse leave', () => {
    vi.useFakeTimers()
    const { container } = mount()
    fireEvent.play(video)
    focus(screen.getByRole('button', { name: 'Pause' }))
    act(() => vi.advanceTimersByTime(4000))
    fireEvent.mouseLeave(container.firstChild)
    expect(container.querySelector('.cp-controls')).toHaveClass('cp-controls--on')
    focus(screen.getByRole('button', { name: /Video playback/ }))
    act(() => vi.advanceTimersByTime(4000))
    expect(container.querySelector('.cp-controls')).not.toHaveClass('cp-controls--on')
  })

  it('uses hardware Back for menu first, fullscreen second, then leaves navigation alone', async () => {
    const { container } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    expect(container.firstChild).toHaveClass('cp--fs')
    fireEvent.click(screen.getByRole('button', { name: 'Audio tracks menu' }))
    const back = () => {
      const event = new Event('cv_hardware_back', { cancelable: true })
      act(() => window.dispatchEvent(event))
      return event.defaultPrevented
    }
    expect(back()).toBe(true)
    expect(container.firstChild).toHaveClass('cp--fs')
    expect(screen.queryByRole('group', { name: 'Audio' })).not.toBeInTheDocument()
    expect(back()).toBe(true)
    expect(container.firstChild).not.toHaveClass('cp--fs')
    expect(back()).toBe(false)
  })
})
