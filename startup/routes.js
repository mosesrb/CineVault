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
    // 1. Simple Request Logger — MOVE TO TOP to see all preflight (OPTIONS) traffic
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/stream')) {
            console.log(`[STREAM_DEBUG] ${req.method} ${req.path} | Origin: ${req.headers.origin || 'none'} | IP: ${req.ip}`);
        }
        next();
    });

    app.use((req, res, next) => {
        const origin = req.headers.origin;
        // Chrome/Android strictness: PNA requests MUST have an explicit origin, not '*'
        res.setHeader('Access-Control-Allow-Origin', origin || 'http://localhost');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, Range, If-Range, Origin, X-Requested-With');
        res.setHeader('Access-Control-Expose-Headers', 'x-auth-token, Content-Range, Accept-Ranges, Content-Length, X-Content-Duration');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');

        // Robust PNA check (supports ::ffff: mapped IPs)
        const isPrivate = req.headers['access-control-request-private-network'] || 
                         req.ip?.includes('192.168.') || 
                         req.ip?.includes('10.') || 
                         req.ip === '::1' || 
                         req.ip === '127.0.0.1';

        if (isPrivate) {
            res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }

        // Handle preflight (OPTIONS)
        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        next();
    });

    // Serve static files from frontend build in production
    app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));
    app.use(helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        crossOriginEmbedderPolicy: false, // allow loading external images like TMDB
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                "img-src": ["'self'", "data:", "*", "https://image.tmdb.org", "https://*.tmdb.org"],
                "media-src": ["'self'", "blob:", "*", "http:", "https:"],
                "connect-src": ["'self'", "*", "http:", "https:", "https://api.themoviedb.org", "https://*.tmdb.org"]
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

    // Network info — returns local LAN IP so Android/TV clients can auto-configure
    app.get('/api/network-info', (req, res) => {
        const os = require('os');
        const nets = os.networkInterfaces();
        const localIps = [];
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                // IPv4, not internal (loopback), not virtual adapters
                if ((net.family === 'IPv4' || net.family === 4) && !net.internal && !name.toLowerCase().includes('warp')) {
                    localIps.push({ iface: name, ip: net.address });
                }
            }
        }
        const port = req.socket.localPort || 3000;
        res.json({ localIps, port });
    });

    // SPA fallback — send index.html for all non-API and non-file routes
    app.get(/^(?!\/api|\/assets|.*\..*).*/, (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
    });

    app.use(error);
};
