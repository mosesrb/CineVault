const request = require('supertest');
const { Library } = require('../../models/library');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
const { getTmdbKey, testTmdbApiKey } = require('../../services/metadataService');
const mongoose = require('mongoose');
let app;
let adminToken;
let adminUser;

jest.setTimeout(15000);

describe('Phase 5: Dynamic TMDB API Key & Settings', () => {
    beforeEach(async () => {
        app = require('../../index');
        if (mongoose.connection.readyState !== 1) {
            await new Promise(r => mongoose.connection.once('open', r));
        }
        await Library.deleteMany({});
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
    });

    afterEach(async () => {
        await Library.deleteMany({});
        await User.deleteMany({});
        await Session.deleteMany({});
    });

    it('should save tmdbApiKey in vault config via PUT /api/v1/library/config', async () => {
        const res = await request(app)
            .put('/api/v1/library/config')
            .set('x-auth-token', adminToken)
            .send({
                vaultRootPath: 'E:\\MockVault',
                inboxPath: 'E:\\MockVault\\Inbox',
                tmdbApiKey: 'mock_tmdb_key_12345'
            });

        expect(res.status).toBe(200);
        expect(res.body.tmdbApiKey).toBe('mock_tmdb_key_12345');

        const inDb = await Library.findOne();
        expect(inDb.tmdbApiKey).toBe('mock_tmdb_key_12345');
    });

    it('should dynamically prioritize database tmdbApiKey over config file', async () => {
        await new Library({
            vaultRootPath: 'E:\\MockVault',
            inboxPath: 'E:\\MockVault\\Inbox',
            tmdbApiKey: 'dynamic_db_key_abc'
        }).save();

        const resolvedKey = await getTmdbKey();
        expect(resolvedKey).toBe('dynamic_db_key_abc');
    });

    it('should handle test TMDB key endpoint gracefully with invalid key', async () => {
        const res = await request(app)
            .post('/api/v1/library/tmdb-key/test')
            .set('x-auth-token', adminToken)
            .send({
                tmdbApiKey: 'invalid_dummy_key'
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('should reject testing when no key is provided and none in DB', async () => {
        const res = await request(app)
            .post('/api/v1/library/tmdb-key/test')
            .set('x-auth-token', adminToken)
            .send({
                tmdbApiKey: ''
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});
