import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, X, Image as ImageIcon } from 'lucide-react'
import { resolveUrl } from '../api'
import './ImageViewerModal.css'

export default function ImageViewerModal({
  isOpen,
  images = [],
  initialIndex = 0,
  title = 'Pictures',
  onClose
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [touchStart, setTouchStart] = useState(null)
  const [touchEnd, setTouchEnd] = useState(null)
  const openedAtRef = useRef(0)
  const thumbListRef = useRef(null)

  // Reset current index when initialIndex changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(Math.max(0, Math.min(initialIndex, images.length - 1)))
      openedAtRef.current = Date.now()
    }
  }, [isOpen, initialIndex, images.length])

  // Android hardware back button handler
  useEffect(() => {
    const handleHardwareBack = (e) => {
      if (isOpen) {
        e.preventDefault()
        onClose?.()
      }
    }
    window.addEventListener('cv_hardware_back', handleHardwareBack)
    return () => window.removeEventListener('cv_hardware_back', handleHardwareBack)
  }, [isOpen, onClose])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  // Scroll active thumbnail into view
  useEffect(() => {
    if (isOpen && thumbListRef.current) {
      const activeThumb = thumbListRef.current.children[currentIndex]
      if (activeThumb && typeof activeThumb.scrollIntoView === 'function') {
        activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [currentIndex, isOpen])

  const goNext = useCallback(() => {
    if (images.length <= 1) return
    setCurrentIndex(prev => (prev + 1) % images.length)
  }, [images.length])

  const goPrev = useCallback(() => {
    if (images.length <= 1) return
    setCurrentIndex(prev => (prev - 1 + images.length) % images.length)
  }, [images.length])

  // Keyboard navigation for Web & Android TV D-Pad Remotes
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault()
          goNext()
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault()
          goPrev()
          break
        case 'Escape':
        case 'Backspace':
          e.preventDefault()
          onClose?.()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, goNext, goPrev, onClose])

  // Touch swipe gestures for mobile / tablet
  const minSwipeDistance = 45

  const handleTouchStart = (e) => {
    setTouchEnd(null)
    setTouchStart(e.targetTouches[0].clientX)
  }

  const handleTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX)
  }

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return
    const distance = touchStart - touchEnd
    const isLeftSwipe = distance > minSwipeDistance
    const isRightSwipe = distance < -minSwipeDistance

    if (isLeftSwipe) {
      goNext()
    } else if (isRightSwipe) {
      goPrev()
    }
  }

  const handleBackdropClick = (e) => {
    if (e.target !== e.currentTarget) return
    // Ghost click protection on Android
    if (Date.now() - openedAtRef.current < 400) return
    onClose?.()
  }

  if (!isOpen || images.length === 0) return null

  const currentImage = images[currentIndex]
  const currentImageUrl = typeof currentImage === 'string' ? currentImage : currentImage?.url

  return (
    <div
      className="iv-overlay"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Picture viewer"
    >
      {/* Top Header Bar */}
      <div className="iv-header">
        <div className="iv-title-group">
          <ImageIcon size={18} className="iv-icon" />
          <span className="iv-title truncate">{title}</span>
          <span className="iv-counter">
            {currentIndex + 1} / {images.length}
          </span>
        </div>

        <div className="iv-actions">
          <button
            className="iv-btn iv-close-btn"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close picture viewer"
            tabIndex={0}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main Stage */}
      <div
        className="iv-stage"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {images.length > 1 && (
          <button
            className="iv-nav-btn iv-prev-btn"
            onClick={goPrev}
            title="Previous (Left Arrow)"
            aria-label="Previous image"
            tabIndex={0}
          >
            <ChevronLeft size={32} />
          </button>
        )}

        <div className="iv-image-container">
          <img
            key={currentImageUrl}
            src={resolveUrl(currentImageUrl)}
            alt={`${title} - ${currentIndex + 1}`}
            className="iv-image animate-fadeIn"
            draggable={false}
          />
        </div>

        {images.length > 1 && (
          <button
            className="iv-nav-btn iv-next-btn"
            onClick={goNext}
            title="Next (Right Arrow)"
            aria-label="Next image"
            tabIndex={0}
          >
            <ChevronRight size={32} />
          </button>
        )}
      </div>

      {/* Bottom Thumbnail Gallery Strip */}
      {images.length > 1 && (
        <div className="iv-thumbs-container">
          <div className="iv-thumbs-track" ref={thumbListRef}>
            {images.map((img, idx) => {
              const url = typeof img === 'string' ? img : img?.url
              const isActive = idx === currentIndex
              return (
                <button
                  key={idx}
                  className={`iv-thumb-btn ${isActive ? 'active' : ''}`}
                  onClick={() => setCurrentIndex(idx)}
                  tabIndex={0}
                  aria-label={`Go to image ${idx + 1}`}
                >
                  <img src={resolveUrl(url)} alt={`Thumbnail ${idx + 1}`} loading="lazy" />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
