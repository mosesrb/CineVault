import axios from 'axios'
import { Network } from '@capacitor/network'
import { OfflineCacheService } from '../services/OfflineCacheService'

// Dynamic base URL:
// 1. Check localStorage for a custom server URL (set via in-app Settings)
// 2. Fall back to VITE_API_URL env variable (for production builds)
// 3. Fall back to relative /api (for local dev with Vite proxy)
const getBaseURL = () => {
  const saved = localStorage.getItem('cv_server_url')
  if (saved) return `${saved}/api`
  if (import.meta.env.VITE_API_URL) return `${import.meta.env.VITE_API_URL}/api`
  return '/api'
}

export const resolveUrl = (path) => {
  if (!path) return ''
  if (path.startsWith('http')) return path
  
  const saved = localStorage.getItem('cv_server_url')
  const baseUrl = saved || import.meta.env.VITE_API_URL || window.location.origin
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${cleanBase}${cleanPath}`
}

const api = axios.create({
  baseURL: getBaseURL(),
  headers: { 'Content-Type': 'application/json' }
})

// Attach JWT token to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('cv_token')
  if (token) {
    config.headers['x-auth-token'] = token
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// Auto-logout on 401
api.interceptors.response.use(
  res => {
    // Cache successful GET responses
    if (res.config.method === 'get') {
      const url = axios.getUri(res.config)
      OfflineCacheService.setCache(url, res.data).catch(console.error)
    }
    // Broadcast that server is reachable
    window.dispatchEvent(new CustomEvent('cv_server_status', { detail: { online: true } }));
    return res
  },
  async err => {
    const config = err.config;
    
    // If we are offline or the request failed network-wise (e.g. server shut down)
    if (!err.response || err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.response?.status >= 502) {
      // Broadcast that server is unreachable
      window.dispatchEvent(new CustomEvent('cv_server_status', { detail: { online: false } }));

      // If it's a GET request, try searching the cache
      if (config.method === 'get') {
        const url = axios.getUri(config);
        const cachedData = await OfflineCacheService.getCache(url);
        if (cachedData) {
          console.log(`[API] Serving from cache: ${url}`);
          return { ...err, data: cachedData, status: 200, isCached: true };
        }
      }

      // If it's a progress update, queue it for sync
      if (config.url === '/users/me/history' && config.method === 'post') {
        const body = JSON.parse(config.data);
        await OfflineCacheService.queueSync(
          body.mediaId, 
          body.mediaType, 
          body.episodeId, 
          body.progressSeconds, 
          body.completed
        );
        console.log('[Sync] Progress queued (offline)');
        // Silently resolve so the UI doesn't error out during playback
        return Promise.resolve({ data: { message: 'queued' }, status: 202 });
      }
    }

    if (err.response?.status === 401) {
      localStorage.removeItem('cv_token')
      localStorage.removeItem('cv_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// ── Auth ──────────────────────────────────────────────────────
export const login = (email, password) =>
  api.post('/auth', { email, password })

export const register = (name, email, password) =>
  api.post('/users/register', { name, email, password })

// ── Movies ────────────────────────────────────────────────────
export const getMovies = (params = {}) => api.get('/movies', { params })
export const getMovie  = id => api.get(`/movies/${id}`)
export const createMovie = data => api.post('/movies', data)
export const updateMovie = (id, data) => api.put(`/movies/${id}`, data)
export const deleteMovie = (id, deleteFile = false) => api.delete(`/movies/${id}`, { params: { deleteFile } })
export const syncMovieMeta = id => api.post(`/movies/${id}/sync`)
export const searchTMDB = (q, type = 'movie') => api.get('/movies/search-tmdb', { params: { q, type } })
export const linkMovieToTMDB = (id, tmdbId) => api.post(`/movies/${id}/link`, { tmdbId })
export const getMovieConflicts = () => api.get('/movies/conflicts')

// ── TV Shows ──────────────────────────────────────────────────
export const getTVShows   = (params = {}) => api.get('/tvshows', { params })
export const getTVShow    = id => api.get(`/tvshows/${id}`)
export const createTVShow = data => api.post('/tvshows', data)
export const updateTVShow = (id, data) => api.put(`/tvshows/${id}`, data)
export const deleteTVShow = (id, deleteFile = false) => api.delete(`/tvshows/${id}`, { params: { deleteFile } })
export const syncShowMeta = id => api.post(`/tvshows/${id}/sync`)
export const linkTVShowToTMDB = (id, tmdbId) => api.post(`/tvshows/${id}/link`, { tmdbId })
export const getTVShowConflicts = () => api.get('/tvshows/conflicts')
export const getEpisodes  = (showId, params = {}) => api.get(`/tvshows/${showId}/episodes`, { params })
export const getSeasonEpisodes = (showId, season) =>
  api.get(`/tvshows/${showId}/seasons/${season}/episodes`)
export const createEpisode = (showId, data) => api.post(`/tvshows/${showId}/episodes`, data)
export const updateEpisode = (showId, epId, data) => api.put(`/tvshows/${showId}/episodes/${epId}`, data)
export const deleteEpisode = (showId, epId, deleteFile = false) => api.delete(`/tvshows/${showId}/episodes/${epId}`, { params: { deleteFile } })

// ── Genres ────────────────────────────────────────────────────
export const getGenres   = () => api.get('/genres')
export const createGenre = data => api.post('/genres', data)
export const updateGenre = (id, data) => api.put(`/genres/${id}`, data)
export const deleteGenre = id => api.delete(`/genres/${id}`)

// ── Search & Discovery ──────────────────────────────────────────
export const search = (q, params = {}) => api.get('/search', { params: { q, ...params } })
export const getTrending = () => api.get('/discover/trending')
export const getStreamInfo = (path) => api.get(`/stream/info?path=${encodeURIComponent(path)}`)
export const getSmartCollections = () => api.get('/discover/smart')
export const getRecommendations = () => api.get('/discover/recommended')

// ── Library ───────────────────────────────────────────────────
export const getLibraryConfig   = () => api.get('/library/config')
export const setLibraryConfig   = data => api.put('/library/config', data)
export const ingestFile         = sourcePath => api.post('/library/ingest', { sourcePath })
export const scanLibrary        = (path = '', hashMode = 'sparse') => api.post('/library/scan', { path, hashMode })
export const getOrganizeMap     = () => api.get('/library/organize')
export const getLibraryStats    = () => api.get('/library/stats')
export const getScanStatus      = () => api.get('/library/scan-status')
export const refreshMetadata    = () => api.post('/library/refresh-metadata')
export const getDuplicates      = () => api.get('/library/duplicates')
export const cleanupDuplicates  = () => api.post('/library/duplicates/cleanup')

// ── Users ─────────────────────────────────────────────────────
export const getMe            = () => api.get('/users/me')
export const updateProfile    = data => api.put('/users/me/profile', data)
export const getWatchlist     = () => api.get('/users/me/watchlist')
export const addToWatchlist   = (mediaId, mediaType) =>
  api.post('/users/me/watchlist', { mediaId, mediaType })
export const removeFromWatchlist = mediaId =>
  api.delete(`/users/me/watchlist/${mediaId}`)
export const saveProgress     = data => api.post('/users/me/history', data)

export const getUsers         = () => api.get('/users')
export const getUser          = id => api.get(`/users/${id}`)
export const createUser       = data => api.post('/users', data)
export const updateUser       = (id, data) => api.put(`/users/${id}`, data)
export const deleteUser       = id => api.delete(`/users/${id}`)
export const banUser          = (id, data) => api.put(`/users/${id}/ban`, data)
export const setUserGenres    = (id, genreIds) => api.put(`/users/${id}/genres`, { genreIds })
export const approveUser      = (id, approve = true) => api.put(`/users/${id}/approve`, { approve })

// ── Admin Sessions ─────────────────────────────────────────────
export const getSessions      = () => api.get('/admin/sessions')
export const revokeSession    = id => api.get(`/admin/sessions/revoke/${id}`)
export const clearSessions     = () => api.get('/admin/sessions/clear')

// ── Network Info (for auto-fill in server config) ──────────────
export const getNetworkInfo = () => {
  // Must be an absolute URL — relative paths break on Android Capacitor
  const base = localStorage.getItem('cv_server_url') || window.location.origin
  return fetch(`${base}/api/network-info`).then(r => r.json()).catch(() => null)
}
