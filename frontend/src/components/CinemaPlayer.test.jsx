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
    expect(onUserSeek.mock.calls).toEqual([[0], [60]])
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
