import { Link } from 'react-router-dom'
import MediaCard from './MediaCard'

export default function MediaShelf({ title, items, type, link, loading = false }) {
  if (loading) {
    return (
      <section className="home-section animate-fadeUp">
        <div className="section-row-header">
          <div className="skeleton" style={{ width: '180px', height: '24px', borderRadius: '4px' }} />
        </div>
        <div className="media-shelf">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="media-card-skeleton" style={{ flex: '0 0 160px', width: '160px' }}>
              <div className="skeleton" style={{ width: '100%', aspectRatio: '2/3', borderRadius: 'var(--radius-lg)' }} />
              <div className="skeleton" style={{ width: '80%', height: '14px', marginTop: '8px', borderRadius: '4px' }} />
              <div className="skeleton" style={{ width: '40%', height: '12px', marginTop: '4px', borderRadius: '4px' }} />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (!items || items.length === 0) return null

  return (
    <section className="home-section animate-fadeUp">
      <div className="section-row-header">
        <h2 className="section-heading">{title}</h2>
        {link && <Link to={link} className="see-all">See all →</Link>}
      </div>
      <div className="media-shelf">
        {items.map((item, index) => (
          <MediaCard 
            key={item._id} 
            item={item} 
            type={type} 
            index={index} 
          />
        ))}
      </div>
    </section>
  )
}
