'use strict';
// ISOLATED RESEARCH ADAPTERS. Not imported by application or a deployed broker.
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { validateState, beginBody, TTL, configuration } = require('./pairing');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const LOCAL_ID = /^[a-f0-9]{24}$/;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const CSRF_TTL = 120000;
const deny = () => { throw new Error('enrollment_denied'); };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && HEX.test(a) && HEX.test(b) &&
    crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const fields = ['projectRef', 'serverInstanceId', 'pairId', 'credentialId', 'secretDigest',
    'pollDigest', 'expiresAt', 'idempotencyKey', 'approvalDigest'];
function time(now) {
    const value = now(); if (!Number.isSafeInteger(value) || value < 0) deny(); return value;
}
function exact(value, keys) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) deny();
}
function validRequest(request, projectRef, now) {
    exact(request, fields);
    if (request.projectRef !== projectRef || !/^[a-z]{20}$/.test(projectRef) ||
        !['serverInstanceId', 'pairId', 'credentialId', 'idempotencyKey'].every(k => matches(UUID, request[k])) ||
        !['secretDigest', 'pollDigest', 'approvalDigest'].every(k => matches(HEX, request[k])) ||
        !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= time(now) ||
        request.expiresAt > time(now) + TTL) deny();
}
const bindingDigest = request => sha(JSON.stringify(fields.map(k => request[k])));

/** Derive an approval-only proof from durable pending state. Only the digest
 * travels in begin; the proof is shown by a future authenticated local admin UI.
 * This does not prove hardware honesty or establish the initial cloud owner.
 */
function challenge(state, projectRef, serverInstanceId, now = Date.now) {
    const snapshot = structuredClone(state); validateState(snapshot, projectRef, serverInstanceId);
    if (snapshot.status !== 'pending' || snapshot.expiresAt <= time(now)) deny();
    const body = beginBody(snapshot);
    const approvalProof = hmac(Buffer.from(snapshot.pollSecret, 'hex'),
        'cinevault-approval-v1\n' + JSON.stringify(Object.values(body)));
    const request = { ...body, approvalDigest: sha(approvalProof) };
    validRequest(request, projectRef, now);
    return { request, approvalProof };
}

/** Bound remote reads even if an injected adapter ignores cancellation.
 * Read adapters must be side-effect-free and cooperate with the supplied signal.
 */
async function bounded(timeoutMs, action) {
    const controller = new AbortController(); let timer;
    try {
        return await Promise.race([Promise.resolve().then(() => action(controller.signal)),
            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('enrollment_denied')); }, timeoutMs); })]);
    } finally { clearTimeout(timer); }
}
async function readJson(response) {
    if (response.status !== 200 || response.redirected ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) deny();
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength; if (size > 16384) deny(); chunks.push(Buffer.from(value));
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function dateMillis(value) {
    return value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
}
function currentUntil(value, now) {
    return value === null || (Number.isFinite(dateMillis(value)) && dateMillis(value) > time(now));
}

/** Keys, fetch and current-row reader are trusted constructor adapters, never
 * request fields. Static key snapshot expires within five minutes; no fallback
 * to token-provided URLs, HS256 project secrets or stale cached authority.
 * Current-row reader MUST eventually run under the consuming transaction guard;
 * this preflight alone cannot eliminate revocation races or authorize writes.
 */
function createCloudGate({ config, signingKeys, keysValidUntil, readCurrent, fetchUser = fetch,
    now = Date.now, timeoutMs = 10000 }) {
    const projectRef = config?.projectRef; const checked = configuration(config, projectRef);
    if (!matches(/^[a-z]{20}$/, projectRef) || checked.mode !== 'ready' || typeof readCurrent !== 'function' || typeof fetchUser !== 'function' ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000 ||
        !Number.isSafeInteger(keysValidUntil) || keysValidUntil <= time(now) || keysValidUntil > time(now) + TTL ||
        !Array.isArray(signingKeys) || !signingKeys.length || signingKeys.length > 8) deny();
    const keys = new Map();
    for (const entry of signingKeys) {
        if (!entry || typeof entry.kid !== 'string' || !/^[\w-]{1,128}$/.test(entry.kid) ||
            !['ES256', 'RS256'].includes(entry.algorithm) || keys.has(entry.kid) || entry.key?.type !== 'public') deny();
        const key = crypto.createPublicKey(entry.key.export({ type: 'spki', format: 'pem' }));
        if ((entry.algorithm === 'ES256' && (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1')) ||
            (entry.algorithm === 'RS256' && (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048))) deny();
        keys.set(entry.kid, { algorithm: entry.algorithm, key });
    }
    const issuer = `https://${projectRef}.supabase.co/auth/v1`;
    const userUrl = issuer + '/user', publishableKey = config.publishableKey;
    return {
        async authorize({ accessToken, request, approvalProof }) {
            try {
                request = structuredClone(request); validRequest(request, projectRef, now);
                if (!matches(HEX, approvalProof) || !same(sha(approvalProof), request.approvalDigest) ||
                    typeof accessToken !== 'string' || accessToken.length > 8192 || time(now) >= keysValidUntil) deny();
                const decoded = jwt.decode(accessToken, { complete: true });
                exact(decoded?.header, ['alg', 'typ', 'kid']);
                const entry = keys.get(decoded.header.kid);
                if (!entry || decoded.header.typ !== 'JWT' || decoded.header.alg !== entry.algorithm) deny();
                const claims = jwt.verify(accessToken, entry.key, { algorithms: [entry.algorithm], issuer,
                    audience: 'authenticated', clockTimestamp: Math.floor(time(now) / 1000) });
                if (claims.aud !== 'authenticated' || claims.role !== 'authenticated' || claims.is_anonymous !== false ||
                    !matches(UUID, claims.sub) || !matches(UUID, claims.session_id) || !Number.isSafeInteger(claims.exp) ||
                    !Number.isSafeInteger(claims.iat) || claims.iat > Math.floor(time(now) / 1000) || claims.exp <= claims.iat) deny();
                const user = await bounded(timeoutMs, async signal => {
                    const response = await fetchUser(userUrl, { method: 'GET', redirect: 'error', cache: 'no-store',
                        credentials: 'omit', referrerPolicy: 'no-referrer', signal,
                        headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` } });
                    if (response.url && response.url !== userUrl) deny();
                    return readJson(response);
                });
                if (user.id !== claims.sub || user.is_anonymous !== false || user.deleted_at != null ||
                    (user.banned_until != null && (typeof user.banned_until !== 'string' ||
                        !Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > time(now)))) deny();
                const digest = bindingDigest(request);
                const rows = await bounded(timeoutMs, signal => readCurrent(Object.freeze({ userId: claims.sub,
                    sessionId: claims.session_id, projectRef, serverInstanceId: request.serverInstanceId, bindingDigest: digest }), signal));
                const { session, profile, approval } = rows || {};
                if (!session || session.id !== claims.session_id || session.user_id !== claims.sub || !currentUntil(session.not_after, now) ||
                    !profile || profile.id !== claims.sub || profile.blocked !== false || profile.must_change_password !== false ||
                    !approval || approval.owner_user_id !== claims.sub || approval.enabled !== true ||
                    approval.project_ref !== projectRef || approval.server_instance_id !== request.serverInstanceId ||
                    !same(approval.binding_digest, digest)) deny();
                validRequest(request, projectRef, now);
                if (time(now) >= keysValidUntil || Math.floor(time(now) / 1000) >= claims.exp) deny();
                return Object.freeze({ userId: claims.sub, sessionId: claims.session_id, projectRef,
                    serverInstanceId: request.serverInstanceId, pairId: request.pairId, bindingDigest: digest, expiresAt: request.expiresAt });
            } catch { deny(); }
        }
    };
}

/** Stateless, short-lived CSRF binding, with fresh local access-session/ADMIN
 * reads on issuance and use. Not a replacement for app auth/CORS middleware or
 * an initial-owner provisioning path. Exact configured origin, never Host-derived.
 */
function createLocalGate({ origin, serverInstanceId, jwtKey, readCurrent, now = Date.now, timeoutMs = 10000 }) {
    let url; try { url = new URL(origin); } catch { deny(); }
    if (url.origin !== origin || url.username || url.password || !matches(UUID, serverInstanceId) ||
        !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
        typeof jwtKey !== 'string' || Buffer.byteLength(jwtKey) < 32 || typeof readCurrent !== 'function' ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000) deny();
    const csrfKey = crypto.randomBytes(32);
    function packet(method, headers) {
        if (method !== 'POST' || !headers || headers.origin !== origin || headers.host !== url.host ||
            headers['sec-fetch-site'] !== 'same-origin' || headers['content-type'] !== 'application/json') deny();
    }
    async function localUser(accessToken) {
        if (typeof accessToken !== 'string' || accessToken.length > 8192) deny();
        const claims = jwt.verify(accessToken, jwtKey, { algorithms: ['HS256'], issuer: 'cinevault', audience: 'cinevault-api',
            clockTimestamp: Math.floor(time(now) / 1000) });
        if (claims.tokenType !== 'access' || claims.isStreamTicket || claims.iss !== 'cinevault' || claims.aud !== 'cinevault-api' ||
            !matches(LOCAL_ID, claims._id) || !Number.isSafeInteger(claims.exp)) deny();
        const tokenDigest = sha(accessToken);
        const rows = await bounded(timeoutMs, signal => readCurrent(Object.freeze({ userId: claims._id, tokenDigest }), signal));
        const { user, session } = rows || {};
        if (!user || String(user._id) !== claims._id || user.isAdmin !== true || user.isApproved !== true ||
            typeof user.isBanned !== 'boolean' || (user.isBanned && (!user.banExpiresAt ||
                !Number.isFinite(dateMillis(user.banExpiresAt)) || dateMillis(user.banExpiresAt) > time(now))) ||
            !session || String(session.userId) !== claims._id || !same(session.tokenDigest, tokenDigest) ||
            Math.floor(time(now) / 1000) >= claims.exp) deny();
        return { userId: claims._id, tokenDigest };
    }
    return {
        async issueCsrf({ method, headers, accessToken }) {
            try {
                packet(method, headers); const user = await localUser(accessToken);
                const body = Buffer.from(JSON.stringify({ version: 1, tokenDigest: user.tokenDigest,
                    issuedAt: time(now), nonce: crypto.randomBytes(32).toString('hex') })).toString('base64url');
                return body + '.' + hmac(csrfKey, body);
            } catch { deny(); }
        },
        async authorize({ method, headers, accessToken, csrfToken }) {
            try {
                packet(method, headers);
                if (typeof csrfToken !== 'string' || csrfToken.length > 1024) deny();
                const parts = csrfToken.split('.'); if (parts.length !== 2 || !same(hmac(csrfKey, parts[0]), parts[1])) deny();
                const body = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
                exact(body, ['version', 'tokenDigest', 'issuedAt', 'nonce']);
                const user = await localUser(accessToken);
                if (body.version !== 1 || !HEX.test(body.nonce) || !same(body.tokenDigest, user.tokenDigest) ||
                    !Number.isSafeInteger(body.issuedAt) || body.issuedAt > time(now) || time(now) >= body.issuedAt + CSRF_TTL) deny();
                return Object.freeze({ userId: user.userId, serverInstanceId });
            } catch { deny(); }
        }
    };
}
module.exports = { challenge, createCloudGate, createLocalGate, bindingDigest, CSRF_TTL };
