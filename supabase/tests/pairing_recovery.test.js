// Expiry is advanced only in synthetic fixture state; no hosted users or clocks.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const p=require('../../services/controlPlane/protocol'),{createCoordinator}=require('../../services/controlPlane/coordinator');
const {createTransport,CloudFailure}=require('../../services/controlPlane/transport');
const uuid=()=>crypto.randomUUID(),read=file=>fs.readFileSync(path.join(__dirname,file),'utf8');

function localFixture(){
 let time=Date.now(),saved=p.initialState(p.PROJECT_REF,uuid(),time);const instance=saved.serverInstanceId;
 const store={read:async()=>structuredClone(saved),writeAtomic:async next=>{
  p.validateState(next,p.PROJECT_REF,instance);p.validateTransition(saved,next);saved=structuredClone(next);
 }};
 let calls=0;const transport={redeem:async()=>{calls++;return null;}};
 const factory=()=>createCoordinator({config:{mode:'ready',projectRef:p.PROJECT_REF},serverInstanceId:instance,store,transport,now:()=>time});
 return {factory,store,transport,get:()=>structuredClone(saved),set:v=>{saved=structuredClone(v);},advance:n=>{time+=n;},calls:()=>calls};
}
test('expired initial challenge recovery preserves durable candidate, never resets automatically',async t=>{
 await t.test('prepare/redeem fail closed until explicit recovery; renewal keeps keys across restart',async()=>{
  const f=localFixture(),old=f.get(),c=f.factory();f.advance(p.PAIR_TTL);
  await assert.rejects(c.prepare());await assert.rejects(c.redeem());assert.deepEqual(f.get(),old);assert.equal(f.calls(),0);
  const setup=await c.recover(),renewed=f.get();
  for(const k of ['version','status','projectRef','serverInstanceId','credentialId','secret','pollSecret'])assert.equal(renewed[k],old[k]);
  for(const k of ['pairId','idempotencyKey','expiresAt'])assert.notEqual(renewed[k],old[k]);
  assert.deepEqual(setup.request,p.pairingRequest(renewed).request);assert.equal(f.calls(),0);
  assert(!JSON.stringify(setup).includes(renewed.secret));assert(!JSON.stringify(setup).includes(renewed.pollSecret));
  await c.stop();const next=f.factory();assert.deepEqual(await next.prepare(),setup);assert.deepEqual(await next.redeem(),{enrolled:false});await next.stop();
 });
 await t.test('unexpired challenge cannot be renewed or overwritten',async()=>{
  const f=localFixture(),c=f.factory(),old=f.get();await assert.rejects(c.recover());assert.deepEqual(f.get(),old);assert.equal(f.calls(),0);await c.stop();
 });
 await t.test('renewal cannot change keys, identity or status, or roll challenge expiry backwards',()=>{
  const old=p.initialState(p.PROJECT_REF,uuid(),Date.now()),next=p.renewPairing(old,old.expiresAt);
  assert.doesNotThrow(()=>p.validateTransition(old,next));
  for(const change of [{secret:'0'.repeat(64)},{pollSecret:'0'.repeat(64)},{credentialId:uuid()},
   {serverInstanceId:uuid()},{expiresAt:old.expiresAt},{pairId:old.pairId},{idempotencyKey:old.idempotencyKey}])
   assert.throws(()=>p.validateTransition(old,{...next,...change}));
  for(const clock of [old.expiresAt-1,NaN,Number.MAX_SAFE_INTEGER])assert.throws(()=>p.renewPairing(old,clock));
 });
 await t.test('failed durable write exposes no proof and retains original state',async()=>{
  const f=localFixture(),c=f.factory(),old=f.get();f.advance(p.PAIR_TTL);f.store.writeAtomic=async()=>{throw Error('synthetic failure');};
  await assert.rejects(c.recover());assert.deepEqual(f.get(),old);assert.equal(f.calls(),0);await c.stop();
 });
 await t.test('shutdown during renewal persistence exposes no proof and sends no request',async()=>{
  const f=localFixture(),c=f.factory();f.advance(p.PAIR_TTL);const write=f.store.writeAtomic;let resume;
  f.store.writeAtomic=async v=>{await write(v);await new Promise(r=>{resume=r;});};
  const denied=assert.rejects(c.recover());await new Promise(r=>setImmediate(r));const stopped=c.stop();resume();await denied;await stopped;
  assert.equal(f.calls(),0);assert.equal(f.get().status,'pairing');
 });
});

test('initial renewal production broker and private PostgreSQL/WASM boundary',async t=>{
 const db=await PGlite.create(),owner=uuid(),session=uuid(),foreign=uuid(),origin='https://approval-qa.pages.dev';let serial=0;
 try {
  const {createBroker,createHandler}=await import('../broker/broker.mjs');
  await db.exec(read('bootstrap.sql'));
  await db.exec('alter table auth.users add is_anonymous boolean default false,add banned_until timestamptz,add deleted_at timestamptz; create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);');
  for(const file of ['../migrations/20261004161756_control_plane_foundation.sql','../broker/schema.sql','../broker/admission.sql','../broker/replacement.sql'])await db.exec(read(file));
  for(const id of [owner,foreign]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into public.profiles(id) values($1)',[id]);}
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
  const queries={approve:'cp_approve($1,$2,$3,$4,$5,$6)',register:'cp_register($1,$2,$3,$4)'};
  const database={transaction:async fn=>{const sp='q'+(++serial);await db.exec('savepoint '+sp+';set local role cv_control_broker');
   try{const result=await fn({call:async(op,args)=>(await db.query('select cinevault_private.'+queries[op]+' result',args.map(v=>v instanceof Uint8Array?Buffer.from(v):v))).rows[0].result});await db.exec('reset role;release savepoint '+sp);return result;}
   catch(error){await db.exec('rollback to savepoint '+sp+';release savepoint '+sp);throw error;}}};
  const broker=createBroker({database,verifyOwner:async token=>({userId:token==='foreign'?foreign:owner,sessionId:session,expiresAt:Date.now()+60000}),admit:async()=>true});
  const handler=createHandler({broker,approvedOrigin:origin,admitRequest:async()=>true});
  const check=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{
   const state=p.initialState(p.PROJECT_REF,uuid(),Date.now()),initial=p.pairingRequest(state);
   await db.query('insert into cinevault_private.cp_installations values($1,$2,$3,true)',[state.serverInstanceId,p.PROJECT_REF,owner]);
   const approve=(setup,token='owner')=>broker.execute({operation:'approve',...setup,confirmedInstanceId:state.serverInstanceId},null,token);
   const register=(candidate,setup)=>broker.execute({operation:'register',request:setup.request,pollSecret:candidate.pollSecret},null,null);
   await approve(initial);
   // Trusted fixture seam: only the stored challenge deadline is made past.
   // Candidate identity/keys and actual approval authority remain unchanged.
   const expired={...state,expiresAt:Date.now()-1};
   const expire=()=>db.query("update cinevault_private.cp_pairings set expires_at=clock_timestamp()-interval '1 second' where instance_id=$1",[state.serverInstanceId]);
   const renewed=p.renewPairing(expired,Date.now()),setup=p.pairingRequest(renewed);
   await fn({state,initial,expired,renewed,setup,expire,approve,register});
  }finally{await db.exec('rollback');}});
  await check('unissued expiry requires fresh approval, then creates only one server and one credential',async f=>{
   await f.expire();await assert.rejects(f.register(f.renewed,f.setup));await f.approve(f.setup);
   const a=await f.register(f.renewed,f.setup);assert.deepEqual(await f.register(f.renewed,f.setup),a);assert.equal(a.epoch,1);
   assert.equal((await db.query('select count(*)::int n from public.servers')).rows[0].n,1);
   assert.equal((await db.query('select count(*)::int n from cinevault_private.cp_credentials')).rows[0].n,1);
   for(const table of ['public.server_users','public.server_endpoints'])assert.equal((await db.query('select count(*)::int n from '+table)).rows[0].n,0);
  });
  await check('uncertain committed registration reconciles same mapping/epoch/lifetime through coordinator HTTP composition',async f=>{
   const mapping=await f.register(f.state,f.initial);await f.expire();let saved=f.expired;
   const store={read:async()=>structuredClone(saved),writeAtomic:async next=>{p.validateTransition(saved,next);saved=structuredClone(next);}};
   let drop=true;
   const config={mode:'ready',projectRef:p.PROJECT_REF,brokerUrl:'https://qa.invalid/functions/v1/cinevault-control-plane',publishableKey:'synthetic-public'};
   const transport=createTransport({config,fetchImpl:async(url,opts)=>{const response=await handler(new Request(url,opts));if(drop&&response.status===200){drop=false;throw new CloudFailure('unavailable');}return response;}});
   const factory=()=>createCoordinator({config,serverInstanceId:f.state.serverInstanceId,store,transport});
   const c=factory(),setup=await c.recover();await f.approve({request:setup.request,approvalProof:setup.approvalProof});
   await assert.rejects(c.redeem());assert.equal(saved.status,'pairing');await c.stop();const restart=factory();
   assert.deepEqual(await restart.redeem(),{enrolled:true});assert.deepEqual(saved.mapping,mapping);assert.equal(saved.secret,f.state.secret);await restart.stop();
  });
  await check('live different grant, changed candidate keys and foreign owner cannot renew',async f=>{
   await assert.rejects(f.approve(f.setup));await f.expire();await assert.rejects(f.approve(f.setup,'foreign'));
   for(const change of [{credentialId:uuid()},{secret:crypto.randomBytes(32).toString('hex')},{pollSecret:crypto.randomBytes(32).toString('hex')}])
    await assert.rejects(f.approve(p.pairingRequest({...f.renewed,...change})));
   assert.deepEqual((await db.query('select request from cinevault_private.cp_pairings')).rows[0].request,f.initial.request);
  });
  for(const mutation of ["update cinevault_private.cp_credentials set revoked=true",
   "update cinevault_private.cp_credentials set expires_at=clock_timestamp()-interval '1 second'",
   'update cinevault_private.cp_credentials set epoch=2'])await check('issued revoked/expired/superseded candidate is not revived: '+mutation,async f=>{
   await f.register(f.state,f.initial);await f.expire();await db.exec(mutation);await assert.rejects(f.approve(f.setup));
   assert.deepEqual((await db.query('select request from cinevault_private.cp_pairings')).rows[0].request,f.initial.request);
  });
  for(const mutation of ['delete from auth.sessions','update public.profiles set blocked=true','update cinevault_private.cp_installations set enabled=false',
   'update cinevault_private.cp_pairings set enabled=false'])await check('current authority or disabled grant denies renewal: '+mutation,async f=>{
   await f.expire();await db.exec(mutation);await assert.rejects(f.approve(f.setup));
  });
  await check('fresh current owner session may renew, but older request and old approval no longer redeem',async f=>{
   const next=uuid();await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[next,owner]);await f.expire();
   const b=p.bindingDigest(f.setup.request),proof=p.digest(f.setup.approvalProof);
   await database.transaction(tx=>tx.call('approve',[owner,next,new Date(Date.now()+60000).toISOString(),f.setup.request,Buffer.from(b,'hex'),Buffer.from(proof,'hex')]));
   await assert.rejects(f.register(f.state,f.initial));await assert.rejects(f.approve(f.initial));assert.equal((await f.register(f.renewed,f.setup)).epoch,1);
  });
 }finally{await db.close();}
});
