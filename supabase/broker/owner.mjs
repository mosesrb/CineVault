import jwt from 'jsonwebtoken'
import { createPublicKey } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { BrokerFailure, PROJECT_REF } from './broker.mjs'
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const fail=()=>{throw new BrokerFailure('authorization')}
const matches=(r,v)=>typeof v==='string'&&r.test(v)
/** One verifier per isolate, public keys only; no owner token/key URL cache.
 * Every call also reads fixed-project Auth/user, then SQL checks live native
 * session/profile/owner rows under locks. Metadata never establishes authority. */
export function createOwnerVerifier({publishableKey,fetchImpl=fetch,now=Date.now}) {
  if(!matches(/^sb_publishable_[A-Za-z0-9_-]{16,256}$/,publishableKey))throw Error('broker_configuration_invalid')
  const issuer=`https://${PROJECT_REF}.supabase.co/auth/v1`
  let keys=new Map(),until=0,lastAttempt=-30000,inflight=null
  async function read(url,token) {
    const controller=new AbortController(),began=now(),started=performance.now();let timer
    try {
      const pending=(async()=>{
        const response=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
          referrerPolicy:'no-referrer',signal:controller.signal,
          headers:{apikey:publishableKey,...(token?{Authorization:'Bearer '+token}:{})}})
        if(response.status!==200||response.redirected||(response.url&&response.url!==url)||
          !/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))fail()
        const reader=response.body.getReader(),chunks=[];let size=0
        try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)fail();chunks.push(value)}}
        finally {void reader.cancel().catch(()=>{});reader.releaseLock()}
        const bytes=new Uint8Array(size);let offset=0
        for(const value of chunks){bytes.set(value,offset);offset+=value.byteLength}
        return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
      })()
      const result=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new BrokerFailure('authorization'))},5000)})])
      if(controller.signal.aborted||now()<began||now()-began>=5000||performance.now()-started>=5000)fail()
      return result
    } finally {clearTimeout(timer);controller.abort()}
  }
  async function refresh() {
    if(inflight)return inflight
    const time=now();if(time<lastAttempt||time-lastAttempt<30000)fail()
    lastAttempt=time;keys=new Map();until=0
    inflight=(async()=>{
      const document=await read(issuer+'/.well-known/jwks.json')
      if(!Array.isArray(document.keys)||!document.keys.length||document.keys.length>8)fail()
      const next=new Map()
      for(const value of document.keys){
        if(!value||!matches(/^[\w-]{1,128}$/,value.kid)||next.has(value.kid)||value.use!=='sig'||
          !['ES256','RS256'].includes(value.alg)||['d','p','q','dp','dq','qi','oth','k'].some(k=>k in value))fail()
        if(value.key_ops!==undefined&&(!Array.isArray(value.key_ops)||value.key_ops.length!==1||value.key_ops[0]!=='verify'))fail()
        const key=createPublicKey({key:value,format:'jwk'})
        if(value.alg==='ES256'&&(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails.namedCurve!=='prime256v1'))fail()
        if(value.alg==='RS256'&&(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048||key.asymmetricKeyDetails.modulusLength>4096))fail()
        next.set(value.kid,{key,algorithm:value.alg})
      }
      if(now()<time||now()>=time+300000)fail()
      keys=next;until=time+300000
    })()
    try {await inflight} finally {inflight=null}
  }
  return async token=>{
    try {
      const started=performance.now(),began=now()
      if(!Number.isSafeInteger(began)||began<0||began<lastAttempt||typeof token!=='string'||token.length>8192)fail()
      const decoded=jwt.decode(token,{complete:true}),header=decoded?.header
      if(!header||Object.keys(header).sort().join(',')!=='alg,kid,typ'||header.typ!=='JWT'||!matches(/^[\w-]{1,128}$/,header.kid))fail()
      if(began>=until||!keys.has(header.kid))await refresh()
      const snapshot=keys,entry=snapshot.get(header.kid)
      if(!entry||entry.algorithm!==header.alg)fail()
      const claims=jwt.verify(token,entry.key,{algorithms:[entry.algorithm],issuer,audience:'authenticated',clockTimestamp:Math.floor(now()/1000)})
      if(claims.aud!=='authenticated'||claims.role!=='authenticated'||claims.is_anonymous!==false||
        !matches(UUID,claims.sub)||!matches(UUID,claims.session_id)||!Number.isSafeInteger(claims.exp)||
        !Number.isSafeInteger(claims.iat)||claims.iat>Math.floor(now()/1000)||claims.exp<=claims.iat||claims.exp>Number.MAX_SAFE_INTEGER/1000)fail()
      const user=await read(issuer+'/user',token)
      if(user.id!==claims.sub||user.is_anonymous!==false||user.deleted_at!=null||
        (user.banned_until!=null&&(typeof user.banned_until!=='string'||!Number.isFinite(Date.parse(user.banned_until))||Date.parse(user.banned_until)>now())))fail()
      if(snapshot!==keys||now()>=until||now()<began||Math.floor(now()/1000)>=claims.exp||
        now()-began>=10000||performance.now()-started>=10000)fail()
      return Object.freeze({userId:claims.sub,sessionId:claims.session_id,expiresAt:claims.exp*1000})
    } catch {fail()}
  }
}
