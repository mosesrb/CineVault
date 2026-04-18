import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Play, Star, Info, DownloadCloud } from 'lucide-react'
import { resolveUrl } from '../api'
import { OfflineStorageService } from '../services/OfflineStorageService'
import './MediaCard.css'

export default function MediaCard({ item, type, progress, index = 0, variant = 'grid' }) {
  const navigate = useNavigate()
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (item?._id) {
      OfflineStorageService.getDownloadRecord(item._id).then(record => {
        if (record?.status === 'completed') setDownloaded(true);
      });
    }
  }, [item?._id]);

  if (!item) return null;

  const mediaType = type || item.mediaType || item.type || 'movie'
  const detailUrl = `/detail/${mediaType}/${item._id}`
  const playUrl = `/watch/${mediaType}/${item._id}`
  const title = item.title || 'Untitled'
  const year = item.year
  const poster = resolveUrl(item.posterUrl)
  const rating = item.rating

  // --- List Variant Rendering ---
  if (variant === 'list') {
    return (
      <div
        className="media-card media-card--list animate-staggered"
        style={{ '--index': index }}
        tabIndex={0}
        role="article"
        aria-label={`${title}${year ? `, ${year}` : ''}`}
        onKeyDown={e => e.key === 'Enter' && navigate(detailUrl)}
      >
        <Link to={detailUrl} className="card-list-content">
          <div className="card-list-poster">
             {poster ? <img src={poster} alt={title} loading="lazy" /> : <div className="card-poster-placeholder"><span>{title.charAt(0)}</span></div>}
             {mediaType === 'tvshow' && <div className="card-type-badge card-type-badge--sm">TV</div>}
             {rating > 0 && (
               <div className="card-list-rating">
                  <Star size={10} fill="currentColor" /> {rating.toFixed(1)}
               </div>
             )}
          </div>
          <div className="card-list-info">
            <p className="card-list-title">{title}</p>
            <div className="card-list-meta">
              <span>{year}</span>
              {downloaded && <span className="text-accent text-xs font-bold">• Offline</span>}
            </div>
          </div>
        </Link>
        <Link to={playUrl} className="card-list-play" aria-label="Play">
           <Play size={16} fill="currentColor" />
        </Link>
      </div>
    )
  }

  // --- Default Grid Variant ---
  return (
    <div
      className="media-card animate-staggered"
      style={{ '--index': index }}
      tabIndex={0}
      role="article"
      aria-label={`${title}${year ? `, ${year}` : ''}`}
      onKeyDown={e => e.key === 'Enter' && navigate(detailUrl)}
    >
      <Link to={detailUrl} className="card-poster-link" aria-label={`${title} (${year})`}>
        <div className="card-poster">
          {poster
            ? <img src={poster} alt={title} loading="lazy" />
            : <div className="card-poster-placeholder">
                <span>{title?.charAt(0)}</span>
              </div>
          }
          {/* Gradient overlay always present at bottom for legibility */}
          <div className="card-overlay-gradient" />

          {downloaded && (
            <div className="card-offline-badge" title="Available offline">
              <DownloadCloud size={12} />
              <span>Offline</span>
            </div>
          )}

          {rating > 0 && (
            <div className="card-rating">
              <Star size={12} fill="currentColor" /> {rating.toFixed(1)}
            </div>
          )}
          {mediaType === 'tvshow' && (
            <div className="card-type-badge">TV</div>
          )}
          {progress > 0 && (
            <div className="card-progress-container">
              <div 
                className={`card-progress-bar ${mediaType === 'tvshow' ? 'card-progress-bar--series' : ''}`} 
                style={{ width: `${Math.min(progress, 100)}%` }} 
              />
            </div>
          )}
        </div>
      </Link>

      {/* Quick action bar — appears on hover */}
      <div className="card-quick-actions">
        <Link
          to={playUrl}
          className="card-quick-play"
          aria-label={`Play ${title}`}
          title="Play now"
        >
          <Play size={18} fill="currentColor" />
        </Link>
        <Link
          to={detailUrl}
          className="card-quick-info"
          aria-label={`More info about ${title}`}
          title="More info"
        >
          <Info size={16} />
        </Link>
      </div>

      <div className="card-info">
        <Link to={detailUrl} className="card-title-link">
          <p className="card-title truncate">{title}</p>
        </Link>
        {year && <p className="card-year">{year}</p>}
      </div>
    </div>
  )
}
