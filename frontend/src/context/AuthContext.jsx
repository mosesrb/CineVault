import { createContext, useContext, useState, useEffect } from 'react'
import { getMe } from '../api'
import { clearCloudSession, getCloudSession, setCloudSession } from '../api/cloudSession'
import { revokeCloudSession } from '../api/cloudSignIn'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [cloud, setCloud] = useState(null)

  useEffect(() => {
    if (!cloud) return
    function endSession() {
      clearCloudSession(cloud.token)
      setCloud(null)
      setUser(null)
    }
    const timer = setTimeout(endSession, Math.max(0, cloud.deadline - performance.now()))
    window.addEventListener('cv_cloud_session_revoked', endSession)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('cv_cloud_session_revoked', endSession)
    }
  }, [cloud])

  useEffect(() => {
    const token = localStorage.getItem('cv_token')
    if (token) {
      getMe()
        .then(res => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('cv_token')
          localStorage.removeItem('cv_user')
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  function loginUser(token, userData) {
    clearCloudSession()
    setCloud(null)
    localStorage.setItem('cv_token', token)
    setUser(userData)
  }

  function logoutUser() {
    const active = getCloudSession()
    if (active) void revokeCloudSession(active.token, active.origin).catch(() => {})
    clearCloudSession()
    setCloud(null)
    localStorage.removeItem('cv_token')
    localStorage.removeItem('cv_user')
    setUser(null)
  }

  function loginCloudUser(session) {
    localStorage.removeItem('cv_token')
    localStorage.removeItem('cv_user')
    setCloudSession(session)
    setCloud({ token: session.token, deadline: session.deadline })
    setUser(session.user)
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginUser, loginCloudUser, logoutUser, setUser, cloudSession: Boolean(cloud) }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
