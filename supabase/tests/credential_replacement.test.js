// Production coordinator/transport/HTTP/broker + real PostgreSQL/WASM.
// Synthetic Auth and savepoint transport, NOT hosted/provider qualification.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const p=require('../../services/controlPlane/protocol'),{createCoordinator}=require('../../services/controlPlane/coordinator'),{createTransport,CloudFailure}=require('../../services/controlPlane/transport');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8'),uuid=()=>crypto.randomUUID();
function localFixture(transport={}){
 let time=Date.now(),saved;const instance=uuid(),pair=p.initialState(p.PROJECT_REF,instance,time);
 saved={...pair,status:'active',mapping:{projectRef:p.PROJECT_REF,serverInstanceId:instance,credentialId:pair.credentialId,
  cloudServerId:uuid(),epoch:1,credentialExpiresAt:time+86400000},sequence:0,pending:null};
 const store={read:async()=>structuredClone(saved),writeAtomic:async next=>{p.validateState(next,p.PROJECT_REF,instance);p.validateTransition(saved,next);saved=structuredClone(next);}};
 let calls=0;const tasks=[];const api={heartbeat:async()=>{calls++;},replace:async()=>null,...transport};
 const factory=()=>createCoordinator({config:{mode:'ready',projectRef:p.PROJECT_REF},serverInstanceId:instance,store,transport:api,
  now:()=>time,schedule:fn=>{const t={fn};tasks.push(t);return t;},cancel:t=>{t.cancelled=true;}});
 return{store,api,factory,instance,tasks,get:()=>structuredClone(saved),set:v=>{saved=structuredClone(v);},advance:n=>{time+=n;},calls:()=>calls};
}
test('replacement local state and crash/retry boundaries',async t=>{
 await t.test('explicit recovery persists candidate before returning proof and stops old work',async()=>{
  const f=localFixture(),c=f.factory(),old=f.get();c.noteActivity();const setup=await c.recover(),state=f.get();
  assert.equal(state.status,'replacing');assert.deepEqual(state.previous,old);assert(f.tasks[0].cancelled);
  assert.equal(setup.request.replacement.cloudServerId,old.mapping.cloudServerId);assert(!JSON.stringify(setup).includes(state.candidate.secret));
  assert.equal(f.calls(),0);await c.retry();assert.equal(f.calls(),0);await c.stop();
 });
 await t.test('restart and lost reply reuse exact candidate; no heartbeat runs during replacement',async()=>{
  const f=localFixture(),c=f.factory();await c.recover();const before=f.get();await c.stop();const restarted=f.factory();
  let attempts=[];f.api.replace=async(request,poll)=>{attempts.push({request,poll});throw new CloudFailure('unavailable');};
  await assert.rejects(restarted.redeem());await assert.rejects(restarted.redeem());assert.deepEqual(attempts[0],attempts[1]);assert.deepEqual(f.get(),before);
  await restarted.retry();assert.equal(f.calls(),0);await restarted.stop();
 });
 await t.test('expired uncertain candidate renewal retains both credentials and old mapping',async()=>{
  const f=localFixture(),c=f.factory();await c.recover();const before=f.get();f.advance(300001);
  await assert.rejects(c.prepare());const renewed=await c.recover(),after=f.get();assert.deepEqual(after.previous,before.previous);
  for(const key of ['credentialId','secret','pollSecret'])assert.equal(after.candidate[key],before.candidate[key]);
  assert.notEqual(renewed.request.pairId,before.candidate.pairId);assert(after.candidate.expiresAt>before.candidate.expiresAt);await c.stop();
 });
 await t.test('matching promotion preserves cloud identity, advances epoch and resets sequence only',async()=>{
  const f=localFixture(),c=f.factory(),old=f.get();await c.recover();const candidate=f.get().candidate;
  f.api.replace=async()=>({...old.mapping,credentialId:candidate.credentialId,epoch:2});
  assert.deepEqual(await c.redeem(),{enrolled:true});assert.equal(f.get().credentialId,candidate.credentialId);
  assert.equal(f.get().mapping.cloudServerId,old.mapping.cloudServerId);assert.equal(f.get().sequence,0);assert.equal(f.get().pending,null);await c.stop();
 });
 await t.test('foreign mapping, skipped epoch or old credential cannot promote saved state',async()=>{
  for(const change of [{cloudServerId:uuid()},{epoch:3},{credentialId:uuid()}]){
   const f=localFixture(),c=f.factory();await c.recover();const before=f.get();
   f.api.replace=async()=>({...before.previous.mapping,credentialId:before.candidate.credentialId,epoch:2,...change});
   await assert.rejects(c.redeem());assert.deepEqual(f.get(),before);await c.stop();
  }
 });
 await t.test('missing/corrupt/unmapped state never creates a replacement or resets identity',async()=>{
  for(const state of [null,{},p.initialState(p.PROJECT_REF,uuid(),Date.now())]){
   const f=localFixture(),c=f.factory();f.set(state);await assert.rejects(c.recover());assert.deepEqual(f.get(),state);await c.stop();
  }
 });
 await t.test('candidate/previous mutation and direct credential reset remain denied',async()=>{
  const f=localFixture(),c=f.factory(),old=f.get();await c.recover();const pending=f.get();
  for(const changed of [{...pending,previous:{...old,secret:'0'.repeat(64)}},
   {...pending,candidate:{...pending.candidate,secret:'0'.repeat(64)}}])assert.throws(()=>p.validateTransition(pending,changed));
  assert.throws(()=>p.validateTransition(old,{...old,secret:'0'.repeat(64)}));await c.stop();
 });
 await t.test('shutdown during candidate persistence returns no proof and transport never starts',async()=>{
  const f=localFixture(),c=f.factory(),write=f.store.writeAtomic;let resume;
  f.store.writeAtomic=async next=>{await write(next);await new Promise(r=>{resume=r;});};
  const denied=assert.rejects(c.recover());await new Promise(r=>setImmediate(r));const stopped=c.stop();resume();await denied;await stopped;
  assert.equal(f.get().status,'replacing');assert.equal(f.calls(),0);
 });
 await t.test('failed local acknowledgment persistence leaves candidate for exact retry',async()=>{
  const f=localFixture(),c=f.factory();await c.recover();const pending=f.get(),write=f.store.writeAtomic;
  f.api.replace=async()=>({...pending.previous.mapping,credentialId:pending.candidate.credentialId,epoch:2});
  f.store.writeAtomic=async()=>{throw Error('synthetic persistence unavailable');};
  await assert.rejects(c.redeem());assert.deepEqual(f.get(),pending);f.store.writeAtomic=write;
  assert.deepEqual(await c.redeem(),{enrolled:true});assert.equal(f.get().credentialId,pending.candidate.credentialId);await c.stop();
 });
});

test('prepared replacement SQL, broker and full PC flow',async t=>{
 const db=await PGlite.create(),owner=uuid(),session=uuid(),other=uuid(),origin='https://replacement-qa.pages.dev';
 const {createBroker,createHandler}=await import('../broker/broker.mjs');let serial=0;
 try{
  await db.exec(read('bootstrap.sql'));
  await db.exec('alter table auth.users add is_anonymous boolean default false,add banned_until timestamptz,add deleted_at timestamptz; create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);');
  await db.exec(read('../migrations/20261004161756_control_plane_foundation.sql'));await db.exec(read('../broker/schema.sql'));await db.exec(read('../broker/admission.sql'));await db.exec(read('../broker/replacement.sql'));
  for(const id of [owner,other]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into public.profiles(id) values($1)',[id]);}
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
  const queries={approve:'cp_approve($1,$2,$3,$4,$5,$6)',register:'cp_register($1,$2,$3,$4)',replaceApprove:'cp_replace_approve($1,$2,$3,$4,$5,$6)',replace:'cp_replace($1,$2,$3,$4)',verifier:'cp_verifier($1)',heartbeat:'cp_heartbeat($1,$2,$3)'};
  const database={transaction:async fn=>{const point='r'+(++serial);await db.exec('savepoint '+point+';set local role cv_control_broker');
   try{const value=await fn({call:async(op,args)=>(await db.query('select cinevault_private.'+queries[op]+' result',args.map(v=>v instanceof Uint8Array?Buffer.from(v):v))).rows[0].result});await db.exec('reset role;release savepoint '+point);return value;}
   catch(e){await db.exec('rollback to savepoint '+point+';release savepoint '+point);throw e;}}};
  const broker=createBroker({database,verifyOwner:async token=>({userId:token==='other'?other:owner,sessionId:session,expiresAt:Date.now()+60000}),admit:async()=>true});
  const handler=createHandler({broker,approvedOrigin:origin,admitRequest:async()=>true});
  const check=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{
   const pair=p.initialState(p.PROJECT_REF,uuid(),Date.now()),setup=p.pairingRequest(pair);
   await db.query('insert into cinevault_private.cp_installations(instance_id,project_ref,owner_id) values($1,$2,$3)',[pair.serverInstanceId,p.PROJECT_REF,owner]);
   await broker.execute({operation:'approve',...setup,confirmedInstanceId:pair.serverInstanceId},null,'owner');
   const mapping=await broker.execute({operation:'register',request:setup.request,pollSecret:pair.pollSecret},null,null);
   const active={...pair,status:'active',mapping,sequence:0,pending:null},candidate=p.initialState(p.PROJECT_REF,pair.serverInstanceId,Date.now());
   const state={version:2,status:'replacing',projectRef:p.PROJECT_REF,serverInstanceId:pair.serverInstanceId,previous:active,candidate},replacement=p.replacementRequest(state);
   const approve=(token='owner',r=replacement)=>broker.execute({operation:'approve-replacement',...r,confirmedInstanceId:pair.serverInstanceId},null,token);
   const redeem=(r=replacement)=>broker.execute({operation:'replace',request:r.request,pollSecret:candidate.pollSecret},null,null);
   await fn({active,state,replacement,approve,redeem,candidate});
  }finally{await db.exec('rollback');}});
  await check('end-to-end coordinator -> transport -> HTTP -> broker -> SQL; retained candidate survives lost reply',async f=>{
   let saved=f.active,drop=true;const store={read:async()=>structuredClone(saved),writeAtomic:async v=>{p.validateState(v,p.PROJECT_REF,f.active.serverInstanceId);p.validateTransition(saved,v);saved=structuredClone(v);}};
   const config={mode:'ready',projectRef:p.PROJECT_REF,brokerUrl:'https://qa.invalid/functions/v1/cinevault-control-plane',publishableKey:'synthetic-public'};
   const transport=createTransport({config,fetchImpl:async(url,options)=>{const result=await handler(new Request(url,options));if(drop&&result.status===200){drop=false;throw Error('synthetic discarded reply');}return result;}});
   const factory=()=>createCoordinator({config,serverInstanceId:f.active.serverInstanceId,store,transport});
   const c=factory(),setup=await c.recover();await broker.execute({operation:'approve-replacement',request:setup.request,approvalProof:setup.approvalProof,confirmedInstanceId:f.active.serverInstanceId},null,'owner');
   await assert.rejects(c.redeem());assert.equal(saved.status,'replacing');const secret=saved.candidate.secret;await c.stop();const restart=factory();
   assert.deepEqual(await restart.redeem(),{enrolled:true});assert.equal(saved.secret,secret);assert.equal(saved.mapping.cloudServerId,f.active.mapping.cloudServerId);assert.equal(saved.mapping.epoch,2);await restart.stop();
  });
  await check('duplicate redemption returns exact mapping and lifetime, rejects old heartbeat and original enrollment',async f=>{
   await f.approve();const a=await f.redeem();assert.deepEqual(await f.redeem(),a);assert.equal(a.epoch,2);assert.equal(a.cloudServerId,f.active.mapping.cloudServerId);
   await assert.rejects(broker.execute({operation:'heartbeat',projectRef:p.PROJECT_REF,serverInstanceId:f.active.serverInstanceId,credentialId:f.active.credentialId,epoch:1,sequence:1,idempotencyKey:uuid(),activity:'startup'},f.active.secret,null));
   await assert.rejects(broker.execute({operation:'register',request:p.pairingRequest(f.active).request,pollSecret:f.active.pollSecret},null,null));
   assert.equal((await db.query('select count(*)::int n from public.servers')).rows[0].n,1);
  });
  for(const mutation of ["update cinevault_private.cp_credentials set revoked=true","update cinevault_private.cp_credentials set expires_at=clock_timestamp()-interval '1 second'"])
   await check('fresh owner may replace old expired/revoked credential: '+mutation,async f=>{await db.exec(mutation);await f.approve();assert.equal((await f.redeem()).epoch,2);});
  await check('foreign owner/changed mapping/epoch/secret reject without mutation',async f=>{
   await assert.rejects(f.approve('other'));
   for(const change of [{cloudServerId:uuid()},{epoch:2},{credentialId:uuid()}]){
    const r={...f.replacement,request:{...f.replacement.request,replacement:{...f.replacement.request.replacement,...change}}};
    await assert.rejects(f.approve('owner',r));await assert.rejects(f.redeem(r));
   }
   assert.equal((await db.query('select epoch from cinevault_private.cp_credentials')).rows[0].epoch,1);
  });
  for(const mutation of ['delete from auth.sessions','update public.profiles set blocked=true','update public.profiles set must_change_password=true','update cinevault_private.cp_installations set enabled=false'])
   await check('approved redemption rechecks current authority: '+mutation,async f=>{await f.approve();await db.exec(mutation);await assert.rejects(f.redeem());assert.equal((await db.query('select epoch from cinevault_private.cp_credentials')).rows[0].epoch,1);});
  await check('revocation cancels pending replacement; old approval cannot revive it',async f=>{
   await f.approve();await db.query('select cinevault_private.cp_revoke($1,$2,$3,$4)',[f.active.serverInstanceId,owner,session,new Date(Date.now()+60000)]);
   await assert.rejects(f.redeem());await f.approve();assert.equal((await f.redeem()).epoch,2);
  });
  await check('expired lost-response receipt needs fresh owner approval, same candidate and no second epoch/lifetime',async f=>{
   await f.approve();const first=await f.redeem();await db.exec("update cinevault_private.cp_replacements set expires_at=clock_timestamp()-interval '1 second'");
   await assert.rejects(f.redeem());const renewed={...f.state,candidate:{...f.candidate,pairId:uuid(),idempotencyKey:uuid(),expiresAt:Date.now()+300000}},r=p.replacementRequest(renewed);
   await f.approve('owner',r);assert.deepEqual(await f.redeem(r),first);assert.equal((await db.query('select count(*)::int n from cinevault_private.cp_replacements')).rows[0].n,1);
  });
  await check('already-issued revoked candidate is not revived by replay/new receipt',async f=>{
   await f.approve();await f.redeem();await db.exec('update cinevault_private.cp_credentials set revoked=true');await assert.rejects(f.redeem());await assert.rejects(f.approve());
  });
  await check('callbacks roll back replacement writes when reply is not committed',async f=>{
   await f.approve();const failing=createBroker({database:{transaction:fn=>database.transaction(async tx=>{await fn(tx);throw Error('synthetic callback failure');})},verifyOwner:async()=>null,admit:async()=>true});
   await assert.rejects(failing.execute({operation:'replace',request:f.replacement.request,pollSecret:f.candidate.pollSecret},null,null));
   assert.equal((await db.query('select epoch from cinevault_private.cp_credentials')).rows[0].epoch,1);assert.equal((await f.redeem()).epoch,2);
  });
  await check('owner expiry during actual credential UPDATE rolls back every replacement write',async f=>{
   await f.approve();
   await db.exec("create sequence pg_temp.replacement_write_attempt; create function pg_temp.delay_replacement() returns trigger language plpgsql as $$ begin perform nextval('pg_temp.replacement_write_attempt'); perform pg_sleep(0.2); return new; end; $$; create trigger delay_replacement before update on cinevault_private.cp_credentials for each row execute function pg_temp.delay_replacement();");
   await db.exec("update cinevault_private.cp_replacements set jwt_expires_at=clock_timestamp()+interval '120 milliseconds'");
   await assert.rejects(f.redeem(),e=>e.kind==='authorization');
   const attempted=(await db.query('select last_value,is_called from pg_temp.replacement_write_attempt')).rows[0];
   assert.equal(Number(attempted.last_value),1);assert.equal(attempted.is_called,true);
   assert.equal((await db.query('select epoch from cinevault_private.cp_credentials')).rows[0].epoch,1);
   assert.equal((await db.query('select result from cinevault_private.cp_replacements')).rows[0].result,null);
  });
  await check('RLS/EXECUTE-only grants and helper denial protect replacement table',async()=>{
   assert.equal((await db.query("select relrowsecurity v from pg_class where oid='cinevault_private.cp_replacements'::regclass")).rows[0].v,true);
   for(const role of ['anon','authenticated','service_role','cv_control_broker']){
    assert.equal((await db.query("select has_table_privilege($1,'cinevault_private.cp_replacements','SELECT') v",[role])).rows[0].v,false);
    assert.equal((await db.query("select has_function_privilege($1,'cinevault_private.cp_replace(jsonb,bytea,bytea,bytea)','EXECUTE') v",[role])).rows[0].v,role==='cv_control_broker');
    assert.equal((await db.query("select has_function_privilege($1,'cinevault_private.cp_replacement_current(jsonb,uuid)','EXECUTE') v",[role])).rows[0].v,false);
   }
  });
  await check('owner-only HTTP approval requires exact allowed origin; operational credential cannot approve',async f=>{
   const body={operation:'approve-replacement',...f.replacement,confirmedInstanceId:f.active.serverInstanceId};
   const req=headers=>new Request('https://qa.invalid/functions/v1/cinevault-control-plane',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer owner',...headers},body:JSON.stringify(body)});
   assert.equal((await handler(req({}))).status,403);assert.equal((await handler(req({origin:'https://foreign.invalid'}))).status,403);
   assert.equal((await handler(req({origin,'x-cinevault-credential':f.active.secret}))).status,403);assert.equal((await handler(req({origin}))).status,200);
  });
 }finally{await db.close();}
});
