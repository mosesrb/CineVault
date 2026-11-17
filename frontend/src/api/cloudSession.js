import { canUseCloudSignIn } from './cloudSignIn'

let session = null

export function setCloudSession(token, deadline) {
  session = { token, deadline }
}

export function clearCloudSession(token) {
  if (token && session?.token !== token) return false
  session = null
  return true
}

export function getCloudSession() {
  if (!session || !canUseCloudSignIn() || session.deadline <= performance.now()) return null
  return session
}
