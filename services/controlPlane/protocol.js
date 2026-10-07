'use strict';
const crypto = require('node:crypto');
const PROJECT_REF = 'uouydbapluktfrylligo';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const PAIR_TTL = 300000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function fail() { throw new Error('control_plane_recovery_required'); }
function exact(value, keys) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail();
}
function integer(value, min = 0) { return Number.isSafeInteger(value) && value >= min; }
function matches(pattern, value) { return typeof value === 'string' && pattern.test(value); }
const bindingFields = ['projectRef','serverInstanceId','pairId','credentialId','secretDigest',
    'pollDigest','expiresAt','idempotencyKey','approvalDigest'];
function pairingRequest(state) {
    const body = { projectRef: state.projectRef, serverInstanceId: state.serverInstanceId,
        pairId: state.pairId, credentialId: state.credentialId, secretDigest: digest(state.secret),
        pollDigest: digest(state.pollSecret), expiresAt: state.expiresAt, idempotencyKey: state.idempotencyKey };
    const approvalProof = crypto.createHmac('sha256', Buffer.from(state.pollSecret, 'hex'))
        .update('cinevault-approval-v1\n' + JSON.stringify(Object.values(body))).digest('hex');
    return { request: { ...body, approvalDigest: digest(approvalProof) }, approvalProof };
}
const bindingDigest = request => digest(JSON.stringify(bindingFields.map(k => request[k])));
function validatePending(pending, state) {
    exact(pending, ['operation','idempotencyKey','sequence','activity']);
    if (pending.operation !== 'heartbeat' || !matches(UUID, pending.idempotencyKey) ||
        !integer(pending.sequence, 1) || pending.sequence !== state.sequence + 1 ||
        !['authenticated-request','media-work','admin-retry','startup','shutdown'].includes(pending.activity)) fail();
}
function validateState(value, projectRef, serverInstanceId) {
    const keys = ['version','status','projectRef','serverInstanceId','pairId','credentialId','secret',
        'pollSecret','expiresAt','idempotencyKey'];
    exact(value, value?.status === 'active' ? [...keys,'mapping','sequence','pending'] : keys);
    if (value.version !== 1 || !['pairing','active'].includes(value.status) ||
        value.projectRef !== projectRef || projectRef !== PROJECT_REF ||
        value.serverInstanceId !== serverInstanceId || !matches(UUID, serverInstanceId) ||
        !['pairId','credentialId','idempotencyKey'].every(k => matches(UUID,value[k])) ||
        !['secret','pollSecret'].every(k => matches(HEX,value[k])) || !integer(value.expiresAt, PAIR_TTL)) fail();
    if (value.status === 'active') {
        validateMapping(value.mapping, value);
        if (!integer(value.sequence) || value.sequence >= Number.MAX_SAFE_INTEGER - 1) fail();
        if (value.pending !== null) validatePending(value.pending, value);
    }
    return value;
}
function validateMapping(mapping, state) {
    exact(mapping, ['projectRef','serverInstanceId','credentialId','cloudServerId','epoch','credentialExpiresAt']);
    if (mapping.projectRef !== state.projectRef || mapping.serverInstanceId !== state.serverInstanceId ||
        mapping.credentialId !== state.credentialId || !matches(UUID,mapping.cloudServerId) ||
        !integer(mapping.epoch,1) || !integer(mapping.credentialExpiresAt,1)) fail();
}
function initialState(projectRef, serverInstanceId, now) {
    if (projectRef !== PROJECT_REF || !matches(UUID,serverInstanceId) || !integer(now) || now > Number.MAX_SAFE_INTEGER - PAIR_TTL) fail();
    return { version: 1, status: 'pairing', projectRef, serverInstanceId, pairId: crypto.randomUUID(),
        credentialId: crypto.randomUUID(), secret: crypto.randomBytes(32).toString('hex'),
        pollSecret: crypto.randomBytes(32).toString('hex'), expiresAt: now + PAIR_TTL, idempotencyKey: crypto.randomUUID() };
}
function validateTransition(previous, next) {
    if (!previous) {
        if (next.status !== 'pairing') fail();
        return;
    }
    for (const key of Object.keys(previous).filter(k => !['status','mapping','sequence','pending'].includes(k))) {
        if (previous[key] !== next[key]) fail();
    }
    if (previous.status === 'pairing') {
        if (next.status === 'active' && (next.sequence !== 0 || next.pending !== null)) fail();
    } else {
        if (next.status !== 'active' || JSON.stringify(previous.mapping) !== JSON.stringify(next.mapping)) fail();
        if (previous.pending === null) {
            if (next.sequence !== previous.sequence) fail();
        } else if (next.pending !== null) {
            if (next.sequence !== previous.sequence || JSON.stringify(next.pending) !== JSON.stringify(previous.pending)) fail();
        } else if (next.sequence !== previous.pending.sequence) fail();
    }
}
module.exports = { PROJECT_REF, UUID, HEX, PAIR_TTL, digest, exact, integer, matches,
    bindingFields, bindingDigest, pairingRequest, validateState, validateMapping, initialState, validateTransition };
