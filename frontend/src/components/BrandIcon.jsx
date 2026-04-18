import React from 'react';

/**
 * Premium Brand Icon for CineVault
 * Concept: "The CV Aperture"
 * Interlocking C and V forming a camera lens/aperture signature.
 */
export default function BrandIcon({ size = 40, className = "" }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ filter: 'drop-shadow(0 0 4px var(--accent-glow))' }}
    >
      <defs>
        {/* Metallic Shimmer Gradient */}
        <linearGradient id="cv_metallic" x1="10%" y1="10%" x2="90%" y2="90%">
          <stop offset="0%" style={{ stopColor: '#ffffff', stopOpacity: 0.9 }} />
          <stop offset="45%" style={{ stopColor: 'var(--accent)', stopOpacity: 1 }} />
          <stop offset="55%" style={{ stopColor: 'var(--accent)', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#ffffff', stopOpacity: 0.9 }} />
        </linearGradient>

        {/* Deep Depth Radial */}
        <radialGradient id="cv_depth" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.4 }} />
          <stop offset="100%" style={{ stopColor: 'transparent', stopOpacity: 0 }} />
        </radialGradient>

        {/* Lens Flare Glow */}
        <filter id="cv_glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Background Depth Aura */}
      <circle cx="50" cy="50" r="45" fill="url(#cv_depth)" opacity="0.6" />

      {/* The "C" Frame (Outer Body) */}
      <path 
        d="M50 10 C 27.9 10 10 27.9 10 50 C 10 72.1 27.9 90 50 90 L 50 78 C 34.5 78 22 65.5 22 50 C 22 34.5 34.5 22 50 22 L 50 10 Z" 
        fill="url(#cv_metallic)" 
        filter="url(#cv_glow)"
        className="brand-shimmer-svg"
      />

      {/* The "V" Iris (Inner Signature) */}
      <path 
        d="M50 35 L 75 75 L 50 70 L 25 75 L 50 35 Z" 
        fill="var(--accent)" 
        opacity="0.95"
      />
      
      {/* Central "Iris" Core */}
      <circle cx="50" cy="54" r="5" fill="#fff" opacity="0.8" filter="url(#cv_glow)" />

      {/* Lens Shimmer Line */}
      <path 
        d="M30 25 L 70 25" 
        stroke="#fff" 
        strokeWidth="0.5" 
        strokeLinecap="round" 
        opacity="0.3" 
      />
    </svg>
  );
}
