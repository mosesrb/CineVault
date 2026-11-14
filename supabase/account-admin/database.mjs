// Dedicated database pool & transaction adapter for cinevault-account-admin.
// Authenticates as cv_account_admin_login and sets local role cv_account_admin.
import { Buffer } from 'node:buffer'
import { performance } from 'node:perf_hooks'
import { PROJECT_REF } from '../broker/broker.mjs'
import { poolerCa } from '../broker/pooler-ca.mjs'

const queries = Object.freeze({
  verifyProjectAdmin: ['select cinevault_private.cp_verify_project_admin($1,$2,$3,$4) as result', 4],
  initProvisionedUserProfile: ['select cinevault_private.cp_init_provisioned_user_profile($1,$2,$3,$4,$5,$6,$7) as result', 7],
  beginPasswordReset: ['select cinevault_private.cp_begin_password_reset($1,$2,$3,$4,$5,$6) as result', 6],
  claimPasswordWrite: ['select cinevault_private.cp_claim_password_write($1,$2,$3,$4,$5,$6,$7,$8) as result', 8],
  markPasswordWriteUncertain: ['select cinevault_private.cp_mark_password_write_uncertain($1,$2,$3,$4,$5) as result', 5],
  sealPasswordReset: ['select cinevault_private.cp_seal_password_reset($1,$2,$3,$4,$5) as result', 5],
  completePasswordChange: ['select cinevault_private.cp_complete_password_change($1,$2,$3,$4,$5) as result', 5]
})

export function createAccountAdminDatabase({ postgres, databaseUrl, now = Date.now }) {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw Error('account_admin_database_url_invalid')
  }
  if (
    typeof postgres !== 'function' ||
    url.protocol !== 'postgresql:' ||
    !/^aws-\d+-ap-southeast-2\.pooler\.supabase\.com$/.test(url.hostname) ||
    url.port !== '6543' ||
    decodeURIComponent(url.username) !== `cv_account_admin_login.${PROJECT_REF}` ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash
  ) {
    throw Error('account_admin_database_target_invalid')
  }
  if (url.password.length < 32) {
    throw Error(`account_admin_database_password_policy_length_${url.password.length}`)
  }
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 2,
    ssl: { ca: poolerCa, rejectUnauthorized: true },
    connect_timeout: 5,
    idle_timeout: 20,
    max_lifetime: 60,
    connection: {
      application_name: 'cinevault-account-admin',
      statement_timeout: '8000',
      lock_timeout: '2000',
      idle_in_transaction_session_timeout: '8000',
      transaction_timeout: '10000'
    }
  })
  return createAccountAdminTransactionAdapter(sql, now)
}

export function createAccountAdminTransactionAdapter(sql, now = Date.now) {
  if (typeof sql?.begin !== 'function' || typeof sql?.end !== 'function') {
    throw Error('account_admin_configuration_invalid')
  }
  return Object.freeze({
    async transaction(action) {
      const began = now()
      const started = performance.now()
      const check = () => {
        const t = now()
        if (!Number.isSafeInteger(t) || t < began || t - began >= 10000 || performance.now() - started >= 10000) {
          throw Error('account_admin_transaction_timeout')
        }
      }
      const result = await sql.begin(async tx => {
        check()
        await tx.unsafe('set local role cv_account_admin')
        check()
        const value = await action(
          Object.freeze({
            async call(operation, args) {
              check()
              const entry = queries[operation]
              if (!entry || !Array.isArray(args) || args.length !== entry[1]) {
                throw Error('account_admin_query_denied')
              }
              const values = args.map(v =>
                v instanceof Uint8Array
                  ? Buffer.from(v)
                  : v && Object.getPrototypeOf(v) === Object.prototype
                    ? tx.json(v)
                    : v
              )
              const rows = await tx.unsafe(entry[0], values)
              check()
              if (rows.length !== 1 || Object.keys(rows[0]).join(',') !== 'result') {
                throw Error('account_admin_result_denied')
              }
              return rows[0].result
            }
          })
        )
        check()
        return value
      })
      check()
      return result
    },
    close: () => sql.end({ timeout: 5 })
  })
}
