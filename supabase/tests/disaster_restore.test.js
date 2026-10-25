// Actual local coordinator/transport/HTTP/broker + PostgreSQL/WASM. Synthetic Auth only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),p=require('../../services/controlPlane/protocol');
const {createCoordinator}=require('../../services/controlPlane/coordinator'),{createTransport}=require('../../services/controlPlane/transport');
const uuid=()=>crypto.randomUUID(),read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
test('owner-authorized disaster restore private SQL and complete local flow',async t=>{
 const db=await PGlite.create(),owner=uuid(),session=uuid(),foreign=uuid(),origin='https://restore-qa.pages.dev';let serial=0;
 try {
  const {createBroker,createHandler}=await import('../broker/broker.mjs');
  await db.exec(read('bootstrap.sql'));
  await db.exec('alter table auth.users add is_anonymous boolean default false,add banned_until timestamptz,add deleted_at timestamptz;create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);');
  for(const file of ['../migrations/20261004161756_control_plane_foundation.sql','../broker/schema.sql','../broker/admission.sql','../broker/replacement.sql','../broker/restoration.sql'])await db.exec(read(file));
  for(const id of [owner,foreign]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into public.profiles(id) values($1)',[id]);}
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
  const queries={approve:'cp_approve($1,$2,$3,$4,$5,$6)',register:'cp_register($1,$2,$3,$4)',replaceApprove:'cp_replace_approve($1,$2,$3,$4,$5,$6)',replace:'cp_replace($1,$2,$3,$4)',
   restoreApprove:'cp_restore_approve($1,$2,$3,$4,$5,$6)',restore:'cp_restore($1,$2,$3,$4)',verifier:'cp_verifier($1)',heartbeat:'cp_heartbeat($1,$2,$3)'};
  const database={transaction:async fn=>{const sp='s'+(++serial);await db.exec('savepoint '+sp+';set local role cv_control_broker');
   try{const value=await fn({call:async(op,args)=>(await db.query('select cinevault_private.'+queries[op]+' result',args.map(v=>v instanceof Uint8Array?Buffer.from(v):v))).rows[0].result});await db.exec('reset role;release savepoint '+sp);return value;}
   catch(e){await db.exec('rollback to savepoint '+sp+';release savepoint '+sp);throw e;}}};
  const broker=createBroker({database,verifyOwner:async token=>({userId:token==='foreign'?foreign:owner,sessionId:session,expiresAt:Date.now()+60000}),admit:async()=>true});
  const handler=createHandler({broker,approvedOrigin:origin,admitRequest:async()=>true});
  const check=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{
   const old=p.initialState(p.PROJECT_REF,uuid(),Date.now()),pair=p.pairingRequest(old);
   await db.query('insert into cinevault_private.cp_installations(instance_id,project_ref,owner_id) values($1,$2,$3)',[old.serverInstanceId,p.PROJECT_REF,owner]);
   await broker.execute({operation:'approve',...pair,confirmedInstanceId:old.serverInstanceId},null,'owner');
   const mapping=await broker.execute({operation:'register',request:pair.request,pollSecret:old.pollSecret},null,null);
   const active={...old,status:'active',mapping,sequence:0,pending:null};
   const state={version:3,status:'recovering',projectRef:p.PROJECT_REF,serverInstanceId:old.serverInstanceId,cloudServerId:mapping.cloudServerId,candidate:p.initialState(p.PROJECT_REF,old.serverInstanceId,Date.now())};
   const setup=p.recoveryRequest(state),approve=(s=setup,token='owner')=>broker.execute({operation:'approve-restore',request:s.request,approvalProof:s.approvalProof,confirmedInstanceId:old.serverInstanceId,confirmedCloudServerId:s.request.recovery.cloudServerId},null,token);
   const redeem=(s=setup,c=state.candidate)=>broker.execute({operation:'restore',request:s.request,pollSecret:c.pollSecret},null,null);
   await fn({old,active,state,setup,approve,redeem,mapping,pair});
  }finally{await db.exec('rollback');}});
  for(const damaged of ['missing','invalid-json','interrupted'])await check('durable staging and lost reply/restart preserve existing cloud identity: '+damaged,async f=>{
   let saved=damaged==='missing'?null:damaged==='invalid-json'?'{not-json':f.active,drop=true;const archived=[];
   const store={readForRecovery:async()=>typeof saved==='string'?null:structuredClone(saved),read:async()=>{p.validateState(saved,p.PROJECT_REF,f.old.serverInstanceId);return structuredClone(saved);},
    writeRecoveryAtomic:async next=>{archived.push(structuredClone(saved));saved=structuredClone(next);},writeAtomic:async next=>{p.validateTransition(saved,next);saved=structuredClone(next);}};
   const config={mode:'ready',projectRef:p.PROJECT_REF,brokerUrl:'https://qa.invalid/functions/v1/cinevault-control-plane',publishableKey:'synthetic-public'};
   const transport=createTransport({config,fetchImpl:async(url,opts)=>{const result=await handler(new Request(url,opts));if(drop&&result.status===200){drop=false;throw Error('synthetic discarded commit response');}return result;}});
   const factory=()=>createCoordinator({config,serverInstanceId:f.old.serverInstanceId,store,transport});const c=factory();
   const setup=await c.restore({confirmedInstanceId:f.old.serverInstanceId,cloudServerId:f.mapping.cloudServerId});
   assert.equal(archived.length,1);assert.deepEqual(await c.prepare(),setup);assert.deepEqual(await c.restore({confirmedInstanceId:f.old.serverInstanceId,cloudServerId:f.mapping.cloudServerId}),setup);
   await f.approve(setup);await assert.rejects(c.redeem());assert.equal(saved.status,'recovering');const secret=saved.candidate.secret;await c.stop();const next=factory();
   assert.deepEqual(await next.redeem(),{enrolled:true});assert.equal(saved.secret,secret);assert.equal(saved.mapping.cloudServerId,f.mapping.cloudServerId);assert.equal(saved.mapping.epoch,2);await next.stop();
   assert.equal((await db.query('select count(*)::int n from public.servers')).rows[0].n,1);
  });
  await check('approval retries preserve frozen baseline/JWT authority; duplicate redemption preserves lifetime',async f=>{
   await f.approve();const before=(await db.query('select * from cinevault_private.cp_restores')).rows[0];await f.approve();const after=(await db.query('select * from cinevault_private.cp_restores')).rows[0];assert.deepEqual(after,before);
   const a=await f.redeem();assert.deepEqual(await f.redeem(),a);assert.equal(a.epoch,2);await f.approve();assert.deepEqual(await f.redeem(),a);
  });
  await check('last allowed epoch increments once and exact replay still reconciles',async f=>{
   await db.exec('update cinevault_private.cp_credentials set epoch=9007199254740989');await f.approve();const a=await f.redeem();
   assert.equal(a.epoch,9007199254740990);assert.deepEqual(await f.redeem(),a);await f.approve();assert.deepEqual(await f.redeem(),a);
   const fresh=p.recoveryRequest({...f.state,candidate:p.initialState(p.PROJECT_REF,f.old.serverInstanceId,Date.now())});await assert.rejects(f.approve(fresh));
  });
  for(const mutation of ["update cinevault_private.cp_credentials set revoked=true","update cinevault_private.cp_credentials set expires_at=clock_timestamp()-interval '1 second'"])
   await check('fresh owner can rotate unusable old credential, never revive invalid issued candidate: '+mutation,async f=>{
    await db.exec(mutation);await f.approve();const issued=await f.redeem();await db.exec(mutation);
    await assert.rejects(f.redeem());await assert.rejects(f.approve());
    const sameId={...f.state,candidate:{...f.state.candidate,pairId:uuid(),idempotencyKey:uuid()}};await assert.rejects(f.approve(p.recoveryRequest(sameId)));
    const fresh={...f.state,candidate:p.initialState(p.PROJECT_REF,f.old.serverInstanceId,Date.now())},setup=p.recoveryRequest(fresh);await f.approve(setup);
    const next=await f.redeem(setup,fresh.candidate);assert.equal(next.epoch,issued.epoch+1);assert.equal(next.cloudServerId,issued.cloudServerId);
   });
  await check('actual issued interrupted replacement is recoverable without saved active mapping',async f=>{
   const replacing={version:2,status:'replacing',projectRef:p.PROJECT_REF,serverInstanceId:f.old.serverInstanceId,previous:f.active,candidate:p.initialState(p.PROJECT_REF,f.old.serverInstanceId,Date.now())},setup=p.replacementRequest(replacing);
   await broker.execute({operation:'approve-replacement',...setup,confirmedInstanceId:f.old.serverInstanceId},null,'owner');
   await broker.execute({operation:'replace',request:setup.request,pollSecret:replacing.candidate.pollSecret},null,null);
   await db.exec('update cinevault_private.cp_credentials set revoked=true');await f.approve();assert.equal((await f.redeem()).epoch,3);
  });
  await check('missing mapping, wrong cloud server, foreign owner and tampered proof deny without new server',async f=>{
   await assert.rejects(f.approve(f.setup,'foreign'));
   await assert.rejects(f.approve(p.recoveryRequest({...f.state,cloudServerId:uuid()})));
   await assert.rejects(f.approve({...f.setup,approvalProof:'0'.repeat(64)}));
   await db.exec('delete from cinevault_private.cp_credentials');await assert.rejects(f.approve());assert.equal((await db.query('select count(*)::int n from public.servers')).rows[0].n,1);
  });
  for(const mutation of ['delete from auth.sessions','update public.profiles set blocked=true','update public.profiles set must_change_password=true','update cinevault_private.cp_installations set enabled=false',
   "update cinevault_private.cp_restores set jwt_expires_at=clock_timestamp()-interval '1 second'", "update cinevault_private.cp_restores set expires_at=clock_timestamp()-interval '1 second'"])
   await check('current authority/expiry rechecked on redemption: '+mutation,async f=>{await f.approve();await db.exec(mutation);await assert.rejects(f.redeem());assert.equal((await db.query('select epoch from cinevault_private.cp_credentials')).rows[0].epoch,1);});
  await check('changed credential after approval cannot silently reanchor or redeem',async f=>{
   await f.approve();await db.query('update cinevault_private.cp_credentials set id=$1,epoch=epoch+1',[uuid()]);await assert.rejects(f.approve());await assert.rejects(f.redeem());
  });
  await check('restore and replacement approvals cannot overwrite each other live',async f=>{
   const replacing={version:2,status:'replacing',projectRef:p.PROJECT_REF,serverInstanceId:f.old.serverInstanceId,previous:f.active,candidate:p.initialState(p.PROJECT_REF,f.old.serverInstanceId,Date.now())},s=p.replacementRequest(replacing);
   await f.approve();await assert.rejects(broker.execute({operation:'approve-replacement',...s,confirmedInstanceId:f.old.serverInstanceId},null,'owner'));
   await db.exec("update cinevault_private.cp_restores set expires_at=clock_timestamp()-interval '1 second'");
   await broker.execute({operation:'approve-replacement',...s,confirmedInstanceId:f.old.serverInstanceId},null,'owner');
   const next=p.recoveryRequest({...f.state,candidate:p.initialState(p.PROJECT_REF,f.old.serverInstanceId,Date.now())});await assert.rejects(f.approve(next));
  });
  await check('human revoke cancels grant; operational key/ordinary role cannot approve',async f=>{
   await f.approve();await db.query('select cinevault_private.cp_revoke($1,$2,$3,$4)',[f.old.serverInstanceId,owner,session,new Date(Date.now()+60000)]);await assert.rejects(f.redeem());
   await assert.rejects(broker.execute({operation:'approve-restore',...f.setup,confirmedInstanceId:f.old.serverInstanceId,confirmedCloudServerId:f.mapping.cloudServerId},f.old.secret,'owner'));
   for(const role of ['anon','authenticated','service_role','cv_control_broker']){
    const r=(await db.query("select has_table_privilege($1,'cinevault_private.cp_restores','select') v",[role])).rows[0];assert.equal(r.v,false);
   }
   assert.equal((await db.query("select has_function_privilege('cv_control_broker','cinevault_private.cp_initial_approve_core(uuid,uuid,timestamptz,jsonb,bytea,bytea)','execute') v")).rows[0].v,false);
  });
  await check('trusted owner page requires separately confirmed cloud ID and dispatches distinct operation',async f=>{
   const {createOwnerSession}=await import('../../enrollment/protocol.mjs');const sent=[];
   const ownerPage=createOwnerSession({config:{projectRef:p.PROJECT_REF,projectUrl:'https://'+p.PROJECT_REF+'.supabase.co',publishableKey:'sb_publishable_'+'a'.repeat(32),approvedOrigin:origin},origin,
    fetchImpl:async(url,opts)=>{sent.push(JSON.parse(opts.body));return Response.json(url.includes('/token?')?{access_token:'synthetic',token_type:'bearer',expires_in:60,user:{id:owner,is_anonymous:false}}:{approved:true,pairId:f.setup.request.pairId,expiresAt:f.setup.request.expiresAt});}});
   await ownerPage.signIn('qa@example.test','synthetic');await assert.rejects(ownerPage.approve(JSON.stringify(f.setup.request),f.setup.approvalProof,f.old.serverInstanceId));
   await ownerPage.approve(JSON.stringify(f.setup.request),f.setup.approvalProof,f.old.serverInstanceId,f.mapping.cloudServerId);assert.equal(sent.at(-1).operation,'approve-restore');ownerPage.dispose();
   const body={operation:'approve-restore',...f.setup,confirmedInstanceId:f.old.serverInstanceId,confirmedCloudServerId:f.mapping.cloudServerId};
   for(const headers of [{},{origin:'https://foreign.invalid'}])assert.equal((await handler(new Request('https://qa.invalid/functions/v1/cinevault-control-plane',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer owner',...headers},body:JSON.stringify(body)}))).status,403);
  });
 }finally{await db.close();}
});
