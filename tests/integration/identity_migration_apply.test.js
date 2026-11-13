const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { applyIdentityLink, rollbackIdentityLink, readIdentityLinkReceipt } = require('../../services/identityMigrationApply');
const { readIdentityInventory } = require('../../services/identityMigrationInventory');
const { planIdentityMigration, MIGRATION_ID } = require('../../services/identityMigrationPlan');

describe('guarded identity linking on standalone MongoDB', () => {
    let db;
    let users;
    const serverInstanceId = randomUUID();
    const subject = randomUUID();
    const local = { _id: new mongoose.Types.ObjectId(), email: 'pilot@test.invalid',
        password: 'fixture-password', isAdmin: true, authSchemaVersion: 1 };
    const manifest = {
        schemaVersion: 1, migrationId: MIGRATION_ID, serverInstanceId,
        links: [{ localUserId: String(local._id), supabaseUserId: subject }]
    };
    const proof = () => ({ subject, expiresAt: Math.floor(Date.now() / 1000) + 60 });

    beforeAll(() => {
        if (mongoose.connection.name !== 'cinevault_test') throw Error('Isolated test database required');
        db = mongoose.connection.getClient().db('cinevault_link_qa_' + randomUUID().replaceAll('-', ''));
        users = db.collection('users');
    });
    beforeEach(async () => {
        await db.collection('server_identity').replaceOne({ _id: 'primary' },
            { _id: 'primary', serverId: serverInstanceId, schemaVersion: 1 }, { upsert: true });
        await users.deleteMany({});
        await users.insertOne({ ...local });
    });
    afterAll(async () => {
        if (db && /^cinevault_link_qa_[a-f0-9]{32}$/.test(db.databaseName)) await db.dropDatabase();
    });

    async function argumentsFor(selectedManifest = manifest) {
        const report = planIdentityMigration({ ...await readIdentityInventory(db), manifest: selectedManifest });
        return { db, manifest: selectedManifest, expectedDigest: report.snapshotDigest, operationId: randomUUID(),
            verifyMembership: proof };
    }

    test('keeps a durable before-image and restores absent versus explicit fields without reverting unrelated edits', async () => {
        const args = await argumentsFor();
        const applied = await applyIdentityLink(args);
        expect(applied.operationId).toBe(args.operationId);
        expect(await readIdentityLinkReceipt({ db, ...applied })).toEqual(applied);
        const linked = await users.findOne({ _id: local._id });
        expect(linked).toMatchObject({ authSchemaVersion: 2, supabaseUserId: subject, password: local.password });
        const previousGeneration = linked.identityLinkBackup.generation;
        await users.updateOne({ _id: local._id }, { $set: { isAdmin: false } });
        await rollbackIdentityLink({ db, ...applied });
        expect(await users.findOne({ _id: local._id })).toEqual({ ...local, isAdmin: false });
        await applyIdentityLink(args);
        expect((await users.findOne({ _id: local._id })).identityLinkBackup.generation).not.toBe(previousGeneration);
        await expect(rollbackIdentityLink({ db, ...applied })).rejects.toThrow('rollback_conflict');
    });

    test('rejects a mismatched subject and an inventory change during cloud verification', async () => {
        const args = await argumentsFor();
        await expect(applyIdentityLink({ ...args, verifyMembership: () => ({ ...proof(), subject: randomUUID() }) }))
            .rejects.toThrow('membership_denied');
        await expect(applyIdentityLink({ ...args, verifyMembership: async () => {
            await users.updateOne({ _id: local._id }, { $set: { email: 'updated@test.invalid' } });
            return proof();
        } })).rejects.toThrow('stale_or_blocked_plan');
        expect((await users.findOne({ _id: local._id })).supabaseUserId).toBeUndefined();
    });

    test('allows only one concurrent claim to a cloud subject', async () => {
        const other = { _id: new mongoose.Types.ObjectId(), email: 'other@test.invalid' };
        await users.insertOne(other);
        const first = await argumentsFor();
        const second = await argumentsFor({ ...manifest,
            links: [{ localUserId: String(other._id), supabaseUserId: subject }] });
        const results = await Promise.allSettled([applyIdentityLink(first), applyIdentityLink(second)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(await users.countDocuments({ supabaseUserId: subject })).toBe(1);
    });

    test('refuses rollback when the operation or applied subject differs', async () => {
        const applied = await applyIdentityLink(await argumentsFor());
        await expect(rollbackIdentityLink({ db, ...applied, operationId: randomUUID() })).rejects.toThrow('rollback_conflict');
        await users.updateOne({ _id: local._id }, { $set: { supabaseUserId: randomUUID() } });
        await expect(rollbackIdentityLink({ db, ...applied })).rejects.toThrow('rollback_conflict');
    });
});
