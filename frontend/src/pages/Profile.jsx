import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getMe, updateProfile, getWatchlist, removeFromWatchlist, resolveUrl, getNetworkInfo } from '../api'
import { User, Film, History, Settings, Trash2, Clock, CheckCircle2, Database, DownloadCloud, Play } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import MediaCard from '../components/MediaCard'
import { OfflineCacheService } from '../services/OfflineCacheService'
import { OfflineStorageService } from '../services/OfflineStorageService'
import ConfirmModal from '../components/ConfirmModal'
import { Link } from 'react-router-dom'
import './Profile.css'

const isCapacitor = typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.())

export default function Profile() {
  const { user, setUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'profile'

  const [name, setName]           = useState(user?.name || '')
  const [picUrl, setPicUrl]       = useState(user?.profilePicUrl || '')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [error, setError]         = useState('')

  const [watchlist, setWatchlist] = useState([])
  const [wLoading, setWLoading]   = useState(false)
  const [hLoading, setHLoading]   = useState(false)
  const [downloads, setDownloads] = useState([])
  const [dLoading, setDLoading]   = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const messageRef = useRef(null)

  useEffect(() => {
    if (msg || error) {
      setTimeout(() => {
        messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    }
  }, [msg, error])

  // Server Configuration (for Android app / Cloudflare Tunnel)
  const [serverUrl, setServerUrl]     = useState(localStorage.getItem('cv_server_url') || '')
  const [serverMsg, setServerMsg]     = useState('')
  const [localIps, setLocalIps]       = useState([])

  useEffect(() => {
    if (activeTab === 'watchlist') {
      setWLoading(true)
      getWatchlist().then(r => setWatchlist(r.data)).finally(() => setWLoading(false))
    }
    if (activeTab === 'history') {
      setHLoading(true)
      getMe().then(r => setUser(r.data)).finally(() => setHLoading(false))
    }
    if (activeTab === 'downloads') {
      fetchDownloads()
      
      // Listen for global download changes to refresh list in real-time
      const handleGlobalSync = () => fetchDownloads();
      window.addEventListener('cv_download_change', handleGlobalSync);
      return () => window.removeEventListener('cv_download_change', handleGlobalSync);
    }
  }, [activeTab])

  async function fetchDownloads() {
    setDLoading(true)
    try {
      const items = await OfflineStorageService.getAllDownloads()
      setDownloads(items)
    } finally {
      setDLoading(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setError(''); setMsg('')
    if (password && password !== confirm) { setError('Passwords do not match.'); return }
    setSaving(true)
    try {
      const payload = { name, profilePicUrl: picUrl }
      if (password) payload.password = password
      const res = await updateProfile(payload)
      setUser(res.data)
      setMsg('Profile updated successfully!')
      setPassword(''); setConfirm('')
    } catch (err) {
      setError(err.response?.data || 'Update failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveWatchlist(mediaId) {
    await removeFromWatchlist(mediaId)
    setWatchlist(wl => wl.filter(w => w.mediaId !== mediaId))
  }

  async function handleDeleteDownload(id) {
    setDeleteConfirmId(id)
  }

  async function confirmDeleteDownload() {
    if (!deleteConfirmId) return
    await OfflineStorageService.deleteDownload(deleteConfirmId)
    setDownloads(d => d.filter(item => item.id !== deleteConfirmId))
    setDeleteConfirmId(null)
  }

  const tabs = [
    { key: 'profile',   label: 'Profile',   icon: User },
    { key: 'watchlist', label: 'Watchlist', icon: Film },
    { key: 'history',   label: 'History',   icon: History },
    ...(isCapacitor ? [{ key: 'downloads', label: 'Downloads', icon: DownloadCloud }] : []),
  ]

  function handleSaveServer() {
    const trimmed = serverUrl.trim().replace(/\/$/, '') // strip trailing slash
    if (trimmed) {
      localStorage.setItem('cv_server_url', trimmed)
      setServerMsg('Server URL saved! Reloading...')
      setTimeout(() => window.location.reload(), 1000)
    } else {
      localStorage.removeItem('cv_server_url')
      setServerMsg('Server URL cleared. Using default.')
      setTimeout(() => window.location.reload(), 1000)
    }
  }

  async function fetchLocalNetwork() {
    const isAndroid = typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.())
    if (isAndroid && !localStorage.getItem('cv_server_url')) {
      setServerMsg('📱 Android: auto-detect needs a server URL first. Enter manually: http://[PC local IP]:3000')
      return
    }
    const info = await getNetworkInfo()
    if (info?.localIps?.length) {
      setLocalIps(info.localIps.map(n => `http://${n.ip}:${info.port}`))
    } else {
      setServerMsg('Could not detect. Try: http://192.168.0.x:3000')
    }
  }

  async function handleClearCache() {
    if (!window.confirm('Clear all offline API cache? This will not delete your downloads.')) return;
    try {
      await OfflineCacheService.clearCache();
      setServerMsg('Offline cache cleared successfully!');
      setTimeout(() => setServerMsg(''), 3000);
    } catch (e) {
      setError('Failed to clear cache.');
    }
  }

  return (
    <div className="page-layout">
      <ConfirmModal
        open={!!deleteConfirmId}
        title="Delete Download"
        message="Are you sure? This will delete the downloaded file and reclaim storage space."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDeleteDownload}
        onCancel={() => setDeleteConfirmId(null)}
      />
      <div className="page-content profile-page animate-fadeUp">
        {/* Header */}
        <div className="profile-hero">
          <div className="profile-avatar-lg">
            {user?.profilePicUrl
              ? <img src={resolveUrl(user.profilePicUrl)} alt={user.name} />
              : <span>{user?.name?.charAt(0)?.toUpperCase()}</span>
            }
          </div>
          <div>
            <h1 className="profile-name">{user?.name}</h1>
            <p className="text-muted text-sm">{user?.email}</p>
            {user?.isAdmin && <span className="badge badge-accent" style={{marginTop:'var(--sp-2)'}}>Admin</span>}
          </div>
        </div>

        {/* Tabs */}
        <div className="profile-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`profile-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setSearchParams({ tab: t.key })}
            >
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </div>

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="card profile-form-card animate-fadeUp">
            <h2 style={{marginBottom:'var(--sp-6)'}}>Edit Profile</h2>
            <form onSubmit={handleSave} className="profile-form">
              <div ref={messageRef}>
                {msg   && <div className="alert alert-success">{msg}</div>}
                {error && <div className="alert alert-error">{error}</div>}
              </div>

              <div className="field">
                <label htmlFor="pname">Display Name</label>
                <input id="pname" type="text" className="input" value={name} onChange={e => setName(e.target.value)} required />
              </div>

              <div className="field">
                <label htmlFor="ppic">Profile Picture URL</label>
                <input id="ppic" type="url" className="input" placeholder="https://…" value={picUrl} onChange={e => setPicUrl(e.target.value)} />
              </div>

              {picUrl && (
                <div className="pic-preview">
                  <img src={picUrl} alt="preview" onError={e => e.target.style.display='none'} />
                </div>
              )}

              <hr style={{borderColor:'var(--border)', margin:'var(--sp-4) 0'}} />
              <p className="text-sm text-muted" style={{marginBottom:'var(--sp-4)'}}>Leave password fields blank to keep existing password.</p>

              <div className="field">
                <label htmlFor="ppw">New Password</label>
                <input id="ppw" type="password" className="input" placeholder="Min. 5 characters" value={password} onChange={e => setPassword(e.target.value)} />
              </div>

              <div className="field">
                <label htmlFor="ppwc">Confirm Password</label>
                <input id="ppwc" type="password" className="input" placeholder="Repeat new password" value={confirm} onChange={e => setConfirm(e.target.value)} />
              </div>

              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </form>

            {/* Server Configuration — for Android/Cloudflare Tunnel */}
            <hr style={{borderColor:'var(--border)', margin:'var(--sp-8) 0 var(--sp-6)'}} />
            <h3 style={{marginBottom:'var(--sp-2)', fontSize:'var(--fs-base)', display:'flex', alignItems:'center', gap:'8px'}}>
              <Settings size={18} /> Server Configuration
            </h3>
            <p className="text-sm text-muted" style={{marginBottom:'var(--sp-4)'}}>
              Set a custom backend URL (e.g. your Cloudflare Tunnel). Leave blank to use the default.
            </p>
            {serverMsg && <div className="alert alert-success" style={{marginBottom:'var(--sp-3)'}}>{serverMsg}</div>}
            <div className="server-config-section">
              <div className="server-config-controls">
                <input
                  type="url"
                  className="input"
                  placeholder="https://xxx.trycloudflare.com"
                  value={serverUrl}
                  onChange={e => setServerUrl(e.target.value)}
                />
                {/* Quick-fill chips */}
                {localIps.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)', marginTop: 'var(--sp-2)' }}>
                    {localIps.map(ip => (
                      <button
                        key={ip}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                        onClick={() => setServerUrl(ip)}
                      >
                        📡 {ip}
                      </button>
                    ))}
                  </div>
                )}
                <div className="server-config-buttons" style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex: '1 1 auto' }} onClick={fetchLocalNetwork}>Detect LAN IP</button>
                  <button className="btn btn-primary btn-sm" style={{ flex: '1 1 auto' }} onClick={handleSaveServer}>Save</button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: '1 1 auto', color: 'var(--danger)' }} onClick={() => { setServerUrl(''); handleSaveServer() }}>Clear</button>
                </div>
              </div>
            </div>
            {localStorage.getItem('cv_server_url') && (
              <p className="text-xs text-muted server-url-display" style={{marginTop:'var(--sp-2)'}}>
                Currently using: <strong>{localStorage.getItem('cv_server_url')}</strong>
              </p>
            )}

            {/* Offline Cache Management */}
            <hr style={{borderColor:'var(--border)', margin:'var(--sp-8) 0 var(--sp-6)'}} />
            <h3 style={{marginBottom:'var(--sp-2)', fontSize:'var(--fs-base)', display:'flex', alignItems:'center', gap:'8px'}}>
              <Database size={18} /> Offline Data & Cache
            </h3>
            <p className="text-sm text-muted" style={{marginBottom:'var(--sp-4)'}}>
              Discovery data (movies list, TV shows, and genres) are cached locally for 24 hours to enable offline browsing.
            </p>
            <button className="btn btn-ghost" onClick={handleClearCache} style={{color:'var(--danger)', borderColor:'var(--danger)'}}>
              <Trash2 size={16} /> Clear Discovery Cache
            </button>
          </div>
        )}

        {/* Watchlist Tab */}
        {activeTab === 'watchlist' && (
          <div className="animate-fadeUp">
            <h2 className="section-heading" style={{marginBottom:'var(--sp-5)'}}>My Watchlist</h2>
            {wLoading
              ? <div className="loading-center"><div className="spinner"/></div>
              : watchlist.length === 0
                ? <div className="empty-state"><Film className="empty-icon" size={64} /><p>Your watchlist is empty.</p><span>Browse movies and shows and add them here.</span></div>
                : (
                  <div className="watchlist-grid">
                    {watchlist.map(w => (
                      <div key={w._id || w.mediaId} className="watchlist-entry">
                        <div className="watchlist-card-wrap">
                           <MediaCard item={w.media} type={w.mediaType} />
                        </div>
                        <button
                          className="btn btn-danger btn-sm watchlist-remove"
                          onClick={() => handleRemoveWatchlist(w.mediaId)}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )
            }
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="animate-fadeUp">
            <h2 className="section-heading" style={{marginBottom:'var(--sp-5)'}}>Watch History</h2>
            {hLoading 
              ? <div className="loading-center"><div className="spinner"/></div>
              : user?.watchHistory?.length === 0
                ? <div className="empty-state"><History className="empty-icon" size={64} /><p>No history yet.</p></div>
                : (
                  <div className="table-wrap card">
                    <table className="table">
                      <thead>
                        <tr><th>Title</th><th>Type</th><th>Progress</th><th>Watched</th></tr>
                      </thead>
                      <tbody>
                        {(user?.watchHistory || []).slice(0, 50).map((h, i) => (
                          <tr key={i}>
                            <td data-label="Title">
                               <div style={{display:'flex', flexDirection:'column'}}>
                                  <span>{h.media?.title || h.mediaId}</span>
                                  {h.episode && (
                                    <span className="text-muted" style={{fontSize: '11px'}}>
                                      S{h.episode.season}:E{h.episode.episode} — {h.episode.title}
                                    </span>
                                  )}
                               </div>
                            </td>
                            <td data-label="Type"><span className="badge badge-muted">{h.mediaType}</span></td>
                            <td data-label="Progress">{h.completed ? <span className="badge badge-success"><CheckCircle2 size={12} /> Done</span> : `${Math.round(h.progressSeconds / 60)} min`}</td>
                            <td data-label="Watched"><div style={{display:'flex', alignItems:'center', gap:'6px'}}><Clock size={12} /> {new Date(h.watchedAt).toLocaleDateString()}</div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
            }
          </div>
        )}

        {/* Downloads Tab */}
        {isCapacitor && activeTab === 'downloads' && (
          <div className="animate-fadeUp">
            <h2 className="section-heading" style={{marginBottom:'var(--sp-5)'}}>My Downloads</h2>
            {dLoading 
              ? <div className="loading-center"><div className="spinner"/></div>
              : downloads.length === 0
                ? <div className="empty-state">
                    <DownloadCloud className="empty-icon" size={64} />
                    <p>No downloads yet.</p>
                    <span>Items you download for offline viewing will appear here.</span>
                  </div>
                : (
                  <div className="downloads-grid">
                    {downloads.map(d => (
                      <div key={d.id} className="download-card card glass">
                         <div className="download-card-poster">
                           {d.metadata?.posterUrl ? <img src={resolveUrl(d.metadata.posterUrl)} alt=""/> : <div className="poster-placeholder" />}
                           <Link to={`/watch/${d.type}/${d.id}`} className="play-overlay">
                             <Play size={48} fill="currentColor" />
                           </Link>
                         </div>
                         <div className="download-card-body">
                           <h3 className="download-card-title truncate">{d.metadata?.title || 'Unknown Title'}</h3>
                           <p className="download-card-meta">{d.type === 'tvshow' ? 'Series' : 'Movie'} • {new Date(d.timestamp).toLocaleDateString()}</p>
                           <div className="download-card-actions">
                              <Link to={`/watch/${d.type}/${d.id}`} className="btn btn-primary btn-sm btn-icon-only">
                                <Play size={16} fill="currentColor" />
                              </Link>
                              <button 
                                className="btn btn-ghost btn-sm btn-icon-only text-danger" 
                                onClick={() => handleDeleteDownload(d.id)}
                                title="Delete Download"
                              >
                                <Trash2 size={16} />
                              </button>
                           </div>
                         </div>
                      </div>
                    ))}
                  </div>
                )
            }
          </div>
        )}
      </div>
    </div>
  )
}
