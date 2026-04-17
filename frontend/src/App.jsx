import { useEffect, useRef, useState } from 'react'
import { Network } from '@capacitor/network'
import { OfflineCacheService } from './services/OfflineCacheService'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

import Navbar    from './components/Navbar'
import Login     from './pages/Login'
import Register  from './pages/Register'
import Home      from './pages/Home'
import Movies    from './pages/Movies'
import TVShows   from './pages/TVShows'
import Detail    from './pages/Detail'
import Player    from './pages/Player'
import Profile   from './pages/Profile'
import Browse    from './pages/Browse'
import MobileNav from './components/MobileNav'

import AdminLayout    from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/Dashboard'
import AdminLibrary   from './pages/admin/Library'
import AdminMovies    from './pages/admin/AdminMovies'
import AdminTVShows   from './pages/admin/AdminTVShows'
import AdminUsers     from './pages/admin/AdminUsers'
import AdminGenres    from './pages/admin/AdminGenres'
import AdminSessions  from './pages/admin/AdminSessions'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  return user ? children : <Navigate to="/login" replace />
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (!user.isAdmin) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  const { user } = useAuth()
  // TV Remote: Prevent default scroll on arrow keys when inside player or certain views
  useEffect(() => {
    const handleTVKeys = (e) => {
      const isPlayer = window.location.pathname.startsWith('/player');
      const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
      if (isPlayer && isArrow) e.preventDefault();
    };
    window.addEventListener('keydown', handleTVKeys, { passive: false });
    return () => window.removeEventListener('keydown', handleTVKeys);
  }, []);

  // ── Network Connectivity & Background Sync ──────────────────────────
  useEffect(() => {
    let checkTimeout = null;

    const dispatchStatus = (status) => {
      window.dispatchEvent(new CustomEvent('cv_network_change', { detail: status }));
    };

    const initNetwork = async () => {
      // 1. Check initial status
      const status = await Network.getStatus();
      if (status.connected) {
        setTimeout(() => OfflineCacheService.processSyncQueue(), 2000);
      }
      dispatchStatus(status);

      // 2. Listen for changes
      const handler = await Network.addListener('networkStatusChange', async (status) => {
        console.log('[App] Network signal:', status);
        
        // Clear any pending "go offline" timeout if we got a "connected" signal
        if (status.connected) {
          if (checkTimeout) clearTimeout(checkTimeout);
          dispatchStatus(status);
          setTimeout(() => OfflineCacheService.processSyncQueue(), 1000);
          return;
        }

        // If status is disconnected, wait before committing to "Offline Mode"
        // This prevents "Instant Offline" on intermittent ECONNRESET errors
        if (checkTimeout) clearTimeout(checkTimeout);
        checkTimeout = setTimeout(async () => {
          // Double check with a real check
          const finalStatus = await Network.getStatus();
          if (!finalStatus.connected) {
            console.log('[App] Confirmed Offline');
            dispatchStatus(finalStatus);
          } else {
            console.log('[App] Network recovered (false alarm prevented)');
            dispatchStatus(finalStatus);
          }
        }, 2500);
      });

      return handler;
    };

    const promise = initNetwork();
    return () => {
      if (checkTimeout) clearTimeout(checkTimeout);
      promise.then(h => h.remove());
    };
  }, []);

  // Android back button — navigate within app instead of closing it
  const navigate = useNavigate()
  const location = useLocation()
  
  // Use refs to avoid stale closures in the single-instance listener
  const pathRef = useRef(location.pathname)
  const navRef = useRef(navigate)

  useEffect(() => {
    pathRef.current = location.pathname
    navRef.current = navigate
  }, [location.pathname, navigate])

  useEffect(() => {
    let handlerPromise = null
    try {
      import('@capacitor/app').then(({ App }) => {
        handlerPromise = App.addListener('backButton', ({ canGoBack }) => {
          const rootScreens = ['/', '/login', '/register']
          const path = pathRef.current
          const nav = navRef.current

          if (rootScreens.includes(path)) {
            App.minimizeApp()
          } else if (path.startsWith('/watch/')) {
            // Player: go to detail page, not history (avoids app exit on deep link)
            const parts = path.split('/')  // ['', 'watch', type, id]
            const type = parts[2]
            const id = parts[3]
            nav(`/detail/${type}/${id}`)
          } else {
            window.history.back()
          }
        })
      })
    } catch (_) {}

    return () => {
      if (handlerPromise) handlerPromise.then(h => h.remove())
    }
  }, []) // Register EXACTLY ONCE on mount

  return (
    <>
      {user && <Navbar />}
      {user && <MobileNav />}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />

        <Route path="/" element={<PrivateRoute><Home /></PrivateRoute>} />
        <Route path="/movies" element={<PrivateRoute><Movies /></PrivateRoute>} />
        <Route path="/tv" element={<PrivateRoute><TVShows /></PrivateRoute>} />
        <Route path="/browse/:genre" element={<PrivateRoute><Browse /></PrivateRoute>} />
        <Route path="/detail/:type/:id" element={<PrivateRoute><Detail /></PrivateRoute>} />
        <Route path="/watch/:type/:id" element={<PrivateRoute><Player /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />

        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<AdminDashboard />} />
          <Route path="library" element={<AdminLibrary />} />
          <Route path="movies" element={<AdminMovies />} />
          <Route path="tvshows" element={<AdminTVShows />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="genres" element={<AdminGenres />} />
          <Route path="sessions" element={<AdminSessions />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
