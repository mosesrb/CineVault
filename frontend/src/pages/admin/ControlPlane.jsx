import { useEffect, useState } from 'react'

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
  return <section className="glass" style={{ padding: 'var(--sp-6)' }}>
    <h1>Cloud control plane</h1>
    <p>Use this page in the configured PC browser. Existing local login and media remain unchanged.</p>
    <p role="status">Status: {status?.mode || 'Loading…'}</p>
    {status?.guidance && <p>{status.guidance}</p>}
    {error && <p role="alert">{error}</p>}
    <p>Setup is opt-in and requires the reviewed hosted broker and trusted cloud-owner approval.
      Do not paste Supabase secret keys, database passwords or owner login tokens here.</p>
    <button disabled={busy || !status?.enabled} onClick={() => perform('prepare')}>Prepare one-time setup</button>{' '}
    <button disabled={busy || !status?.enabled} onClick={() => perform('redeem')}>Check owner approval</button>{' '}
    <button disabled={busy || !status?.enabled} onClick={() => perform('retry')}>Retry cloud recovery</button>
    <p>Owner recovery renews an expired saved setup challenge, or prepares credential replacement for an enrolled server.
      Replacement pauses old cloud activity until you approve the exact saved candidate on the trusted owner page.
      Server identity and candidate keys are preserved. Use the separately confirmed disaster restore below for lost/damaged state; do not delete it.</p>
    <label><input type="checkbox" checked={confirmRecovery} disabled={busy || !status?.enabled}
      onChange={event => setConfirmRecovery(event.target.checked)} />I want to prepare or resume owner-approved recovery.</label>{' '}
    <button disabled={busy || !status?.enabled || !confirmRecovery} onClick={() => perform('recover')}>Prepare owner recovery</button>
    <h2>Disaster restore — existing server only</h2>
    <p>Use only when protected credentials are missing/damaged or ordinary replacement cannot reconcile.
      Original readable bytes are archived securely, never imported or deleted. Cloud activity pauses.
      Fresh cloud-owner approval rotates the actual current operational credential; it does not create users or a server.
      A repeated preparation reuses a live saved restore; after its five-minute expiry a new preparation creates fresh keys.</p>
    <label>Confirmed local instance UUID<input aria-label="Confirmed local instance UUID" value={restoreInstance}
      onChange={event=>setRestoreInstance(event.target.value)} maxLength={36} disabled={busy} /></label>
    <label>Existing cloud-server UUID<input aria-label="Existing cloud-server UUID" value={restoreCloud}
      onChange={event=>setRestoreCloud(event.target.value)} maxLength={36} disabled={busy} /></label>
    <label><input aria-label="Confirm disaster restore" type="checkbox" checked={confirmRestore} disabled={busy || !status?.enabled}
      onChange={event=>setConfirmRestore(event.target.checked)} />I verified both identifiers and authorize preparing a new owner-approved operational rotation.</label>
    <button disabled={busy || !status?.enabled || !confirmRestore || !restoreInstance.trim() || !restoreCloud.trim()}
      onClick={()=>perform('restore')}>Prepare disaster restore</button>
    {setup && <div>
      <h2>Trusted owner approval</h2>
      <p>Expires: {new Date(setup.expiresAt).toLocaleTimeString()}. Copy this request and proof only
        to the trusted enrollment page specified in the setup runbook. They do not grant local media access.</p>
      <label>Pairing request<textarea aria-label="Pairing request" readOnly rows={8} value={JSON.stringify(setup.request, null, 2)} /></label>
      <label>Approval proof<input aria-label="Approval proof" readOnly value={setup.approvalProof} /></label>
    </div>}
    <p>Free projects can pause after inactivity. Recovery is owner-driven; idle keepalive traffic is disabled.
      “Connected” means a cloud acknowledgment, not verified remote endpoint availability.</p>
  </section>
}
