// Opt-in real Postgres.js/two-connection qualification on a disposable container.
// Never a hosted Auth fixture. Only an explicitly configured loopback port.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {initialState,pairingRequest,replacementRequest,PROJECT_REF}=require('../../services/controlPlane/protocol');
const port=process.env.CV_QA_POSTGRES_PORT;
test('disposable Postgres17 real driver transactions and concurrency',{skip:!port,timeout:45000},async t=>{
 assert.match(port,/^[0-9]{4,5}$/);assert.ok(Number(port)>1024&&Number(port)<=65535);
 const postgres=(await import('../broker/node_modules/postgres/src/index.js')).default;
 const {createBroker}=await import('../broker/broker.mjs'),{createTransactionAdapter}=await import('../broker/database.mjs');
 const admin=postgres({host:'127.0.0.1',port:Number(port),database:'postgres',username:'postgres',prepare:false,max:3,connect_timeout:3,
  connection:{application_name:'cv-synthetic-broker-qa',statement_timeout:'8000',lock_timeout:'2000'}});
 let client;
 const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
 try {
  // Refuse an already initialized database rather than dropping/reusing it.
  assert.equal((await admin`select exists(select 1 from pg_namespace where nspname='cinevault_private') v`)[0].v,false);
  const setup=await admin.reserve();
  try {
   await setup.unsafe(read('bootstrap.sql'));
   await setup.unsafe('alter table auth.users add is_anonymous boolean default false,add banned_until timestamptz,add deleted_at timestamptz; create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);');
   await setup.unsafe(read('../migrations/20261004161756_control_plane_foundation.sql'));
   await setup.unsafe(read('../broker/schema.sql'));
   await setup.unsafe(read('../broker/admission.sql'));
   await setup.unsafe(read('../broker/replacement.sql'));
   await setup.unsafe('create role cv_qa_login login; grant cv_control_broker to cv_qa_login;');
  }finally{setup.release();}
  client=postgres({host:'127.0.0.1',port:Number(port),database:'postgres',username:'cv_qa_login',prepare:false,max:2,connect_timeout:3,
   connection:{statement_timeout:'8000',lock_timeout:'2000',idle_in_transaction_session_timeout:'8000',transaction_timeout:'10000'}});
  const database=createTransactionAdapter(client);
  async function fixture() {
   const owner=crypto.randomUUID(),session=crypto.randomUUID(),state=initialState(PROJECT_REF,crypto.randomUUID(),Date.now());
   const {request,approvalProof}=pairingRequest(state);
   await admin`insert into auth.users(id) values(${owner})`;
   await admin`insert into public.profiles(id) values(${owner})`;
   await admin`insert into auth.sessions(id,user_id) values(${session},${owner})`;
   await admin`insert into cinevault_private.cp_installations values(${state.serverInstanceId},${PROJECT_REF},${owner},true)`;
   const broker=createBroker({database,verifyOwner:async()=>({userId:owner,sessionId:session,expiresAt:Date.now()+60000}),admit:async()=>true});
   const approve=()=>broker.execute({operation:'approve',request,approvalProof,confirmedInstanceId:state.serverInstanceId},null,'synthetic');
   const register=()=>broker.execute({operation:'register',request,pollSecret:state.pollSecret},null,null);
   const body={operation:'heartbeat',projectRef:PROJECT_REF,serverInstanceId:state.serverInstanceId,credentialId:state.credentialId,
    epoch:1,sequence:1,idempotencyKey:crypto.randomUUID(),activity:'authenticated-request'};
   return {state,owner,session,request,broker,approve,register,body};
  }
  await t.test('simultaneous duplicate registration commits one mapping and exact reply',async()=>{
   const f=await fixture();await f.approve();const results=await Promise.all([f.register(),f.register()]);assert.deepEqual(results[0],results[1]);
   assert.equal((await admin`select count(*)::int n from public.servers where server_instance_id=${f.state.serverInstanceId}`)[0].n,1);
  });
  await t.test('two concurrent identical heartbeats commit one row and preserve received time',async()=>{
   const f=await fixture();await f.approve();await f.register();const results=await Promise.all([f.broker.execute(f.body,f.state.secret,null),f.broker.execute(f.body,f.state.secret,null)]);
   assert.deepEqual(results[0],results[1]);assert.equal((await admin`select count(*)::int n from cinevault_private.cp_heartbeats where credential_id=${f.state.credentialId}`)[0].n,1);
  });
  await t.test('callback failure settles rollback, no late credential or server insert',async()=>{
   const f=await fixture();await f.approve();const faulty={transaction:action=>database.transaction(async tx=>{await action(tx);throw Error('synthetic-after-write');})};
   const bad=createBroker({database:faulty,verifyOwner:async()=>{throw Error('unused')},admit:async()=>true});
   await assert.rejects(bad.execute({operation:'register',request:f.request,pollSecret:f.state.pollSecret},null,null),e=>e.kind==='unavailable');
   assert.equal((await admin`select count(*)::int n from public.servers where server_instance_id=${f.state.serverInstanceId}`)[0].n,0);
   assert.ok(await f.register());
  });
  await t.test('settled commit then lost reply is uncertain; same durable retry returns mapping',async()=>{
   const f=await fixture();await f.approve();const lost={transaction:async action=>{await database.transaction(action);throw Error('synthetic-lost-reply');}};
   const bad=createBroker({database:lost,verifyOwner:async()=>{throw Error('unused')},admit:async()=>true});
   await assert.rejects(bad.execute({operation:'register',request:f.request,pollSecret:f.state.pollSecret},null,null),e=>e.kind==='unavailable');
   const first=await f.register();assert.deepEqual(first,await f.register());
   assert.equal((await admin`select count(*)::int n from cinevault_private.cp_credentials where instance_id=${f.state.serverInstanceId}`)[0].n,1);
  });
  async function behindGuard(f,mutation,operation) {
   const locked=Promise.withResolvers(),release=Promise.withResolvers();
   const holding=admin.begin(async tx=>{await tx`select instance_id from cinevault_private.cp_installations where instance_id=${f.state.serverInstanceId} for update`;
    await mutation(tx);locked.resolve();await release.promise;});
   await locked.promise;let settled=false;const pending=operation().then(v=>({value:v}),error=>({error})).finally(()=>{settled=true;});
   try {await new Promise(r=>setTimeout(r,100));assert.equal(settled,false);}
   finally {release.resolve();await holding;}
   return pending;
  }
  async function replacementFixture(){
   const f=await fixture();await f.approve();const mapping=await f.register(),previous={...f.state,status:'active',mapping,sequence:0,pending:null};
   const state={version:2,status:'replacing',projectRef:PROJECT_REF,serverInstanceId:f.state.serverInstanceId,previous,candidate:initialState(PROJECT_REF,f.state.serverInstanceId,Date.now())};
   const setup=replacementRequest(state),approve=()=>f.broker.execute({operation:'approve-replacement',...setup,confirmedInstanceId:f.state.serverInstanceId},null,'synthetic');
   return {...f,replacement:state,setup,approveReplacement:approve,replace:()=>f.broker.execute({operation:'replace',request:setup.request,pollSecret:state.candidate.pollSecret},null,null)};
  }
  await t.test('concurrent replacement redemption commits exactly one new epoch and identical lifetime',async()=>{
   const f=await replacementFixture();await f.approveReplacement();const replies=await Promise.all([f.replace(),f.replace()]);assert.deepEqual(replies[0],replies[1]);
   assert.equal(replies[0].epoch,2);assert.equal((await admin`select epoch::int epoch from cinevault_private.cp_credentials where instance_id=${f.state.serverInstanceId}`)[0].epoch,2);
  });
  await t.test('replacement behind session revocation guard rolls back without new epoch',async()=>{
   const f=await replacementFixture();await f.approveReplacement();
   const result=await behindGuard(f,tx=>tx`delete from auth.sessions where id=${f.session}`,f.replace);assert.equal(result.error?.kind,'authorization');
   assert.equal((await admin`select epoch::int epoch from cinevault_private.cp_credentials where instance_id=${f.state.serverInstanceId}`)[0].epoch,1);
  });
  await t.test('replacement approval expiry committed behind guard blocks mutation after wait',async()=>{
   const f=await replacementFixture();await f.approveReplacement();
   const result=await behindGuard(f,tx=>tx`update cinevault_private.cp_replacements set jwt_expires_at=clock_timestamp()-interval '1 second' where instance_id=${f.state.serverInstanceId}`,f.replace);
   assert.equal(result.error?.kind,'authorization');assert.equal((await admin`select epoch::int epoch from cinevault_private.cp_credentials where instance_id=${f.state.serverInstanceId}`)[0].epoch,1);
  });
  await t.test('concurrent different candidate approvals cannot overwrite an unconsumed live grant',async()=>{
   const f=await replacementFixture(),different=replacementRequest({...f.replacement,candidate:initialState(PROJECT_REF,f.state.serverInstanceId,Date.now())});
   const replies=await Promise.allSettled([f.approveReplacement(),f.broker.execute({operation:'approve-replacement',...different,confirmedInstanceId:f.state.serverInstanceId},null,'synthetic')]);
   assert.equal(replies.filter(r=>r.status==='fulfilled').length,1);assert.equal(replies.filter(r=>r.status==='rejected'&&r.reason.kind==='conflict').length,1);
  });
  await t.test('profile revocation while registration waits denies cached mapping after lock release',async()=>{
   const f=await fixture();await f.approve();await f.register();
   const result=await behindGuard(f,tx=>tx`update public.profiles set blocked=true where id=${f.owner}`,f.register);
   assert.equal(result.error?.kind,'authorization');
  });
  await t.test('credential revocation while heartbeat waits denies before any report writes',async()=>{
   const f=await fixture();await f.approve();await f.register();
   const result=await behindGuard(f,tx=>tx`update cinevault_private.cp_credentials set revoked=true where id=${f.state.credentialId}`,
    ()=>f.broker.execute(f.body,f.state.secret,null));assert.equal(result.error?.kind,'authorization');
   assert.equal((await admin`select count(*)::int n from cinevault_private.cp_heartbeats where credential_id=${f.state.credentialId}`)[0].n,0);
  });
  await t.test('native Auth session deletion behind shared guard blocks cached registration',async()=>{
   const f=await fixture();await f.approve();await f.register();
   const result=await behindGuard(f,tx=>tx`delete from auth.sessions where id=${f.session}`,f.register);assert.equal(result.error?.kind,'authorization');
  });
  await t.test('unrelated installation is not blocked by another installation guard',async()=>{
   const f=await fixture(),g=await fixture();await f.approve();await g.approve();
   const locked=Promise.withResolvers(),release=Promise.withResolvers();
   const hold=admin.begin(async tx=>{await tx`select instance_id from cinevault_private.cp_installations where instance_id=${f.state.serverInstanceId} for update`;locked.resolve();await release.promise;});
   await locked.promise;try{assert.ok(await g.register());}finally{release.resolve();await hold;}
  });
  await t.test('narrow login cannot read tables or execute internal owner helper',async()=>{
   await assert.rejects(client.unsafe('select * from cinevault_private.cp_credentials'),e=>e.code==='42501');
   await assert.rejects(client.unsafe("select cinevault_private.cp_guard('00000000-0000-4000-8000-000000000001')"),e=>e.code==='42501');
  });
  await t.test('concurrent global admission counts exactly120 across separate driver connections',async()=>{
   const answers=await Promise.all(Array.from({length:126},()=>database.transaction(tx=>tx.call('admitRequest',[]))));
   assert.equal(answers.filter(v=>v===true).length,120);assert.equal(answers.filter(v=>v===false).length,6);
   assert.equal((await admin`select used from cinevault_private.cp_admission`)[0].used,120);
  });
  await t.test('concurrent same-installation admission cannot exceed its ten-request budget',async()=>{
   const f=await fixture();const answers=await Promise.all(Array.from({length:16},()=>database.transaction(tx=>tx.call('admit',['register',f.state.serverInstanceId]))));
   assert.equal(answers.filter(v=>v===true).length,10);assert.equal(answers.filter(v=>v===false).length,6);
   assert.equal((await admin`select admission_counts from cinevault_private.cp_installations where instance_id=${f.state.serverInstanceId}`)[0].admission_counts.register,10);
  });
 } finally {if(client)await client.end({timeout:3});await admin.end({timeout:3});}
});
