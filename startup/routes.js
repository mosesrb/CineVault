const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const error = require('../middleware/error');
const { authLimiter, apiLimiter } = require('../middleware/rateLimiter');
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
        if (req.path.startsWith('/api/v1/stream')) {
            console.log(`[STREAM_DEBUG] ${req.method} ${req.path} | Origin: ${req.headers.origin || 'none'} | IP: ${req.ip}`);
        }
        next();
    });

    app.use((req, res, next) => {
        const origin = req.headers.origin;
        
        // Define allowed origin patterns (localhost and local network IPs)
        const isAllowedOrigin = origin && (
            origin.startsWith('http://localhost') ||
            origin.startsWith('http://127.0.0.1') ||
            origin.startsWith('http://192.168.') ||
            origin.startsWith('http://10.') ||
            origin === 'capacitor://localhost'
        );

        if (isAllowedOrigin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
            res.setHeader('Access-Control-Allow-Origin', 'http://localhost');
        }

        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, Range, If-Range, Origin, X-Requested-With, Bypass-Tunnel-Reminder');
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

    // API routes (Supporting both /api/v1 and legacy /api for older Android APKs)
    app.use(['/api/v1/auth', '/api/auth'], authLimiter, auth);
    app.use(['/api/v1/users', '/api/users'], apiLimiter, users);
    app.use(['/api/v1/genres', '/api/genres'], apiLimiter, genres);
    app.use(['/api/v1/movies', '/api/movies'], apiLimiter, movies);
    app.use(['/api/v1/tvshows', '/api/tvshows'], apiLimiter, tvshows);
    app.use(['/api/v1/library', '/api/library'], apiLimiter, library);
    app.use(['/api/v1/search', '/api/search'], apiLimiter, search);
    app.use(['/api/v1/discover', '/api/discover'], apiLimiter, discover);
    app.use(['/api/v1/stream', '/api/stream'], stream); // Streaming might need custom limits
    app.use(['/api/v1/admin/sessions', '/api/admin/sessions'], apiLimiter, adminSessions);

    // Network info — returns local LAN IP so Android/TV clients can auto-configure
    app.get(['/api/v1/network-info', '/api/network-info'], (req, res) => {
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
    app.get(/^(?!\/api\/v1|\/assets|.*\..*).*/, (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
    });

    app.use(error);
};
