import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getGenres, createGenre, updateGenre, deleteGenre } from '../../api'
import { Plus, Edit2, Trash2, ChevronLeft } from 'lucide-react'

export default function AdminGenres() {
  const [genres, setGenres] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)  // { id, name }
  const [error, setError] = useState('')

  useEffect(() => {
    getGenres().then(r => setGenres(r.data)).finally(() => setLoading(false))
  }, [])

  async function handleAdd(e) {
    e.preventDefault(); setError('')
    setAdding(true)
    try {
      const r = await createGenre({ name: newName })
      setGenres(gs => [...gs, r.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
    } catch (err) {
      setError(err.response?.data || 'Failed to add genre.')
    } finally { setAdding(false) }
  }

  async function handleSaveEdit() {
    if (!editing) return; setError('')
    try {
      const r = await updateGenre(editing.id, { name: editing.name })
      setGenres(gs => gs.map(g => g._id === editing.id ? r.data : g))
      setEditing(null)
    } catch (err) {
      setError(err.response?.data || 'Failed to update.')
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete genre "${name}"? It will be removed from all content.`)) return
    await deleteGenre(id)
    setGenres(gs => gs.filter(g => g._id !== id))
  }

  return (
    <div className="animate-fadeUp" style={{maxWidth:560, margin: '0 auto'}}>
      <div style={{display:'flex', alignItems:'center', gap:'var(--sp-2)', marginBottom:'var(--sp-8)'}}>
        <Link to="/admin" className="btn btn-ghost btn-sm" style={{padding:8, borderRadius:'50%', width:36, height:36, justifyContent:'center'}}>
          <ChevronLeft size={20} />
        </Link>
        <h1 className="section-heading" style={{margin:0}}>Genres ({genres.length})</h1>
      </div>

      {/* Add genre */}
      <div className="card" style={{marginBottom:'var(--sp-6)'}}>
        <h3 style={{fontWeight:700, marginBottom:'var(--sp-4)', display:'flex', alignItems:'center', gap:'8px'}}>
          <Plus size={18} /> Add Genre
        </h3>
        {error && <div className="alert alert-error" style={{marginBottom:'var(--sp-4)'}}>{error}</div>}
        <form onSubmit={handleAdd} style={{display:'flex', gap:'var(--sp-3)', flexWrap: 'wrap'}}>
          <input
            className="input" style={{flex: '1 1 200px'}}
            placeholder="e.g. Science Fiction"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            required minLength={2} maxLength={50}
          />
          <button type="submit" className="btn btn-primary" disabled={adding} style={{flex: '1 1 80px'}}>
            {adding ? '…' : 'Add'}
          </button>
        </form>
      </div>

      {/* Genre list */}
      {loading
        ? <div className="loading-center"><div className="spinner"/></div>
        : (
          <div className="card" style={{padding: 0}}>
            <div style={{display:'flex', flexDirection:'column'}}>
              {genres.length === 0 && <p className="text-muted text-sm" style={{padding:'var(--sp-4)'}}>No genres yet.</p>}
              {genres.map((g, i) => (
                <div key={g._id} style={{
                  display:'flex', alignItems:'center', gap:'var(--sp-3)', flexWrap: 'wrap',
                  padding:'var(--sp-3) var(--sp-4)',
                  borderBottom: i < genres.length - 1 ? '1px solid var(--border)' : 'none'
                }}>
                  {editing?.id === g._id ? (
                    <div style={{display: 'flex', gap: 'var(--sp-2)', width: '100%', flexWrap: 'wrap'}}>
                      <input
                        className="input" style={{flex: '1 1 200px'}}
                        value={editing.name}
                        onChange={e => setEditing(ed => ({...ed, name: e.target.value}))}
                        autoFocus
                      />
                      <div style={{display: 'flex', gap: 'var(--sp-2)', flex: '1 1 auto', justifyContent: 'flex-end'}}>
                        <button className="btn btn-primary btn-sm" onClick={handleSaveEdit}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{flex: '1 1 120px', minWidth: 0}}>
                        <span style={{fontWeight:600, color:'var(--text-primary)'}}>{g.name}</span>
                        <span className="text-muted text-sm" style={{marginLeft:'var(--sp-2)'}}>/{g.slug}</span>
                      </div>
                      <div style={{display: 'flex', gap: 'var(--sp-2)', flexShrink: 0, marginLeft: 'auto'}}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: g._id, name: g.name })}><Edit2 size={14} /></button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(g._id, g.name)}><Trash2 size={14} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      }
    </div>
  )
}
