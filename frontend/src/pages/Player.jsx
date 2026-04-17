import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { getMovie, getTVShow, getEpisodes, saveProgress, getStreamInfo } from '../api'
import { ArrowLeft, Film, PlayCircle, RefreshCw, AlertTriangle } from 'lucide-react'
import CinemaPlayer from '../components/CinemaPlayer'
import { OfflineStorageService } from '../services/OfflineStorageService'
import './Player.css'

const TRANSCODE_EXTS = new Set(['.mkv', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m2ts'])

function buildStreamUrl(vaultPath, token, seekSeconds = 0, audioIndex = 0) {
  if (!vaultPath) return null
  const ext = '.' + vaultPath.split('.').pop().toLowerCase()
  const needsTranscode = TRANSCODE_EXTS.has(ext)
  const params = new URLSearchParams({ path: vaultPath, token })
  // We MUST transcode if: format is incompatible OR user is seeking OR switching audio
  if (needsTranscode || seekSeconds > 0 || audioIndex > 0) {
    params.set('transcode', 'true')
    if (seekSeconds > 0) params.set('seek', String(Math.floor(seekSeconds)))
    if (audioIndex > 0) params.set('audio', String(audioIndex))
  }
  // ANDROID FIX: In Capacitor, relative URLs resolve to capacitor://localhost which
  // can't reach the backend. Use the saved server URL (tunnel) if available.
  const serverBase = localStorage.getItem('cv_server_url') || ''
  return `${serverBase}/api/stream?${params.toString()}`
}

export default function Player() {
  const { type, id } = useParams()
  const [searchParams] = useSearchParams()
  const epId = searchParams.get('ep')

  const [media, setMedia] = useState(null)
  const [episode, setEpisode] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isTheater, setIsTheater] = useState(false)
  const [seekOffset, setSeekOffset] = useState(0)
  const [audioTracks, setAudioTracks] = useState([])
  const [activeAudio, setActiveAudio] = useState(0)
  const [subtitleTracks, setSubtitleTracks] = useState([])
  const [activeSubtitle, setActiveSubtitle] = useState('sidecar')
  const [localUrl, setLocalUrl] = useState(null)

  const progressTimer = useRef(null)

  // ── Load media ─────────────────────────────────────────────────────────
  useEffect(() => {
    const fetcher = type === 'movie' ? getMovie(id) : getTVShow(id)
    fetcher.then(async res => {
      setMedia(res.data)
      if (type === 'tvshow' && epId) {
        const eps = await getEpisodes(id)
        setEpisode(eps.data.find(e => e._id === epId) || null)
      }
    }).finally(() => setLoading(false))
  }, [id, type, epId])

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

    const mediaToLookup = episode?._id || id
    let objectUrl = null

    OfflineStorageService.getLocalUrl(mediaToLookup).then(url => {
      if (url) {
        console.log('[Player] Found local file! Bypassing streaming server.')
        objectUrl = url
        setLocalUrl(url)
      }
    })

    return () => {
      if (objectUrl && objectUrl.startsWith('blob:')) {
        console.log('[Player] Revoking ObjectURL:', objectUrl)
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [media, episode, id])

  // ── Load audio/subtitle tracks (streaming only) ───────────────────────
  useEffect(() => {
    if (!media || localUrl) return  // skip if playing offline local file
    const vaultPath = episode?.vaultPath || media?.vaultPath
    if (!vaultPath) return

    getStreamInfo(vaultPath)
      .then(res => {
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
  }, [media, episode, localUrl])

  // ── Progress tracking ─────────────────────────────────────────────────
  useEffect(() => {
    if (!media) return
    progressTimer.current = setInterval(() => {
      const video = document.querySelector('video')
      if (!video || video.paused) return
      const absolutePos = Math.floor(seekOffset + video.currentTime)
      if (absolutePos > 0) {
        saveProgress({
          mediaId: id,
          mediaType: type,
          episodeId: epId,
          progressSeconds: absolutePos,
          completed: video.duration > 0 && ((seekOffset + video.currentTime) / video.duration) > 0.95
        }).catch(console.error)
      }
    }, 10000)
    return () => clearInterval(progressTimer.current)
  }, [media, episode, id, type, epId, seekOffset])

  // ── Keyboard: T = theater ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey)
        setIsTheater(p => !p)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleSeek = useCallback((t) => setSeekOffset(Math.floor(t)), [])
  const handleAudioChange = useCallback((idx) => {
    // Snapshot current position before switching track
    const video = document.querySelector('video')
    const currentAbs = Math.floor(seekOffset + (video?.currentTime || 0))
    setSeekOffset(currentAbs)
    setActiveAudio(idx)
  }, [seekOffset])

  // ─────────────────────────────────────────────────────────────────────
  if (loading) return <div className="loading-center player-loading"><RefreshCw className="animate-spin" size={48} /></div>
  if (!media) return <div className="page-content"><p>Content not found.</p></div>

  const title = type === 'tvshow' && episode
    ? `${media.title} — S${episode.season}E${String(episode.episode).padStart(2, '0')} "${episode.title || 'Episode ' + episode.episode}"`
    : media.title
  const vaultPath = episode?.vaultPath || media.vaultPath
  const token = localStorage.getItem('cv_token')
  const ext = vaultPath ? '.' + vaultPath.split('.').pop().toLowerCase() : ''
  const needsTranscode = TRANSCODE_EXTS.has(ext)

  const duration = media.duration
    || (media.runtime ? media.runtime * 60 : 0) // Movie runtime is usually minutes (TMDB)
    || (episode?.runtime ? episode.runtime : 0) // Episode runtime is stored as total seconds
    || 0

  const streamUrl = localUrl || buildStreamUrl(vaultPath, token, seekOffset, activeAudio)

  let subtitlesUrl = null
  const hasSidecar = episode?.hasSidecarSubtitles || media?.hasSidecarSubtitles
  const serverBase = localStorage.getItem('cv_server_url') || ''

  if (activeSubtitle === 'sidecar' && hasSidecar) {
    subtitlesUrl = `${serverBase}/api/stream/subtitles?path=${encodeURIComponent(vaultPath)}&token=${token}`
  } else if (typeof activeSubtitle === 'number') {
    subtitlesUrl = `${serverBase}/api/stream/subtitles/vtt?path=${encodeURIComponent(vaultPath)}&index=${activeSubtitle}&seek=${seekOffset}&token=${token}`
  }

  const mimeType = needsTranscode ? 'video/mp4' : (ext === '.webm' ? 'video/webm' : 'video/mp4')

  return (
    <div className={`player-page ${isTheater ? 'is-theater' : ''}`}>
      {/* Header */}
      <div className="player-header glass">
        <div className="header-left">
          <Link to={`/detail/${type}/${id}`} className="btn btn-ghost btn-sm" style={{display:'flex', alignItems:'center', gap:'8px'}}>
            <ArrowLeft size={18} /> Back
          </Link>
          <h1 className="player-title truncate">{title}</h1>
        </div>
      </div>

      {/* Player stage */}
      <div className="player-stage">
        {streamUrl ? (
          <CinemaPlayer
            key={`${streamUrl}-${activeAudio}-${!!localUrl}`}
            src={localUrl ? { src: streamUrl, type: 'video/mp4' } : { src: streamUrl, type: mimeType }}
            title={title}
            poster={media.posterUrl || media.backdropUrl}
            duration={duration}
            seekOffset={seekOffset}
            onUserSeek={handleSeek}
            subtitlesUrl={localUrl ? null : subtitlesUrl}
            isTranscoding={!localUrl && needsTranscode}
            audioTracks={localUrl ? [] : audioTracks}
            activeAudio={activeAudio}
            onAudioChange={handleAudioChange}
            subtitleTracks={localUrl ? [] : subtitleTracks}
            activeSubtitle={activeSubtitle}
            onSubtitleChange={setActiveSubtitle}
            isTheater={isTheater}
            onTheaterToggle={() => setIsTheater(p => !p)}
          />
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
