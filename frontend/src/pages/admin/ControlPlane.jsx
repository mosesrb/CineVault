import { useEffect, useState } from 'react'
import './ControlPlane.css'

const statusLabels = {
  connected: 'Connected', disabled: 'Disabled', not_enrolled: 'Not enrolled', awaiting_owner: 'Awaiting owner approval',
  pairing_expired: 'Setup request expired', recovery_required: 'Recovery required', conflict: 'Connection conflict',
  awaiting_restore_owner: 'Awaiting restore approval', credential_expired: 'Credential expired',
}

// Deliberately bypasses shared GET/offline caches. Setup proofs are ephemeral,
// never localStorage, URLs, telemetry or offline state. PC same-origin only.
async function request(path = '', method = 'GET', csrfToken, body = {}) {
  const token = localStorage.getItem('cv_token')
  const response = await fetch(`/api/v1/admin/control-plane${path}`, {
    method, cache: 'no-store', redirect: 'error', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}),
      ...(csrfToken ? { 'x-cinevault-csrf': csrfToken } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Cloud administration unavailable.')
  return result
}

export default function ControlPlane() {
  const [status, setStatus] = useState(null)
  const [setup, setSetup] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRecovery, setConfirmRecovery] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restoreInstance, setRestoreInstance] = useState('')
  const [restoreCloud, setRestoreCloud] = useState('')
  useEffect(() => {
    let live = true
    request().then(value => { if (live) setStatus(value) }).catch(() => {
      if (live) setError('Unable to read live cloud status. No cached status is used.')
    })
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (!setup?.expiresAt) return
    const timer = setTimeout(() => setSetup(null), Math.max(0, setup.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [setup])
  async function perform(operation) {
    setBusy(true); setError('')
    try {
      const { csrfToken } = await request('/csrf', 'POST')
      const result = await request(`/${operation}`, 'POST', csrfToken,
        operation==='restore'?{confirmedInstanceId:restoreInstance.trim(),cloudServerId:restoreCloud.trim()}:{})
      if (['prepare','recover','restore'].includes(operation)) setSetup(result.alreadyEnrolled ? null : result)
      if (operation === 'recover') setConfirmRecovery(false)
      if (operation === 'restore') setConfirmRestore(false)
      if (operation === 'redeem' && result.enrolled) setSetup(null)
      setStatus(await request())
    } catch (failure) {
      setError(failure.message)
      try { setStatus(await request()) } catch { /* Keep explicit failure, not cached success. */ }
    } finally { setBusy(false) }
  }
  const disabled = busy || !status?.enabled
  const statusText = status?.mode ? statusLabels[status.mode] || status.mode.replaceAll('_', ' ') : error ? 'Unavailable' : 'Loading…'
  return <section className="cloud-status" aria-labelledby="cloud-status-title">
    <h1 id="cloud-status-title" className="section-heading">Cloud status</h1>
    <div className="card cloud-status-card">
      <div className="cloud-status-summary">
        <h2>Connection</h2>
        <span role="status" className={`badge ${status?.mode === 'connected' ? 'badge-success' : 'badge-muted'}`}>{statusText}</span>
      </div>
      {status?.guidance && <p>{status.guidance}</p>}
      {status?.mode === 'connected' && <p>Supabase acknowledged this server. Remote playback availability is checked separately.</p>}
      {error && <p role="alert" className="alert alert-error">{error}</p>}
    </div>
    {setup && <section className="card cloud-status-card">
      <h2>Trusted owner approval</h2>
      <p>Expires at {new Date(setup.expiresAt).toLocaleTimeString()}. Copy the request and proof only to the trusted enrollment page in the setup runbook.</p>
      <label className="field">Pairing request<textarea className="input" readOnly rows={8} value={JSON.stringify(setup.request, null, 2)} /></label>
      <label className="field">Approval proof<input className="input" readOnly value={setup.approvalProof} /></label>
    </section>}
    <section className="card cloud-status-card">
      <h2>Cloud setup</h2>
      <p>Use the configured PC browser. Setup requires approval from the cloud owner.</p>
      <div className="cloud-status-actions">
        <button className="btn btn-primary btn-sm" disabled={disabled} onClick={() => perform('prepare')}>Prepare one-time setup</button>
        <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => perform('redeem')}>Check owner approval</button>
      </div>
    </section>
    <section className="card cloud-status-card">
      <h2>Recovery</h2>
      <p>Free Supabase projects can pause after inactivity. Resume a paused project in Supabase, then retry here.</p>
      <div className="cloud-status-actions">
        <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => perform('retry')}>Retry cloud recovery</button>
      </div>
      <details className="cloud-status-details">
        <summary>Owner-approved recovery</summary>
        <p>Renew an expired setup request or prepare a credential replacement. Replacement pauses cloud activity until the owner approves the saved request.</p>
        <label className="cloud-status-check"><input type="checkbox" checked={confirmRecovery} disabled={disabled}
          onChange={event => setConfirmRecovery(event.target.checked)} />I want to prepare or resume owner-approved recovery.</label>
        <button className="btn btn-ghost btn-sm" disabled={disabled || !confirmRecovery} onClick={() => perform('recover')}>Prepare owner recovery</button>
      </details>
      <details className="cloud-status-details">
        <summary>Disaster restore for an existing server</summary>
        <p>Use this when protected credentials are missing or damaged, or ordinary recovery fails. CineVault archives readable protected state and pauses cloud activity while the owner approves a new credential. A saved restore request expires after five minutes.</p>
        <div className="cloud-status-fields">
          <label className="field">Confirmed local instance UUID<input className="input" value={restoreInstance}
            onChange={event => setRestoreInstance(event.target.value)} maxLength={36} disabled={disabled} /></label>
          <label className="field">Existing cloud-server UUID<input className="input" value={restoreCloud}
            onChange={event => setRestoreCloud(event.target.value)} maxLength={36} disabled={disabled} /></label>
        </div>
        <label className="cloud-status-check"><input aria-label="Confirm disaster restore" type="checkbox" checked={confirmRestore} disabled={disabled}
          onChange={event => setConfirmRestore(event.target.checked)} />I verified both server identifiers and authorize preparing a credential replacement.</label>
        <button className="btn btn-danger btn-sm" disabled={disabled || !confirmRestore || !restoreInstance.trim() || !restoreCloud.trim()}
          onClick={() => perform('restore')}>Prepare disaster restore</button>
      </details>
    </section>
  </section>
}
