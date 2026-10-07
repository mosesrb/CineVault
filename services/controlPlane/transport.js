'use strict';
const { performance } = require('node:perf_hooks');
const { exact, UUID, matches, integer } = require('./protocol');
class CloudFailure extends Error {
    constructor(kind, retryAfter = 0) { super('control_plane_' + kind); this.kind = kind; this.retryAfter = retryAfter; }
}
function retryDelay(value, now) {
    if (typeof value !== 'string') return 0;
    const seconds = /^\d+$/.test(value) ? Number(value)*1000 :
        /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) ? Date.parse(value)-now : NaN;
    return Number.isFinite(seconds) ? Math.min(60000,Math.max(0,seconds)) : 0;
}
function createTransport({ config, fetchImpl = fetch, timeoutMs = 10000, now = Date.now }) {
    if (config.mode !== 'ready' || typeof fetchImpl !== 'function' || !integer(timeoutMs,1) || timeoutMs > 10000) throw Error('control_plane_invalid_transport');
    async function post(body, credential, signal) {
        const controller = new AbortController(), started = performance.now();
        const began = now();
        const abort = () => controller.abort();
        signal?.addEventListener('abort',abort,{once:true});
        if (signal?.aborted) controller.abort();
        let timer;
        try {
            // Losing a reply says nothing about a remote commit. Caller retains
            // the exact durable operation and never creates a replacement retry.
            const read = (async()=>{
                const response = await fetchImpl(config.brokerUrl,{method:'POST',redirect:'error',cache:'no-store',credentials:'omit',
                    referrerPolicy:'no-referrer',signal:controller.signal,
                    headers:{'content-type':'application/json',apikey:config.publishableKey,
                        ...(credential ? {'x-cinevault-credential':credential} : {})},body:JSON.stringify(body)});
                if (controller.signal.aborted || response.redirected || (response.url && response.url !== config.brokerUrl)) throw new CloudFailure('unavailable');
                if (response.status === 401 || response.status === 403) throw new CloudFailure('authorization');
                if (response.status === 409) throw new CloudFailure('conflict');
                if (response.status === 429) throw new CloudFailure('rate_limited',retryDelay(response.headers.get('retry-after'),now()));
                // Only the authenticated application error below can declare
                // paused. Gateway/DNS/HTML errors remain generic unavailable.
                if (![200,202,503].includes(response.status) || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new CloudFailure('unavailable');
                const reader = response.body.getReader(); let count = 0; const chunks = [];
                try {
                    while (true) {
                        const {done,value} = await reader.read(); if(done)break;
                        count += value.byteLength; if(count>16384)throw new CloudFailure('unavailable'); chunks.push(Buffer.from(value));
                    }
                } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
                const result = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
                if (response.status === 503) {
                    exact(result,['error']);
                    throw new CloudFailure(result.error === 'project_paused' ? 'paused' : 'unavailable');
                }
                if (response.status === 202) { exact(result,['pending']); if(result.pending!==true)throw Error(); return null; }
                return result;
            })();
            const result = await Promise.race([read,new Promise((_,reject)=>{
                timer = setTimeout(()=>{controller.abort();reject(new CloudFailure('unavailable'));},timeoutMs);
            })]);
            if (controller.signal.aborted || performance.now()-started>=timeoutMs || now()-began>=timeoutMs) throw new CloudFailure('unavailable');
            return result;
        } catch (error) { if(error instanceof CloudFailure)throw error; throw new CloudFailure('unavailable'); }
        finally { clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort(); }
    }
    return Object.freeze({
        redeem: (request,pollSecret,signal)=>post({operation:'register',request,pollSecret},null,signal),
        async heartbeat(state,pending,signal) {
            const reply = await post({ ...pending,projectRef:state.projectRef,serverInstanceId:state.serverInstanceId,
                credentialId:state.credentialId,epoch:state.mapping.epoch },state.secret,signal);
            exact(reply,['idempotencyKey','sequence','cloudServerId','epoch','receivedAt']);
            if(reply.idempotencyKey!==pending.idempotencyKey || reply.sequence!==pending.sequence ||
                reply.cloudServerId!==state.mapping.cloudServerId || !matches(UUID,reply.cloudServerId) || reply.epoch!==state.mapping.epoch ||
                typeof reply.receivedAt!=='string' || !Number.isFinite(Date.parse(reply.receivedAt))) throw new CloudFailure('unavailable');
            return reply;
        }
    });
}
module.exports = { createTransport, CloudFailure, retryDelay };
