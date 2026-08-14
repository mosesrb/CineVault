import React, { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { 
  Shield, 
  FileText, 
  CheckCircle2, 
  Lock, 
  HardDrive, 
  Server, 
  EyeOff, 
  Scale, 
  AlertTriangle, 
  ShieldCheck, 
  ArrowLeft, 
  BookOpen, 
  X 
} from 'lucide-react'
import './LegalConsentModal.css'

const STORAGE_KEY = 'cv_legal_consent_accepted'

export default function LegalConsentModal() {
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [viewMode, setViewMode] = useState('consent') // 'consent' | 'privacy' | 'terms'
  const modeSwitchedAtRef = useRef(0)

  useEffect(() => {
    try {
      const consent = localStorage.getItem(STORAGE_KEY)
      if (!consent) {
        setIsOpen(true)
      }
    } catch (_) {}
  }, [])

  // Android hardware back button handler
  useEffect(() => {
    const handleHardwareBack = (e) => {
      if (isOpen && viewMode !== 'consent') {
        e.preventDefault() // Stop app from minimizing or navigating away
        setViewMode('consent')
      }
    }

    window.addEventListener('cv_hardware_back', handleHardwareBack)
    return () => window.removeEventListener('cv_hardware_back', handleHardwareBack)
  }, [isOpen, viewMode])

  const switchMode = (newMode, e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    modeSwitchedAtRef.current = Date.now()
    setViewMode(newMode)
  }

  const handleReturnToConsent = (e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    // Prevent synthetic touch-ghost click on mobile Android from instantly bouncing back
    if (Date.now() - modeSwitchedAtRef.current < 450) {
      return
    }
    setViewMode('consent')
  }

  const handleAccept = (e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString())
      setIsOpen(false)
    } catch (_) {}
  }

  // Do not show modal on top of standalone privacy or terms pages
  if (!isOpen || location.pathname === '/privacy' || location.pathname === '/terms') {
    return null
  }

  return (
    <div className="legal-consent-backdrop animate-fadeIn" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div 
        className={`legal-consent-card glass animate-scaleUp ${viewMode !== 'consent' ? 'legal-reader-card' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* VIEW MODE: CONSENT OVERVIEW */}
        {viewMode === 'consent' && (
          <>
            <div className="legal-consent-header">
              <div className="legal-consent-icon-wrap">
                <Shield size={32} className="legal-consent-icon" />
              </div>
              <div>
                <h2 id="consent-title" className="legal-consent-title">
                  Welcome to CineVault
                </h2>
                <p className="legal-consent-subtitle">
                  Privacy-first, self-hosted media streaming
                </p>
              </div>
            </div>

            <div className="legal-consent-body">
              <p className="legal-consent-text">
                Please review and accept our Terms of Service and Privacy Policy before continuing. CineVault is designed with zero third-party tracking, ensuring your media library and streaming history remain strictly private to your server instance.
              </p>

              <div className="legal-consent-highlights">
                <div className="legal-highlight-item">
                  <Lock size={16} className="highlight-icon" />
                  <div>
                    <strong>Self-Hosted &amp; Private:</strong> Streaming history and account data stay on your instance. No cloud telemetry or third-party ads.
                  </div>
                </div>
                <div className="legal-highlight-item">
                  <FileText size={16} className="highlight-icon" />
                  <div>
                    <strong>Personal Media Archiving:</strong> Designed strictly for personal, household media collections.
                  </div>
                </div>
              </div>

              <div className="legal-reader-trigger-row">
                <button 
                  type="button" 
                  className="legal-doc-btn"
                  onClick={(e) => switchMode('privacy', e)}
                >
                  <Shield size={15} /> Read Full Privacy Policy
                </button>
                <button 
                  type="button" 
                  className="legal-doc-btn"
                  onClick={(e) => switchMode('terms', e)}
                >
                  <FileText size={15} /> Read Full Terms of Service
                </button>
              </div>

              <label className="legal-checkbox-label">
                <input
                  type="checkbox"
                  className="legal-checkbox"
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                />
                <span>
                  I agree to the{' '}
                  <button 
                    type="button" 
                    className="legal-inline-link" 
                    onClick={(e) => switchMode('terms', e)}
                  >
                    Terms of Service
                  </button>{' '}
                  and acknowledge the{' '}
                  <button 
                    type="button" 
                    className="legal-inline-link" 
                    onClick={(e) => switchMode('privacy', e)}
                  >
                    Privacy Policy
                  </button>.
                </span>
              </label>
            </div>

            <div className="legal-consent-footer">
              <button
                type="button"
                className="btn btn-primary btn-lg legal-accept-btn"
                disabled={!agreed}
                onClick={handleAccept}
              >
                <CheckCircle2 size={18} /> Accept &amp; Continue
              </button>
            </div>
          </>
        )}

        {/* VIEW MODE: INLINE PRIVACY POLICY */}
        {viewMode === 'privacy' && (
          <div className="legal-doc-viewer animate-fadeIn">
            <div className="legal-doc-viewer-nav">
              <button 
                type="button" 
                className="btn btn-ghost btn-sm legal-back-btn" 
                onClick={handleReturnToConsent}
              >
                <ArrowLeft size={15} /> Back
              </button>
              <div className="legal-viewer-tabs">
                <button 
                  type="button" 
                  className="legal-tab-btn active"
                >
                  Privacy
                </button>
                <button 
                  type="button" 
                  className="legal-tab-btn"
                  onClick={(e) => switchMode('terms', e)}
                >
                  Terms
                </button>
              </div>
            </div>

            <div className="legal-doc-scroll-content">
              <div className="legal-doc-title-row">
                <Shield size={24} style={{ color: 'var(--accent)' }} />
                <h2 className="legal-doc-viewer-title">Privacy Policy</h2>
              </div>
              <p className="legal-doc-date">Last updated: August 2026</p>

              <section className="legal-doc-section">
                <h3><Lock size={16} /> 1. Self-Hosted &amp; Privacy-First Architecture</h3>
                <p>
                  CineVault is an independent, self-hosted media server and streaming application. Your media libraries, credentials, stream histories, and watch progress are stored directly on your configured server instance. We do not operate centralized tracking servers, monetize user data, or share personal information with third parties.
                </p>
              </section>

              <section className="legal-doc-section">
                <h3><HardDrive size={16} /> 2. Data Stored on Your Device</h3>
                <p>
                  The CineVault web app and mobile APK store minimal operational data on your local device:
                </p>
                <ul>
                  <li><strong>Authentication Tokens:</strong> Securely stored in local storage to keep your session active.</li>
                  <li><strong>Offline Sync Cache:</strong> Cached watch progress and metadata queued for offline playback and synchronized when connectivity resumes.</li>
                  <li><strong>Player Preferences:</strong> Local volume, subtitle visibility, and playback preferences.</li>
                </ul>
              </section>

              <section className="legal-doc-section">
                <h3><Server size={16} /> 3. Third-Party Metadata Services (TMDB)</h3>
                <p>
                  When enabled by the administrator, CineVault communicates with The Movie Database (TMDB) API exclusively to retrieve cinematic metadata such as posters, plot summaries, release years, and cast details. No personal viewing history or user identity is sent to TMDB.
                </p>
              </section>

              <section className="legal-doc-section">
                <h3><EyeOff size={16} /> 4. Security &amp; User Control</h3>
                <p>
                  You have full control over your data. You may update your profile, wipe watch history, or request account deletion directly through your instance administrator. Sessions are protected using industry-standard salted hashing and automated session timeout lifecycle rules.
                </p>
              </section>
            </div>

            <div className="legal-doc-viewer-footer">
              <button 
                type="button" 
                className="btn btn-primary legal-done-reading-btn" 
                onClick={handleReturnToConsent}
              >
                <CheckCircle2 size={16} /> Done Reading • Return to Agree
              </button>
            </div>
          </div>
        )}

        {/* VIEW MODE: INLINE TERMS OF SERVICE */}
        {viewMode === 'terms' && (
          <div className="legal-doc-viewer animate-fadeIn">
            <div className="legal-doc-viewer-nav">
              <button 
                type="button" 
                className="btn btn-ghost btn-sm legal-back-btn" 
                onClick={handleReturnToConsent}
              >
                <ArrowLeft size={15} /> Back
              </button>
              <div className="legal-viewer-tabs">
                <button 
                  type="button" 
                  className="legal-tab-btn"
                  onClick={(e) => switchMode('privacy', e)}
                >
                  Privacy
                </button>
                <button 
                  type="button" 
                  className="legal-tab-btn active"
                >
                  Terms
                </button>
              </div>
            </div>

            <div className="legal-doc-scroll-content">
              <div className="legal-doc-title-row">
                <FileText size={24} style={{ color: 'var(--accent)' }} />
                <h2 className="legal-doc-viewer-title">Terms of Service</h2>
              </div>
              <p className="legal-doc-date">Last updated: August 2026</p>

              <section className="legal-doc-section">
                <h3><Scale size={16} /> 1. Acceptance of Terms</h3>
                <p>
                  By accessing or using the CineVault application (via web browser or mobile client APK), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the software.
                </p>
              </section>

              <section className="legal-doc-section">
                <h3><CheckCircle2 size={16} /> 2. Personal &amp; Private Media Archiving</h3>
                <p>
                  CineVault is personal media server software designed exclusively for organizing, transcoding, and streaming personal media files legally owned or managed by the server host and authorized family/household users. Users are responsible for complying with all applicable copyright and intellectual property laws in their respective jurisdictions.
                </p>
              </section>

              <section className="legal-doc-section">
                <h3><AlertTriangle size={16} /> 3. Software Disclaimer &amp; As-Is License</h3>
                <p>
                  CineVault is provided "AS IS", without warranty of any kind, express or implied. The developers and contributors shall not be liable for any claims, damages, data loss, or server misconfigurations resulting from the use of this software.
                </p>
              </section>

              <section className="legal-doc-section">
                <h3><ShieldCheck size={16} /> 4. Account Responsibility</h3>
                <p>
                  You are responsible for maintaining the confidentiality of your account credentials and restricting access to your personal devices. Server administrators hold autonomous authority over user invites, genre content permissions, and access privileges.
                </p>
              </section>
            </div>

            <div className="legal-doc-viewer-footer">
              <button 
                type="button" 
                className="btn btn-primary legal-done-reading-btn" 
                onClick={handleReturnToConsent}
              >
                <CheckCircle2 size={16} /> Done Reading • Return to Agree
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
