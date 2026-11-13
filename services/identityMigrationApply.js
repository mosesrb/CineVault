const { randomUUID } = require('node:crypto');
const { ObjectId } = require('mongoose').Types;
const { readIdentityInventory } = require('./identityMigrationInventory');
const { planIdentityMigration, validateManifest, MIGRATION_ID } = require('./identityMigrationPlan');
const { UUID, HEX, matches } = require('./controlPlane/protocol');

const indexOptions = {
    name: 'unique_supabase_subject',
    unique: true,
    partialFilterExpression: { supabaseUserId: { $type: 'string' } },
    collation: { locale: 'simple' }
};
const durableWrite = { writeConcern: { w: 'majority', j: true }, maxTimeMS: 5000 };

function requireCondition(condition, code) {
    if (!condition) throw Error(code);
}

function exactField(name, value) {
    return value === undefined
        ? { $eq: [{ $type: '$' + name }, 'missing'] }
        : { $eq: ['$' + name, { $literal: value }] };
}

async function prepare(db, manifest, expectedDigest) {
    const inventory = await readIdentityInventory(db);
    const report = planIdentityMigration({ ...inventory, manifest });
    requireCondition(report.planValid && report.snapshotDigest === expectedDigest &&
        report.proposals[0]?.action === 'propose_link', 'stale_or_blocked_plan');
    const user = inventory.users.find(row => String(row._id) === manifest.links[0].localUserId);
    requireCondition(user?._id instanceof ObjectId && !Object.hasOwn(user, 'identityLinkBackup'), 'invalid_local_user');
    return user;
}

async function applyIdentityLink({ db, manifest, expectedDigest, operationId, verifyMembership }) {
    validateManifest(manifest);
    requireCondition(manifest.links.length === 1 && matches(HEX, expectedDigest) &&
        matches(UUID, operationId), 'invalid_apply_arguments');
    const { serverInstanceId } = manifest;
    const { supabaseUserId } = manifest.links[0];
    await prepare(db, manifest, expectedDigest);
    const cloud = await verifyMembership(serverInstanceId);
    requireCondition(cloud?.subject === supabaseUserId && Number.isSafeInteger(cloud.expiresAt) &&
        cloud.expiresAt > Math.floor(Date.now() / 1000), 'membership_denied');

    const users = db.collection('users');
    await users.createIndex({ supabaseUserId: 1 }, { ...indexOptions, ...durableWrite });
    const user = await prepare(db, manifest, expectedDigest);
    const backup = {
        operationId,
        generation: randomUUID(),
        appliedSubject: supabaseUserId,
        versionWasMissing: !Object.hasOwn(user, 'authSchemaVersion'),
        subjectWasMissing: !Object.hasOwn(user, 'supabaseUserId')
    };
    const migration = { id: MIGRATION_ID, version: 1, serverInstanceId };
    requireCondition(cloud.expiresAt > Math.floor(Date.now() / 1000), 'membership_expired');
    const result = await users.updateOne({
        _id: user._id, identityMigration: { $exists: false }, identityLinkBackup: { $exists: false },
        $expr: { $and: ['email', 'authSchemaVersion', 'supabaseUserId'].map(name => exactField(name, user[name])) }
    }, { $set: { supabaseUserId, authSchemaVersion: 2, identityMigration: migration, identityLinkBackup: backup } },
    { ...durableWrite, collation: { locale: 'simple' } });
    requireCondition(result.modifiedCount === 1, 'local_user_changed');
    return { status: 'applied', localUserId: String(user._id), serverInstanceId, operationId,
        generation: backup.generation };
}

async function readAppliedLink({ db, serverInstanceId, localUserId, operationId }) {
    requireCondition(matches(UUID, serverInstanceId) && matches(UUID, operationId) &&
        matches(/^[a-f0-9]{24}$/, localUserId), 'invalid_rollback_arguments');
    const identity = await db.collection('server_identity').findOne({ _id: 'primary', schemaVersion: 1, serverId: serverInstanceId },
        { projection: { _id: 1 }, maxTimeMS: 5000 });
    requireCondition(identity, 'wrong_installation');
    const users = db.collection('users');
    const _id = new ObjectId(localUserId);
    const user = await users.findOne({ _id }, {
        projection: { supabaseUserId: 1, authSchemaVersion: 1, identityMigration: 1, identityLinkBackup: 1 },
        maxTimeMS: 5000
    });
    const backup = user?.identityLinkBackup;
    requireCondition(backup?.operationId === operationId && Object.keys(backup).length === 5 &&
        matches(UUID, backup.generation) &&
        typeof backup.versionWasMissing === 'boolean' && typeof backup.subjectWasMissing === 'boolean' &&
        matches(UUID, user.supabaseUserId) && backup.appliedSubject === user.supabaseUserId, 'rollback_conflict');
    return user;
}

async function readIdentityLinkReceipt(options) {
    const user = await readAppliedLink(options);
    requireCondition(user.authSchemaVersion === 2 &&
        user.identityMigration?.serverInstanceId === options.serverInstanceId &&
        user.identityMigration.id === MIGRATION_ID && user.identityMigration.version === 1, 'rollback_conflict');
    return { status: 'applied', serverInstanceId: options.serverInstanceId, localUserId: options.localUserId,
        operationId: options.operationId, generation: user.identityLinkBackup.generation };
}

async function rollbackIdentityLink({ db, serverInstanceId, localUserId, operationId, generation, standardUserOnly = false }) {
    const user = await readAppliedLink({ db, serverInstanceId, localUserId, operationId });
    const backup = user.identityLinkBackup;
    requireCondition(backup.generation === generation, 'rollback_conflict');
    const $unset = { identityMigration: '', identityLinkBackup: '' };
    const $set = {};
    if (backup.versionWasMissing) $unset.authSchemaVersion = '';
    else $set.authSchemaVersion = 1;
    if (backup.subjectWasMissing) $unset.supabaseUserId = '';
    else $set.supabaseUserId = null;
    const result = await db.collection('users').updateOne({
        _id: user._id,
        ...(standardUserOnly && { isAdmin: { $ne: true } }),
        $expr: { $and: [
            exactField('authSchemaVersion', 2),
            exactField('supabaseUserId', user.supabaseUserId),
            exactField('identityMigration', { id: MIGRATION_ID, version: 1, serverInstanceId }),
            exactField('identityLinkBackup', backup)
        ] }
    }, { $unset, ...(Object.keys($set).length ? { $set } : {}) }, { ...durableWrite, collation: { locale: 'simple' } });
    requireCondition(result.modifiedCount === 1, 'rollback_conflict');
    return { status: 'rolled_back', localUserId, serverInstanceId, operationId };
}

module.exports = { applyIdentityLink, rollbackIdentityLink, readIdentityLinkReceipt };
