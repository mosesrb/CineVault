// Actual disposable SQL transactions, not hosted Auth or parallel-connection proof.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const project = 'uouydbapluktfrylligo';
const owner = uuid(1), other = uuid(2), session = uuid(3), otherSession = uuid(4);
const instance = uuid(10), foreign = uuid(11), approval = uuid(20), grant = uuid(30), credential = uuid(40);
const digest = n => Buffer.alloc(32,n);

async function fixture() {
    const db = await PGlite.create();
    try {
        await db.exec(fs.readFileSync(path.join(__dirname,'bootstrap.sql'),'utf8'));
        // TEST ONLY shape needed by the prototype, never a hosted Auth migration.
        await db.exec(`alter table auth.users add is_anonymous boolean default false,
            add banned_until timestamptz, add deleted_at timestamptz;
            create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);`);
        await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261004161756_control_plane_foundation.sql'),'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261004161817_control_plane_hardening.sql'),'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname,'../../scripts/prototypes/enrollment_transactions.sql'),'utf8'));
        for (const [user,sid] of [[owner,session],[other,otherSession]]) {
            await db.query('insert into auth.users(id) values($1)',[user]);
            await db.query('insert into public.profiles(id) values($1)',[user]);
            await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid,user]);
        }
        for (const [inst,user,sid,aid,gid,cid,bind,poll,secret] of [
            [instance,owner,session,approval,grant,credential,1,2,3],
            [foreign,other,otherSession,uuid(21),uuid(31),uuid(41),4,5,6]
        ]) {
            await db.query('insert into cv_enrollment_lab.installations(instance_id,project_ref,owner_id) values($1,$2,$3)',[inst,project,user]);
            await db.query(`insert into cv_enrollment_lab.approvals(id,instance_id,owner_id,session_id,binding_digest,jwt_expires_at)
                values($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')`,[aid,inst,user,sid,digest(bind)]);
            await db.query(`insert into cv_enrollment_lab.grants(id,approval_id,credential_id,secret_digest,poll_digest,expires_at)
                values($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')`,[gid,aid,cid,digest(secret),digest(poll)]);
        }
        return db;
    } catch (error) { await db.close(); throw error; }
}

async function broker(db,operation) {
    await db.exec('savepoint broker_call');
    await db.exec('set role cv_enrollment_lab_broker');
    try {
        const result=await operation();
        await db.exec('reset role; release savepoint broker_call');
        return result;
    } catch(error) {
        // Recover the failed statement without hiding its original SQL error.
        await db.exec('rollback to savepoint broker_call; release savepoint broker_call');
        throw error;
    }
}
const consume = (db,args=[grant,project,instance,digest(1),digest(2)]) => broker(db,async()=>
    (await db.query('select cv_enrollment_lab.consume($1,$2,$3,$4,$5) as result',args)).rows[0].result);
const revoke = (db,user=owner,sid=session,expiry=new Date(Date.now()+60000)) => broker(db,()=>
    db.query('select cv_enrollment_lab.revoke($1,$2,$3,$4)',[instance,user,sid,expiry]));
const denied = operation => assert.rejects(operation,{code:'42501',message:'enrollment_denied'});

test('private enrollment transactions on disposable PostgreSQL',async t=>{
    const db=await fixture();
    // Savepoints preserve the exact initial synthetic fixture across cases.
    async function check(name,operation) {
        await t.test(name,async()=>{
            await db.exec('begin');
            try { await operation(); } finally { await db.exec('rollback'); }
        });
    }
    try {
        await check('consume once and exact lost-response retry returns only stable non-secret mapping',async()=>{
            const first=await consume(db), retry=await consume(db);
            assert.deepEqual(first,retry);
            assert.deepEqual(Object.keys(first).sort(),['credentialId','epoch','serverId','serverInstanceId']);
            assert.equal(first.credentialId,credential); assert.equal(first.serverInstanceId,instance); assert.equal(first.epoch,1);
            const rows=await db.query('select status,last_heartbeat_at,owner_user_id from public.servers');
            assert.deepEqual(rows.rows,[{status:'OFFLINE',last_heartbeat_at:null,owner_user_id:owner}]);
            assert.equal((await db.query('select count(*)::int as n from cv_enrollment_lab.credentials')).rows[0].n,1);
            assert.equal((await db.query('select count(*)::int as n from public.server_users')).rows[0].n,0);
            assert.equal((await db.query('select count(*)::int as n from public.server_endpoints')).rows[0].n,0);
        });
        for(const [name,args] of [
            ['different project',[grant,'aaaaaaaaaaaaaaaaaaaa',instance,digest(1),digest(2)]],
            ['cross-installation',[grant,project,foreign,digest(1),digest(2)]],
            ['changed full request binding',[grant,project,instance,digest(9),digest(2)]],
            ['wrong polling proof',[grant,project,instance,digest(1),digest(9)]],
            ['missing grant',[uuid(99),project,instance,digest(1),digest(2)]],
            ['null binding',[grant,project,instance,null,digest(2)]]
        ]) await check(name+' denies without writing',async()=>{
            await denied(()=>consume(db,args));
            assert.equal((await db.query('select count(*)::int as n from public.servers')).rows[0].n,0);
        });
        // Each denial is isolated so an expected SQL error cannot poison the next case.
        for(const [name,sql,args] of [
            ['revoked grant','update cv_enrollment_lab.grants set revoked=true where id=$1',[grant]],
            ['expired grant',`update cv_enrollment_lab.grants set issued_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' where id=$1`,[grant]],
            ['future-issued grant',`update cv_enrollment_lab.grants set issued_at=clock_timestamp()+interval '1 minute',expires_at=clock_timestamp()+interval '2 minutes' where id=$1`,[grant]],
            ['disabled approval','update cv_enrollment_lab.approvals set enabled=false where id=$1',[approval]],
            ['expired approval JWT',`update cv_enrollment_lab.approvals set jwt_expires_at=clock_timestamp()-interval '1 second' where id=$1`,[approval]],
            ['changed owner','update cv_enrollment_lab.approvals set owner_id=$1 where id=$2',[other,approval]],
            ['foreign session','update cv_enrollment_lab.approvals set session_id=$1 where id=$2',[otherSession,approval]],
            ['missing session','delete from auth.sessions where id=$1',[session]],
            ['expired session',`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1`,[session]],
            ['blocked profile','update public.profiles set blocked=true where id=$1',[owner]],
            ['password-change profile','update public.profiles set must_change_password=true where id=$1',[owner]],
            ['anonymous owner','update auth.users set is_anonymous=true where id=$1',[owner]],
            ['banned owner',`update auth.users set banned_until=clock_timestamp()+interval '1 minute' where id=$1`,[owner]],
            ['deleted owner','update auth.users set deleted_at=clock_timestamp() where id=$1',[owner]],
            ['disabled installation','update cv_enrollment_lab.installations set enabled=false where instance_id=$1',[instance]]
        ]) await check(name+' denies cached retry',async()=>{
            await consume(db);
            await db.query(sql,args);
            await denied(()=>consume(db));
        });
        await check('missing profile removes fixture grant and denies before consumption',async()=>{
            await db.query('delete from public.profiles where id=$1',[owner]);
            await denied(()=>consume(db));
        });
        await check('existing foundation refuses deletion of a mapped owner profile',async()=>{
            await consume(db);
            await db.exec('savepoint deletion');
            await assert.rejects(()=>db.query('delete from public.profiles where id=$1',[owner]),{code:'23503'});
            await db.exec('rollback to savepoint deletion; release savepoint deletion');
            assert.ok((await consume(db)).serverId);
        });
        for(const [name,sql] of [
            ['revoked credential','set revoked=true'],
            ['expired credential',"set expires_at=clock_timestamp()-interval '1 second'"],
            ['changed credential digest',"set secret_digest=decode(repeat('ff',32),'hex')"]
        ]) await check(name+' denies cached mapping',async()=>{
            await consume(db); await db.query(`update cv_enrollment_lab.credentials ${sql} where id=$1`,[credential]);
            await denied(()=>consume(db));
        });
        await check('existing clone UUID mapping is not adopted or overwritten',async()=>{
            await db.query("insert into public.servers(id,owner_user_id,server_instance_id,name) values($1,$2,$3,'Existing')",[uuid(100),other,instance]);
            await denied(()=>consume(db));
        });
        await check('revoke cannot withhold a foreign clone mapping or endpoint',async()=>{
            await db.query("insert into public.servers(id,owner_user_id,server_instance_id,name,status) values($1,$2,$3,'Foreign','ONLINE')",[uuid(100),other,instance]);
            await db.query(`insert into public.server_endpoints(server_id,provider,mode,endpoint_url,generation,status,verified_at)
                values($1,'qa','PUBLIC_REMOTE','https://qa.invalid/',1,'ONLINE',clock_timestamp())`,[uuid(100)]);
            await denied(()=>revoke(db));
            assert.equal((await db.query('select status from public.servers')).rows[0].status,'ONLINE');
            assert.equal((await db.query('select status from public.server_endpoints')).rows[0].status,'ONLINE');
            assert.equal((await db.query('select revoked from cv_enrollment_lab.grants where id=$1',[grant])).rows[0].revoked,false);
        });
        await check('revoke rejects a credential mapping whose current server owner differs',async()=>{
            const result=await consume(db);
            await db.query("update public.servers set owner_user_id=$1,status='ONLINE' where id=$2",[other,result.serverId]);
            await denied(()=>revoke(db));
            assert.equal((await db.query('select status from public.servers')).rows[0].status,'ONLINE');
            assert.equal((await db.query('select revoked from cv_enrollment_lab.credentials')).rows[0].revoked,false);
        });
        await check('second approved grant cannot replace the first credential',async()=>{
            const result=await consume(db);
            await db.query(`insert into cv_enrollment_lab.approvals(id,instance_id,owner_id,session_id,binding_digest,jwt_expires_at)
                values($1,$2,$3,$4,$5,clock_timestamp()+interval '1 minute')`,[uuid(22),instance,owner,session,digest(7)]);
            await db.query(`insert into cv_enrollment_lab.grants(id,approval_id,credential_id,secret_digest,poll_digest,expires_at)
                values($1,$2,$3,$4,$5,clock_timestamp()+interval '1 minute')`,[uuid(32),uuid(22),uuid(42),digest(8),digest(9)]);
            await denied(()=>consume(db,[uuid(32),project,instance,digest(7),digest(9)]));
            assert.deepEqual(await consume(db),result);
        });
        for(const kind of ['JWT','session']) await check(kind+' expiry during a later SQL step rolls back revocation',async()=>{
            await consume(db);
            // Deterministic single-connection delay in a test-only trigger. This
            // exercises late wall-clock expiry, NOT a multi-connection lock race.
            await db.exec(`create function cv_enrollment_lab.qa_delay() returns trigger language plpgsql as $$
                begin perform pg_sleep(0.15); return new; end $$;
                create trigger qa_delay before update on cv_enrollment_lab.grants
                for each row execute function cv_enrollment_lab.qa_delay();`);
            if(kind==='session')await db.query(`update auth.sessions set not_after=clock_timestamp()+interval '50 milliseconds' where id=$1`,[session]);
            const started=Date.now();
            await denied(()=>broker(db,()=>db.query(`select cv_enrollment_lab.revoke($1,$2,$3,clock_timestamp()+interval '${kind==='JWT'?'50 milliseconds':'1 minute'}')`,[instance,owner,session])));
            assert.ok(Date.now()-started>=100,'late test step actually executed');
            assert.equal((await db.query('select revoked from cv_enrollment_lab.grants where id=$1',[grant])).rows[0].revoked,false);
            assert.equal((await db.query('select revoked from cv_enrollment_lab.credentials where id=$1',[credential])).rows[0].revoked,false);
        });
        await check('revoke after consume disables exact replay and withholds endpoint',async()=>{
            const result=await consume(db);
            await db.query(`insert into public.server_endpoints(server_id,provider,mode,endpoint_url,generation,status,verified_at)
                values($1,'qa','PUBLIC_REMOTE','https://qa.invalid/',1,'ONLINE',clock_timestamp())`,[result.serverId]);
            await revoke(db);
            assert.deepEqual((await db.query('select status,verified_at from public.server_endpoints')).rows,[{status:'OFFLINE',verified_at:null}]);
            await denied(()=>consume(db));
        });
        await check('foreign owner cannot revoke installation',async()=>{await denied(()=>revoke(db,other,otherSession));});
        await check('expired human JWT cannot revoke installation',async()=>{await denied(()=>revoke(db,owner,session,new Date(0)));});
        await check('independent second installation does not reuse first credential or mapping',async()=>{
            const a=await consume(db), b=await consume(db,[uuid(31),project,foreign,digest(4),digest(5)]);
            assert.notEqual(a.serverId,b.serverId); assert.notEqual(a.credentialId,b.credentialId);
            await revoke(db); assert.deepEqual(await consume(db,[uuid(31),project,foreign,digest(4),digest(5)]),b);
        });
        await check('transaction rollback does not strand one-use grant',async()=>{
            await db.exec('savepoint attempt'); await consume(db); await db.exec('rollback to savepoint attempt');
            assert.equal((await db.query('select count(*)::int as n from public.servers')).rows[0].n,0);
            assert.equal((await db.query('select consumed_at from cv_enrollment_lab.grants where id=$1',[grant])).rows[0].consumed_at,null);
            assert.ok((await consume(db)).serverId);
        });
        for(const role of ['anon','authenticated','service_role','cv_enrollment_lab_broker'])
            await check(role+' has no private CRUD or helper execute authority',async()=>{
                for(const table of ['installations','approvals','grants','credentials']) {
                    const row=(await db.query(`select has_table_privilege($1,$2,'SELECT') as s,has_table_privilege($1,$2,'INSERT') as i,
                        has_table_privilege($1,$2,'UPDATE') as u,has_table_privilege($1,$2,'DELETE') as d`,[role,'cv_enrollment_lab.'+table])).rows[0];
                    assert.deepEqual(row,{s:false,i:false,u:false,d:false});
                }
                assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as e',[role,'cv_enrollment_lab.current_owner(uuid,uuid,uuid)'])).rows[0].e,false);
                const permitted=role==='cv_enrollment_lab_broker';
                assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as e',[role,'cv_enrollment_lab.consume(uuid,text,uuid,bytea,bytea)'])).rows[0].e,permitted);
                assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as e',[role,'cv_enrollment_lab.revoke(uuid,uuid,uuid,timestamptz)'])).rows[0].e,permitted);
            });
        await check('private tables have RLS and definer functions pin empty search path',async()=>{
            const tables=await db.query("select relrowsecurity from pg_class where relnamespace='cv_enrollment_lab'::regnamespace and relkind='r'");
            assert.equal(tables.rows.length,4); assert.ok(tables.rows.every(r=>r.relrowsecurity));
            const funcs=await db.query("select prosecdef,proconfig from pg_proc where pronamespace='cv_enrollment_lab'::regnamespace");
            assert.equal(funcs.rows.length,3); assert.ok(funcs.rows.every(r=>r.prosecdef && r.proconfig.includes('search_path=""')));
        });
    } finally { await db.close(); }
});
