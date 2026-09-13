const { Session } = require('../models/session');

function requestIp(req) {
    let ip = req.headers['x-forwarded-for']?.split(',')[0] ||
        req.ip || req.socket.remoteAddress || '127.0.0.1';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';
    return ip;
}

async function createSessionForRequest(user, token, req) {
    const userAgent = req.header('user-agent') || '';
    let platform = 'Desktop';
    if (/mobile|android|iphone|ipad/i.test(userAgent)) platform = 'Mobile';
    if (/smart-tv|googletv|appletv|hbbtv/i.test(userAgent)) platform = 'TV';

    return new Session({
        userId: user._id,
        token,
        ip: requestIp(req),
        userAgent,
        device: {
            platform,
            os: userAgent.match(/\(([^)]+)\)/)?.[1]?.split(';')[0] || 'Unknown'
        }
    }).save();
}

async function revokeUserSessions(userId) {
    if (!userId) return 0;
    const result = await Session.deleteMany({ userId });
    return result.deletedCount;
}

module.exports = { createSessionForRequest, revokeUserSessions, requestIp };
