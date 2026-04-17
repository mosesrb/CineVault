import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { FolderOpen, Search, WifiOff, Film } from 'lucide-react'
import { search as searchApi, getMe, getSmartCollections, getRecommendations, resolveUrl } from '../api'
import { OfflineStorageService } from '../services/OfflineStorageService'
import MediaCard from '../components/MediaCard'
import MediaShelf from '../components/MediaShelf'
import HeroCarousel from '../components/HeroCarousel'
import './Home.css'

export default function Home() {
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') || ''

  const [history, setHistory]   = useState([])
  const [offlineItems, setOfflineItems] = useState([])
  const [featuredItems, setFeaturedItems] = useState([])
  const [searchResults, setSearchResults] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [isServerOffline, setIsServerOffline] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all') // 'all', 'movie', 'tvshow'

  // Smart Collections
  const [topRated, setTopRated] = useState([])
  const [recentMovies, setRecentMovies] = useState([])
  const [hiddenGems, setHiddenGems] = useState([])
  const [recentShows, setRecentShows] = useState([])
  const [recommended, setRecommended] = useState([])

  useEffect(() => {
    if (q) {
      searchApi(q).then(r => {
        setSearchResults(r.data)
        setLoading(false)
      })
    } else {
      setSearchResults(null)
      Promise.all([
        getSmartCollections(),
        getMe().catch(() => ({ data: { watchHistory: [] } })),
        getRecommendations().catch(() => ({ data: [] }))
      ]).then(([colRes, uRes, recRes]) => {
        const { topRatedMovies, recentMovies, hiddenGems, recentShows } = colRes.data;
        const sProgress = uRes.data.seriesProgress || [];
        const enrichedShows = (recentShows || []).map(s => {
          const stats = sProgress.find(p => p.showId === s._id);
          if (stats && s.totalEpisodes > 0) {
            return { ...s, progress: (stats.finishedEpisodes / s.totalEpisodes) * 100 };
          }
          return s;
        });

        setTopRated(topRatedMovies || []);
        setRecentMovies(recentMovies || []);
        setHiddenGems(hiddenGems || []);
        setRecentShows(enrichedShows);
        setRecommended(recRes.data || []);
        
        // Filter in-progress items
        const inProgress = uRes.data.watchHistory?.filter(h => !h.completed && h.progressSeconds > 0)
        setHistory(inProgress || [])

        // Pick featured items (Top 5 with images)
        const allItems = [
          ...(recentMovies || []).map(m => ({ ...m, _type: 'movie' })),
          ...(topRatedMovies || []).map(m => ({ ...m, _type: 'movie' })),
          ...(recentShows || []).map(s => ({ ...s, _type: 'tvshow' }))
        ]
        
        // Remove duplicates by ID
        const uniqueItems = Array.from(new Map(allItems.map(item => [item._id || item.id, item])).values())
        
        const withImage = uniqueItems.filter(m => m.backdropUrl || m.posterUrl)
        const sorted = withImage.sort((a, b) => (b.rating || 0) - (a.rating || 0))
        setFeaturedItems(sorted.slice(0, 5))
      }).finally(() => setLoading(false))

      // 2. Load Offline items
      OfflineStorageService.getAllDownloads().then(items => {
        // Map download records back to media format the card expects
        const mapped = items.map(d => ({
          ...d.metadata,
          _id: d.id,
          _type: d.type,
          isOffline: true
        }))
        setOfflineItems(mapped)
      }).catch(console.error)
    }

    const handleServerStatus = (e) => setIsServerOffline(!e.detail.online);
    window.addEventListener('cv_server_status', handleServerStatus);
    
    return () => {
      window.removeEventListener('cv_server_status', handleServerStatus);
    };
  }, [q])

  if (loading) return <div className="loading-center" style={{minHeight:'100vh'}}><div className="spinner"/></div>

  // SEARCH RESULTS VIEW
  if (q && searchResults) {
    const total = (searchResults.movies?.length || 0) + (searchResults.shows?.length || 0)
    return (
      <div className="home-page">
        <div className="page-content animate-fadeUp">
          <div className="search-header">
            <h1 className="section-heading">Results for "{q}"</h1>
            <p className="text-muted">{total} result{total !== 1 ? 's' : ''} found</p>
          </div>
          {searchResults.movies?.length > 0 && (
            <MediaShelf 
              title="Movies" 
              items={searchResults.movies} 
              type="movie" 
            />
          )}
          {searchResults.shows?.length > 0 && (
            <MediaShelf 
              title="TV Shows" 
              items={searchResults.shows} 
              type="tvshow" 
            />
          )}
          {total === 0 && (
            <div className="empty-state">
              <Film className="empty-icon" size={64} />
              <p>No results found for "{q}"</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Smart Collections rendered natively below

  return (
    <div className="home-page">
      {/* Hero */}
      {!isServerOffline && activeFilter === 'all' && featuredItems.length > 0 && <HeroCarousel items={featuredItems} />}
 
      <div className="page-content">
        {/* Filter Bar */}
        {!q && (
          <div className="home-filter-bar">
            <button 
              className={`filter-pill ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              All
            </button>
            <button 
              className={`filter-pill ${activeFilter === 'movie' ? 'active' : ''}`}
              onClick={() => setActiveFilter('movie')}
            >
              Movies
            </button>
            <button 
              className={`filter-pill ${activeFilter === 'tvshow' ? 'active' : ''}`}
              onClick={() => setActiveFilter('tvshow')}
            >
              TV Shows
            </button>
          </div>
        )}

        {/* Continue Watching */}
        {!isServerOffline && (activeFilter === 'all' || activeFilter === 'movie') && history.length > 0 && (
          <section className="home-section">
            <div className="section-row-header">
              <h2 className="section-heading">Continue Watching</h2>
            </div>
            <div className="media-row">
              {history.map((h, i) => (
                <MediaCard 
                  key={`${h.mediaId}-${h.episodeId || ''}`} 
                  item={h.media} 
                  type={h.mediaType} 
                  progress={(h.progressSeconds / (h.media.duration * 60 || 3600)) * 100}
                  index={i}
                />
              ))}
            </div>
          </section>
        )}

        {/* Offline Library */}
        {(offlineItems.length > 0 || isServerOffline) && (
          <section className="home-section animate-fadeUp">
            <div className="section-row-header">
              <h2 className="section-heading">{isServerOffline ? 'Offline Mode' : 'Offline Library'}</h2>
              {!isServerOffline && <span className="badge-offline">Available Anywhere</span>}
            </div>
            
            {offlineItems.length > 0 ? (
              <div className="media-row">
                {offlineItems.filter(m => activeFilter === 'all' || m._type === activeFilter).map((m, i) => (
                  <MediaCard 
                    key={`offline-${m._id}`} 
                    item={m} 
                    type={m._type} 
                    index={i} 
                  />
                ))}
              </div>
            ) : isServerOffline && (
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
            ) }
          </section>
        )}

        {/* Recommended for You */}
        {!isServerOffline && activeFilter === 'all' && recommended.length > 0 && (
          <section className="home-section">
            <div className="section-row-header">
              <h2 className="section-heading">Recommended for You</h2>
            </div>
            <div className="media-row">
              {recommended.map((m, i) => <MediaCard key={`rec-${m._id}`} item={m} type={m._type} index={i} />)}
            </div>
          </section>
        )}
 
        {/* Recently Added */}
        {!isServerOffline && (activeFilter === 'all' || activeFilter === 'movie') && recentMovies.length > 0 && (
          <section className="home-section">
            <div className="section-row-header">
              <h2 className="section-heading">Recently Added</h2>
              <Link to="/movies?sort=new" className="see-all">See all →</Link>
            </div>
            <div className="media-row">
              {recentMovies.map((m, i) => <MediaCard key={m._id} item={m} type="movie" index={i} />)}
            </div>
          </section>
        )}
 
        {/* Top Rated */}
        {!isServerOffline && (activeFilter === 'all' || activeFilter === 'movie') && topRated.length > 0 && (
          <section className="home-section">
            <div className="section-row-header">
              <h2 className="section-heading">Top Rated</h2>
              <Link to="/movies?sort=rating" className="see-all">See all →</Link>
            </div>
            <div className="media-row">
              {topRated.map((m, i) => <MediaCard key={m._id} item={m} type="movie" index={i} />)}
            </div>
          </section>
        )}
 
        {/* TV Shows */}
        {!isServerOffline && (activeFilter === 'all' || activeFilter === 'tvshow') && recentShows.length > 0 && (
          <section className="home-section">
            <div className="section-row-header">
              <h2 className="section-heading">TV Shows</h2>
              <Link to="/tv?sort=new" className="see-all">See all →</Link>
            </div>
            <div className="media-row">
              {recentShows.map((s, i) => <MediaCard key={s._id} item={s} type="tvshow" progress={s.progress} index={i} />)}
            </div>
          </section>
        )}
 
        {/* Hidden Gems */}
        {!isServerOffline && (activeFilter === 'all' || activeFilter === 'movie') && hiddenGems.length > 0 && (
          <section className="home-section">
            <div className="section-row-header">
              <h2 className="section-heading">Hidden Gems</h2>
              <Link to="/movies?sort=rating" className="see-all">See all →</Link>
            </div>
            <div className="media-row">
              {hiddenGems.map((m, i) => <MediaCard key={m._id} item={m} type="movie" index={i} />)}
            </div>
          </section>
        )}

        {/* Global Empty State */}
        {!isServerOffline && recentMovies.length === 0 && recentShows.length === 0 && (
          <div className="empty-state">
            <FolderOpen className="empty-icon" size={64} />
            <p>Nothing to see here, come back later</p>
            <span>Your library appears empty or restricted.</span>
          </div>
        )}
      </div>
    </div>
  )
}
