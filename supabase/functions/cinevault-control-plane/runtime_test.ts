// Real Deno engine checks; synthetic in-memory Auth, no provider traffic.
import jwt from 'jsonwebtoken'
import postgres from 'postgres'
import {generateKeyPairSync,randomUUID} from 'node:crypto'
import {createRuntime} from '../../broker/runtime.mjs'
import {createOwnerVerifier} from '../../broker/owner.mjs'
import {createTransactionAdapter} from '../../broker/database.mjs'
const assert=(value:unknown)=>{if(!value)throw Error('qualification_failed')}

Deno.test('Deno loads the pinned modules and disabled runtime makes no network/database calls',async()=>{
 const app=createRuntime({configuration:{},postgres:()=>{throw Error('unexpected pool')},fetchImpl:()=>{throw Error('unexpected provider')}})
 assert(app.configured===false);const response=await app.handle(new Request('https://qa.invalid/cinevault-control-plane'))
 assert(response.status===503);assert(await response.text()==='{"error":"unavailable"}');await app.close()
})
Deno.test('Deno Node crypto/JWT and WebCrypto verify fixed-project asymmetric owner',async()=>{
 const user=randomUUID(),session=randomUUID(),keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),ref='uouydbapluktfrylligo'
 const issuer='https://'+ref+'.supabase.co/auth/v1',key={...keys.publicKey.export({format:'jwk'}),kid:'qa',alg:'ES256',use:'sig'}
 const token=jwt.sign({sub:user,session_id:session,role:'authenticated',is_anonymous:false,iss:issuer,aud:'authenticated',
  iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60},keys.privateKey,{algorithm:'ES256',keyid:'qa'})
 const verify=createOwnerVerifier({publishableKey:'sb_publishable_'+'q'.repeat(32),fetchImpl:async(input:RequestInfo|URL)=>
  Response.json(String(input).endsWith('/jwks.json')?{keys:[key]}:{id:user,is_anonymous:false})})
 const result=await verify(token);assert(result?.userId===user&&result?.sessionId===session)
})
const port=Deno.env.get('CV_QA_POSTGRES_PORT')
Deno.test({name:'Deno pinned Postgres.js transaction/role/JSON transport on disposable loopback fixture',ignore:!port,fn:async()=>{
 assert(typeof port==='string'&&/^[0-9]{4,5}$/.test(port)&&Number(port)>1024&&Number(port)<=65535)
 // Explicit synthetic identity/password; the runner permits only the pinned
 // driver's named PG option reads, never arbitrary environment access.
 const sql=postgres({host:'127.0.0.1',port:Number(port),database:'postgres',username:'cv_qa_login',password:'synthetic-only',
  prepare:false,max:1,connect_timeout:3,ssl:false})
 const adapter=createTransactionAdapter(sql)
 type Transaction={call:(operation:string,args:unknown[])=>Promise<unknown>}
 try {
  const result=await adapter.transaction((tx:Transaction)=>tx.call('admitRequest',[]));assert(typeof result==='boolean')
  let denied=false
  try {await adapter.transaction((tx:Transaction)=>tx.call('heartbeat',[randomUUID(),new Uint8Array(32),{operation:'heartbeat'}]))}
  catch(error){denied=error instanceof Error&&'code' in error&&error.code==='42501'}
  assert(denied) // Bytea/JSON binding reached the SQL authorization guard.
 }
 finally{await adapter.close()}
}})
