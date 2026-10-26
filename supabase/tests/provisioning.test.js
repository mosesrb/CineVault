// Real PostgreSQL/WASM, synthetic Auth only; never a hosted account fixture.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {PROJECT_REF}=require('../../services/controlPlane/protocol');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8'),uuid=()=>crypto.randomUUID();
test('operator-only owner/installation provisioning',async t=>{
 const db=await PGlite.create(),owner=uuid(),instance=uuid();
 try{
  await db.exec(read('bootstrap.sql'));
  await db.exec(`alter table auth.users add is_anonymous boolean default false,add banned_until timestamptz,
   add deleted_at timestamptz,add email text,add email_confirmed_at timestamptz;
   create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);`);
  for(const file of ['../migrations/20261004161756_control_plane_foundation.sql','../broker/schema.sql',
   '../broker/admission.sql','../broker/replacement.sql','../broker/restoration.sql','../broker/provisioning.sql'])await db.exec(read(file));
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'synthetic-owner@example.invalid',clock_timestamp())",[owner]);
  const provision=async(user=owner,id=instance,name='Owner',project=PROJECT_REF)=>{
   await db.exec('savepoint provision_call');
   try{const result=await db.query('select cinevault_private.cp_provision_installation($1,$2,$3,$4) result',[project,user,id,name]);
    await db.exec('release savepoint provision_call');return result.rows[0].result;
   }catch(error){await db.exec('rollback to savepoint provision_call; release savepoint provision_call');throw error;}
  };
  const check=(name,action)=>t.test(name,async()=>{await db.exec('begin');try{await action()}finally{await db.exec('rollback')}});
  const count=async table=>(await db.query('select count(*)::int n from '+table)).rows[0].n;
  await check('create profile and explicit installation only; exact retry has no side effects',async()=>{
   const result=await provision();assert.deepEqual(result,{projectRef:PROJECT_REF,ownerId:owner,serverInstanceId:instance,enabled:true});
   await db.query('update cinevault_private.cp_installations set admission_counts=$1 where instance_id=$2',[{approve:3,register:7,heartbeat:9},instance]);
   const before=(await db.query('select row_to_json(p) profile from public.profiles p')).rows;
   assert.deepEqual(await provision(),result);assert.deepEqual((await db.query('select row_to_json(p) profile from public.profiles p')).rows,before);
   assert.deepEqual((await db.query('select admission_counts from cinevault_private.cp_installations')).rows[0].admission_counts,{approve:3,register:7,heartbeat:9});
   for(const table of ['public.servers','public.server_users','public.server_endpoints','cinevault_private.cp_pairings','cinevault_private.cp_credentials'])assert.equal(await count(table),0);
  });
  for(const mutation of ["is_anonymous=true","is_anonymous=null","deleted_at=clock_timestamp()",
   "banned_until=clock_timestamp()+interval '1 day'","email=null","email=''","email_confirmed_at=null",
   "email_confirmed_at=clock_timestamp()+interval '1 day'"])
   await check('ineligible current Auth record denies without a profile: '+mutation,async()=>{
    await db.exec('update auth.users set '+mutation);await assert.rejects(provision(),e=>e.code==='42501');
    assert.equal(await count('public.profiles'),0);assert.equal(await count('cinevault_private.cp_installations'),0);
   });
  await check('missing account denies; no SQL-created Auth user or email lookup',async()=>{
   await assert.rejects(provision(uuid()),e=>e.code==='42501');assert.equal(await count('auth.users'),1);assert.equal(await count('public.profiles'),0);
  });
  for(const mutation of ['blocked=true','must_change_password=true',"display_name='Existing name'"])
   await check('existing profile policy/name is preserved: '+mutation,async()=>{
    await db.query("insert into public.profiles(id,display_name) values($1,'Owner')",[owner]);await db.exec('update public.profiles set '+mutation);
    const before=(await db.query('select row_to_json(p) profile from public.profiles p')).rows;
    await assert.rejects(provision(),e=>e.code==='42501');assert.deepEqual((await db.query('select row_to_json(p) profile from public.profiles p')).rows,before);
    assert.equal(await count('cinevault_private.cp_installations'),0);
   });
  await check('disabled installation is never re-enabled',async()=>{
   await provision();await db.exec('update cinevault_private.cp_installations set enabled=false');
   await assert.rejects(provision(),e=>e.code==='P0001');assert.equal((await db.query('select enabled from cinevault_private.cp_installations')).rows[0].enabled,false);
  });
  await check('different owner cannot rebind installation or create a side-effect profile',async()=>{
   await provision();const other=uuid();await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'other@example.invalid',clock_timestamp())",[other]);
   await assert.rejects(provision(other),e=>e.code==='P0001');assert.equal(await count('public.profiles'),1);
   assert.equal((await db.query('select owner_id from cinevault_private.cp_installations')).rows[0].owner_id,owner);
  });
  await check('unbound existing cloud server is not adopted; failed mutation rolls profile insert back',async()=>{
   const other=uuid();await db.query('insert into auth.users(id) values($1)',[other]);await db.query('insert into public.profiles(id) values($1)',[other]);
   await db.query("insert into public.servers(id,owner_user_id,server_instance_id,name) values($1,$2,$3,'Synthetic')",[uuid(),other,instance]);
   await assert.rejects(provision(),e=>e.code==='P0001');assert.equal((await db.query('select exists(select 1 from public.profiles where id=$1) v',[owner])).rows[0].v,false);
   assert.equal(await count('cinevault_private.cp_installations'),0);
  });
  await check('registered matching installation retry preserves revoked credential, users and endpoint state',async()=>{
   await provision();const server=uuid(),credential=uuid();
   await db.query("insert into public.servers(id,owner_user_id,server_instance_id,name) values($1,$2,$3,'Synthetic')",[server,owner,instance]);
   await db.query("insert into cinevault_private.cp_credentials(id,instance_id,server_id,secret_digest,epoch,expires_at,revoked) values($1,$2,$3,$4,7,clock_timestamp()-interval '1 day',true)",[credential,instance,server,Buffer.alloc(32,1)]);
   await db.query('insert into public.server_users(server_id,user_id) values($1,$2)',[server,owner]);
   await provision();const row=(await db.query('select id,revoked,epoch from cinevault_private.cp_credentials')).rows[0];
   assert.equal(row.id,credential);assert.equal(row.revoked,true);assert.equal(row.epoch,7);assert.equal(await count('public.server_users'),1);
  });
  await check('project/instance/display shape denied before writes',async()=>{
   for(const args of [[owner,instance,'Owner','foreign'],[owner,null],[null,instance],[owner,'00000000-0000-0000-0000-000000000000'],
    [owner,instance,''],[owner,instance,' Owner'],[owner,instance,'Owner\n'],[owner,instance,'x'.repeat(129)]])await assert.rejects(provision(...args),e=>e.code==='42501');
   assert.equal(await count('public.profiles'),0);
  });
  await check('dedicated login stays passwordless/disabled, only explicit SET of narrow broker role',async()=>{
   const role=(await db.query("select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit,rolpassword from pg_authid where rolname='cv_control_broker_login'")).rows[0];
   assert.deepEqual(role,{rolcanlogin:false,rolinherit:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,rolconnlimit:4,rolpassword:null});
   const memberships=(await db.query("select r.rolname,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname='cv_control_broker_login'")).rows;
   assert.deepEqual(memberships,[{rolname:'cv_control_broker',admin_option:false,inherit_option:false,set_option:true}]);
   for(const role of ['anon','authenticated','service_role','cv_control_broker','cv_control_broker_login']){
    assert.equal((await db.query("select has_function_privilege($1,'cinevault_private.cp_provision_installation(text,uuid,uuid,text)','EXECUTE') v",[role])).rows[0].v,false);
    assert.equal((await db.query("select has_table_privilege($1,'cinevault_private.cp_installations','INSERT') v",[role])).rows[0].v,false);
   }
   await db.exec('set local role cv_control_broker_login');
   await assert.rejects(provision(),e=>e.code==='42501');await db.exec('reset role');
  });
 }finally{await db.close()}
});
