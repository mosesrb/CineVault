import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Shield, ChevronLeft, Lock, HardDrive, EyeOff, Server, FileText } from 'lucide-react'

export default function PrivacyPolicy() {
  const navigate = useNavigate()

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/login', { replace: true })
    }
  }

  React.useEffect(() => {
    const handleHardwareBack = (e) => {
      e.preventDefault()
      handleBack()
    }

    window.addEventListener('cv_hardware_back', handleHardwareBack)
    return () => window.removeEventListener('cv_hardware_back', handleHardwareBack)
  }, [])

  return (
    <div className="container" style={{ maxWidth: '800px', margin: '0 auto', padding: 'var(--sp-8) var(--sp-4)', minHeight: '80vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-6)' }}>
        <button 
          type="button" 
          onClick={handleBack} 
          className="btn btn-ghost btn-sm" 
          style={{ padding: 8, borderRadius: '50%', width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          aria-label="Go back"
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="section-heading" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Shield size={24} style={{ color: 'var(--accent)' }} /> Privacy Policy
        </h1>
      </div>

      <div className="card-raised" style={{ padding: 'var(--sp-6)', lineHeight: 1.7, color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--sp-4)' }}>
          Last updated: August 2026
        </p>

        <section style={{ marginBottom: 'var(--sp-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Lock size={18} style={{ color: 'var(--accent)' }} /> 1. Self-Hosted &amp; Privacy-First Architecture
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            CineVault is an independent, self-hosted media server and streaming application. Your media libraries, credentials, stream histories, and watch progress are stored directly on your configured server instance. We do not operate centralized tracking servers, monetize user data, or share personal information with third parties.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--sp-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <HardDrive size={18} style={{ color: 'var(--accent)' }} /> 2. Data Stored on Your Device
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            The CineVault web app and mobile APK store minimal operational data on your local device:
          </p>
          <ul style={{ paddingLeft: '20px', marginTop: 'var(--sp-2)', color: 'var(--text-secondary)' }}>
            <li><strong>Authentication Tokens:</strong> Securely stored in local storage to keep your session active.</li>
            <li><strong>Offline Sync Cache:</strong> Cached watch progress and metadata queued for offline playback and synchronized when connectivity resumes.</li>
            <li><strong>Player Preferences:</strong> Local volume, subtitle visibility, and playback preferences.</li>
          </ul>
        </section>

        <section style={{ marginBottom: 'var(--sp-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} style={{ color: 'var(--accent)' }} /> 3. Third-Party Metadata Services (TMDB)
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            When enabled by the administrator, CineVault communicates with The Movie Database (TMDB) API exclusively to retrieve cinematic metadata such as posters, plot summaries, release years, and cast details. No personal viewing history or user identity is sent to TMDB.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--sp-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <EyeOff size={18} style={{ color: 'var(--accent)' }} /> 4. Security &amp; User Control
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            You have full control over your data. You may update your profile, wipe watch history, or request account deletion directly through your instance administrator. Sessions are protected using industry-standard salted hashing and automated session timeout lifecycle rules.
          </p>
        </section>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', marginTop: 'var(--sp-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to="/terms" style={{ color: 'var(--accent)', textDecoration: 'underline', fontSize: 'var(--fs-sm)' }}>
            View Terms of Service ↗
          </Link>
          <button type="button" onClick={handleBack} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
            Back to CineVault
          </button>
        </div>
      </div>
    </div>
  )
}
