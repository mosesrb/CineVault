const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const error = require('../middleware/error');

// Routes
const auth = require('../routes/auth');
const users = require('../routes/users');
const genres = require('../routes/genres');
const movies = require('../routes/movies');
const tvshows = require('../routes/tvshows');
const library = require('../routes/library');
const search = require('../routes/search');
const stream = require('../routes/stream');
const discover = require('../routes/discover');
const adminSessions = require('../routes/admin_sessions');

module.exports = function (app) {
    app.use(express.json());
    app.use(cors({
        origin: '*',
        exposedHeaders: ['x-auth-token']
    }));
    // Serve static files from frontend build in production
    app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));
    app.use(helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        crossOriginEmbedderPolicy: false, // allow loading external images like TMDB
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                "img-src": ["'self'", "data:", "https://image.tmdb.org", "https://*.tmdb.org"],
                "media-src": ["'self'", "blob:", "*"],
                "connect-src": ["'self'", "https://api.themoviedb.org", "https://*.tmdb.org"]
            }
        }
    }));

    // API routes
    app.use('/api/auth', auth);
    app.use('/api/users', users);
    app.use('/api/genres', genres);
    app.use('/api/movies', movies);
    app.use('/api/tvshows', tvshows);
    app.use('/api/library', library);
    app.use('/api/search', search);
    app.use('/api/discover', discover);
    app.use('/api/stream', stream);
    app.use('/api/admin/sessions', adminSessions);

    // SPA fallback — send index.html for all non-API and non-file routes
    app.get(/^(?!\/api|\/assets|.*\..*).*/, (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
    });

    app.use(error);
};
