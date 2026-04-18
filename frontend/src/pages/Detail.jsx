import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getMovie, getTVShow, getSeasonEpisodes, addToWatchlist, getMe, deleteMovie, deleteTVShow, deleteEpisode, resolveUrl } from '../api'
import { Clapperboard, MonitorPlay, Clock, Star, Play, PlayCircle, Plus, Check, Trash2, Download } from 'lucide-react'
import DownloadButton from '../components/DownloadButton'
import ConfirmModal from '../components/ConfirmModal'
import './Detail.css'

// Web-only file download (browser's native Save As)
const isCapacitor = typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.())

function buildBrowserDownloadUrl(vaultPath, token) {
  if (!vaultPath || !token) return null
  const serverBase = localStorage.getItem('cv_server_url') || ''
  return `${serverBase}/api/stream?path=${encodeURIComponent(vaultPath)}&token=${token}&download=true`
}

export default function Detail() {
  const { type, id } = useParams()
  const [media, setMedia] = useState(null)
  const [episodes, setEpisodes] = useState([])
  const [activeSeason, setActiveSeason] = useState(1)
  const [showTrailer, setShowTrailer] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletingEpisode, setDeletingEpisode] = useState(null)
  const [loading, setLoading] = useState(true)
  const [watchlisted, setWatchlisted] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    const fetcher = type === 'movie' ? getMovie(id) : getTVShow(id)
    
    Promise.all([
      fetcher,
      getMe().catch(() => ({ data: { watchlist: [] } }))
    ]).then(([mediaRes, userRes]) => {
      setMedia(mediaRes.data)
      const inWatchlist = userRes.data.watchlist?.some(w => w.mediaId === id)
      setWatchlisted(inWatchlist)
      setIsAdmin(userRes.data.isAdmin || false)
      
      if (type === 'tvshow') {
        getSeasonEpisodes(id, 1).then(r => setEpisodes(r.data))
      }
    }).finally(() => setLoading(false))
  }, [id, type])

  useEffect(() => {
    if (type === 'tvshow' && media)
      getSeasonEpisodes(id, activeSeason).then(r => setEpisodes(r.data))
  }, [activeSeason])

  // Lock scrolling when trailer is open
  useEffect(() => {
    document.body.style.overflow = showTrailer ? 'hidden' : 'unset'
    return () => { document.body.style.overflow = 'unset' }
  }, [showTrailer])

  async function handleWatchlist() {
    try {
      await addToWatchlist(media._id, type)
      setWatchlisted(true)
    } catch {}
  }

  async function handleConfirmDelete(deleteFile) {
    try {
      if (deletingEpisode) {
        await deleteEpisode(media._id, deletingEpisode._id, deleteFile)
        setEpisodes(episodes.filter(e => e._id !== deletingEpisode._id))
        setDeletingEpisode(null)
      } else {
        if (type === 'movie') await deleteMovie(media._id, deleteFile)
        else await deleteTVShow(media._id, deleteFile)
        navigate('/')
      }
    } catch (err) {
      setDeleteError('Failed to delete: ' + (err.response?.data || err.message))
    } finally {
      setShowDeleteModal(false)
    }
  }

  const getYoutubeId = (url) => {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  if (loading) return <div className="loading-center" style={{minHeight:'100vh'}}><div className="spinner"/></div>
  if (!media)  return <div className="page-content"><p>Content not found.</p></div>

  const seasons = media.totalSeasons
    ? Array.from({ length: media.totalSeasons }, (_, i) => i + 1)
    : []

  const youtubeId = getYoutubeId(media.trailerUrl);

  return (
    <div className="detail-page">
      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={showDeleteModal}
        title={deletingEpisode ? 'Delete Episode' : `Delete ${type === 'movie' ? 'Movie' : 'TV Show'}`}
        danger
        confirmLabel="Delete (Keep File)"
        cancelLabel="Cancel"
        onConfirm={() => handleConfirmDelete(false)}
        onCancel={() => { setShowDeleteModal(false); setDeletingEpisode(null); setDeleteError('') }}
      >
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--sp-3)' }}>
          {deletingEpisode
            ? `Remove "${deletingEpisode.title || 'this episode'}" from the database?`
            : `Remove "${media?.title}" from CineVault?`}
        </p>
        {deleteError && <div className="alert alert-error" style={{ marginBottom: 'var(--sp-3)' }}>{deleteError}</div>}
        <button
          className="btn btn-danger"
          style={{ width: '100%', marginBottom: 'var(--sp-2)' }}
          onClick={() => handleConfirmDelete(true)}
        >
          Delete + Remove Source File
        </button>
      </ConfirmModal>

      {/* Backdrop */}
      {media.backdropUrl && (
        <div className="detail-backdrop" style={{ backgroundImage: `url(${resolveUrl(media.backdropUrl)})` }}>
          <div className="detail-backdrop-fade" />
        </div>
      )}

      {/* Trailer Modal */}
      {showTrailer && youtubeId && (
        <div className="trailer-overlay" onClick={() => setShowTrailer(false)}>
          <div className="trailer-container" onClick={e => e.stopPropagation()}>
            <div className="trailer-aspect">
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&playsinline=1`}
                title="Trailer"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
          </div>
          <div className="trailer-actions">
            <button className="trailer-close-pill" onClick={() => setShowTrailer(false)}>
              Close Trailer
            </button>
          </div>
        </div>
      )}

      <div className="page-content detail-content animate-fadeUp">
        <div className="detail-main">
          {/* Poster */}
          <div className="detail-poster">
            {media.posterUrl
              ? <img src={resolveUrl(media.posterUrl)} alt={media.title} />
              : <div className="detail-poster-placeholder">{media.title?.charAt(0)}</div>
            }
          </div>

          {/* Info */}
          <div className="detail-info">
            <div className="detail-badges">
              {media.genres?.map(g => (
                <Link key={g._id} to={`/browse/${g.slug}`} className="badge badge-accent">{g.name}</Link>
              ))}
              {media.year && <span className="badge badge-muted">{media.year}</span>}
              {media.status && type === 'tvshow' && (
                <span className={`badge ${media.status === 'ongoing' ? 'badge-success' : 'badge-muted'}`}>
                  {media.status}
                </span>
              )}
            </div>

            <h1 className="detail-title">{media.title}</h1>

            <div className="detail-meta">
              {media.rating > 0 && <span className="detail-rating"><Star size={14} fill="currentColor" /> {media.rating.toFixed(1)}/10</span>}
              {media.director && <span><Clapperboard size={14} /> {media.director}</span>}
              {media.network && <span><MonitorPlay size={14} /> {media.network}</span>}
              {media.runtime > 0 && <span><Clock size={14} /> {media.runtime} min</span>}
              {media.totalSeasons > 0 && <span>{media.totalSeasons} Season{media.totalSeasons > 1 ? 's' : ''}</span>}
            </div>

            {media.tagline && <p className="detail-tagline">"{media.tagline}"</p>}
            {media.description && <p className="detail-desc">{media.description}</p>}

            <div className="detail-actions">
              {type === 'movie' && media.userProgress && !media.userProgress.completed && media.userProgress.progressSeconds > 0 ? (
                <Link to={`/watch/movie/${media._id}`} className="btn btn-primary btn-lg">
                  <Play size={20} fill="currentColor" /> Resume Movie
                </Link>
              ) : type === 'tvshow' && media.resumePoint ? (
                <Link to={`/watch/tvshow/${media._id}?ep=${media.resumePoint.episodeId}`} className="btn btn-primary btn-lg">
                  <Play size={20} fill="currentColor" /> Resume S{media.resumePoint.season}:E{media.resumePoint.episode}
                </Link>
              ) : (
                <Link 
                  to={type === 'movie' ? `/watch/movie/${media._id}` : (episodes[0] ? `/watch/tvshow/${media._id}?ep=${episodes[0]._id}` : '#')} 
                  className="btn btn-primary btn-lg"
                  onClick={e => { if (type==='tvshow' && !episodes[0]) e.preventDefault(); }}
                >
                  <Play size={20} fill="currentColor" /> Play
                </Link>
              )}
              
              {isCapacitor && type === 'movie' && (
                <DownloadButton 
                  mediaId={media._id}
                  url={media.vaultPath ? resolveUrl(`/api/stream?path=${encodeURIComponent(media.vaultPath)}&download=true`) : null}
                  type="movie"
                  metadata={{ title: media.title, posterUrl: media.posterUrl }}
                  variant="detail"
                />
              )}
              {/* Web browser direct download — only on non-Capacitor */}
              {!isCapacitor && type === 'movie' && media.vaultPath && (() => {
                const token = localStorage.getItem('cv_token')
                const dlUrl = buildBrowserDownloadUrl(media.vaultPath, token)
                return dlUrl ? (
                  <a href={dlUrl} download className="btn btn-ghost btn-lg" title="Download file to disk">
                    <Download size={20} /> Save File
                  </a>
                ) : null
              })()}

              <button
                className={`btn btn-ghost btn-lg ${watchlisted ? 'watchlisted' : ''}`}
                onClick={handleWatchlist}
                disabled={watchlisted}
              >
                {watchlisted ? <><Check size={20} /> In Watchlist</> : <><Plus size={20} /> Watchlist</>}
              </button>
              {youtubeId && (
                <button 
                  onClick={() => setShowTrailer(true)} 
                  className="btn btn-ghost btn-lg"
                >
                  <PlayCircle size={20} /> Trailer
                </button>
              )}
              {isAdmin && (
                <button 
                  onClick={() => setShowDeleteModal(true)} 
                  className="btn btn-ghost btn-lg"
                  style={{borderColor:'var(--danger)', color:'var(--danger)'}}
                >
                  <Trash2 size={20} /> Admin Delete
                </button>
              )}
            </div>

            {/* DELETE MODAL */}
            {showDeleteModal && (
              <div style={{
                position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', zIndex:2000,
                display:'flex', alignItems:'center', justifyContent:'center', padding:'var(--sp-4)', backdropFilter:'blur(5px)'
              }}>
                <div className="card" style={{maxWidth:450, width:'100%', textAlign:'center', border:'1px solid var(--border)'}}>
                  <h2 style={{fontSize:'var(--fs-xl)', fontWeight:800, marginBottom:'var(--sp-2)', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px'}}>
                    <Trash2 size={24} /> {deletingEpisode ? 'Delete Episode' : 'Delete Media'}
                  </h2>
                  <p className="text-muted text-sm" style={{marginBottom:'var(--sp-8)'}}>
                    How would you like to remove <strong>{deletingEpisode ? deletingEpisode.title || `Episode ${deletingEpisode.episode}` : media.title}</strong>?
                  </p>
                  
                  <div style={{display:'flex', flexDirection:'column', gap:'var(--sp-3)'}}>
                    <button className="btn btn-ghost" onClick={() => handleConfirmDelete(false)} style={{justifyContent:'center', padding:'var(--sp-4)'}}>
                      <div>
                        <div style={{fontWeight:700}}>Remove Record Only</div>
                        <div style={{fontSize:10, opacity:0.6}}>Keep physical file on disk</div>
                      </div>
                    </button>
                    
                    <button className="btn btn-danger" onClick={() => handleConfirmDelete(true)} style={{justifyContent:'center', padding:'var(--sp-4)', background:'rgba(255,59,48,0.15)', border:'1px solid var(--danger)'}}>
                      <div>
                        <div style={{fontWeight:700}}>🔥 Delete Physical File & Record</div>
                        <div style={{fontSize:10, opacity:0.8}}>Permanently reclaim space</div>
                      </div>
                    </button>

                    <button className="btn btn-icon" style={{marginTop:'var(--sp-4)'}} onClick={() => { setShowDeleteModal(false); setDeletingEpisode(null); }}>
                       Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Cast */}
            {media.cast?.length > 0 && (
              <div className="cast-section">
                <h3 className="cast-title">Cast</h3>
                <div className="cast-list">
                  {media.cast.slice(0, 15).map((c, i) => (
                    <div key={i} className="cast-member">
                      <div className="cast-avatar">
                        {c.profileUrl
                          ? <img src={resolveUrl(c.profileUrl)} alt={c.name} />
                          : <span>{c.name?.charAt(0)}</span>
                        }
                      </div>
                      <p className="cast-name truncate">{c.name}</p>
                      {c.character && <p className="cast-char truncate">{c.character}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pictures */}
            {media.images?.length > 0 && (
              <div className="cast-section" style={{ marginTop: 'var(--sp-6)' }}>
                <h3 className="cast-title">Pictures</h3>
                <div className="cast-list">
                  {media.images.map((img, i) => (
                    <div key={i} className="picture-item">
                      <img src={resolveUrl(img)} alt={`Backdrop ${i+1}`} loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trivial Facts */}
            {media.facts && Object.keys(media.facts).length > 0 && (
              <div className="cast-section" style={{ marginTop: 'var(--sp-6)' }}>
                <h3 className="cast-title">Production Details</h3>
                <div className="facts-grid">
                  {media.facts.budget > 0 && (
                    <div className="fact-card glass">
                      <div className="fact-label">Budget</div>
                      <div className="fact-value">${media.facts.budget.toLocaleString()}</div>
                    </div>
                  )}
                  {media.facts.revenue > 0 && (
                    <div className="fact-card glass">
                      <div className="fact-label">Box Office</div>
                      <div className="fact-value">${media.facts.revenue.toLocaleString()}</div>
                    </div>
                  )}
                  {media.facts.status && (
                    <div className="fact-card glass">
                      <div className="fact-label">Status</div>
                      <div className="fact-value">{media.facts.status}</div>
                    </div>
                  )}
                  {media.facts.network && (
                    <div className="fact-card glass">
                      <div className="fact-label">Network</div>
                      <div className="fact-value">{media.facts.network}</div>
                    </div>
                  )}
                  {media.facts.type && (
                    <div className="fact-card glass">
                      <div className="fact-label">Type</div>
                      <div className="fact-value">{media.facts.type}</div>
                    </div>
                  )}
                  {media.facts.productionCompanies?.length > 0 && (
                    <div className="fact-card glass" style={{ gridColumn: '1 / -1' }}>
                      <div className="fact-label">Studios</div>
                      <div className="fact-value">{media.facts.productionCompanies.join(', ')}</div>
                    </div>
                  )}
                  {media.facts.keywords?.length > 0 && (
                    <div className="fact-card glass" style={{ gridColumn: '1 / -1' }}>
                      <div className="fact-label">Keywords</div>
                      <div className="fact-value" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                        {media.facts.keywords.join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* TV — Seasons & Episodes */}
        {type === 'tvshow' && seasons.length > 0 && (
          <div className="episodes-section">
            <div className="season-tabs">
              {seasons.map(s => (
                <button
                  key={s}
                  className={`season-tab ${activeSeason === s ? 'active' : ''}`}
                  onClick={() => setActiveSeason(s)}
                >
                  Season {s}
                </button>
              ))}
            </div>
            <div className="episodes-list">
              {episodes.length === 0 && <p className="text-muted text-sm">No episodes added yet.</p>}
              {episodes.map(ep => (
                <div
                  key={ep._id}
                  className="episode-item glass"
                >
                  <div className="ep-number">
                    {ep.season}×{String(ep.episode).padStart(2, '0')}
                  </div>
                  <Link to={`/watch/tvshow/${media._id}?ep=${ep._id}`} className="ep-info">
                    <p className="ep-title">{ep.title || `Episode ${ep.episode}`}</p>
                    {ep.description && <p className="ep-desc truncate">{ep.description}</p>}
                  </Link>
                  <div style={{display:'flex', alignItems:'center', gap:'var(--sp-2)', flexShrink:0}}>
                    {ep.runtime > 0 && (
                      <span className="ep-runtime">{Math.round(ep.runtime / 60)} min</span>
                    )}
                    {isAdmin && (
                      <button 
                        className="btn-delete-ep"
                        onClick={() => {
                          setDeletingEpisode(ep);
                          setShowDeleteModal(true);
                        }}
                        title="Delete Episode"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                    
                    {isCapacitor && (
                      <DownloadButton 
                        mediaId={ep._id}
                        url={ep.vaultPath ? resolveUrl(`/api/stream?path=${encodeURIComponent(ep.vaultPath)}&download=true`) : null}
                        type="episode"
                        metadata={{ title: ep.title || `Episode ${ep.episode}`, posterUrl: media.posterUrl }}
                      />
                    )}
                    {/* Web browser download per episode */}
                    {!isCapacitor && ep.vaultPath && (() => {
                      const token = localStorage.getItem('cv_token')
                      const dlUrl = buildBrowserDownloadUrl(ep.vaultPath, token)
                      return dlUrl ? (
                        <a href={dlUrl} download className="btn btn-ghost btn-sm" title="Download episode">
                          <Download size={14} />
                        </a>
                      ) : null
                    })()}

                    <Link to={`/watch/tvshow/${media._id}?ep=${ep._id}`} className="ep-play"><Play size={14} fill="currentColor"/></Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
