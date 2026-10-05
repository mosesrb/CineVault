'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { prepare, TTL } = require('../../scripts/prototypes/pairing');
const { challenge, createCloudGate, createLocalGate, bindingDigest, CSRF_TTL } = require('../../scripts/prototypes/enrollment_authority');
const REF = 'aaaaaaaaaaaaaaaaaaaa';
const START = 1800000000000;
const EC = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const RSA = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const denied = async action => assert.rejects(action, error => error.message === 'enrollment_denied');
async function cloudFixture(algorithm = 'ES256') {
    let clock = START;
    const serverInstanceId = crypto.randomUUID(), userId = crypto.randomUUID(), sessionId = crypto.randomUUID();
    const state = await prepare({ store: { read: async () => null, writeAtomic: async () => {} },
        projectRef: REF, serverInstanceId, localAdminApproved: true, now: () => clock });
    const { request, approvalProof } = challenge(state, REF, serverInstanceId, () => clock);
    const keyPair = algorithm === 'ES256' ? EC : RSA;
    const claims = { iss: `https://${REF}.supabase.co/auth/v1`, aud: 'authenticated', role: 'authenticated',
        sub: userId, session_id: sessionId, is_anonymous: false, iat: START / 1000, exp: START / 1000 + 3600 };
    let user = { id: userId, is_anonymous: false, banned_until: null };
    const rows = { session: { id: sessionId, user_id: userId, not_after: null },
        profile: { id: userId, blocked: false, must_change_password: false },
        approval: { owner_user_id: userId, enabled: true, project_ref: REF, server_instance_id: serverInstanceId,
            binding_digest: bindingDigest(request) } };
    const calls = [];
    const options = { config: { enabled: true, projectRef: REF, projectUrl: `https://${REF}.supabase.co`,
        publishableKey: 'sb_publishable_synthetic_fixture_1234567890' },
        signingKeys: [{ kid: 'fixture-key', algorithm, key: keyPair.publicKey }], keysValidUntil: START + TTL,
        now: () => clock,
        fetchUser: async (url, init) => { calls.push({ url, init }); return response(user); },
        readCurrent: async input => { calls.push({ lookup: input }); return structuredClone(rows); } };
    const token = (changes = {}, header = {}) => jwt.sign({ ...claims, ...changes }, keyPair.privateKey,
        { algorithm, header: { kid: 'fixture-key', ...header } });
    const gate = createCloudGate(options);
    const args = () => ({ accessToken: token(), request: structuredClone(request), approvalProof });
    return { gate, args, rows, calls, claims, token, request, approvalProof, state, userId, serverInstanceId, options,
        setUser: value => { user = value; }, advance: ms => { clock += ms; } };
}
for (const algorithm of ['ES256', 'RS256']) test(`cloud authority verifies ${algorithm} signature and live bound rows`, async () => {
    const f = await cloudFixture(algorithm); const result = await f.gate.authorize(f.args());
    assert.deepEqual(Object.keys(result).sort(), ['bindingDigest','expiresAt','pairId','projectRef','serverInstanceId','sessionId','userId']);
    assert.equal(result.userId, f.userId); assert.equal(result.bindingDigest, bindingDigest(f.request));
    assert.equal(Object.isFrozen(result), true);
    assert.equal(f.calls[0].url, `https://${REF}.supabase.co/auth/v1/user`);
    assert.equal(f.calls[0].init.redirect, 'error'); assert.equal(f.calls[0].init.cache, 'no-store');
    assert.equal(f.calls[0].init.credentials, 'omit'); assert.equal(f.calls[0].init.headers.Authorization.startsWith('Bearer '), true);
    assert.equal(Object.isFrozen(f.calls[1].lookup), true);
});
test('approval proof binds every field and never carries the durable operational secret', async () => {
    const f = await cloudFixture(); assert.match(f.approvalProof, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(f.request).includes(f.state.secret), false);
    assert.equal(JSON.stringify(f.request).includes(f.state.pollSecret), false);
    assert.equal(f.approvalProof === f.state.secret || f.approvalProof === f.state.pollSecret, false);
    assert.deepEqual(challenge(f.state, REF, f.serverInstanceId, () => START).request, f.request);
    for (const key of ['pairId', 'credentialId', 'idempotencyKey', 'serverInstanceId']) {
        const changed = { ...f.state, [key]: crypto.randomUUID() };
        assert.notEqual(challenge(changed, REF, changed.serverInstanceId, () => START).approvalProof, f.approvalProof);
    }
    await denied(f.gate.authorize({ ...f.args(), approvalProof: f.state.pollSecret }));
});
const claimsDenied = [
    ['wrong issuer', { iss: 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co/auth/v1' }],
    ['wrong audience', { aud: 'service_role' }], ['array audience', { aud: ['authenticated','service_role'] }],
    ['privileged role', { role: 'service_role' }], ['anonymous user', { is_anonymous: true }],
    ['missing anonymous assertion', { is_anonymous: undefined }], ['missing session', { session_id: undefined }],
    ['foreign subject', { sub: crypto.randomUUID() }], ['expired JWT', { exp: START / 1000 }],
    ['future issued JWT', { iat: START / 1000 + 1 }], ['future not-before', { nbf: START / 1000 + 60 }]
];
for (const [name, change] of claimsDenied) test(`cloud authority rejects ${name}`, async () => {
    const f = await cloudFixture(); await denied(f.gate.authorize({ ...f.args(), accessToken: f.token(change) }));
});
test('untrusted signature, key ID, URL headers and algorithm never choose a verifier', async () => {
    const f = await cloudFixture(); const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const badSignature = jwt.sign(f.claims, other.privateKey, { algorithm: 'ES256', header: { kid: 'fixture-key' } });
    const hs = jwt.sign(f.claims, crypto.randomBytes(32), { algorithm: 'HS256', header: { kid: 'fixture-key' } });
    for (const token of [badSignature, hs, f.token({}, { kid: 'other-key' }), f.token({}, { jku: 'https://evil.invalid/keys' }),
        f.token({}, { crit: ['unknown'] }), 'none', 'x'.repeat(8193)]) await denied(f.gate.authorize({ ...f.args(), accessToken: token }));
    assert.equal(f.calls.length, 0);
});
const rowDenied = [
    ['deleted session', r => { r.session = null; }], ['foreign session', r => { r.session.user_id = crypto.randomUUID(); }],
    ['expired session', r => { r.session.not_after = new Date(START).toISOString(); }],
    ['unknown session expiry', r => { delete r.session.not_after; }], ['missing profile', r => { r.profile = null; }],
    ['blocked profile', r => { r.profile.blocked = true; }], ['password change required', r => { r.profile.must_change_password = true; }],
    ['missing owner approval', r => { r.approval = null; }], ['foreign owner', r => { r.approval.owner_user_id = crypto.randomUUID(); }],
    ['disabled approval', r => { r.approval.enabled = false; }], ['truthy approval', r => { r.approval.enabled = 'true'; }],
    ['foreign installation', r => { r.approval.server_instance_id = crypto.randomUUID(); }],
    ['different request', r => { r.approval.binding_digest = '0'.repeat(64); }]
];
for (const [name, change] of rowDenied) test(`cloud authority denies current ${name}`, async () => {
    const f = await cloudFixture(); await f.gate.authorize(f.args()); change(f.rows);
    await denied(f.gate.authorize(f.args())); assert.equal(f.calls.filter(c => c.lookup).length, 2);
});
test('editable and signed role metadata cannot replace missing current authority', async () => {
    const f = await cloudFixture(); f.rows.approval = null;
    const accessToken = f.token({ user_metadata: { isAdmin: true, owner: f.serverInstanceId }, app_metadata: { role: 'ADMIN' } });
    await denied(f.gate.authorize({ ...f.args(), accessToken }));
});
test('fresh Auth response denies deleted, anonymous, banned and foreign users', async () => {
    const f = await cloudFixture();
    for (const change of [{ id: crypto.randomUUID() }, { is_anonymous: true }, { deleted_at: new Date(START).toISOString() },
        { banned_until: new Date(START + 60000).toISOString() }, { banned_until: 'invalid' }]) {
        f.setUser({ id: f.userId, is_anonymous: false, ...change }); await denied(f.gate.authorize(f.args()));
    }
    assert.equal(f.calls.filter(c => c.lookup).length, 0);
});
test('redirect, oversized, HTML and revoked Auth responses fail closed', async () => {
    const f = await cloudFixture();
    for (const make of [() => response({}, 401), () => response({ padding: 'x'.repeat(16385) }),
        () => new Response('<html>notice</html>', { headers: { 'content-type': 'text/html' } }),
        () => { const res = response({ id: f.userId, is_anonymous: false }); Object.defineProperty(res, 'redirected', { value: true }); return res; }]) {
        const gate = createCloudGate({ ...f.options, fetchUser: async () => make() }); await denied(gate.authorize(f.args()));
    }
});
test('read failures, ignored cancellation and post-read expiry disclose only generic denial', async () => {
    const f = await cloudFixture();
    const failing = createCloudGate({ ...f.options, fetchUser: async () => { throw new Error(f.args().accessToken); } });
    await denied(failing.authorize(f.args()));
    const stuck = createCloudGate({ ...f.options, timeoutMs: 10, readCurrent: () => new Promise(() => {}) });
    await denied(stuck.authorize(f.args()));
    const late = createCloudGate({ ...f.options, readCurrent: async () => { f.advance(TTL); return f.rows; } });
    await denied(late.authorize(f.args()));
});
test('request and key-registry caller mutation cannot redirect pending authorization', async () => {
    const f = await cloudFixture(); let release;
    const gate = createCloudGate({ ...f.options, fetchUser: async () => { await new Promise(resolve => { release = resolve; }); return response({ id: f.userId, is_anonymous: false }); } });
    const args = f.args(); const original = args.request.serverInstanceId; const pending = gate.authorize(args);
    await new Promise(resolve => setImmediate(resolve)); args.request.serverInstanceId = crypto.randomUUID();
    f.options.signingKeys[0].algorithm = 'HS256'; f.options.config.projectUrl = 'https://evil.invalid';
    release(); assert.equal((await pending).serverInstanceId, original);
});
test('proof replay on a different binding and malformed request fields are denied', async () => {
    const f = await cloudFixture();
    for (const request of [{ ...f.request, unexpected: true }, { ...f.request, expiresAt: START },
        { ...f.request, secretDigest: [f.request.secretDigest] }, { ...f.request, projectRef: 'bbbbbbbbbbbbbbbbbbbb' },
        { ...f.request, pairId: crypto.randomUUID() }]) await denied(f.gate.authorize({ ...f.args(), request }));
});
test('invalid, stale or symmetric cloud key configuration is rejected', async () => {
    const f = await cloudFixture();
    for (const change of [{ keysValidUntil: START }, { keysValidUntil: START + TTL + 1 }, { signingKeys: [] },
        { signingKeys: [{ kid: 'fixture-key', algorithm: 'HS256', key: EC.publicKey }] },
        { signingKeys: [f.options.signingKeys[0], f.options.signingKeys[0]] }]) {
        assert.throws(() => createCloudGate({ ...f.options, ...change }), /enrollment_denied/);
    }
});
function localFixture() {
    let clock = START; const userId = crypto.randomBytes(12).toString('hex'); const key = crypto.randomBytes(32).toString('hex');
    const serverInstanceId = crypto.randomUUID(), origin = 'http://localhost:3000';
    const token = (change = {}) => jwt.sign({ _id: userId, tokenType: 'access', iss: 'cinevault', aud: 'cinevault-api',
        iat: START / 1000, exp: START / 1000 + 3600, ...change }, key);
    const accessToken = token(); const tokenDigest = crypto.createHash('sha256').update(accessToken).digest('hex');
    const rows = { user: { _id: userId, isAdmin: true, isApproved: true, isBanned: false }, session: { userId, tokenDigest } };
    const options = { origin, serverInstanceId, jwtKey: key, now: () => clock, readCurrent: async () => structuredClone(rows) };
    const gate = createLocalGate(options);
    const args = { method: 'POST', accessToken, headers: { origin, host: 'localhost:3000',
        'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } };
    return { gate, args, rows, token, options, userId, serverInstanceId, advance: ms => { clock += ms; } };
}
test('local ADMIN requires current signed access session and a session-bound CSRF token', async () => {
    const f = localFixture(); const csrfToken = await f.gate.issueCsrf(f.args);
    assert.deepEqual(await f.gate.authorize({ ...f.args, csrfToken }), { userId: f.userId, serverInstanceId: f.serverInstanceId });
    assert.equal(csrfToken.includes(f.args.accessToken), false);
    assert.notEqual(await f.gate.issueCsrf(f.args), csrfToken);
});
test('local gate denies wrong origin, Host, method, fetch-site and content type', async () => {
    const f = localFixture(); const csrfToken = await f.gate.issueCsrf(f.args);
    for (const headers of [{ ...f.args.headers, origin: 'null' }, { ...f.args.headers, origin: 'http://evil.invalid' },
        { ...f.args.headers, host: 'evil.invalid' }, { ...f.args.headers, 'sec-fetch-site': 'cross-site' },
        { ...f.args.headers, 'content-type': 'text/plain' }, {}]) {
        await denied(f.gate.issueCsrf({ ...f.args, headers })); await denied(f.gate.authorize({ ...f.args, headers, csrfToken }));
    }
    await denied(f.gate.authorize({ ...f.args, method: 'GET', csrfToken }));
});
for (const [name, change] of [
    ['revoked session', r => { r.session = null; }], ['changed ADMIN', r => { r.user.isAdmin = false; }],
    ['truthy ADMIN', r => { r.user.isAdmin = 'true'; }], ['unapproved account', r => { r.user.isApproved = false; }],
    ['banned account', r => { r.user.isBanned = true; }], ['wrong session user', r => { r.session.userId = '0'.repeat(24); }]
]) test(`local CSRF use rejects ${name} after issuance`, async () => {
    const f = localFixture(); const csrfToken = await f.gate.issueCsrf(f.args); change(f.rows);
    await denied(f.gate.authorize({ ...f.args, csrfToken }));
});
test('local CSRF rejects alteration, another session, restart and expiry', async () => {
    const f = localFixture(); const csrfToken = await f.gate.issueCsrf(f.args);
    for (const invalid of ['x', csrfToken + 'a', 'x'.repeat(1025)]) await denied(f.gate.authorize({ ...f.args, csrfToken: invalid }));
    const other = localFixture(); await denied(other.gate.authorize({ ...other.args, csrfToken }));
    await denied(createLocalGate(f.options).authorize({ ...f.args, csrfToken }));
    f.advance(CSRF_TTL); await denied(f.gate.authorize({ ...f.args, csrfToken }));
});
test('local JWT metadata, stream ticket, wrong signature and cloud token are not ADMIN authority', async () => {
    const f = localFixture();
    for (const accessToken of [f.token({ tokenType: 'stream', isAdmin: true }), f.token({ aud: 'cinevault-stream' }),
        jwt.sign({ _id: f.userId, isAdmin: true }, crypto.randomBytes(32)), 'not-a-token']) {
        await denied(f.gate.issueCsrf({ ...f.args, accessToken }));
    }
    f.rows.user.isAdmin = false; await denied(f.gate.issueCsrf({ ...f.args, accessToken: f.token({ isAdmin: true }) }));
});
test('local reads are bounded and expired JWT cannot recover through stale rows', async () => {
    const f = localFixture();
    await denied(createLocalGate({ ...f.options, timeoutMs: 10, readCurrent: () => new Promise(() => {}) }).issueCsrf(f.args));
    f.advance(3600000); await denied(f.gate.issueCsrf(f.args));
});
test('local configured origin never comes from caller Host and rejects non-loopback HTTP', () => {
    const f = localFixture();
    for (const origin of ['http://192.168.1.2:3000', 'https://example.invalid/path', 'https://user:pass@example.invalid', 'invalid']) {
        assert.throws(() => createLocalGate({ ...f.options, origin }), /enrollment_denied/);
    }
});
test('local access audience must be scalar and stream-ticket classification cannot provision', async () => {
    const f = localFixture();
    for (const change of [{ aud: ['cinevault-api', 'cinevault-stream'] }, { isStreamTicket: true }]) {
        const accessToken = f.token(change);
        f.rows.session.tokenDigest = crypto.createHash('sha256').update(accessToken).digest('hex');
        await denied(f.gate.issueCsrf({ ...f.args, accessToken }));
    }
});
test('actual Date ban expiry preserves milliseconds on CSRF issuance and use', async () => {
    const f = localFixture(); const csrfToken = await f.gate.issueCsrf(f.args);
    f.rows.user.isBanned = true; f.rows.user.banExpiresAt = new Date(START + 900); f.advance(500);
    await denied(f.gate.issueCsrf(f.args)); await denied(f.gate.authorize({ ...f.args, csrfToken }));
    f.advance(400); assert.equal((await f.gate.authorize({ ...f.args, csrfToken })).userId, f.userId);
});
test('mutable array identities cannot enter a configured local or cloud gate', async () => {
    const local = localFixture();
    assert.throws(() => createLocalGate({ ...local.options, serverInstanceId: [local.serverInstanceId] }), /enrollment_denied/);
    const cloud = await cloudFixture();
    assert.throws(() => createCloudGate({ ...cloud.options, config: { ...cloud.options.config, projectRef: [REF] } }), /enrollment_denied/);
});
