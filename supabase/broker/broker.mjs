// Hosted-only preparation. No imports from the CineVault application/PC runtime.
// Constructor adapters are trusted runtime dependencies, never request options.
import { timingSafeEqual } from 'node:crypto'
import { performance } from 'node:perf_hooks'
export const PROJECT_REF = 'uouydbapluktfrylligo'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const HEX = /^[a-f0-9]{64}$/
const FIELDS = ['projectRef','serverInstanceId','pairId','credentialId','secretDigest','pollDigest','expiresAt','idempotencyKey','approvalDigest']
const encoder = new TextEncoder()
const matches = (r,v) => typeof v === 'string' && r.test(v)
const deny = () => { throw new BrokerFailure('authorization') }
export class BrokerFailure extends Error {
  constructor(kind) { super('control_plane_' + kind); this.kind = kind }
}
function exact(value,keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) deny()
}
const hex = bytes => Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,'0')).join('')
const bytes = value => Uint8Array.from(value.match(/../g),v=>parseInt(v,16))
export const sha = async value => hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)))
function same(a,b) {
  if (!matches(HEX,a) || !matches(HEX,b)) return false
  return timingSafeEqual(bytes(a),bytes(b))
}
function pairing(value,now,replacing=false) {
  exact(value,replacing?[...FIELDS,'replacement']:FIELDS)
  if(value.projectRef!==PROJECT_REF || !['serverInstanceId','pairId','credentialId','idempotencyKey'].every(k=>matches(UUID,value[k])) ||
    !['secretDigest','pollDigest','approvalDigest'].every(k=>matches(HEX,value[k])) || !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt<=now || value.expiresAt>now+300000)deny()
  if(replacing){
    exact(value.replacement,['credentialId','cloudServerId','epoch'])
    if(!['credentialId','cloudServerId'].every(k=>matches(UUID,value.replacement[k])) ||
      value.replacement.credentialId===value.credentialId || !Number.isSafeInteger(value.replacement.epoch) ||
      value.replacement.epoch<1 || value.replacement.epoch>=Number.MAX_SAFE_INTEGER-1)deny()
  }
}
const replacementValues=r=>r?[r.credentialId,r.cloudServerId,r.epoch]:[]
function databaseFailure(error) {
  if(error instanceof BrokerFailure)return error
  if(error?.code==='42501')return new BrokerFailure('authorization')
  if(error?.code==='23505' || (error?.code==='P0001' && error.message==='cp_conflict'))return new BrokerFailure('conflict')
  if(error?.code==='P0001' && error.message==='cp_rate_limited')return new BrokerFailure('rate_limited')
  return new BrokerFailure('unavailable') // unknown outage never declares project paused
}

/** Owner verifier MUST validate the supplied token with fixed-project Auth (or
 * verified asymmetric signing keys plus fresh Auth read) before returning signed
 * subject/session/expiry. Never decode an unverified JWT as authority. SQL then
 * locks/rechecks current user/session/profile/privately provisioned owner records.
 * Admission is trusted and bounded by runtime; false/timeout must deny. */
export function createBroker({database,verifyOwner,admit,now=Date.now}) {
  if(typeof database?.transaction!=='function' || typeof verifyOwner!=='function' || typeof admit!=='function')throw Error('broker_configuration_invalid')
  async function admitted(operation,identity) {
    if(await admit(Object.freeze({operation,identity}))!==true)throw new BrokerFailure('rate_limited')
  }
  async function query(tx,operation,args) {
    const result=await tx.call(operation,args)
    return result
  }
  return Object.freeze({
    async execute(input,credential,accessToken) {
      try {
        input=structuredClone(input)
        const started=now()
        if(!Number.isSafeInteger(started) || started<0)deny()
        const operation=input?.operation
        if(operation==='approve' || operation==='approve-replacement') {
          const replacing=operation==='approve-replacement'
          exact(input,['operation','request','approvalProof','confirmedInstanceId']);pairing(input.request,started,replacing)
          if(credential!==null || !matches(HEX,input.approvalProof) || input.confirmedInstanceId!==input.request.serverInstanceId ||
            !same(await sha(input.approvalProof),input.request.approvalDigest) || typeof accessToken!=='string' || accessToken.length>8192)deny()
          await admitted('approve',input.request.serverInstanceId)
          const authority=await verifyOwner(accessToken)
          exact(authority,['userId','sessionId','expiresAt'])
          if(!matches(UUID,authority.userId) || !matches(UUID,authority.sessionId) || !Number.isSafeInteger(authority.expiresAt) || authority.expiresAt<=now())deny()
          pairing(input.request,now(),replacing)
          const binding=await sha(JSON.stringify([...FIELDS.map(k=>input.request[k]),...replacementValues(input.request.replacement)]))
          return await database.transaction(tx=>query(tx,replacing?'replaceApprove':'approve',[authority.userId,authority.sessionId,new Date(authority.expiresAt),
            input.request,bytes(binding),bytes(input.request.approvalDigest)]))
        }
        if(operation==='register' || operation==='replace') {
          const replacing=operation==='replace'
          exact(input,['operation','request','pollSecret']);pairing(input.request,started,replacing)
          if(credential!==null || accessToken!==null || !matches(HEX,input.pollSecret) ||
            !same(await sha(input.pollSecret),input.request.pollDigest))deny()
          const key=await crypto.subtle.importKey('raw',bytes(input.pollSecret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
          const proof=hex(await crypto.subtle.sign('HMAC',key,encoder.encode((replacing?'cinevault-replacement-v1\n':'cinevault-approval-v1\n')+
            JSON.stringify([...FIELDS.slice(0,8).map(k=>input.request[k]),...replacementValues(input.request.replacement)]))))
          if(!same(await sha(proof),input.request.approvalDigest))deny()
          await admitted('register',input.request.serverInstanceId);pairing(input.request,now(),replacing)
          const binding=await sha(JSON.stringify([...FIELDS.map(k=>input.request[k]),...replacementValues(input.request.replacement)]))
          return await database.transaction(tx=>query(tx,replacing?'replace':'register',[input.request,bytes(binding),bytes(input.request.pollDigest),bytes(input.request.approvalDigest)]))
        }
        if(operation==='heartbeat') {
          exact(input,['operation','idempotencyKey','sequence','activity','projectRef','serverInstanceId','credentialId','epoch'])
          if(accessToken!==null || !matches(HEX,credential) || input.projectRef!==PROJECT_REF ||
            !['serverInstanceId','credentialId','idempotencyKey'].every(k=>matches(UUID,input[k])) ||
            !Number.isSafeInteger(input.epoch) || input.epoch<1 || !Number.isSafeInteger(input.sequence) || input.sequence<1 || input.sequence>=Number.MAX_SAFE_INTEGER ||
            !['authenticated-request','media-work','startup','shutdown','admin-retry'].includes(input.activity))deny()
          await admitted(operation,input.credentialId)
          const digest=await sha(credential)
          return await database.transaction(async tx=>{
            const verifier=await query(tx,'verifier',[input.credentialId])
            if(!same(digest,verifier))deny() // only bounded digest lookup before authentication
            return query(tx,'heartbeat',[input.credentialId,bytes(digest),input])
          })
        }
        // Revoke SQL is human-only commissioning capability. Replacement requires
        // fresh owner approval; no reset/import/arbitrary privileged operation.
        deny()
      } catch(error) {throw databaseFailure(error)}
    }
  })
}

/** HTTP has fixed CORS, size/shape limits, no credential-bearing URLs or logs.
 * It awaits settled mutation transactions: request cancellation is not rollback.
 * A lost reply must be retried with the existing durable operation, not new keys. */
export function createHandler({broker,approvedOrigin,admitRequest,bodyTimeoutMs=5000,routePath='/functions/v1/cinevault-control-plane'}) {
  if(!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/.test(approvedOrigin) ||
    typeof broker?.execute!=='function' || typeof admitRequest!=='function' ||
    !Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs<1 || bodyTimeoutMs>5000 ||
    !['/functions/v1/cinevault-control-plane','/cinevault-control-plane'].includes(routePath))throw Error('broker_configuration_invalid')
  return async request=>{
    const origin=request.headers.get('origin')
    const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',vary:'Origin'}
    if(origin===approvedOrigin)Object.assign(headers,{'access-control-allow-origin':approvedOrigin,
      'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type',
      'access-control-max-age':'0'})
    const respond=(body,status)=>new Response(JSON.stringify(body),{status,headers})
    try {
      if(origin!==null && origin!==approvedOrigin)return respond({error:'authorization'},403)
      if(new URL(request.url).search || new URL(request.url).pathname!==routePath)return respond({error:'authorization'},403)
      if(request.method==='OPTIONS')return origin===approvedOrigin?respond({},200):respond({error:'authorization'},403)
      if(request.method!=='POST')return respond({error:'authorization'},405)
      if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))deny()
      if(await admitRequest(request)!==true)throw new BrokerFailure('rate_limited')
      const reader=request.body?.getReader();if(!reader)deny()
      const chunks=[];let size=0,timer
      const began=performance.now()
      try {
        // Only a side-effect-free body read is raced. Mutations below always
        // await transaction settlement. Never await a hostile cancel promise.
        await Promise.race([(async()=>{
          while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192)deny();chunks.push(value)}
        })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new BrokerFailure('authorization')),bodyTimeoutMs)})])
        if(performance.now()-began>=bodyTimeoutMs)deny()
      } finally {clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock()}
      const combined=new Uint8Array(size);let offset=0
      for(const value of chunks){combined.set(value,offset);offset+=value.byteLength}
      let body
      try {body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined))}catch {deny()}
      const auth=request.headers.get('authorization'),credential=request.headers.get('x-cinevault-credential')
      if(['approve','approve-replacement'].includes(body?.operation) && origin!==approvedOrigin)deny()
      if(auth!==null && !/^Bearer [A-Za-z0-9._-]{1,8192}$/.test(auth))deny()
      const result=await broker.execute(body,credential,auth===null?null:auth.slice(7))
      return result===null?respond({pending:true},202):respond(result,200)
    } catch(error) {
      const kind=error instanceof BrokerFailure?error.kind:'unavailable'
      const status={authorization:403,conflict:409,rate_limited:429,unavailable:503}[kind]||503
      if(status===429)headers['retry-after']='60'
      return respond({error:kind},status)
    }
  }
}
