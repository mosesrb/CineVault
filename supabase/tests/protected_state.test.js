'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { createStore } = require('../../scripts/prototypes/protected_state_store');
const { prepare } = require('../../scripts/prototypes/pairing');
const BASE = path.resolve(__dirname, '../../runtime/qa/protected-store-tests');
const REF = 'aaaaaaaaaaaaaaaaaaaa';
const nativeTest = (name, fn) => test(name, { skip: process.platform !== 'win32' }, fn);
const fixture = request => new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'fixtures/protected_state_fixture.ps1')],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let diagnostic = ''; child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { diagnostic += b; });
    child.on('error', reject); child.on('close', code => resolve({ code, output, diagnostic })); child.stdin.end(JSON.stringify(request));
});
async function setup(t) {
    await fs.mkdir(BASE, { recursive: true });
    const directory = path.join(BASE, 'case-' + randomUUID());
    const serverInstanceId = randomUUID();
    const options = { directory, projectRef: REF, serverInstanceId };
    const store = createStore(options);
    // Only synthetic owned roots; validate exact parent/name and reject reparse
    // roots before recursive fixture cleanup. No production state files targeted.
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), BASE);
        assert.match(path.basename(directory), /^case-[a-f0-9-]{36}$/);
        try {
            const stat = await fs.lstat(directory); assert.equal(stat.isSymbolicLink(), false);
            await fs.rm(directory, { recursive: true, force: true });
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    });
    const pending = () => prepare({ store, projectRef: REF, serverInstanceId, localAdminApproved: true });
    return { directory, serverInstanceId, options, store, pending };
}
nativeTest('storage location rejects outside-runtime, relative, UNC and alternate streams', () => {
    for (const directory of [path.resolve(__dirname, 'tracked-state'), 'relative', '\\\\server\\share\\state', BASE + ':stream']) {
        assert.throws(() => createStore({ directory, projectRef: REF, serverInstanceId: randomUUID() }), /credential_store_recovery_required/);
    }
});
nativeTest('native pending storage survives reopening with exact secrets and binding', async t => {
    const f = await setup(t); const state = await f.pending();
    assert.deepEqual(await createStore(f.options).read(), state);
    assert.deepEqual(await f.pending(), state);
});
nativeTest('directory and file ACLs are protected owner/SYSTEM only before persisted bytes', async t => {
    const f = await setup(t); await f.pending();
    const result = await fixture({ directory: f.directory, action: 'acl' }); assert.equal(result.code, 0, result.diagnostic);
    const acl = JSON.parse(result.output);
    assert.equal(acl.directoryProtected, true); assert.equal(acl.fileProtected, true);
    for (const principals of [acl.directoryPrincipals, acl.filePrincipals]) {
        assert.deepEqual([...new Set(principals)].sort(), [...new Set([acl.owner, 'S-1-5-18'])].sort());
    }
});
nativeTest('stale separate writer cannot overwrite winner after same pending read', async t => {
    const f = await setup(t); const state = await f.pending();
    const second = createStore(f.options); await second.read();
    const active = { ...state, status: 'active', mapping: { projectRef: REF, serverInstanceId: f.serverInstanceId,
        credentialId: state.credentialId, cloudServerId: randomUUID(), epoch: 1 } };
    await f.store.writeAtomic(active);
    await assert.rejects(second.writeAtomic(state), /credential_store_recovery_required/);
    assert.deepEqual(await second.read(), active);
});
nativeTest('tampered broad file ACL is rejected without repair or overwrite', async t => {
    const f = await setup(t); const state = await f.pending();
    const bytes = await fs.readFile(path.join(f.directory, 'state.json'));
    const tampered = await fixture({ directory: f.directory, action: 'tamper' });
    assert.equal(tampered.code, 0, tampered.diagnostic);
    await assert.rejects(f.store.read(), /credential_store_recovery_required/);
    await assert.rejects(f.store.writeAtomic(state), /credential_store_recovery_required/);
    assert.deepEqual(await fs.readFile(path.join(f.directory, 'state.json')), bytes);
});
nativeTest('corrupt and oversized state fail closed and preserve bytes', async t => {
    const f = await setup(t); await f.pending(); const file = path.join(f.directory, 'state.json');
    for (const content of ['not-json', 'x'.repeat(16385)]) {
        await fs.writeFile(file, content);
        await assert.rejects(f.store.read(), /credential_store_recovery_required/);
        assert.equal(await fs.readFile(file, 'utf8'), content);
    }
});
nativeTest('restored state bound to another installation/project is never adopted', async t => {
    const f = await setup(t); await f.pending();
    for (const change of [{ serverInstanceId: randomUUID() }, { projectRef: 'bbbbbbbbbbbbbbbbbbbb' }]) {
        await assert.rejects(createStore({ ...f.options, ...change }).read(), /credential_store_recovery_required/);
    }
});
nativeTest('hard-linked state file is rejected before any read or replacement', async t => {
    const f = await setup(t); await f.pending();
    const target = path.join(f.directory, 'state.json'); const alias = path.join(f.directory, 'synthetic-alias.json');
    await fs.link(target, alias); await assert.rejects(f.store.read(), /credential_store_recovery_required/);
});
nativeTest('unsafe preexisting directory is refused without changing its ACL', async t => {
    const f = await setup(t); await fs.mkdir(f.directory);
    const before = await fixture({ directory: f.directory, action: 'directoryAcl' }); assert.equal(before.code, 0);
    await assert.rejects(f.store.read(), /credential_store_recovery_required/);
    const after = await fixture({ directory: f.directory, action: 'directoryAcl' }); assert.equal(after.code, 0);
    assert.equal(before.output, after.output);
    await assert.rejects(fs.stat(path.join(f.directory, 'state.lock')), { code: 'ENOENT' });
});
nativeTest('a directory junction ancestor is refused without touching its target', async t => {
    const f = await setup(t); const g = await setup(t); const state = await g.pending(); await f.pending();
    const junction = path.join(f.directory, 'synthetic-junction');
    await fs.symlink(g.directory, junction, 'junction');
    try {
        await assert.rejects(createStore({ ...f.options, directory: path.join(junction, 'child') }).read(), /credential_store_recovery_required/);
        assert.deepEqual(await g.store.read(), state);
        await assert.rejects(fs.stat(path.join(g.directory, 'child')), { code: 'ENOENT' });
    } finally { await fs.unlink(junction); }
});
nativeTest('valid-looking secret/nonce replacement and active rollback are refused', async t => {
    const f = await setup(t); const state = await f.pending();
    for (const change of [{ secret: '0'.repeat(64) }, { pairId: randomUUID() }, { pollSecret: '0'.repeat(64) }]) {
        await assert.rejects(f.store.writeAtomic({ ...state, ...change }), /credential_store_recovery_required/);
    }
    const active = { ...state, status: 'active', mapping: { projectRef: REF, serverInstanceId: f.serverInstanceId,
        credentialId: state.credentialId, cloudServerId: randomUUID(), epoch: 1 } };
    await f.store.writeAtomic(active);
    await assert.rejects(f.store.writeAtomic(state), /credential_store_recovery_required/);
    assert.deepEqual(await f.store.read(), active);
});
nativeTest('concurrent separate coordinators cannot create two persisted identities', async t => {
    const f = await setup(t); const second = createStore(f.options);
    const args = { projectRef: REF, serverInstanceId: f.serverInstanceId, localAdminApproved: true };
    const results = await Promise.allSettled([prepare({ ...args, store: f.store }), prepare({ ...args, store: second })]);
    const winners = results.filter(r => r.status === 'fulfilled'); assert.ok(winners.length >= 1);
    const persisted = await createStore(f.options).read();
    for (const winner of winners) assert.deepEqual(winner.value, persisted);
    for (const loser of results.filter(r => r.status === 'rejected')) assert.match(loser.reason.message, /credential_store_recovery_required/);
});
nativeTest('caller mutation during native write cannot change the transition baseline', async t => {
    const f = await setup(t); const state = await f.pending();
    const active = { ...state, status: 'active', mapping: { projectRef: REF, serverInstanceId: f.serverInstanceId,
        credentialId: state.credentialId, cloudServerId: randomUUID(), epoch: 1 } };
    const expected = structuredClone(active);
    const writing = f.store.writeAtomic(active);
    active.secret = '0'.repeat(64);
    active.mapping.cloudServerId = randomUUID();
    await writing;
    await assert.rejects(f.store.writeAtomic(active), /credential_store_recovery_required/);
    assert.deepEqual(await createStore(f.options).read(), expected);
});
nativeTest('interrupted initial write leaves an orphan and prevents new pending identity', async t => {
    const f = await setup(t); const memory = { read: async () => null, writeAtomic: async () => {} };
    const state = await prepare({ store: memory, projectRef: REF, serverInstanceId: f.serverInstanceId, localAdminApproved: true });
    assert.equal(await f.store.read(), null);
    const result = await fixture({ directory: f.directory, action: 'crash', point: 'created', payload: JSON.stringify(state), revision: null });
    assert.equal(result.code, 73);
    await assert.rejects(f.pending(), /credential_store_recovery_required/);
    await assert.rejects(fs.stat(path.join(f.directory, 'state.json')), { code: 'ENOENT' });
    assert.equal((await fs.stat(path.join(f.directory, 'state.tmp'))).size, 0);
});
for (const point of ['created', 'flushed', 'committed']) {
    nativeTest(`actual child process exit at ${point} preserves or withholds stable state`, async t => {
        const f = await setup(t); const state = await f.pending();
        const file = path.join(f.directory, 'state.json'); const original = await fs.readFile(file);
        const active = { ...state, status: 'active', mapping: { projectRef: REF, serverInstanceId: f.serverInstanceId,
            credentialId: state.credentialId, cloudServerId: randomUUID(), epoch: 1 } };
        const revision = createHash('sha256').update(original).digest('hex');
        const result = await fixture({ action: 'crash', directory: f.directory, point, payload: JSON.stringify(active), revision });
        assert.equal(result.code, 73);
        const acl = JSON.parse(result.output); assert.equal(acl.temporaryProtected, true);
        assert.deepEqual([...new Set(acl.principals)].sort(), [...new Set([acl.owner, 'S-1-5-18'])].sort());
        const reopened = createStore(f.options);
        if (point === 'committed') {
            assert.deepEqual(await reopened.read(), active);
            await assert.rejects(fs.stat(path.join(f.directory, 'state.tmp')), { code: 'ENOENT' });
        } else {
            assert.deepEqual(await fs.readFile(file), original);
            await assert.rejects(reopened.read(), /credential_store_recovery_required/);
            assert.ok((await fs.stat(path.join(f.directory, 'state.tmp'))).isFile());
        }
    });
}
