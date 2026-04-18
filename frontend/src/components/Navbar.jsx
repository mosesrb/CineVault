import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Search, User, Film, ShieldCheck, LogOut, ChevronUp, ChevronDown, WifiOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { search as searchApi } from '../api'
import { OfflineStorageService } from '../services/OfflineStorageService'
import { DownloadCloud, Play, Trash2, X } from 'lucide-react'
import ConfirmModal from './ConfirmModal'
import BrandIcon from './BrandIcon'
import './Navbar.css'

const isCapacitor = typeof window !== 'undefined' && 
  (!!(window.Capacitor?.isNativePlatform?.()) || (window.Capacitor && window.Capacitor.platform !== 'web'))

export default function Navbar() {
  const { user, logoutUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [isServerOffline, setIsServerOffline] = useState(false)
  const [downloads, setDownloads] = useState([])
  const [activeDownloadId, setActiveDownloadId] = useState(null)
  const [activeProgress, setActiveProgress] = useState(0)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [pendingCancelId, setPendingCancelId] = useState(null)
  const searchRef = useRef(null)
  const userMenuRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      // Handle search dropdown
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowDropdown(false)
      }
      // Handle user dropdown
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    
    const handleNetwork = (e) => setIsOffline(!e.detail.connected)
    window.addEventListener('cv_network_change', handleNetwork)

    const handleServerStatus = (e) => setIsServerOffline(!e.detail.online)
    window.addEventListener('cv_server_status', handleServerStatus)

    const handleDownloadChange = () => {
      if (menuOpen) refreshDownloads();
    };
    window.addEventListener('cv_download_change', handleDownloadChange);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('cv_network_change', handleNetwork)
      window.removeEventListener('cv_server_status', handleServerStatus)
      window.removeEventListener('cv_download_change', handleDownloadChange);
    }
  }, [menuOpen])

  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      setShowDropdown(false)
      return
    }

    setShowDropdown(true)
    setIsSearching(true)
    
    const timeoutId = setTimeout(() => {
      searchApi(query.trim()).then(res => {
        setResults(res.data)
      }).finally(() => {
        setIsSearching(false)
      })
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [query])

  // Sync downloads when menu opens
  useEffect(() => {
    let unsubscribe = null;
    if (menuOpen) {
      refreshDownloads();
      
      const setupSubscription = () => {
        const activeId = OfflineStorageService.getActiveDownloadId();
        if (activeId) {
          setActiveDownloadId(activeId);
          if (unsubscribe) unsubscribe();
          unsubscribe = OfflineStorageService.subscribe(activeId, (pct) => {
            setActiveProgress(pct);
            if (pct >= 100 || pct === -1) {
              refreshDownloads();
              setActiveDownloadId(null);
              setActiveProgress(0);
            }
          });
        } else {
          setActiveDownloadId(null);
          setActiveProgress(0);
        }
      };

      setupSubscription();
      
      const onGlobalChange = () => {
        setupSubscription();
        refreshDownloads();
      };
      window.addEventListener('cv_download_change', onGlobalChange);
      
      return () => {
        if (unsubscribe) unsubscribe();
        window.removeEventListener('cv_download_change', onGlobalChange);
      };
    }
  }, [menuOpen]);

  async function refreshDownloads() {
    try {
      const all = await OfflineStorageService.getAllDownloads();
      // Also check for pending
      const activeId = OfflineStorageService.getActiveDownloadId();
      let list = [...all];
      if (activeId) {
        const record = await OfflineStorageService.getDownloadRecord(activeId);
        if (record && record.status === 'pending') {
          list = [record, ...list];
        }
      }
      setDownloads(list);
    } catch (e) { console.error(e); }
  }

  async function handleDeleteDownload(e, id) {
    e.preventDefault()
    e.stopPropagation()
    setPendingDeleteId(id)
  }

  async function confirmDeleteDownload() {
    if (!pendingDeleteId) return
    await OfflineStorageService.deleteDownload(pendingDeleteId)
    setPendingDeleteId(null)
    refreshDownloads()
  }

  async function handleCancelDownload(e, id) {
    e.preventDefault()
    e.stopPropagation()
    setPendingCancelId(id)
  }

  async function confirmCancelDownload() {
    if (!pendingCancelId) return
    await OfflineStorageService.cancelDownload(pendingCancelId)
    setPendingCancelId(null)
    refreshDownloads()
    setActiveDownloadId(null)
  }

  function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setShowDropdown(false)
    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
    setQuery('')
  }

  const isActive = path => location.pathname === path ||
    (path !== '/' && location.pathname.startsWith(path))

  return (
    <nav className="navbar glass">
      <ConfirmModal
        open={!!pendingDeleteId}
        title="Delete Download"
        message="Remove this download and reclaim storage space?"
        confirmLabel="Delete"
        danger
        onConfirm={confirmDeleteDownload}
        onCancel={() => setPendingDeleteId(null)}
      />
      <ConfirmModal
        open={!!pendingCancelId}
        title="Cancel Download"
        message="Stop this download in progress?"
        confirmLabel="Stop Download"
        danger
        onConfirm={confirmCancelDownload}
        onCancel={() => setPendingCancelId(null)}
      />
      <div className="navbar-inner">
        {/* Logo */}
        <Link to="/" className="navbar-logo">
          <BrandIcon size={28} />
          <span className="logo-text brand-shimmer">CineVault</span>
          {isOffline && (
            <div className="navbar-offline-badge" title="No internet connection. Browsing offline cache.">
              <WifiOff size={14} />
              <span>Network Down</span>
            </div>
          )}
          {isServerOffline && (
            <div className="navbar-offline-badge server-offline" title="Server unreachable. Showing downloaded content only.">
              <WifiOff size={14} />
              <span>Offline Mode</span>
            </div>
          )}
        </Link>

        {/* Nav links */}
        <div className="navbar-links">
          <Link to="/"        className={`nav-link ${isActive('/') && location.pathname === '/' ? 'active' : ''}`}>Home</Link>
          <Link to="/movies"  className={`nav-link ${isActive('/movies') ? 'active' : ''}`}>Movies</Link>
          <Link to="/tv"      className={`nav-link ${isActive('/tv') ? 'active' : ''}`}>TV Shows</Link>
          {user?.isAdmin && (
            <Link to="/admin" className={`nav-link admin-link ${isActive('/admin') ? 'active' : ''}`}>Admin</Link>
          )}
        </div>

        {/* Search */}
        <div className="navbar-search" ref={searchRef}>
          <form onSubmit={handleSearch}>
            <Search className="search-icon" size={18} />
            <input
              type="text"
              className="search-input"
              placeholder="Search movies, TV shows..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => { if(query.trim()) setShowDropdown(true) }}
              aria-label="Search CineVault"
            />
          </form>

          {showDropdown && (
            <div className="search-dropdown glass animate-fadeIn">
              {isSearching ? (
                <div className="search-spinner">Searching...</div>
              ) : results ? (
                <>
                  {results.movies?.map(m => (
                    <Link to={`/detail/movie/${m._id}`} className="search-result-item" key={m._id} onClick={() => { setShowDropdown(false); setQuery(''); }}>
                      {m.posterUrl ? <img src={m.posterUrl} className="search-result-poster" alt=""/> : <div className="search-result-poster"/>}
                      <div className="search-result-info">
                        <span className="search-result-title">{m.title}</span>
                        <span className="search-result-meta">{m.year} • Movie</span>
                      </div>
                    </Link>
                  ))}
                  {results.shows?.map(s => (
                    <Link to={`/detail/tv/${s._id}`} className="search-result-item" key={s._id} onClick={() => { setShowDropdown(false); setQuery(''); }}>
                      {s.posterUrl ? <img src={s.posterUrl} className="search-result-poster" alt=""/> : <div className="search-result-poster"/>}
                      <div className="search-result-info">
                        <span className="search-result-title">{s.title}</span>
                        <span className="search-result-meta">{s.year} • TV Show</span>
                      </div>
                    </Link>
                  ))}
                  {(results.movies?.length === 0 && results.shows?.length === 0) && (
                    <div className="search-spinner">No results found.</div>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="navbar-user" ref={userMenuRef}>
          <button className="user-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="User menu">
            <div className="user-avatar">
              {user?.profilePicUrl
                ? <img src={user.profilePicUrl} alt={user.name} />
                : <span>{user?.name?.charAt(0).toUpperCase()}</span>
              }
            </div>
            <span className="user-name">{user?.name}</span>
            {menuOpen ? <ChevronUp size={16} className="chevron" /> : <ChevronDown size={16} className="chevron" />}
          </button>

          {menuOpen && (
            <div className="user-dropdown glass animate-fadeIn">
              <Link to="/profile" className="dropdown-item" onClick={() => setMenuOpen(false)}>
                <User size={18} /> Profile
              </Link>
              <Link to="/profile?tab=watchlist" className="dropdown-item" onClick={() => setMenuOpen(false)}>
                <Film size={18} /> My Watchlist
              </Link>
              {user?.isAdmin && (
                <Link to="/admin" className="dropdown-item admin" onClick={() => setMenuOpen(false)}>
                  <ShieldCheck size={18} /> Admin Panel
                </Link>
              )}

              {/* Downloads Section - Show on Capacitor OR if we have stored downloads for testing */}
              {(isCapacitor || downloads.length > 0) && (
                <>
                  <div className="dropdown-divider-title">Downloads</div>
                  <div className="dropdown-downloads-list">
                    {downloads.length === 0 && (
                      <div className="dropdown-empty-text">No downloads yet</div>
                    )}
                    {downloads.map(d => {
                      const isItemActive = d.id === activeDownloadId;
                      const title = d.metadata?.title || 'Unknown Title';
                      return (
                        <div className="download-item" key={d.id}>
                          <div className="download-item-info">
                            <span className="download-item-title truncate">{title}</span>
                            {isItemActive ? (
                              <div className="download-item-progress-container">
                                <div className="download-item-progress-bar" style={{ width: `${activeProgress}%` }} />
                                <span className="download-item-pct">{activeProgress}%</span>
                              </div>
                            ) : (
                              <span className="download-item-meta">{d.type === 'tvshow' || d.type === 'episode' ? 'Episode' : 'Movie'} • Ready</span>
                            )}
                          </div>
                          <div className="download-item-actions">
                            {isItemActive ? (
                              <button className="download-action-btn cancel" onClick={(e) => handleCancelDownload(e, d.id)} title="Cancel">
                                <X size={14} />
                              </button>
                            ) : (
                              <>
                                <Link to={`/watch/${d.type}/${d.id}`} className="download-action-btn play" onClick={() => setMenuOpen(false)}>
                                  <Play size={12} fill="currentColor" />
                                </Link>
                                <button className="download-action-btn delete" onClick={(e) => handleDeleteDownload(e, d.id)} title="Delete">
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <hr className="dropdown-divider" />
              <button className="dropdown-item danger" onClick={() => { logoutUser(); setMenuOpen(false) }}>
                <LogOut size={18} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
