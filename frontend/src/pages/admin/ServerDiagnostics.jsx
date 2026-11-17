import { useState } from 'react'

const checks = {
  database: {
    ready: ['Ready'],
    not_ready: ['Unavailable', 'Check MongoDB in the CineVault launcher.'],
  },
  supabase: {
    reachable: ['Reachable', 'The Auth service responded. A device sign-in still needs its own check.'],
    unavailable: ['Unavailable', 'Check internet access and the project status in Supabase.'],
    blocked: ['Invalid setup', 'Check the Supabase project settings on the server PC.'],
    disabled: ['Disabled', 'Enable cloud setup when you want to connect this installation.'],
  },
  dns: {
    ready: ['Points to this PC'],
    address_mismatch: ['Points elsewhere', 'Check the hostname’s DNS records or your router’s local DNS settings.'],
    mixed_addresses: ['Some addresses point elsewhere', 'Check both IPv4 and IPv6 DNS records.'],
    partial_lookup: ['Incomplete lookup', 'A DNS query failed. Run checks again before testing on another device.'],
    unavailable: ['No address found', 'Check the hostname and DNS records from the server PC.'],
    invalid: ['Invalid hostname', 'Check the configured HTTPS address on the server PC.'],
    not_configured: ['Not configured', 'Set an HTTPS hostname on the server PC.'],
  },
  tls: {
    ready: ['Trusted on this PC'],
    expiring: ['Expires soon', 'Renew the certificate before it expires.'],
    expired: ['Expired', 'Renew the certificate and reload it on the server.'],
    not_yet_valid: ['Not valid yet', 'Check the PC clock and the certificate’s start date.'],
    wrong_hostname: ['Hostname mismatch', 'Use a certificate issued for this exact hostname.'],
    untrusted: ['Untrusted certificate', 'Check the certificate and its issuer chain.'],
    not_listening: ['Listener unavailable', 'Check the certificate, key and port in the CineVault launcher.'],
    unavailable: ['Could not connect', 'Check the HTTPS listener on the server PC.'],
    invalid: ['Invalid HTTPS address', 'Check the configured HTTPS address on the server PC.'],
    not_configured: ['Not configured', 'Configure the hostname and certificate on the server PC.'],
  },
}

function Check({ label, type, value, children }) {
  const [status, next] = checks[type]?.[value] || ['Unknown', 'Run checks again to confirm.']
  return <div className="server-check">
    <dt>{label}</dt>
    <dd><strong>{status}</strong>{next && <p>{next}</p>}{children}</dd>
  </div>
}

function Timestamp({ value, fallback }) {
  if (!Number.isSafeInteger(value)) return fallback
  const date = new Date(value)
  return <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>
}

export default function ServerDiagnostics({ request, enrollmentLabels }) {
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function runChecks() {
    setBusy(true)
    setFailed(false)
    try { setReport(await request('/diagnostics')) }
    catch { setReport(null); setFailed(true) }
    finally { setBusy(false) }
  }

  return <section className="card cloud-status-card" aria-labelledby="server-checks-title" aria-busy={busy}>
    <div className="cloud-status-summary">
      <h2 id="server-checks-title">Connection checks</h2>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={runChecks}>
        {busy ? 'Running checks…' : 'Run checks'}
      </button>
    </div>
    {failed && <p role="alert" className="alert alert-error">Could not get live results. Check the CineVault launcher or try again.</p>}
    {!report && !failed && <p>Check the local server, Supabase, DNS, and HTTPS from this PC.</p>}
    {report && <>
      <p role="status">Last checked <Timestamp value={report.checkedAt} fallback="at an unknown time" />.</p>
      <dl className="server-check-list">
        <Check label="Local database" type="database" value={report.server.dependencies.database}>
          {report.server.port && <p>Server responded on port {report.server.port}.</p>}
          {report.server.dependencies.redis === 'not_ready' && <p>Redis is unavailable. Check its connection on the server PC.</p>}
        </Check>
        <Check label="Supabase Auth" type="supabase" value={report.supabase.status}>
          {report.supabase.enrollment && <p>Enrollment: {enrollmentLabels[report.supabase.enrollment] || 'Unknown'}</p>}
          {report.supabase.enrollment && <p>Last heartbeat: <Timestamp value={report.supabase.lastHeartbeatAt} fallback="None observed since startup" /></p>}
          {report.supabase.enrollment && <p>Enrollment credential expires: <Timestamp value={report.supabase.credentialExpiresAt} fallback="Unknown" /></p>}
        </Check>
        <Check label="DNS" type="dns" value={report.network.dnsStatus} />
        <Check label="HTTPS" type="tls" value={report.network.tls.status}>
          {report.network.tls.expiresAt && <p>Certificate expires <Timestamp value={report.network.tls.expiresAt} />.</p>}
          {report.network.origin && <p>Connection URL: <a href={report.network.origin}>{report.network.origin}</a></p>}
        </Check>
        <div className="server-check">
          <dt>Other devices</dt>
          <dd><strong>Not tested</strong><p>Open the connection URL from another device on your home network to verify access.</p></dd>
        </div>
      </dl>
    </>}
  </section>
}
