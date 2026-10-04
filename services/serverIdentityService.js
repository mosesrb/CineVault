const { randomUUID } = require('node:crypto');
const { ServerIdentity, IDENTITY_KEY, UUID_V4 } = require('../models/serverIdentity');

function unavailable() {
    const error = new Error('Server identity unavailable.');
    error.name = 'ServerIdentityUnavailableError';
    return error;
}

function publicIdentity(record) {
    if (!record || record._id !== IDENTITY_KEY || record.schemaVersion !== 1 ||
        typeof record.serverId !== 'string' || !UUID_V4.test(record.serverId) ||
        !(record.createdAt instanceof Date) || !Number.isFinite(record.createdAt.getTime())) {
        throw unavailable();
    }
    // A stable identifier is public discovery metadata, not an authentication proof.
    return { serverId: record.serverId, schemaVersion: record.schemaVersion };
}

/**
 * Additive singleton initialization. The fixed Mongo _id serializes competing
 * startups; $setOnInsert never rewrites an existing identity. Invalid legacy
 * state fails closed rather than silently rotating the installation identity.
 */
async function ensureServerIdentity() {
    try {
        let record;
        try {
            record = await ServerIdentity.findOneAndUpdate(
                { _id: IDENTITY_KEY },
                { $setOnInsert: { serverId: randomUUID(), schemaVersion: 1, name: 'CineVault', createdAt: new Date() } },
                { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: false }
            ).lean();
        } catch (error) {
            if (error.code !== 11000) throw error;
            record = await ServerIdentity.findById(IDENTITY_KEY).lean();
        }
        return publicIdentity(record);
    } catch {
        throw unavailable();
    }
}

async function readServerIdentity() {
    try {
        return publicIdentity(await ServerIdentity.findById(IDENTITY_KEY)
            .select('_id serverId schemaVersion createdAt').lean());
    } catch {
        throw unavailable();
    }
}

module.exports = { ensureServerIdentity, readServerIdentity };
