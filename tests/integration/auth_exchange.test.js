const request = require('supertest');
const jwt = require('jsonwebtoken');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const { User } = require('../../models/user');
const { Session, hashSessionToken } = require('../../models/session');
const { PROJECT_REF } = require('../../services/controlPlane/protocol');
const { MIGRATION_ID } = require('../../services/identityMigrationPlan');
const { createApp } = require('../../app');
const { ensureServerIdentity } = require('../../services/serverIdentityService');
const { Movie } = require('../../models/movie');
const mongoose = require('mongoose');

const base = `https://${PROJECT_REF}.supabase.co`;
let subject;
let serverId;
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const settings = {
    CV_AUTH_EXCHANGE_ENABLED: 'true',
    CV_CONTROL_PLANE_ENABLED: 'true',
    CV_CONTROL_PLANE_PROJECT_REF: PROJECT_REF,
    CV_CONTROL_PLANE_PROJECT_URL: base,
    CV_CONTROL_PLANE_PUBLISHABLE_KEY: 'sb_publishable_fixture_only_abcdefghijkl',
    CV_CONTROL_PLANE_ADMIN_ORIGIN: 'http://localhost:5180'
};
const original = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));

function cloudToken(overrides = {}) {
    return jwt.sign({
        iss: base + '/auth/v1', aud: 'authenticated', role: 'authenticated', sub: subject,
        session_id: randomUUID(), is_anonymous: false,
        exp: Math.floor(Date.now() / 1000) + 180, ...overrides
    }, privateKey, { algorithm: 'ES256', keyid: 'fixture' });
}

function currentMember() {
    return {
        user_id: subject, enabled: true, download_allowed: false, server: { server_instance_id: serverId },
        profile: { id: subject, blocked: false, must_change_password: false }
    };
}

function mockCloud(rows = [currentMember()]) {
    return jest.spyOn(global, 'fetch').mockImplementation(async url => Response.json(
        url === base + '/auth/v1/user' ? { id: subject, is_anonymous: false } : rows
    ));
}

describe('Supabase session exchange through the application', () => {
    let app;
    let user;
    let owner;
    let token;
    let linkGeneration;

    test('exposes only the publishable configuration to the enabled direct listener', async () => {
        const config = () => request(app).get('/api/v1/auth/exchange/config').set('Host', 'localhost');
        const direct = await config();
        expect(direct.body).toEqual({ publishableKey: settings.CV_CONTROL_PLANE_PUBLISHABLE_KEY });
        expect(direct.headers['cache-control']).toBe('no-store');
        expect((await config().set('X-Forwarded-Host', 'localhost')).status).toBe(404);
        delete process.env.CV_AUTH_EXCHANGE_ENABLED;
        expect((await config()).status).toBe(404);
    });

    test('signs out only the current cloud-backed local session', async () => {
        mockCloud();
        const first = await exchange();
        const second = await exchange();
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        const signOut = await request(app).post('/api/v1/auth/exchange/logout').set('Host', 'localhost')
            .set('x-auth-token', first.body.token);
        expect(signOut.status).toBe(204);
        const profile = token => request(app).get('/api/v1/users/me').set('Host', 'localhost').set('x-auth-token', token);
        expect((await profile(first.body.token)).status).toBe(401);
        expect((await profile(second.body.token)).status).toBe(200);
    });

    beforeAll(async () => {
        if (mongoose.connection.name !== 'cinevault_test') throw Error('Isolated test database required');
        ({ serverId } = await ensureServerIdentity());
    }, 20000);

    function exchange(value = token) {
        return request(app).post('/api/v1/auth/exchange').set('Host', 'localhost')
            .set('Authorization', 'Bearer ' + value);
    }

    beforeEach(async () => {
        Object.assign(process.env, settings);
        app = createApp();
        subject = randomUUID();
        linkGeneration = randomUUID();
        token = cloudToken();
        user = await User.create({
            email: `exchange-${randomUUID()}@test.invalid`, name: 'Exchange fixture', password: 'fixture-password',
            isApproved: true
        });
        await User.collection.updateOne({ _id: user._id }, {
            $set: {
                supabaseUserId: subject, authSchemaVersion: 2,
                identityMigration: { id: MIGRATION_ID, version: 1, serverInstanceId: serverId },
                identityLinkBackup: {
                    operationId: randomUUID(), generation: linkGeneration, appliedSubject: subject,
                    versionWasMissing: true, subjectWasMissing: true
                }
            }
        });
    }, 20000);

    afterEach(async () => {
        jest.restoreAllMocks();
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        if (user) {
            await Session.deleteMany({ userId: user._id });
            await User.deleteOne({ _id: user._id });
            user = undefined;
        }
        if (owner) {
            await Session.deleteMany({ userId: owner._id });
            await User.deleteOne({ _id: owner._id });
            owner = undefined;
        }
    });

    test('issues a digest-backed session capped by the upstream expiry and checks the current local link', async () => {
        const upstream = mockCloud();
        const response = await exchange();
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        const local = response.body.token;
        const claims = jwt.decode(local);
        expect(claims.exp).toBe(jwt.decode(token).exp);
        expect(claims._id).toBe(String(user._id));
        const stored = await Session.findOne({ userId: user._id }).select('+token +tokenDigest');
        expect(stored.token).toBeUndefined();
        expect(stored.tokenDigest).toBe(hashSessionToken(local));
        expect(upstream.mock.calls).toHaveLength(2);
        const [url, options] = upstream.mock.calls[1];
        expect(new URL(url).searchParams.get('server.server_instance_id')).toBe('eq.' + serverId);
        expect(options.headers.Authorization).toBe('Bearer ' + token);
        const getAccount = () => request(app).get('/api/v1/users/me').set('Host', 'localhost').set('x-auth-token', local);
        expect((await getAccount()).status).toBe(200);
        const download = await request(app).post('/api/v1/stream/ticket').set('Host', 'localhost')
            .set('x-auth-token', local).send({ path: 'fixture.mp4', operation: 'download' });
        expect(download.status).toBe(403);
        await User.collection.updateOne({ _id: user._id }, { $set: { identityLinkBackup: { generation: randomUUID() } } });
        expect((await getAccount()).status).toBe(401);
        await User.collection.updateOne({ _id: user._id }, { $unset: { identityMigration: 1, identityLinkBackup: 1 } });
        expect((await getAccount()).status).toBe(401);
        expect(upstream.mock.calls).toHaveLength(2);
    });

    test('rejects a conflicting duplicate subject even when the competing record lacks a marker', async () => {
        mockCloud();
        owner = await User.create({
            email: `other-${randomUUID()}@test.invalid`, name: 'Other fixture', password: 'fixture-password'
        });
        await User.collection.updateOne({ _id: owner._id }, { $set: { supabaseUserId: subject } });
        expect((await exchange()).status).toBe(403);
        expect(await Session.countDocuments({ userId: user._id })).toBe(0);
    });

    test('denies a reset-required profile or a mismatched server membership', async () => {
        const membership = currentMember();
        const upstream = mockCloud([{ ...membership, profile: { ...membership.profile, must_change_password: true } }]);
        expect((await exchange()).status).toBe(403);
        upstream.mockRestore();
        mockCloud([{ ...currentMember(), server: { server_instance_id: randomUUID() } }]);
        expect((await exchange()).status).toBe(403);
        expect(await Session.countDocuments({ userId: user._id })).toBe(0);
    });

    test('keeps authorization local and refuses issuance when upstream Auth rejects the token', async () => {
        const upstream = jest.spyOn(global, 'fetch').mockResolvedValueOnce(Response.json({}, { status: 403 }));
        expect((await exchange()).status).toBe(401);
        expect(upstream.mock.calls).toHaveLength(1);
        upstream.mockRestore();
        mockCloud();
        await User.updateOne({ _id: user._id }, { $set: { isBanned: true } });
        expect((await exchange()).status).toBe(403);
    });

    test('separates disabled or forwarded requests from exchange admission and rejects body credentials', async () => {
        const upstream = mockCloud();
        delete process.env.CV_AUTH_EXCHANGE_ENABLED;
        expect((await exchange()).status).toBe(404);
        process.env.CV_AUTH_EXCHANGE_ENABLED = 'true';
        expect((await exchange().set('X-Forwarded-Proto', 'https')).status).toBe(404);
        expect((await exchange().send({ accessToken: 'fixture' })).status).toBe(400);
        expect((await exchange(cloudToken({ aud: 'unrelated' }))).status).toBe(401);
        expect((await exchange(cloudToken({ exp: Math.floor(Date.now() / 1000) - 1 }))).status).toBe(401);
        expect(upstream).not.toHaveBeenCalled();
    });

    test('bounds a long upstream lifetime and gives successive exchanges distinct revocable sessions', async () => {
        mockCloud();
        const cloud = cloudToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
        const first = await exchange(cloud);
        const second = await exchange(cloud);
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.body.token).not.toBe(second.body.token);
        const claims = jwt.decode(first.body.token);
        expect(claims.exp - claims.iat).toBe(300);
        expect(await Session.countDocuments({ userId: user._id })).toBe(2);
    });

    test('keeps legacy password and admin actions outside the cloud pilot', async () => {
        mockCloud();
        await User.updateOne({ _id: user._id }, { $set: { isAdmin: true } });
        const response = await exchange();
        expect(response.status).toBe(200);
        const local = response.body.token;
        const password = await request(app).put('/api/v1/users/me/profile').set('Host', 'localhost')
            .set('x-auth-token', local).send({ password: 'fixture-new-password' });
        expect(password.status).toBe(403);
        expect((await User.findById(user._id)).password).toBe('fixture-password');
        const admin = await request(app).get('/api/v1/admin/sessions').set('Host', 'localhost')
            .set('x-auth-token', local);
        expect(admin.status).toBe(403);
    });

    test('caps a stream ticket by its parent and rejects it after session revocation', async () => {
        mockCloud();
        const cloud = cloudToken({ exp: Math.floor(Date.now() / 1000) + 90 });
        const response = await exchange(cloud);
        expect(response.status).toBe(200);
        const vaultPath = randomUUID() + '.mp4';
        const movie = await Movie.create({ title: 'Exchange fixture movie', year: 2026, vaultPath });
        try {
            const ticket = await request(app).post('/api/v1/stream/ticket').set('Host', 'localhost')
                .set('x-auth-token', response.body.token).send({ path: vaultPath });
            expect(ticket.status).toBe(200);
            expect(jwt.decode(ticket.body.ticket).exp).toBe(response.body.expiresAt);
            await Session.deleteOne({ tokenDigest: hashSessionToken(response.body.token) });
            const stream = await request(app).get('/api/v1/stream').set('Host', 'localhost')
                .query({ path: vaultPath, token: ticket.body.ticket });
            expect(stream.status).toBe(401);
        } finally {
            await Movie.deleteOne({ _id: movie._id });
        }
    });

    test('administrator sign-out rejects stale Supabase sessions and tickets while permitting a fresh exchange', async () => {
        mockCloud();
        owner = await User.create({ email: `admin-${randomUUID()}@test.invalid`, name: 'Local administrator',
            password: 'fixture-password', isApproved: true, isAdmin: true });
        const adminToken = owner.generateAuthToken();
        await Session.create({ userId: owner._id, token: adminToken });
        const first = await exchange();
        expect(first.status).toBe(200);
        const path = randomUUID() + '.mp4';
        const movie = await Movie.create({ title: 'Revocation fixture', year: 2026, vaultPath: path });
        try {
            const issued = await request(app).post('/api/v1/stream/ticket').set('Host', 'localhost')
                .set('x-auth-token', first.body.token).send({ path });
            expect(issued.status).toBe(200);
            const revoke = await request(app).post(`/api/v1/users/${user._id}/revoke-sessions`).set('Host', 'localhost')
                .set('x-auth-token', adminToken);
            expect(revoke.status).toBe(204);
            await Session.create({ userId: user._id, token: first.body.token });
            const profile = token => request(app).get('/api/v1/users/me').set('Host', 'localhost').set('x-auth-token', token);
            expect((await profile(first.body.token)).status).toBe(401);
            const stream = await request(app).get('/api/v1/stream').set('Host', 'localhost')
                .query({ path, token: issued.body.ticket });
            expect(stream.status).toBe(401);
            const fresh = await exchange();
            expect(fresh.status).toBe(200);
            expect((await profile(fresh.body.token)).status).toBe(200);
        } finally {
            await Movie.deleteOne({ _id: movie._id });
        }
    });

    test('unlinking revokes only sessions and tickets tied to that cloud link generation and preserves local sessions', async () => {
        mockCloud();
        owner = await User.create({
            email: `admin-unlink-${randomUUID()}@test.invalid`, name: 'Local administrator',
            password: 'fixture-password', isApproved: true, isAdmin: true
        });
        const adminToken = owner.generateAuthToken();
        await Session.create({ userId: owner._id, token: adminToken });

        // Create a local password session and stream ticket for the same user
        const localToken = user.generateAuthToken();
        await Session.create({ userId: user._id, token: localToken });

        // Exchange a Supabase token to create a cloud-linked session
        const cloudRes = await exchange();
        expect(cloudRes.status).toBe(200);
        const cloudAccessToken = cloudRes.body.token;

        const path = randomUUID() + '.mp4';
        const movie = await Movie.create({ title: 'Unlink scope fixture', year: 2026, vaultPath: path });
        try {
            const cloudTicketRes = await request(app).post('/api/v1/stream/ticket').set('Host', 'localhost')
                .set('x-auth-token', cloudAccessToken).send({ path });
            expect(cloudTicketRes.status).toBe(200);

            const localTicketRes = await request(app).post('/api/v1/stream/ticket').set('Host', 'localhost')
                .set('x-auth-token', localToken).send({ path });
            expect(localTicketRes.status).toBe(200);

            expect(await Session.countDocuments({ userId: user._id, cloudLinkGeneration: linkGeneration })).toBe(1);
            expect(await Session.countDocuments({ userId: user._id, cloudLinkGeneration: null })).toBe(1);

            const unlink = await request(app).delete(`/api/v1/users/${user._id}/cloud-link/${linkGeneration}`)
                .set('Host', 'localhost').set('x-auth-token', adminToken);
            expect(unlink.status).toBe(204);

            // Cloud-link session row is deleted; local password session row is preserved
            expect(await Session.countDocuments({ userId: user._id, cloudLinkGeneration: linkGeneration })).toBe(0);
            expect(await Session.countDocuments({ userId: user._id, cloudLinkGeneration: null })).toBe(1);

            const profile = t => request(app).get('/api/v1/users/me').set('Host', 'localhost').set('x-auth-token', t);
            expect((await profile(cloudAccessToken)).status).toBe(401);
            expect((await profile(localToken)).status).toBe(200);

            const cloudStream = await request(app).get('/api/v1/stream').set('Host', 'localhost')
                .query({ path, token: cloudTicketRes.body.ticket });
            expect(cloudStream.status).toBe(401);

            // Local stream ticket remains accepted by auth middleware (reaches stream route and returns 503 'Vault not configured.')
            const localStream = await request(app).get('/api/v1/stream').set('Host', 'localhost')
                .query({ path, token: localTicketRes.body.ticket });
            expect(localStream.status).toBe(503);
            expect(localStream.text).toBe('Vault not configured.');
        } finally {
            await Movie.deleteOne({ _id: movie._id });
        }
    });

    test('removes a cloud session saved after unlink cleanup while preserving the local session', async () => {
        mockCloud();
        owner = await User.create({
            email: `admin-unlink-race-${randomUUID()}@test.invalid`, name: 'Local administrator',
            password: 'fixture-password', isApproved: true, isAdmin: true
        });
        const adminToken = owner.generateAuthToken();
        await Session.create({ userId: owner._id, token: adminToken });
        const localToken = user.generateAuthToken();
        await Session.create({ userId: user._id, token: localToken });

        const save = Session.prototype.save;
        let exchangeReachedSave;
        let resumeSave;
        const beforeSave = new Promise(resolve => { exchangeReachedSave = resolve; });
        const saveAllowed = new Promise(resolve => { resumeSave = resolve; });
        jest.spyOn(Session.prototype, 'save').mockImplementation(async function (...args) {
            if (this.cloudLinkGeneration === linkGeneration) {
                exchangeReachedSave();
                await saveAllowed;
            }
            return save.apply(this, args);
        });

        const inflight = exchange().then(response => response);
        try {
            await Promise.race([beforeSave, inflight.then(() => { throw Error('Exchange finished before saving'); })]);
            const unlink = await request(app).delete(`/api/v1/users/${user._id}/cloud-link/${linkGeneration}`)
                .set('Host', 'localhost').set('x-auth-token', adminToken);
            expect(unlink.status).toBe(204);
            expect(await Session.countDocuments({ userId: user._id, cloudLinkGeneration: linkGeneration })).toBe(0);
        } finally {
            resumeSave();
            await inflight;
        }

        const denied = await inflight;
        expect(denied.status).toBe(401);
        expect(denied.body.token).toBeUndefined();
        expect(await Session.countDocuments({ userId: user._id, cloudLinkGeneration: linkGeneration })).toBe(0);
        const profile = await request(app).get('/api/v1/users/me').set('Host', 'localhost').set('x-auth-token', localToken);
        expect(profile.status).toBe(200);
    });

    test('T5: disabling membership blocks new exchange immediately while active CineVault session and stream ticket remain valid until expiry or explicit local revocation', async () => {
        let membershipRows = [currentMember()];
        jest.spyOn(global, 'fetch').mockImplementation(async url => Response.json(
            url === base + '/auth/v1/user' ? { id: subject, is_anonymous: false } : membershipRows
        ));

        owner = await User.create({
            email: `admin-t5-${randomUUID()}@test.invalid`, name: 'Local administrator',
            password: 'fixture-password', isApproved: true, isAdmin: true
        });
        const adminToken = owner.generateAuthToken();
        await Session.create({ userId: owner._id, token: adminToken });

        // Also create a local password session for the same user to verify revoke-sessions scope
        const localToken = user.generateAuthToken();
        await Session.create({ userId: user._id, token: localToken });

        const activeExchange = await exchange();
        expect(activeExchange.status).toBe(200);
        const activeCloudSessionToken = activeExchange.body.token;

        const path = randomUUID() + '.mp4';
        const movie = await Movie.create({ title: 'T5 membership disable fixture', year: 2026, vaultPath: path });
        try {
            const ticketRes = await request(app).post('/api/v1/stream/ticket').set('Host', 'localhost')
                .set('x-auth-token', activeCloudSessionToken).send({ path });
            expect(ticketRes.status).toBe(200);
            const streamTicket = ticketRes.body.ticket;

            // Installation owner disables membership in Supabase (PostgREST enabled=is.true returns [])
            membershipRows = [];

            // 1. Fresh exchange is blocked immediately with 403 Forbidden
            expect((await exchange()).status).toBe(403);

            // 2. Existing CineVault session and stream ticket remain valid until their 300s TTL if not locally revoked
            const profile = t => request(app).get('/api/v1/users/me').set('Host', 'localhost').set('x-auth-token', t);
            expect((await profile(activeCloudSessionToken)).status).toBe(200);
            const streamBeforeRevoke = await request(app).get('/api/v1/stream').set('Host', 'localhost')
                .query({ path, token: streamTicket });
            expect(streamBeforeRevoke.status).toBe(503);
            expect(streamBeforeRevoke.text).toBe('Vault not configured.');

            // 3. Explicit local revoke-sessions immediately terminates the cloud-backed session, stream ticket, and local password session
            const revoke = await request(app).post(`/api/v1/users/${user._id}/revoke-sessions`).set('Host', 'localhost')
                .set('x-auth-token', adminToken);
            expect(revoke.status).toBe(204);

            expect((await profile(activeCloudSessionToken)).status).toBe(401);
            expect((await profile(localToken)).status).toBe(401);
            const streamAfterRevoke = await request(app).get('/api/v1/stream').set('Host', 'localhost')
                .query({ path, token: streamTicket });
            expect(streamAfterRevoke.status).toBe(401);
        } finally {
            await Movie.deleteOne({ _id: movie._id });
        }
    });

    test('T6: pre-reset and temporary-password tokens cannot obtain a CineVault session during reset or after must_change_password clears', async () => {
        const preResetSessionId = randomUUID();
        const tempSessionId = randomUUID();
        const postChangeSessionId = randomUUID();

        const preResetToken = cloudToken({ session_id: preResetSessionId });
        const tempToken = cloudToken({ session_id: tempSessionId });
        const postChangeToken = cloudToken({ session_id: postChangeSessionId });

        const activeAuthSessions = new Set([preResetSessionId]);
        let mustChangePassword = false;

        jest.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
            if (url === base + '/auth/v1/user') {
                const bearer = (options.headers?.Authorization || '').replace(/^Bearer /, '');
                const decoded = jwt.decode(bearer);
                if (!decoded || !activeAuthSessions.has(decoded.session_id)) {
                    return new Response(JSON.stringify({ error: 'session_not_found' }), {
                        status: 403,
                        headers: { 'content-type': 'application/json' }
                    });
                }
                return Response.json({ id: subject, is_anonymous: false });
            }
            return Response.json([{
                user_id: subject,
                enabled: true,
                download_allowed: false,
                server: { server_instance_id: serverId },
                profile: { id: subject, blocked: false, must_change_password: mustChangePassword }
            }]);
        });

        // 1. Pre-reset token succeeds before password reset begins
        expect((await exchange(preResetToken)).status).toBe(200);

        // 2. Admin begins password reset: sets must_change_password=true and deletes preResetSessionId from auth.sessions.
        // User signs in with temporary password (tempSessionId is live in auth.sessions, but must_change_password=true).
        mustChangePassword = true;
        activeAuthSessions.delete(preResetSessionId);
        activeAuthSessions.add(tempSessionId);

        expect((await exchange(preResetToken)).status).toBe(401);
        const tempExchangeDuringReset = await exchange(tempToken);
        expect(tempExchangeDuringReset.status).toBe(403);
        expect(tempExchangeDuringReset.body).toEqual({ error: 'password_change_required' });

        // Unlinked account with must_change_password=true still receives a bare 403 without disclosing password_change_required
        const unlinkedTempToken = cloudToken({ sub: randomUUID(), session_id: tempSessionId });
        jest.spyOn(global, 'fetch').mockImplementationOnce(async () =>
            Response.json({ id: jwt.decode(unlinkedTempToken).sub, is_anonymous: false })
        ).mockImplementationOnce(async () =>
            Response.json([{
                user_id: jwt.decode(unlinkedTempToken).sub,
                enabled: true,
                download_allowed: false,
                server: { server_instance_id: serverId },
                profile: { id: jwt.decode(unlinkedTempToken).sub, blocked: false, must_change_password: true }
            }])
        );
        const unlinkedRes = await exchange(unlinkedTempToken);
        expect(unlinkedRes.status).toBe(403);
        expect(unlinkedRes.body).toEqual({});

        // 3. User completes required password change via cinevault-account-admin:
        // must_change_password clears to false, tempSessionId is deleted from auth.sessions,
        // and user signs in with the new password (postChangeSessionId).
        mustChangePassword = false;
        activeAuthSessions.delete(tempSessionId);
        activeAuthSessions.add(postChangeSessionId);

        // Neither the pre-reset token nor the temporary-password token can obtain a CineVault session after the flag clears
        expect((await exchange(preResetToken)).status).toBe(401);
        expect((await exchange(tempToken)).status).toBe(401);

        // Fresh post-change session token succeeds
        const postChangeRes = await exchange(postChangeToken);
        expect(postChangeRes.status).toBe(200);
    });
});
