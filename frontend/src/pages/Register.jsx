import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { register, getMe } from '../api'
import { CheckCircle2 } from 'lucide-react'
import BrandIcon from '../components/BrandIcon'
import { useAuth } from '../context/AuthContext'
import './Register.css'

export default function Register() {
  const { loginUser } = useAuth()
  const navigate = useNavigate()
  
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [isSuccess, setIsSuccess] = useState(false)
  
    async function handleSubmit(e) {
      e.preventDefault()
      setError('')
  
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
  
      setLoading(true)
      try {
        await register(name, email, password)
        setIsSuccess(true)
      } catch (err) {
        setError(err.response?.data || 'Registration failed. Please try again.')
      } finally {
        setLoading(false)
      }
    }

  return (
    <div className="register-page">
      <div className="register-blob blob-1" />
      <div className="register-blob blob-2" />
      <div className="register-blob blob-3" />

      <div className="register-card glass animate-fadeUp">
        <div className="register-header">
          <div className="login-logo-wrap">
            <BrandIcon size={56} className="login-logo-svg" />
            <div className="login-logo-glow" />
          </div>
          <h1 className="register-title brand-shimmer">Join CineVault</h1>
          <p className="register-subtitle">Create your personal streaming account</p>
        </div>

        {isSuccess ? (
          <div className="animate-fadeUp" style={{textAlign:'center', padding:'var(--sp-6) 0'}}>
            <div style={{color:'var(--success)', marginBottom:'var(--sp-4)', display:'flex', justifyContent:'center'}}>
              <CheckCircle2 size={64} />
            </div>
            <h2 style={{fontSize:'var(--fs-2xl)', fontWeight:700, marginBottom:'var(--sp-3)', color:'var(--text-primary)'}}>Registration Success!</h2>
            <p className="text-muted" style={{marginBottom:'var(--sp-6)'}}>
              Your account has been created and is now <strong>pending administrative approval</strong>.<br/>
              Please check back later or contact your administrator.
            </p>
            <Link to="/login" className="btn btn-primary btn-lg">Back to Sign In</Link>
          </div>
        ) : (
          <form className="register-form" onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="field">
              <label htmlFor="name">Full Name</label>
              <input
                id="name"
                type="text"
                className="input"
                placeholder="John Doe"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                autoFocus
              />
            </div>

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
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                placeholder="Min. 5 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={5}
              />
            </div>

            <div className="field">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                className="input"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg register-btn"
              disabled={loading}
            >
              {loading ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : null}
              {loading ? 'Creating Account…' : 'Sign Up'}
            </button>
          </form>
        )}

        <p className="register-footer">
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
      </div>
    </div>
  )
}
