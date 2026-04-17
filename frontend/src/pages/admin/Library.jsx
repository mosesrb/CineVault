import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getLibraryConfig, setLibraryConfig, ingestFile, scanLibrary, getScanStatus, getOrganizeMap, refreshMetadata, getDuplicates, cleanupDuplicates, deleteMovie, searchTMDB, linkMovieToTMDB, resolveUrl } from '../../api'
import { Library, Save, Inbox, RefreshCw, Search, Wand2, CheckCircle2, FileText, AlertOctagon, LayoutGrid, Trash2, Database, X, AlertTriangle, AlertCircle, CloudDownload, FolderSearch, ChevronLeft } from 'lucide-react'

export default function AdminLibrary() {
  const [config, setConfig]   = useState(null)
  const [vault, setVault]     = useState('')
  const [inbox, setInbox]     = useState('')
  const [cfgMsg, setCfgMsg]   = useState('')
  const [cfgErr, setCfgErr]   = useState('')
  const [cfgLoading, setCfgLoading] = useState(false)

  const [ingestPath, setIngestPath] = useState('')
  const [ingestResult, setIngestResult] = useState(null)
  const [ingestLoading, setIngestLoading] = useState(false)
  const [ingestErr, setIngestErr] = useState('')

  const [scanLoading, setScanLoading] = useState(false)
  const [scanReport, setScanReport]   = useState(null)
  const [hashMode, setHashMode]       = useState('normal')
  const [scanStatus, setScanStatus]   = useState({ isScanning: false, total: 0, processed: 0, currentFile: '' })

  const [orgMap, setOrgMap] = useState([])
  const [orgLoading, setOrgLoading] = useState(false)

  const [metaLoading, setMetaLoading] = useState(false)
  const [metaResult, setMetaResult] = useState(null)

  const [duplicates, setDuplicates] = useState(null)
  const [dupeLoading, setDupeLoading] = useState(false)
  const [showDupeModal, setShowDupeModal] = useState(false)
  const [cleanupLoading, setCleanupLoading] = useState(false)

  const [showRematchModal, setShowRematchModal] = useState(false)
  const [rematchTarget, setRematchTarget] = useState(null)
  const [rematchQuery, setRematchQuery] = useState('')
  const [rematchResults, setRematchResults] = useState([])
  const [rematchLoading, setRematchLoading] = useState(false)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    getLibraryConfig()
      .then(r => {
        setConfig(r.data)
        setVault(r.data.vaultRootPath || '')
        setInbox(r.data.inboxPath || '')
      }).catch(() => {})
  }, [])

  async function handleSaveConfig(e) {
    e.preventDefault()
    setCfgMsg(''); setCfgErr('')
    setCfgLoading(true)
    try {
      const r = await setLibraryConfig({ vaultRootPath: vault, inboxPath: inbox })
      setConfig(r.data)
      setCfgMsg('Vault configuration saved!')
    } catch (err) {
      setCfgErr(err.response?.data || 'Failed to save config.')
    } finally { setCfgLoading(false) }
  }

  async function handleIngest(e) {
    e.preventDefault()
    setIngestResult(null); setIngestErr('')
    setIngestLoading(true)
    try {
      const r = await ingestFile(ingestPath)
      setIngestResult(r.data)
      setIngestPath('')
    } catch (err) {
      setIngestErr(err.response?.data || 'Ingest failed.')
    } finally { setIngestLoading(false) }
  }

  async function handleScan() {
    setScanLoading(true); setScanReport(null)
    try {
      await scanLibrary('', hashMode)
      const poll = setInterval(async () => {
        try {
          const r = await getScanStatus()
          setScanStatus(r.data)
          if (!r.data.isScanning) {
            clearInterval(poll)
            setScanLoading(false)
            setScanReport(r.data.report)
          }
        } catch {
          clearInterval(poll)
          setScanLoading(false)
        }
      }, 500)
    } catch (err) {
      setScanReport({ error: err.response?.data || 'Scan failed.' })
      setScanLoading(false)
    }
  }

  async function handleLoadOrg() {
    setOrgLoading(true)
    try { const r = await getOrganizeMap(); setOrgMap(r.data) }
    catch {} finally { setOrgLoading(false) }
  }

  async function handleRefreshMeta() {
    setMetaLoading(true); setMetaResult(null)
    try {
      const r = await refreshMetadata()
      setMetaResult(r.data)
    } catch (err) {
      alert(err.response?.data?.message || 'Refresh failed.')
    } finally { setMetaLoading(false) }
  }

  async function handleFindDuplicates() {
    setDupeLoading(true)
    try {
      const r = await getDuplicates()
      setDuplicates(r.data)
      setShowDupeModal(true)
    } catch {
      alert('Failed to fetch duplicates.')
    } finally { setDupeLoading(false) }
  }

  async function handleCleanup() {
    if (!window.confirm('Keep richest metadata records and remove redundant DB entries. File paths remain untouched. Proceed?')) return
    setCleanupLoading(true)
    try {
      const r = await cleanupDuplicates()
      alert(`Cleanup complete! Removed ${r.data.removed} duplicate records.`)
      setShowDupeModal(false)
      setDuplicates(null)
    } catch {
      alert('Cleanup failed.')
    } finally { setCleanupLoading(false) }
  }

  async function handleManualDelete(id, deleteFile = false) {
    const msg = deleteFile
      ? 'PERMANENTLY delete this physical file and its library record?'
      : 'Remove this record from the library? (File stays on disk)'
    if (!window.confirm(msg)) return
    try {
      await deleteMovie(id, deleteFile)
      const r = await getDuplicates()
      setDuplicates(r.data)
    } catch (err) {
      alert('Failed: ' + (err.response?.data || err.message))
    }
  }

  async function handleOpenRematch(movie) {
    setRematchTarget(movie)
    setRematchQuery(movie.title)
    setRematchResults([])
    setShowRematchModal(true)
    setRematchLoading(true)
    try {
      const r = await searchTMDB(movie.title)
      setRematchResults(r.data)
    } catch (err) {
      console.error('Rematch search failed', err)
    } finally { setRematchLoading(false) }
  }

  async function handleSearchRematch() {
    if (!rematchQuery.trim()) return
    setRematchLoading(true)
    try {
      const r = await searchTMDB(rematchQuery)
      setRematchResults(r.data)
    } finally { setRematchLoading(false) }
  }

  async function handleLinkIdentity(tmdbId) {
    if (!rematchTarget) return
    setLinking(true)
    try {
      await linkMovieToTMDB(rematchTarget._id, tmdbId)
      setShowRematchModal(false)
      const r = await getDuplicates()
      setDuplicates(r.data)
      alert('Identity updated! Record is now correctly identified.')
    } catch (err) {
      alert('Failed to link: ' + (err.response?.data || err.message))
    } finally { setLinking(false) }
  }

  /* ─────────────────────────────────────────── RENDER ─── */
  return (
    <div className="animate-fadeUp lib-page">
      <div style={{display:'flex', alignItems:'center', gap:'var(--sp-2)', marginBottom:'var(--sp-6)'}}>
        <Link to="/admin" className="btn btn-ghost btn-sm" style={{padding:8, borderRadius:'50%', width:36, height:36, justifyContent:'center'}}>
          <ChevronLeft size={20} />
        </Link>
        <h1 className="section-heading" style={{margin:0}}>Library Management</h1>
      </div>

      {/* ── Vault Config ───────────────────────────────── */}
      <div className="card lib-section">
        <h2 className="lib-section-title" style={{display:'flex', alignItems:'center', gap:'8px'}}>
          <Library size={20} /> Vault Configuration
        </h2>
        <form onSubmit={handleSaveConfig} className="lib-form">
          {cfgMsg && <div className="alert alert-success">{cfgMsg}</div>}
          {cfgErr && <div className="alert alert-error">{cfgErr}</div>}
          <div className="field">
            <label>Vault Root Path *</label>
            <input
              className="input"
              value={vault}
              onChange={e => setVault(e.target.value)}
              placeholder="e.g. D:\CineVault"
              required
            />
            <span className="text-muted" style={{ fontSize: 'var(--fs-xs)' }}>
              Central storage where CineVault organizes media.
            </span>
          </div>
          <div className="field">
            <label>Inbox Path (optional)</label>
            <input
              className="input"
              value={inbox}
              onChange={e => setInbox(e.target.value)}
              placeholder="Defaults to Vault\Inbox"
            />
          </div>
          <button type="submit" className="btn btn-primary lib-save-btn" disabled={cfgLoading}>
            {cfgLoading ? 'Saving…' : <><Save size={18} /> Save Configuration</>}
          </button>
        </form>
      </div>

      {/* ── Two-column grid (ingest + sync) ─────────────── */}
      <div className="lib-grid">

        {/* Ingest File */}
        <div className="card lib-section">
          <h2 className="lib-section-title" style={{display:'flex', alignItems:'center', gap:'8px'}}>
            <Inbox size={20} /> Ingest &amp; Catalog
          </h2>
          <p className="text-muted text-sm" style={{ marginBottom: 'var(--sp-4)' }}>
            Add an external file directly to your library.
          </p>
          <form onSubmit={handleIngest} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {ingestErr && <div className="alert alert-error">{ingestErr}</div>}
            <input
              className="input"
              value={ingestPath}
              onChange={e => setIngestPath(e.target.value)}
              placeholder="e.g. C:\Downloads\Interstellar.mkv"
              required
            />
            <button type="submit" className="btn btn-primary" disabled={ingestLoading || !config}>
              {ingestLoading ? <><RefreshCw className="animate-spin" size={18} /> Ingesting…</> : <><CloudDownload size={18} /> Start Ingest</>}
            </button>
          </form>
          {ingestResult && (
            <div className="alert alert-success" style={{ marginTop: 'var(--sp-4)' }}>
              <strong>{ingestResult.message}</strong>
              <br /><span style={{ fontSize: 'var(--fs-xs)' }}>{ingestResult.movie?.title}</span>
            </div>
          )}
        </div>

        {/* Scan & Meta */}
        <div className="card lib-section">
          <h2 className="lib-section-title" style={{display:'flex', alignItems:'center', gap:'8px'}}>
            <RefreshCw size={20} /> Automated Sync
          </h2>
          <p className="text-muted text-sm" style={{ marginBottom: 'var(--sp-4)' }}>
            Sync your vault files with the cinematic database.
          </p>

          {/* Scan mode select */}
          <div className="field">
            <label>Scan Mode</label>
            <select
              value={hashMode}
              onChange={e => setHashMode(e.target.value)}
              className="input"
            >
              <option value="normal">Normal Scan</option>
              <option value="sparse">Sparse Scan</option>
              <option value="deep">Deep Scan</option>
            </select>
          </div>

          {/* Action buttons — stacked for mobile */}
          <div className="lib-sync-btns">
            <button
              className="btn btn-ghost"
              onClick={handleScan}
              disabled={scanLoading || !config}
            >
              {scanLoading ? <><RefreshCw className="animate-spin" size={18} /> Scanning…</> : <><Search size={18} /> Scan Files</>}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleRefreshMeta}
              disabled={metaLoading || !config}
            >
              {metaLoading ? <><RefreshCw className="animate-spin" size={18} /> Syncing…</> : <><Wand2 size={18} /> Repair Meta</>}
            </button>
          </div>

          {/* Scan progress */}
          {scanLoading && (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', marginBottom: 'var(--sp-1)' }}>
                <span className="text-muted lib-scan-file">
                  {scanStatus.currentFile
                    ? `📄 ${scanStatus.currentFile.split(/[\\/]/).pop()}`
                    : 'Preparing scan…'}
                </span>
                <span style={{ fontWeight: 700, color: 'var(--accent)', flexShrink: 0, marginLeft: 'var(--sp-2)' }}>
                  {scanStatus.processed}/{scanStatus.total}
                </span>
              </div>
              <div style={{
                height: 6, background: 'var(--bg-raised)', borderRadius: 10,
                overflow: 'hidden', border: '1px solid var(--border-light)'
              }}>
                <div style={{
                  height: '100%',
                  width: `${scanStatus.total > 0 ? (scanStatus.processed / scanStatus.total) * 100 : 0}%`,
                  background: 'linear-gradient(90deg, var(--primary), var(--accent))',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}

          {/* Meta result */}
          {metaResult && (
            <div className="alert alert-success" style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--fs-sm)', display:'flex', alignItems:'center', gap:'8px' }}>
              <CheckCircle2 size={16} /> <strong>{metaResult.stats?.updated} records fixed!</strong>
            </div>
          )}

          {/* Scan report */}
          {scanReport && !scanReport.error && (
            <div className="lib-scan-report">
              <div className="lib-scan-stat">
                <div className="lib-scan-num">{scanReport.imported}</div>
                <div className="lib-scan-label">NEW</div>
              </div>
              <div className="lib-scan-stat">
                <div className="lib-scan-num">{scanReport.skipped}</div>
                <div className="lib-scan-label">EXISTING</div>
              </div>
              <div className="lib-scan-stat">
                <div className="lib-scan-num" style={{ color: 'var(--danger)' }}>{scanReport.errors?.length}</div>
                <div className="lib-scan-label">ERRORS</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Duplicate Management ────────────────────────── */}
      <div className="card lib-section" style={{ borderLeft: '4px solid var(--accent)' }}>
        <div className="lib-section-header">
          <div>
            <h2 className="lib-section-title" style={{ marginBottom: 'var(--sp-1)', display:'flex', alignItems:'center', gap:'8px' }}>
              <AlertOctagon size={20} /> Duplicate Management
            </h2>
            <p className="text-muted text-sm">Detect and eliminate redundant records in your library.</p>
          </div>
          <button
            className="btn btn-ghost lib-action-btn"
            onClick={handleFindDuplicates}
            disabled={dupeLoading}
          >
            {dupeLoading ? <><RefreshCw className="animate-spin" size={16} /> Analyzing…</> : <><Search size={16} /> Analyze Library</>}
          </button>
        </div>
      </div>

      {/* ── Organization Map ────────────────────────────── */}
      <div className="card lib-section">
        <div className="lib-section-header">
          <div>
            <h2 className="lib-section-title" style={{ marginBottom: 'var(--sp-1)', display:'flex', alignItems:'center', gap:'8px' }}>
              <FolderSearch size={20} /> Genre-Based Organization
            </h2>
            <p className="text-muted text-sm">Preview the virtual structure of your collection.</p>
          </div>
          <button
            className="btn btn-ghost btn-sm lib-action-btn"
            onClick={handleLoadOrg}
            disabled={orgLoading}
          >
            {orgLoading ? <><RefreshCw className="animate-spin" size={16} /> Mapping…</> : <><LayoutGrid size={16} /> View Map</>}
          </button>
        </div>
        {orgMap.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 'var(--sp-4)', marginTop: 'var(--sp-5)' }}>
            {orgMap.map((row, i) => (
              <div key={i} className="card-raised" style={{ padding: 'var(--sp-4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <span style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>{row.genre.name}</span>
                  <span className="badge badge-accent" style={{ fontSize: 10 }}>{row.total}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }}>
                  {row.movies.length} Movies · {row.shows.length} Shows
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══════════ DUPLICATE AUDIT MODAL ══════════ */}
      {showDupeModal && (
        <div className="lib-modal-overlay">
          <div className="lib-modal-box">

            {/* Modal header */}
            <div className="lib-modal-header">
              <h2 style={{ fontWeight: 900, fontSize: 'var(--fs-xl)', display:'flex', alignItems:'center', gap:'8px' }}>
                <Search size={24} /> Library Audit
              </h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDupeModal(false)}><X size={18} /> Close</button>
            </div>

            {/* Modal scrollable body */}
            <div className="lib-modal-body">
              {(!duplicates?.movieDupes?.length && !duplicates?.pathDupes?.length && !duplicates?.hashDupes?.length) ? (
                <div className="alert alert-success">🎉 Your library is clean! No duplicates detected.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-8)' }}>

                  {/* Hash Collisions */}
                  {duplicates?.hashDupes?.length > 0 && (
                    <div>
                      <h3 className="lib-dupe-section-title" style={{ color: 'var(--danger)' }}>
                        🔴 Identical Files (Hash Collisions)
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                        {duplicates.hashDupes.map((dupe) => (
                          <div key={dupe._id} className="lib-dupe-card">
                            <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-2)' }}>
                              Original: {dupe.originalMediaId
                                ? `${dupe.originalMediaId.title} (${dupe.originalMediaId.year})`
                                : 'Unknown'}
                            </div>
                            <div className="lib-dupe-path">{dupe.vaultPath}</div>
                            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-3)', wordBreak: 'break-all' }}>
                              Hash: {dupe.hash}
                            </div>
                            <button
                              className="btn btn-sm btn-danger lib-dupe-btn"
                              onClick={() => alert('WIP: Hash-based file deletion coming soon.')}
                            >
                              <Trash2 size={14} /> Delete Duplicate File
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Path Duplicates */}
                  {duplicates?.pathDupes?.length > 0 && (
                    <div>
                      <h3 className="lib-dupe-section-title" style={{ color: 'var(--danger)' }}>
                        🟠 Same File Path — Multiple Records
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                        {duplicates.pathDupes.map((set, i) => (
                          <div key={i} className="lib-dupe-card">
                            <div className="lib-dupe-path" style={{ marginBottom: 'var(--sp-3)' }}>{set._id}</div>
                            {set.docs.map(doc => (
                              <div key={doc._id} className="lib-dupe-entry">
                                <div className="lib-dupe-entry-info">
                                  <span style={{ fontWeight: 600 }}>{doc.title}</span>
                                  {doc.year && <span className="badge badge-muted" style={{ fontSize: 10 }}>{doc.year}</span>}
                                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                    {doc._id}
                                  </span>
                                </div>
                                <div className="lib-dupe-entry-actions">
                                  <button className="btn btn-sm btn-ghost" onClick={() => handleOpenRematch(doc)}>
                                    <Search size={14} /> Rematch
                                  </button>
                                  <button className="btn btn-sm btn-ghost" onClick={() => handleManualDelete(doc._id, false)}>
                                    <Database size={14} /> DB Only
                                  </button>
                                  <button className="btn btn-sm btn-danger" style={{ background: 'rgba(255,59,48,0.2)' }} onClick={() => handleManualDelete(doc._id, true)}>
                                    <Trash2 size={14} /> + File
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Title/Year Duplicates */}
                  {duplicates?.movieDupes?.length > 0 && (
                    <div>
                      <h3 className="lib-dupe-section-title" style={{ color: 'var(--warning, #f59e0b)' }}>
                        🟡 Possible Duplicates — Same Title &amp; Year
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                        {duplicates.movieDupes.map((set, i) => (
                          <div key={i} className="lib-dupe-card">
                            <div style={{ fontWeight: 700, marginBottom: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
                              {set._id.title} ({set._id.year})
                            </div>
                            {set.docs.map(doc => (
                              <div key={doc._id} className="lib-dupe-entry">
                                <div className="lib-dupe-entry-info">
                                  {doc.vaultPath && (
                                    <span className="lib-dupe-path" style={{ fontSize: '10px' }}>
                                      {doc.vaultPath.split(/[\\/]/).pop()}
                                    </span>
                                  )}
                                  {doc.tmdbId && <span className="badge badge-success" style={{ fontSize: 10 }}>Synced</span>}
                                </div>
                                <div className="lib-dupe-entry-actions">
                                  <button className="btn btn-sm btn-ghost" onClick={() => handleOpenRematch(doc)}>
                                    <Search size={14} /> Rematch
                                  </button>
                                  <button className="btn btn-sm btn-ghost" onClick={() => handleManualDelete(doc._id, false)}>
                                    <Database size={14} /> DB
                                  </button>
                                  <button className="btn btn-sm btn-danger" style={{ background: 'rgba(255,59,48,0.2)' }} onClick={() => handleManualDelete(doc._id, true)}>
                                    <Trash2 size={14} /> File
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="lib-modal-footer">
              <span className="text-muted text-xs">Richest metadata record is kept during Smart Cleanup.</span>
              <button
                className="btn btn-primary"
                onClick={handleCleanup}
                disabled={cleanupLoading || (!duplicates?.movieDupes?.length && !duplicates?.pathDupes?.length)}
              >
                {cleanupLoading ? <><RefreshCw className="animate-spin" size={16} /> Cleaning…</> : <><Wand2 size={16} /> Smart Cleanup</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ REMATCH MODAL ══════════ */}
      {showRematchModal && (
        <div className="lib-modal-overlay" style={{ zIndex: 2000 }}>
          <div className="lib-modal-box">

            <div className="lib-modal-header">
              <div>
                <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Manual Rematch</h2>
                <p className="text-muted text-xs" style={{ marginTop: 'var(--sp-1)', wordBreak: 'break-all' }}>
                  File: <span style={{ color: 'var(--accent)' }}>
                    {rematchTarget?.vaultPath?.split(/[\\/]/).pop() || rematchTarget?.title}
                  </span>
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowRematchModal(false)}><X size={18} /></button>
            </div>

            <div className="lib-modal-body">
              {/* Search row */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
                <input
                  className="input"
                  placeholder="Search TMDB for correct title…"
                  value={rematchQuery}
                  onChange={e => setRematchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearchRematch()}
                />
                <button
                  className="btn btn-ghost"
                  onClick={handleSearchRematch}
                  disabled={rematchLoading}
                >
                  {rematchLoading ? <><RefreshCw className="animate-spin" size={16} /> Searching…</> : <><Search size={16} /> Search TMDB</>}
                </button>
              </div>

              {/* Results */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                {rematchResults.map(res => (
                  <div key={res.id} className="lib-rematch-result">
                    {res.posterUrl
                      ? <img src={resolveUrl(res.posterUrl)} alt="" className="lib-rematch-poster" />
                      : <div className="lib-rematch-poster lib-rematch-poster-empty" />
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>{res.title} ({res.year})</div>
                      <div className="text-muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {res.description}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleLinkIdentity(res.id)}
                      disabled={linking}
                      style={{ flexShrink: 0 }}
                    >
                      {linking ? '…' : 'Use'}
                    </button>
                  </div>
                ))}
                {!rematchLoading && rematchResults.length === 0 && rematchQuery && (
                  <div className="text-muted text-sm" style={{ textAlign: 'center', padding: 'var(--sp-8)' }}>
                    No results for "{rematchQuery}"
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
