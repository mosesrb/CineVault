import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, ChevronLeft, Scale, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react'

export default function TermsOfService() {
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
          <FileText size={24} style={{ color: 'var(--accent)' }} /> Terms of Service
        </h1>
      </div>

      <div className="card-raised" style={{ padding: 'var(--sp-6)', lineHeight: 1.7, color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--sp-4)' }}>
          Last updated: August 2026
        </p>

        <section style={{ marginBottom: 'var(--sp-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Scale size={18} style={{ color: 'var(--accent)' }} /> 1. Acceptance of Terms
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            By accessing or using the CineVault application (via web browser or mobile client APK), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the software.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--sp-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={18} style={{ color: 'var(--accent)' }} /> 2. Personal &amp; Private Media Archiving
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            CineVault is personal media server software designed exclusively for organizing, transcoding, and streaming personal media files legally owned or managed by the server host and authorized family/household users. Users are responsible for complying with all applicable copyright and intellectual property laws in their respective jurisdictions.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--sp-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={18} style={{ color: 'var(--accent)' }} /> 3. Software Disclaimer &amp; As-Is License
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            CineVault is provided "AS IS", without warranty of any kind, express or implied. The developers and contributors shall not be liable for any claims, damages, data loss, or server misconfigurations resulting from the use of this software.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--sp-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={18} style={{ color: 'var(--accent)' }} /> 4. Account Responsibility
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            You are responsible for maintaining the confidentiality of your account credentials and restricting access to your personal devices. Server administrators hold autonomous authority over user invites, genre content permissions, and access privileges.
          </p>
        </section>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', marginTop: 'var(--sp-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to="/privacy" style={{ color: 'var(--accent)', textDecoration: 'underline', fontSize: 'var(--fs-sm)' }}>
            View Privacy Policy ↗
          </Link>
          <button type="button" onClick={handleBack} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
            Back to CineVault
          </button>
        </div>
      </div>
    </div>
  )
}
