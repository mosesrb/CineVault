'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createStore}=require('../../services/controlPlane/store');
const {initialState,renewPairing,PROJECT_REF}=require('../../services/controlPlane/protocol');
const BASE=path.resolve(__dirname,'../../runtime/qa/protected-store-tests');
const nativeTest=(name,fn)=>test(name,{skip:process.platform!=='win32'},fn);
async function fixture(t){
    await fs.mkdir(BASE,{recursive:true});const directory=path.join(BASE,'case-'+crypto.randomUUID());
    const instance=crypto.randomUUID(),options={directory,projectRef:PROJECT_REF,serverInstanceId:instance};
    const store=createStore(options);
    t.after(async()=>{
        assert.equal(path.dirname(directory),BASE);assert.match(path.basename(directory),/^case-[a-f0-9-]{36}$/);
        try{assert.equal((await fs.lstat(directory)).isSymbolicLink(),false);await fs.rm(directory,{recursive:true,force:true});}
        catch(error){if(error.code!=='ENOENT')throw error;}
    });
    assert.equal(await store.read(),null);
    const state=initialState(PROJECT_REF,instance,Date.now());await store.writeAtomic(state);
    const active={...state,status:'active',mapping:{projectRef:PROJECT_REF,serverInstanceId:instance,
        credentialId:state.credentialId,cloudServerId:crypto.randomUUID(),epoch:1,credentialExpiresAt:Date.now()+86400000},sequence:0,pending:null};
    return {options,store,state,active,directory};
}
nativeTest('production Windows store rejects non-runtime/relative/UNC/stream paths',()=>{
    for(const directory of [path.resolve(__dirname,'tracked'),'relative','\\\\server\\share',BASE+':stream'])
        assert.throws(()=>createStore({directory,projectRef:PROJECT_REF,serverInstanceId:crypto.randomUUID()}));
});
nativeTest('production native state survives reopening with exact pending secrets and mapping',async t=>{
    const f=await fixture(t);assert.deepEqual(await createStore(f.options).read(),f.state);
    await f.store.writeAtomic(f.active);assert.deepEqual(await createStore(f.options).read(),f.active);
});
nativeTest('production outbox persists and exact ACK transition survives restart',async t=>{
    const f=await fixture(t);await f.store.writeAtomic(f.active);
    const next={...f.active,pending:{operation:'heartbeat',idempotencyKey:crypto.randomUUID(),sequence:1,activity:'media-work'}};
    await f.store.writeAtomic(next);const other=createStore(f.options);assert.deepEqual(await other.read(),next);
    await other.writeAtomic({...next,sequence:1,pending:null});assert.equal((await createStore(f.options).read()).sequence,1);
});
nativeTest('production separate stale writer fails CAS and cannot clear a newer operation',async t=>{
    const f=await fixture(t),other=createStore(f.options);await other.read();await f.store.writeAtomic(f.active);
    await assert.rejects(other.writeAtomic(f.state));assert.deepEqual(await other.read(),f.active);
});
nativeTest('production renewed initial candidate survives native reopen and denies stale original writer',async t=>{
    const f=await fixture(t),stale=createStore(f.options);await stale.read();
    const renewed=renewPairing(f.state,f.state.expiresAt);await f.store.writeAtomic(renewed);
    assert.deepEqual(await createStore(f.options).read(),renewed);
    await assert.rejects(stale.writeAtomic(f.state));assert.equal((await stale.read()).secret,f.state.secret);
});
nativeTest('production state denies credential replacement, project reuse and corrupted bytes',async t=>{
    const f=await fixture(t);await assert.rejects(f.store.writeAtomic({...f.state,secret:'0'.repeat(64)}));
    await assert.rejects(createStore({...f.options,projectRef:'a'.repeat(20)}).read());
    const file=path.join(f.directory,'state.json');await fs.writeFile(file,'invalid-synthetic-json');
    await assert.rejects(f.store.read());assert.equal(await fs.readFile(file,'utf8'),'invalid-synthetic-json');
});
nativeTest('production native replacement candidate/previous mapping survive reopen and CAS rejects stale writer',async t=>{
    const f=await fixture(t);await f.store.writeAtomic(f.active);const stale=createStore(f.options);await stale.read();
    const candidate=initialState(PROJECT_REF,f.state.serverInstanceId,Date.now());
    const replacing={version:2,status:'replacing',projectRef:PROJECT_REF,serverInstanceId:f.state.serverInstanceId,previous:f.active,candidate};
    await f.store.writeAtomic(replacing);const current=createStore(f.options);assert.deepEqual(await current.read(),replacing);
    await assert.rejects(stale.writeAtomic(f.active));
    await current.writeAtomic({...candidate,status:'active',mapping:{...f.active.mapping,credentialId:candidate.credentialId,epoch:2},sequence:0,pending:null});
    const saved=await createStore(f.options).read();assert.equal(saved.secret,candidate.secret);assert.equal(saved.mapping.cloudServerId,f.active.mapping.cloudServerId);assert.equal(saved.mapping.epoch,2);
});
