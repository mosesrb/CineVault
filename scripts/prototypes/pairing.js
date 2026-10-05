'use strict';

// DISPOSABLE PROTOCOL MODEL. No network, filesystem, Auth SDK or app imports.
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const REF = /^[a-z]{20}$/;
const TTL = 300000;
const POLL_INTERVAL = 5000;
const fail = code => { throw new Error(code); };
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
function exact(value, fields) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail('invalid_shape');
}
function clock(now) {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) fail('invalid_clock');
    return value;
}
function equal(a, b) {
    return typeof a === 'string' && HEX.test(a) && typeof b === 'string' && HEX.test(b) &&
        timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Pure opt-in configuration check: never makes local readiness depend on cloud. */
function configuration(input, expectedRef) {
    if (input === undefined) return Object.freeze({ mode: 'disabled' });
    if (!input || Object.getPrototypeOf(input) !== Object.prototype) {
        return Object.freeze({ mode: 'blocked', reason: 'invalid_control_plane_config' });
    }
    if (input.enabled === undefined || input.enabled === false || input.enabled === 'false') {
        return Object.freeze({ mode: 'disabled' });
    }
    try {
        exact(input, ['enabled', 'projectRef', 'projectUrl', 'publishableKey']);
        if (input.enabled !== true && input.enabled !== 'true') fail('invalid_config');
        if (!REF.test(expectedRef) || input.projectRef !== expectedRef ||
            input.projectUrl !== `https://${expectedRef}.supabase.co` ||
            typeof input.publishableKey !== 'string' ||
            !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(input.publishableKey)) fail('invalid_config');
        return Object.freeze({ mode: 'ready', projectRef: expectedRef,
            brokerUrl: `${input.projectUrl}/functions/v1/cinevault-pairing` });
    } catch { return Object.freeze({ mode: 'blocked', reason: 'invalid_control_plane_config' }); }
}

const pendingFields = ['version', 'status', 'projectRef', 'serverInstanceId', 'pairId',
    'credentialId', 'secret', 'pollSecret', 'expiresAt', 'idempotencyKey'];
function validateState(state, projectRef, serverInstanceId) {
    exact(state, state?.status === 'active' ? [...pendingFields, 'mapping'] : pendingFields);
    if (state.version !== 1 || !['pending', 'active'].includes(state.status) ||
        state.projectRef !== projectRef || !REF.test(projectRef) ||
        state.serverInstanceId !== serverInstanceId || !UUID.test(serverInstanceId) ||
        !UUID.test(state.pairId) || !UUID.test(state.credentialId) ||
        !UUID.test(state.idempotencyKey) || !HEX.test(state.secret) || !HEX.test(state.pollSecret) ||
        !Number.isSafeInteger(state.expiresAt) || state.expiresAt < TTL) fail('recovery_required');
    if (state.status === 'active') validateMapping(state.mapping, state);
    return state;
}
function validateMapping(mapping, state) {
    exact(mapping, ['projectRef', 'serverInstanceId', 'credentialId', 'cloudServerId', 'epoch']);
    if (mapping.projectRef !== state.projectRef || mapping.serverInstanceId !== state.serverInstanceId ||
        mapping.credentialId !== state.credentialId || !UUID.test(mapping.cloudServerId) ||
        mapping.epoch !== 1) fail('invalid_mapping');
}

/** Store is an injected atomic/durable adapter contract, NOT an ACL implementation.
 * Persist all secrets before any transport. Restart always reuses existing state.
 * Caller must serialize one coordinator per installation; no concurrent writer claim.
 */
async function prepare({ store, projectRef, serverInstanceId, localAdminApproved, now = Date.now }) {
    if (localAdminApproved !== true) fail('local_admin_required');
    if (!REF.test(projectRef) || !UUID.test(serverInstanceId)) fail('invalid_identity');
    const existing = await store.read();
    if (existing !== null) return validateState(existing, projectRef, serverInstanceId);
    const state = { version: 1, status: 'pending', projectRef, serverInstanceId,
        pairId: randomUUID(), credentialId: randomUUID(), secret: token(), pollSecret: token(),
        expiresAt: clock(now) + TTL, idempotencyKey: randomUUID() };
    await store.writeAtomic(state);
    return structuredClone(state);
}
function beginBody(state) {
    return { projectRef: state.projectRef, serverInstanceId: state.serverInstanceId,
        pairId: state.pairId, credentialId: state.credentialId, secretDigest: digest(state.secret),
        pollDigest: digest(state.pollSecret), expiresAt: state.expiresAt,
        idempotencyKey: state.idempotencyKey };
}

/** One caller-driven poll only; there is deliberately no idle scheduler/keepalive. */
async function exchange({ store, transport, projectRef, serverInstanceId, now = Date.now }) {
    const state = validateState(await store.read(), projectRef, serverInstanceId);
    if (state.status === 'active') return structuredClone(state.mapping);
    if (clock(now) >= state.expiresAt) fail('pairing_expired');
    await transport.begin(beginBody(state));
    const result = await transport.redeem({ ...beginBody(state), pollSecret: state.pollSecret });
    if (result === null) return null;
    validateMapping(result, state);
    if (clock(now) >= state.expiresAt) fail('pairing_expired');
    await store.writeAtomic({ ...state, status: 'active', mapping: structuredClone(result) });
    return structuredClone(result);
}

/** In-memory broker simulator only. approve/checkOwner are test trust adapters,
 * not body fields, JWT validators or production session/ownership proof.
 * Sync methods model serial transactions; they do not prove database locking.
 */
function simulator({ projectRef, now = Date.now, checkOwner = () => false }) {
    const pairs = new Map();
    const installations = new Map();
    const fields = ['projectRef', 'serverInstanceId', 'pairId', 'credentialId',
        'secretDigest', 'pollDigest', 'expiresAt', 'idempotencyKey'];
    function row(body) {
        const found = pairs.get(body.pairId);
        if (!found || found.revoked || clock(now) >= found.body.expiresAt) fail('pairing_unavailable');
        if (JSON.stringify(fields.map(key => body[key])) !== found.binding) fail('pairing_conflict');
        return found;
    }
    return {
        begin(body) {
            exact(body, fields);
            if (body.projectRef !== projectRef || !REF.test(projectRef) ||
                !['serverInstanceId', 'pairId', 'credentialId', 'idempotencyKey'].every(key => UUID.test(body[key])) ||
                !HEX.test(body.secretDigest) || !HEX.test(body.pollDigest) ||
                !Number.isSafeInteger(body.expiresAt) || body.expiresAt <= clock(now) ||
                body.expiresAt > clock(now) + TTL) fail('invalid_pairing');
            if (pairs.has(body.pairId)) { row(body); return; }
            pairs.set(body.pairId, { body: structuredClone(body),
                binding: JSON.stringify(fields.map(key => body[key])), owner: null,
                revoked: false, result: null, nextPoll: 0 });
        },
        approve(pairId, human, confirmedInstanceId) {
            const found = pairs.get(pairId);
            if (!found || found.revoked || clock(now) >= found.body.expiresAt) fail('pairing_unavailable');
            if (confirmedInstanceId !== found.body.serverInstanceId ||
                checkOwner(human, confirmedInstanceId) !== true) fail('owner_required');
            if (found.owner && found.owner !== human) fail('owner_conflict');
            found.owner = human;
        },
        redeem(body) {
            exact(body, [...fields, 'pollSecret']);
            const found = row(body);
            if (typeof body.pollSecret !== 'string' || !HEX.test(body.pollSecret) ||
                !equal(digest(body.pollSecret), found.body.pollDigest)) fail('invalid_pairing_proof');
            const time = clock(now);
            if (time < found.nextPoll) fail('slow_down');
            found.nextPoll = time + POLL_INTERVAL;
            if (!found.owner) return null;
            if (checkOwner(found.owner, found.body.serverInstanceId) !== true) fail('owner_required');
            if (found.result) return structuredClone(found.result);
            if (installations.has(found.body.serverInstanceId)) fail('clone_conflict');
            found.result = { projectRef, serverInstanceId: found.body.serverInstanceId,
                credentialId: found.body.credentialId, cloudServerId: randomUUID(), epoch: 1 };
            installations.set(found.body.serverInstanceId, found.result);
            return structuredClone(found.result);
        },
        revoke(pairId) {
            const found = pairs.get(pairId);
            if (!found) fail('pairing_unavailable');
            found.revoked = true;
        }
    };
}

module.exports = { configuration, prepare, exchange, beginBody, simulator, TTL, POLL_INTERVAL };
