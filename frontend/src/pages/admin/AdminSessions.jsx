import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getSessions, revokeSession, clearSessions } from '../../api'
import { Monitor, Globe, Clock, Ban, History, RefreshCw, ChevronLeft } from 'lucide-react'
import './AdminLayout.css'

export default function AdminSessions() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(null)

  useEffect(() => { loadSessions() }, [])

  const loadSessions = async () => {
    try {
      const res = await getSessions()
      setSessions(res.data)
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async (id) => {
    if (!window.confirm('Revoke this session? The device will be logged out immediately.')) return
    setRevoking(id)
    try {
      await revokeSession(id)
      setSessions(prev => prev.filter(s => s._id !== id))
    } finally {
      setRevoking(null)
    }
  }

  const handleClearAll = async () => {
    if (!window.confirm('Revoke ALL other sessions? Every other device will be logged out immediately.')) return
    setRevoking('all')
    try {
      await clearSessions()
      // Reload sessions after clearing (should only be the current one left)
      await loadSessions()
    } finally {
      setRevoking(null)
    }
  }

  const formatLastActive = (dateStr) => {
    const d = new Date(dateStr)
    const diff = Date.now() - d
    if (diff < 120000) return (
      <span className="text-accent-glow">
        <span className="status-dot" />Active Now
      </span>
    )
    return d.toLocaleString()
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div className="animate-fadeUp">
      <div className="admin-session-header" style={{ marginBottom: 'var(--sp-8)', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'var(--sp-4)', flexWrap:'wrap' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start', flex: 1, minWidth: 'min(100%, 300px)' }}>
          <Link to="/admin" className="btn btn-ghost btn-sm" style={{padding:8, borderRadius:'12px', width:40, height:40, justifyContent:'center', flexShrink:0, background:'var(--bg-glass)'}}>
            <ChevronLeft size={22} />
          </Link>
          <div>
            <h1 className="section-heading" style={{margin:0, fontSize: 'var(--fs-2xl)', fontWeight: 800}}>Active Sessions</h1>
            <p className="text-muted text-sm" style={{marginTop: 4, lineHeight: 1.4}}>Manage all devices connected to your CineVault instance.</p>
          </div>
        </div>
        <button
          className="btn btn-ghost"
          style={{ 
            color: 'var(--danger)', 
            borderColor: 'var(--danger)', 
            padding: '10px 16px',
            borderRadius: '12px',
            background: 'rgba(229, 54, 42, 0.05)'
          }}
          onClick={handleClearAll}
          disabled={revoking === 'all' || sessions.length <= 1}
        >
          {revoking === 'all' ? <RefreshCw className="animate-spin" size={16} /> : <Ban size={16} />} 
          <span style={{marginLeft: 8}}>Clear All Others</span>
        </button>
      </div>

      {sessions.length === 0 && (
        <div className="empty-state">
          <History className="empty-icon" size={64} />
          <p>No active sessions found — just you!</p>
        </div>
      )}

      {/* ── Desktop table ── */}
      <div className="admin-table-container card sessions-desktop">
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Device &amp; OS</th>
              <th>IP Address</th>
              <th>Last Active</th>
              <th style={{textAlign:'right'}}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s._id}>
                <td data-label="User">
                  <div style={{display:'flex', flexDirection:'column'}}>
                    <span style={{fontWeight:700, color:'var(--text-primary)'}}>{s.userId?.name || 'Unknown'}</span>
                    <span style={{fontSize:'11px', color:'var(--text-muted)'}}>{s.userId?.email}</span>
                  </div>
                </td>
                <td data-label="Device">
                  <div style={{display:'flex', flexDirection:'column', gap:4}}>
                    <span className="badge badge-accent" style={{alignSelf:'flex-end', fontSize:'10px'}}>{s.device?.platform}</span>
                    <span style={{fontSize:'12px', opacity:0.8, textAlign:'right'}}>{s.device?.os}</span>
                  </div>
                </td>
                <td data-label="IP">
                  <span className="text-code">{s.ip || 'Unknown'}</span>
                </td>
                <td data-label="Last Active">
                  <span style={{fontSize:'13px'}}>{formatLastActive(s.lastActiveAt)}</span>
                </td>
                <td data-label="Action" className="td-actions">
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => handleRevoke(s._id)}
                    disabled={revoking === s._id}
                    style={{color:'var(--danger)', borderColor:'var(--danger)', display:'flex', alignItems:'center', gap:'4px'}}
                  >
                    {revoking === s._id ? <RefreshCw className="animate-spin" size={14} /> : <Ban size={14} />} Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ── */}
      <div className="sessions-mobile">
        {sessions.map(s => (
          <div key={s._id} className="session-card">
            <div className="session-card-header">
              <div>
                <div style={{fontWeight:700, color:'var(--text-primary)', marginBottom:2}}>{s.userId?.name || 'Unknown'}</div>
                <div style={{fontSize:'var(--fs-xs)', color:'var(--text-muted)'}}>{s.userId?.email}</div>
              </div>
              <span className="badge badge-accent" style={{fontSize:'10px', alignSelf:'flex-start'}}>{s.device?.platform}</span>
            </div>
            <div className="session-card-meta">
              <span><Monitor size={14} /> {s.device?.os || '—'}</span>
              <span><Globe size={14} /> {s.ip || 'Unknown'}</span>
              <span><Clock size={14} /> {formatLastActive(s.lastActiveAt)}</span>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => handleRevoke(s._id)}
              disabled={revoking === s._id}
              style={{color:'var(--danger)', borderColor:'var(--danger)', width:'100%', justifyContent:'center', display:'flex', alignItems:'center', gap:'8px'}}
            >
              {revoking === s._id ? <RefreshCw className="animate-spin" size={14} /> : <Ban size={14} />} Revoke Session
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
