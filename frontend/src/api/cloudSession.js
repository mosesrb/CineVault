import { getCloudServerOrigin } from './cloudSignIn'

let session = null

export function setCloudSession({ token, deadline, origin }) {
  session = { token, deadline, origin }
}

export function clearCloudSession(token) {
  if (token && session?.token !== token) return false
  session = null
  return true
}

export function getCloudSession() {
  if (!session || session.origin !== getCloudServerOrigin() || session.deadline <= performance.now()) return null
  return session
}
