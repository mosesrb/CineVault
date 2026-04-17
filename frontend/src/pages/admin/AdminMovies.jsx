import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { getMovies, deleteMovie, syncMovieMeta, getGenres, resolveUrl } from '../../api'
import { Star, RefreshCw, Trash2, ChevronLeft } from 'lucide-react'

export default function AdminMovies() {
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    Promise.all([getMovies(), getGenres()])
      .then(([mRes]) => { setMovies(mRes.data) })
      .finally(() => setLoading(false))
  }, [])

  const filtered = movies.filter(m =>
    m.title.toLowerCase().includes(search.toLowerCase())
  )

  async function handleSync(id) {
    setSyncing(id)
    try {
      const r = await syncMovieMeta(id)
      setMovies(ms => ms.map(m => m._id === id ? r.data : m))
    } catch {} finally { setSyncing(null) }
  }

  async function handleDelete(id, title) {
    if (!confirm(`Remove "${title}" from library? The file will NOT be deleted.`)) return
    setDeleting(id)
    try {
      await deleteMovie(id)
      setMovies(ms => ms.filter(m => m._id !== id))
    } catch {} finally { setDeleting(null) }
  }

  return (
    <div className="animate-fadeUp">
      <div className="admin-search-row" style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'var(--sp-6)', gap:'var(--sp-4)'}}>
        <div style={{display:'flex', alignItems:'center', gap:'var(--sp-2)'}}>
          <Link to="/admin" className="btn btn-ghost btn-sm" style={{padding:8, borderRadius:'50%', width:36, height:36, justifyContent:'center'}}>
            <ChevronLeft size={20} />
          </Link>
          <h1 className="section-heading">Movies ({movies.length})</h1>
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
                <tr>
                  <th>Title</th><th>Year</th><th>Genres</th><th>Rating</th><th>Source</th><th>File</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} data-label="" style={{textAlign:'center', padding:'var(--sp-8)'}}>No movies found.</td></tr>
                )}
                {filtered.map(m => (
                  <tr key={m._id}>
                    <td data-label="Title">
                      <div style={{display:'flex', alignItems:'center', gap:'var(--sp-3)'}}>
                        {m.posterUrl && (
                          <img
                            src={resolveUrl(m.posterUrl)}
                            alt=""
                            style={{width:32, height:48, objectFit:'cover', borderRadius:'var(--radius-sm)', flexShrink:0}}
                          />
                        )}
                        <span style={{fontWeight:600, color:'var(--text-primary)'}}>{m.title}</span>
                      </div>
                    </td>
                    <td data-label="Year">{m.year || '—'}</td>
                    <td data-label="Genres">
                      <div style={{display:'flex', gap:4, flexWrap:'wrap', justifyContent:'flex-end'}}>
                        {m.genres?.slice(0,2).map(g => <span key={g._id||g} className="badge badge-muted">{g.name||g}</span>)}
                      </div>
                    </td>
                    <td data-label="Rating">{m.rating ? <><Star size={12} fill="currentColor" /> {m.rating.toFixed(1)}</> : '—'}</td>
                    <td data-label="Source">
                      <span className={`badge badge-${m.metaSource === 'tmdb' ? 'success' : m.metaSource === 'none' ? 'danger' : 'muted'}`}>
                        {m.metaSource}
                      </span>
                    </td>
                    <td data-label="File">
                      {m.vaultPath
                        ? <span className="badge badge-success">✓ Linked</span>
                        : <span className="badge badge-danger">No file</span>
                      }
                    </td>
                    <td className="td-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleSync(m._id)}
                        disabled={syncing === m._id}
                      >
                        {syncing === m._id ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} />} Sync Meta
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(m._id, m.title)}
                        disabled={deleting === m._id}
                      >
                        {deleting === m._id ? <RefreshCw className="animate-spin" size={14} /> : <Trash2 size={14} />} Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}
