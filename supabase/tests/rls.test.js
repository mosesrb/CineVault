// Real PostgreSQL/WASM policies; simulated auth.uid(), not hosted Auth/PostgREST.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const hardening = fs.readFileSync(path.join(__dirname, '../migrations/20261004161817_control_plane_hardening.sql'), 'utf8');

const ids = {
    owner: '00000000-0000-4000-8000-000000000001',
    member: '00000000-0000-4000-8000-000000000002',
    other: '00000000-0000-4000-8000-000000000003',
    blocked: '00000000-0000-4000-8000-000000000004',
    disabled: '00000000-0000-4000-8000-000000000005',
    localOnly: '00000000-0000-4000-8000-000000000006',
    missing: '00000000-0000-4000-8000-000000000007',
    server: '00000000-0000-4000-8000-000000000101',
    foreign: '00000000-0000-4000-8000-000000000102'
};

async function createFixture() {
    const db = await PGlite.create();
    try {
        await db.exec(fs.readFileSync(path.join(__dirname, 'bootstrap.sql'), 'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261004161756_control_plane_foundation.sql'), 'utf8'));
        await db.exec(hardening);
        for (const key of ['owner', 'member', 'other', 'blocked', 'disabled', 'localOnly', 'missing']) {
            await db.query('insert into auth.users(id) values ($1)', [ids[key]]);
            if (key !== 'missing') await db.query('insert into public.profiles(id,blocked) values ($1,$2)', [ids[key], key === 'blocked']);
        }
        for (const [server, owner] of [[ids.server, ids.owner], [ids.foreign, ids.other]]) {
            await db.query('insert into public.servers(id,owner_user_id,server_instance_id,name) values ($1,$2,$1,$3)', [server, owner, 'Synthetic QA']);
            await db.query(`insert into public.server_endpoints(server_id,provider,mode,endpoint_url,generation,status,verified_at)
                values ($1,'qa','PUBLIC_REMOTE','https://cinevault-qa.invalid/',1,'ONLINE',now())`, [server]);
        }
        for (const key of ['owner', 'member', 'blocked', 'disabled', 'localOnly']) {
            await db.query(`insert into public.server_users(server_id,user_id,role,enabled,remote_stream_allowed)
                values ($1,$2,$3,$4,$5)`, [ids.server, ids[key], key === 'owner' ? 'ADMIN' : 'USER', key !== 'disabled', key !== 'localOnly']);
        }
        await db.query(`insert into public.server_users(server_id,user_id,enabled,remote_stream_allowed) values ($1,$2,true,true)`, [ids.foreign, ids.other]);
        return db;
    } catch (error) { await db.close(); throw error; }
}

async function asUser(db, role, user, operation) {
    await db.exec(`set role ${role}`); // Only literal role names from these tests.
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user || '']);
    try { return await operation(); }
    finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub','',false)`); }
}

test('control-plane authorization matrix on disposable PostgreSQL', async t => {
    const db = await createFixture();
    try {
        const count = async table => (await db.query(`select count(*)::integer as n from public.${table}`)).rows[0].n;
        await t.test('migration enables RLS on all four tables and pins private helper', async () => {
            const rows = (await db.query(`select relname,relrowsecurity from pg_class where relname in ('profiles','servers','server_users','server_endpoints')`)).rows;
            assert.equal(rows.length, 4); assert.ok(rows.every(r => r.relrowsecurity));
            const fn = (await db.query(`select prosecdef,proconfig from pg_proc where proname='can_read_server'`)).rows[0];
            assert.equal(fn.prosecdef, true); assert.ok(fn.proconfig.includes('search_path=""'));
        });
        for (const key of ['owner', 'member']) await t.test(`${key} reads self and assigned server, never foreign profile/membership/endpoint`, async () => {
            await asUser(db,'authenticated',ids[key],async()=>{
                assert.equal(await count('profiles'),1); assert.equal(await count('server_users'),1);
                assert.deepEqual((await db.query('select id from public.servers')).rows,[{id:ids.server}]);
                assert.deepEqual((await db.query('select server_id from public.server_endpoints')).rows,[{server_id:ids.server}]);
            });
        });
        await t.test('other member discovers only its own distinct server', async () => {
            await asUser(db,'authenticated',ids.other,async()=>{
                assert.deepEqual((await db.query('select id from public.servers')).rows,[{id:ids.foreign}]);
                assert.deepEqual((await db.query('select server_id from public.server_endpoints')).rows,[{server_id:ids.foreign}]);
            });
        });
        for (const key of ['blocked','disabled','missing']) await t.test(`${key} receives no server or endpoint discovery`, async()=>{
            await asUser(db,'authenticated',ids[key],async()=>{
                assert.equal(await count('servers'),0); assert.equal(await count('server_endpoints'),0);
                if(key==='blocked') { assert.equal(await count('profiles'),1); assert.equal(await count('server_users'),0); }
            });
        });
        await t.test('local-only member sees server status but not a remote endpoint',async()=>{
            await asUser(db,'authenticated',ids.localOnly,async()=>{assert.equal(await count('servers'),1);assert.equal(await count('server_endpoints'),0);});
        });
        await t.test('authenticated role without subject cannot discover anything',async()=>{
            await asUser(db,'authenticated',null,async()=>{for(const table of ['profiles','server_users','servers','server_endpoints'])assert.equal(await count(table),0);});
        });
        await t.test('signed-out role has no table grants or private helper execution',async()=>{
            await asUser(db,'anon',null,async()=>{
                for(const table of ['profiles','server_users','servers','server_endpoints'])await assert.rejects(()=>count(table),{code:'42501'});
                await assert.rejects(()=>db.query('select cinevault_private.can_read_server($1,true)',[ids.server]),{code:'42501'});
            });
        });
        for (const key of ['owner','member','blocked']) await t.test(`${key} cannot write profiles, capabilities, heartbeat or endpoints`,async()=>{
            await asUser(db,'authenticated',ids[key],async()=>{
                const writes=[
                    ['update public.profiles set blocked=false,must_change_password=false where id=$1',[ids[key]]],
                    ['update public.server_users set role=\'ADMIN\',enabled=true,download_allowed=true where user_id=$1',[ids[key]]],
                    ['update public.servers set last_heartbeat_at=now(),owner_user_id=$1',[ids[key]]],
                    ['update public.server_endpoints set generation=99,endpoint_url=\'https://attacker.invalid/\' where server_id=$1',[ids.server]],
                    ['insert into public.server_users(server_id,user_id) values ($1,$2)',[ids.foreign,ids[key]]],
                    ['delete from public.profiles where id=$1',[ids[key]]]
                ];
                for(const [sql,args]of writes)await assert.rejects(()=>db.query(sql,args),{code:'42501'});
                for(const table of ['profiles','servers','server_users','server_endpoints']) {
                    const r=await db.query('select has_table_privilege(current_user,$1,\'INSERT\') as i,has_table_privilege(current_user,$1,\'UPDATE\') as u,has_table_privilege(current_user,$1,\'DELETE\') as d',['public.'+table]);
                    assert.deepEqual(r.rows[0],{i:false,u:false,d:false});
                }
            });
        });
        await t.test('revocation takes effect on the next discovery read',async()=>{
            await db.query('update public.profiles set blocked=true where id=$1',[ids.member]);
            await asUser(db,'authenticated',ids.member,async()=>{assert.equal(await count('server_endpoints'),0);});
            await db.query('update public.profiles set blocked=false where id=$1',[ids.member]);
            await db.query('update public.server_users set enabled=false where user_id=$1',[ids.member]);
            await asUser(db,'authenticated',ids.member,async()=>{assert.equal(await count('servers'),0);});
        });
        await t.test('unverified or degraded endpoint is withheld',async()=>{
            await db.query(`update public.server_endpoints set status='DEGRADED',verified_at=null where server_id=$1`,[ids.server]);
            await asUser(db,'authenticated',ids.owner,async()=>{assert.equal(await count('server_endpoints'),0);});
        });
        await t.test('trusted provisioning role writes but constraints reject unsafe endpoint/generation/status',async()=>{
            await asUser(db,'service_role',null,async()=>{
                await db.query(`update public.servers set status='ONLINE',last_heartbeat_at=now() where id=$1`,[ids.server]);
                for(const url of ['http://qa.invalid/','https://user:pass@qa.invalid/','https://qa.invalid/?token=x','https://qa.invalid/#token']) {
                    await assert.rejects(()=>db.query('update public.server_endpoints set endpoint_url=$1 where server_id=$2',[url,ids.server]),{code:'23514'});
                }
                await assert.rejects(()=>db.query('update public.server_endpoints set generation=-1 where server_id=$1',[ids.server]),{code:'23514'});
                await assert.rejects(()=>db.query(`update public.server_endpoints set status='ONLINE',verified_at=null where server_id=$1`,[ids.server]),{code:'23514'});
            });
        });
    } finally { await db.close(); }
});

test('hardening preserves automatic RLS while removing public execution', async t => {
    const db = await PGlite.create();
    try {
        await db.exec(fs.readFileSync(path.join(__dirname, 'bootstrap.sql'), 'utf8'));
        await db.exec(`create function public.rls_auto_enable() returns event_trigger
            language plpgsql security definer set search_path = pg_catalog as $$
            declare cmd record;
            begin
                for cmd in select * from pg_event_trigger_ddl_commands()
                    where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
                    and object_type in ('table','partitioned table')
                loop
                    if cmd.schema_name = 'public' then
                        execute format('alter table %s enable row level security',cmd.object_identity);
                    end if;
                end loop;
            end; $$;
            grant execute on function public.rls_auto_enable() to anon, authenticated;
            create event trigger ensure_rls on ddl_command_end
                when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
                execute function public.rls_auto_enable();`);
        await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261004161756_control_plane_foundation.sql'), 'utf8'));
        const snapshot = async () => (await db.query(`select pg_get_functiondef(p.oid) as definition,
            p.proowner, e.evtname, e.evtenabled, e.evtevent, e.evttags
            from pg_proc p join pg_event_trigger e on e.evtfoid=p.oid
            where p.oid='public.rls_auto_enable()'::regprocedure`)).rows;
        const before = await snapshot();
        await db.exec(hardening);
        await t.test('function body, owner and event trigger are unchanged', async () => {
            assert.deepEqual(await snapshot(), before);
        });
        await t.test('anon/authenticated cannot execute; owner retains execution', async () => {
            const row = (await db.query(`select
                has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') as anon,
                has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') as authenticated,
                has_function_privilege(current_user,'public.rls_auto_enable()','EXECUTE') as owner`)).rows[0];
            assert.deepEqual(row, {anon:false,authenticated:false,owner:true});
        });
        await t.test('automatic RLS still runs on new public tables', async () => {
            await db.exec('create table public.synthetic_rls_probe(id integer)');
            assert.equal((await db.query(`select relrowsecurity from pg_class
                where oid='public.synthetic_rls_probe'::regclass`)).rows[0].relrowsecurity, true);
        });
        await t.test('owner foreign key is indexed', async () => {
            assert.equal((await db.query(`select count(*)::integer as n from pg_indexes
                where schemaname='public' and tablename='servers'
                and indexname='servers_owner_user_id_idx'`)).rows[0].n, 1);
        });
    } finally { await db.close(); }
});

test('hardening fails atomically for an unexpected same-name function', async () => {
    const db = await PGlite.create();
    try {
        await db.exec(fs.readFileSync(path.join(__dirname, 'bootstrap.sql'), 'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261004161756_control_plane_foundation.sql'), 'utf8'));
        await db.exec('create function public.rls_auto_enable() returns integer language sql as $$ select 1 $$');
        await assert.rejects(() => db.exec(hardening), /Unexpected automatic-RLS helper type/);
        await db.exec('rollback');
        assert.equal((await db.query(`select to_regclass('public.servers_owner_user_id_idx') as idx`)).rows[0].idx, null);
        assert.equal((await db.query(`select has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') as allowed`)).rows[0].allowed, true);
    } finally { await db.close(); }
});
