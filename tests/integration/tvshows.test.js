const request = require('supertest');
const { TVShow } = require('../../models/tvShow');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
let app;
let token;

describe('/api/v1/tvshows', () => {
    beforeEach(async () => { 
        app = require('../../index'); 
        await TVShow.deleteMany({});
        await User.deleteMany({});
        await Session.deleteMany({});

        const user = new User({ isAdmin: true, name: 'Admin', email: 'admin@test.com', password: 'password123' });
        await user.save();
        token = user.generateAuthToken();
        await new Session({ userId: user._id, token, ip: '127.0.0.1' }).save();
    });
    
    afterEach(async () => {
        await TVShow.deleteMany({});
        await User.deleteMany({});
        await Session.deleteMany({});
    });

    describe('GET /', () => {
        it('should return all tvshows', async () => {
            await TVShow.collection.insertMany([
                { title: 'Show 1', folderPath: '/s1', addedAt: new Date() },
                { title: 'Show 2', folderPath: '/s2', addedAt: new Date() }
            ]);

            const res = await request(app)
                .get('/api/v1/tvshows')
                .set('x-auth-token', token);

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(2);
        });
    });
});
