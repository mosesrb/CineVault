// Hosted-only Supabase Auth Admin API adapter for cinevault-account-admin.
// Holds CV_ACCOUNT_ADMIN_SERVICE_ROLE_KEY strictly in memory for outbound calls
// to /auth/v1/admin/users. Never retries password writes on timeout or error.
import { performance } from 'node:perf_hooks'
import { PROJECT_REF } from '../broker/broker.mjs'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const matches = (r, v) => typeof v === 'string' && r.test(v)

export class AuthAdminUncertainError extends Error {
  constructor(reason) {
    super('auth_admin_write_uncertain')
    this.reason = typeof reason === 'string' && reason.length <= 64 ? reason : 'upstream_error'
  }
}

export function createAuthAdminClient({
  serviceRoleKey,
  projectRef = PROJECT_REF,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = 5000
}) {
  if (
    projectRef !== PROJECT_REF ||
    typeof serviceRoleKey !== 'string' ||
    serviceRoleKey.length < 24 ||
    serviceRoleKey.length > 512 ||
    /\s/.test(serviceRoleKey) ||
    typeof fetchImpl !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 5000
  ) {
    throw Error('account_admin_configuration_invalid')
  }

  const baseUrl = `https://${PROJECT_REF}.supabase.co/auth/v1/admin/users`

  async function requestJson(url, method, payload) {
    const controller = new AbortController()
    const began = now()
    const started = performance.now()
    let timer
    try {
      const pending = (async () => {
        let response
        try {
          response = await fetchImpl(url, {
            method,
            redirect: 'error',
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
            headers: {
              apikey: serviceRoleKey,
              Authorization: 'Bearer ' + serviceRoleKey,
              'content-type': 'application/json'
            },
            body: JSON.stringify(payload)
          })
        } catch (err) {
          if (controller.signal.aborted || err?.name === 'AbortError') {
            throw new AuthAdminUncertainError('timeout')
          }
          throw new AuthAdminUncertainError('network_error')
        }
        if (
          response.redirected ||
          (response.url && response.url !== url) ||
          !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')
        ) {
          throw new AuthAdminUncertainError('invalid_upstream_response')
        }
        if (response.status !== 200 && response.status !== 201) {
          throw new AuthAdminUncertainError(`http_${response.status}`)
        }
        const reader = response.body?.getReader()
        if (!reader) throw new AuthAdminUncertainError('empty_body')
        const chunks = []
        let size = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > 16384) throw new AuthAdminUncertainError('response_too_large')
            chunks.push(value)
          }
        } finally {
          void reader.cancel().catch(() => {})
          reader.releaseLock()
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const value of chunks) {
          bytes.set(value, offset)
          offset += value.byteLength
        }
        try {
          return {
            status: response.status,
            data: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
          }
        } catch {
          throw new AuthAdminUncertainError('malformed_json')
        }
      })()

      const outcome = await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new AuthAdminUncertainError('timeout'))
          }, timeoutMs)
        })
      ])
      if (
        controller.signal.aborted ||
        now() < began ||
        now() - began >= timeoutMs ||
        performance.now() - started >= timeoutMs
      ) {
        throw new AuthAdminUncertainError('timeout')
      }
      return outcome
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  return Object.freeze({
    async createUser({ email, password }) {
      const { status, data } = await requestJson(baseUrl, 'POST', {
        email,
        password,
        email_confirm: true
      })
      if (
        (status !== 200 && status !== 201) ||
        !matches(UUID, data?.id) ||
        data.is_anonymous === true ||
        typeof data.email !== 'string' ||
        !data.email_confirmed_at
      ) {
        throw new AuthAdminUncertainError('create_user_unverified')
      }
      return Object.freeze({ userId: data.id, email: data.email })
    },

    async updateUserPassword({ userId, password }) {
      if (!matches(UUID, userId)) {
        throw new AuthAdminUncertainError('invalid_target_user')
      }
      const url = `${baseUrl}/${userId}`
      const { status, data } = await requestJson(url, 'PUT', { password })
      if (status !== 200 || data?.id !== userId || data?.is_anonymous === true) {
        throw new AuthAdminUncertainError('password_update_unverified')
      }
      return Object.freeze({ userId: data.id, updated: true })
    }
  })
}
