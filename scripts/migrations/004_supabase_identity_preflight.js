'use strict';

const fs = require('node:fs/promises');
const { planIdentityMigration, validateManifest } = require('../../services/identityMigrationPlan');
const { readIdentityInventory } = require('../../services/identityMigrationInventory');
const MAX_MANIFEST_BYTES = 1024 * 1024;

function parseArguments(argv) {
    if (argv.length === 0) return { manifestPath: null };
    if (argv.length === 1 && argv[0] === '--help') return { help: true };
    if (argv.length === 2 && argv[0] === '--manifest' && argv[1] && !argv[1].startsWith('--')) {
        return { manifestPath: argv[1] };
    }
    throw Error('identity_arguments_invalid');
}

async function loadManifest(filePath) {
    if (!filePath) return null;
    const file = await fs.open(filePath, 'r');
    try {
        const info = await file.stat();
        if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) throw Error('identity_manifest_invalid');
        // Bounded even if another process grows the file after stat().
        const buffer = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
            const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
            if (chunk.bytesRead === 0) break;
            bytesRead += chunk.bytesRead;
        }
        if (bytesRead > MAX_MANIFEST_BYTES) throw Error('identity_manifest_invalid');
        const manifest = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
        validateManifest(manifest);
        return manifest;
    } finally { await file.close(); }
}

async function inspectConfiguredDatabase() {
    if (process.env.NODE_ENV !== 'test') require('../../startup/environment')();
    const config = require('config');
    const { MongoClient } = require('mongoose').mongo;
    const uri = config.has('mongoURI') ? config.get('mongoURI') : config.get('host.domain');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
        socketTimeoutMS: 5000, waitQueueTimeoutMS: 5000, maxPoolSize: 1, retryReads: false, retryWrites: false });
    try {
        await client.connect();
        return await readIdentityInventory(client.db());
    } finally { await client.close(); }
}

async function run({ argv = process.argv.slice(2), inspect = inspectConfiguredDatabase,
    output = value => console.log(value) } = {}) {
    // Reject --apply/URI/unknown arguments and bad manifests before loading local
    // credentials or opening a connection. No write switch is implemented.
    const args = parseArguments(argv);
    if (args.help) {
        output('Read-only identity migration preflight. Usage: npm run migrate:identity-links -- [--manifest path.json]. No apply/cutover support.');
        return 0;
    }
    const manifest = await loadManifest(args.manifestPath);
    const report = planIdentityMigration({ ...await inspect(), manifest });
    output(JSON.stringify(report, null, 2));
    return report.planValid ? 0 : 2;
}

if (require.main === module) {
    run().then(code => { process.exitCode = code; }).catch(() => {
        console.error('Identity migration preflight failed; no changes made. Check configuration, input and database availability privately.');
        process.exitCode = 1;
    });
}

module.exports = { run, parseArguments, loadManifest, MAX_MANIFEST_BYTES };
