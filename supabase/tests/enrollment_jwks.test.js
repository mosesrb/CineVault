'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { prepare, TTL } = require('../../scripts/prototypes/pairing');
const { challenge, bindingDigest } = require('../../scripts/prototypes/enrollment_authority');
const { createSigningKeyProvider, createRefreshingCloudGate, COOLDOWN } = require('../../scripts/prototypes/enrollment_jwks');
const REF = 'aaaaaaaaaaaaaaaaaaaa', START = 1800000000000;
const URL = `https://${REF}.supabase.co/auth/v1/.well-known/jwks.json`;
const EC = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const EC2 = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const RSA = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = () => ({ enabled: true, projectRef: REF, projectUrl: `https://${REF}.supabase.co`, publishableKey: 'sb_publishable_synthetic_fixture_1234567890' });
const jwk = (pair = EC, kid = 'one', alg = 'ES256') => ({ ...pair.publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig', key_ops: ['verify'] });
function response(body, options = {}) {
    const r = new Response(typeof body === 'string' ? body : JSON.stringify(body),
        { status: 200, headers: { 'content-type': 'application/json' }, ...options });
    Object.defineProperty(r, 'url', { value: URL, configurable: true }); return r;
}
const denied = action => assert.rejects(action, error => error.message === 'enrollment_denied');
const deniedSync = action => assert.throws(action, error => error.message === 'enrollment_denied');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
    let clock = START, body = { keys: [jwk()] }, handler = null;
    const calls = [], supplied = config();
    const provider = createSigningKeyProvider({ config: supplied, now: () => clock,
        fetchKeys: async (url, init) => { calls.push({ url, init }); return handler ? handler(url, init) : response(body); }, ...options });
    return { provider, calls, supplied, advance: ms => { clock += ms; }, setTime: t => { clock = t; },
        setBody: value => { body = value; }, setHandler: value => { handler = value; } };
}
test('fixed project fetch has no tokens, redirects, cookies or arbitrary key URL', async () => {
    const f = fixture(); f.supplied.projectUrl = 'https://evil.invalid';
    const s = await f.provider.get('one', 'ES256');
    assert.equal(s.keysValidUntil, START + TTL); assert.equal(s.signingKeys[0].key.type, 'public');
    assert.equal(Object.isFrozen(s), true); assert.equal(Object.isFrozen(s.signingKeys), true); assert.equal(Object.isFrozen(s.signingKeys[0]), true);
    assert.deepEqual(f.calls[0].init.headers, { Accept: 'application/json' }); assert.equal(f.calls[0].url, URL);
    for (const [field, value] of Object.entries({ method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })) assert.equal(f.calls[0].init[field], value);
    assert.equal(await f.provider.get('one', 'ES256'), s); assert.equal(f.calls.length, 1);
});
test('RS256 public material imports only adequate keys and verifies a real signature', async () => {
    const f = fixture(); f.setBody({ keys: [jwk(RSA, 'rsa', 'RS256')] });
    const s = await f.provider.get('rsa', 'RS256');
    const token = jwt.sign({ sub: 'synthetic' }, RSA.privateKey, { algorithm: 'RS256' });
    assert.equal(jwt.verify(token, s.signingKeys[0].key, { algorithms: ['RS256'] }).sub, 'synthetic');
});
test('inadequate RSA modulus is denied even when OpenSSL imports it', async () => {
    const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
    const f = fixture(); f.setBody({ keys: [jwk(weak, 'weak', 'RS256')] });
    await denied(f.provider.get('weak', 'RS256'));
});
test('missing optional sig/verify metadata remains interoperable public JWK', async () => {
    const key = jwk(); delete key.use; delete key.key_ops;
    const f = fixture(); f.setBody({ keys: [key] }); await f.provider.get('one', 'ES256');
});
test('cache expires at request-start lifetime, refresh replaces rather than merges keys', async () => {
    const f = fixture(); const old = await f.provider.get('one', 'ES256');
    f.advance(TTL); f.setBody({ keys: [jwk(EC2, 'two')] });
    const next = await f.provider.get('two', 'ES256'); assert.equal(f.calls.length, 2);
    deniedSync(() => f.provider.assertCurrent(old)); assert.deepEqual(next.signingKeys.map(k => k.kid), ['two']);
    await denied(f.provider.get('one', 'ES256')); assert.equal(f.calls.length, 2);
});
test('unknown key refresh respects global cooldown and can pick up a rotated key', async () => {
    const f = fixture(); await f.provider.get('one', 'ES256'); f.setBody({ keys: [jwk(), jwk(EC2, 'two')] });
    await denied(f.provider.get('two', 'ES256')); assert.equal(f.calls.length, 1);
    f.advance(COOLDOWN); await f.provider.get('two', 'ES256'); assert.equal(f.calls.length, 2);
    for (let i = 0; i < 100; ++i) await denied(f.provider.get(`missing-${i}`, 'ES256'));
    assert.equal(f.calls.length, 2); await f.provider.get('one', 'ES256');
});
test('concurrent misses share one bounded flight', async () => {
    const f = fixture(), wait = deferred(); f.setHandler(() => wait.promise);
    const pending = Array.from({ length: 20 }, () => f.provider.get('one', 'ES256'));
    await Promise.resolve(); assert.equal(f.calls.length, 1); wait.resolve(response({ keys: [jwk()] }));
    const results = await Promise.all(pending); assert.equal(new Set(results).size, 1);
});
test('failed rotation drops previous snapshot and never falls back to stale keys', async () => {
    const f = fixture(); const old = await f.provider.get('one', 'ES256'); f.advance(COOLDOWN);
    f.setHandler(() => { throw new Error('synthetic sensitive transport detail'); });
    await denied(f.provider.get('new', 'ES256')); deniedSync(() => f.provider.assertCurrent(old));
    await denied(f.provider.get('one', 'ES256')); assert.equal(f.calls.length, 2);
});
test('trusted purge invalidates current snapshots and prevents an old flight repopulating cache', async () => {
    const f = fixture(); const old = await f.provider.get('one', 'ES256'); f.provider.purge();
    deniedSync(() => f.provider.assertCurrent(old));
    const wait = deferred(); f.setHandler(() => wait.promise);
    const pending = f.provider.get('one', 'ES256'); const rejection = denied(pending); await Promise.resolve();
    const signal = f.calls.at(-1).init.signal; f.provider.purge(); assert.equal(signal.aborted, true);
    f.setHandler(() => response({ keys: [jwk(EC2, 'two')] }));
    const fresh = await f.provider.get('two', 'ES256'); wait.resolve(response({ keys: [jwk()] })); await rejection;
    f.provider.assertCurrent(fresh); await denied(f.provider.get('one', 'ES256'));
});
test('timeout bounds adapters ignoring cancellation and a late result cannot enter cache', async () => {
    const f = fixture({ timeoutMs: 15 }), wait = deferred(); f.setHandler(() => wait.promise);
    await denied(f.provider.get('one', 'ES256')); assert.equal(f.calls[0].init.signal.aborted, true);
    wait.resolve(response({ keys: [jwk()] })); await new Promise(r => setImmediate(r));
    await denied(f.provider.get('one', 'ES256')); assert.equal(f.calls.length, 1);
});
test('event-loop blocking cannot outrun the deadline timer and install late keys', async () => {
    const f = fixture({ timeoutMs: 10 }); f.setHandler(() => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 35);
        return response({ keys: [jwk()] });
    });
    await denied(f.provider.get('one', 'ES256')); assert.equal(f.calls[0].init.signal.aborted, true);
    await denied(f.provider.get('one', 'ES256')); assert.equal(f.calls.length, 1);
});
test('trusted clock expiry within cache lifetime also denies late retrieval', async () => {
    const f = fixture({ timeoutMs: 10 }); f.setHandler(() => { f.advance(10); return response({ keys: [jwk()] }); });
    await denied(f.provider.get('one', 'ES256')); assert.equal(f.calls[0].init.signal.aborted, true);
});
test('body read is covered by deadline, not just response headers', async () => {
    const f = fixture({ timeoutMs: 15 });
    f.setHandler(() => {
        const r = response(''); Object.defineProperty(r, 'body', { value: { getReader: () => ({
            read: () => new Promise(() => {}), cancel: async () => {}, releaseLock: () => {}
        }) } }); return r;
    });
    await denied(f.provider.get('one', 'ES256')); assert.equal(f.calls[0].init.signal.aborted, true);
});
test('oversized streamed body denies without awaiting noncooperative cancellation', async () => {
    const f = fixture({ timeoutMs: 20 }); let cancelled = false;
    f.setHandler(() => {
        const r = response(''); Object.defineProperty(r, 'body', { value: { getReader: () => ({
            read: async () => ({ done: false, value: new Uint8Array(16385) }),
            cancel: () => { cancelled = true; return new Promise(() => {}); }, releaseLock: () => {}
        }) } }); return r;
    });
    await denied(f.provider.get('one', 'ES256')); assert.equal(cancelled, true);
});
test('network latency cannot extend the cache, invalid or regressing clocks deny', async () => {
    const f = fixture({ cacheMs: 20 }); f.setHandler(() => { f.advance(20); return response({ keys: [jwk()] }); });
    await denied(f.provider.get('one', 'ES256'));
    const g = fixture(); await g.provider.get('one', 'ES256'); g.advance(1); await g.provider.get('one', 'ES256');
    g.setTime(START); await denied(g.provider.get('one', 'ES256'));
    for (const t of [NaN, -1, 1.5, Number.MAX_SAFE_INTEGER]) { g.setTime(t); await denied(g.provider.get('one', 'ES256')); }
});
test('invalid constructor configuration or bounds are denied', () => {
    for (const changes of [{ config: undefined }, { config: { ...config(), enabled: false } },
        { config: { ...config(), projectUrl: 'http://localhost' } }, { config: { ...config(), projectRef: 5 } },
        { timeoutMs: 9 }, { timeoutMs: 10001 }, { cacheMs: 0 }, { cacheMs: TTL + 1 }, { fetchKeys: null }, { now: null }]) {
        deniedSync(() => createSigningKeyProvider({ config: config(), ...changes }));
    }
});
test('invalid kid/algorithm do not fetch and a known mismatched algorithm does not refresh', async () => {
    const f = fixture();
    for (const kid of [null, 5, '', 'x'.repeat(129), 'https://evil.invalid']) await denied(f.provider.get(kid, 'ES256'));
    for (const alg of ['HS256', 'none', 'EdDSA', undefined]) await denied(f.provider.get('one', alg));
    assert.equal(f.calls.length, 0); await f.provider.get('one', 'ES256');
    await denied(f.provider.get('one', 'RS256')); assert.equal(f.calls.length, 1);
});
const invalidBodies = [
    ['empty keys', { keys: [] }], ['too many keys', { keys: Array.from({ length: 9 }, (_, i) => jwk(EC, `k${i}`)) }],
    ['duplicate IDs', { keys: [jwk(), jwk(EC2)] }], ['extra top field', { keys: [jwk()], fallback: 'evil' }],
    ['private EC', { keys: [{ ...jwk(), ...EC.privateKey.export({ format: 'jwk' }) }] }],
    ['private RSA', { keys: [{ ...jwk(RSA, 'one', 'RS256'), ...RSA.privateKey.export({ format: 'jwk' }) }] }],
    ['URL material', { keys: [{ ...jwk(), jku: 'https://evil.invalid' }] }],
    ['algorithm confusion', { keys: [{ ...jwk(), alg: 'RS256' }] }],
    ['shared secret', { keys: [{ kid: 'one', alg: 'HS256', kty: 'oct', k: 'synthetic' }] }],
    ['wrong curve', { keys: [{ ...jwk(), crv: 'P-384' }] }], ['encryption use', { keys: [{ ...jwk(), use: 'enc' }] }],
    ['sign operation', { keys: [{ ...jwk(), key_ops: ['verify', 'sign'] }] }],
    ['noncanonical coordinate', { keys: [{ ...jwk(), x: jwk().x + '=' }] }],
    ['short coordinate', { keys: [{ ...jwk(), x: 'AA' }] }], ['wrong point', { keys: [{ ...jwk(), x: 'A'.repeat(43), y: 'A'.repeat(43) }] }],
    ['short modulus', { keys: [{ ...jwk(RSA, 'one', 'RS256'), n: 'AA' }] }],
    ['leading zero exponent', { keys: [{ ...jwk(RSA, 'one', 'RS256'), e: 'AAEAAQ' }] }],
    ['even exponent', { keys: [{ ...jwk(RSA, 'one', 'RS256'), e: 'Ag' }] }]
];
for (const [name, body] of invalidBodies) test(`JWKS rejects ${name}`, async () => {
    const f = fixture(); f.setBody(body); await denied(f.provider.get('one', 'ES256')); assert.equal(f.calls.length, 1);
});
test('metadata, response origin, body size, encoding and syntax are bounded', async () => {
    const candidates = [response({}, { status: 401 }), response({}, { headers: { 'content-type': 'text/html' } }),
        response('x'.repeat(16385)), response('{'), response({}, { headers: { 'content-type': 'application/json', 'content-length': '16385' } }),
        response({}, { headers: { 'content-type': 'application/json', 'content-length': '-1' } })];
    const foreign = response({}); Object.defineProperty(foreign, 'url', { value: 'https://evil.invalid' }); candidates.push(foreign);
    const redirect = response({}); Object.defineProperty(redirect, 'redirected', { value: true }); candidates.push(redirect);
    const utf = new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }); Object.defineProperty(utf, 'url', { value: URL }); candidates.push(utf);
    for (const r of candidates) { const f = fixture(); f.setHandler(() => r); await denied(f.provider.get('one', 'ES256')); }
});
async function cloudFixture() {
    let clock = START, keys = { keys: [jwk()] }, auth = null;
    const userId = crypto.randomUUID(), sessionId = crypto.randomUUID(), serverInstanceId = crypto.randomUUID();
    const state = await prepare({ store: { read: async () => null, writeAtomic: async () => {} }, projectRef: REF,
        serverInstanceId, localAdminApproved: true, now: () => clock });
    const { request, approvalProof } = challenge(state, REF, serverInstanceId, () => clock);
    const claims = { iss: `https://${REF}.supabase.co/auth/v1`, aud: 'authenticated', role: 'authenticated',
        sub: userId, session_id: sessionId, is_anonymous: false, iat: START / 1000, exp: START / 1000 + 3600 };
    const rows = { session: { id: sessionId, user_id: userId, not_after: null }, profile: { id: userId, blocked: false, must_change_password: false },
        approval: { owner_user_id: userId, enabled: true, project_ref: REF, server_instance_id: serverInstanceId, binding_digest: bindingDigest(request) } };
    const calls = [];
    const gate = createRefreshingCloudGate({ config: config(), now: () => clock,
        fetchKeys: async () => { calls.push('keys'); return response(keys); },
        fetchUser: async () => { calls.push('user');
            const r = auth ? await auth() : response({ id: userId, is_anonymous: false });
            Object.defineProperty(r, 'url', { value: `https://${REF}.supabase.co/auth/v1/user` }); return r;
        },
        readCurrent: async () => { calls.push('rows'); return structuredClone(rows); } });
    const token = (pair = EC, kid = 'one', header = {}, changes = {}) => jwt.sign({ ...claims, ...changes }, pair.privateKey,
        { algorithm: 'ES256', header: { kid, ...header } });
    return { gate, calls, rows, args: () => ({ accessToken: token(), request: structuredClone(request), approvalProof }), token,
        user: { id: userId, is_anonymous: false },
        advance: ms => { clock += ms; }, setKeys: v => { keys = v; }, setAuth: v => { auth = v; } };
}
test('composed gate verifies real signature and rechecks live Auth/current rows every time', async () => {
    const f = await cloudFixture(); await f.gate.authorize(f.args()); await f.gate.authorize(f.args());
    assert.deepEqual(f.calls, ['keys','user','rows','user','rows']);
    f.rows.session = null; await denied(f.gate.authorize(f.args()));
    f.setAuth(() => response({}, { status: 401 })); await denied(f.gate.authorize(f.args()));
});
test('composed gate rejects attacker signature, URL headers, wrong issuer and role', async () => {
    const f = await cloudFixture();
    for (const accessToken of [f.token(EC2), f.token(EC, 'one', {}, { iss: 'https://evil.invalid' }),
        f.token(EC, 'one', {}, { role: 'service_role' })]) await denied(f.gate.authorize({ ...f.args(), accessToken }));
    assert.equal(f.calls.includes('user'), false);
    const g = await cloudFixture();
    for (const accessToken of [f.token(EC, 'one', { jku: 'https://evil.invalid' }), 'x'.repeat(8193), 'none']) await denied(g.gate.authorize({ ...g.args(), accessToken }));
    assert.equal(g.calls.length, 0);
});
test('composed gate accepts rotated key only after fixed-origin refresh', async () => {
    const f = await cloudFixture(); await f.gate.authorize(f.args()); f.advance(COOLDOWN);
    f.setKeys({ keys: [jwk(EC2, 'two')] }); await f.gate.authorize({ ...f.args(), accessToken: f.token(EC2, 'two') });
    await denied(f.gate.authorize(f.args())); assert.equal(f.calls.filter(c => c === 'keys').length, 2);
});
test('purge while live Auth is pending prevents an in-flight authorization escaping', async () => {
    const f = await cloudFixture(), wait = deferred(), entered = deferred();
    f.setAuth(() => { entered.resolve(); return wait.promise; });
    const pending = f.gate.authorize(f.args()); const rejection = denied(pending); await entered.promise;
    f.gate.purge(); wait.resolve(response(f.user)); await rejection;
    assert.equal(f.calls.includes('rows'), true); // otherwise earlier Auth denial would mask purge protection
});
test('refresh during live Auth invalidates the older in-flight authorization', async () => {
    const f = await cloudFixture(), entered = deferred(), wait = deferred();
    await f.gate.authorize(f.args()); f.advance(COOLDOWN);
    f.setAuth(() => { entered.resolve(); return wait.promise; });
    const pending = f.gate.authorize(f.args()); const rejection = denied(pending); await entered.promise;
    f.setAuth(() => response(f.user)); f.setKeys({ keys: [jwk(), jwk(EC2, 'two')] });
    await f.gate.authorize({ ...f.args(), accessToken: f.token(EC2, 'two') });
    wait.resolve(response(f.user)); await rejection; assert.equal(f.calls.filter(c => c === 'rows').length, 3);
});
test('wrapper detaches input before network waits and denies expiry during live reads', async () => {
    const f = await cloudFixture(), args = f.args(), entered = deferred(), wait = deferred();
    f.setAuth(() => { entered.resolve(); return wait.promise; });
    const pending = f.gate.authorize(args); await entered.promise; args.request.serverInstanceId = crypto.randomUUID();
    wait.resolve(response(f.user)); const result = await pending;
    assert.notEqual(result.serverInstanceId, args.request.serverInstanceId);
    const g = await cloudFixture(); g.setAuth(() => { g.advance(TTL); return response(g.user); });
    await denied(g.gate.authorize(g.args()));
});
