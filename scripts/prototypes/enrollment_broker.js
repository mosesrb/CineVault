'use strict';
// ISOLATED LAB COMPOSITION. Never instantiate on an ordinary PC or public client.
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { configuration, TTL } = require('./pairing');
const { bindingDigest } = require('./enrollment_authority');
const { createRefreshingCloudGate } = require('./enrollment_jwks');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const fields = ['projectRef','serverInstanceId','pairId','credentialId','secretDigest','pollDigest','expiresAt','idempotencyKey','approvalDigest'];
const deny = () => { throw new Error('enrollment_denied'); };
const matches = (pattern,value) => typeof value === 'string' && pattern.test(value);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function same(a,b) {
    return matches(HEX,a) && matches(HEX,b) && crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
function exact(value,keys) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) deny();
}
function row(result) {
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) deny();
    exact(result.rows[0],['result']); return result.rows[0].result;
}

/** Trusted database.transaction callback MUST commit only on callback success,
 * rollback on every exception, never retry callback implicitly, and settle commit
 * before resolving. Each connection must use the narrow lab broker role and
 * configured query/transport cancellation. This interface is not a deployed DB
 * driver or credential. No Promise.race around writes: it could return denial
 * while a detached mutation later commits. Lost commit reply remains uncertain.
 */
function createLabBroker({ config, database, admit, fetchKeys = fetch, fetchUser = fetch, now = Date.now, timeoutMs = 10000 }) {
    const trusted = structuredClone(config), projectRef = trusted?.projectRef;
    if (!matches(/^[a-z]{20}$/,projectRef) || configuration(trusted,projectRef).mode !== 'ready' ||
        typeof database?.transaction !== 'function' || typeof admit !== 'function' || typeof now !== 'function' ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000) deny();
    let lastTime = -1;
    function clock() {
        const value = now();
        if (!Number.isSafeInteger(value) || value < 0 || value < lastTime || value > Number.MAX_SAFE_INTEGER-TTL) deny();
        lastTime = value; return value;
    }
    function request(input) {
        exact(input,fields);
        if (input.projectRef !== projectRef || !['serverInstanceId','pairId','credentialId','idempotencyKey'].every(k=>matches(UUID,input[k])) ||
            !['secretDigest','pollDigest','approvalDigest'].every(k=>matches(HEX,input[k])) ||
            !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= clock() || input.expiresAt > clock()+TTL) deny();
    }
    async function admitted(operation, pending) {
        const controller = new AbortController(), started = performance.now(), began = clock(); let timer;
        try {
            const timeout = new Promise((_,reject)=>{ timer = setTimeout(()=>{controller.abort();reject(new Error('enrollment_denied'));},timeoutMs); });
            const result = await Promise.race([Promise.resolve().then(()=>admit(Object.freeze({operation,projectRef,
                serverInstanceId:pending.serverInstanceId,pairId:pending.pairId}),controller.signal)),timeout]);
            if (result !== true || controller.signal.aborted || performance.now()-started >= timeoutMs || clock()-began >= timeoutMs) deny();
        } finally { clearTimeout(timer); }
    }
    async function transaction(action) {
        const started = performance.now(), began = clock();
        const check = () => { if (performance.now()-started >= timeoutMs || clock()-began >= timeoutMs) deny(); };
        return database.transaction(async tx => {
            if (typeof tx?.query !== 'function') deny();
            await tx.query("select set_config('statement_timeout',$1,true), set_config('lock_timeout',$1,true)",[`${timeoutMs}ms`]);
            check(); const result = await action(tx,check); check(); return result;
        });
    }
    const gate = createRefreshingCloudGate({ config: trusted, fetchKeys, fetchUser, now, timeoutMs,
        readCurrent: (input,signal) => transaction(async tx => {
            if (signal.aborted) deny();
            const result = row(await tx.query('select cv_enrollment_lab.read_current($1,$2,$3,$4,$5) as result',
                [input.userId,input.sessionId,input.projectRef,input.serverInstanceId,Buffer.from(input.bindingDigest,'hex')]));
            if (signal.aborted) deny(); return result;
        }) });
    return Object.freeze({
        purgeSigningKeys: gate.purge,
        async authorizeExistingApproval(input) {
            try {
                const args = structuredClone(input); exact(args,['accessToken','request','approvalProof']); request(args.request);
                await admitted('existing-approval',args.request);
                const started = performance.now(), began = clock();
                const result = await gate.authorize(args);
                // Timer callbacks can be delayed by a blocked event loop. A late
                // readonly preflight must never escape as current authorization.
                if (performance.now()-started >= timeoutMs || clock()-began >= timeoutMs) deny();
                request(args.request); return result;
            } catch { deny(); }
        },
        async consume(input) {
            try {
                const args = structuredClone(input); exact(args,['request','pollSecret']); request(args.request);
                // Existing pending protocol hashes canonical lower-hex UTF-8, not decoded bytes.
                if (!matches(HEX,args.pollSecret) || !same(digest(args.pollSecret),args.request.pollDigest)) deny();
                await admitted('consume',args.request); request(args.request);
                const mapping = await transaction(async (tx,check) => {
                    const pending = row(await tx.query('select cv_enrollment_lab.pending($1,$2) as result',[args.request.pairId,args.request.serverInstanceId]));
                    exact(pending,['grantId','projectRef','credentialId','bindingDigest','pollDigest','secretDigest','expiresAt']);
                    if (!matches(UUID,pending.grantId) || pending.projectRef !== projectRef || pending.credentialId !== args.request.credentialId ||
                        !same(pending.bindingDigest,bindingDigest(args.request)) || !same(pending.pollDigest,args.request.pollDigest) ||
                        !same(pending.secretDigest,args.request.secretDigest) || !Number.isSafeInteger(pending.expiresAt) ||
                        pending.expiresAt <= clock() || pending.expiresAt > args.request.expiresAt) deny();
                    check(); request(args.request);
                    const value = row(await tx.query('select cv_enrollment_lab.consume_bound($1,$2,$3,$4,$5,$6,$7) as result',
                        [pending.grantId,projectRef,args.request.serverInstanceId,Buffer.from(pending.bindingDigest,'hex'),Buffer.from(pending.pollDigest,'hex'),
                            args.request.credentialId,Buffer.from(args.request.secretDigest,'hex')]));
                    exact(value,['serverId','serverInstanceId','credentialId','epoch']);
                    if (!matches(UUID,value.serverId) || value.serverInstanceId !== args.request.serverInstanceId ||
                        value.credentialId !== args.request.credentialId || value.epoch !== 1) deny();
                    request(args.request); return Object.freeze({...value});
                });
                // A commit reply may be delayed or lost. Denial does not imply rollback
                // after commit; retry the same pending operation, never reset identity.
                request(args.request); return mapping;
            } catch { deny(); }
        }
    });
}
module.exports = { createLabBroker };
