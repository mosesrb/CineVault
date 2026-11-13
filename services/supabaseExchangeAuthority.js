const jwt = require('jsonwebtoken');
const { performance } = require('node:perf_hooks');
const { PROJECT_REF, UUID, matches } = require('./controlPlane/protocol');

const base = `https://${PROJECT_REF}.supabase.co`;
const issuer = base + '/auth/v1';
const maxResponseBytes = 32768;
const deadlineMs = 5000;

class ExchangeFailure extends Error {
    constructor(status) {
        super('Supabase exchange rejected');
        this.status = status;
    }
}

async function readJson(url, headers, signal, fetchImpl) {
    const response = await fetchImpl(url, { headers, signal, redirect: 'error', cache: 'no-store' });
    try {
        if (response.status !== 200 || response.redirected || (response.url && response.url !== url) ||
            !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) {
            throw new ExchangeFailure([401, 403].includes(response.status) ? 401 : 503);
        }
        const reader = response.body.getReader();
        try {
            const chunks = [];
            let size = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > maxResponseBytes) throw new ExchangeFailure(503);
                chunks.push(value);
            }
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        } finally {
            void reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    } finally {
        if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
}

function checkedClaims(token, now) {
    if (typeof token !== 'string' || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
        throw new ExchangeFailure(401);
    }
    let decoded;
    try {
        decoded = jwt.decode(token, { complete: true });
    } catch {
        throw new ExchangeFailure(401);
    }
    const { header, payload } = decoded || {};
    if (!header || !['ES256', 'RS256'].includes(header.alg) || header.typ !== 'JWT' ||
        !matches(/^[\w-]{1,128}$/, header.kid) || Object.keys(header).some(key => !['alg', 'kid', 'typ'].includes(key)) ||
        !payload || payload.iss !== issuer || payload.aud !== 'authenticated' || payload.role !== 'authenticated' ||
        payload.is_anonymous !== false || !matches(UUID, payload.sub) || !matches(UUID, payload.session_id) ||
        !Number.isSafeInteger(payload.exp) || payload.exp > Number.MAX_SAFE_INTEGER / 1000 || payload.exp <= now ||
        !Number.isSafeInteger(payload.iat) || payload.iat > now || payload.iat >= payload.exp) {
        throw new ExchangeFailure(401);
    }
    return payload;
}

async function verifyCloudMembership({ token, serverInstanceId, publishableKey, fetchImpl = fetch }) {
    if (!matches(UUID, serverInstanceId) || !matches(/^sb_publishable_[\w-]{16,256}$/, publishableKey)) {
        throw new ExchangeFailure(503);
    }
    const claims = checkedClaims(token, Math.floor(Date.now() / 1000));
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    const headers = { apikey: publishableKey, Authorization: 'Bearer ' + token };
    try {
        // Auth verifies the exact bearer signature and performs the fresh user
        // check. Decoded claims guide validation only after that request succeeds.
        const user = await readJson(issuer + '/user', headers, controller.signal, fetchImpl);
        if (user?.id !== claims.sub || user.is_anonymous !== false || user.deleted_at != null ||
            (user.banned_until != null &&
                (typeof user.banned_until !== 'string' || !(Date.parse(user.banned_until) <= Date.now())))) {
            throw new ExchangeFailure(401);
        }

        const url = new URL(base + '/rest/v1/server_users');
        url.search = new URLSearchParams({
            select: 'user_id,enabled,download_allowed,server:servers!inner(server_instance_id),profile:profiles!inner(id,blocked,must_change_password)',
            user_id: 'eq.' + claims.sub,
            'server.server_instance_id': 'eq.' + serverInstanceId,
            enabled: 'is.true',
            limit: '2'
        });
        const rows = await readJson(url.href, headers, controller.signal, fetchImpl);
        const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
        if (row?.user_id !== claims.sub || row.enabled !== true || typeof row.download_allowed !== 'boolean' ||
            row.server?.server_instance_id !== serverInstanceId ||
            row.profile?.id !== claims.sub || row.profile.blocked !== false || row.profile.must_change_password !== false) {
            throw new ExchangeFailure(403);
        }
        if (controller.signal.aborted || performance.now() - started >= deadlineMs) throw new ExchangeFailure(503);
        if (Math.floor(Date.now() / 1000) >= claims.exp) throw new ExchangeFailure(401);
        return { subject: claims.sub, expiresAt: claims.exp, downloadAllowed: row.download_allowed };
    } catch (error) {
        if (error instanceof ExchangeFailure) throw error;
        throw new ExchangeFailure(503);
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

module.exports = { verifyCloudMembership, ExchangeFailure };
