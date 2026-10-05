'use strict';
// ISOLATED RESEARCH. No app imports, hosted deployment or shared signing secret.
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const jwt = require('jsonwebtoken');
const { configuration, TTL } = require('./pairing');
const { createCloudGate } = require('./enrollment_authority');
const KID = /^[\w-]{1,128}$/;
const MAX_BODY = 16384;
const COOLDOWN = 30000;
const deny = () => { throw new Error('enrollment_denied'); };
function plain(value) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) deny();
}
function bytes(value, min, max) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(max * 4 / 3)) deny();
    const buffer = Buffer.from(value, 'base64url');
    if (buffer.length < min || buffer.length > max || buffer.toString('base64url') !== value) deny();
    return buffer;
}
function keySet(body) {
    plain(body);
    if (Object.keys(body).join(',') !== 'keys' || !Array.isArray(body.keys) || !body.keys.length || body.keys.length > 8) deny();
    const seen = new Set();
    return Object.freeze(body.keys.map(jwk => {
        plain(jwk);
        if (typeof jwk.kid !== 'string' || !KID.test(jwk.kid) || seen.has(jwk.kid) ||
            !['ES256', 'RS256'].includes(jwk.alg) || (jwk.use !== undefined && jwk.use !== 'sig') ||
            (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || jwk.key_ops.length !== 1 || jwk.key_ops[0] !== 'verify'))) deny();
        const material = jwk.alg === 'ES256' ? ['crv', 'x', 'y'] : ['n', 'e'];
        const allowed = ['kid', 'alg', 'kty', 'use', 'key_ops', ...material];
        if (Object.keys(jwk).some(k => !allowed.includes(k))) deny(); // No private material, URLs, certificates or ignored extensions.
        if (jwk.alg === 'ES256') {
            if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') deny();
            bytes(jwk.x, 32, 32); bytes(jwk.y, 32, 32);
        } else {
            if (jwk.kty !== 'RSA') deny();
            const n = bytes(jwk.n, 256, 512), e = bytes(jwk.e, 1, 4);
            if (n[0] === 0 || e[0] === 0) deny();
            const exponent = e.reduce((sum, byte) => sum * 256 + byte, 0);
            if (exponent < 3 || exponent % 2 !== 1) deny();
        }
        const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        if (key.type !== 'public' ||
            (jwk.alg === 'ES256' && (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1')) ||
            (jwk.alg === 'RS256' && (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048 ||
                key.asymmetricKeyDetails.modulusLength > 4096))) deny();
        seen.add(jwk.kid);
        return Object.freeze({ kid: jwk.kid, algorithm: jwk.alg, key });
    }));
}
async function bodyJson(response, url) {
    if (response.status !== 200 || response.redirected || response.url !== url ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) deny();
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) deny();
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            if (!(value instanceof Uint8Array)) deny();
            size += value.byteLength; if (size > MAX_BODY) deny(); chunks.push(Buffer.from(value));
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } finally {
        // A hostile adapter's cancellation must not hold up the bounded operation.
        void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/** Fixed constructor configuration is trusted. get() receives only a bounded
 * untrusted kid/algorithm, never a URL or token. One flight and global cooldown
 * bound refresh amplification; no per-kid cache or stale-on-error fallback.
 * purge() is trusted operator control, NOT a request option or exposed route.
 */
function createSigningKeyProvider({ config, fetchKeys = fetch, now = Date.now, timeoutMs = 10000, cacheMs = TTL }) {
    const trustedConfig = structuredClone(config), projectRef = trustedConfig?.projectRef;
    if (typeof projectRef !== 'string' || !/^[a-z]{20}$/.test(projectRef) || configuration(trustedConfig, projectRef).mode !== 'ready' ||
        typeof fetchKeys !== 'function' || typeof now !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000 ||
        !Number.isSafeInteger(cacheMs) || cacheMs < 1 || cacheMs > TTL) deny();
    const url = `https://${projectRef}.supabase.co/auth/v1/.well-known/jwks.json`;
    let snapshot = null, flight = null, revision = 0, lastTime = -1, nextFetch = 0;
    function clock() {
        const t = now();
        if (!Number.isSafeInteger(t) || t < 0 || t < lastTime || t > Number.MAX_SAFE_INTEGER - TTL) deny();
        lastTime = t; return t;
    }
    clock();
    async function refresh() {
        const started = clock(), monotonicStarted = performance.now(); if (started < nextFetch) deny();
        nextFetch = started + COOLDOWN; snapshot = null;
        const version = ++revision, controller = new AbortController(); let timer;
        const current = { controller, promise: null }; flight = current;
        current.promise = (async () => {
            try {
                const signingKeys = await Promise.race([
                    Promise.resolve().then(async () => keySet(await bodyJson(await fetchKeys(url, {
                        method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
                        headers: { Accept: 'application/json' }, signal: controller.signal
                    }), url))),
                    new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('enrollment_denied')); }, timeoutMs); })
                ]);
                const completed = clock();
                // Timers may be late under event-loop blocking; a settled read is not
                // evidence it completed before its deadline. Both clocks fail closed.
                if (controller.signal.aborted || revision !== version || completed >= started + cacheMs ||
                    completed >= started + timeoutMs || performance.now() - monotonicStarted >= timeoutMs) deny();
                snapshot = Object.freeze({ signingKeys, keysValidUntil: started + cacheMs });
                return snapshot;
            } catch { controller.abort(); if (revision === version) snapshot = null; deny(); }
            finally { clearTimeout(timer); if (flight === current) flight = null; }
        })();
        return current.promise;
    }
    function assertCurrent(value) {
        if (value !== snapshot || !snapshot || clock() >= snapshot.keysValidUntil) deny();
    }
    return Object.freeze({
        async get(kid, algorithm) {
            try {
                if (typeof kid !== 'string' || !KID.test(kid) || !['ES256', 'RS256'].includes(algorithm)) deny();
                let value = snapshot;
                if (flight) value = await flight.promise;
                else if (!value || clock() >= value.keysValidUntil || !value.signingKeys.some(k => k.kid === kid)) value = await refresh();
                assertCurrent(value);
                if (!value.signingKeys.some(k => k.kid === kid && k.algorithm === algorithm)) deny();
                return value;
            } catch { deny(); }
        },
        assertCurrent,
        purge() {
            snapshot = null; ++revision; nextFetch = 0;
            flight?.controller.abort(); flight = null;
        }
    });
}

/** Composition still verifies signature, fixed issuer, live Auth and current
 * rows for EVERY request. Refresh never trusts JWT claims; only header selects
 * a candidate key. Purge/refresh/expiry during authorization denies its result.
 * SQL mutation guard is still required; this preflight is not write authority.
 */
function createRefreshingCloudGate({ config, readCurrent, fetchKeys = fetch, fetchUser = fetch,
    now = Date.now, timeoutMs = 10000, cacheMs = TTL }) {
    const trustedConfig = structuredClone(config);
    if (typeof readCurrent !== 'function' || typeof fetchUser !== 'function') deny();
    const provider = createSigningKeyProvider({ config: trustedConfig, fetchKeys, now, timeoutMs, cacheMs });
    return Object.freeze({
        purge: provider.purge,
        async authorize(input) {
            try {
                const args = structuredClone(input);
                if (typeof args?.accessToken !== 'string' || args.accessToken.length > 8192) deny();
                const header = jwt.decode(args.accessToken, { complete: true })?.header;
                plain(header);
                if (Object.keys(header).sort().join(',') !== 'alg,kid,typ' || header.typ !== 'JWT') deny();
                const snapshot = await provider.get(header.kid, header.alg);
                const gate = createCloudGate({ config: trustedConfig, ...snapshot, readCurrent, fetchUser, now, timeoutMs });
                const result = await gate.authorize(args);
                provider.assertCurrent(snapshot); return result;
            } catch { deny(); }
        }
    });
}
module.exports = { createSigningKeyProvider, createRefreshingCloudGate, COOLDOWN };
