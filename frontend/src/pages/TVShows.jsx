import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getTVShows, getGenres } from '../api'
import { OfflineStorageService } from '../services/OfflineStorageService'
import { Tv, WifiOff } from 'lucide-react'
import MediaCard from '../components/MediaCard'
import MediaShelf from '../components/MediaShelf'
import HeroCarousel from '../components/HeroCarousel'
import FilterDrawer from '../components/FilterDrawer'
import { useMediaQuery } from '../hooks/useMediaQuery'
import './Browse.css'

const EMPTY_FILTERS = { minRating: 0, maxDuration: 0, minYear: 0, maxYear: 0, watched: '', genre: '' }

export default function TVShows() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [shows, setShows]     = useState([])
  const [genres, setGenres]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [offlineShows, setOfflineShows] = useState([])
  const [isServerOffline, setIsServerOffline] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 769px)')

  const activeStatus = searchParams.get('status') || ''

  useEffect(() => { 
    getGenres().then(r => setGenres(r.data)) 
    
    const handleServerStatus = (e) => setIsServerOffline(!e.detail.online);
    window.addEventListener('cv_server_status', handleServerStatus);
    
    OfflineStorageService.getAllDownloads().then(items => {
      const mapped = items.filter(d => d.type === 'tvshow').map(d => ({
        ...d.metadata,
        _id: d.id,
        _type: 'tvshow',
        isOffline: true
      }))
      setOfflineShows(mapped)
    }).catch(console.error)

    return () => window.removeEventListener('cv_server_status', handleServerStatus);
  }, [])
  
  // Sync URL params to filter state
  useEffect(() => {
    const genreParam = searchParams.get('genre') || ''
    if (genreParam !== filters.genre) {
      setFilters(prev => ({ ...prev, genre: genreParam }))
    }
  }, [searchParams])

  useEffect(() => {
    setLoading(true)
    const params = {}
    if (activeStatus)       params.status      = activeStatus
    if (filters.genre)      params.genre       = filters.genre
    if (filters.minRating)  params.minRating   = filters.minRating
    if (filters.minYear)    params.minYear     = filters.minYear
    if (filters.maxYear)    params.maxYear     = filters.maxYear
    if (filters.watched)    params.watched     = filters.watched

    getTVShows(params).then(r => {
      let data = r.data
      const sort = searchParams.get('sort') || 'new'
      if (sort === 'rating') {
        data = [...data].sort((a, b) => b.rating - a.rating)
      } else if (sort === 'year') {
        data = [...data].sort((a, b) => (b.year || 0) - (a.year || 0))
      } else if (sort === 'new') {
        // Sort by addedAt descending
        data = [...data].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0))
      }
      setShows(data)
    }).finally(() => setLoading(false))
  }, [activeStatus, filters, searchParams])

  function setStatusFilter(val) {
    const next = new URLSearchParams(searchParams)
    if (val) next.set('status', val); else next.delete('status')
    setSearchParams(next)
  }

  function setGenre(slug) {
    const next = new URLSearchParams(searchParams)
    if (slug) next.set('genre', slug); else next.delete('genre')
    setSearchParams(next)
  }

  function setSort(val) {
    const next = new URLSearchParams(searchParams)
    if (val) next.set('sort', val); else next.delete('sort')
    setSearchParams(next)
  }

  const sortBy = searchParams.get('sort') || 'new'
  const isFiltered = activeStatus || sortBy !== 'new' || searchParams.get('genre') || Object.values(filters).some(v => v !== '' && v !== 0)
  const featuredItems = !loading && shows.length > 0 && !isFiltered
    ? [...shows]
        .filter(s => s.backdropUrl || s.posterUrl)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, 5)
        .map(s => ({ ...s, _type: 'tvshow' }))
    : []

  return (
    <div className="home-page">
      {!isServerOffline && featuredItems.length > 0 && <HeroCarousel items={featuredItems} />}
      <div className="page-layout" style={{ paddingTop: (!isServerOffline && featuredItems.length > 0) ? 0 : undefined }}>
        <div className="page-content animate-fadeUp">
          <div className="browse-header">
            <h1 className="section-heading" style={{margin: 0}}>
              {isServerOffline ? 'Offline TV Shows' : 'TV Shows'}
            </h1>
            {isServerOffline ? (
               <span className="badge-offline">Offline Mode</span>
            ) : (
              <div className="browse-filters">
                <select className="filter-select" value={sortBy} onChange={e => setSort(e.target.value)}>
                  <option value="new">Recently Added</option>
                  <option value="rating">Top Rated</option>
                  <option value="year">By Year</option>
                </select>
                <select className="filter-select" value={activeStatus} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="">All Statuses</option>
                  <option value="ongoing">Ongoing</option>
                  <option value="ended">Ended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                {/* Advanced Filters (Web Only) */}
                {isDesktop && (
                  <FilterDrawer genres={genres} filters={filters} onChange={setFilters} />
                )}
              </div>
            )}
          </div>

          {!isServerOffline && !isDesktop && (
            <div className="genre-bar">
              <button 
                className={`genre-pill ${!filters.genre ? 'active' : ''}`}
                onClick={() => setGenre('')}
              >
                All Genres
              </button>
              {genres.map(g => (
                <button 
                  key={g._id} 
                  className={`genre-pill ${filters.genre === g.slug ? 'active' : ''}`}
                  onClick={() => setGenre(g.slug)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}

          {!isServerOffline && isFiltered && (
            <p className="browse-result-count text-muted text-sm" style={{marginBottom: 'var(--sp-5)'}}>
              Showing {shows.length} show{shows.length !== 1 ? 's' : ''}
            </p>
          )}

          {isServerOffline ? (
             offlineShows.length > 0 ? (
               <div className="discovery-shelves">
                 <MediaShelf title="Downloaded Series" items={offlineShows} type="tvshow" />
               </div>
             ) : (
               <div className="offline-empty-state card glass">
                 <div className="offline-empty-icon">
                   <WifiOff size={48} />
                 </div>
                 <h3>Nothing to Play Offline</h3>
                 <p>Browse content while the server is online to download and watch your favorite media without an internet connection.</p>
                 <div className="offline-empty-actions">
                    <button className="btn btn-primary" onClick={() => window.location.reload()}>Try Reconnecting</button>
                 </div>
               </div>
             )
          ) : loading
            ? <div className="loading-center"><div className="spinner" /></div>
            : !isFiltered
              ? (
                <div className="discovery-shelves">
                  <MediaShelf title="Top Rated Series" items={shows.filter(s => s.rating > 8).slice(0, 15)} type="tvshow" link="/tv?sort=rating" />
                  <MediaShelf title="Recently Added" items={shows.slice(0, 15)} type="tvshow" link="/tv?sort=new" />
                  {genres.slice(0, 5).map(g => {
                    const genreShows = shows.filter(s => s.genres?.some(mg => (mg.slug === g.slug || mg === g._id))).slice(0, 10)
                    if (genreShows.length === 0) return null
                    return (
                      <MediaShelf key={g._id} title={g.name} items={genreShows} type="tvshow" link={`/tv?genre=${g.slug}`} />
                    )
                  })}
                </div>
              )
              : shows.length === 0
                ? <div className="empty-state"><Tv className="empty-icon" size={64} /><p>No shows match your filters</p><span>Try adjusting your criteria.</span></div>
                : (
                  <div className={isDesktop ? "media-grid animate-fadeIn" : "media-list-column animate-fadeIn"} style={{ marginTop: 'var(--sp-2)' }}>
                    {shows.map((s, i) => (
                      <MediaCard key={s._id} item={s} type="tvshow" index={i} variant={isDesktop ? "grid" : "list"} />
                    ))}
                  </div>
                )
          }
        </div>
      </div>
    </div>
  )
}

