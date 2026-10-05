'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { configuration, prepare, exchange, beginBody, simulator, TTL, POLL_INTERVAL } =
    require('../../scripts/prototypes/pairing');
const REF = 'aaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbb';
const KEY = 'sb_publishable_syntheticOnly123456';
const validConfig = () => ({ enabled: true, projectRef: REF,
    projectUrl: `https://${REF}.supabase.co`, publishableKey: KEY });

function fixture() {
    let time = 1000000;
    let saved = null;
    let writeFailure = false;
    let allowed = true;
    const instance = randomUUID();
    const owner = randomUUID();
    const writes = [];
    const now = () => time;
    const store = {
        async read() { return structuredClone(saved); },
        async writeAtomic(value) {
            if (writeFailure) throw new Error('synthetic_storage_failure');
            saved = structuredClone(value);
            writes.push(structuredClone(value));
        }
    };
    const broker = simulator({ projectRef: REF, now,
        checkOwner: (human, id) => allowed && human === owner && id === instance });
    const options = { store, projectRef: REF, serverInstanceId: instance, now };
    return { store, broker, options, instance, owner, writes,
        advance: (ms = POLL_INTERVAL) => { time += ms; },
        corrupt: value => { saved = value; },
        failWrites: () => { writeFailure = true; },
        allowWrites: () => { writeFailure = false; },
        signOut: () => { allowed = false; },
        prepare: () => prepare({ ...options, localAdminApproved: true }),
        exchange: (transport = broker) => exchange({ ...options, transport }),
        async approve() {
            const state = await store.read();
            broker.begin(beginBody(state));
            broker.approve(state.pairId, owner, instance);
            return state;
        }
    };
}

test('opt-out and missing config disable cloud without validating unused fields', () => {
    for (const enabled of [undefined, false, 'false']) {
        assert.deepEqual(configuration({ enabled, projectUrl: 'broken' }, REF), { mode: 'disabled' });
    }
});
test('valid configuration derives only the intended HTTPS broker', () => {
    assert.deepEqual(configuration(validConfig(), REF), { mode: 'ready', projectRef: REF,
        brokerUrl: `https://${REF}.supabase.co/functions/v1/cinevault-pairing` });
});
test('missing and malformed config do not throw or reflect input', () => {
    assert.deepEqual(configuration(undefined, REF), { mode: 'disabled' });
    for (const value of [null, false, 3, 'secret', [], new Date()]) {
        assert.deepEqual(configuration(value, REF),
            { mode: 'blocked', reason: 'invalid_control_plane_config' });
    }
});
for (const [label, patch] of Object.entries({ http: { projectUrl: `http://${REF}.supabase.co` },
    alternateHost: { projectUrl: `https://${REF}.supabase.co.evil.example` },
    urlCredentials: { projectUrl: `https://name@${REF}.supabase.co` },
    path: { projectUrl: `https://${REF}.supabase.co/` },
    wrongProject: { projectRef: OTHER },
    secretKey: { publishableKey: 'sb_secret_syntheticOnly123456' },
    legacyJWT: { publishableKey: 'ey.synthetic.role' },
    enabledTypo: { enabled: 'yes' }, unknown: { brokerUrl: 'https://evil.example' } })) {
    test(`configuration blocks ${label} without reflecting input`, () => {
        assert.deepEqual(configuration({ ...validConfig(), ...patch }, REF),
            { mode: 'blocked', reason: 'invalid_control_plane_config' });
    });
}
test('local admin prerequisite before any state generation', async () => {
    const f = fixture();
    await assert.rejects(prepare({ ...f.options, localAdminApproved: false }), /local_admin_required/);
    assert.equal(await f.store.read(), null);
});
test('durable pending state precedes transport and excludes human credentials', async () => {
    const f = fixture();
    const state = await f.prepare();
    assert.deepEqual(await f.store.read(), state);
    assert.notEqual(state.secret, state.pollSecret);
    assert.match(state.secret, /^[a-f0-9]{64}$/);
    const body = beginBody(state);
    assert.equal(Object.hasOwn(body, 'secret'), false);
    assert.equal(Object.hasOwn(body, 'pollSecret'), false);
    assert.equal(Object.hasOwn(body, 'access_token'), false);
    assert.equal(Object.hasOwn(body, 'refresh_token'), false);
    assert.equal(await f.exchange({ begin: b => {
        assert.equal(f.writes.length, 1);
        f.broker.begin(b);
    }, redeem: b => f.broker.redeem(b) }), null);
});
test('storage failure prevents any network-ready pending state', async () => {
    const f = fixture(); f.failWrites();
    await assert.rejects(f.prepare(), /synthetic_storage_failure/);
    assert.equal(await f.store.read(), null);
    await assert.rejects(f.exchange(), /invalid_shape/);
});
test('restart reuses same secrets, nonce and idempotency identity', async () => {
    const f = fixture(); const first = await f.prepare();
    assert.deepEqual(await f.prepare(), first);
    assert.equal(f.writes.length, 1);
});
test('unknown or corrupt stored state stops without overwrite', async () => {
    for (const mutate of [s => ({ ...s, version: 2 }), s => ({ ...s, secret: 'bad' }),
        s => ({ ...s, ownerJWT: 'synthetic' }), s => ({ ...s, status: 'unknown' })]) {
        const f = fixture(); const state = await f.prepare();
        f.corrupt(mutate(state));
        await assert.rejects(f.prepare(), /invalid_shape|recovery_required/);
        assert.equal(f.writes.length, 1);
    }
});
test('changed project/installation never reuse stored credential', async () => {
    const f = fixture(); await f.prepare();
    for (const change of [{ projectRef: OTHER }, { serverInstanceId: randomUUID() }]) {
        await assert.rejects(prepare({ ...f.options, ...change, localAdminApproved: true }), /recovery_required/);
    }
});
test('unapproved pairing stays pending; polling is rate limited', async () => {
    const f = fixture(); await f.prepare();
    assert.equal(await f.exchange(), null);
    await assert.rejects(f.exchange(), /slow_down/);
    f.advance(); assert.equal(await f.exchange(), null);
});
test('owner approval requires current authority and exact installation confirmation', async () => {
    const f = fixture(); const state = await f.prepare(); f.broker.begin(beginBody(state));
    assert.throws(() => f.broker.approve(state.pairId, randomUUID(), f.instance), /owner_required/);
    assert.throws(() => f.broker.approve(state.pairId, f.owner, randomUUID()), /owner_required/);
    f.signOut();
    assert.throws(() => f.broker.approve(state.pairId, f.owner, f.instance), /owner_required/);
});
test('approved exchange atomically retains credential and matching mapping', async () => {
    const f = fixture(); const pending = await f.prepare(); await f.approve();
    const result = await f.exchange(); const active = await f.store.read();
    assert.equal(active.status, 'active'); assert.equal(active.secret, pending.secret);
    assert.deepEqual(active.mapping, result); assert.equal(f.writes.length, 2);
    assert.deepEqual(await f.exchange({ begin: () => assert.fail('unexpected transport') }), result);
});
test('lost begin response reuses exact persisted operation', async () => {
    const f = fixture(); const pending = await f.prepare();
    await assert.rejects(f.exchange({ begin: b => {
        f.broker.begin(b); throw new Error('lost_response');
    } }), /lost_response/);
    assert.deepEqual(await f.store.read(), pending);
    await f.approve(); assert.ok(await f.exchange());
});
test('lost redemption response retries one mapping, never regenerates secret', async () => {
    const f = fixture(); const pending = await f.prepare(); await f.approve(); let committed;
    await assert.rejects(f.exchange({ begin: b => f.broker.begin(b), redeem: b => {
        committed = f.broker.redeem(b); throw new Error('lost_response');
    } }), /lost_response/);
    assert.deepEqual(await f.prepare(), pending);
    f.advance(); assert.deepEqual(await f.exchange(), committed);
});
test('local acknowledgment write failure recovers same mapping after restart', async () => {
    const f = fixture(); await f.prepare(); await f.approve(); f.failWrites();
    await assert.rejects(f.exchange(), /synthetic_storage_failure/);
    assert.equal((await f.store.read()).status, 'pending');
    f.allowWrites(); f.advance(); assert.ok(await f.exchange());
});
test('same pair different digest/body conflicts even after redemption', async () => {
    const f = fixture(); const state = await f.prepare(); await f.approve(); await f.exchange();
    const body = beginBody(state);
    for (const change of [{ secretDigest: '0'.repeat(64) }, { credentialId: randomUUID() },
        { idempotencyKey: randomUUID() }, { serverInstanceId: randomUUID() }]) {
        assert.throws(() => f.broker.begin({ ...body, ...change }), /pairing_conflict/);
    }
});
test('polling secret cannot substitute another installation capability', async () => {
    const f = fixture(); const state = await f.prepare(); await f.approve();
    assert.throws(() => f.broker.redeem({ ...beginBody(state), pollSecret: '0'.repeat(64) }), /invalid_pairing_proof/);
    assert.equal((await f.store.read()).status, 'pending');
});
test('expired grant fails even for previously committed lost-response retry', async () => {
    const f = fixture(); const state = await f.prepare(); await f.approve();
    f.broker.redeem({ ...beginBody(state), pollSecret: state.pollSecret });
    f.advance(TTL);
    await assert.rejects(f.exchange(), /pairing_expired/);
    assert.throws(() => f.broker.redeem({ ...beginBody(state), pollSecret: state.pollSecret }), /pairing_unavailable/);
    assert.deepEqual(await f.prepare(), state);
});
test('revocation rejects cached successful redemption result', async () => {
    const f = fixture(); const state = await f.prepare(); await f.approve();
    f.broker.redeem({ ...beginBody(state), pollSecret: state.pollSecret });
    f.broker.revoke(state.pairId); f.advance();
    await assert.rejects(f.exchange(), /pairing_unavailable/);
});
test('current owner session/profile revocation denies redemption and cached retry', async () => {
    for (const committed of [false, true]) {
        const f = fixture(); const state = await f.prepare(); await f.approve();
        if (committed) f.broker.redeem({ ...beginBody(state), pollSecret: state.pollSecret });
        f.signOut(); f.advance(); await assert.rejects(f.exchange(), /owner_required/);
    }
});
test('second pairing for cloned UUID does not overwrite mapping', async () => {
    const f = fixture(); await f.prepare(); await f.approve(); const mapping = await f.exchange();
    f.corrupt(null); await f.prepare(); await f.approve();
    await assert.rejects(f.exchange(), /clone_conflict/);
    assert.equal((await f.store.read()).status, 'pending');
    assert.equal(mapping.serverInstanceId, f.instance);
});
test('untrusted extra fields are not owner or operational authority', async () => {
    const f = fixture(); const state = await f.prepare();
    assert.throws(() => f.broker.begin({ ...beginBody(state), owner: f.owner }), /invalid_shape/);
    await f.approve();
    assert.throws(() => f.broker.redeem({ ...beginBody(state), pollSecret: state.pollSecret,
        role: 'ADMIN' }), /invalid_shape/);
});
test('malformed or foreign broker results never commit active state', async () => {
    for (const patch of [{ serverInstanceId: randomUUID() }, { projectRef: OTHER },
        { epoch: 2 }, { credentialId: randomUUID() }, { access_token: 'synthetic' }]) {
        const f = fixture(); const state = await f.prepare();
        await assert.rejects(f.exchange({ begin: () => {}, redeem: () => ({
            projectRef: REF, serverInstanceId: f.instance, credentialId: state.credentialId,
            cloudServerId: randomUUID(), epoch: 1, ...patch }) }), /invalid_mapping|invalid_shape/);
        assert.deepEqual(await f.store.read(), state);
    }
});
test('expiry during transport prevents local activation', async () => {
    const f = fixture(); await f.prepare(); await f.approve();
    await assert.rejects(f.exchange({ begin: b => f.broker.begin(b), redeem: b => {
        const result = f.broker.redeem(b); f.advance(TTL); return result;
    } }), /pairing_expired/);
    assert.equal((await f.store.read()).status, 'pending');
});
test('simulator defaults to denying all human approval', async () => {
    const f = fixture(); const state = await f.prepare();
    const broker = simulator({ projectRef: REF, now: f.options.now });
    broker.begin(beginBody(state));
    assert.throws(() => broker.approve(state.pairId, f.owner, f.instance), /owner_required/);
});
test('truthy non-boolean authority never approves or redeems including cached results', async () => {
    for (const invalid of ['true', {}, Promise.resolve(false)]) {
        const f = fixture(); const state = await f.prepare();
        let authority = invalid;
        const broker = simulator({ projectRef: REF, now: f.options.now,
            checkOwner: () => authority });
        const body = beginBody(state);
        broker.begin(body);
        assert.throws(() => broker.approve(state.pairId, f.owner, f.instance), /owner_required/);
        authority = true; broker.approve(state.pairId, f.owner, f.instance);
        authority = invalid;
        assert.throws(() => broker.redeem({ ...body, pollSecret: state.pollSecret }), /owner_required/);
        f.advance(); authority = true;
        const mapping = broker.redeem({ ...body, pollSecret: state.pollSecret });
        assert.ok(mapping); f.advance(); authority = invalid;
        assert.throws(() => broker.redeem({ ...body, pollSecret: state.pollSecret }), /owner_required/);
    }
});
