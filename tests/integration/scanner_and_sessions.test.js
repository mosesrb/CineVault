const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { ensureServerIdentity } = require('../../services/serverIdentityService');
const { MIGRATION_ID } = require('../../services/identityMigrationPlan');
const { parseFilename } = require('../../services/scannerService');
const { ensureGenres } = require('../../services/genreService');
const { Genre } = require('../../models/genre');
const { User } = require('../../models/user');
const { Session, hashSessionToken } = require('../../models/session');
let app;
let adminToken;
let userToken;
let adminUser;
let regularUser;

describe('Phase 4: Scanner, Genres & Admin Sessions', () => {
    beforeEach(async () => {
        app = require('../../app').createApp();
        await Genre.deleteMany({});
        await User.deleteMany({});
        await Session.deleteMany({});

        adminUser = new User({
            name: 'Admin Boss',
            email: 'admin_boss@test.com',
            password: 'password123',
            isAdmin: true,
            isApproved: true
        });
        await adminUser.save();
        adminToken = adminUser.generateAuthToken();
        await new Session({ userId: adminUser._id, token: adminToken, ip: '127.0.0.1' }).save();

        regularUser = new User({
            name: 'Regular Joe',
            email: 'joe@test.com',
            password: 'password123',
            isAdmin: false,
            isApproved: true
        });
        await regularUser.save();
        userToken = regularUser.generateAuthToken();
        await new Session({ userId: regularUser._id, token: userToken, ip: '192.168.1.50' }).save();
    });

    afterEach(async () => {
        await Genre.deleteMany({});
        await User.deleteMany({});
        await Session.deleteMany({});
    });

    describe('Administrator account access', () => {
        const profile = '/api/v1/users/me';
        const users = '/api/v1/users';
        const auth = '/api/v1/auth';

        it('creates a local account, resets its password and signs out existing sessions', async () => {
            const account = { name: 'New Viewer', email: 'viewer@test.com', password: 'original-password' };
            expect((await request(app).post(users).set('x-auth-token', userToken).send(account)).status).toBe(403);
            const created = await request(app).post(users).set('x-auth-token', adminToken).send(account);
            expect(created.status).toBe(201);
            expect(created.body).not.toHaveProperty('password');
            const credentials = { email: account.email, password: account.password };
            const original = await request(app).post(auth).send(credentials);
            expect(original.status).toBe(200);
            const reset = `${users}/${created.body._id}/password`;
            expect((await request(app).put(reset).set('x-auth-token', adminToken).send({ password: 'é'.repeat(37) })).status).toBe(400);
            expect((await request(app).put(reset).set('x-auth-token', adminToken).send({ password: 'replacement-password' })).status).toBe(204);
            expect((await request(app).get(profile).set('x-auth-token', original.body.token)).status).toBe(401);
            expect((await request(app).post(auth).send(credentials)).status).toBe(401);
            const updated = await request(app).post(auth).send({ ...credentials, password: 'replacement-password' });
            expect(updated.status).toBe(200);
            expect((await request(app).get(profile).set('x-auth-token', updated.body.token)).status).toBe(200);
            expect((await request(app).get(profile).set('x-auth-token', userToken)).status).toBe(200);
        });

        it('keeps stale sessions invalid across a disable and re-enable, including a session saved after rotation', async () => {
            const access = `${users}/${regularUser._id}/approve`;
            const revoke = `${users}/${regularUser._id}/revoke-sessions`;
            expect((await request(app).post(revoke).set('x-auth-token', userToken)).status).toBe(403);
            expect((await request(app).post(`${users}/${adminUser._id}/revoke-sessions`).set('x-auth-token', adminToken)).status).toBe(403);
            expect((await request(app).put(access).set('x-auth-token', adminToken).send({ approve: false })).status).toBe(200);
            expect((await request(app).put(access).set('x-auth-token', adminToken).send({ approve: true })).status).toBe(200);
            await new Session({ userId: regularUser._id, token: userToken }).save();
            expect((await request(app).get(profile).set('x-auth-token', userToken)).status).toBe(401);
            expect((await request(app).post(revoke).set('x-auth-token', adminToken)).status).toBe(204);
            expect((await request(app).get(profile).set('x-auth-token', adminToken)).status).toBe(200);
        });

        it('shows a linked account without exposing cloud identity data and only removes the requested generation', async () => {
            const { serverId } = await ensureServerIdentity();
            const generation = randomUUID();
            const supabaseUserId = randomUUID();
            await User.collection.updateOne({ _id: regularUser._id }, { $set: {
                supabaseUserId, authSchemaVersion: 2,
                identityMigration: { id: MIGRATION_ID, version: 1, serverInstanceId: serverId },
                identityLinkBackup: { operationId: randomUUID(), generation, appliedSubject: supabaseUserId,
                    versionWasMissing: true, subjectWasMissing: true }
            } });
            const list = await request(app).get(users).set('x-auth-token', adminToken);
            expect(list.status).toBe(200);
            const target = list.body.find(user => user._id === String(regularUser._id));
            expect(target).toMatchObject({ cloudLinked: true, cloudLinkGeneration: generation });
            expect(target).not.toHaveProperty('supabaseUserId');
            expect(target).not.toHaveProperty('identityLinkBackup');
            const unlink = `${users}/${regularUser._id}/cloud-link`;
            expect((await request(app).delete(`${unlink}/${randomUUID()}`).set('x-auth-token', adminToken)).status).toBe(409);
            expect((await request(app).delete(`${unlink}/${generation}`).set('x-auth-token', adminToken)).status).toBe(204);
            const unlinked = await User.collection.findOne({ _id: regularUser._id });
            expect(unlinked).not.toHaveProperty('supabaseUserId');
            expect((await request(app).get(profile).set('x-auth-token', userToken)).status).toBe(200);
        });
    });

    describe('Scanner Service Title Normalization', () => {
        it('should correctly parse movies with "Two" and "Too" in their titles without corruption', () => {
            const parsed1 = parseFilename('/media/Two.Lovers.2008.1080p.BluRay.mkv');
            expect(parsed1).not.toBeNull();
            expect(parsed1.title).toBe('Two Lovers');
            expect(parsed1.year).toBe(2008);

            const parsed2 = parseFilename('/media/The.Two.Towers.2002.720p.mkv');
            expect(parsed2).not.toBeNull();
            expect(parsed2.title).toBe('The Two Towers');
            expect(parsed2.year).toBe(2002);

            const parsed3 = parseFilename('/media/Too.Fast.Too.Furious.2003.mkv');
            expect(parsed3).not.toBeNull();
            expect(parsed3.title).toBe('Too Fast Too Furious');
        });

        it('should keep Roman numerals uppercase', () => {
            const parsed = parseFilename('/media/Rocky.IV.1985.1080p.mkv');
            expect(parsed).not.toBeNull();
            expect(parsed.title).toBe('Rocky IV');
        });
    });

    describe('Genre Service deduplication', () => {
        it('should create new genres and reuse existing ones case-insensitively', async () => {
            const ids1 = await ensureGenres(['Action', 'Sci-Fi']);
            expect(ids1.length).toBe(2);

            const ids2 = await ensureGenres(['action', 'DRAMA', 'sci-fi']);
            expect(ids2.length).toBe(3);
            expect(ids2[0].toString()).toBe(ids1[0].toString());
            expect(ids2[2].toString()).toBe(ids1[1].toString());

            const totalGenres = await Genre.countDocuments();
            expect(totalGenres).toBe(3); // Action, Sci-Fi, DRAMA
        });
    });

    describe('Admin Sessions REST API', () => {
        it('should revoke a single session using DELETE /:id', async () => {
            const sessionsBefore = await Session.find().select('+tokenDigest');
            expect(sessionsBefore.length).toBe(2);

            const sessionToDelete = sessionsBefore.find(
                s => s.tokenDigest === hashSessionToken(userToken)
            );

            const res = await request(app)
                .delete(`/api/v1/admin/sessions/${sessionToDelete._id}`)
                .set('x-auth-token', adminToken);

            expect(res.status).toBe(200);
            expect(res.body.token).toBeUndefined();
            expect(res.body.tokenDigest).toBeUndefined();
            const sessionsAfter = await Session.find();
            expect(sessionsAfter.length).toBe(1);
            const remainingAdmin = await Session.findOne({
                tokenDigest: hashSessionToken(adminToken)
            });
            expect(remainingAdmin).not.toBeNull();
        });

        it('should clear other sessions using POST /clear while preserving current admin session with Bearer header', async () => {
            const res = await request(app)
                .post('/api/v1/admin/sessions/clear')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.count).toBe(1); // Joe's session was deleted

            const remaining = await Session.find().select('+tokenDigest');
            expect(remaining.length).toBe(1);
            expect(remaining[0].tokenDigest).toBe(hashSessionToken(adminToken));
        });

        it('should list session metadata without bearer tokens or token digests', async () => {
            const res = await request(app)
                .get('/api/v1/admin/sessions')
                .set('x-auth-token', adminToken);

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
            for (const session of res.body) {
                expect(session.token).toBeUndefined();
                expect(session.tokenDigest).toBeUndefined();
            }
        });
    });
});
