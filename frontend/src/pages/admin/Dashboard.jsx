import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Clapperboard, Tv, Film, Tag, AlertTriangle, Library, FolderOpen, Settings, RefreshCw, Users, KeyRound } from 'lucide-react'
import { getLibraryStats, getGenres } from '../../api'

export default function AdminDashboard() {
  const [stats, setStats]   = useState(null)
  const [genres, setGenres] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getLibraryStats(), getGenres()])
      .then(([sRes, gRes]) => { setStats(sRes.data); setGenres(gRes.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading-center"><div className="spinner"/></div>

  const cards = [
    { icon: Clapperboard, label: 'Movies',      value: stats?.totalMovies   ?? '—', to: '/admin/movies'   },
    { icon: Tv,           label: 'TV Shows',    value: stats?.totalShows    ?? '—', to: '/admin/tvshows'  },
    { icon: Film,         label: 'Episodes',    value: stats?.totalEpisodes ?? '—', to: '/admin/tvshows'  },
    { icon: Tag,          label: 'Genres',      value: genres.length,               to: '/admin/genres'   },
    { icon: Users,        label: 'Users',       value: stats?.totalUsers    ?? '—', to: '/admin/users'    },
    { icon: KeyRound,     label: 'Sessions',    value: stats?.activeSessions ?? '—', to: '/admin/sessions' },
  ]

  return (
    <div className="animate-fadeUp">
      <h1 className="section-heading" style={{marginBottom:'var(--sp-6)'}}>Dashboard</h1>

      {/* ── Stat cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 'var(--sp-4)',
        marginBottom: 'var(--sp-8)'
      }}>
        {cards.map(c => (
          <Link
            key={c.label}
            to={c.to}
            className="card"
            style={{textDecoration:'none', textAlign:'center', padding:'var(--sp-5) var(--sp-4)'}}
          >
            <div style={{marginBottom:'var(--sp-2)', display:'flex', justifyContent:'center', color:'var(--accent)'}}>
              <c.icon size={32} />
            </div>
            <div style={{fontSize:'var(--fs-3xl)', fontWeight:900, letterSpacing:'-0.04em', lineHeight:1}}>
              {c.value}
            </div>
            <div style={{fontSize:'var(--fs-sm)', color:'var(--text-secondary)', marginTop:'var(--sp-2)'}}>
              {c.label}
            </div>
          </Link>
        ))}
      </div>

      {/* ── Vault not configured warning ── */}
      {!stats?.config && (
        <div className="card" style={{borderColor:'var(--accent)', borderStyle:'dashed', marginBottom:'var(--sp-6)'}}>
          <h2 style={{fontWeight:700, marginBottom:'var(--sp-3)', display:'flex', alignItems:'center', gap:'8px'}}>
            <AlertTriangle size={24} className="text-warning" /> Vault Not Configured
          </h2>
          <p className="text-muted text-sm" style={{marginBottom:'var(--sp-4)'}}>
            Set a vault root path to start adding and organizing your media library.
          </p>
          <Link to="/admin/library" className="btn btn-primary" style={{width:'100%', justifyContent:'center'}}>
            Configure Vault →
          </Link>
        </div>
      )}

      {/* ── Vault info ── */}
      {stats?.config && (
        <div className="card" style={{marginBottom:'var(--sp-6)'}}>
          <h2 style={{fontWeight:700, marginBottom:'var(--sp-5)', display:'flex', alignItems:'center', gap:'8px'}}>
            <Library size={24} /> Vault Configuration
          </h2>
          <div style={{display:'flex', flexDirection:'column', gap:'var(--sp-4)'}}>

            <div className="vault-config-row" style={{display:'flex', alignItems:'flex-start', gap:'var(--sp-3)'}}>
              <span className="text-muted text-sm" style={{minWidth:90, flexShrink:0, paddingTop:4}}>Root Path</span>
              <code style={{
                background:'var(--bg-raised)', padding:'var(--sp-2) var(--sp-3)',
                borderRadius:'var(--radius-sm)', fontSize:'var(--fs-xs)',
                flex:1, wordBreak:'break-all', display:'block'
              }}>
                {stats.config.vaultRootPath}
              </code>
            </div>

            <div className="vault-config-row" style={{display:'flex', alignItems:'flex-start', gap:'var(--sp-3)'}}>
              <span className="text-muted text-sm" style={{minWidth:90, flexShrink:0, paddingTop:4}}>Inbox</span>
              <code style={{
                background:'var(--bg-raised)', padding:'var(--sp-2) var(--sp-3)',
                borderRadius:'var(--radius-sm)', fontSize:'var(--fs-xs)',
                flex:1, wordBreak:'break-all', display:'block'
              }}>
                {stats.config.inboxPath}
              </code>
            </div>

            {stats.config.lastScannedAt && (
              <div className="vault-config-row" style={{display:'flex', alignItems:'center', gap:'var(--sp-3)'}}>
                <span className="text-muted text-sm" style={{minWidth:90, flexShrink:0}}>Last Scan</span>
                <span style={{fontSize:'var(--fs-sm)'}}>{new Date(stats.config.lastScannedAt).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="dashboard-actions" style={{marginTop:'var(--sp-5)', display:'flex', gap:'var(--sp-3)'}}>
            <Link to="/admin/library" className="btn btn-ghost btn-sm" style={{flex:1, justifyContent:'center'}}>
              <Settings size={14} /> Configure Vault
            </Link>
            <Link to="/admin/library" className="btn btn-ghost btn-sm" style={{flex:1, justifyContent:'center'}}>
              <RefreshCw size={14} /> Scan Now
            </Link>
          </div>
        </div>
      )}

      {/* ── Genre list ── */}
      {genres.length > 0 && (
        <div className="card">
          <h2 style={{fontWeight:700, marginBottom:'var(--sp-4)', display:'flex', alignItems:'center', gap:'8px'}}>
            <Tag size={24} /> Genres ({genres.length})
          </h2>
          <div style={{display:'flex', flexWrap:'wrap', gap:'var(--sp-2)'}}>
            {genres.map(g => (
              <Link key={g._id} to={`/browse/${g.slug}`} className="badge badge-muted" style={{cursor:'pointer'}}>
                {g.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
