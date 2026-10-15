// Actual PostgreSQL/WASM budgets + complete runtime/HTTP with synthetic Auth.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),jwt=require('../broker/node_modules/jsonwebtoken');
const {PROJECT_REF,initialState,pairingRequest}=require('../../services/controlPlane/protocol');
const mods=Promise.all([import('../broker/runtime.mjs'),import('../broker/broker.mjs')]);
const origin='https://cv-runtime-qa.pages.dev',read=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
const config=()=>({enabled:'true',projectRef:PROJECT_REF,approvalOrigin:origin,publishableKey:'sb_publishable_'+'a'.repeat(32),
 databaseUrl:`postgresql://cv_control_broker_login.${PROJECT_REF}:${'q'.repeat(32)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`});
const req=(body,headers={})=>new Request('https://qa.invalid/cinevault-control-plane',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('prepared function source has narrow media-ignore exceptions and pinned frozen CI qualification',()=>{
 const ignore=read('../../.gitignore'),workflow=read('../../.github/workflows/ci.yml');
 for(const file of ['index.ts','runtime_test.ts']){
  assert.ok(ignore.split(/\r?\n/).includes('!supabase/functions/cinevault-control-plane/'+file));
  assert.ok(fs.existsSync(path.join(__dirname,'../functions/cinevault-control-plane',file)));
 }
 assert.ok(workflow.includes('denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed'));
 assert.ok(workflow.includes('deno check --frozen'));assert.ok(workflow.includes('deno audit --lock'));
});
test('shared admission and hosted runtime composition',async t=>{
 const [{createRuntime},{createHandler}]=await mods,db=await PGlite.create();
 const owner=crypto.randomUUID(),session=crypto.randomUUID(),state=initialState(PROJECT_REF,crypto.randomUUID(),Date.now());
 const {request,approvalProof}=pairingRequest(state),keys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const publicKey={...keys.publicKey.export({format:'jwk'}),kid:'qa',alg:'ES256',use:'sig'};
 const token=jwt.sign({sub:owner,session_id:session,role:'authenticated',is_anonymous:false,iss:`https://${PROJECT_REF}.supabase.co/auth/v1`,
  aud:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300},keys.privateKey,{algorithm:'ES256',keyid:'qa'});
 let providerReads=0,connections=0,closures=0,serial=0;
 const postgres=()=>{connections++;return {begin:async fn=>{
  const point='runtime_'+(++serial);await db.exec('savepoint '+point);
  const tx={json:v=>v,unsafe:async(sql,args)=>{
   if(sql==='set local role cv_control_broker'){await db.exec(sql);return [];}
   return (await db.query(sql,args)).rows;
  }};
  try{const value=await fn(tx);await db.exec('reset role; release savepoint '+point);return value;}
  catch(e){await db.exec('rollback to savepoint '+point+'; release savepoint '+point);throw e;}
 },end:async()=>{closures++;}};};
 const fetchImpl=async url=>{providerReads++;return Response.json(url.endsWith('/jwks.json')?{keys:[publicKey]}:{id:owner,is_anonymous:false});};
 const runtime=()=>createRuntime({configuration:config(),postgres,fetchImpl});
 const check=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}});
 try {
  await db.exec(read('bootstrap.sql'));
  await db.exec('alter table auth.users add is_anonymous boolean default false,add banned_until timestamptz,add deleted_at timestamptz; create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);');
  await db.exec(read('../migrations/20261004161756_control_plane_foundation.sql'));
  await db.exec(read('../broker/schema.sql'));await db.exec(read('../broker/admission.sql'));
  await db.query('insert into auth.users(id) values($1)',[owner]);await db.query('insert into public.profiles(id) values($1)',[owner]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
  await db.query('insert into cinevault_private.cp_installations(instance_id,project_ref,owner_id) values($1,$2,$3)',[state.serverInstanceId,PROJECT_REF,owner]);
  await check('two independently constructed isolates share the same installation budget',async()=>{
   const a=runtime(),b=runtime();for(let i=0;i<10;i++)assert.equal((await (i%2?a:b).handle(req({operation:'register',request,pollSecret:state.pollSecret}))).status,202);
   assert.equal((await a.handle(req({operation:'register',request,pollSecret:state.pollSecret}))).status,429);
   assert.equal((await db.query('select admission_counts from cinevault_private.cp_installations')).rows[0].admission_counts.register,10);
   await a.close();await b.close();
  });
  await check('complete runtime verifies owner signature/fresh Auth, registers and acknowledges exact heartbeat',async()=>{
   const app=runtime(),approve={operation:'approve',request,approvalProof,confirmedInstanceId:state.serverInstanceId};
   assert.equal((await app.handle(req(approve,{origin,authorization:'Bearer '+token}))).status,200);
   const body={operation:'register',request,pollSecret:state.pollSecret};const a=await (await app.handle(req(body))).json(),b=await (await app.handle(req(body))).json();assert.deepEqual(a,b);
   const beat={operation:'heartbeat',projectRef:PROJECT_REF,serverInstanceId:state.serverInstanceId,credentialId:state.credentialId,
    epoch:1,sequence:1,idempotencyKey:crypto.randomUUID(),activity:'authenticated-request'};
   const headers={'x-cinevault-credential':state.secret},first=await(await app.handle(req(beat,headers))).json(),replay=await(await app.handle(req(beat,headers))).json();
   assert.deepEqual(first,replay);assert.equal((await db.query('select status from public.servers')).rows[0].status,'OFFLINE');
   assert.equal((await db.query('select count(*)::int n from public.server_users')).rows[0].n,0);await app.close();
  });
  await check('failed owner authorization still consumes committed quota, not rolled back with the denied business operation',async()=>{
   const app=runtime(),reads=providerReads;
   for(let i=0;i<4;i++)assert.equal((await app.handle(req({operation:'approve',request,approvalProof,confirmedInstanceId:state.serverInstanceId},{origin,authorization:'Bearer invalid.jwt'}))).status,403);
   assert.equal((await app.handle(req({operation:'approve',request,approvalProof,confirmedInstanceId:state.serverInstanceId},{origin,authorization:'Bearer '+token}))).status,429);
   assert.equal(providerReads,reads);assert.equal((await db.query('select admission_counts from cinevault_private.cp_installations')).rows[0].admission_counts.approve,4);await app.close();
  });
  await check('global budget is exactly120; rolled-forward window resets but rollback time cannot',async()=>{
   for(let i=0;i<120;i++)assert.equal((await db.query('select cinevault_private.cp_admit_request() v')).rows[0].v,true);
   assert.equal((await db.query('select cinevault_private.cp_admit_request() v')).rows[0].v,false);
   await db.exec("update cinevault_private.cp_admission set window_at=clock_timestamp()-interval '61 seconds'");
   assert.equal((await db.query('select cinevault_private.cp_admit_request() v')).rows[0].v,true);
   await db.exec("update cinevault_private.cp_admission set window_at=clock_timestamp()+interval '1 hour'");
   assert.equal((await db.query('select cinevault_private.cp_admit_request() v')).rows[0].v,false);
  });
  await check('random identities do not allocate rows; disabled/missing installation and bad operation deny',async()=>{
   for(let i=0;i<12;i++)assert.equal((await db.query("select cinevault_private.cp_admit('register',$1) v",[crypto.randomUUID()])).rows[0].v,false);
   assert.equal((await db.query("select cinevault_private.cp_admit('reset',$1) v",[state.serverInstanceId])).rows[0].v,false);
   await db.exec('update cinevault_private.cp_installations set enabled=false');
   assert.equal((await db.query("select cinevault_private.cp_admit('register',$1) v",[state.serverInstanceId])).rows[0].v,false);
   assert.equal((await db.query('select count(*)::int n from cinevault_private.cp_admission')).rows[0].n,1);
  });
  await check('global HTTP rejection precedes expensive owner reads and business calls',async()=>{
   await db.exec('update cinevault_private.cp_admission set window_at=clock_timestamp(),used=120');const app=runtime(),reads=providerReads;
   const r=await app.handle(req({operation:'approve',request,approvalProof,confirmedInstanceId:state.serverInstanceId},{origin,authorization:'Bearer '+token}));
   assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.equal(providerReads,reads);await app.close();
  });
  await check('new budgets stay private/RLS/EXECUTE-only, not ordinary-client authority',async()=>{
   assert.equal((await db.query("select relrowsecurity v from pg_class where oid='cinevault_private.cp_admission'::regclass")).rows[0].v,true);
   for(const role of ['anon','authenticated','service_role','cv_control_broker']){
    assert.equal((await db.query("select has_table_privilege($1,'cinevault_private.cp_admission','SELECT') v",[role])).rows[0].v,false);
    assert.equal((await db.query("select has_function_privilege($1,'cinevault_private.cp_admit_request()','EXECUTE') v",[role])).rows[0].v,role==='cv_control_broker');
   }
  });
  await check('installation window expiry resets all bounded counters and clock rollback denies',async()=>{
   for(let i=0;i<10;i++)assert.equal((await db.query("select cinevault_private.cp_admit('register',$1) v",[state.serverInstanceId])).rows[0].v,true);
   await db.exec("update cinevault_private.cp_installations set admission_at=clock_timestamp()-interval '61 seconds'");
   assert.equal((await db.query("select cinevault_private.cp_admit('approve',$1) v",[state.serverInstanceId])).rows[0].v,true);
   const counts=(await db.query('select admission_counts from cinevault_private.cp_installations')).rows[0].admission_counts;assert.deepEqual(counts,{approve:1,register:0,heartbeat:0});
   await db.exec("update cinevault_private.cp_installations set admission_at=clock_timestamp()+interval '1 hour'");
   assert.equal((await db.query("select cinevault_private.cp_admit('register',$1) v",[state.serverInstanceId])).rows[0].v,false);
  });
  await check('current owner revocation still denies despite available quota',async()=>{
   const app=runtime();await db.exec('update public.profiles set blocked=true');
   const r=await app.handle(req({operation:'approve',request,approvalProof,confirmedInstanceId:state.serverInstanceId},{origin,authorization:'Bearer '+token}));assert.equal(r.status,403);
   assert.equal((await db.query('select count(*)::int n from cinevault_private.cp_pairings')).rows[0].n,0);await app.close();
  });
  await check('missing/false opt-in, bad origin/key/project/url, unknown fields open no pool or provider request',async()=>{
   for(const change of [{enabled:'false'},{enabled:true},{approvalOrigin:'https://evil.invalid'},{publishableKey:'private-key'},
    {projectRef:'other'},{databaseUrl:'postgresql://localhost/postgres'},{unknown:'option'}]){
    const reads=providerReads,pools=connections,app=createRuntime({configuration:{...config(),...change},postgres,fetchImpl});
    assert.equal(app.configured,false);assert.equal((await app.handle(req({}))).status,503);assert.equal(providerReads,reads);assert.equal(connections,pools);
   }
  });
  await check('closed runtime refuses new requests and closes its pool without creating recovery state',async()=>{
   const app=runtime(),closed=closures;await app.close();assert.equal(closures,closed+1);assert.equal((await app.handle(req({}))).status,503);
  });
  await check('provider gateway path is fixed and arbitrary trusted route configuration still denies',async()=>{
   const app=runtime();assert.equal((await app.handle(new Request('https://qa.invalid/functions/v1/cinevault-control-plane',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))).status,403);await app.close();
   assert.throws(()=>createHandler({broker:{execute:async()=>null},approvedOrigin:origin,admitRequest:async()=>true,routePath:'/anything'}));
  });
 }finally{await db.close();}
});

test('per-isolate admission has no queue and close prevents post-admission continuation',async()=>{
 const [{createRuntime}]=await mods,release=Promise.withResolvers(),began=Promise.withResolvers();let calls=0,closed=false;
 const postgres=()=>({begin:async fn=>fn({unsafe:async sql=>{if(sql.startsWith('select')){calls++;began.resolve();await release.promise;return [{result:true}];}return [];} }),end:async()=>{closed=true;}});
 const app=createRuntime({configuration:config(),postgres,fetchImpl:async()=>{throw Error('must not fetch');}});
 const a=app.handle(req({})),b=app.handle(req({}));await began.promise;const third=await app.handle(req({}));assert.equal(third.status,429);assert.equal(calls,2);
 await app.close();assert.equal(closed,true);release.resolve();assert.equal((await a).status,503);assert.equal((await b).status,503);assert.equal(calls,2);
});
