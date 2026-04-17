const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { User, validateLogin } = require('../models/user');

// POST /api/auth/login
router.post('/', async (req, res) => {
    const { error } = validateLogin(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(401).send('Invalid email or password.');

    const validPassword = await bcrypt.compare(req.body.password, user.password);
    if (!validPassword) return res.status(401).send('Invalid email or password.');

    // Check approval status
    if (!user.isApproved) {
        return res.status(403).send('Your account is pending administrative approval. Please try again once an administrator has reviewed your registration.');
    }

    // Check ban status
    if (user.isBanned) {
        const now = new Date();
        if (!user.banExpiresAt || user.banExpiresAt > now) {
            const msg = user.banExpiresAt
                ? `Your account is suspended until ${user.banExpiresAt.toDateString()}. Reason: ${user.banReason || 'N/A'}`
                : `Your account has been permanently banned. Reason: ${user.banReason || 'N/A'}`;
            return res.status(403).send(msg);
        }
        // Temp ban expired — lift it automatically
        user.isBanned = false;
        user.banExpiresAt = null;
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = user.generateAuthToken();

    // Record session
    try {
        const { Session } = require('../models/session');
        const ua = req.header('user-agent') || '';
        
        let platform = 'Desktop';
        if (/mobile|android|iphone|ipad/i.test(ua)) platform = 'Mobile';
        if (/smart-tv|googletv|appletv|hbbtv/i.test(ua)) platform = 'TV';

        let ip = req.headers['x-forwarded-for']?.split(',')[0] || 
                 req.ip || 
                 req.socket.remoteAddress || 
                 '127.0.0.1';

        // Normalize Localhost
        if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';

        const sessionData = {
            userId: user._id,
            token,
            ip,
            userAgent: ua,
            device: {
                platform,
                os: ua.match(/\(([^)]+)\)/)?.[1]?.split(';')[0] || 'Unknown'
            }
        };

        const session = new Session(sessionData);
        await session.save();
    } catch (ex) {
        // Log details but don't block the login response
        console.error('[Session Error]', ex.message);
    }

    res.send({ 
        token,
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            isAdmin: user.isAdmin
        }
    });
});

module.exports = router;
