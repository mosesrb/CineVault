// Synthetic identities + real PostgreSQL/WASM. Not hosted Auth/pool qualification.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {initialState,pairingRequest,PROJECT_REF}=require('../../services/controlPlane/protocol');
const modulePromise=import('../broker/broker.mjs');
const uuid=()=>crypto.randomUUID(),owner=uuid(),session=uuid();
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
async function fixture() {
 const db=await PGlite.create();
 try {
  await db.exec(read('bootstrap.sql'));
  await db.exec(`alter table auth.users add is_anonymous boolean default false,add banned_until timestamptz,add deleted_at timestamptz;
    create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);`);
  await db.exec(read('../migrations/20261004161756_control_plane_foundation.sql'));
  await db.exec(read('../broker/schema.sql'));
  await db.query('insert into auth.users(id) values($1)',[owner]);
  await db.query('insert into public.profiles(id) values($1)',[owner]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
  const state=initialState(PROJECT_REF,uuid(),Date.now()),{request,approvalProof}=pairingRequest(state);
  await db.query('insert into cinevault_private.cp_installations values($1,$2,$3,true)',[state.serverInstanceId,PROJECT_REF,owner]);
  const call=async(operation,args)=>{
   const queries={approve:'cp_approve($1,$2,$3,$4,$5,$6)',register:'cp_register($1,$2,$3,$4)',verifier:'cp_verifier($1)',heartbeat:'cp_heartbeat($1,$2,$3)'};
   const result=await db.query('select cinevault_private.'+queries[operation]+' as result',args.map(v=>v instanceof Uint8Array?Buffer.from(v):v));
   return result.rows[0].result;
  };
  // PGlite cases own an outer rollback transaction. Savepoints isolate broker
  // calls without recursively acquiring PGlite's transaction mutex. The actual
  // Postgres.js BEGIN/COMMIT/rollback adapter is tested on Docker separately.
  const database={transaction:async action=>{
   await db.exec('savepoint broker_call; set local role cv_control_broker');
   try {const value=await action({call});await db.exec('reset role; release savepoint broker_call');return value;}
   catch(error){await db.exec('rollback to savepoint broker_call; release savepoint broker_call');throw error;}
  }};
  const {createBroker}=await modulePromise;
  const broker=createBroker({database,verifyOwner:async token=>{
   assert.equal(token,'synthetic-owner-token');return {userId:owner,sessionId:session,expiresAt:Date.now()+60000};
  },admit:async()=>true});
  const approve=()=>broker.execute({operation:'approve',request,approvalProof,confirmedInstanceId:state.serverInstanceId},null,'synthetic-owner-token');
  const register=()=>broker.execute({operation:'register',request,pollSecret:state.pollSecret},null,null);
  const heartbeat=(key=uuid(),sequence=1)=>({operation:'heartbeat',idempotencyKey:key,sequence,activity:'authenticated-request',
   projectRef:PROJECT_REF,serverInstanceId:state.serverInstanceId,credentialId:state.credentialId,epoch:1});
  return {db,database,state,request,approvalProof,broker,approve,register,heartbeat};
 }catch(error){await db.close();throw error}
}
test('prepared hosted private SQL + broker contract',async t=>{
 const f=await fixture(),{db}=f;
 const check=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}});
 try {
  await check('approve and duplicate registration match PC mapping exactly; no membership or endpoint is granted',async()=>{
   assert.equal(await f.register(),null);await f.approve();const first=await f.register(),retry=await f.register();assert.deepEqual(first,retry);
   assert.equal(first.projectRef,PROJECT_REF);assert.equal(first.serverInstanceId,f.state.serverInstanceId);assert.equal(first.credentialId,f.state.credentialId);
   assert.equal(Object.keys(first).length,6);assert.ok(first.credentialExpiresAt>Date.now());
   assert.equal((await db.query('select count(*)::int n from public.server_users')).rows[0].n,0);
   assert.equal((await db.query('select count(*)::int n from public.server_endpoints')).rows[0].n,0);
  });
  await check('exact heartbeat lost-response replay retains acknowledgment/time; does not declare ONLINE',async()=>{
   await f.approve();await f.register();const body=f.heartbeat();
   const first=await f.broker.execute(body,f.state.secret,null),retry=await f.broker.execute(body,f.state.secret,null);assert.deepEqual(first,retry);
   const row=(await db.query('select status,last_heartbeat_at from public.servers')).rows[0];assert.equal(row.status,'OFFLINE');
   assert.equal(new Date(row.last_heartbeat_at).getTime(),new Date(first.receivedAt).getTime());
  });
  await check('same-key changed body and jumped sequence deny without advancing state',async()=>{
   await f.approve();await f.register();const body=f.heartbeat();await f.broker.execute(body,f.state.secret,null);
   await assert.rejects(f.broker.execute({...body,activity:'media-work'},f.state.secret,null),e=>e.kind==='conflict');
   await assert.rejects(f.broker.execute(f.heartbeat(uuid(),3),f.state.secret,null),e=>e.kind==='conflict');
   assert.equal((await db.query('select sequence from cinevault_private.cp_credentials')).rows[0].sequence,1);
  });
  await check('new report is limited to one/minute; exact duplicate is not a keepalive',async()=>{
   await f.approve();await f.register();const body=f.heartbeat();await f.broker.execute(body,f.state.secret,null);
   await assert.rejects(f.broker.execute(f.heartbeat(uuid(),2),f.state.secret,null),e=>e.kind==='rate_limited');
   assert.equal((await db.query('select count(*)::int n from cinevault_private.cp_heartbeats')).rows[0].n,1);
  });
  await check('changed registration fields cannot reuse an approval proof/poll capability',async()=>{
   await f.approve();for(const changed of [{...f.request,credentialId:uuid()},{...f.request,secretDigest:'a'.repeat(64)},
    {...f.request,serverInstanceId:uuid()},{...f.request,idempotencyKey:uuid()}]){
    await assert.rejects(f.broker.execute({operation:'register',request:changed,pollSecret:f.state.pollSecret},null,null),e=>e.kind==='authorization');
   }
   assert.equal((await db.query('select count(*)::int n from public.servers')).rows[0].n,0);
  });
  for(const mutation of ["update public.profiles set blocked=true","update public.profiles set must_change_password=true",
   "delete from auth.sessions","update auth.users set is_anonymous=true","update auth.users set banned_until=clock_timestamp()+interval '1 day'",
   "update cinevault_private.cp_installations set enabled=false"])
   await check('registration cached result still denies current authority: '+mutation,async()=>{
    await f.approve();await f.register();await db.exec(mutation);await assert.rejects(f.register(),e=>e.kind==='authorization');
   });
  for(const mutation of ["update cinevault_private.cp_credentials set revoked=true",
   "update cinevault_private.cp_credentials set epoch=2","update cinevault_private.cp_credentials set expires_at=clock_timestamp()-interval '1 second'",
   "update public.profiles set blocked=true"])
   await check('cached heartbeat rechecks current credential/owner: '+mutation,async()=>{
    await f.approve();await f.register();const body=f.heartbeat();await f.broker.execute(body,f.state.secret,null);await db.exec(mutation);
    await assert.rejects(f.broker.execute(body,f.state.secret,null),e=>e.kind==='authorization');
   });
  await check('operational credentials cannot approve or alter membership/owner fields',async()=>{
   await f.approve();await f.register();
   await assert.rejects(f.broker.execute({...f.heartbeat(),ownerId:owner},f.state.secret,null),e=>e.kind==='authorization');
   await assert.rejects(f.broker.execute({operation:'approve',request:f.request,approvalProof:f.approvalProof,confirmedInstanceId:f.state.serverInstanceId},f.state.secret,'synthetic-owner-token'));
  });
  await check('human revoke stops current cached registration and heartbeat',async()=>{
   await f.approve();await f.register();const body=f.heartbeat();await f.broker.execute(body,f.state.secret,null);
   await db.query('select cinevault_private.cp_revoke($1,$2,$3,$4)',[f.state.serverInstanceId,owner,session,new Date(Date.now()+60000)]);
   await assert.rejects(f.register(),e=>e.kind==='authorization');await assert.rejects(f.broker.execute(body,f.state.secret,null),e=>e.kind==='authorization');
  });
  await check('all new private tables have RLS and ordinary roles have no EXECUTE/CRUD; helpers unavailable to broker',async()=>{
   const tables=(await db.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cinevault_private' and c.relname like 'cp_%' and c.relkind='r'")).rows;
   assert.equal(tables.length,4);assert.ok(tables.every(r=>r.relrowsecurity));
   for(const role of ['anon','authenticated','service_role','cv_control_broker']){
    assert.equal((await db.query("select has_table_privilege($1,'cinevault_private.cp_credentials','SELECT') v",[role])).rows[0].v,false);
    if(role!=='cv_control_broker')assert.equal((await db.query("select has_function_privilege($1,'cinevault_private.cp_heartbeat(uuid,bytea,jsonb)','EXECUTE') v",[role])).rows[0].v,false);
   }
   assert.equal((await db.query("select has_function_privilege('cv_control_broker','cinevault_private.cp_guard(uuid)','EXECUTE') v")).rows[0].v,false);
  });
  await check('SQL itself rejects null operation/project/activity despite valid credential',async()=>{
   await f.approve();await f.register();
   for(const field of ['operation','projectRef','activity']){
    await assert.rejects(f.database.transaction(()=>db.query('select cinevault_private.cp_heartbeat($1,$2,$3)',[f.state.credentialId,crypto.createHash('sha256').update(f.state.secret).digest(),{...f.heartbeat(),[field]:null}])),e=>e.code==='42501');
   }
  });
 }finally{await db.close()}
});
