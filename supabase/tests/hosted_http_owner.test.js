// Synthetic signed JWT/HTTP tests; no real owner tokens/network/provider calls.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const jwt=require('../broker/node_modules/jsonwebtoken');
const {PROJECT_REF}=require('../../services/controlPlane/protocol');
const base=`https://${PROJECT_REF}.supabase.co/auth/v1`,origin='https://cv-approval-qa.pages.dev';
const modules=Promise.all([import('../broker/owner.mjs'),import('../broker/broker.mjs'),import('../broker/database.mjs')]);
const user=crypto.randomUUID(),session=crypto.randomUUID();
function signed() {
 const pair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),key=pair.publicKey.export({format:'jwk'});
 Object.assign(key,{kid:'qa-key',use:'sig',alg:'ES256'});
 const sign=overrides=>jwt.sign({sub:user,session_id:session,role:'authenticated',is_anonymous:false,iat:Math.floor(Date.now()/1000),
  exp:Math.floor(Date.now()/1000)+300,iss:base,aud:'authenticated',...overrides},pair.privateKey,{algorithm:'ES256',keyid:'qa-key'});
 return {key,sign};
}
test('prepared owner verifier + HTTP boundary',async t=>{
 const [{createOwnerVerifier},{createHandler,BrokerFailure},{createDatabase,createTransactionAdapter}]=await modules;
 const make=(opts={})=>{const keys=signed(),calls=[];let currentUser={id:user,is_anonymous:false};
  const fetchImpl=async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/jwks.json')?{keys:[keys.key]}:currentUser);};
  const verify=createOwnerVerifier({publishableKey:'sb_publishable_'+'q'.repeat(32),fetchImpl,...opts});
  return {...keys,verify,calls,changeUser:value=>{currentUser=value;}};
 };
 await t.test('verified asymmetric subject/session returned; fixed URLs/key only, fresh Auth on every use',async()=>{
  const f=make(),token=f.sign();const a=await f.verify(token),b=await f.verify(token);assert.deepEqual(a,b);assert.equal(a.userId,user);assert.equal(a.sessionId,session);
  assert.deepEqual(f.calls.map(c=>c.url),[base+'/.well-known/jwks.json',base+'/user',base+'/user']);
  assert.equal(f.calls[0].options.headers.Authorization,undefined);assert.equal(f.calls[1].options.headers.Authorization,'Bearer '+token);
  assert.ok(f.calls.every(c=>c.options.redirect==='error'&&c.options.credentials==='omit'));
 });
 await t.test('signed metadata spoof cannot substitute for valid subject/session/role/anonymous checks',async()=>{
  const f=make();for(const claims of [{role:'service_role'},{is_anonymous:true},{sub:'not-a-user'},{session_id:'invalid'},{aud:['authenticated']},
   {iat:Math.floor(Date.now()/1000)+100},{exp:Math.floor(Date.now()/1000)-1}])await assert.rejects(f.verify(f.sign({...claims,user_metadata:{role:'ADMIN'}})),e=>e.kind==='authorization');
 });
 await t.test('wrong signing key cannot pass even with identical kid',async()=>{
  const f=make(),g=signed();await assert.rejects(f.verify(g.sign()),e=>e.kind==='authorization');
 });
 await t.test('current Auth denial is checked despite a warm signing-key cache',async()=>{
  const f=make(),token=f.sign();await f.verify(token);
  for(const current of [{id:crypto.randomUUID(),is_anonymous:false},{id:user,is_anonymous:true},{id:user,is_anonymous:false,deleted_at:new Date().toISOString()},
   {id:user,is_anonymous:false,banned_until:new Date(Date.now()+10000).toISOString()}]){f.changeUser(current);await assert.rejects(f.verify(token),e=>e.kind==='authorization');}
 });
 await t.test('cached owner verification rejects clock rollback before key refresh time',async()=>{
  let now=Date.now();const f=make({now:()=>now}),token=f.sign();await f.verify(token);now-=1000;
  await assert.rejects(f.verify(token),e=>e.kind==='authorization');
 });
 await t.test('invalid redirect, body limit and duplicate/private JWK fail closed',async()=>{
  const keys=signed();for(const response of [new Response('x',{status:302}),Response.json({keys:[keys.key,keys.key]}),Response.json({keys:[{...keys.key,d:'private'}]}),
   new Response('x'.repeat(16385),{headers:{'content-type':'application/json'}})]){
   const verify=createOwnerVerifier({publishableKey:'sb_publishable_'+'q'.repeat(32),fetchImpl:async()=>response});await assert.rejects(verify(keys.sign()),e=>e.kind==='authorization');
  }
 });
 const req=(body,headers={},url=`https://${PROJECT_REF}.supabase.co/functions/v1/cinevault-control-plane`)=>new Request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const setup=({execute=async()=>null,admitRequest=async()=>true,...rest}={})=>createHandler({broker:{execute},approvedOrigin:origin,admitRequest,...rest});
 await t.test('pending response and exact CORS; foreign origins and approve without exact origin deny',async()=>{
  const handle=setup();const result=await handle(req({operation:'register'}));assert.equal(result.status,202);assert.deepEqual(await result.json(),{pending:true});
  assert.equal(result.headers.get('access-control-allow-origin'),null);
  assert.equal((await handle(req({operation:'register'},{origin:'https://evil.invalid'}))).status,403);
  assert.equal((await handle(req({operation:'approve'}))).status,403);
  const allowed=await handle(req({operation:'approve'},{origin,authorization:'Bearer qa.jwt.token'}));assert.equal(allowed.headers.get('access-control-allow-origin'),origin);
 });
 await t.test('authorization/credential stay in headers; body/URLs do not gain privileged options',async()=>{
  let call;const handle=setup({execute:async(...args)=>{call=args;return {ok:true};}});
  const res=await handle(req({operation:'heartbeat'},{'x-cinevault-credential':'a'.repeat(64)}));assert.equal(res.status,200);assert.equal(call[1],'a'.repeat(64));assert.equal(call[2],null);
  assert.equal((await handle(req({}, {},`https://${PROJECT_REF}.supabase.co/functions/v1/cinevault-control-plane?secret=x`))).status,403);
 });
 await t.test('malformed/oversized bodies and tokens deny before broker call',async()=>{
  let calls=0;const handle=setup({execute:async()=>{calls++;return {};}});
  assert.equal((await handle(new Request('https://qa.invalid/functions/v1/cinevault-control-plane',{method:'POST',headers:{'content-type':'application/json'},body:'{'}))).status,403);
  assert.equal((await handle(req({x:'a'.repeat(8192)}))).status,403);
  assert.equal((await handle(req({}, {authorization:'Basic secret'}))).status,403);assert.equal(calls,0);
 });
 await t.test('stalled body with hostile cancellation is bounded without starting mutations',async()=>{
  let calls=0;const handle=setup({bodyTimeoutMs:25,execute:async()=>{calls++;return {};}}),started=performance.now();
  const request=new Request('https://qa.invalid/functions/v1/cinevault-control-plane',{method:'POST',headers:{'content-type':'application/json'},duplex:'half',
   body:new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})})});
  assert.equal((await handle(request)).status,403);assert.ok(performance.now()-started<1000);assert.equal(calls,0);
 });
 await t.test('request admission requires literal true; operational errors are sanitized with retry guidance',async()=>{
  assert.equal((await setup({admitRequest:async()=>({allowed:true})})(req({}))).status,429);
  for(const [kind,status] of [['authorization',403],['conflict',409],['rate_limited',429],['unavailable',503]]){
   const result=await setup({execute:async()=>{throw new BrokerFailure(kind);}})(req({}));assert.equal(result.status,status);assert.deepEqual(await result.json(),{error:kind});
   if(status===429)assert.equal(result.headers.get('retry-after'),'60');
  }
 });
 await t.test('HTTP cancellation does not detach database transaction settlement',async()=>{
  const settle=Promise.withResolvers();let returned=false;const handle=setup({execute:async()=>{await settle.promise;return {ok:true};}});
  const response=handle(req({operation:'register'})).then(r=>{returned=true;return r;});await new Promise(r=>setTimeout(r,10));assert.equal(returned,false);
  settle.resolve();assert.equal((await response).status,200);
 });
 await t.test('production database factory denies arbitrary URLs and enforces pinned narrow pool settings',async()=>{
  let config;const sql={begin:async fn=>fn({unsafe:async()=>[]}),end:async()=>{}};
  const factory=(url,options)=>{config={url,options};return sql;};
  const good=`postgresql://cv_control_broker_login.${PROJECT_REF}:${'q'.repeat(32)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`;
  for(const value of [good.replace('6543','5432'),good.replace(PROJECT_REF,'wrong'),good.replace('aws-0-ap-southeast-2.pooler.supabase.com','127.0.0.1'),good+'?sslmode=disable'])
   assert.throws(()=>createDatabase({postgres:factory,databaseUrl:value}));
  createDatabase({postgres:factory,databaseUrl:good});assert.equal(config.options.prepare,false);assert.equal(config.options.max,2);assert.equal(config.options.ssl.rejectUnauthorized,true);
 });
 await t.test('transaction timeout after settled COMMIT is unavailable, not assumed rollback',async()=>{
  let now=Date.now(),committed=false;
  const db=createTransactionAdapter({begin:async fn=>{const v=await fn({unsafe:async()=>[]});committed=true;now+=10001;return v;},end:async()=>{}},()=>now);
  await assert.rejects(db.transaction(async()=>({ok:true})),e=>e.kind==='unavailable');assert.equal(committed,true);
 });
});
