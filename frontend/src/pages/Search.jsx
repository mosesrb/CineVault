import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { search as searchApi } from '../api'
import MediaCard from '../components/MediaCard'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { Search as SearchIcon, Clapperboard, Tv } from 'lucide-react'
import './Search.css'
import './Browse.css'

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') || ''
  const [results, setResults] = useState({ movies: [], shows: [] })
  const [loading, setLoading] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 769px)')

  useEffect(() => {
    if (!q) {
      setResults({ movies: [], shows: [] })
      return
    }

    setLoading(true)
    searchApi(q)
      .then(r => setResults(r.data))
      .catch(() => setResults({ movies: [], shows: [] }))
      .finally(() => setLoading(false))
  }, [q])

  const mediaVariant = isDesktop ? 'grid' : 'list'
  const containerClass = isDesktop ? 'media-grid' : 'media-list-column'

  if (loading) {
    return (
      <div className="page-layout">
        <div className="loading-center">
          <div className="spinner" />
          <p className="text-muted mt-4">Searching library...</p>
        </div>
      </div>
    )
  }

  const hasMovies = results.movies?.length > 0
  const hasShows = results.shows?.length > 0
  const noResults = !hasMovies && !hasShows

  return (
    <div className="search-page-wrapper">
      <div className="page-layout">
        <div className="page-content animate-fadeUp">
          <header className="search-header">
            <div className="search-title-row">
                <SearchIcon size={24} className="text-accent" />
                <h1 className="section-heading">Results for "{q}"</h1>
            </div>
            <p className="search-count text-muted">
              Found {results.movies?.length || 0} movies and {results.shows?.length || 0} TV shows
            </p>
          </header>

          {noResults ? (
            <div className="empty-state card glass">
              <SearchIcon size={64} className="empty-icon text-muted" />
              <h3>No matches found</h3>
              <p>We couldn't find anything matching "{q}". Try a different name or browse by category.</p>
              <div className="empty-state-actions">
                <Link to="/movies" className="btn btn-primary">Browse Movies</Link>
                <Link to="/tv" className="btn btn-outline">Browse TV Shows</Link>
              </div>
            </div>
          ) : (
            <div className="search-results-content">
              {hasMovies && (
                <section className="search-section">
                  <div className="section-header">
                    <Clapperboard size={20} className="text-accent" />
                    <h2 className="section-title">Movies</h2>
                  </div>
                  <div className={containerClass}>
                    {results.movies.map((m, i) => (
                      <MediaCard 
                        key={m._id} 
                        item={m} 
                        type="movie" 
                        index={i} 
                        variant={mediaVariant} 
                      />
                    ))}
                  </div>
                </section>
              )}

              {hasShows && (
                <section className="search-section mt-12">
                  <div className="section-header">
                    <Tv size={20} className="text-accent" />
                    <h2 className="section-title">TV Shows</h2>
                  </div>
                  <div className={containerClass}>
                    {results.shows.map((s, i) => (
                      <MediaCard 
                        key={s._id} 
                        item={s} 
                        type="tvshow" 
                        index={i} 
                        variant={mediaVariant} 
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
