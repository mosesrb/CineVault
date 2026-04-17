import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { login } from '../api'
import { useAuth } from '../context/AuthContext'
import { getMe } from '../api'
import BrandIcon from '../components/BrandIcon'
import GearIcon from '../components/GearIcon'
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
      setTimeout(() => window.location.reload(), 1000)
    }
  }

  function handleClearServer() {
    localStorage.removeItem('cv_server_url')
    setServerUrl('')
    setServerMsg('Server configuration cleared. Reloading...')
    setTimeout(() => window.location.reload(), 1000)
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
            <h3 className="login-config-title">
              <GearIcon size={14} /> Server Configuration
            </h3>
            <p className="text-xs text-muted" style={{ marginBottom: 'var(--sp-3)', lineHeight: '1.4' }}>
              Connect your app to the backend. If using a mobile or TV app, ensure your Cloudflare tunnel points to the <strong>backend port (3000)</strong>, not the frontend.
            </p>
            {serverMsg && <div className="alert alert-success" style={{ marginBottom: 'var(--sp-3)', fontSize: 'var(--fs-xs)' }}>{serverMsg}</div>}
            <div className="login-server-input-group">
              <input
                type="url"
                className="input text-sm"
                placeholder="https://xxx.trycloudflare.com"
                value={serverUrl}
                onChange={e => setServerUrl(e.target.value)}
              />
              <div style={{ display: 'flex' }}>
                <button className="btn btn-primary" onClick={handleSaveServer}>Set</button>
                <button className="btn btn-ghost" style={{ borderLeft: 'none', borderRadius: '0 var(--radius) var(--radius) 0', fontSize: 'var(--fs-xs)' }} onClick={handleClearServer}>Clear</button>
              </div>
            </div>
            {localStorage.getItem('cv_server_url') && (
              <div className="active-server-tag">
                <span className="server-tag-label">Active Server</span>
                <span className="server-tag-url">{localStorage.getItem('cv_server_url')}</span>
              </div>
            )}
            <hr style={{ margin: 'var(--sp-4) 0', borderColor: 'var(--border)' }} />
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

        <p className="login-footer">
          Access is invite-only for guest users.
        </p>
      </div>
    </div>
  )
}
