const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { readIdentityInventory } = require('../../services/identityMigrationInventory');
const { planIdentityMigration } = require('../../services/identityMigrationPlan');

describe('read-only identity migration inventory', () => {
    let db;
    const id = new mongoose.Types.ObjectId();
    const serverId = '11111111-1111-4111-8111-111111111111';
    beforeAll(() => {
        if (mongoose.connection.name !== 'cinevault_test') throw Error('Requires isolated test connection');
        db = mongoose.connection.getClient().db('cinevault_migration_qa_' + randomBytes(8).toString('hex'));
    });
    afterAll(async () => {
        if (db && /^cinevault_migration_qa_[a-f0-9]{16}$/.test(db.databaseName)) await db.dropDatabase();
    });

    it('does not create missing collections or indexes', async () => {
        expect(await db.listCollections().toArray()).toHaveLength(0);
        expect(await readIdentityInventory(db)).toEqual({ identity: null, users: [] });
        expect(await db.listCollections().toArray()).toHaveLength(0);
    });
    it('reads only allowed identity fields and leaves every source record/index unchanged', async () => {
        await db.collection('server_identity').insertOne({ _id: 'primary', schemaVersion: 1, serverId, name: 'QA only' });
        await db.collection('users').insertOne({ _id: id, email: 'qa@example.invalid', name: 'QA only',
            password: 'synthetic-private-password', watchHistory: [{ progressSeconds: 42 }], isAdmin: true });
        await db.collection('sessions').insertOne({ userId: id, tokenDigest: 'synthetic-private-digest' });
        const before = await db.collection('users').findOne({ _id: id });
        const indexes = await db.collection('users').indexes();
        const snapshot = await readIdentityInventory(db);
        expect(Object.keys(snapshot.users[0]).sort()).toEqual(['_id', 'email']);
        const report = planIdentityMigration(snapshot);
        expect(report.status).toBe('inventory_only');
        expect(report.counts.users).toBe(1);
        expect(JSON.stringify(report)).not.toMatch(/qa@example|password|progressSeconds|tokenDigest/);
        expect(await db.collection('users').findOne({ _id: id })).toEqual(before);
        expect(await db.collection('users').indexes()).toEqual(indexes);
        expect(await db.collection('sessions').countDocuments()).toBe(1);
    });
    it('is repeatable without persisting migration state or changing library data', async () => {
        await db.collection('movies').insertOne({ title: 'Synthetic preserved movie' });
        const first = planIdentityMigration(await readIdentityInventory(db));
        expect(planIdentityMigration(await readIdentityInventory(db))).toEqual(first);
        expect((await db.collection('users').findOne({ _id: id })).authSchemaVersion).toBeUndefined();
        expect(await db.collection('movies').countDocuments()).toBe(1);
        expect((await db.listCollections({ name: 'identity_migrations' }).toArray())).toHaveLength(0);
    });
});
