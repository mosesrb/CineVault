import assert from 'node:assert/strict'
import {Buffer} from 'node:buffer'
import {webcrypto} from 'node:crypto'
import {createOwnerVerifier} from '../../broker/owner.mjs'

// Independent Web Crypto signing avoids jsonwebtoken's runtime-specific signing
// metadata. Only generated fixture keys and in-memory provider responses are used.
export async function qualifyOwnerCrypto() {
  const userId='11111111-1111-4111-8111-111111111111'
  const sessionId='22222222-2222-4222-8222-222222222222'
  const issuer='https://uouydbapluktfrylligo.supabase.co/auth/v1'
  const issued=Math.floor(Date.now()/1000)
  const claims={sub:userId,session_id:sessionId,aud:'authenticated',role:'authenticated',
    is_anonymous:false,iss:issuer,iat:issued,exp:issued+300}
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  const key={...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'compat-fixture',use:'sig',alg:'ES256'}
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
  const input=encode({alg:'ES256',kid:key.kid,typ:'JWT'})+'.'+encode(claims)
  const sign=async privateKey=>input+'.'+Buffer.from(await webcrypto.subtle.sign(
    {name:'ECDSA',hash:'SHA-256'},privateKey,Buffer.from(input))).toString('base64url')
  let authorized=true
  const verifier=createOwnerVerifier({publishableKey:'sb_publishable_'+'q'.repeat(32),fetchImpl:async url=>
    Response.json(url.endsWith('/jwks.json')?{keys:[key]}:{id:userId,is_anonymous:false},
      {status:url.endsWith('/jwks.json')||authorized?200:403})})
  const token=await sign(pair.privateKey)
  assert.deepEqual(await verifier(token),{userId,sessionId,expiresAt:claims.exp*1000})

  const other=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  await assert.rejects(verifier(await sign(other.privateKey)),error=>error.kind==='authorization')
  authorized=false
  await assert.rejects(verifier(token),error=>error.kind==='authorization')

  const wrongCurve=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-384'},true,['sign','verify'])
  const wrongKey={...await webcrypto.subtle.exportKey('jwk',wrongCurve.publicKey),kid:key.kid,use:'sig',alg:'ES256'}
  const wrongVerifier=createOwnerVerifier({publishableKey:'sb_publishable_'+'q'.repeat(32),fetchImpl:async()=>
    Response.json({keys:[wrongKey]})})
  await assert.rejects(wrongVerifier(token),error=>error.kind==='authorization')
  return 4
}
