// Hosted-only runtime composition for cinevault-account-admin.
// Fails closed (HTTP 503) without opening DB/Auth connections unless explicitly enabled.
import { createOwnerVerifier } from '../broker/owner.mjs'
import { PROJECT_REF } from '../broker/broker.mjs'
import { createAccountAdminDatabase } from './database.mjs'
import { createAuthAdminClient } from './authAdmin.mjs'
import { createAccountAdminService, createAccountAdminHandler } from './service.mjs'

const unavailable = () =>
  new Response(JSON.stringify({ error: 'unavailable' }), {
    status: 503,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  })

export function createAccountAdminRuntime({
  configuration,
  postgres,
  fetchImpl = fetch,
  now = Date.now
}) {
  let database
  try {
    const config = structuredClone(configuration)
    if (
      !config ||
      Object.getPrototypeOf(config) !== Object.prototype ||
      Object.keys(config).sort().join(',') !==
        'allowedOrigins,databaseUrl,enabled,projectRef,publishableKey,serviceRoleKey' ||
      config.enabled !== 'true' ||
      config.projectRef !== PROJECT_REF ||
      typeof config.allowedOrigins !== 'string' ||
      !config.allowedOrigins.trim()
    ) {
      throw Error('account_admin_configuration_invalid')
    }
    const allowedOrigins = config.allowedOrigins
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    const verifyCaller = createOwnerVerifier({
      publishableKey: config.publishableKey,
      fetchImpl,
      now
    })
    database = createAccountAdminDatabase({
      postgres,
      databaseUrl: config.databaseUrl,
      now
    })
    const authAdmin = createAuthAdminClient({
      serviceRoleKey: config.serviceRoleKey,
      projectRef: config.projectRef,
      fetchImpl,
      now
    })
    const service = createAccountAdminService({
      database,
      verifyCaller,
      authAdmin,
      now
    })
    const handle = createAccountAdminHandler({
      service,
      allowedOrigins,
      routePath: '/functions/v1/cinevault-account-admin'
    })

    let active = 0
    let stopped = false
    return Object.freeze({
      async handle(request) {
        if (stopped) return unavailable()
        if (active >= 2) {
          return new Response(JSON.stringify({ error: 'rate_limited' }), {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'cache-control': 'no-store',
              'retry-after': '60',
              'x-content-type-options': 'nosniff'
            }
          })
        }
        active++
        try {
          return await handle(request)
        } finally {
          active--
        }
      },
      async close() {
        stopped = true
        await database.close()
      },
      configured: true
    })
  } catch (error) {
    if (configuration?.enabled === 'true') {
      const codes = [
        'account_admin_configuration_invalid',
        'account_admin_database_url_invalid',
        'account_admin_database_target_invalid',
        ...Array.from({ length: 32 }, (_, l) => `account_admin_database_password_policy_length_${l}`)
      ]
      console.error(
        'CineVault account-admin startup rejected',
        codes.includes(error?.message)
          ? error.message
          : 'account_admin_dependency_initialization_failed'
      )
    }
    if (database) void database.close().catch(() => {})
    return Object.freeze({
      handle: async () => unavailable(),
      close: async () => {},
      configured: false
    })
  }
}
