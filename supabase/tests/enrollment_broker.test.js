'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');
const { prepare } = require('../../scripts/prototypes/pairing');
const { challenge, bindingDigest } = require('../../scripts/prototypes/enrollment_authority');
const { createLabBroker } = require('../../scripts/prototypes/enrollment_broker');
const REF = 'aaaaaaaaaaaaaaaaaaaa', owner = crypto.randomUUID(), session = crypto.randomUUID(), instance = crypto.randomUUID();
const pair = crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const config = () => ({enabled:true,projectRef:REF,projectUrl:`https://${REF}.supabase.co`,publishableKey:'sb_publishable_synthetic_fixture_1234567890'});
const hex = value => Buffer.from(value,'hex');
const denied = action => assert.rejects(action,e=>e.message==='enrollment_denied');
const response = (body,url,status=200) => {
    const r = new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
    Object.defineProperty(r,'url',{value:url}); return r;
};
async function schema() {
    const db = await PGlite.create();
    try {
        for (const file of ['bootstrap.sql']) await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));
        await db.exec(`alter table auth.users add is_anonymous boolean default false, add banned_until timestamptz, add deleted_at timestamptz;
            create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);`);
        for (const file of ['../migrations/20261004161756_control_plane_foundation.sql','../migrations/20261004161817_control_plane_hardening.sql',
            '../../scripts/prototypes/enrollment_transactions.sql','../../scripts/prototypes/enrollment_broker.sql']) {
            await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));
        }
        return db;
    } catch(e) { await db.close(); throw e; }
}
async function fixture(db,options={}) {
    // Reset only this in-memory disposable DB; NEVER a hosted/production connection.
    await db.exec(`truncate cv_enrollment_lab.installations,cv_enrollment_lab.approvals,cv_enrollment_lab.grants,
        cv_enrollment_lab.credentials,public.servers,public.server_users,public.server_endpoints,public.profiles,auth.users,auth.sessions cascade;`);
    const state = await prepare({store:{read:async()=>null,writeAtomic:async()=>{}},projectRef:REF,serverInstanceId:instance,localAdminApproved:true});
    const {request,approvalProof} = challenge(state,REF,instance), grantId=crypto.randomUUID();
    await db.query('insert into auth.users(id) values($1)',[owner]);
    await db.query('insert into public.profiles(id) values($1)',[owner]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
    await db.query('insert into cv_enrollment_lab.installations(instance_id,project_ref,owner_id) values($1,$2,$3)',[instance,REF,owner]);
    await db.query(`insert into cv_enrollment_lab.approvals(id,instance_id,owner_id,session_id,binding_digest,jwt_expires_at)
        values($1,$2,$3,$4,$5,$6)`,[request.pairId,instance,owner,session,hex(bindingDigest(request)),new Date(request.expiresAt)]);
    await db.query(`insert into cv_enrollment_lab.grants(id,approval_id,credential_id,secret_digest,poll_digest,expires_at)
        values($1,$2,$3,$4,$5,$6)`,[grantId,request.pairId,request.credentialId,hex(request.secretDigest),hex(request.pollDigest),new Date(request.expiresAt)]);
    const calls=[]; let user={id:owner,is_anonymous:false}, transformQuery=null, afterCommit=null;
    const database = { transaction: async action => {
        const result = await db.transaction(async tx => {
            await tx.exec('set local role cv_enrollment_lab_broker');
            return action({query:async(sql,params)=>{
                calls.push({sql,params}); const result=await tx.query(sql,params);
                return transformQuery ? transformQuery(sql,result,tx) : result;
            }});
        });
        return afterCommit ? afterCommit(result) : result;
    }};
    const broker = createLabBroker({config:config(),database,admit:async input=>{calls.push({admission:input});return true;},
        fetchKeys:async url=>{calls.push({jwks:true});return response({keys:[{...pair.publicKey.export({format:'jwk'}),kid:'one',alg:'ES256'}]},url);},
        fetchUser:async url=>{calls.push({auth:true});return response(user,url);},...options});
    const now=Math.floor(Date.now()/1000);
    const claims={iss:`https://${REF}.supabase.co/auth/v1`,aud:'authenticated',role:'authenticated',sub:owner,session_id:session,is_anonymous:false,iat:now,exp:now+3600};
    const token=changes=>jwt.sign({...claims,...changes},pair.privateKey,{algorithm:'ES256',header:{kid:'one'}});
    return {broker,calls,state,request,approvalProof,grantId,token,database,
        args:()=>({request:structuredClone(request),pollSecret:state.pollSecret}),
        authArgs:()=>({request:structuredClone(request),approvalProof,accessToken:token()}),
        setUser:v=>{user=v;},setTransform:v=>{transformQuery=v;},setAfterCommit:v=>{afterCommit=v;}};
}
async function count(db) {
    const rows=await db.query('select (select count(*)::int from public.servers) as servers,(select count(*)::int from cv_enrollment_lab.credentials) as credentials');
    return rows.rows[0];
}
test('trusted broker composition on disposable PostgreSQL',async t=>{
    const db=await schema();
    const check=(name,action)=>t.test(name,async()=>{const f=await fixture(db);await action(f);});
    try {
        await check('existing human approval reads actual current SQL rows after signature and Auth',async f=>{
            const result=await f.broker.authorizeExistingApproval(f.authArgs()); assert.equal(result.userId,owner); assert.equal(result.sessionId,session);
            assert.equal(f.calls.some(c=>c.sql?.includes('read_current')),true); assert.deepEqual(await count(db),{servers:0,credentials:0});
            assert.equal(f.calls.find(c=>c.admission).admission.operation,'existing-approval');
        });
        await t.test('late Auth completion cannot return authorization when timeout timer is delayed',async()=>{
            let late=false;
            const f=await fixture(db,{timeoutMs:100,fetchUser:async url=>{
                if(late) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);
                return response({id:owner,is_anonymous:false},url);
            }});
            await f.broker.authorizeExistingApproval(f.authArgs()); // Valid current rows and a warm signing-key cache.
            late=true; await denied(f.broker.authorizeExistingApproval(f.authArgs()));
            assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        await check('canonical raw poll consumes once and exact retry returns stable non-secret mapping',async f=>{
            const first=await f.broker.consume(f.args()),retry=await f.broker.consume(f.args()); assert.deepEqual(first,retry);
            assert.equal(first.credentialId,f.request.credentialId); assert.equal(first.serverInstanceId,instance); assert.equal(first.epoch,1);
            assert.equal(Object.isFrozen(first),true); assert.deepEqual(Object.keys(first).sort(),['credentialId','epoch','serverId','serverInstanceId']);
            assert.deepEqual(await count(db),{servers:1,credentials:1});
            assert.equal((await db.query('select status,last_heartbeat_at from public.servers')).rows[0].status,'OFFLINE');
            assert.equal((await db.query('select count(*)::int as n from public.server_users')).rows[0].n,0);
            assert.equal((await db.query('select count(*)::int as n from public.server_endpoints')).rows[0].n,0);
            assert.equal(f.calls.some(c=>c.auth||c.jwks),false); // Owner token never on PC poll path.
        });
        await check('digest-only, operational secret and unknown body fields cannot poll',async f=>{
            for(const input of [{request:f.request,pollSecret:f.request.pollDigest},{request:f.request,pollSecret:f.state.secret},
                {...f.args(),grantId:f.grantId},{...f.args(),ownerId:owner},{...f.args(),pollSecret:[f.state.pollSecret]}]) await denied(f.broker.consume(input));
            assert.equal(f.calls.length,0); assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        for(const field of ['serverInstanceId','pairId','credentialId','idempotencyKey']) await check(`full request rejects changed ${field}`,async f=>{
            const args=f.args();args.request[field]=crypto.randomUUID();await denied(f.broker.consume(args));assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        for(const field of ['secretDigest','approvalDigest']) await check(`full request rejects changed ${field}`,async f=>{
            const args=f.args();args.request[field]='0'.repeat(64);await denied(f.broker.consume(args));assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        await check('self-chosen capability and self-consistent body do not match trusted stored binding',async f=>{
            const args=f.args();args.pollSecret='1'.repeat(64);args.request.pollDigest=crypto.createHash('sha256').update(args.pollSecret).digest('hex');
            await denied(f.broker.consume(args));assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        for(const [name,sql] of [
            ['revoked grant','update cv_enrollment_lab.grants set revoked=true'],
            ['disabled approval','update cv_enrollment_lab.approvals set enabled=false'],
            ['disabled installation','update cv_enrollment_lab.installations set enabled=false'],
            ['blocked profile','update public.profiles set blocked=true'],
            ['password change','update public.profiles set must_change_password=true'],
            ['deleted session','delete from auth.sessions'],
            ['expired session',"update auth.sessions set not_after=clock_timestamp()-interval '1 second'"],
            ['anonymous user','update auth.users set is_anonymous=true'],
            ['deleted user',"update auth.users set deleted_at=clock_timestamp()"],
            ['banned user',"update auth.users set banned_until=clock_timestamp()+interval '1 minute'"],
            ['expired approval JWT',"update cv_enrollment_lab.approvals set jwt_expires_at=clock_timestamp()-interval '1 second'"]
        ]) await check(`SQL current ${name} denies exact duplicate retry`,async f=>{
            await f.broker.consume(f.args());await db.exec(sql);await denied(f.broker.consume(f.args()));assert.deepEqual(await count(db),{servers:1,credentials:1});
        });
        await check('revocation between pending lookup and consume denies before creating mapping',async f=>{
            f.setTransform(async(sql,result,tx)=>{
                if(sql.includes('.pending(')) { await tx.exec('reset role');await tx.exec('update public.profiles set blocked=true');await tx.exec('set local role cv_enrollment_lab_broker'); }
                return result;
            });
            await denied(f.broker.consume(f.args()));assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        await check('changed operational digest after pending lookup cannot create a wrong credential',async f=>{
            f.setTransform(async(sql,result,tx)=>{
                if(sql.includes('.pending(')) {
                    await tx.exec('reset role');
                    await tx.query('update cv_enrollment_lab.grants set secret_digest=$1',[Buffer.alloc(32,9)]);
                    await tx.exec('set local role cv_enrollment_lab_broker');
                }
                return result;
            });
            await denied(f.broker.consume(f.args()));assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        await check('malformed response rolls back already executed consumption',async f=>{
            f.setTransform((sql,result)=>sql.includes('.consume_bound(')?{rows:[{result:{...result.rows[0].result,secret:'synthetic'}}]}:result);
            await denied(f.broker.consume(f.args()));assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        await check('unknown commit reply is recovered only by exact same pending retry',async f=>{
            f.setAfterCommit(()=>{throw Error('synthetic lost commit reply');});await denied(f.broker.consume(f.args()));assert.deepEqual(await count(db),{servers:1,credentials:1});
            f.setAfterCommit(null);const mapping=await f.broker.consume(f.args());assert.equal(mapping.credentialId,f.request.credentialId);assert.deepEqual(await count(db),{servers:1,credentials:1});
        });
        await check('Auth rejection and forged signed metadata cannot replace current approval',async f=>{
            f.setUser({id:crypto.randomUUID(),is_anonymous:false});await denied(f.broker.authorizeExistingApproval(f.authArgs()));
            f.setUser({id:owner,is_anonymous:false});await db.exec('update cv_enrollment_lab.approvals set enabled=false');
            await denied(f.broker.authorizeExistingApproval({...f.authArgs(),accessToken:f.token({user_metadata:{owner:true},app_metadata:{role:'ADMIN'}})}));
        });
        await check('current SQL preflight rejects a different session and foreign owner',async f=>{
            for(const claims of [{session_id:crypto.randomUUID()},{sub:crypto.randomUUID()}]) await denied(f.broker.authorizeExistingApproval({...f.authArgs(),accessToken:f.token(claims)}));
            assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        await check('ambiguous duplicate approval binding fails closed in current reader',async f=>{
            await db.query(`insert into cv_enrollment_lab.approvals(id,instance_id,owner_id,session_id,binding_digest,jwt_expires_at)
                select $1,instance_id,owner_id,session_id,binding_digest,jwt_expires_at from cv_enrollment_lab.approvals`,[crypto.randomUUID()]);
            await denied(f.broker.authorizeExistingApproval(f.authArgs()));assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        await check('new helpers have no ordinary-client/service-role EXECUTE or broker CRUD',async()=>{
            const r=await db.query(`select role,has_function_privilege(role,'cv_enrollment_lab.pending(uuid,uuid)','EXECUTE') as pending,
                has_function_privilege(role,'cv_enrollment_lab.read_current(uuid,uuid,text,uuid,bytea)','EXECUTE') as current,
                has_table_privilege(role,'cv_enrollment_lab.grants','SELECT') as crud from unnest(array['anon','authenticated','service_role','cv_enrollment_lab_broker']) role`);
            assert.deepEqual(r.rows.map(x=>[x.role,x.pending,x.current,x.crud]),[['anon',false,false,false],['authenticated',false,false,false],['service_role',false,false,false],['cv_enrollment_lab_broker',true,true,false]]);
            const guard=await db.query(`select role,has_function_privilege(role,'cv_enrollment_lab.consume_bound(uuid,text,uuid,bytea,bytea,uuid,bytea)','EXECUTE') as bound,
                has_function_privilege(role,'cv_enrollment_lab.consume(uuid,text,uuid,bytea,bytea)','EXECUTE') as core from unnest(array['anon','authenticated','service_role','cv_enrollment_lab_broker']) role`);
            assert.deepEqual(guard.rows.map(x=>[x.role,x.bound,x.core]),[['anon',false,false],['authenticated',false,false],['service_role',false,false],['cv_enrollment_lab_broker',true,false]]);
        });
        await t.test('admission is exact trusted constructor contract and bounded before DB',async()=>{
            for(const admit of [async()=>false,async()=> 'true',async()=>new Promise(()=>{})]) {
                const f=await fixture(db,{admit,timeoutMs:20});await denied(f.broker.consume(f.args()));assert.equal(f.calls.length,0);
            }
        });
        await t.test('late query completion throws inside callback and rolls back, not detached Promise.race',async()=>{
            const f=await fixture(db,{timeoutMs:30});f.setTransform((sql,result)=>{
                if(sql.includes('.consume_bound(')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60);return result;
            });
            await denied(f.broker.consume(f.args()));assert.deepEqual(await count(db),{servers:0,credentials:0});
        });
        await t.test('input is detached before admission waits',async()=>{
            let release,entered;const wait=new Promise(r=>{release=r;}),start=new Promise(r=>{entered=r;});
            const f=await fixture(db,{admit:async()=>{entered();await wait;return true;}});const args=f.args();const pending=f.broker.consume(args);
            await start;args.request.credentialId=crypto.randomUUID();args.pollSecret='0'.repeat(64);release();
            const result=await pending;assert.equal(result.credentialId,f.request.credentialId);
        });
    } finally {await db.close();}
});
