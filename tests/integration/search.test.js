const request = require('supertest');
const { Movie } = require('../../models/movie');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
let app;
let token;

describe('/api/v1/search', () => {
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
        it('should return search results', async () => {
            await Movie.collection.insertMany([
                { title: 'Inception', vaultPath: '/m1.mkv', addedAt: new Date() },
                { title: 'Interstellar', vaultPath: '/m2.mkv', addedAt: new Date() }
            ]);

            const res = await request(app)
                .get('/api/v1/search?q=Inception')
                .set('x-auth-token', token);

            expect(res.status).toBe(200);
            expect(res.body.movies.length).toBe(1);
            expect(res.body.movies[0].title).toBe('Inception');
        });
    });
});
