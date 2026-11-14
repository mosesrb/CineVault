'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planIdentityMigration, MIGRATION_ID } = require('../../services/identityMigrationPlan');
const { run, loadManifest, MAX_MANIFEST_BYTES } = require('../migrations/004_supabase_identity_preflight');
const server = '11111111-1111-4111-8111-111111111111';
const subject = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const a = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const b = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const identity = { _id: 'primary', schemaVersion: 1, serverId: server };
const legacy = (id = a, email = 'one@example.invalid') => ({ _id: id, email });
const linked = (id = a, cloudId = subject) => ({ ...legacy(id), authSchemaVersion: 2, supabaseUserId: cloudId,
    identityMigration: { id: MIGRATION_ID, version: 1, serverInstanceId: server },
    identityLinkBackup: { generation: '44444444-4444-4444-8444-444444444444' } });
const manifest = (links = [{ localUserId: a, supabaseUserId: subject }]) => ({
    schemaVersion: 1, migrationId: MIGRATION_ID, serverInstanceId: server, links
});
const plan = (users, input = null) => planIdentityMigration({ identity, users, manifest: input });
const codes = result => result.issues.map(issue => issue.code);

test('legacy inventory neither guesses identities nor declares cutover ready', () => {
    const report = plan([legacy()]);
    assert.equal(report.status, 'inventory_only');
    assert.equal(report.cloudIdentityVerified, false);
    assert.equal(report.cutoverReady, false);
    assert.deepEqual(report.proposals, []);
    assert.equal(report.counts.unmapped, 1);
});
test('explicit ID proposal preserves every caller field and excludes emails/password/history from report', () => {
    const row = { ...legacy(), password: 'synthetic-private-value', watchHistory: [{ progressSeconds: 41 }], isAdmin: true };
    const input = manifest();
    const before = JSON.stringify({ row, input });
    const report = plan([row], input);
    assert.equal(report.proposals[0].action, 'propose_link');
    assert.equal(report.planValid, true);
    assert.equal(report.cutoverReady, false);
    assert.equal(JSON.stringify({ row, input }), before);
    for (const text of ['one@example.invalid', 'synthetic-private-value', 'watchHistory', 'isAdmin']) {
        assert.equal(JSON.stringify(report).includes(text), false);
    }
});
test('identical existing reviewed mapping is a repeatable no-op', () => {
    const first = plan([linked()], manifest());
    assert.equal(first.proposals[0].action, 'already_linked');
    assert.equal(first.counts.linked, 1);
    assert.deepEqual(plan([linked()], manifest()), first);
});
test('proposal never transfers an existing subject to another local user', () => {
    const result = plan([linked(), legacy(b, 'two@example.invalid')], manifest([{ localUserId: b, supabaseUserId: subject }]));
    assert.ok(codes(result).includes('subject_owned_by_another_user'));
    assert.equal(result.status, 'blocked');
});
test('existing mapping cannot be replaced by another proposed subject', () => {
    assert.ok(codes(plan([linked()], manifest([{ localUserId: a, supabaseUserId: other }]))).includes('existing_link_conflict'));
});
test('same email is never treated as ownership proof and normalized duplicates block', () => {
    const result = plan([legacy(a, ' Person@Example.invalid '), legacy(b, 'person@example.invalid')], manifest());
    assert.ok(codes(result).includes('duplicate_email'));
    assert.equal(result.planValid, false);
    assert.equal(result.proposals.length, 1);
});
test('duplicate existing subjects and duplicate local records block', () => {
    const second = { ...linked(b), email: 'two@example.invalid' };
    assert.ok(codes(plan([linked(), second])).includes('duplicate_existing_subject'));
    assert.ok(codes(plan([legacy(), legacy()])).includes('duplicate_local_id'));
});
test('duplicate proposed local and cloud identities block rather than collapse silently', () => {
    assert.ok(codes(plan([legacy()], manifest([
        { localUserId: a, supabaseUserId: subject }, { localUserId: a, supabaseUserId: other }
    ]))).includes('duplicate_proposed_user'));
    assert.ok(codes(plan([legacy(), legacy(b, 'two@example.invalid')], manifest([
        { localUserId: a, supabaseUserId: subject }, { localUserId: b, supabaseUserId: subject }
    ]))).includes('duplicate_proposed_subject'));
});
test('unknown local IDs and wrong installation block', () => {
    assert.ok(codes(plan([], manifest())).includes('missing_local_user'));
    assert.ok(codes(plan([legacy()], { ...manifest(), serverInstanceId: other })).includes('wrong_installation'));
});
for (const [name, change] of [
    ['future schema', { authSchemaVersion: 3 }], ['null schema', { authSchemaVersion: null }],
    ['unversioned cloud identity', { supabaseUserId: subject }], ['linked without migration marker', { authSchemaVersion: 2, supabaseUserId: subject }],
    ['linked without link generation', { authSchemaVersion: 2, supabaseUserId: subject, identityMigration: { id: MIGRATION_ID, version: 1, serverInstanceId: server } }],
    ['unexpected migration marker', { identityMigration: { version: 99 } }],
]) test(name + ' is withheld', () => {
    assert.ok(codes(plan([{ ...legacy(), ...change }])).includes('unsupported_user_state'));
});
test('unknown manifest fields, versions, email matching or noncanonical IDs reject', () => {
    for (const input of [
        { ...manifest(), schemaVersion: 2 }, { ...manifest(), email: 'one@example.invalid' },
        manifest([{ localUserId: a, supabaseUserId: subject, email: 'one@example.invalid' }]),
        manifest([{ localUserId: a.toUpperCase(), supabaseUserId: subject }]),
    ]) assert.throws(() => plan([legacy()], input), /identity_manifest_invalid/);
});
test('invalid installation, excessive inventory and damaged local ID reject', () => {
    assert.throws(() => planIdentityMigration({ identity: null, users: [] }), /identity_installation_invalid/);
    assert.throws(() => planIdentityMigration({ identity, users: Array(50001).fill(legacy()) }), /identity_inventory_limit/);
    assert.throws(() => plan([{ ...legacy(), _id: 'invalid' }]), /identity_inventory_invalid/);
});
test('inventory order is immaterial but relevant snapshot changes alter fingerprint', () => {
    const rows = [legacy(), legacy(b, 'two@example.invalid')];
    assert.deepEqual(plan(rows), plan([...rows].reverse()));
    assert.notEqual(plan(rows).snapshotDigest, plan([{ ...rows[0], email: 'changed@example.invalid' }, rows[1]]).snapshotDigest);
});
test('apply, URI and unknown arguments reject before inspection', async () => {
    let calls = 0;
    for (const argv of [['--apply'], ['--uri', 'synthetic-private-uri'], ['--manifest'], ['--other']]) {
        await assert.rejects(run({ argv, inspect: async () => { calls++; }, output: () => {} }), /identity_arguments_invalid/);
    }
    assert.equal(calls, 0);
    assert.equal(await run({ argv: ['--help'], inspect: async () => { calls++; }, output: () => {} }), 0);
    assert.equal(calls, 0);
});
test('manifest file bounds and malformed input reject without any database access', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-identity-manifest-'));
    const inputPath = path.join(directory, 'manifest.json');
    try {
        await fs.writeFile(inputPath, JSON.stringify(manifest()));
        assert.deepEqual(await loadManifest(inputPath), manifest());
        await fs.writeFile(inputPath, Buffer.alloc(MAX_MANIFEST_BYTES + 1, 32));
        await assert.rejects(loadManifest(inputPath), /identity_manifest_invalid/);
        await fs.writeFile(inputPath, '{synthetic-private-value');
        let calls = 0;
        await assert.rejects(run({ argv: ['--manifest', inputPath], inspect: async () => { calls++; } }));
        assert.equal(calls, 0);
    } finally { await fs.rm(directory, { recursive: true }); }
});
test('CLI reports stable generic failure without echoing secret-bearing arguments', () => {
    const result = spawnSync(process.execPath, ['scripts/migrations/004_supabase_identity_preflight.js', '--uri', 'synthetic-private-uri'], {
        cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 5000
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no changes made/);
    assert.equal((result.stdout + result.stderr).includes('synthetic-private-uri'), false);
});
test('blocked preflight exits distinctly and emits only the report', async () => {
    const out = [];
    assert.equal(await run({ argv: [], inspect: async () => ({ identity, users: [legacy(), legacy()] }), output: value => out.push(JSON.parse(value)) }), 2);
    assert.equal(out.length, 1);
    assert.equal(out[0].status, 'blocked');
});
