import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { login } from '../api'
import { getNetworkInfo } from '../api'
import { useAuth } from '../context/AuthContext'
import { getMe } from '../api'
import BrandIcon from '../components/BrandIcon'
import GearIcon from '../components/GearIcon'
import { Server, Wifi, Check, Trash2, X } from 'lucide-react'
import { openLegalModal } from '../components/LegalViewerModal'
import './Login.css'

export default function Login() {
  const { loginUser } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Server Configuration
  const [showServerConfig, setShowServerConfig] = useState(false)
  const [serverUrl, setServerUrl] = useState(localStorage.getItem('cv_server_url') || '')
  const [serverMsg, setServerMsg] = useState('')
  const [localIps, setLocalIps] = useState([])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await login(email, password)
      // Save token first
      localStorage.setItem('cv_token', data.token)

      // Use user data returned from login instead of calling getMe
      loginUser(data.token, data.user)
      navigate('/')
    } catch (err) {
      setError(err.response?.data || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleSaveServer() {
    const trimmed = serverUrl.trim().replace(/\/$/, '')
    if (trimmed) {
      localStorage.setItem('cv_server_url', trimmed)
      setServerMsg('Server saved! Reloading...')
      setTimeout(() => window.location.href = '/', 1000)
    }
  }

  useEffect(() => {
    // Auto-detect when the modal opens if no URL is set yet
    if (showServerConfig && !serverUrl) {
      fetchLocalNetwork()
    }
  }, [showServerConfig])

  async function fetchLocalNetwork() {
    setServerMsg('Detecting local server...')
    
    // First try the backend if we are on PC (proxied) or if a working URL is already set
    const info = await getNetworkInfo()
    if (info?.localIps?.length) {
      const url = `http://${info.localIps[0].ip}:${info.port}`
      setLocalIps(info.localIps.map(n => `http://${n.ip}:${info.port}`))
      setServerUrl(url)
      setServerMsg('Detected local server! Click Set Server to save.')
      return
    }

    // If that fails (e.g. on Android with no URL), perform a quick subnet scan
    const isAndroid = typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.())
    if (isAndroid) {
      setServerMsg('Scanning local network... this may take a moment.')
      let found = null
      
      const tryPing = async (ip) => {
        if (found) return
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 1500)
          const res = await fetch(`http://${ip}:3000/api/v1/network-info`, { signal: controller.signal })
          clearTimeout(timeout)
          if (res.ok && !found) {
            found = `http://${ip}:3000`
            setServerUrl(found)
            setServerMsg(`Found server at ${found}! Click Set Server to save.`)
          }
        } catch (e) {
          // ignore
        }
      }

      const subnets = ['192.168.0', '192.168.1', '10.0.0']
      for (const subnet of subnets) {
        if (found) break
        // Batch requests to prevent exhausting Android WebView sockets
        for (let i = 2; i <= 254; i += 20) {
          if (found) break
          const batch = []
          for (let j = 0; j < 20 && (i + j) <= 254; j++) {
            batch.push(tryPing(`${subnet}.${i + j}`))
          }
          await Promise.all(batch)
        }
      }

      if (!found) {
        setServerMsg('Could not detect automatically. Try LocalTunnel URL or manual IP.')
      }
    } else {
      setServerMsg('Could not detect. Check if backend is running.')
    }
  }

  function handleClearServer() {
    localStorage.removeItem('cv_server_url')
    setServerUrl('')
    setServerMsg('Server configuration cleared. Reloading...')
    setTimeout(() => window.location.href = '/', 1000)
  }

  return (
    <div className="login-page">
      {/* Animated background blobs */}
      <div className="login-blob blob-1" />
      <div className="login-blob blob-2" />
      <div className="login-blob blob-3" />

      <div className="login-card glass animate-fadeUp">
        <button
          type="button"
          className="login-settings-toggle"
          onClick={() => setShowServerConfig(!showServerConfig)}
          title="Server Settings"
        >
          <GearIcon className="settings-gear" />
        </button>

        <div className="login-header">
          <div className="login-brand-unit">
            <div className="login-logo-wrap">
              <BrandIcon size={72} className="login-logo-svg" />
              <div className="login-logo-glow" />
            </div>
            <h1 className="login-title brand-shimmer">CineVault</h1>
          </div>
          <p className="login-subtitle">Your personal streaming library</p>
        </div>

        {showServerConfig && (
          <div className="login-server-config animate-fadeIn">
            <div className="login-config-header">
              <div className="login-config-title">
                <Server size={16} className="config-title-icon" />
                <span>Server Connection</span>
              </div>
              <button
                type="button"
                className="login-config-close"
                onClick={() => setShowServerConfig(false)}
                title="Close server settings"
              >
                <X size={15} />
              </button>
            </div>

            <p className="login-config-desc">
              Connect to your self-hosted backend. For remote or mobile access, specify your public IP, domain, or tunnel (e.g. <code>https://your-tunnel.loca.lt</code>).
            </p>

            {serverMsg && (
              <div className="alert alert-success" style={{ marginBottom: 'var(--sp-3)', fontSize: 'var(--fs-xs)' }}>
                {serverMsg}
              </div>
            )}

            <div className="login-config-controls">
              <div className="login-url-input-wrap">
                <input
                  type="url"
                  className="input login-server-input"
                  placeholder="https://your-backend.example.com"
                  value={serverUrl}
                  onChange={e => setServerUrl(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                />
              </div>

              {localIps.length > 0 && (
                <div className="login-detected-ips">
                  <span className="detected-ips-label">Detected LAN:</span>
                  <div className="detected-ips-list">
                    {localIps.map(ip => (
                      <button
                        key={ip}
                        type="button"
                        className="detected-ip-chip"
                        onClick={() => setServerUrl(ip)}
                      >
                        📡 {ip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="login-config-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm login-action-save"
                  onClick={handleSaveServer}
                >
                  <Check size={14} /> Set Server
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm login-action-detect"
                  onClick={fetchLocalNetwork}
                >
                  <Wifi size={14} /> Detect LAN IP
                </button>
                {localStorage.getItem('cv_server_url') && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm login-action-clear"
                    onClick={handleClearServer}
                    title="Reset to default origin"
                  >
                    <Trash2 size={13} /> Clear
                  </button>
                )}
              </div>
            </div>

            {localStorage.getItem('cv_server_url') && (
              <div className="active-server-tag">
                <div className="server-tag-status">
                  <span className="server-status-dot" />
                  <span className="server-tag-label">Active Connection</span>
                </div>
                <div className="server-tag-url">
                  {localStorage.getItem('cv_server_url')}
                </div>
              </div>
            )}
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg login-btn"
            disabled={loading}
          >
            {loading ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : null}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', margin: 'var(--sp-4) 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }}></div>
            <span style={{ padding: '0 var(--sp-3)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>OR</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }}></div>
          </div>

          <Link to="/register" className="btn btn-ghost btn-lg" style={{ width: '100%', justifyContent: 'center', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            Create New Account
          </Link>
        </form>

        <p className="login-footer" style={{ marginBottom: 'var(--sp-2)' }}>
          Access is invite-only for guest users.
        </p>

        <div style={{ textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          <button 
            type="button" 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openLegalModal('privacy');
            }} 
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', marginRight: 'var(--sp-3)', cursor: 'pointer', fontSize: 'inherit' }}
          >
            Privacy Policy
          </button>
          <span>•</span>
          <button 
            type="button" 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openLegalModal('terms');
            }} 
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', marginLeft: 'var(--sp-3)', cursor: 'pointer', fontSize: 'inherit' }}
          >
            Terms &amp; Conditions
          </button>
        </div>
      </div>
    </div>
  )
}
