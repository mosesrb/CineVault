import { canUseCloudSignIn } from './cloudSignIn'

let session = null

export function setCloudSession(token, expiresAt) {
  session = { token, expiresAt }
}

export function clearCloudSession(token) {
  if (token && session?.token !== token) return false
  session = null
  return true
}

export function getCloudSession() {
  if (!session || !canUseCloudSignIn() || session.expiresAt * 1000 <= Date.now()) return null
  return session
}
