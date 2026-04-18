const jwt = require('jsonwebtoken');
const config = require('config');
const { Session } = require('../models/session');

module.exports = async function (req, res, next) {
    let token = req.header('x-auth-token') || req.query.token;

    // Fallback to standard Authorization header
    const authHeader = req.header('Authorization');
    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    if (!token) return res.status(401).send('Access denied. No token provided.');

    try {
        const decoded = jwt.verify(token, config.get('jwtPrivateKey'));
        req.user = decoded;

        // Session Tracking & Self-Healing
        try {
            let session = await Session.findOne({ token });
            const now = new Date();
    
            if (!session) {
                // Session has been revoked or expired
                return res.status(401).send('Session has been revoked or expired.');
            } else {
                let changed = false;
                const ua = req.header('user-agent') || '';
                let currentIp = req.headers['x-forwarded-for']?.split(',')[0] || 
                                req.ip || 
                                req.socket.remoteAddress || 
                                '127.0.0.1';
                
                if (currentIp === '::1' || currentIp === '::ffff:127.0.0.1') currentIp = '127.0.0.1';

                // Update IP if it's missing or technical (::1)
                if (!session.ip || session.ip === '::1') {
                    session.ip = currentIp;
                    changed = true;
                }

                if (now - session.lastActiveAt > 60000) {
                    session.lastActiveAt = now;
                    changed = true;
                }

                if (changed) await session.save();
            }
        } catch (sessionErr) {
            // Fail-Safe: Don't block the user if session DB is failing
            console.error('Session tracking failed (Non-critical):', sessionErr.message);
        }

        next();
    } catch (err) {
        res.status(401).send('Invalid token.');
    }
};
