import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import './CinemaPlayer.css'

// ─── helpers ─────────────────────────────────────────────────────────────────
const fmt = (s) => {
  s = Math.max(0, Math.floor(s))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

// How far back (seconds) the user must seek before we restart the server stream.
// Forward seeks always just move video.currentTime — the pipe catches up.
const RESTART_THRESHOLD = 8

// ─── tiny SVG icon ────────────────────────────────────────────────────────────
const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d={d} />
  </svg>
)
const IC = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  replay: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  volHi: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  volLo: 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z',
  volOff: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  fsOn: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fsOff: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  theater: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z',
  sub: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6zm0 4h8v2H6zm10 0h2v2h-2zm-6-4h8v2h-8z',
  audio: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z',
  pip: 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  fwd: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z',
  bwd: 'M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z',
}

// ─── popup menu ───────────────────────────────────────────────────────────────
function MenuPanel({ title, items, activeValue, onSelect, onClose }) {
  return (
    <div className="cp-menu" onClick={e => e.stopPropagation()}>
      <div className="cp-menu-head">
        <span>{title}</span>
        <button className="cp-menu-x" onClick={onClose}><Icon d={IC.close} size={15} /></button>
      </div>
      {items.map(item => (
        <button
          key={item.value}
          className={`cp-menu-row${item.value === activeValue ? ' cp-menu-row--on' : ''}`}
          onClick={() => { onSelect(item.value); onClose() }}
        >
          <span>{item.label}</span>
          {item.value === activeValue && <Icon d={IC.check} size={15} />}
        </button>
      ))}
    </div>
  )
}

// ─── main ─────────────────────────────────────────────────────────────────────
export default function CinemaPlayer({
  src, title, poster, subtitlesUrl,
  duration = 0, seekOffset = 0,
  onUserSeek, isTranscoding = false,
  audioTracks = [], activeAudio = 0, onAudioChange,
  subtitleTracks = [], activeSubtitle = 'sidecar', onSubtitleChange,
  isTheater = false, onTheaterToggle,
}) {
  const wrapperRef = useRef(null)
  const videoRef = useRef(null)
  const barRef = useRef(null)
  const hideTimer = useRef(null)
  const dragging = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(() => localStorage.getItem('cv_mute') === 'true')
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem('cv_vol') || '1'))
  const [currentTime, setCurrentTime] = useState(0)
  const [browserDuration, setBrowserDuration] = useState(0)
  const [isWaiting, setIsWaiting] = useState(false)
  const [buffered, setBuffered] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [showCtrl, setShowCtrl] = useState(true)
  const [subsOn, setSubsOn] = useState(!!subtitlesUrl)
  const [menu, setMenu] = useState(null)
  const [hoverPct, setHoverPct] = useState(null)
  const [hoverX, setHoverX] = useState(0)
  const [ended, setEnded] = useState(false)
  const [scratchedTime, setScratchedTime] = useState(null)

  const total = duration || browserDuration || 1
  const absTime = scratchedTime !== null ? scratchedTime : (seekOffset + currentTime)
  const playPct = Math.min(100, (absTime / total) * 100)
  const bufPct = Math.min(100, ((seekOffset + buffered) / total) * 100)

  // ── hide timer ────────────────────────────────────────────────────────
  const showControls = useCallback(() => {
    setShowCtrl(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => { if (!dragging.current) setShowCtrl(false) }, 3000)
  }, [])
  useEffect(() => () => clearTimeout(hideTimer.current), [])

  // ── video events ──────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current; if (!v) return
    v.volume = volume
    v.muted = muted
  }, [])

  useEffect(() => {
    const v = videoRef.current; if (!v) return
    const onPlay = () => { setPlaying(true); setEnded(false); showControls() }
    const onPause = () => { setPlaying(false); setShowCtrl(true) }
    const onEnd = () => { setPlaying(false); setEnded(true); setShowCtrl(true) }
    const onTime = () => {
      setCurrentTime(v.currentTime)
      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
    }
    const onFsChg = async () => {
      const isFs = !!document.fullscreenElement;
      setFullscreen(isFs);
      
      // Auto-landscape for mobile using Capacitor Native Plugin if available
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      if (isFs && isMobile) {
        try {
          const { ScreenOrientation } = await import('@capacitor/screen-orientation');
          await ScreenOrientation.lock({ orientation: 'landscape' });
        } catch (err) {
          // Fallback to web API if plugin fails or not in Capacitor environment
          if (screen.orientation && screen.orientation.lock) {
             screen.orientation.lock('landscape').catch(() => {});
          }
        }
      } else {
        try {
          const { ScreenOrientation } = await import('@capacitor/screen-orientation');
          await ScreenOrientation.unlock();
        } catch (e) {
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
        }
      }
    }
    v.addEventListener('play', onPlay); v.addEventListener('pause', onPause)
    v.addEventListener('ended', onEnd); v.addEventListener('timeupdate', onTime)
    v.addEventListener('progress', onTime)
    
    // Initial seek for native files (non-transcoding segments)
    const onLoaded = () => {
      if (!isTranscoding && seekOffset > 0 && v.currentTime === 0) {
        console.log(`[CinemaPlayer] Native file metadata loaded. ReadyState: ${v.readyState}`);
        // If already ready, seek. Otherwise wait for 'canplay'
        if (v.readyState >= 2) {
           console.log(`[CinemaPlayer] Applying initial seek: ${seekOffset}s`);
           v.currentTime = seekOffset;
        } else {
           v.addEventListener('canplay', () => {
             console.log(`[CinemaPlayer] CanPlay fired. Applying seek: ${seekOffset}s`);
             v.currentTime = seekOffset;
           }, { once: true });
        }
      }
    };
    v.addEventListener('loadedmetadata', onLoaded);

    const onError = (e) => {
      const err = e.target.error;
      console.error('[CinemaPlayer] VIDEO ERROR:', {
        code: err?.code,
        message: err?.message,
        src: v.src
      });
    };
    v.addEventListener('error', onError);

    document.addEventListener('fullscreenchange', onFsChg)
    return () => {
      v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause)
      v.removeEventListener('ended', onEnd); v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('progress', onTime)
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('error', onError)
      document.removeEventListener('fullscreenchange', onFsChg)
    }
  }, [src?.src, showControls, isTranscoding, seekOffset])

  // ── subtitle mode sync ────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current; if (!v) return
    const sync = () => {
      Array.from(v.textTracks).forEach(t => { 
        t.mode = subsOn ? 'showing' : 'disabled' 
      })
    }
    sync()
    // Small delay helps browser register the new <track> src if it changed
    const t = setTimeout(sync, 100)
    return () => clearTimeout(t)
  }, [subsOn, subtitlesUrl, src?.src])

  // ── keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      const v = videoRef.current; if (!v) return

      let handled = true
      switch (e.key) {
        case ' ': case 'k': case 'Enter':
          v.paused ? v.play() : v.pause(); break
        case 'ArrowRight': case 'l':
          doSeek(Math.min(total, absTime + 10))
          break
        case 'ArrowLeft': case 'j':
          doSeek(Math.max(0, absTime - 10))
          break
        case 'ArrowUp':
          v.volume = Math.min(1, v.volume + 0.1); setVolume(v.volume); break
        case 'ArrowDown':
          v.volume = Math.max(0, v.volume - 0.1); setVolume(v.volume); break
        case 'm': v.muted = !v.muted; setMuted(v.muted); break
        case 'f': toggleFs(); break
        case 't': onTheaterToggle?.(); break
        case 'c': if (subtitlesUrl) setSubsOn(p => !p); break
        case 'Escape': setMenu(null); break
        default: handled = false
      }

      if (handled) {
        e.preventDefault()
        showControls()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [absTime, subtitlesUrl, showControls, onTheaterToggle])

  // ── seek logic ────────────────────────────────────────────────────────
  // The ONE function that handles all seeks. Rules:
  //  - Forward seek (or tiny backward): just set video.currentTime, pipe buffers ahead
  //  - Large backward seek on transcoded stream: restart server pipe from new position
  //  - Native files: always just set video.currentTime
  const doSeek = useCallback((targetAbsolute) => {
    const v = videoRef.current; if (!v) return
    const clipped = Math.max(0, Math.min(targetAbsolute, total))
    const delta = clipped - absTime   // positive = forward, negative = backward

    const isSignificantSeek = Math.abs(delta) > 2

    if (isTranscoding && onUserSeek && isSignificantSeek) {
      // For transcoded pipes, we MUST restart the server stream for both
      // forward and backward seeks, because the pipe doesn't contain future data.
      onUserSeek(clipped)
    } else {
      // Native files (MP4/WebM) or tiny adjustments: seek within local buffer.
      // video.currentTime is relative to the start of the current stream segment.
      const localTarget = clipped - seekOffset
      v.currentTime = Math.max(0, localTarget)
    }
  }, [absTime, total, isTranscoding, onUserSeek, seekOffset])

  // ── progress bar: shared pointer/touch position → seek ───────────────
  const pctFromClientX = useCallback((clientX) => {
    const bar = barRef.current; if (!bar) return 0
    const { left, width } = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - left) / width))
  }, [])

  const seekFromClientX = useCallback((clientX) => {
    doSeek(pctFromClientX(clientX) * total)
  }, [pctFromClientX, doSeek, total])

  // Mouse events
  const onBarMouseDown = (e) => {
    e.preventDefault()
    dragging.current = true
    const startPct = pctFromClientX(e.clientX)
    setScratchedTime(startPct * total)

    const onMove = (me) => {
      if (dragging.current) {
        const pct = pctFromClientX(me.clientX)
        setScratchedTime(pct * total)
      }
    }
    const onUp = (me) => {
      const finalPct = pctFromClientX(me.clientX)
      doSeek(finalPct * total)
      setScratchedTime(null)
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  const onBarMouseMove = (e) => {
    const pct = pctFromClientX(e.clientX)
    setHoverPct(pct * 100)
    setHoverX(pct * (barRef.current?.getBoundingClientRect().width || 0))
  }

  // Touch events for mobile scrubbing
  const onBarTouchStart = (e) => {
    e.preventDefault()
    dragging.current = true
    const startPct = pctFromClientX(e.touches[0].clientX)
    setScratchedTime(startPct * total)
  }
  const onBarTouchMove = (e) => {
    e.preventDefault()
    if (dragging.current) {
      const pct = pctFromClientX(e.touches[0].clientX)
      setScratchedTime(pct * total)
    }
  }
  const onBarTouchEnd = (e) => {
    const finalPct = pctFromClientX(e.changedTouches[0].clientX)
    doSeek(finalPct * total)
    setScratchedTime(null)
    dragging.current = false
  }

  // ── other controls ────────────────────────────────────────────────────
  const togglePlay = () => { const v = videoRef.current; v?.paused ? v.play() : v?.pause() }
  const toggleMute = () => {
    const v = videoRef.current; if (!v) return
    const next = !v.muted
    v.muted = next
    setMuted(next)
    localStorage.setItem('cv_mute', String(next))
  }
  const setVol = (val) => {
    const v = videoRef.current; if (!v) return
    v.volume = val
    setVolume(val)
    v.muted = val === 0
    setMuted(val === 0)
    localStorage.setItem('cv_vol', String(val))
    localStorage.setItem('cv_mute', String(val === 0))
  }
  const toggleFs = () => {
    if (!document.fullscreenElement) wrapperRef.current?.requestFullscreen()
    else document.exitFullscreen()
  }
  const togglePip = () => {
    if (document.pictureInPictureElement) document.exitPictureInPicture()
    else videoRef.current?.requestPictureInPicture?.()
  }

  // ── derived ───────────────────────────────────────────────────────────
  const volIcon = muted || volume === 0 ? IC.volOff : volume > 0.5 ? IC.volHi : IC.volLo
  const audioItems = useMemo(() =>
    audioTracks.map(t => ({ value: t.index, label: `${t.title || 'Track ' + (t.index + 1)} · ${t.language}` }))
    , [audioTracks])

  const subItems = useMemo(() => [
    { value: 'off', label: 'Off' },
    ...(subtitlesUrl && activeSubtitle === 'sidecar' ? [{ value: 'sidecar', label: 'External' }] : []),
    ...subtitleTracks.map(t => ({
      value: t.index,
      label: `${t.language.toUpperCase()} (${t.title || t.codec})`
    }))
  ], [subtitlesUrl, activeSubtitle, subtitleTracks])

  const activeSubValue = (!subtitlesUrl || !subsOn) ? 'off' : activeSubtitle
  const ctrlVisible = showCtrl || !playing || !!menu

  return (
    <div
      ref={wrapperRef}
      className={`cp${fullscreen ? ' cp--fs' : ''}${isTheater ? ' cp--theater' : ''}`}
      onMouseMove={showControls}
      onMouseEnter={showControls}
      onMouseLeave={() => { if (playing && !menu) setShowCtrl(false) }}
      onTouchStart={showControls}
      onClick={() => setMenu(null)}
    >
      {/* video */}
      {/* ── Main Video ── */}
      <video
        ref={videoRef}
        src={src?.src}
        poster={poster}
        className="cp-video"
        playsInline autoPlay
        onClick={e => { e.stopPropagation(); showControls(); }}
        crossOrigin="anonymous"
        onLoadedMetadata={(e) => {
          // Fallback: If the server-provided duration is 0,
          // use the native video duration from the browser.
          if (duration <= 0 && e.target.duration > 0 && e.target.duration !== Infinity) {
            console.log(`[CinemaPlayer] Runtime fallback used: ${e.target.duration}s`);
            setBrowserDuration(e.target.duration);
          }
        }}
      >
        {subtitlesUrl && <track key={subtitlesUrl} src={subtitlesUrl} kind="subtitles" label="Subtitles" srcLang="en" default />}
      </video>

      {/* ended overlay */}
      {ended && (
        <div className="cp-ended" onClick={() => { videoRef.current?.play() }}>
          <button className="cp-ended-btn">
            <Icon d={IC.replay} size={36} />
            <span>Replay</span>
          </button>
        </div>
      )}

      {/* controls */}
      <div className={`cp-controls${ctrlVisible ? ' cp-controls--on' : ''}`}>

        {/* title */}
        <div className="cp-titlebar">
          <span className="cp-title">{title}</span>
        </div>

        {/* progress bar — enlarged touch target via padding */}
        <div
          ref={barRef}
          className="cp-bar"
          onMouseDown={onBarMouseDown}
          onMouseMove={onBarMouseMove}
          onMouseLeave={() => setHoverPct(null)}
          onTouchStart={onBarTouchStart}
          onTouchMove={onBarTouchMove}
          onTouchEnd={onBarTouchEnd}
        >
          <div className="cp-bar-track">
            <div className="cp-bar-buf" style={{ width: bufPct + '%' }} />
            <div className="cp-bar-played" style={{ width: playPct + '%' }}>
              <div className="cp-bar-thumb" />
            </div>
          </div>
          {hoverPct !== null && (
            <div className="cp-bar-tip" style={{ left: hoverX }}>
              {fmt(hoverPct / 100 * total)}
            </div>
          )}
        </div>

        {/* bottom row */}
        <div className="cp-row">
          <div className="cp-row-l">
            {/* play/pause */}
            <button className="cp-btn" onClick={e => { e.stopPropagation(); togglePlay() }}>
              <Icon d={playing ? IC.pause : IC.play} />
            </button>

            {/* skip buttons — visible on mobile, handy everywhere */}
            <button className="cp-btn" title="-10s" onClick={e => { e.stopPropagation(); doSeek(absTime - 10) }}>
              <Icon d={IC.bwd} size={18} />
            </button>
            <button className="cp-btn" title="+10s" onClick={e => { e.stopPropagation(); doSeek(absTime + 10) }}>
              <Icon d={IC.fwd} size={18} />
            </button>

            {/* volume — hidden on mobile (native handles it) */}
            <div className="cp-vol cp-desktop-only">
              <button className="cp-btn" onClick={e => { e.stopPropagation(); toggleMute() }}>
                <Icon d={volIcon} />
              </button>
              <input
                type="range" min="0" max="1" step="0.02"
                value={muted ? 0 : volume}
                onChange={e => setVol(parseFloat(e.target.value))}
                className="cp-vol-range"
              />
            </div>

            <span className="cp-time">{fmt(absTime)} / {fmt(total)}</span>
          </div>

          <div className="cp-row-r">
            {isTranscoding && (
              <div className="cp-transcode-icon" title="Transcoding... (Optimal Quality)">
                <Icon d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" size={16} />
              </div>
            )}
            {/* subtitles */}
            {(subtitlesUrl || subtitleTracks.length > 0) && (
              <div className="cp-anchor">
                <button
                  className={`cp-btn${(subtitlesUrl && subsOn) ? ' cp-btn--on' : ''}`}
                  onClick={e => { e.stopPropagation(); setMenu(menu === 'sub' ? null : 'sub') }}
                >
                  <Icon d={IC.sub} />
                </button>
                {menu === 'sub' && (
                  <MenuPanel title="Subtitles" items={subItems}
                    activeValue={activeSubValue}
                    onSelect={v => {
                      if (v === 'off') {
                        setSubsOn(false)
                      } else {
                        setSubsOn(true)
                        onSubtitleChange?.(v)
                      }
                    }}
                    onClose={() => setMenu(null)}
                  />
                )}
              </div>
            )}

            {/* audio tracks */}
            {audioTracks.length > 0 && (
              <div className="cp-anchor">
                <button className="cp-btn"
                  onClick={e => { e.stopPropagation(); setMenu(menu === 'audio' ? null : 'audio') }}
                >
                  <Icon d={IC.audio} />
                </button>
                {menu === 'audio' && (
                  <MenuPanel title="Audio" items={audioItems}
                    activeValue={activeAudio}
                    onSelect={v => onAudioChange?.(v)}
                    onClose={() => setMenu(null)}
                  />
                )}
              </div>
            )}

            {/* theater — desktop only */}
            {onTheaterToggle && !fullscreen && (
              <button
                className={`cp-btn cp-desktop-only${isTheater ? ' cp-btn--on' : ''}`}
                title="Theater (t)"
                onClick={e => { e.stopPropagation(); onTheaterToggle() }}
              >
                <Icon d={IC.theater} />
              </button>
            )}

            {/* pip — desktop only */}
            {'pictureInPictureEnabled' in document && (
              <button className="cp-btn cp-desktop-only" onClick={e => { e.stopPropagation(); togglePip() }}>
                <Icon d={IC.pip} />
              </button>
            )}

            {/* fullscreen */}
            <button className="cp-btn" onClick={e => { e.stopPropagation(); toggleFs() }}>
              <Icon d={fullscreen ? IC.fsOff : IC.fsOn} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
