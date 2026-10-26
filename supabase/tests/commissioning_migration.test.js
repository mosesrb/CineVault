// Packaging qualification only. Real PostgreSQL/WASM, synthetic Auth, no deployment.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const inputs=['schema.sql','admission.sql','replacement.sql','restoration.sql','provisioning.sql'];
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8').replaceAll('\r\n','\n');
const migration=()=>read('../migrations/20261026045823_control_plane_broker_commissioning.sql');
async function fixture(){
 const db=await PGlite.create();try{
  await db.exec(read('bootstrap.sql'));
  await db.exec(`alter table auth.users add is_anonymous boolean default false,add banned_until timestamptz,
   add deleted_at timestamptz,add email text,add email_confirmed_at timestamptz;
   create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);`);
  await db.exec(read('../migrations/20261004161756_control_plane_foundation.sql'));return db;
 }catch(error){await db.close();throw error;}
}
async function catalog(db){
 const queries={
  functions:`select p.proname,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='cinevault_private' order by 1,2`,
  tables:`select c.relname,c.relrowsecurity,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cinevault_private' and c.relkind='r' order by 1`,
  columns:`select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='cinevault_private' order by table_name,ordinal_position`,
  constraints:`select c.relname,k.conname,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='cinevault_private' order by 1,2`,
  roles:`select rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit,rolpassword from pg_authid where rolname in ('cv_control_broker','cv_control_broker_login') order by 1`,
  membership:`select r.rolname,u.rolname member,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname='cv_control_broker_login' order by 1,2`
 };const result={};for(const [key,query] of Object.entries(queries))result[key]=(await db.query(query)).rows;return result;
}
test('CLI-created commissioning migration preserves reviewed source and is atomic',async t=>{
 await t.test('exact five reviewed bodies retained inside one outer transaction',()=>{
  const sources=inputs.map(name=>{const raw=read('../broker/'+name),start=raw.indexOf('\nbegin;\n');assert(start>=0);assert(raw.trimEnd().endsWith('\ncommit;'));
   return {name,sha256:crypto.createHash('sha256').update(raw).digest('hex'),body:raw.slice(start+8).trimEnd().slice(0,-8).trimEnd()};});
  const expected='-- REVIEWED SOURCE BUNDLE; hosted application requires separate exact approval.\n'+
   '-- CLI-created migration identity; one transaction for all five source sections.\n'+
   '-- No Auth account creation, password, LOGIN enablement, runtime or local cutover.\n'+
   sources.map(s=>'-- source: supabase/broker/'+s.name+' sha256:'+s.sha256).join('\n')+'\nbegin;\n\n'+
   sources.map(s=>'-- BEGIN SOURCE '+s.name+'\n'+s.body+'\n-- END SOURCE '+s.name).join('\n\n')+'\n\ncommit;\n';
  assert.equal(migration(),expected);
 });
 await t.test('combined catalog equals sequential source catalog, including privileges and disabled role',async()=>{
  let db=await fixture(),expected;
  try{for(const name of inputs)await db.exec(read('../broker/'+name));expected=await catalog(db);}finally{await db.close();}
  db=await fixture();try{
   await db.exec(migration());assert.deepEqual(await catalog(db),expected);
   assert.equal((await db.query("select count(*)::int n from public.profiles union all select count(*)::int n from public.servers union all select count(*)::int n from cinevault_private.cp_installations")).rows.every(r=>r.n===0),true);
  }finally{await db.close();}
 });
 await t.test('late pre-existing role conflict rolls all new private objects back',async()=>{
  const db=await fixture();try{
   await db.exec('create role cv_control_broker_login nologin');await assert.rejects(db.exec(migration()),e=>e.code==='42710');await db.exec('rollback');
   assert.equal((await db.query("select exists(select 1 from pg_roles where rolname='cv_control_broker') v")).rows[0].v,false);
   assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cinevault_private' and c.relname like 'cp_%'")).rows[0].n,0);
   assert.equal((await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='cinevault_private' and p.proname like 'cp_%'")).rows[0].n,0);
   assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")).rows[0].n,4);
  }finally{await db.close();}
 });
});
