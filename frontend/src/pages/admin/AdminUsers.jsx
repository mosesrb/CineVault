import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getUsers, banUser, setUserGenres, deleteUser, getGenres, approveUser, createUser, resetUserPassword, revokeUserSessions, unlinkUser } from '../../api'
import { Settings, Ban, Tag, Check, ChevronUp, Users, Trash2, ChevronLeft } from 'lucide-react'

const emptyAccount = { name: '', email: '', password: '' }

export default function AdminUsers() {
  const [users, setUsers]   = useState([])
  const [genres, setGenres] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [banForm, setBanForm]   = useState({ reason: '', expiresAt: '' })
  const [creating, setCreating] = useState(false)
  const [account, setAccount] = useState(emptyAccount)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)

  useEffect(() => {
    getUsers().then(({ data }) => setUsers(data))
      .catch(() => setFeedback({ error: true, message: 'Could not load users.' }))
      .finally(() => setLoading(false))
    getGenres().then(({ data }) => setGenres(data)).catch(() => {})
  }, [])

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  async function handleBan(userId, banVal) {
    const payload = banVal
      ? { ban: true, reason: banForm.reason, expiresAt: banForm.expiresAt || undefined }
      : { ban: false }
    const r = await banUser(userId, payload)
    setUsers(us => us.map(u => u._id === userId ? { ...u, ...r.data } : u))
    setBanForm({ reason: '', expiresAt: '' })
  }

  async function handleSetGenres(userId, genreIds) {
    const r = await setUserGenres(userId, genreIds)
    setUsers(us => us.map(u => u._id === userId ? { ...u, allowedGenres: r.data.allowedGenres } : u))
  }

  async function handleDelete(id, name) {
    if (!confirm(`Permanently delete user "${name}"?`)) return
    await deleteUser(id)
    setUsers(us => us.filter(u => u._id !== id))
  }

  async function manageAccount(action, message) {
    setBusy(true)
    setFeedback(null)
    try {
      await action()
      setFeedback({ message })
    } catch (error) {
      const detail = error.response?.data
      setFeedback({ error: true, message: error.response?.status < 500 && typeof detail === 'string'
        ? detail : 'Could not complete the account change. Refresh the user list before retrying.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(event) {
    event.preventDefault()
    await manageAccount(async () => {
      const { data } = await createUser({ ...account, name: account.name.trim(), email: account.email.trim() })
      setUsers(current => [...current, { ...data, isApproved: true }])
      setCreating(false)
    }, 'Local account created.')
    setAccount(current => ({ ...current, password: '' }))
  }

  function handleAccess(user, approve) {
    if (!approve && !confirm(`Disable access for ${user.name} and sign them out?`)) return
    return manageAccount(async () => {
      const { data } = await approveUser(user._id, approve)
      setUsers(current => current.map(row => row._id === user._id ? { ...row, isApproved: data.isApproved } : row))
    }, approve ? 'Access enabled.' : 'Access disabled and sessions revoked.')
  }

  async function handleReset(event, user) {
    event.preventDefault()
    if (!confirm(`Reset the local password for ${user.name} and sign them out?`)) return
    await manageAccount(() => resetUserPassword(user._id, password), 'Local password reset and sessions revoked.')
    setPassword('')
  }

  function handleUnlink(user) {
    if (!confirm(`Remove Supabase sign-in for ${user.name} on this server?`)) return
    return manageAccount(async () => {
      await unlinkUser(user._id, user.cloudLinkGeneration)
      setUsers(current => current.map(row => row._id === user._id
        ? { ...row, cloudLinked: false, cloudLinkGeneration: undefined } : row))
    }, 'Supabase sign-in removed from this account.')
  }

  return (
    <div className="animate-fadeUp">
      {/* Header + Search */}
      <div className="admin-search-row" style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'var(--sp-6)', gap:'var(--sp-4)'}}>
        <div style={{display:'flex', alignItems:'center', gap:'var(--sp-2)'}}>
          <Link to="/admin" className="btn btn-ghost btn-sm" style={{padding:8, borderRadius:'50%', width:36, height:36, justifyContent:'center'}}>
            <ChevronLeft size={20} />
          </Link>
          <h1 className="section-heading">Users ({users.length})</h1>
        </div>
        <input
          className="input"
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{width:240}}
        />
        <button className="btn btn-primary btn-sm" disabled={busy || loading} aria-expanded={creating}
          onClick={() => { setCreating(!creating); setAccount(emptyAccount) }}>
          {creating ? 'Cancel' : 'Create local account'}
        </button>
      </div>

      {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
      {creating && (
        <form className="card" onSubmit={handleCreate} style={{padding:'var(--sp-4)', marginBottom:'var(--sp-4)'}}>
          <label className="field">Name
            <input className="input" autoComplete="off" required minLength={2} maxLength={255} value={account.name}
              onChange={event => setAccount({ ...account, name: event.target.value })} />
          </label>
          <label className="field">Email
            <input className="input" type="email" autoComplete="off" required maxLength={255} value={account.email}
              onChange={event => setAccount({ ...account, email: event.target.value })} />
          </label>
          <label className="field">Initial local password
            <input className="input" type="password" autoComplete="new-password" required minLength={5} maxLength={72}
              value={account.password} onChange={event => setAccount({ ...account, password: event.target.value })} />
          </label>
          <button className="btn btn-primary btn-sm" disabled={busy}>Create account</button>
        </form>
      )}

      {loading
        ? <div className="loading-center"><div className="spinner"/></div>
        : (
          <div style={{display:'flex', flexDirection:'column', gap:'var(--sp-3)'}}>
            {filtered.map(u => (
              <div key={u._id} className="card" style={{padding:'var(--sp-4)'}}>

                {/* ── User row ── */}
                <div style={{display:'flex', alignItems:'center', gap:'var(--sp-3)', flexWrap:'wrap'}}>

                  {/* Avatar */}
                  <div style={{
                    width:44, height:44, borderRadius:'50%',
                    background:'linear-gradient(135deg, var(--accent-dim), var(--accent))',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color:'#fff', fontWeight:700, flexShrink:0, fontSize:'1.1rem'
                  }}>
                    {u.profilePicUrl
                      ? <img src={u.profilePicUrl} alt={u.name} style={{width:'100%', height:'100%', objectFit:'cover', borderRadius:'50%'}}/>
                      : u.name?.charAt(0)?.toUpperCase()
                    }
                  </div>

                  {/* Info */}
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', gap:'var(--sp-2)', flexWrap:'wrap'}}>
                      {u.name}
                      {u.isAdmin && <span className="badge badge-accent">Admin</span>}
                      {u.isApproved === false && (
                        <span className="badge" style={{background:'rgba(245,158,11,0.15)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.3)'}}>
                          Access disabled
                        </span>
                      )}
                      {u.cloudLinked && <span className="badge badge-muted">Supabase linked</span>}
                      {u.isBanned && (
                        <span className="badge badge-danger">
                          Banned{u.banExpiresAt ? ` until ${new Date(u.banExpiresAt).toLocaleDateString()}` : ' (perma)'}
                        </span>
                      )}
                    </div>
                    <div className="text-muted text-sm" style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{u.email}</div>
                    {u.allowedGenres?.length > 0 && (
                      <div style={{marginTop:'var(--sp-1)', display:'flex', gap:4, flexWrap:'wrap'}}>
                        {u.allowedGenres.map(g => <span key={g._id} className="badge badge-muted" style={{fontSize:'10px'}}>{g.name}</span>)}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{display:'flex', gap:'var(--sp-2)', alignItems: 'center', marginLeft: 'auto'}}>
                    {!u.isAdmin && u.isApproved === false && (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => handleAccess(u, true)}
                      >
                        <Check size={14} /> Enable access
                      </button>
                    )}
                    {!u.isAdmin && <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      aria-expanded={expanded === u._id}
                      onClick={() => { setExpanded(expanded === u._id ? null : u._id); setPassword('') }}
                    >
                      {expanded === u._id ? <><ChevronUp size={14} /> Close</> : <><Settings size={14} /> Manage</>}
                    </button>}
                    {!u.isAdmin && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(u._id, u.name)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Expanded controls ── */}
                {expanded === u._id && !u.isAdmin && (
                  <div style={{marginTop:'var(--sp-5)', display:'flex', flexDirection:'column', gap:'var(--sp-6)', paddingTop:'var(--sp-4)', borderTop:'1px solid var(--border)'}}>
                    <div style={{display:'flex', flexWrap:'wrap', gap:'var(--sp-2)'}}>
                      {u.isApproved && <button className="btn btn-danger btn-sm" disabled={busy}
                        onClick={() => handleAccess(u, false)}>Disable access</button>}
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
                        if (confirm(`Sign ${u.name} out of all CineVault sessions?`)) {
                          manageAccount(() => revokeUserSessions(u._id), 'CineVault sessions revoked.')
                        }
                      }}>Sign out all devices</button>
                      {u.cloudLinkGeneration && <button className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={() => handleUnlink(u)}>Remove Supabase link</button>}
                    </div>
                    <form onSubmit={event => handleReset(event, u)}>
                      <label className="field">New local password
                        <input className="input" type="password" autoComplete="new-password" required minLength={5} maxLength={72}
                          value={password} onChange={event => setPassword(event.target.value)} />
                      </label>
                      <button className="btn btn-ghost btn-sm" disabled={busy}>Reset local password</button>
                    </form>

                    {/* Ban / Unban */}
                    <div>
                      <h4 style={{fontWeight:700, marginBottom:'var(--sp-3)', fontSize:'var(--fs-sm)', display:'flex', alignItems:'center', gap:'8px'}}>
                        <Ban size={16} /> Ban Control
                      </h4>
                      {u.isBanned ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleBan(u._id, false)}>
                          ✓ Lift Ban
                        </button>
                      ) : (
                        <div style={{display:'flex', flexDirection:'column', gap:'var(--sp-3)'}}>
                          <div className="field">
                            <label>Reason (optional)</label>
                            <input
                              className="input"
                              placeholder="Rule violation…"
                              value={banForm.reason}
                              onChange={e => setBanForm(f => ({...f, reason: e.target.value}))}
                            />
                          </div>
                          <div className="field">
                            <label>Expires (blank = permanent)</label>
                            <input
                              className="input"
                              type="date"
                              value={banForm.expiresAt}
                              onChange={e => setBanForm(f => ({...f, expiresAt: e.target.value}))}
                            />
                          </div>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleBan(u._id, true)}
                            style={{width:'100%', justifyContent:'center'}}
                          >
                            <Ban size={14} /> Ban User
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Genre restriction */}
                    <div>
                      <h4 style={{fontWeight:700, marginBottom:'var(--sp-3)', fontSize:'var(--fs-sm)', display:'flex', alignItems:'center', gap:'8px'}}>
                        <Tag size={16} /> Genre Restrictions
                      </h4>
                      <div style={{display:'flex', flexWrap:'wrap', gap:'var(--sp-2)', marginBottom:'var(--sp-3)'}}>
                        {genres.map(g => {
                          const isRestricted = u.allowedGenres?.some(ag => (ag._id || ag) === g._id)
                          return (
                            <button
                              key={g._id}
                              className={`badge ${isRestricted ? 'badge-accent' : 'badge-muted'}`}
                              style={{cursor:'pointer', border:'none', padding:'6px var(--sp-3)', fontSize:'var(--fs-xs)'}}
                              onClick={() => {
                                const current = (u.allowedGenres || []).map(ag => ag._id || ag)
                                const next = isRestricted ? current.filter(id => id !== g._id) : [...current, g._id]
                                handleSetGenres(u._id, next)
                              }}
                            >
                              {isRestricted ? <Check size={10} style={{marginRight:4}} /> : ''}{g.name}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-muted" style={{fontSize:'var(--fs-xs)'}}>
                        {u.allowedGenres?.length > 0
                          ? `Restricted to ${u.allowedGenres.length} genre${u.allowedGenres.length > 1 ? 's' : ''}`
                          : 'No restrictions — can access all content.'
                        }
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {filtered.length === 0 && (
              <div className="empty-state"><Users className="empty-icon" size={64} /><p>No users found.</p></div>
            )}
          </div>
        )
      }
    </div>
  )
}
