const request = require('supertest');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
let app;
let token;

describe('/api/v1/library', () => {
    beforeEach(async () => { 
        app = require('../../index'); 
        const user = new User({ isAdmin: true, name: 'Admin', email: 'admin@test.com', password: 'password123' });
        await user.save();
        token = user.generateAuthToken();
        await new Session({ userId: user._id, token, ip: '127.0.0.1' }).save();
    });
    
    afterEach(async () => {
        await User.deleteMany({});
        await Session.deleteMany({});
    });
    
    afterAll(async () => {
        const mongoose = require('mongoose');
        await mongoose.connection.close();
    });

    describe('GET /stats', () => {
        it('should return library stats', async () => {
            const res = await request(app)
                .get('/api/v1/library/stats')
                .set('x-auth-token', token);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('totalMovies');
            expect(res.body).toHaveProperty('totalShows');
        });
    });
});
