import React, { useState, useEffect, useRef } from 'react'
import { 
  Shield, 
  FileText, 
  Lock, 
  HardDrive, 
  Server, 
  EyeOff, 
  Scale, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldCheck, 
  X 
} from 'lucide-react'
import './LegalViewerModal.css'

export function openLegalModal(doc = 'privacy') {
  window.dispatchEvent(new CustomEvent('cv_open_legal', { detail: { doc } }))
}

export default function LegalViewerModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeDoc, setActiveDoc] = useState('privacy') // 'privacy' | 'terms'
  const openedAtRef = useRef(0)

  useEffect(() => {
    const handleOpen = (e) => {
      const doc = e?.detail?.doc || 'privacy'
      setActiveDoc(doc)
      openedAtRef.current = Date.now()
      setIsOpen(true)
    }

    window.addEventListener('cv_open_legal', handleOpen)
    return () => window.removeEventListener('cv_open_legal', handleOpen)
  }, [])

  // Android hardware back button handler
  useEffect(() => {
    const handleHardwareBack = (e) => {
      if (isOpen) {
        e.preventDefault() // Stop app from minimizing or navigating away
        setIsOpen(false)
      }
    }

    window.addEventListener('cv_hardware_back', handleHardwareBack)
    return () => window.removeEventListener('cv_hardware_back', handleHardwareBack)
  }, [isOpen])

  const handleBackdropClick = (e) => {
    // Only dismiss if clicked outside the card
    if (e.target !== e.currentTarget) return
    // Prevent synthetic touch-ghost click on Android from immediately dismissing the modal
    if (Date.now() - openedAtRef.current < 450) {
      return
    }
    setIsOpen(false)
  }

  const handleClose = (e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    // Prevent synthetic touch-ghost click from immediately closing the modal
    if (Date.now() - openedAtRef.current < 450) {
      return
    }
    setIsOpen(false)
  }

  if (!isOpen) return null

  return (
    <div 
      className="legal-viewer-backdrop animate-fadeIn" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="legal-viewer-title"
      onClick={handleBackdropClick}
    >
      <div 
        className="legal-viewer-card glass animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER BAR */}
        <div className="legal-viewer-header">
          <div className="legal-viewer-brand-title">
            {activeDoc === 'privacy' ? (
              <Shield size={22} className="legal-viewer-icon" />
            ) : (
              <FileText size={22} className="legal-viewer-icon" />
            )}
            <h2 id="legal-viewer-title" className="legal-viewer-heading">
              {activeDoc === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
            </h2>
          </div>

          <div className="legal-viewer-header-actions">
            <div className="legal-viewer-pill-tabs">
              <button
                type="button"
                className={`legal-pill-tab ${activeDoc === 'privacy' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveDoc('privacy')
                }}
              >
                Privacy
              </button>
              <button
                type="button"
                className={`legal-pill-tab ${activeDoc === 'terms' ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveDoc('terms')
                }}
              >
                Terms
              </button>
            </div>

            <button
              type="button"
              className="legal-viewer-close-btn"
              onClick={handleClose}
              aria-label="Close legal viewer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* SCROLLABLE DOCUMENT CONTENT */}
        <div className="legal-viewer-content">
          <p className="legal-viewer-meta">
            CineVault Self-Hosted Platform • Last Updated: August 2026
          </p>

          {activeDoc === 'privacy' ? (
            <div className="legal-doc-body animate-fadeIn">
              <section className="legal-section-block">
                <h3>
                  <Lock size={16} /> 1. Self-Hosted &amp; Privacy-First Architecture
                </h3>
                <p>
                  CineVault is an independent, self-hosted media server and client streaming application. Your media collections, authentication credentials, streaming history, playback markers, and user data remain stored strictly on your configured private instance. We do not operate centralized tracking servers, monetize user metrics, or sell information to any third parties.
                </p>
              </section>

              <section className="legal-section-block">
                <h3>
                  <HardDrive size={16} /> 2. Data Stored on Your Device
                </h3>
                <p>
                  The CineVault web interface and Android APK store minimal operational data locally on your device:
                </p>
                <ul>
                  <li><strong>Session Tokens:</strong> Securely stored in local storage to keep you authenticated to your server.</li>
                  <li><strong>Offline Cache &amp; Downloads:</strong> Cached media files, posters, and queued watch progress stored on local device storage.</li>
                  <li><strong>Player Preferences:</strong> Preferred playback volume, subtitle tracks, and audio settings.</li>
                </ul>
              </section>

              <section className="legal-section-block">
                <h3>
                  <Server size={16} /> 3. Third-Party Metadata Services (TMDB)
                </h3>
                <p>
                  When enabled by the server administrator, CineVault queries The Movie Database (TMDB) API solely to fetch posters, plot summaries, release years, cast listings, and genres. No user identity, IP address mapping, or viewing histories are transmitted to TMDB.
                </p>
              </section>

              <section className="legal-section-block">
                <h3>
                  <EyeOff size={16} /> 4. Security &amp; User Autonomy
                </h3>
                <p>
                  You retain complete authority over your private instance data. You may modify your user profile, purge watch history, or revoke active sessions at any time. Passwords are protected using salted bcrypt hashes, and sessions follow strict token expiration rules.
                </p>
              </section>
            </div>
          ) : (
            <div className="legal-doc-body animate-fadeIn">
              <section className="legal-section-block">
                <h3>
                  <Scale size={16} /> 1. Acceptance of Terms
                </h3>
                <p>
                  By accessing or using the CineVault application (via web browser, Android APK, or TV client), you agree to be bound by these Terms of Service. If you disagree with any part of these terms, please discontinue use of the software.
                </p>
              </section>

              <section className="legal-section-block">
                <h3>
                  <CheckCircle2 size={16} /> 2. Personal &amp; Private Media Archiving
                </h3>
                <p>
                  CineVault is personal media server software designed exclusively for organizing, transcoding, and streaming personal media files legally owned, archived, or managed by the server host and authorized family/household users. Users are responsible for complying with all applicable copyright and intellectual property laws in their jurisdiction.
                </p>
              </section>

              <section className="legal-section-block">
                <h3>
                  <AlertTriangle size={16} /> 3. Software Disclaimer &amp; As-Is License
                </h3>
                <p>
                  CineVault is provided "AS IS", without warranties of any kind, express or implied. The developers, authors, and contributors shall not be held liable for any damages, data loss, hardware strain, or server misconfigurations resulting from the use of this software.
                </p>
              </section>

              <section className="legal-section-block">
                <h3>
                  <ShieldCheck size={16} /> 4. Account &amp; Server Responsibility
                </h3>
                <p>
                  Server administrators hold autonomous authority over user accounts, invites, genre permissions, and storage quotas. Users are responsible for maintaining the confidentiality of their credentials and securing access to their personal devices.
                </p>
              </section>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="legal-viewer-footer">
          <button
            type="button"
            className="btn btn-primary legal-viewer-done-btn"
            onClick={handleClose}
          >
            Close &amp; Return
          </button>
        </div>
      </div>
    </div>
  )
}
