// Hosted-only composition. Constructor dependencies/config are trusted, not HTTP.
import {createDatabase} from './database.mjs'
import {createOwnerVerifier} from './owner.mjs'
import {createBroker,createHandler,BrokerFailure,PROJECT_REF} from './broker.mjs'
const unavailable=()=>new Response(JSON.stringify({error:'unavailable'}),{status:503,
  headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}})
/** One pool/verifier per isolate. Admission commits independently of auth/business
 * rollback, so failed tokens/requests still consume bounded shared quotas. No
 * background timers, owner bootstrap or credential renewal/reset is performed. */
export function createRuntime({configuration,postgres,fetchImpl=fetch,now=Date.now}) {
  let database
  try {
    const config=structuredClone(configuration)
    if(!config||Object.getPrototypeOf(config)!==Object.prototype ||
      Object.keys(config).sort().join(',')!=='approvalOrigin,databaseUrl,enabled,projectRef,publishableKey' ||
      config.enabled!=='true' || config.projectRef!==PROJECT_REF ||
      typeof config.approvalOrigin!=='string' || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/.test(config.approvalOrigin))
      throw Error('broker_configuration_invalid')
    const verifyOwner=createOwnerVerifier({publishableKey:config.publishableKey,fetchImpl,now})
    database=createDatabase({postgres,databaseUrl:config.databaseUrl,now})
    const admission=async(operation,args)=>{
      try {
        if(stopped)throw new BrokerFailure('unavailable')
        const result=await database.transaction(tx=>tx.call(operation,args))
        if(stopped)throw new BrokerFailure('unavailable')
        return result===true
      }
      catch {throw new BrokerFailure('unavailable')}
    }
    const broker=createBroker({database,verifyOwner,now,admit:({operation,identity})=>admission('admit',[operation,identity])})
    const handle=createHandler({broker,approvedOrigin:config.approvalOrigin,
      admitRequest:()=>admission('admitRequest',[]),routePath:'/cinevault-control-plane'})
    // Nonqueued per-isolate concurrency rejects floods before acquiring DB pool
    // connections. The DB counters, not this local cap, own cross-isolate limits.
    let active=0,stopped=false
    return Object.freeze({async handle(request) {
      if(stopped)return unavailable()
      if(active>=2)return new Response(JSON.stringify({error:'rate_limited'}),{status:429,
        headers:{'content-type':'application/json','cache-control':'no-store','retry-after':'60','vary':'Origin',
          'x-content-type-options':'nosniff',...(request.headers.get('origin')===config.approvalOrigin?
            {'access-control-allow-origin':config.approvalOrigin}:{})}})
      active++
      try {return await handle(request)}finally{active--}
    },async close(){stopped=true;await database.close()},configured:true})
  }catch {
    // Configuration is never returned/logged. Missing opt-in yields no pool,
    // provider request or successful endpoint. No identity/credentials generated.
    if(database)void database.close().catch(()=>{})
    return Object.freeze({handle:async()=>unavailable(),close:async()=>{},configured:false})
  }
}
