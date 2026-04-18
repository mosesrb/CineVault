import { createContext, useContext, useState, useEffect } from 'react'
import { getMe } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null)
  const [loading, setLoading] = useState(true)

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
    localStorage.setItem('cv_token', token)
    setUser(userData)
  }

  function logoutUser() {
    localStorage.removeItem('cv_token')
    localStorage.removeItem('cv_user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginUser, logoutUser, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
