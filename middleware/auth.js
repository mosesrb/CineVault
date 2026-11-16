const jwt = require('jsonwebtoken');
const config = require('config');
const winston = require('winston');
const { Session, hashSessionToken } = require('../models/session');
const { User } = require('../models/user');
const { hashVaultPath } = require('../services/contentPolicyService');
const { matchesCloudLinkedUser, isCloudExchangeRequest } = require('../services/cloudIdentityLink');

function isPlaybackEndpoint(req) {
    const isStreamRouter = req.baseUrl === '/api/v1/stream' || req.baseUrl === '/api/stream';
    return isStreamRouter && req.method === 'GET' &&
        ['/', '/subtitles', '/subtitles/vtt'].includes(req.path);
}

function requestedStreamOperation(req) {
    if (req.path === '/subtitles' || req.path === '/subtitles/vtt') return 'subtitle';
    if (req.query.download === 'true') return 'download';
    return 'stream';
}

function isCurrentlyBanned(user) {
    return user.isBanned && (!user.banExpiresAt || user.banExpiresAt > new Date());
}

async function loadAuthoritativeUser(userId) {
    const user = await User.findById(userId)
        .select('_id isAdmin isApproved isBanned banExpiresAt allowedGenres +sessionGeneration');
    if (!user) return { status: 401, message: 'User account no longer exists.' };
    if (!user.isApproved) return { status: 403, message: 'User account is not approved.' };
    if (isCurrentlyBanned(user)) return { status: 403, message: 'User account is suspended.' };
    return { user };
}

module.exports = async function (req, res, next) {
    let token = req.header('x-auth-token');
    let tokenSource = token ? 'header' : null;

    const authHeader = req.header('Authorization');
    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
        tokenSource = 'authorization';
    }

    if (!token && req.query.token && isPlaybackEndpoint(req)) {
        token = req.query.token;
        tokenSource = 'query';
    }

    if (!token) return res.status(401).send('Access denied. No token provided.');

    let decoded;
    try {
        decoded = jwt.verify(token, config.get('jwtPrivateKey'));
    } catch (_) {
        return res.status(401).send('Invalid token.');
    }

    const isStreamTicket = decoded.isStreamTicket || decoded.tokenType === 'stream';
    if (isStreamTicket) {
        let requestedPathDigest;
        try {
            requestedPathDigest = hashVaultPath(req.query.path);
        } catch (_) {
            return res.status(403).send('Stream ticket is not valid for this resource.');
        }

        const operation = requestedStreamOperation(req);
        const validTicket = decoded.isStreamTicket === true &&
            decoded.tokenType === 'stream' &&
            decoded.iss === 'cinevault' &&
            decoded.aud === 'cinevault-stream' &&
            typeof decoded.pathDigest === 'string' &&
            decoded.pathDigest === requestedPathDigest &&
            Array.isArray(decoded.operations) &&
            decoded.operations.includes(operation) &&
            isPlaybackEndpoint(req);

        if (!validTicket) return res.status(403).send('Stream ticket is not valid for this resource.');

        try {
            if (decoded.cloudBinding !== undefined &&
                (!isCloudExchangeRequest(req) ||
                    !/^[a-f0-9]{24}$/.test(decoded.parentSessionId || '') ||
                    !await Session.exists({ _id: decoded.parentSessionId, userId: decoded._id }) ||
                    !await matchesCloudLinkedUser(decoded._id, decoded.cloudBinding))) {
                return res.status(401).send('Session has been revoked or expired.');
            }
            const current = await loadAuthoritativeUser(decoded._id);
            if (!current.user) return res.status(current.status).send(current.message);
            if (current.user.sessionGeneration !== decoded.sessionGeneration) {
                return res.status(401).send('Session has been revoked or expired.');
            }
            req.user = current.user;
            req.auth = {
                kind: 'stream-ticket',
                operation,
                resourceType: decoded.resourceType,
                resourceId: decoded.resourceId,
                mediaId: decoded.mediaId
            };
            return next();
        } catch (error) {
            winston.error(`Stream identity validation failed: ${error.name || 'identity store error'}`);
            return res.status(503).send('Identity validation is temporarily unavailable.');
        }
    }

    if (tokenSource === 'query') return res.status(401).send('A scoped media ticket is required.');
    if (decoded.tokenType !== 'access' || decoded.iss !== 'cinevault' || decoded.aud !== 'cinevault-api') {
        return res.status(401).send('Invalid access token.');
    }

    try {
        const tokenDigest = hashSessionToken(token);
        const [session, current] = await Promise.all([
            Session.findOne({ $or: [{ tokenDigest }, { token }] }).select('+token +tokenDigest'),
            loadAuthoritativeUser(decoded._id)
        ]);

        if (!session || String(session.userId) !== String(decoded._id)) {
            return res.status(401).send('Session has been revoked or expired.');
        }
        if (decoded.cloudBinding !== undefined &&
            (!isCloudExchangeRequest(req) || !await matchesCloudLinkedUser(decoded._id, decoded.cloudBinding))) {
            return res.status(401).send('Session has been revoked or expired.');
        }
        if (decoded.cloudBinding !== undefined && decoded.cloudBinding.downloadAllowed !== true &&
            isPlaybackEndpoint(req) && requestedStreamOperation(req) === 'download') {
            return res.status(403).send('Download access denied.');
        }
        if (!current.user) return res.status(current.status).send(current.message);
        if (current.user.sessionGeneration !== decoded.sessionGeneration) {
            return res.status(401).send('Session has been revoked or expired.');
        }

        let changed = false;
        if (!session.tokenDigest || session.token) {
            session.tokenDigest = tokenDigest;
            session.token = undefined;
            changed = true;
        }

        const now = new Date();
        const userAgent = req.header('user-agent') || '';
        let currentIp = req.headers['x-forwarded-for']?.split(',')[0] ||
            req.ip || req.socket.remoteAddress || '127.0.0.1';
        if (currentIp === '::1' || currentIp === '::ffff:127.0.0.1') currentIp = '127.0.0.1';

        if (!session.ip || session.ip === '::1') {
            session.ip = currentIp;
            changed = true;
        }
        if (!session.userAgent && userAgent) {
            session.userAgent = userAgent;
            changed = true;
        }
        if (now - session.lastActiveAt > 60000) {
            session.lastActiveAt = now;
            changed = true;
        }
        if (changed) await session.save();

        req.user = current.user;
        req.auth = { kind: 'access-token', sessionId: session._id };
        if (decoded.cloudBinding !== undefined) {
            req.auth.cloudBinding = decoded.cloudBinding;
            req.auth.expiresAt = decoded.exp;
        }
        next();
    } catch (error) {
        winston.error(`Session or identity validation failed: ${error.name || 'authorization store error'}`);
        return res.status(503).send('Authorization validation is temporarily unavailable.');
    }
};

module.exports.isPlaybackEndpoint = isPlaybackEndpoint;
module.exports.requestedStreamOperation = requestedStreamOperation;
module.exports.loadAuthoritativeUser = loadAuthoritativeUser;
