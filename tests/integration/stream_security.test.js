const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
const { Library } = require('../../models/library');
let app;
let token;

describe('Security & Path Traversal Guards (/api/v1/stream)', () => {
    const testVaultDir = path.resolve(__dirname, '../../test_vault');
    const dummyMedia = path.join(testVaultDir, 'test_movie.mp4');

    beforeAll(async () => {
        if (!fs.existsSync(testVaultDir)) {
            fs.mkdirSync(testVaultDir, { recursive: true });
        }
        if (!fs.existsSync(dummyMedia)) {
            fs.writeFileSync(dummyMedia, 'fake-mp4-data');
        }
    });

    afterAll(async () => {
        try {
            if (fs.existsSync(dummyMedia)) fs.unlinkSync(dummyMedia);
            if (fs.existsSync(testVaultDir)) fs.rmSync(testVaultDir, { recursive: true, force: true });
        } catch (_) {}
    });

    beforeEach(async () => {
        app = require('../../index');
        await User.deleteMany({});
        await Session.deleteMany({});
        await Library.deleteMany({});

        const user = new User({ isAdmin: true, name: 'Admin', email: 'admin@test.com', password: 'password123' });
        await user.save();
        token = user.generateAuthToken();
        await new Session({ userId: user._id, token, ip: '127.0.0.1' }).save();

        await new Library({
            vaultRootPath: testVaultDir,
            inboxPath: path.join(testVaultDir, 'Inbox')
        }).save();
    });

    afterEach(async () => {
        await User.deleteMany({});
        await Session.deleteMany({});
        await Library.deleteMany({});
    });

    it('should reject path traversal attempts on /info with 403', async () => {
        const res = await request(app)
            .get('/api/v1/stream/info?path=../../../../package.json')
            .set('x-auth-token', token);

        expect(res.status).toBe(403);
        expect(res.text).toBe('Access denied.');
    });

    it('should reject path traversal attempts on /subtitles/vtt with 403', async () => {
        const res = await request(app)
            .get('/api/v1/stream/subtitles/vtt?path=../../../../package.json&index=0')
            .set('x-auth-token', token);

        expect(res.status).toBe(403);
        expect(res.text).toBe('Access denied.');
    });

    it('should reject path traversal attempts on /subtitles with 403', async () => {
        const res = await request(app)
            .get('/api/v1/stream/subtitles?path=../../../../package.json')
            .set('x-auth-token', token);

        expect(res.status).toBe(403);
        expect(res.text).toBe('Access denied.');
    });

    it('should reject path traversal attempts on / (stream) with 403', async () => {
        const res = await request(app)
            .get('/api/v1/stream?path=../../../../package.json')
            .set('x-auth-token', token);

        expect(res.status).toBe(403);
        expect(res.text).toBe('Access denied.');
    });

    it('should allow valid files within the vault root', async () => {
        const res = await request(app)
            .get('/api/v1/stream?path=test_movie.mp4')
            .set('x-auth-token', token);

        expect(res.status).toBe(200);
        expect(res.body.toString()).toContain('fake-mp4-data');
    });

    it('should reject non-stream endpoints using query token authentication', async () => {
        const res = await request(app)
            .get(`/api/v1/movies?token=${token}`);

        expect(res.status).toBe(401);
    });

    it('should accept query token authentication on media stream endpoint', async () => {
        const res = await request(app)
            .get(`/api/v1/stream?path=test_movie.mp4&token=${token}`);

        expect(res.status).toBe(200);
    });
});
