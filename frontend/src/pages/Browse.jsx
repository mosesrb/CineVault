import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getMovies, getTVShows, getGenres } from '../api'
import { Film } from 'lucide-react'
import MediaCard from '../components/MediaCard'
import MediaShelf from '../components/MediaShelf'
import './Browse.css'

export default function Browse() {
  const { genre: slug } = useParams()
  const [items, setItems]   = useState([])
  const [genre, setGenre]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getMovies({ genre: slug }),
      getTVShows({ genre: slug }),
      getGenres()
    ]).then(([mRes, sRes, gRes]) => {
      const movies = mRes.data.map(m => ({ ...m, _type: 'movie' }))
      const shows  = sRes.data.map(s => ({ ...s, _type: 'tvshow' }))
      setItems([...movies, ...shows])
      setGenre(gRes.data.find(g => g.slug === slug) || null)
    }).finally(() => setLoading(false))
  }, [slug])

  return (
    <div className="page-layout">
      <div className="page-content animate-fadeUp" style={{paddingBottom: 'var(--sp-20)'}}>
        <div className="browse-header">
          <h1 className="section-heading">{genre?.name || slug}</h1>
          <p className="text-muted text-sm">{items.length} title{items.length !== 1 ? 's' : ''}</p>
        </div>

        {loading
          ? <div className="loading-center"><div className="spinner" /></div>
          : items.length === 0
            ? <div className="empty-state"><Film className="empty-icon" size={64} /><p>Nothing to see here, come back later</p></div>
            : <MediaShelf 
                title={`${genre?.name || slug} Collections`} 
                items={items} 
                type="mixed" 
              />
        }
      </div>
    </div>
  )
}
