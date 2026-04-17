import { useState, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Home, Clapperboard, Tv, User, Search, X } from 'lucide-react'
import { search as searchApi } from '../api'
import './MobileNav.css'

export default function MobileNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // Focus input when overlay opens
  useEffect(() => {
    if (searchOpen) setTimeout(() => inputRef.current?.focus(), 50)
    else { setQuery(''); setResults(null) }
  }, [searchOpen])

  // Live search with debounce
  useEffect(() => {
    if (!query.trim()) { setResults(null); return }
    clearTimeout(debounceRef.current)
    setIsSearching(true)
    debounceRef.current = setTimeout(() => {
      searchApi(query.trim())
        .then(r => setResults(r.data))
        .catch(() => setResults({ movies: [], shows: [] }))
        .finally(() => setIsSearching(false))
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  function closeSearch() { setSearchOpen(false) }
  function handleResultClick() { closeSearch() }

  const hasResults = results && (results.movies?.length > 0 || results.shows?.length > 0)
  const noResults = results && !hasResults && !isSearching

  function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    closeSearch()
    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }

  return (
    <>
      {/* Search Overlay */}
      {searchOpen && (
        <div className="mobile-search-overlay" onClick={closeSearch}>
          <div className="mobile-search-panel glass" onClick={e => e.stopPropagation()}>
            <form className="mobile-search-bar" onSubmit={handleSearch}>
              <Search size={18} className="mobile-search-icon" />
              <input
                ref={inputRef}
                type="text"
                className="mobile-search-input"
                placeholder="Search movies, TV shows..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Search CineVault"
              />
              {query && (
                <button type="button" className="mobile-search-clear" onClick={() => setQuery('')} aria-label="Clear">
                  <X size={16} />
                </button>
              )}
            </form>

            <div className="mobile-search-results">
              {isSearching && <div className="mobile-search-status">Searching...</div>}
              {noResults && <div className="mobile-search-status">No results found.</div>}
              {hasResults && (
                <>
                  {results.movies?.map(m => (
                    <Link
                      key={m._id}
                      to={`/detail/movie/${m._id}`}
                      className="mobile-search-item"
                      onClick={handleResultClick}
                    >
                      {m.posterUrl
                        ? <img src={m.posterUrl} className="mobile-search-poster" alt="" />
                        : <div className="mobile-search-poster mobile-search-poster--empty">{m.title?.charAt(0)}</div>
                      }
                      <div className="mobile-search-info">
                        <span className="mobile-search-title">{m.title}</span>
                        <span className="mobile-search-meta">{m.year} · Movie</span>
                      </div>
                    </Link>
                  ))}
                  {results.shows?.map(s => (
                    <Link
                      key={s._id}
                      to={`/detail/tvshow/${s._id}`}
                      className="mobile-search-item"
                      onClick={handleResultClick}
                    >
                      {s.posterUrl
                        ? <img src={s.posterUrl} className="mobile-search-poster" alt="" />
                        : <div className="mobile-search-poster mobile-search-poster--empty">{s.title?.charAt(0)}</div>
                      }
                      <div className="mobile-search-info">
                        <span className="mobile-search-title">{s.title}</span>
                        <span className="mobile-search-meta">{s.year} · TV Show</span>
                      </div>
                    </Link>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Nav */}
      <div className="mobile-nav glass">
        <Link to="/" className={`mobile-nav-item ${isActive('/') ? 'active' : ''}`}>
          <Home className="mobile-nav-icon" size={20} />
          <span className="mobile-nav-label">Home</span>
        </Link>
        <Link to="/movies" className={`mobile-nav-item ${isActive('/movies') ? 'active' : ''}`}>
          <Clapperboard className="mobile-nav-icon" size={20} />
          <span className="mobile-nav-label">Movies</span>
        </Link>
        <Link to="/tv" className={`mobile-nav-item ${isActive('/tv') ? 'active' : ''}`}>
          <Tv className="mobile-nav-icon" size={20} />
          <span className="mobile-nav-label">TV</span>
        </Link>
        <button className="mobile-nav-item" onClick={() => setSearchOpen(true)}>
          <Search className="mobile-nav-icon" size={20} />
          <span className="mobile-nav-label">Search</span>
        </button>
        <Link to="/profile" className={`mobile-nav-item ${isActive('/profile') ? 'active' : ''}`}>
          <User className="mobile-nav-icon" size={20} />
          <span className="mobile-nav-label">Profile</span>
        </Link>
      </div>
    </>
  )
}
