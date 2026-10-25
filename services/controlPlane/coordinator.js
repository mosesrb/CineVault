'use strict';
const crypto = require('node:crypto');
const { initialState, renewPairing, validateState, validateMapping, pairingRequest, replacementRequest, recoveryRequest, integer, matches, UUID } = require('./protocol');
const { CloudFailure } = require('./transport');
const INTERVAL = 60000;
const MAX_ATTEMPTS = 5;
/** One coordinator per installation. Protected digest-CAS handles a second local
 * process; cloud transactions must recheck epoch/current authority on every call.
 * An outbox survives commit-response loss and restart, never replacing its body.
 * Timers exist only for work-triggered coalescing/recovery, never idle keepalive. */
function createCoordinator({ config, serverInstanceId, store, transport, now = Date.now,
    random = Math.random, schedule = setTimeout, cancel = clearTimeout }) {
    let mode = config.mode === 'ready' ? 'not_enrolled' : config.mode;
    let tail = Promise.resolve(), stopped = false, timer = null, lastReport = -INTERVAL;
    let attempts = 0, activity = null, controller = null, lastClock = -1;
    const serialized = action => {
        const result = tail.then(action); tail = result.catch(()=>{}); return result;
    };
    function clock() {
        const value = now(); if(!integer(value) || value<lastClock)throw Error('control_plane_recovery_required');
        lastClock=value;return value;
    }
    async function read() {
        const state = await store.read();
        return state === null ? null : validateState(state,config.projectRef,serverInstanceId);
    }
    function classify(error) {
        mode = error instanceof CloudFailure ? error.kind : 'recovery_required';
    }
    function enqueue(delay) {
        if(stopped || timer!==null || !activity || config.mode!=='ready')return;
        timer = schedule(()=>{
            timer=null;
            serialized(run).catch(error=>classify(error));
        },delay);
        timer?.unref?.();
    }
    async function run() {
        if(stopped || !activity || config.mode!=='ready')return;
        let state;
        try {
            state = await read();
            if(stopped)return;
            if(!state){mode='not_enrolled';activity=null;return;}
            if(['replacing','recovering'].includes(state.status)){mode=state.status==='recovering'?'awaiting_restore_owner':'awaiting_replacement_owner';activity=null;return;}
            if(state.status!=='active'){mode=clock()>=state.expiresAt?'pairing_expired':'awaiting_owner';activity=null;return;}
            if(state.mapping.credentialExpiresAt<=clock()){mode='credential_expired';activity=null;return;}
            if(state.pending===null) {
                state = {...state,pending:{operation:'heartbeat',idempotencyKey:crypto.randomUUID(),
                    sequence:state.sequence+1,activity}};
                // Must finish durable persistence before sending any request.
                await store.writeAtomic(state);
                if(stopped)return; // Shutdown during durable preflight cannot start a new request.
            }
            controller = new AbortController(); attempts++;
            await transport.heartbeat(state,state.pending,controller.signal);
            if(stopped || controller.signal.aborted) return; // Retain uncertain operation.
            await store.writeAtomic({...state,sequence:state.pending.sequence,pending:null});
            lastReport=clock(); attempts=0;activity=null;mode='connected';
        } catch(error) {
            classify(error);
            if(error instanceof CloudFailure && ['unavailable','paused','rate_limited'].includes(error.kind) && attempts<MAX_ATTEMPTS) {
                const jitter = random();
                if(typeof jitter!=='number' || jitter<0 || jitter>=1){activity=null;mode='recovery_required';return;}
                enqueue(Math.max(error.retryAfter,Math.floor(jitter*Math.min(60000,2000*2**Math.max(0,attempts-1)))));
            } else {activity=null;}
        } finally {controller=null;}
    }
    return Object.freeze({
        status() {
            return Object.freeze({mode,enabled:config.mode==='ready',
                guidance: mode==='paused'?'Resume the existing project in the Supabase dashboard, then retry.':
                    mode==='awaiting_replacement_owner'?'Old cloud activity is paused. Approve the saved replacement on the trusted owner page, then check owner approval.':
                    mode==='awaiting_restore_owner'?'Cloud activity is paused. Fresh cloud-owner approval must restore this exact existing cloud server; then check owner approval.':
                    mode==='pairing_expired'?'The approval challenge expired. Explicit owner recovery can renew an intact saved candidate; fresh cloud-owner approval is required. Do not delete credentials or reset server identity.':
                    ['authorization','conflict','credential_expired','recovery_required'].includes(mode)?
                        'Owner recovery is required. Do not delete credentials or reset the server identity.':
                        mode==='not_enrolled'?'Prepare setup and obtain trusted cloud-owner approval.':
                            mode==='unavailable'?'Cloud status is unavailable; local CineVault remains independent.':null});
        },
        async prepare() {
            return serialized(async()=>{
                if(stopped || config.mode!=='ready')throw Error('control_plane_disabled');
                try {
                    let state=await read();
                    if(stopped)throw Error('control_plane_stopped');
                    if(state?.status==='recovering'){
                        mode='awaiting_restore_owner';if(state.candidate.expiresAt<=clock())throw Error();
                        return {...recoveryRequest(state),expiresAt:state.candidate.expiresAt,alreadyEnrolled:false};
                    }
                    if(state===null){state=initialState(config.projectRef,serverInstanceId,clock());await store.writeAtomic(state);}
                    if(stopped)throw Error('control_plane_stopped');
                    if(state.status==='replacing'){
                        mode='awaiting_replacement_owner';
                        if(state.candidate.expiresAt<=clock())throw Error();
                        return {...replacementRequest(state),expiresAt:state.candidate.expiresAt,alreadyEnrolled:false};
                    }
                    if(state.status==='active'){mode='enrolled';return {alreadyEnrolled:true};}
                    if(state.expiresAt<=clock()){mode='pairing_expired';throw Error('control_plane_recovery_required');}
                    mode='awaiting_owner';
                    return {...pairingRequest(state),expiresAt:state.expiresAt,alreadyEnrolled:false};
                } catch(error){if(mode!=='pairing_expired')classify(error);throw Error('control_plane_recovery_required');}
            });
        },
        async redeem() {
            return serialized(async()=>{
                if(stopped || config.mode!=='ready')throw Error('control_plane_disabled');
                try {
                    const state=await read();
                    if(stopped)throw Error('control_plane_stopped');
                    if(!state)throw Error();
                    if(state.status==='recovering'){
                        if(state.candidate.expiresAt<=clock()){mode='pairing_expired';throw Error();}
                        controller=new AbortController();
                        const mapping=await transport.restore(recoveryRequest(state).request,state.candidate.pollSecret,controller.signal);
                        if(stopped || controller.signal.aborted)throw Error();
                        if(mapping===null){mode='awaiting_restore_owner';return {enrolled:false};}
                        validateMapping(mapping,state.candidate);
                        if(mapping.cloudServerId!==state.cloudServerId || mapping.credentialExpiresAt<=clock() || state.candidate.expiresAt<=clock())throw Error();
                        await store.writeAtomic({...state.candidate,status:'active',mapping,sequence:0,pending:null});
                        lastReport=-INTERVAL;mode='connected';return {enrolled:true};
                    }
                    if(state.status==='replacing'){
                        if(state.candidate.expiresAt<=clock()){mode='pairing_expired';throw Error();}
                        controller=new AbortController();
                        const mapping=await transport.replace(replacementRequest(state).request,state.candidate.pollSecret,controller.signal);
                        if(stopped || controller.signal.aborted)throw Error();
                        if(mapping===null){mode='awaiting_replacement_owner';return {enrolled:false};}
                        validateMapping(mapping,state.candidate);
                        if(mapping.cloudServerId!==state.previous.mapping.cloudServerId || mapping.epoch!==state.previous.mapping.epoch+1 ||
                            mapping.credentialExpiresAt<=clock() || state.candidate.expiresAt<=clock())throw Error();
                        await store.writeAtomic({...state.candidate,status:'active',mapping,sequence:0,pending:null});
                        lastReport=-INTERVAL;mode='connected';return {enrolled:true};
                    }
                    if(state.status==='active'){mode='enrolled';return {enrolled:true};}
                    if(state.expiresAt<=clock()){mode='pairing_expired';throw Error();}
                    controller=new AbortController();
                    const mapping=await transport.redeem(pairingRequest(state).request,state.pollSecret,controller.signal);
                    if(stopped || controller.signal.aborted)throw Error();
                    if(mapping===null){mode='awaiting_owner';return {enrolled:false};}
                    validateMapping(mapping,state);
                    if(state.expiresAt<=clock() || mapping.credentialExpiresAt<=clock())throw Error();
                    await store.writeAtomic({...state,status:'active',mapping,sequence:0,pending:null});
                    mode='connected';return {enrolled:true};
                } catch(error){if(mode!=='pairing_expired')classify(error);throw Error('control_plane_registration_unavailable');}
                finally{controller=null;}
            });
        },
        async recover() {
            // Explicit current local-admin/CSRF action. Stop old scheduled work;
            // serialized in-flight mutation settles before a candidate is saved.
            if(timer!==null){cancel(timer);timer=null;}activity=null;
            return serialized(async()=>{
                if(stopped || config.mode!=='ready')throw Error('control_plane_disabled');
                try {
                    const current=await read();if(stopped)throw Error();
                    if(timer!==null){cancel(timer);timer=null;}activity=null;attempts=0;
                    let state;
                    if(current?.status==='active')state={version:2,status:'replacing',projectRef:current.projectRef,
                        serverInstanceId,previous:current,candidate:initialState(config.projectRef,serverInstanceId,clock())};
                    else if(current?.status==='replacing'){
                        state=current;
                        if(current.candidate.expiresAt<=clock())state={...current,candidate:renewPairing(current.candidate,clock())};
                    }else if(current?.status==='pairing'){
                        state=renewPairing(current,clock());
                    }else throw Error(); // Missing/corrupt/unmapped state is NOT adopted/reset.
                    await store.writeAtomic(state);if(stopped)throw Error();
                    if(state.status==='pairing'){
                        mode='awaiting_owner';
                        return {...pairingRequest(state),expiresAt:state.expiresAt,alreadyEnrolled:false};
                    }
                    mode='awaiting_replacement_owner';
                    return {...replacementRequest(state),expiresAt:state.candidate.expiresAt,alreadyEnrolled:false};
                }catch(error){classify(error);throw Error('control_plane_recovery_required');}
            });
        },
        async restore({confirmedInstanceId,cloudServerId}={}) {
            if(timer!==null){cancel(timer);timer=null;}activity=null;
            return serialized(async()=>{
                if(stopped || config.mode!=='ready')throw Error('control_plane_disabled');
                try {
                    if(confirmedInstanceId!==serverInstanceId || !matches(UUID,cloudServerId))throw Error();
                    const current=await store.readForRecovery();if(stopped)throw Error();
                    if(timer!==null){cancel(timer);timer=null;}activity=null;attempts=0;
                    const known=current?.status==='active'?current.mapping.cloudServerId:
                        current?.status==='replacing'?current.previous.mapping.cloudServerId:current?.cloudServerId;
                    if(known && known!==cloudServerId)throw Error();
                    if(current?.status==='recovering' && current.candidate.expiresAt>clock()){
                        mode='awaiting_restore_owner';return {...recoveryRequest(current),expiresAt:current.candidate.expiresAt,alreadyEnrolled:false};
                    }
                    const state={version:3,status:'recovering',projectRef:config.projectRef,serverInstanceId,cloudServerId,
                        candidate:initialState(config.projectRef,serverInstanceId,clock())};
                    await store.writeRecoveryAtomic(state);if(stopped)throw Error();
                    mode='awaiting_restore_owner';return {...recoveryRequest(state),expiresAt:state.candidate.expiresAt,alreadyEnrolled:false};
                }catch(error){classify(error);throw Error('control_plane_recovery_required');}
            });
        },
        noteActivity(kind='authenticated-request') {
            if(stopped || config.mode!=='ready' || !['authenticated-request','media-work','startup'].includes(kind) ||
                ['authorization','conflict','credential_expired','pairing_expired','recovery_required'].includes(mode))return;
            if(timer!==null || activity)return; // Existing cycle is already coalesced.
            try {
                const delay=Math.max(0,INTERVAL-(clock()-lastReport));
                activity=kind;attempts=0;enqueue(delay);
            } catch(error) {activity=null;classify(error);}
        },
        async retry() {
            if(timer!==null){cancel(timer);timer=null;}
            return serialized(async()=>{
                if(stopped || config.mode!=='ready')return;
                try {
                    const remaining=INTERVAL-(clock()-lastReport);
                    attempts=0;activity='admin-retry';
                    if(remaining>0){enqueue(remaining);return;}
                    await run();
                } catch(error) {activity=null;classify(error);}
            });
        },
        async stop() {
            stopped=true;
            if(timer!==null){cancel(timer);timer=null;}
            controller?.abort();activity=null;
            await tail; // Local acknowledgments cannot continue after closeout.
        }
    });
}
module.exports={createCoordinator,INTERVAL,MAX_ATTEMPTS};
