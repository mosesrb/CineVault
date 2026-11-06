'use strict';

const { MAX_USERS } = require('./identityMigrationPlan');
const USER_PROJECTION = Object.freeze({ _id: 1, email: 1, authSchemaVersion: 1, supabaseUserId: 1, identityMigration: 1 });

// Native reads deliberately avoid User/Session model imports and automatic
// Mongoose collection/index creation. This function has no write path.
async function readIdentityInventory(db) {
    const identity = await db.collection('server_identity').findOne({ _id: 'primary' }, {
        projection: { _id: 1, schemaVersion: 1, serverId: 1 }, maxTimeMS: 5000
    });
    const users = await db.collection('users').find({}, { projection: USER_PROJECTION, maxTimeMS: 5000 })
        .limit(MAX_USERS + 1).toArray();
    if (users.length > MAX_USERS) throw Error('identity_inventory_limit');
    return { identity, users };
}

module.exports = { readIdentityInventory, USER_PROJECTION };
