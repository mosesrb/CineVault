import { Buffer } from 'node:buffer'
import { performance } from 'node:perf_hooks'
import { BrokerFailure, PROJECT_REF } from './broker.mjs'
const queries = Object.freeze({
  admitRequest: ['select cinevault_private.cp_admit_request() as result',0],
  admit: ['select cinevault_private.cp_admit($1,$2) as result',2],
  approve: ['select cinevault_private.cp_approve($1,$2,$3,$4,$5,$6) as result',6],
  register: ['select cinevault_private.cp_register($1,$2,$3,$4) as result',4],
  replaceApprove: ['select cinevault_private.cp_replace_approve($1,$2,$3,$4,$5,$6) as result',6],
  replace: ['select cinevault_private.cp_replace($1,$2,$3,$4) as result',4],
  verifier: ['select cinevault_private.cp_verifier($1) as result',1],
  heartbeat: ['select cinevault_private.cp_heartbeat($1,$2,$3) as result',3]
})
/** Fixed hosted pool only. No service_role/project secret/owner token is used.
 * The dedicated password belongs in hosted secret storage, never the PC/config.
 * Driver is supplied by pinned runtime package, not caller input. */
export function createDatabase({postgres,databaseUrl,now=Date.now}) {
  let url
  try {url=new URL(databaseUrl)} catch {throw Error('broker_configuration_invalid')}
  if(typeof postgres!=='function' || url.protocol!=='postgresql:' ||
    !/^aws-\d+-ap-southeast-2\.pooler\.supabase\.com$/.test(url.hostname) || url.port!=='6543' ||
    decodeURIComponent(url.username)!==`cv_control_broker_login.${PROJECT_REF}` || url.password.length<32 ||
    url.pathname!=='/postgres' || url.search || url.hash)throw Error('broker_configuration_invalid')
  const sql=postgres(databaseUrl,{prepare:false,max:2,ssl:{rejectUnauthorized:true},connect_timeout:5,
    idle_timeout:20,max_lifetime:60,connection:{application_name:'cinevault-control-plane',
      statement_timeout:'8000',lock_timeout:'2000',idle_in_transaction_session_timeout:'8000',transaction_timeout:'10000'}})
  return createTransactionAdapter(sql,now)
}
/** Internal trusted-driver seam for disposable real-driver tests. Production
 * construction must use createDatabase's fixed hosted URL/TLS restrictions. */
export function createTransactionAdapter(sql,now=Date.now) {
  if(typeof sql?.begin!=='function' || typeof sql?.end!=='function')throw Error('broker_configuration_invalid')
  return Object.freeze({
    async transaction(action) {
      const began=now(),started=performance.now()
      const check=()=>{const t=now();if(!Number.isSafeInteger(t) || t<began || t-began>=10000 || performance.now()-started>=10000)throw new BrokerFailure('unavailable')}
      // No Promise.race, detached mutation, forced early release, or implicit retry.
      // Postgres.js begin commits only if callback resolves; errors roll it back.
      const result=await sql.begin(async tx=>{
        check();await tx.unsafe('set local role cv_control_broker');check()
        const value=await action(Object.freeze({async call(operation,args) {
          check();const entry=queries[operation]
          if(!entry || !Array.isArray(args) || args.length!==entry[1])throw Error('broker_query_denied')
          const values=args.map(v=>v instanceof Uint8Array?Buffer.from(v):
            v && Object.getPrototypeOf(v)===Object.prototype?tx.json(v):v)
          const rows=await tx.unsafe(entry[0],values);check()
          if(rows.length!==1 || Object.keys(rows[0]).join(',')!=='result')throw Error('broker_result_denied')
          return rows[0].result
        }}))
        check();return value
      })
      check() // Late/lost COMMIT acknowledgment is uncertain, never presumed rollback.
      return result
    },
    close:()=>sql.end({timeout:5})
  })
}
