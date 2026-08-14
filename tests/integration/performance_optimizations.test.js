const request = require('supertest');
const { Movie } = require('../../models/movie');
const { TVShow } = require('../../models/tvShow');
const { Episode } = require('../../models/episode');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
let app;
let token;
let user;

describe('Phase 3: Database & Performance Optimizations', () => {
    beforeEach(async () => {
        app = require('../../index');
        await Movie.deleteMany({});
        await TVShow.deleteMany({});
        await Episode.deleteMany({});
        await User.deleteMany({});
        await Session.deleteMany({});

        user = new User({
            name: 'Batch User',
            email: 'batch@test.com',
            password: 'password123',
            isAdmin: true
        });
        await user.save();
        token = user.generateAuthToken();
        await new Session({ userId: user._id, token, ip: '127.0.0.1' }).save();
    });

    afterEach(async () => {
        await Movie.deleteMany({});
        await TVShow.deleteMany({});
        await Episode.deleteMany({});
        await User.deleteMany({});
        await Session.deleteMany({});
    });

    it('should efficiently populate user history and watchlist via batch queries', async () => {
        const movie = new Movie({ title: 'Test Movie', vaultPath: '/m.mkv' });
        await movie.save();

        const show = new TVShow({ title: 'Test Show' });
        await show.save();

        const ep = new Episode({ showId: show._id, season: 1, episode: 1, vaultPath: '/s1e1.mkv' });
        await ep.save();

        user.watchHistory = [
            { mediaId: movie._id, mediaType: 'movie', progressSeconds: 50, completed: false },
            { mediaId: show._id, mediaType: 'tvshow', episodeId: ep._id, progressSeconds: 120, completed: true }
        ];
        user.watchlist = [
            { mediaId: movie._id, mediaType: 'movie' },
            { mediaId: show._id, mediaType: 'tvshow' }
        ];
        await user.save();

        const meRes = await request(app)
            .get('/api/v1/users/me')
            .set('x-auth-token', token);

        expect(meRes.status).toBe(200);
        expect(meRes.body.watchHistory.length).toBe(2);
        expect(meRes.body.watchHistory[0].media.title).toBeDefined();

        const wlRes = await request(app)
            .get('/api/v1/users/me/watchlist')
            .set('x-auth-token', token);

        expect(wlRes.status).toBe(200);
        expect(wlRes.body.length).toBe(2);
        expect(wlRes.body[0].media.title).toBeDefined();
    });

    it('should support pagination on /api/v1/movies', async () => {
        await Movie.collection.insertMany([
            { title: 'Movie 1', vaultPath: '/m1.mkv', addedAt: new Date(Date.now() - 3000) },
            { title: 'Movie 2', vaultPath: '/m2.mkv', addedAt: new Date(Date.now() - 2000) },
            { title: 'Movie 3', vaultPath: '/m3.mkv', addedAt: new Date(Date.now() - 1000) }
        ]);

        const page1 = await request(app)
            .get('/api/v1/movies?limit=2&page=1')
            .set('x-auth-token', token);

        expect(page1.status).toBe(200);
        expect(page1.body.length).toBe(2);
        expect(page1.body[0].title).toBe('Movie 3');

        const page2 = await request(app)
            .get('/api/v1/movies?limit=2&page=2')
            .set('x-auth-token', token);

        expect(page2.status).toBe(200);
        expect(page2.body.length).toBe(1);
        expect(page2.body[0].title).toBe('Movie 1');
    });

    it('should support pagination on /api/v1/tvshows', async () => {
        await TVShow.collection.insertMany([
            { title: 'Show 1', folderPath: '/s1', addedAt: new Date(Date.now() - 2000) },
            { title: 'Show 2', folderPath: '/s2', addedAt: new Date(Date.now() - 1000) }
        ]);

        const page1 = await request(app)
            .get('/api/v1/tvshows?limit=1&page=1')
            .set('x-auth-token', token);

        expect(page1.status).toBe(200);
        expect(page1.body.length).toBe(1);
        expect(page1.body[0].title).toBe('Show 2');
    });

    it('should have a TTL index on sessionSchema', () => {
        const indexes = Session.schema.indexes();
        const ttlIndex = indexes.find(([fields, options]) => fields.lastActiveAt === 1 && options?.expireAfterSeconds);
        expect(ttlIndex).toBeDefined();
        expect(ttlIndex[1].expireAfterSeconds).toBe(30 * 24 * 60 * 60);
    });
});
