const { User } = require('../models/user');
const { UUID, matches } = require('./controlPlane/protocol');
const { isLinkedUser } = require('./identityMigrationPlan');
const { readServerIdentity } = require('./serverIdentityService');

async function findCloudLinkedUser(binding) {
    if (!binding || !matches(UUID, binding.subject) || !matches(UUID, binding.serverInstanceId)) return null;
    const identity = await readServerIdentity();
    if (identity.serverId !== binding.serverInstanceId) return null;

    // Read the stored types directly and consider every owner of this subject,
    // including inconsistent rows. A duplicate blocks the exchange.
    const users = await User.collection.find({ supabaseUserId: binding.subject }, {
        projection: { _id: 1, supabaseUserId: 1, authSchemaVersion: 1, identityMigration: 1, identityLinkBackup: 1 },
        maxTimeMS: 3000
    }).limit(2).toArray();
    const user = users[0];
    return users.length === 1 && user.supabaseUserId === binding.subject &&
        isLinkedUser(user, binding.serverInstanceId) ? user : null;
}

async function matchesCloudLinkedUser(userId, binding) {
    if (!matches(UUID, binding?.generation)) return false;
    const linkedUser = await findCloudLinkedUser(binding);
    return linkedUser !== null && String(linkedUser._id) === userId &&
        matches(UUID, linkedUser.identityLinkBackup?.generation) &&
        linkedUser.identityLinkBackup.generation === binding.generation;
}

function hasForwardedHeaders(req) {
    return Object.keys(req.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-'));
}

function isLocalExchangeRequest(req) {
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    return process.env.CV_AUTH_EXCHANGE_ENABLED === 'true' &&
        loopback.includes(req.socket.remoteAddress) && loopback.includes(req.socket.localAddress) &&
        /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(req.get('host') || '') &&
        !hasForwardedHeaders(req);
}

function cloudExchangeHttpsOrigin(env = process.env) {
    const origin = env.CV_AUTH_EXCHANGE_HTTPS_ORIGIN;
    if (env.CV_AUTH_EXCHANGE_ENABLED !== 'true' || !origin) return null;
    try {
        const url = new URL(origin);
        if (url.protocol === 'https:' && url.origin === origin) return url;
    } catch { /* An invalid operator setting must not enable wider exchange. */ }
    return null;
}

function isCloudExchangeRequest(req) {
    if (req.socket.encrypted !== true) {
        return !process.env.CV_AUTH_EXCHANGE_HTTPS_ORIGIN && isLocalExchangeRequest(req);
    }
    const httpsOrigin = cloudExchangeHttpsOrigin();
    if (!httpsOrigin || hasForwardedHeaders(req)) return false;
    const origin = req.get('origin');
    return req.get('host') === httpsOrigin.host && (origin === undefined || origin === httpsOrigin.origin);
}

module.exports = { findCloudLinkedUser, matchesCloudLinkedUser, isCloudExchangeRequest, cloudExchangeHttpsOrigin };
