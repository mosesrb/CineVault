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
    if(value?.status==='recovering') {
        exact(value,['version','status','projectRef','serverInstanceId','cloudServerId','candidate']);
        if(value.version!==3 || value.projectRef!==projectRef || value.serverInstanceId!==serverInstanceId ||
            !matches(UUID,value.cloudServerId) || value.candidate?.status!=='pairing')fail();
        validateState(value.candidate,projectRef,serverInstanceId);return value;
    }
    if(value?.status==='replacing') {
        exact(value,['version','status','projectRef','serverInstanceId','previous','candidate']);
        if(value.version!==2 || value.projectRef!==projectRef || value.serverInstanceId!==serverInstanceId ||
            value.previous?.status!=='active' || value.candidate?.status!=='pairing')fail();
        validateState(value.previous,projectRef,serverInstanceId);validateState(value.candidate,projectRef,serverInstanceId);
        if(value.previous.credentialId===value.candidate.credentialId || value.previous.secret===value.candidate.secret ||
            value.previous.mapping.epoch>=Number.MAX_SAFE_INTEGER-1)fail();
        return value;
    }
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
/** Renew only the short approval challenge. Keep the candidate keys because a
 * previous registration may have committed without a locally saved reply. */
function renewPairing(state, now) {
    validateState(state,state.projectRef,state.serverInstanceId);
    if(state.status!=='pairing' || !integer(now) || now<state.expiresAt || now>Number.MAX_SAFE_INTEGER-PAIR_TTL)fail();
    return {...state,pairId:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),expiresAt:now+PAIR_TTL};
}
function validateTransition(previous, next) {
    if(previous?.status==='recovering') {
        if(next.status!=='active' || next.sequence!==0 || next.pending!==null || next.mapping.cloudServerId!==previous.cloudServerId)fail();
        for(const k of Object.keys(previous.candidate).filter(k=>k!=='status'))if(next[k]!==previous.candidate[k])fail();
        return;
    }
    if(next.status==='replacing') {
        if(previous?.status==='active') {
            if(JSON.stringify(next.previous)!==JSON.stringify(previous))fail();
        }else if(previous?.status==='replacing') {
            if(JSON.stringify(next.previous)!==JSON.stringify(previous.previous))fail();
            for(const k of Object.keys(previous.candidate).filter(k=>!['pairId','expiresAt','idempotencyKey'].includes(k)))
                if(previous.candidate[k]!==next.candidate[k])fail();
            if(next.candidate.expiresAt<previous.candidate.expiresAt)fail();
        }else fail();
        return;
    }
    if(previous?.status==='replacing') {
        if(next.status!=='active' || next.sequence!==0 || next.pending!==null)fail();
        for(const k of Object.keys(previous.candidate).filter(k=>k!=='status'))
            if(next[k]!==previous.candidate[k])fail();
        if(next.mapping.cloudServerId!==previous.previous.mapping.cloudServerId ||
            next.mapping.epoch!==previous.previous.mapping.epoch+1)fail();
        return;
    }
    if (!previous) {
        if (next.status !== 'pairing') fail();
        return;
    }
    if(previous.status==='pairing' && next.status==='pairing' && next.expiresAt>previous.expiresAt &&
        next.pairId!==previous.pairId && next.idempotencyKey!==previous.idempotencyKey) {
        for(const key of Object.keys(previous).filter(k=>!['pairId','expiresAt','idempotencyKey'].includes(k)))
            if(previous[key]!==next[key])fail();
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
/** Replacement uses a domain-separated proof bound to the old mapping/epoch.
 * The saved candidate survives grant renewal; a lost reply never changes keys. */
function replacementRequest(state) {
    validateState(state,state.projectRef,state.serverInstanceId);
    if(state.status!=='replacing')fail();
    const {credentialId,cloudServerId,epoch}=state.previous.mapping;
    const request={...pairingRequest(state.candidate).request,replacement:{credentialId,cloudServerId,epoch}};
    const values=[...bindingFields.slice(0,8).map(k=>request[k]),credentialId,cloudServerId,epoch];
    const approvalProof=crypto.createHmac('sha256',Buffer.from(state.candidate.pollSecret,'hex'))
        .update('cinevault-replacement-v1\n'+JSON.stringify(values)).digest('hex');
    request.approvalDigest=digest(approvalProof);
    return {request,approvalProof};
}
/** Disaster restore binds the explicitly confirmed existing cloud server. Only
 * fresh cloud-owner SQL authority can select the current epoch being replaced. */
function recoveryRequest(state) {
    validateState(state,state.projectRef,state.serverInstanceId);if(state.status!=='recovering')fail();
    const request={...pairingRequest(state.candidate).request,recovery:{cloudServerId:state.cloudServerId}};
    const values=[...bindingFields.slice(0,8).map(k=>request[k]),state.cloudServerId];
    const approvalProof=crypto.createHmac('sha256',Buffer.from(state.candidate.pollSecret,'hex'))
        .update('cinevault-restore-v1\n'+JSON.stringify(values)).digest('hex');
    request.approvalDigest=digest(approvalProof);return {request,approvalProof};
}
module.exports = { PROJECT_REF, UUID, HEX, PAIR_TTL, digest, exact, integer, matches,
    bindingFields, bindingDigest, pairingRequest, replacementRequest, recoveryRequest, validateState, validateMapping, initialState, renewPairing, validateTransition };
