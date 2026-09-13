const request = require('supertest');
const jwt = require('jsonwebtoken');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');

let app;
let user;
let token;

describe('authoritative identity and bounded access tokens', () => {
    beforeEach(async () => {
        app = require('../../app').createApp();
        await Session.deleteMany({});
        await User.deleteMany({});

        user = await new User({
            name: 'Current Admin',
            email: 'current-admin@test.com',
            password: 'password123',
            isAdmin: true,
            isApproved: true
        }).save();
        token = user.generateAuthToken();
        await new Session({ userId: user._id, token }).save();
    });

    afterEach(async () => {
        await Session.deleteMany({});
        await User.deleteMany({});
    });

    it('issues access tokens with explicit type, issuer, audience, and 72-hour bound', () => {
        const decoded = jwt.decode(token);
        expect(decoded.tokenType).toBe('access');
        expect(decoded.iss).toBe('cinevault');
        expect(decoded.aud).toBe('cinevault-api');
        expect(decoded.exp - decoded.iat).toBe(72 * 60 * 60);
        expect(decoded.isAdmin).toBeUndefined();
    });

    it('uses current database role instead of the role at token issuance', async () => {
        user.isAdmin = false;
        await user.save();

        const res = await request(app)
            .get('/api/v1/admin/sessions')
            .set('x-auth-token', token);

        expect(res.status).toBe(403);
    });

    it('rejects a currently banned user with an existing session', async () => {
        user.isBanned = true;
        user.banReason = 'test';
        await user.save();

        const res = await request(app)
            .get('/api/v1/movies')
            .set('x-auth-token', token);

        expect(res.status).toBe(403);
    });

    it('rejects an unapproved or deleted current user', async () => {
        user.isApproved = false;
        await user.save();
        const unapproved = await request(app)
            .get('/api/v1/movies')
            .set('x-auth-token', token);
        expect(unapproved.status).toBe(403);

        await User.findByIdAndDelete(user._id);
        const deleted = await request(app)
            .get('/api/v1/movies')
            .set('x-auth-token', token);
        expect(deleted.status).toBe(401);
    });
});
