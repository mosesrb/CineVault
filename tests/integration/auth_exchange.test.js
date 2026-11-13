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
        token = cloudToken();
        user = await User.create({
            email: `exchange-${randomUUID()}@test.invalid`, name: 'Exchange fixture', password: 'fixture-password',
            isApproved: true
        });
        await User.collection.updateOne({ _id: user._id }, {
            $set: {
                supabaseUserId: subject, authSchemaVersion: 2,
                identityMigration: { id: MIGRATION_ID, version: 1, serverInstanceId: serverId }
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
});
