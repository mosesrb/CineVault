import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { getTVShows, deleteTVShow, syncShowMeta, resolveUrl } from '../../api'
import { Star, RefreshCw, Trash2, ChevronLeft, Settings } from 'lucide-react'
import MetadataModal from './MetadataModal'

export default function AdminTVShows() {
  const [shows, setShows]   = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [search, setSearch] = useState('')
  const [showMetadataModal, setShowMetadataModal] = useState(false)
  const [modalTarget, setModalTarget] = useState(null)

  useEffect(() => {
    getTVShows().then(r => setShows(r.data)).finally(() => setLoading(false))
  }, [])

  const filtered = shows.filter(s => s.title.toLowerCase().includes(search.toLowerCase()))

  async function handleSync(id) {
    setSyncing(id)
    try {
      const r = await syncShowMeta(id)
      setShows(ss => ss.map(s => s._id === id ? r.data : s))
    } catch {} finally { setSyncing(null) }
  }

  async function handleDelete(id, title) {
    if (!confirm(`Remove "${title}" and all its episodes from library?`)) return
    setDeleting(id)
    try {
      await deleteTVShow(id)
      setShows(ss => ss.filter(s => s._id !== id))
    } catch {} finally { setDeleting(null) }
  }

  const statusColor = s => s === 'ongoing' ? 'success' : s === 'ended' ? 'muted' : 'danger'

  return (
    <div className="animate-fadeUp">
      <div className="admin-search-row" style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'var(--sp-6)', gap:'var(--sp-4)'}}>
        <div style={{display:'flex', alignItems:'center', gap:'var(--sp-2)'}}>
          <Link to="/admin" className="btn btn-ghost btn-sm" style={{padding:8, borderRadius:'50%', width:36, height:36, justifyContent:'center'}}>
            <ChevronLeft size={20} />
          </Link>
          <h1 className="section-heading">TV Shows ({shows.length})</h1>
        </div>
        <input
          className="input"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{width:220}}
        />
      </div>

      {loading
        ? <div className="loading-center"><div className="spinner"/></div>
        : (
          <div className="admin-table-container card">
            <table className="admin-table">
              <thead>
                <tr><th>Show</th><th>Year</th><th>Seasons</th><th>Status</th><th>Rating</th><th>Source</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} data-label="" style={{textAlign:'center', padding:'var(--sp-8)'}}>No shows found.</td></tr>
                )}
                {filtered.map(s => (
                  <tr key={s._id}>
                    <td data-label="Show">
                      <div style={{display:'flex', alignItems:'center', gap:'var(--sp-3)'}}>
                        {s.posterUrl && (
                          <img
                            src={resolveUrl(s.posterUrl)}
                            alt=""
                            style={{width:32, height:48, objectFit:'cover', borderRadius:'var(--radius-sm)', flexShrink:0}}
                          />
                        )}
                        <span style={{fontWeight:600, color:'var(--text-primary)'}}>{s.title}</span>
                      </div>
                    </td>
                    <td data-label="Year">{s.year || '—'}</td>
                    <td data-label="Seasons">{s.totalSeasons || '—'}</td>
                    <td data-label="Status">
                      <span className={`badge badge-${statusColor(s.status)}`}>{s.status || '—'}</span>
                    </td>
                    <td data-label="Rating">{s.rating ? <><Star size={12} fill="currentColor" /> {s.rating.toFixed(1)}</> : '—'}</td>
                    <td data-label="Source">
                      <span className={`badge badge-${s.metaSource === 'tmdb' ? 'success' : 'muted'}`}>{s.metaSource}</span>
                    </td>
                    <td className="td-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => {
                        setModalTarget(s);
                        setShowMetadataModal(true);
                      }}>
                        <Settings size={14} /> Manage Meta
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s._id, s.title)} disabled={deleting === s._id}>
                        {deleting === s._id ? <RefreshCw className="animate-spin" size={14} /> : <Trash2 size={14} />} Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      {showMetadataModal && modalTarget && (
        <MetadataModal 
          item={modalTarget}
          type="tvshow"
          onClose={() => setShowMetadataModal(false)}
          onSave={(updated) => {
            setShows(ss => ss.map(s => s._id === updated._id ? updated : s))
            setShowMetadataModal(false)
          }}
        />
      )}
    </div>
  )
}
