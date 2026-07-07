const request = require('supertest');
const { Movie } = require('../../models/movie');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
let app;
let token;

describe('/api/v1/movies', () => {
    beforeEach(async () => { 
        app = require('../../index'); 
        const user = new User({ isAdmin: true, name: 'Admin', email: 'admin@test.com', password: 'password123' });
        await user.save();
        token = user.generateAuthToken();
        await new Session({ userId: user._id, token, ip: '127.0.0.1' }).save();
    });
    
    afterEach(async () => {
        await Movie.deleteMany({});
        await User.deleteMany({});
        await Session.deleteMany({});
    });
    
    afterAll(async () => {
        const mongoose = require('mongoose');
        await mongoose.connection.close();
    });

    describe('GET /', () => {
        it('should return all movies', async () => {
            await Movie.collection.insertMany([
                { title: 'Movie 1', vaultPath: '/m1.mkv', addedAt: new Date() },
                { title: 'Movie 2', vaultPath: '/m2.mkv', addedAt: new Date() }
            ]);

            const res = await request(app)
                .get('/api/v1/movies')
                .set('x-auth-token', token);

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(2);
        });
    });
});
