// Opt-in real Postgres.js/two-connection qualification on a disposable container.
// Never a hosted Auth fixture. Only an explicitly configured loopback port.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {initialState,renewPairing,pairingRequest,replacementRequest,recoveryRequest,PROJECT_REF}=require('../../services/controlPlane/protocol');
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
   await setup.unsafe('alter table auth.users add is_anonymous boolean default false,add banned_until timestamptz,add deleted_at timestamptz,add email text,add email_confirmed_at timestamptz; create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);');
   await setup.unsafe(read('../migrations/20261004161756_control_plane_foundation.sql'));
   await setup.unsafe(read('../broker/schema.sql'));
   await setup.unsafe(read('../broker/admission.sql'));
   await setup.unsafe(read('../broker/replacement.sql'));
   await setup.unsafe(read('../broker/restoration.sql'));
   await setup.unsafe(read('../broker/provisioning.sql'));
  }finally{setup.release();}
  await t.test('prepared dedicated login cannot connect until explicitly enabled',async()=>{
   const disabled=postgres({host:'127.0.0.1',port:Number(port),database:'postgres',username:'cv_control_broker_login',prepare:false,max:1,connect_timeout:3});
   try{await assert.rejects(disabled`select 1`,e=>e.code==='28000');}finally{await disabled.end({timeout:3});}
  });
  // Synthetic loopback trust fixture only, never a production password procedure.
  await admin.unsafe('alter role cv_control_broker_login login');
  client=postgres({host:'127.0.0.1',port:Number(port),database:'postgres',username:'cv_control_broker_login',prepare:false,max:2,connect_timeout:3,
   connection:{statement_timeout:'8000',lock_timeout:'2000',idle_in_transaction_session_timeout:'8000',transaction_timeout:'10000'}});
  const database=createTransactionAdapter(client);
  async function provisionFixture(){
   const owner=crypto.randomUUID(),instance=crypto.randomUUID();
   await admin`insert into auth.users(id,email,email_confirmed_at) values(${owner},'synthetic-owner@example.invalid',clock_timestamp())`;
   const provision=(user=owner)=>admin`select cinevault_private.cp_provision_installation(${PROJECT_REF},${user},${instance},'Owner') result`.then(r=>r[0].result);
   return {owner,instance,provision};
  }
  await t.test('concurrent initial provisioning commits one profile/binding and stable result',async()=>{
   const f=await provisionFixture(),answers=await Promise.all([f.provision(),f.provision()]);assert.deepEqual(answers[0],answers[1]);
   assert.equal((await admin`select count(*)::int n from public.profiles where id=${f.owner}`)[0].n,1);
   assert.equal((await admin`select count(*)::int n from cinevault_private.cp_installations where instance_id=${f.instance}`)[0].n,1);
   assert.equal((await admin`select count(*)::int n from public.servers where server_instance_id=${f.instance}`)[0].n,0);
  });
  await t.test('different owners racing the absent installation cannot both bind or leave losing profile',async()=>{
   const f=await provisionFixture(),other=crypto.randomUUID();await admin`insert into auth.users(id,email,email_confirmed_at) values(${other},'synthetic-other@example.invalid',clock_timestamp())`;
   const answers=await Promise.allSettled([f.provision(),f.provision(other)]);
   assert.equal(answers.filter(v=>v.status==='fulfilled').length,1);assert.equal(answers.filter(v=>v.status==='rejected'&&v.reason.code==='P0001').length,1);
   const winner=(await admin`select owner_id from cinevault_private.cp_installations where instance_id=${f.instance}`)[0].owner_id;
   assert.equal((await admin`select count(*)::int n from public.profiles where id in (${f.owner},${other})`)[0].n,1);
   assert.equal((await admin`select id from public.profiles where id in (${f.owner},${other})`)[0].id,winner);
  });
  async function provisionAfterMutation(f,lock,mutation){
   const locked=Promise.withResolvers(),release=Promise.withResolvers();
   const holding=admin.begin(async tx=>{await lock(tx);await mutation(tx);locked.resolve();await release.promise;});
   await locked.promise;let settled=false;const pending=f.provision().then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
   try{await new Promise(r=>setTimeout(r,100));assert.equal(settled,false);}finally{release.resolve();await holding;}
   return pending;
  }
  await t.test('first provisioning waiting on Auth lock sees committed owner ban and writes nothing',async()=>{
   const f=await provisionFixture(),result=await provisionAfterMutation(f,tx=>tx`select id from auth.users where id=${f.owner} for update`,
    tx=>tx`update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=${f.owner}`);
   assert.equal(result.error?.code,'42501');assert.equal((await admin`select count(*)::int n from public.profiles where id=${f.owner}`)[0].n,0);
   assert.equal((await admin`select count(*)::int n from cinevault_private.cp_installations where instance_id=${f.instance}`)[0].n,0);
  });
  await t.test('provision retry behind installation lock preserves committed disable instead of re-enabling',async()=>{
   const f=await provisionFixture();await f.provision();const result=await provisionAfterMutation(f,
    tx=>tx`select instance_id from cinevault_private.cp_installations where instance_id=${f.instance} for update`,
    tx=>tx`update cinevault_private.cp_installations set enabled=false where instance_id=${f.instance}`);
   assert.equal(result.error?.code,'P0001');assert.equal((await admin`select enabled from cinevault_private.cp_installations where instance_id=${f.instance}`)[0].enabled,false);
  });
  await t.test('operator transaction failure rolls both profile and installation back',async()=>{
   const f=await provisionFixture();await assert.rejects(admin.begin(async tx=>{
    await tx`select cinevault_private.cp_provision_installation(${PROJECT_REF},${f.owner},${f.instance},'Owner')`;
    throw Error('synthetic-operator-rollback');
   }),/synthetic-operator-rollback/);
   assert.equal((await admin`select count(*)::int n from public.profiles where id=${f.owner}`)[0].n,0);
   assert.equal((await admin`select count(*)::int n from cinevault_private.cp_installations where instance_id=${f.instance}`)[0].n,0);
  });
  await t.test('enabled dedicated login has no provisioning/direct table powers; SET ROLE reaches only broker allowlist',async()=>{
   const f=await provisionFixture();
   await assert.rejects(client`select cinevault_private.cp_provision_installation(${PROJECT_REF},${f.owner},${f.instance},'Owner')`,e=>e.code==='42501');
   await assert.rejects(client.unsafe('select * from public.profiles'),e=>e.code==='42501');
   await assert.rejects(client.begin(async tx=>{await tx.unsafe('set local role cv_control_broker');
    await tx`select cinevault_private.cp_provision_installation(${PROJECT_REF},${f.owner},${f.instance},'Owner')`;
   }),e=>e.code==='42501');
   assert.equal((await client`select current_user u`)[0].u,'cv_control_broker_login');
   assert.equal((await admin`select count(*)::int n from public.profiles where id=${f.owner}`)[0].n,0);
   // A missing installation is a valid false result, not a permission error.
   assert.equal(await database.transaction(tx=>tx.call('admit',['register',f.instance])),false);
  });
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
  async function renewalFixture(issued=true){
   const f=await fixture();await f.approve();const mapping=issued?await f.register():null;
   await admin`update cinevault_private.cp_pairings set expires_at=clock_timestamp()-interval '1 second' where instance_id=${f.state.serverInstanceId}`;
   const state=renewPairing({...f.state,expiresAt:Date.now()-1},Date.now()),setup=pairingRequest(state);
   const approve=()=>f.broker.execute({operation:'approve',...setup,confirmedInstanceId:state.serverInstanceId},null,'synthetic');
   const register=()=>f.broker.execute({operation:'register',request:setup.request,pollSecret:state.pollSecret},null,null);
   return {...f,renewed:state,setup,mapping,approveRenewal:approve,registerRenewal:register};
  }
  async function restoreFixture(){
   const f=await fixture();await f.approve();const mapping=await f.register();
   const state={version:3,status:'recovering',projectRef:PROJECT_REF,serverInstanceId:f.state.serverInstanceId,cloudServerId:mapping.cloudServerId,
    candidate:initialState(PROJECT_REF,f.state.serverInstanceId,Date.now())},setup=recoveryRequest(state);
   return {...f,mapping,recovery:state,setup,approveRestore:()=>f.broker.execute({operation:'approve-restore',...setup,confirmedInstanceId:state.serverInstanceId,confirmedCloudServerId:state.cloudServerId},null,'synthetic'),
    restore:()=>f.broker.execute({operation:'restore',request:setup.request,pollSecret:state.candidate.pollSecret},null,null)};
  }
  await t.test('concurrent owner restore redemptions increment actual epoch exactly once',async()=>{
   const f=await restoreFixture();await f.approveRestore();const replies=await Promise.all([f.restore(),f.restore()]);assert.deepEqual(replies[0],replies[1]);
   assert.equal(replies[0].cloudServerId,f.mapping.cloudServerId);assert.equal(replies[0].epoch,2);
   assert.equal((await admin`select count(*)::int n from public.servers where server_instance_id=${f.state.serverInstanceId}`)[0].n,1);
  });
  await t.test('restore behind committed owner-session deletion cannot issue new credential',async()=>{
   const f=await restoreFixture();await f.approveRestore();const result=await behindGuard(f,tx=>tx`delete from auth.sessions where id=${f.session}`,f.restore);
   assert.equal(result.error?.kind,'authorization');assert.equal((await admin`select epoch::int epoch from cinevault_private.cp_credentials where instance_id=${f.state.serverInstanceId}`)[0].epoch,1);
  });
  await t.test('restore grant cannot follow a credential change committed behind installation guard',async()=>{
   const f=await restoreFixture();await f.approveRestore();const id=crypto.randomUUID();
   const result=await behindGuard(f,tx=>tx`update cinevault_private.cp_credentials set id=${id},epoch=epoch+1 where instance_id=${f.state.serverInstanceId}`,f.restore);
   assert.equal(result.error?.kind,'conflict');assert.equal((await admin`select id from cinevault_private.cp_credentials where instance_id=${f.state.serverInstanceId}`)[0].id,id);
  });
  await t.test('concurrent different restore approvals freeze only one unconsumed grant',async()=>{
   const f=await restoreFixture(),different=recoveryRequest({...f.recovery,candidate:initialState(PROJECT_REF,f.state.serverInstanceId,Date.now())});
   const results=await Promise.allSettled([f.approveRestore(),f.broker.execute({operation:'approve-restore',...different,confirmedInstanceId:f.state.serverInstanceId,confirmedCloudServerId:f.mapping.cloudServerId},null,'synthetic')]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.kind==='conflict').length,1);
  });
  await t.test('concurrent initial grant renewal preserves one issued mapping/epoch/lifetime',async()=>{
   const f=await renewalFixture();const approvals=await Promise.all([f.approveRenewal(),f.approveRenewal()]);assert.deepEqual(approvals[0],approvals[1]);
   const replies=await Promise.all([f.registerRenewal(),f.registerRenewal()]);assert.deepEqual(replies[0],f.mapping);assert.deepEqual(replies[1],f.mapping);
   assert.equal((await admin`select count(*)::int n from public.servers where server_instance_id=${f.state.serverInstanceId}`)[0].n,1);
  });
  await t.test('different renewed initial challenges race: exactly one replaces the expired grant',async()=>{
   const f=await renewalFixture(false),different=pairingRequest(renewPairing({...f.state,expiresAt:Date.now()-1},Date.now()));
   const results=await Promise.allSettled([f.approveRenewal(),f.broker.execute({operation:'approve',...different,confirmedInstanceId:f.state.serverInstanceId},null,'synthetic')]);
   assert.equal(results.filter(v=>v.status==='fulfilled').length,1);assert.equal(results.filter(v=>v.status==='rejected'&&v.reason.kind==='conflict').length,1);
   assert.equal((await admin`select count(*)::int n from cinevault_private.cp_credentials where instance_id=${f.state.serverInstanceId}`)[0].n,0);
  });
  await t.test('initial renewal behind committed credential revocation cannot restore the grant',async()=>{
   const f=await renewalFixture();
   const result=await behindGuard(f,tx=>tx`update cinevault_private.cp_credentials set revoked=true where instance_id=${f.state.serverInstanceId}`,f.approveRenewal);
   assert.equal(result.error?.kind,'authorization');
   assert.equal((await admin`select request from cinevault_private.cp_pairings where instance_id=${f.state.serverInstanceId}`)[0].request.pairId,f.state.pairId);
  });
  await t.test('initial renewal behind committed owner session deletion fails closed',async()=>{
   const f=await renewalFixture();const result=await behindGuard(f,tx=>tx`delete from auth.sessions where id=${f.session}`,f.approveRenewal);
   assert.equal(result.error?.kind,'authorization');
  });
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
