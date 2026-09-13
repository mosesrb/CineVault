const request = require('supertest');
const { User } = require('../../models/user');
const { Session } = require('../../models/session');
const { Genre } = require('../../models/genre');
const { Movie } = require('../../models/movie');
const { TVShow } = require('../../models/tvShow');
const { Episode } = require('../../models/episode');

let app;
let user;
let token;
let allowedGenre;
let restrictedGenre;
let allowedMovie;
let restrictedMovie;
let restrictedShow;
let restrictedEpisode;

describe('content policy enforcement', () => {
    beforeEach(async () => {
        app = require('../../app').createApp();
        await Promise.all([
            Session.deleteMany({}),
            User.deleteMany({}),
            Episode.deleteMany({}),
            Movie.deleteMany({}),
            TVShow.deleteMany({}),
            Genre.deleteMany({})
        ]);

        [allowedGenre, restrictedGenre] = await Genre.create([
            { name: 'Family' },
            { name: 'Horror' }
        ]);
        [allowedMovie, restrictedMovie] = await Movie.create([
            { title: 'Allowed Movie', genres: [allowedGenre._id], vaultPath: 'movies/allowed.mp4' },
            { title: 'Restricted Movie', genres: [restrictedGenre._id], vaultPath: 'movies/restricted.mp4' }
        ]);
        restrictedShow = await TVShow.create({
            title: 'Restricted Show',
            genres: [restrictedGenre._id]
        });
        restrictedEpisode = await Episode.create({
            showId: restrictedShow._id,
            season: 1,
            episode: 1,
            vaultPath: 'shows/restricted/s01e01.mp4'
        });

        user = await User.create({
            name: 'Restricted User',
            email: 'restricted-user@test.com',
            password: 'password123',
            isApproved: true,
            allowedGenres: [allowedGenre._id]
        });
        token = user.generateAuthToken();
        await Session.create({ userId: user._id, token });
    });

    afterEach(async () => {
        await Promise.all([
            Session.deleteMany({}),
            User.deleteMany({}),
            Episode.deleteMany({}),
            Movie.deleteMany({}),
            TVShow.deleteMany({}),
            Genre.deleteMany({})
        ]);
    });

    it('allows watchlist and history writes for permitted media', async () => {
        const watchlist = await request(app)
            .post('/api/v1/users/me/watchlist')
            .set('x-auth-token', token)
            .send({ mediaId: allowedMovie._id, mediaType: 'movie' });
        expect(watchlist.status).toBe(200);

        const history = await request(app)
            .post('/api/v1/users/me/history')
            .set('x-auth-token', token)
            .send({ mediaId: allowedMovie._id, mediaType: 'movie', progressSeconds: 30 });
        expect(history.status).toBe(200);
    });

    it('denies restricted watchlist and history writes', async () => {
        const watchlist = await request(app)
            .post('/api/v1/users/me/watchlist')
            .set('x-auth-token', token)
            .send({ mediaId: restrictedMovie._id, mediaType: 'movie' });
        expect(watchlist.status).toBe(403);

        const history = await request(app)
            .post('/api/v1/users/me/history')
            .set('x-auth-token', token)
            .send({
                mediaId: restrictedShow._id,
                mediaType: 'tvshow',
                episodeId: restrictedEpisode._id,
                progressSeconds: 30
            });
        expect(history.status).toBe(403);
    });

    it('denies episode enumeration for a restricted parent show', async () => {
        const result = await request(app)
            .get(`/api/v1/tvshows/${restrictedShow._id}/seasons/1/episodes`)
            .set('x-auth-token', token);
        expect(result.status).toBe(403);
    });
});
