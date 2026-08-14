const request = require('supertest');
const { parseFilename } = require('../../services/scannerService');
const { ensureGenres } = require('../../services/genreService');
const { Genre } = require('../../models/genre');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
let app;
let adminToken;
let userToken;
let adminUser;

describe('Phase 4: Scanner, Genres & Admin Sessions', () => {
    beforeEach(async () => {
        app = require('../../index');
        await Genre.deleteMany({});
        await User.deleteMany({});
        await Session.deleteMany({});

        adminUser = new User({
            name: 'Admin Boss',
            email: 'admin_boss@test.com',
            password: 'password123',
            isAdmin: true
        });
        await adminUser.save();
        adminToken = adminUser.generateAuthToken();
        await new Session({ userId: adminUser._id, token: adminToken, ip: '127.0.0.1' }).save();

        const regularUser = new User({
            name: 'Regular Joe',
            email: 'joe@test.com',
            password: 'password123',
            isAdmin: false
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
            const sessionsBefore = await Session.find();
            expect(sessionsBefore.length).toBe(2);

            const sessionToDelete = sessionsBefore.find(s => s.token === userToken);

            const res = await request(app)
                .delete(`/api/v1/admin/sessions/${sessionToDelete._id}`)
                .set('x-auth-token', adminToken);

            expect(res.status).toBe(200);
            const sessionsAfter = await Session.find();
            expect(sessionsAfter.length).toBe(1);
            expect(sessionsAfter[0].token).toBe(adminToken);
        });

        it('should clear other sessions using POST /clear while preserving current admin session with Bearer header', async () => {
            const res = await request(app)
                .post('/api/v1/admin/sessions/clear')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.count).toBe(1); // Joe's session was deleted

            const remaining = await Session.find();
            expect(remaining.length).toBe(1);
            expect(remaining[0].token).toBe(adminToken);
        });
    });
});
