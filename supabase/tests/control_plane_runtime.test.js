'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_REF, initialState, validateState, validateTransition, pairingRequest } = require('../../services/controlPlane/protocol');
const { configuration } = require('../../services/controlPlane/configuration');
const { createCoordinator, INTERVAL } = require('../../services/controlPlane/coordinator');
const { createTransport, CloudFailure, retryDelay } = require('../../services/controlPlane/transport');
const uuid = () => crypto.randomUUID();
const env = () => ({CV_CONTROL_PLANE_ENABLED:'true',CV_CONTROL_PLANE_PROJECT_REF:PROJECT_REF,
    CV_CONTROL_PLANE_PROJECT_URL:`https://${PROJECT_REF}.supabase.co`,CV_CONTROL_PLANE_PUBLISHABLE_KEY:'sb_publishable_'+'a'.repeat(32),
    CV_CONTROL_PLANE_ADMIN_ORIGIN:'http://localhost:3000'});
function fixture(options={}) {
    let time = 2000000000000, saved = null, calls = [], writes = [], timers = [];
    const instance=uuid(),config=configuration(env());
    const store={read:async()=>structuredClone(saved),writeAtomic:async next=>{
        validateState(next,PROJECT_REF,instance);validateTransition(saved,next);saved=structuredClone(next);writes.push(structuredClone(next));
    }};
    const mapping=state=>({projectRef:PROJECT_REF,serverInstanceId:instance,credentialId:state.credentialId,
        cloudServerId:uuid(),epoch:1,credentialExpiresAt:time+86400000});
    const transport={redeem:async()=>mapping(saved),heartbeat:async(state,body)=>{
        assert.deepEqual(saved.pending,body);calls.push({state:structuredClone(state),body:structuredClone(body)});
    },...options.transport};
    const factory=()=>createCoordinator({config,serverInstanceId:instance,store,transport,now:()=>time,random:()=>0.5,
        schedule:(fn,delay)=>{const t={fn,delay,cancelled:false};timers.push(t);return t;},cancel:t=>{t.cancelled=true;},...options});
    const get=()=>timers.find(t=>!t.cancelled);
    return {factory,store,transport,instance,mapping,calls,writes,timers,
        state:()=>structuredClone(saved),set:v=>{saved=structuredClone(v);},advance:v=>{time+=v;},now:()=>time,
        async tick(){const timer=get();assert.ok(timer,'work-triggered timer');timer.cancelled=true;time+=timer.delay;timer.fn();
            // Run settles before retry()'s serialized marker; avoid wall-clock sleeps.
            await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));},get};
}
test('off/missing config preserves local mode and does not consume unrelated settings',()=>{
    for(const flag of [undefined,'','false'])assert.equal(configuration({...env(),CV_CONTROL_PLANE_ENABLED:flag}).mode,'disabled');
});
test('opt-in rejects wrong project, private/project-secret keys, redirects and unsafe origin',()=>{
    for(const change of [{CV_CONTROL_PLANE_ENABLED:'yes'},{CV_CONTROL_PLANE_PROJECT_REF:'a'.repeat(20)},
        {CV_CONTROL_PLANE_PROJECT_URL:`https://${PROJECT_REF}.supabase.co/`},{CV_CONTROL_PLANE_PUBLISHABLE_KEY:'sb_secret_'+'a'.repeat(32)},
        {CV_CONTROL_PLANE_ADMIN_ORIGIN:'http://192.168.1.2:3000'},{CV_CONTROL_PLANE_ADMIN_ORIGIN:'https://host.example/callback'}])
        assert.equal(configuration({...env(),...change}).mode,'blocked');
});
test('protected native core preserves reviewed prototype outside explicit recovery additions',()=>{
    const original=fs.readFileSync(path.join(__dirname,'../../scripts/prototypes/ProtectedState.cs'),'utf8')
        .replace('// Isolated Windows/NTFS research adapter. No application or network entrypoint.',
            '// Windows/NTFS protected atomic state. No network entrypoint; caller validates payload.')
        .replace('namespace CineVaultPrototype {','namespace CineVaultControlPlane {').replace(/\r\n/g,'\n').trim();
    const production=fs.readFileSync(path.join(__dirname,'../../services/controlPlane/ProtectedState.cs'),'utf8').replace(/\r\n/g,'\n')
        .replace(/^\s*\/\/ BEGIN OWNER RECOVERY[^\n]*\n[\s\S]*?^\s*\/\/ END OWNER RECOVERY\n/gm,'')
        .replace(' && action != "recover" && action != "read_recovery"','')
        .replace('out string revision, bool allowEmpty = false','out string revision')
        .replace('(!allowEmpty && file.Length < 1)','file.Length < 1')
        .replace('out revision, action == "read_recovery" || action == "recover"','out revision')
        .replace('action == "read" || action == "read_recovery"','action == "read"').trim();
    assert.equal(production,original);
});
test('pairing is durable before proof, repeat setup is identical and no transport is called',async()=>{
    const f=fixture(),c=f.factory();const first=await c.prepare(),second=await c.prepare();
    assert.deepEqual(first,second);assert.equal(f.writes.length,1);assert.equal(f.calls.length,0);
    assert.equal(f.get(),undefined);assert.equal(first.request.secretDigest.length,64);
    assert.ok(!JSON.stringify(first).includes(f.state().secret));assert.ok(!JSON.stringify(first).includes(f.state().pollSecret));
    assert.deepEqual(pairingRequest(f.state()).request,first.request);
});
test('restart reuses exact registration proof after lost reply and active acknowledgment persists once',async()=>{
    const f=fixture(),c=f.factory();await c.prepare();const before=f.state(),map=f.mapping(before),requests=[];
    f.transport.redeem=async(request,poll)=>{requests.push({request,poll});if(requests.length===1)throw new CloudFailure('unavailable');return map;};
    await assert.rejects(c.redeem());assert.deepEqual(f.state(),before);
    const restarted=f.factory();assert.deepEqual(await restarted.redeem(),{enrolled:true});
    assert.deepEqual(requests[0],requests[1]);assert.deepEqual(f.state().mapping,map);assert.equal(f.state().sequence,0);
});
test('unapproved registration remains pending without a polling scheduler',async()=>{
    const f=fixture();f.transport.redeem=async()=>null;const c=f.factory();await c.prepare();
    assert.deepEqual(await c.redeem(),{enrolled:false});assert.equal(c.status().mode,'awaiting_owner');assert.equal(f.get(),undefined);
});
test('expired pairing/foreign mapping cannot overwrite pending identity',async()=>{
    const f=fixture(),c=f.factory();await c.prepare();const before=f.state();
    f.transport.redeem=async()=>({...f.mapping(before),credentialId:uuid()});await assert.rejects(c.redeem());assert.deepEqual(f.state(),before);
    f.advance(300000);await assert.rejects(c.prepare());await assert.rejects(c.redeem());assert.deepEqual(f.state(),before);
});
test('malformed/restored project or installation state stops without reset',async()=>{
    const f=fixture(),c=f.factory();f.set({...initialState(PROJECT_REF,f.instance,f.now()),serverInstanceId:uuid()});
    const before=f.state();await assert.rejects(c.prepare());assert.deepEqual(f.state(),before);assert.equal(c.status().mode,'recovery_required');
});
test('active writes cannot replace credentials, mapping or roll sequence back',async()=>{
    const f=fixture(),c=f.factory();await c.prepare();await c.redeem();const before=f.state();
    for(const next of [{...before,secret:'0'.repeat(64)},{...before,mapping:{...before.mapping,epoch:2}},
        {...before,status:'pairing'},{...before,sequence:3}])assert.throws(()=>validateTransition(before,next));
});
test('no heartbeat idle timer exists; actual requests coalesce to one report/minute',async()=>{
    const f=fixture(),c=f.factory();await c.prepare();await c.redeem();assert.equal(f.get(),undefined);
    c.noteActivity();c.noteActivity('media-work');assert.equal(f.timers.length,1);await f.tick();
    assert.equal(f.calls.length,1);assert.equal(f.state().sequence,1);assert.equal(f.state().pending,null);assert.equal(f.get(),undefined);
    c.noteActivity();assert.equal(f.get().delay,INTERVAL);await f.tick();assert.equal(f.calls.length,2);assert.equal(f.get(),undefined);
});
test('five-attempt transient recovery retains exact body then stops until real work/admin retry',async()=>{
    const f=fixture();f.transport.heartbeat=async(state,body)=>{f.calls.push(structuredClone(body));throw new CloudFailure('unavailable');};
    const c=f.factory();await c.prepare();await c.redeem();c.noteActivity();
    for(let i=0;i<5;i++)await f.tick();
    assert.equal(f.calls.length,5);assert.ok(f.calls.every(x=>JSON.stringify(x)===JSON.stringify(f.calls[0])));assert.equal(f.get(),undefined);
    assert.deepEqual(f.state().pending,f.calls[0]);assert.equal(f.state().sequence,0);c.noteActivity();assert.ok(f.get());await c.stop();
});
test('authorization/conflict failures stop retries and preserve operation for owner recovery',async()=>{
    for(const kind of ['authorization','conflict']){
        const f=fixture();f.transport.heartbeat=async()=>{throw new CloudFailure(kind);};const c=f.factory();await c.prepare();await c.redeem();
        c.noteActivity();await f.tick();assert.equal(c.status().mode,kind);assert.equal(f.get(),undefined);assert.ok(f.state().pending);
        c.noteActivity();assert.equal(f.get(),undefined);
    }
});
test('restart retries identical outbox after response loss and acknowledges matching sequence',async()=>{
    const f=fixture();f.transport.heartbeat=async(state,body)=>{f.calls.push(structuredClone(body));throw new CloudFailure('unavailable');};
    const c=f.factory();await c.prepare();await c.redeem();c.noteActivity();await f.tick();const pending=f.state().pending;await c.stop();
    f.transport.heartbeat=async(state,body)=>{assert.deepEqual(body,pending);f.calls.push(structuredClone(body));};
    const restarted=f.factory();restarted.noteActivity('startup');await f.tick();assert.equal(f.state().sequence,1);assert.equal(f.state().pending,null);
});
test('credential expiration withholds all transport and never auto rotates',async()=>{
    const f=fixture(),c=f.factory();await c.prepare();await c.redeem();const before=f.state();f.advance(86400000);
    c.noteActivity();await f.tick();assert.equal(c.status().mode,'credential_expired');assert.equal(f.calls.length,0);assert.deepEqual(f.state(),before);
});
test('shutdown cancels timers and late completion cannot erase uncertain outbox',async()=>{
    const f=fixture();let resolve;f.transport.heartbeat=()=>new Promise(r=>{resolve=r;});const c=f.factory();await c.prepare();await c.redeem();
    c.noteActivity();await f.tick();assert.ok(f.state().pending);const stopping=c.stop();resolve();await stopping;
    assert.ok(f.state().pending);assert.equal(f.state().sequence,0);assert.equal(f.get(),undefined);
});
test('shutdown during state read or outbox persistence cannot start a new heartbeat',async()=>{
    for(const point of ['read','write']){
        const f=fixture(),c=f.factory();await c.prepare();await c.redeem();let resume;
        const original=f.store[point==='read'?'read':'writeAtomic'];
        if(point==='read')f.store.read=()=>new Promise(r=>{resume=()=>r(f.state());});
        else f.store.writeAtomic=async value=>{await original(value);await new Promise(r=>{resume=r;});};
        c.noteActivity();await f.tick();assert.equal(typeof resume,'function');const stopped=c.stop();resume();await stopped;
        assert.equal(f.calls.length,0);assert.equal(f.state().sequence,0);
    }
});
test('shutdown during setup/redeem state read denies continuation without transport or new secret',async()=>{
    for(const operation of ['prepare','redeem']){
        const f=fixture(),c=f.factory();if(operation==='redeem')await c.prepare();const before=f.state();let resume,calls=0;
        f.transport.redeem=async()=>{calls++;return f.mapping(f.state());};
        f.store.read=()=>new Promise(r=>{resume=()=>r(f.state());});
        const attempt=c[operation](),denied=assert.rejects(attempt);await new Promise(r=>setImmediate(r));
        const stopped=c.stop();resume();await denied;await stopped;assert.equal(calls,0);assert.deepEqual(f.state(),before);
    }
});
test('explicit admin retry still coalesces after a successful report',async()=>{
    const f=fixture(),c=f.factory();await c.prepare();await c.redeem();c.noteActivity();await f.tick();
    await c.retry();assert.equal(f.calls.length,1);assert.equal(f.get().delay,INTERVAL);await f.tick();assert.equal(f.calls.length,2);
});
test('clock regression in activity and retry gives recovery guidance without wedging a cycle',async()=>{
    for(const operation of ['activity','retry']){
        const f=fixture(),c=f.factory();await c.prepare();await c.redeem();c.noteActivity();await f.tick();
        f.advance(-1);
        if(operation==='activity')c.noteActivity();else await c.retry();
        assert.equal(c.status().mode,'recovery_required');assert.match(c.status().guidance,/Owner recovery/);
        assert.equal(f.get(),undefined);assert.equal(f.calls.length,1);
        f.advance(2);c.noteActivity();assert.equal(f.get(),undefined);
        await c.retry();assert.ok(f.get());await f.tick();assert.equal(c.status().mode,'connected');assert.equal(f.calls.length,2);
    }
});
test('paused is distinct from unknown outage; Retry-After is bounded',async()=>{
    assert.equal(retryDelay('999999',0),60000);assert.equal(retryDelay('-1',0),0);assert.equal(retryDelay('5',0),5000);
    const config=configuration(env()),body={pending:true};
    for(const [status,result,kind] of [[503,{error:'project_paused'},'paused'],[503,{error:'gateway_down'},'unavailable'],
        [401,body,'authorization'],[403,body,'authorization'],[409,body,'conflict'],[429,body,'rate_limited'],[404,body,'unavailable']]){
        const transport=createTransport({config,fetchImpl:async()=>new Response(JSON.stringify(result),{status,headers:{'content-type':'application/json','retry-after':'999999'}})});
        await assert.rejects(transport.redeem({},'synthetic'),error=>error.kind===kind);
    }
});
test('transport forbids redirects, non-JSON/oversize responses and invalid acknowledgments',async()=>{
    const config=configuration(env());
    for(const response of [new Response('<html>',{status:200}),new Response('x'.repeat(16385),{headers:{'content-type':'application/json'}}),
        {status:200,redirected:true,headers:new Headers()}]){
        await assert.rejects(createTransport({config,fetchImpl:async()=>response}).redeem({},'synthetic'),e=>e.kind==='unavailable');
    }
    const f=fixture(),c=f.factory();await c.prepare();await c.redeem();const s=f.state(),p={operation:'heartbeat',idempotencyKey:uuid(),sequence:1,activity:'media-work'};
    const transport=createTransport({config,fetchImpl:async(url,options)=>{
        assert.equal(url,config.brokerUrl);assert.equal(options.redirect,'error');assert.equal(options.headers['x-cinevault-credential'],s.secret);
        assert.equal(options.headers.Authorization,undefined);assert.ok(!url.includes(s.secret));
        return new Response(JSON.stringify({idempotencyKey:p.idempotencyKey,sequence:9,cloudServerId:s.mapping.cloudServerId,epoch:1,receivedAt:new Date().toISOString()}),{headers:{'content-type':'application/json'}});
    }});
    await assert.rejects(transport.heartbeat(s,p),e=>e.kind==='unavailable');
});
test('read timeout ignoring AbortSignal does not escape or create a new operation',async()=>{
    const config=configuration(env()),transport=createTransport({config,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})});
    await assert.rejects(transport.redeem({},'synthetic'),e=>e.kind==='unavailable');
});
