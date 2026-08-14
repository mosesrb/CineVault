import React from 'react'
import { Link } from 'react-router-dom'
import { Shield, FileText, Server, Film, Home, Tv, Search } from 'lucide-react'
import BrandIcon from './BrandIcon'
import { openLegalModal } from './LegalViewerModal'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner container">
        <div className="site-footer-brand">
          <div className="footer-logo-row">
            <BrandIcon size={22} className="footer-logo" />
            <span className="footer-brand-name">CineVault</span>
          </div>
          <p className="footer-tagline">
            Your personal, self-hosted private media server. Zero tracking, zero telemetry.
          </p>
        </div>

        <div className="footer-col">
          <h4 className="footer-col-title">Navigation</h4>
          <Link to="/"><Home size={13} /> Home</Link>
          <Link to="/movies"><Film size={13} /> Movies</Link>
          <Link to="/tv"><Tv size={13} /> TV Shows</Link>
          <Link to="/search"><Search size={13} /> Search</Link>
        </div>

        <div className="footer-col">
          <h4 className="footer-col-title">Legal &amp; Info</h4>
          <button 
            type="button" 
            className="footer-legal-btn" 
            onClick={() => openLegalModal('privacy')}
          >
            <Shield size={13} /> Privacy Policy
          </button>
          <button 
            type="button" 
            className="footer-legal-btn" 
            onClick={() => openLegalModal('terms')}
          >
            <FileText size={13} /> Terms of Service
          </button>
          <Link to="/profile?tab=settings"><Server size={13} /> Instance Settings</Link>
        </div>
      </div>

      <div className="site-footer-bottom container">
        <p className="footer-copy">
          &copy; {new Date().getFullYear()} CineVault. Self-hosted personal media server.
        </p>
        <p className="footer-legal-note">
          Crafted for private media archiving • Zero third-party telemetry
        </p>
      </div>
    </footer>
  )
}
