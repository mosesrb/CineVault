import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import { getMovie, getTVShow, getEpisodes, saveProgress, getStreamInfo, getStreamTicket } from '../api'
import { ArrowLeft, Film, PlayCircle, RefreshCw, AlertTriangle } from 'lucide-react'
import CinemaPlayer from '../components/CinemaPlayer'
import { OfflineStorageService } from '../services/OfflineStorageService'
import './Player.css'

const TRANSCODE_EXTS = new Set(['.mkv', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m2ts'])

function buildStreamUrl(vaultPath, token, seekSeconds = 0, audioIndex = 0, revision = 0) {
  if (!vaultPath || !token) return null
  const ext = '.' + vaultPath.split('.').pop().toLowerCase()
  const needsTranscode = TRANSCODE_EXTS.has(ext)
  const params = new URLSearchParams({ path: vaultPath, token })
  // Same-second JWT issuance can return an identical ticket. A verified new
  // user request still needs a fresh media load (including title-zero replay).
  if (revision > 0) params.set('request', String(revision))
  // We MUST transcode if: format is incompatible OR user is seeking OR switching audio
  if (needsTranscode || seekSeconds > 0 || audioIndex > 0) {
    params.set('transcode', 'true')
    if (seekSeconds > 0) params.set('seek', String(Math.floor(seekSeconds)))
    if (audioIndex > 0) params.set('audio', String(audioIndex))
  }
  // ANDROID FIX: In Capacitor, relative URLs resolve to capacitor://localhost which
  // can't reach the backend. Use the saved server URL (tunnel) if available.
  const serverBase = localStorage.getItem('cv_server_url') || ''
  return `${serverBase}/api/v1/stream?${params.toString()}`
}

export default function Player() {
  const { type, id } = useParams()
  const [searchParams] = useSearchParams()
  // A different title/episode owns a different playback session. Never carry
  // local sources, resume positions or pending user intents across routes.
  return <PlayerSession key={JSON.stringify([type, id, searchParams.get('ep')])} />
}

function PlayerSession() {
  const { type, id } = useParams()
  const isMovie = type === 'movie'
  const isTV = type === 'tvshow' || type === 'tv' || type === 'show'

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const epId = searchParams.get('ep')

  const [media, setMedia] = useState(null)
  const [episode, setEpisode] = useState(null)
  const [loading, setLoading] = useState(true)
  const [metadataError, setMetadataError] = useState(false)
  const [isTheater, setIsTheater] = useState(false)
  const [seekOffset, setSeekOffset] = useState(0)
  const [directPosition, setDirectPosition] = useState(0)
  const [sourceRevision, setSourceRevision] = useState(0)
  const [audioTracks, setAudioTracks] = useState([])
  const [activeAudio, setActiveAudio] = useState(0)
  const [subtitleTracks, setSubtitleTracks] = useState([])
  const [activeSubtitle, setActiveSubtitle] = useState('sidecar')
  const [localUrl, setLocalUrl] = useState(null)
  const [localLookupDone, setLocalLookupDone] = useState(false)
  const [streamTicket, setStreamTicket] = useState(null)
  const [subtitleTicket, setSubtitleTicket] = useState(null)
  const [streamTicketError, setStreamTicketError] = useState(false)
  const [playbackRequestError, setPlaybackRequestError] = useState(false)

  const progressTimer = useRef(null)
  const streamRequest = useRef(0)
  const subtitleRequest = useRef(0)
  const requestedAudio = useRef(0)
  const cancelPendingRequests = useCallback(() => {
    ++streamRequest.current
    ++subtitleRequest.current
  }, [])

  // Full-title duration, never the remaining fragmented response duration.
  const duration = episode
    ? (episode.duration || episode.runtime || 0)
    : (media?.duration || (media?.runtime ? media.runtime * 60 : 0))

  // ── Load media ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await (isMovie ? getMovie(id) : getTVShow(id))
        if (cancelled) return
        const eps = isTV && epId ? await getEpisodes(id) : null
        if (cancelled) return
        setEpisode(eps?.data.find(e => e._id === epId) || null)
        setMedia(res.data)
      } catch {
        if (!cancelled) setMetadataError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, type, epId, isMovie, isTV])

  // ── Set resume offset once media loads ────────────────────────────────
  useEffect(() => {
    if (!media) return
    const saved = episode?.userProgress?.progressSeconds
      || media?.userProgress?.progressSeconds || 0
    if (saved > 10) setSeekOffset(saved)
  }, [media, episode])

  // ── Check Local Storage First ────────────────────────────────────────────
  useEffect(() => {
    if (!media) return
    const vaultPath = episode?.vaultPath || media?.vaultPath
    if (!vaultPath) return

    setStreamTicket(null)
    setSubtitleTicket(null)
    setStreamTicketError(false)
    setPlaybackRequestError(false)

    const mediaToLookup = episode?._id || id
    let objectUrl = null
    let cancelled = false
    const revokeBlob = url => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }

    const lookup = async () => {
      try {
        const url = await OfflineStorageService.getLocalUrl(mediaToLookup)
        if (cancelled) { revokeBlob(url); return }
        objectUrl = url
        setLocalUrl(url || null)
      } catch {
        // A storage failure is not authorization: fall back through normal
        // short-lived streaming tickets, without disclosing local paths.
        if (!cancelled) setLocalUrl(null)
      } finally {
        if (!cancelled) setLocalLookupDone(true)
      }
    }
    setLocalLookupDone(false)
    lookup()

    return () => {
      cancelled = true
      revokeBlob(objectUrl)
    }
  }, [media, episode, id])

  // ── Load audio/subtitle tracks (streaming only) ───────────────────────
  useEffect(() => {
    if (!media || !localLookupDone || localUrl) return
    const vaultPath = episode?.vaultPath || media?.vaultPath
    if (!vaultPath) return
    let cancelled = false
    const request = ++streamRequest.current

    getStreamInfo(vaultPath)
      .then(res => {
        if (cancelled) return
        if (res.data?.audioTracks?.length > 0) {
          console.log('[Player] Audio tracks found:', res.data.audioTracks)
          setAudioTracks(res.data.audioTracks)
        }
        if (res.data?.subtitleTracks?.length > 0) {
          console.log('[Player] Subtitle tracks found:', res.data.subtitleTracks)
          setSubtitleTracks(res.data.subtitleTracks)
        }
      })
      .catch(err => {
        console.error('[Player] Failed to fetch stream info:', err.response?.data || err.message)
      })

    getStreamTicket(vaultPath)
      .then(res => {
        if (cancelled || request !== streamRequest.current) return
        if (!res.data?.ticket) throw new Error('Missing playback ticket')
        setStreamTicket(res.data.ticket)
        setSubtitleTicket(res.data.ticket)
      })
      .catch(() => {
        if (!cancelled && request === streamRequest.current) setStreamTicketError(true)
      })
    return () => { cancelled = true; cancelPendingRequests() }
  }, [media, episode, localUrl, localLookupDone, cancelPendingRequests])

  // ── Progress tracking ─────────────────────────────────────────────────
  useEffect(() => {
    if (!media) return
    progressTimer.current = setInterval(() => {
      const video = document.querySelector('video')
      if (!video || video.paused) return
      const transportOffset = localUrl ? 0 : seekOffset
      const absolutePos = Math.floor(transportOffset + video.currentTime)
      const totalDuration = duration || (Number.isFinite(video.duration) ? transportOffset + video.duration : 0)
      if (absolutePos > 0) {
        saveProgress({
          mediaId: id,
          mediaType: type,
          episodeId: epId,
          progressSeconds: absolutePos,
          completed: totalDuration > 0 && ((transportOffset + video.currentTime) / totalDuration) > 0.95
        }).catch(console.error)
      }
    }, 10000)
    return () => clearInterval(progressTimer.current)
  }, [media, episode, id, type, epId, seekOffset, localUrl, duration])

  // Tickets authorize individual requests, not an indefinitely reusable player
  // URL. Reconstruct only after obtaining a fresh scoped ticket; latest intent wins.
  const reconstruct = useCallback(async (offset, audioIndex) => {
    const vaultPath = episode?.vaultPath || media?.vaultPath
    if (localUrl || !vaultPath) return
    const request = ++streamRequest.current
    requestedAudio.current = audioIndex
    ++subtitleRequest.current
    setPlaybackRequestError(false)
    try {
      const res = await getStreamTicket(vaultPath)
      if (request !== streamRequest.current) return
      if (!res.data?.ticket) throw new Error('Missing playback ticket')
      const ext = '.' + vaultPath.split('.').pop().toLowerCase()
      const fragmented = TRANSCODE_EXTS.has(ext) || seekOffset > 0 || audioIndex > 0
      setSeekOffset(fragmented ? Math.floor(offset) : 0)
      setDirectPosition(fragmented ? 0 : Math.floor(offset))
      setActiveAudio(audioIndex)
      setStreamTicket(res.data.ticket)
      setSubtitleTicket(res.data.ticket)
      setSourceRevision(request)
    } catch {
      if (request === streamRequest.current) {
        requestedAudio.current = activeAudio
        setPlaybackRequestError(true)
      }
    }
  }, [media, episode, localUrl, activeAudio, seekOffset])
  const handleSeek = useCallback(t => reconstruct(t, requestedAudio.current), [reconstruct])
  const handleAudioChange = useCallback((idx) => {
    // Snapshot current position before switching track
    const video = document.querySelector('video')
    const currentAbs = Math.floor((localUrl ? 0 : seekOffset) + (video?.currentTime || 0))
    reconstruct(currentAbs, idx)
  }, [seekOffset, localUrl, reconstruct])
  const handleSubtitleChange = useCallback(async (selection) => {
    const request = ++subtitleRequest.current
    if (selection === 'off') { setActiveSubtitle(selection); return true }
    const vaultPath = episode?.vaultPath || media?.vaultPath
    if (localUrl || !vaultPath) return false
    setPlaybackRequestError(false)
    try {
      const res = await getStreamTicket(vaultPath)
      if (request !== subtitleRequest.current) return false
      if (!res.data?.ticket) throw new Error('Missing playback ticket')
      setSubtitleTicket(res.data.ticket)
      setActiveSubtitle(selection)
      return true
    } catch {
      if (request === subtitleRequest.current) setPlaybackRequestError(true)
      return false
    }
  }, [media, episode, localUrl])

  // ─────────────────────────────────────────────────────────────────────
  if (loading) return <div className="loading-center player-loading"><RefreshCw className="animate-spin" size={48} /></div>
  if (metadataError) return <div className="page-content"><p role="alert">Unable to load content</p><p>Go back and try again when the server is available.</p></div>
  if (!media) return <div className="page-content"><p>Content not found.</p></div>

  const title = type === 'tvshow' && episode
    ? `${media.title} — S${episode.season}E${String(episode.episode).padStart(2, '0')} "${episode.title || 'Episode ' + episode.episode}"`
    : media.title
  const vaultPath = episode?.vaultPath || media.vaultPath
  const effectiveToken = streamTicket
  const ext = vaultPath ? '.' + vaultPath.split('.').pop().toLowerCase() : ''
  // Match buildStreamUrl: resume and alternate audio also produce fragmented MP4.
  // Those streams seek by reconstruction, not by changing video.currentTime.
  const needsTranscode = TRANSCODE_EXTS.has(ext) || seekOffset > 0 || activeAudio > 0

  const posterImage = type === 'tvshow'
    ? (episode?.stillUrl || media?.backdropUrl || media?.posterUrl)
    : (media?.backdropUrl || media?.posterUrl)

  const streamUrl = localUrl || buildStreamUrl(vaultPath, effectiveToken, seekOffset, activeAudio, sourceRevision)

  let subtitlesUrl = null
  const hasSidecar = episode?.hasSidecarSubtitles || media?.hasSidecarSubtitles
  const serverBase = localStorage.getItem('cv_server_url') || ''

  if (subtitleTicket && activeSubtitle === 'sidecar' && hasSidecar) {
    subtitlesUrl = `${serverBase}/api/v1/stream/subtitles?path=${encodeURIComponent(vaultPath)}&seek=${localUrl ? 0 : seekOffset}&token=${subtitleTicket}`
  } else if (subtitleTicket && typeof activeSubtitle === 'number') {
    subtitlesUrl = `${serverBase}/api/v1/stream/subtitles/vtt?path=${encodeURIComponent(vaultPath)}&index=${activeSubtitle}&seek=${seekOffset}&token=${subtitleTicket}`
  }

  const mimeType = needsTranscode ? 'video/mp4' : (ext === '.webm' ? 'video/webm' : 'video/mp4')

  return (
    <div className={`player-page ${isTheater ? 'is-theater' : ''}`}>
      {/* Header */}
      <div className="player-header glass">
        <div className="header-left">
          <button onClick={() => navigate(-1)} className="btn btn-ghost btn-sm" style={{ padding: '0 var(--sp-2)' }}>
            <ArrowLeft size={18} /> Back
          </button>
          <h1 className="player-title truncate">{title}</h1>
        </div>
      </div>

      {/* Player stage */}
      <div className="player-stage">
        {playbackRequestError && <p role="alert">Could not authorize the playback change. Your previous selection is unchanged; please try the control again.</p>}
        {streamUrl ? (
          <CinemaPlayer
            key={`player-${!!localUrl}`}
            src={localUrl ? { src: streamUrl, type: 'video/mp4' } : { src: streamUrl, type: mimeType }}
            title={title}
            poster={posterImage}
            duration={duration}
            seekOffset={localUrl ? 0 : seekOffset}
            initialTime={localUrl ? seekOffset : (needsTranscode ? 0 : directPosition)}
            onUserSeek={localUrl ? undefined : handleSeek}
            subtitlesUrl={localUrl ? null : subtitlesUrl}
            hasSidecarSubtitles={!localUrl && !!hasSidecar}
            isTranscoding={!localUrl && needsTranscode}
            audioTracks={localUrl ? [] : audioTracks}
            activeAudio={activeAudio}
            onAudioChange={handleAudioChange}
            subtitleTracks={localUrl ? [] : subtitleTracks}
            activeSubtitle={activeSubtitle}
            onSubtitleChange={handleSubtitleChange}
            isTheater={isTheater}
            onTheaterToggle={() => setIsTheater(p => !p)}
          />
        ) : vaultPath && !localUrl ? (
          <div className="player-no-file">
            {streamTicketError
              ? <AlertTriangle className="no-file-icon" size={64} style={{marginBottom:'var(--sp-4)', opacity:0.7}} />
              : <RefreshCw className="no-file-icon animate-spin" size={64} style={{marginBottom:'var(--sp-4)', opacity:0.7}} />}
            <h2>{streamTicketError ? 'Secure playback unavailable' : 'Preparing secure playback'}</h2>
            <p className="text-muted text-sm">
              {streamTicketError
                ? 'CineVault could not create a short-lived playback ticket. Please go back and try again.'
                : 'Requesting a short-lived playback ticket…'}
            </p>
          </div>
        ) : (
          <div className="player-no-file">
            <Film className="no-file-icon" size={64} style={{marginBottom:'var(--sp-4)', opacity:0.5}} />
            <h2>No content available</h2>
            <p className="text-muted text-sm">This title hasn't had a file ingested into the vault yet.</p>
            {media.trailerUrl && (
              <a href={media.trailerUrl} target="_blank" rel="noopener noreferrer"
                className="btn btn-primary" style={{ marginTop: 'var(--sp-5)', display:'flex', alignItems:'center', gap:'8px' }}>
                <PlayCircle size={18} /> Watch Trailer Instead
              </a>
            )}
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="player-meta page-content">
        <div className="player-meta-heading">
          <h2 className="player-meta-title">{media.title}</h2>
        </div>
        {media.description && <p className="player-desc text-muted">{media.description}</p>}
        {media.cast?.length > 0 && (
          <p className="text-sm text-muted">
            <strong>Cast: </strong>{media.cast.slice(0, 5).map(c => c.name).join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}
