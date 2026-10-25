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
const restoring=f=>({version:3,status:'recovering',projectRef:PROJECT_REF,serverInstanceId:f.state.serverInstanceId,
    cloudServerId:f.active.mapping.cloudServerId,candidate:initialState(PROJECT_REF,f.state.serverInstanceId,Date.now())});
nativeTest('explicit native restore archives damaged bytes before replacement and survives reopen',async t=>{
    const f=await fixture(t),raw='{damaged-synthetic-json';await fs.writeFile(path.join(f.directory,'state.json'),raw);
    await assert.rejects(f.store.read());assert.equal(await f.store.readForRecovery(),null);
    const state=restoring(f);await f.store.writeRecoveryAtomic(state);assert.deepEqual(await createStore(f.options).read(),state);
    const archive='state.recovery.'+crypto.createHash('sha256').update(raw).digest('hex')+'.json';
    assert.equal(await fs.readFile(path.join(f.directory,archive),'utf8'),raw);
    const current=createStore(f.options);await current.read();await current.writeAtomic({...state.candidate,status:'active',mapping:{...f.active.mapping,credentialId:state.candidate.credentialId,epoch:2},sequence:0,pending:null});
    assert.equal((await createStore(f.options).read()).mapping.cloudServerId,f.active.mapping.cloudServerId);
});
nativeTest('explicit native restore stale raw digest cannot overwrite concurrent normal write',async t=>{
    const f=await fixture(t),stale=createStore(f.options);await stale.readForRecovery();await f.store.writeAtomic(f.active);
    await assert.rejects(stale.writeRecoveryAtomic(restoring(f)));assert.deepEqual(await stale.read(),f.active);
    assert.equal((await fs.readdir(f.directory)).filter(n=>n.startsWith('state.recovery.')).length,0);
});
nativeTest('explicit native restore never bypasses orphan temporary or invalid UTF8 state',async t=>{
    const f=await fixture(t);await fs.writeFile(path.join(f.directory,'state.tmp'),'synthetic-orphan');
    await assert.rejects(f.store.readForRecovery());await assert.rejects(f.store.writeRecoveryAtomic(restoring(f)));
    await fs.unlink(path.join(f.directory,'state.tmp'));await fs.writeFile(path.join(f.directory,'state.json'),Buffer.from([0xff,0xfe,0xff]));
    await assert.rejects(f.store.readForRecovery());await assert.rejects(f.store.writeRecoveryAtomic(restoring(f)));
    assert.deepEqual(await fs.readFile(path.join(f.directory,'state.json')),Buffer.from([0xff,0xfe,0xff]));
});
nativeTest('restore archives are bounded and never automatically deleted',async t=>{
    const f=await fixture(t);let store=f.store;
    for(let i=0;i<8;i++){await store.readForRecovery();await store.writeRecoveryAtomic(restoring(f));store=createStore(f.options);}
    const before=await store.read();await store.readForRecovery();await assert.rejects(store.writeRecoveryAtomic(restoring(f)));
    assert.deepEqual(await store.read(),before);assert.equal((await fs.readdir(f.directory)).filter(n=>n.startsWith('state.recovery.')).length,8);
});
nativeTest('explicit restore of missing state stages a new candidate without fabricating an archive',async t=>{
    const f=await fixture(t);await fs.unlink(path.join(f.directory,'state.json'));assert.equal(await f.store.readForRecovery(),null);
    const state=restoring(f);await f.store.writeRecoveryAtomic(state);assert.deepEqual(await createStore(f.options).read(),state);
    assert.equal((await fs.readdir(f.directory)).filter(n=>n.startsWith('state.recovery.')).length,0);
});
nativeTest('an existing untrusted archive blocks restore without overwriting original bytes',async t=>{
    const f=await fixture(t),before=await fs.readFile(path.join(f.directory,'state.json'));
    const archive='state.recovery.'+crypto.createHash('sha256').update(before).digest('hex')+'.json';
    await fs.writeFile(path.join(f.directory,archive),'synthetic-untrusted');await f.store.readForRecovery();
    await assert.rejects(f.store.writeRecoveryAtomic(restoring(f)));assert.deepEqual(await fs.readFile(path.join(f.directory,'state.json')),before);
    assert.equal(await fs.readFile(path.join(f.directory,archive),'utf8'),'synthetic-untrusted');
});
nativeTest('process exit after archive flush leaves original state intact before atomic replacement',async t=>{
    const f=await fixture(t),before=await fs.readFile(path.join(f.directory,'state.json'));
    const revision=crypto.createHash('sha256').update(before).digest('hex'),exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const child=require('node:child_process').spawnSync(exe,['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(__dirname,'restore_crash_probe.ps1')],
        {windowsHide:true,encoding:'utf8',timeout:15000,input:JSON.stringify({directory:f.directory,payload:JSON.stringify(restoring(f)),revision})});
    assert.equal(child.status,75,child.error?.code||child.stderr);assert.deepEqual(await fs.readFile(path.join(f.directory,'state.json')),before);
    assert.deepEqual(await fs.readFile(path.join(f.directory,'state.recovery.'+revision+'.json')),before);
    assert.deepEqual(await createStore(f.options).read(),f.state);
});
nativeTest('empty truncated state remains blocked normally but explicit recovery preserves an empty archive',async t=>{
    const f=await fixture(t);await fs.writeFile(path.join(f.directory,'state.json'),'');await assert.rejects(f.store.read());
    assert.equal(await f.store.readForRecovery(),null);await f.store.writeRecoveryAtomic(restoring(f));
    const emptyHash=crypto.createHash('sha256').update('').digest('hex');
    assert.equal((await fs.readFile(path.join(f.directory,'state.recovery.'+emptyHash+'.json'))).length,0);
    assert.equal((await createStore(f.options).read()).status,'recovering');
});
nativeTest('bounded damaged control-character bytes survive escaped native response and exact archive',async t=>{
    const f=await fixture(t),raw=Buffer.alloc(8192,0);await fs.writeFile(path.join(f.directory,'state.json'),raw);
    await assert.rejects(f.store.read());assert.equal(await f.store.readForRecovery(),null);await f.store.writeRecoveryAtomic(restoring(f));
    const digest=crypto.createHash('sha256').update(raw).digest('hex');assert.deepEqual(await fs.readFile(path.join(f.directory,'state.recovery.'+digest+'.json')),raw);
});
