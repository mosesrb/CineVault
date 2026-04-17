import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Star, Play } from 'lucide-react'
import { resolveUrl } from '../api'
import './HeroCarousel.css'

export default function HeroCarousel({ items = [] }) {
  const [current, setCurrent] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const touchStart = useRef(null)
  const touchEnd = useRef(null)

  // Minimum swipe distance in pixels
  const minSwipeDistance = 50

  const nextSlide = useCallback(() => {
    if (isAnimating || items.length <= 1) return
    setIsAnimating(true)
    setCurrent((prev) => (prev + 1) % items.length)
    setTimeout(() => setIsAnimating(false), 800)
  }, [items.length, isAnimating])

  const prevSlide = useCallback(() => {
    if (isAnimating || items.length <= 1) return
    setIsAnimating(true)
    setCurrent((prev) => (prev - 1 + items.length) % items.length)
    setTimeout(() => setIsAnimating(false), 800)
  }, [items.length, isAnimating])

  useEffect(() => {
    const timer = setInterval(nextSlide, 7000)
    return () => clearInterval(timer)
  }, [nextSlide])

  const onTouchStart = (e) => {
    touchEnd.current = null
    touchStart.current = e.targetTouches[0].clientX
  }

  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientX
  }

  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return
    const distance = touchStart.current - touchEnd.current
    const isLeftSwipe = distance > minSwipeDistance
    const isRightSwipe = distance < -minSwipeDistance
    if (isLeftSwipe) {
      nextSlide()
    } else if (isRightSwipe) {
      prevSlide()
    }
  }

  if (!items || items.length === 0) return null

  return (
    <div 
      className="hero-carousel"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {items.map((item, idx) => (
        <div 
          key={item._id} 
          className={`hero-slide ${idx === current ? 'active' : ''}`}
          style={{ backgroundImage: `url(${resolveUrl(item.backdropUrl || item.posterUrl)})` }}
        >
          {/* Enhanced multi-layer gradient for extreme readability */}
          <div className="hero-overlay-dark" />
          <div className="hero-overlay-side" />
          <div className="hero-overlay-bottom" />
          
          <div className="hero-content-wrap container">
            <div className="hero-info animate-fadeUp">
              <div className="hero-badges">
                {item.genres?.slice(0, 2).map(g => (
                  <span key={g._id} className="hero-badge">{g.name}</span>
                ))}
                {item.rating > 0 && <span className="hero-badge hero-rating"><Star size={12} fill="currentColor" /> {item.rating.toFixed(1)}</span>}
              </div>
              
              <h1 className="hero-title">{item.title}</h1>
              {item.tagline && <p className="hero-tagline">{item.tagline}</p>}
              <p className="hero-description">{item.description}</p>
              
              <div className="hero-actions">
                <Link to={`/watch/${item._type || 'movie'}/${item._id || item.id}`} className="hero-btn hero-btn-primary">
                  <Play size={20} fill="currentColor" /> Play
                </Link>
                <Link to={`/detail/${item._type || 'movie'}/${item._id || item.id}`} className="hero-btn hero-btn-ghost">
                  More Info
                </Link>
              </div>
            </div>
          </div>
        </div>
      ))}

      {items.length > 1 && (
        <>
          <button className="carousel-nav prev" onClick={(e) => { e.stopPropagation(); prevSlide(); }} aria-label="Previous slide">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          
          <button className="carousel-nav next" onClick={(e) => { e.stopPropagation(); nextSlide(); }} aria-label="Next slide">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>

          <div className="carousel-dots">
            {items.map((_, idx) => (
              <button 
                key={idx} 
                className={`carousel-dot ${idx === current ? 'active' : ''}`}
                onClick={() => setCurrent(idx)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
