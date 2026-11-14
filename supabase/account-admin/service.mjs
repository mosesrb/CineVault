// Hosted-only cinevault-account-admin service and HTTP handler.
// Enforces pre-write password claims, single-use write tickets, and permanent
// write blocking on uncertain Auth Admin write outcomes.
import { Buffer } from 'node:buffer'
import { performance } from 'node:perf_hooks'
import { PROJECT_REF } from '../broker/broker.mjs'
import { AuthAdminUncertainError } from './authAdmin.mjs'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const EMAIL = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u
const matches = (r, v) => typeof v === 'string' && r.test(v)

export class AccountAdminFailure extends Error {
  constructor(kind, details = null) {
    super('account_admin_' + kind)
    this.kind = kind
    this.details = details
  }
}

const deny = () => {
  throw new AccountAdminFailure('authorization')
}

function exact(value, keys) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  ) {
    deny()
  }
}

function validPassword(password) {
  if (typeof password !== 'string') return false
  const byteLength = Buffer.byteLength(password, 'utf8')
  return password.length >= 12 && byteLength >= 12 && byteLength <= 72
}

function validDisplayName(name) {
  return (
    typeof name === 'string' &&
    name.length >= 1 &&
    name.length <= 128 &&
    name === name.trim() &&
    !/\p{Cc}/u.test(name)
  )
}

function mapDatabaseError(error) {
  if (error instanceof AccountAdminFailure) return error
  if (error?.code === '42501') {
    if (error.message === 'cp_reset_superseded') {
      return new AccountAdminFailure('reset_superseded')
    }
    return new AccountAdminFailure('authorization')
  }
  if (error?.code === 'P0001') {
    if (error.message === 'cp_reset_unresolved') {
      return new AccountAdminFailure('password_reset_unresolved')
    }
    return new AccountAdminFailure('conflict')
  }
  if (error?.code === '23505') return new AccountAdminFailure('conflict')
  return new AccountAdminFailure('unavailable')
}

export function createAccountAdminService({
  database,
  verifyCaller,
  authAdmin,
  now = Date.now
}) {
  if (
    typeof database?.transaction !== 'function' ||
    typeof verifyCaller !== 'function' ||
    typeof authAdmin?.createUser !== 'function' ||
    typeof authAdmin?.updateUserPassword !== 'function'
  ) {
    throw Error('account_admin_configuration_invalid')
  }

  async function verifyAuthenticatedCaller(accessToken) {
    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 8192) deny()
    let authority
    try {
      authority = await verifyCaller(accessToken)
    } catch {
      deny()
    }
    exact(authority, ['userId', 'sessionId', 'expiresAt'])
    if (
      !matches(UUID, authority.userId) ||
      !matches(UUID, authority.sessionId) ||
      !Number.isSafeInteger(authority.expiresAt) ||
      authority.expiresAt <= now()
    ) {
      deny()
    }
    return authority
  }

  async function executeClaimedPasswordWrite({
    projectRef,
    targetUserId,
    resetId,
    operationId,
    kind,
    caller,
    password
  }) {
    // 1. Pre-write claim committed in its own database transaction BEFORE external API write.
    const claim = await database.transaction(tx =>
      tx.call('claimPasswordWrite', [
        projectRef,
        targetUserId,
        resetId,
        operationId,
        kind,
        caller.userId,
        caller.sessionId,
        new Date(caller.expiresAt)
      ])
    )
    const writeTicket = claim?.writeTicket
    if (!matches(UUID, writeTicket)) {
      throw new AccountAdminFailure('unavailable')
    }

    // 2. Perform single server-side Supabase Auth Admin API password write (no automatic retry).
    try {
      await authAdmin.updateUserPassword({ userId: targetUserId, password })
    } catch (writeError) {
      const reason =
        writeError instanceof AuthAdminUncertainError ? writeError.reason : 'upstream_write_error'
      await database.transaction(tx =>
        tx.call('markPasswordWriteUncertain', [
          projectRef,
          targetUserId,
          resetId,
          operationId,
          reason
        ])
      )
      throw new AccountAdminFailure('password_write_outcome_uncertain', {
        resetId,
        operationId,
        reason
      })
    }

    // 3. Redeem single-use write_ticket only after verified HTTP 200 OK from Auth Admin API.
    const finalizeOp = kind === 'ADMIN_RESET' ? 'sealPasswordReset' : 'completePasswordChange'
    return await database.transaction(tx =>
      tx.call(finalizeOp, [projectRef, targetUserId, resetId, operationId, writeTicket])
    )
  }

  return Object.freeze({
    async execute(input, accessToken) {
      try {
        input = structuredClone(input)
        const operation = input?.operation

        if (operation === 'admin-create-user') {
          exact(input, [
            'operation',
            'projectRef',
            'email',
            'displayName',
            'temporaryPassword',
            'resetId'
          ])
          if (
            input.projectRef !== PROJECT_REF ||
            typeof input.email !== 'string' ||
            input.email.length > 254 ||
            !EMAIL.test(input.email) ||
            !validDisplayName(input.displayName) ||
            !validPassword(input.temporaryPassword) ||
            !matches(UUID, input.resetId)
          ) {
            deny()
          }
          const caller = await verifyAuthenticatedCaller(accessToken)
          await database.transaction(tx =>
            tx.call('verifyProjectAdmin', [
              input.projectRef,
              caller.userId,
              caller.sessionId,
              new Date(caller.expiresAt)
            ])
          )
          let created
          try {
            created = await authAdmin.createUser({
              email: input.email.trim().toLowerCase(),
              password: input.temporaryPassword
            })
          } catch {
            throw new AccountAdminFailure('unavailable')
          }
          return await database.transaction(tx =>
            tx.call('initProvisionedUserProfile', [
              input.projectRef,
              caller.userId,
              caller.sessionId,
              new Date(caller.expiresAt),
              created.userId,
              input.displayName,
              input.resetId
            ])
          )
        }

        if (operation === 'admin-reset-password') {
          exact(input, [
            'operation',
            'projectRef',
            'targetUserId',
            'resetId',
            'operationId',
            'temporaryPassword'
          ])
          if (
            input.projectRef !== PROJECT_REF ||
            !matches(UUID, input.targetUserId) ||
            !matches(UUID, input.resetId) ||
            !matches(UUID, input.operationId) ||
            !validPassword(input.temporaryPassword)
          ) {
            deny()
          }
          const caller = await verifyAuthenticatedCaller(accessToken)

          // Step 1: Commit cp_begin_password_reset (sets must_change_password=true, revokes auth.sessions).
          await database.transaction(tx =>
            tx.call('beginPasswordReset', [
              input.projectRef,
              caller.userId,
              caller.sessionId,
              new Date(caller.expiresAt),
              input.targetUserId,
              input.resetId
            ])
          )

          // Step 2 & 3: Commit pre-write claim, invoke Auth Admin PUT, and seal (or mark uncertain).
          return await executeClaimedPasswordWrite({
            projectRef: input.projectRef,
            targetUserId: input.targetUserId,
            resetId: input.resetId,
            operationId: input.operationId,
            kind: 'ADMIN_RESET',
            caller,
            password: input.temporaryPassword
          })
        }

        if (operation === 'complete-password-change') {
          exact(input, ['operation', 'projectRef', 'resetId', 'operationId', 'newPassword'])
          if (
            input.projectRef !== PROJECT_REF ||
            !matches(UUID, input.resetId) ||
            !matches(UUID, input.operationId) ||
            !validPassword(input.newPassword)
          ) {
            deny()
          }
          const caller = await verifyAuthenticatedCaller(accessToken)

          return await executeClaimedPasswordWrite({
            projectRef: input.projectRef,
            targetUserId: caller.userId,
            resetId: input.resetId,
            operationId: input.operationId,
            kind: 'USER_CHANGE',
            caller,
            password: input.newPassword
          })
        }

        deny()
      } catch (error) {
        throw mapDatabaseError(error)
      }
    },

    // Exposed for deterministic staged/delayed reset testing (T4c):
    // allows pausing between cp_begin_password_reset and cp_claim_password_write.
    async beginAdminReset({ projectRef, targetUserId, resetId }, accessToken) {
      try {
        if (
          projectRef !== PROJECT_REF ||
          !matches(UUID, targetUserId) ||
          !matches(UUID, resetId)
        ) {
          deny()
        }
        const caller = await verifyAuthenticatedCaller(accessToken)
        return await database.transaction(tx =>
          tx.call('beginPasswordReset', [
            projectRef,
            caller.userId,
            caller.sessionId,
            new Date(caller.expiresAt),
            targetUserId,
            resetId
          ])
        )
      } catch (error) {
        throw mapDatabaseError(error)
      }
    },

    async claimAndExecuteAdminReset(
      { projectRef, targetUserId, resetId, operationId, temporaryPassword },
      accessToken
    ) {
      try {
        if (
          projectRef !== PROJECT_REF ||
          !matches(UUID, targetUserId) ||
          !matches(UUID, resetId) ||
          !matches(UUID, operationId) ||
          !validPassword(temporaryPassword)
        ) {
          deny()
        }
        const caller = await verifyAuthenticatedCaller(accessToken)
        return await executeClaimedPasswordWrite({
          projectRef,
          targetUserId,
          resetId,
          operationId,
          kind: 'ADMIN_RESET',
          caller,
          password: temporaryPassword
        })
      } catch (error) {
        throw mapDatabaseError(error)
      }
    }
  })
}

export function createAccountAdminHandler({
  service,
  allowedOrigins,
  bodyTimeoutMs = 5000,
  routePath = '/functions/v1/cinevault-account-admin'
}) {
  if (
    !Array.isArray(allowedOrigins) ||
    !allowedOrigins.length ||
    !allowedOrigins.every(o => typeof o === 'string' && /^https:\/\/[^/@?#\s]+$/.test(o)) ||
    typeof service?.execute !== 'function' ||
    !Number.isSafeInteger(bodyTimeoutMs) ||
    bodyTimeoutMs < 1 ||
    bodyTimeoutMs > 5000 ||
    !['/functions/v1/cinevault-account-admin', '/cinevault-account-admin'].includes(routePath)
  ) {
    throw Error('account_admin_configuration_invalid')
  }
  const origins = new Set(allowedOrigins)

  return async request => {
    const origin = request.headers.get('origin')
    const headers = {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      vary: 'Origin'
    }
    if (origin && origins.has(origin)) {
      Object.assign(headers, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, apikey, content-type',
        'access-control-max-age': '0'
      })
    }
    const respond = (body, status) => new Response(JSON.stringify(body), { status, headers })

    try {
      if (origin !== null && !origins.has(origin)) return respond({ error: 'authorization' }, 403)
      const url = new URL(request.url)
      if (url.search || url.pathname !== routePath) return respond({ error: 'authorization' }, 403)
      if (request.method === 'OPTIONS') {
        return origin && origins.has(origin) ? respond({}, 200) : respond({ error: 'authorization' }, 403)
      }
      if (request.method !== 'POST') return respond({ error: 'authorization' }, 405)
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) deny()

      const reader = request.body?.getReader()
      if (!reader) deny()
      const chunks = []
      let size = 0
      let timer
      const began = performance.now()
      try {
        await Promise.race([
          (async () => {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              size += value.byteLength
              if (size > 8192) deny()
              chunks.push(value)
            }
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new AccountAdminFailure('authorization')), bodyTimeoutMs)
          })
        ])
        if (performance.now() - began >= bodyTimeoutMs) deny()
      } finally {
        clearTimeout(timer)
        void reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      const combined = new Uint8Array(size)
      let offset = 0
      for (const value of chunks) {
        combined.set(value, offset)
        offset += value.byteLength
      }
      let body
      try {
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined))
      } catch {
        deny()
      }
      const auth = request.headers.get('authorization')
      if (!auth || !/^Bearer [A-Za-z0-9._-]{1,8192}$/.test(auth)) deny()
      const result = await service.execute(body, auth.slice(7))
      return respond(result, 200)
    } catch (error) {
      const kind = error instanceof AccountAdminFailure ? error.kind : 'unavailable'
      const statusMap = {
        authorization: 403,
        reset_superseded: 409,
        password_reset_unresolved: 409,
        conflict: 409,
        password_write_outcome_uncertain: 503,
        unavailable: 503
      }
      const status = statusMap[kind] || 503
      const payload = { error: kind }
      if (error instanceof AccountAdminFailure && error.details?.resetId) {
        payload.resetId = error.details.resetId
        payload.operationId = error.details.operationId
      }
      return respond(payload, status)
    }
  }
}
