const request = require('supertest');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const config = require('config');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
const { Library } = require('../../models/library');
const { Movie } = require('../../models/movie');
const { Genre } = require('../../models/genre');
const { hashVaultPath } = require('../../services/contentPolicyService');
let app;
let token;
let user;

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
        app = require('../../app').createApp();
        await User.deleteMany({});
        await Session.deleteMany({});
        await Library.deleteMany({});
        await Genre.deleteMany({});

        user = new User({ isAdmin: true, isApproved: true, name: 'Admin', email: 'admin@test.com', password: 'password123' });
        await user.save();
        token = user.generateAuthToken();
        await new Session({ userId: user._id, token, ip: '127.0.0.1' }).save();

        await new Library({
            vaultRootPath: testVaultDir,
            inboxPath: path.join(testVaultDir, 'Inbox')
        }).save();
        await new Movie({
            title: 'Test Movie',
            year: 2026,
            vaultPath: 'test_movie.mp4'
        }).save();
    });

    afterEach(async () => {
        await User.deleteMany({});
        await Session.deleteMany({});
        await Library.deleteMany({});
        await Movie.deleteMany({});
        await Genre.deleteMany({});
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

    it('should reject account JWT authentication in a media URL', async () => {
        const res = await request(app)
            .get(`/api/v1/stream?path=test_movie.mp4&token=${token}`);

        expect(res.status).toBe(401);
    });

    it('should issue a stream ticket via POST /api/v1/stream/ticket', async () => {
        const res = await request(app)
            .post('/api/v1/stream/ticket')
            .set('x-auth-token', token)
            .send({ path: 'test_movie.mp4' });

        expect(res.status).toBe(200);
        expect(res.body.ticket).toBeDefined();
        expect(typeof res.body.ticket).toBe('string');
        const decodedTicket = jwt.verify(res.body.ticket, config.get('jwtPrivateKey'));
        expect(decodedTicket.path).toBeUndefined();
        expect(decodedTicket.pathDigest).toBe(hashVaultPath('test_movie.mp4'));
        expect(decodedTicket.operations).toEqual(['stream', 'subtitle']);
        expect(decodedTicket.resourceType).toBe('movie');

        // Test that the generated ticket authenticates media streaming
        const streamRes = await request(app)
            .get(`/api/v1/stream?path=test_movie.mp4&token=${res.body.ticket}`);

        expect(streamRes.status).toBe(200);
        expect(streamRes.body.toString()).toContain('fake-mp4-data');
    });

    it('should reject a stream ticket for a different media path', async () => {
        const ticketRes = await request(app)
            .post('/api/v1/stream/ticket')
            .set('x-auth-token', token)
            .send({ path: 'test_movie.mp4' });

        const res = await request(app)
            .get(`/api/v1/stream?path=other_movie.mp4&token=${ticketRes.body.ticket}`);

        expect(res.status).toBe(403);
    });

    it('should reject stream tickets outside playback routes', async () => {
        const streamTicket = jwt.sign({
            _id: 'stream-user',
            isStreamTicket: true,
            tokenType: 'stream',
            path: 'test_movie.mp4'
        }, config.get('jwtPrivateKey'), {
            expiresIn: '2m',
            issuer: 'cinevault',
            audience: 'cinevault-stream'
        });

        const res = await request(app)
            .get('/api/v1/movies')
            .set('x-auth-token', streamTicket);

        expect(res.status).toBe(403);
    });

    it('should require a concrete path before issuing a stream ticket', async () => {
        const res = await request(app)
            .post('/api/v1/stream/ticket')
            .set('x-auth-token', token)
            .send({});

        expect(res.status).toBe(400);
    });

    it('should bind download tickets to the download operation', async () => {
        const ticketRes = await request(app)
            .post('/api/v1/stream/ticket')
            .set('x-auth-token', token)
            .send({ path: 'test_movie.mp4', operation: 'download' });

        expect(ticketRes.status).toBe(200);

        const playbackRes = await request(app)
            .get(`/api/v1/stream?path=test_movie.mp4&token=${ticketRes.body.ticket}`);
        expect(playbackRes.status).toBe(403);

        const downloadRes = await request(app)
            .get(`/api/v1/stream?path=test_movie.mp4&download=true&token=${ticketRes.body.ticket}`);
        expect(downloadRes.status).toBe(200);
        expect(downloadRes.body.toString()).toContain('fake-mp4-data');
    });

    it('should deny ticket issuance and direct playback when current genre policy blocks the media', async () => {
        const allowedGenre = await new Genre({ name: 'Family' }).save();
        const blockedGenre = await new Genre({ name: 'Horror' }).save();
        user.allowedGenres = [allowedGenre._id];
        await user.save();
        await Movie.updateOne({ vaultPath: 'test_movie.mp4' }, { $set: { genres: [blockedGenre._id] } });

        const ticketRes = await request(app)
            .post('/api/v1/stream/ticket')
            .set('x-auth-token', token)
            .send({ path: 'test_movie.mp4' });
        expect(ticketRes.status).toBe(403);

        const directRes = await request(app)
            .get('/api/v1/stream?path=test_movie.mp4')
            .set('x-auth-token', token);
        expect(directRes.status).toBe(403);
    });
});
