import { Link } from 'react-router-dom'
import MediaCard from './MediaCard'

export default function MediaShelf({ title, items, type, link }) {
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
