const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const { EJSON } = require('bson');

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

async function verifyBackup(source, manifest) {
    if (manifest?.format !== 'cinevault-mongodb-ejsonl-v1' || !Array.isArray(manifest.collections)) {
        throw new Error('Unsupported backup format.');
    }
    const seen = new Set();
    for (const metadata of manifest.collections) {
        const { name, file, sha256, count } = metadata;
        const expectedCount = Number(count);
        if (typeof name !== 'string' || !name || /[\\/:\0]/.test(name) || name.startsWith('system.') ||
            file !== `${name}.jsonl` || seen.has(name) || !/^[a-f0-9]{64}$/.test(sha256 || '') ||
            !Number.isSafeInteger(expectedCount) || expectedCount < 0 || !Array.isArray(metadata.indexes)) {
            throw new Error('Invalid collection metadata.');
        }
        seen.add(name);
        const digest = createHash('sha256');
        let lines = 0;
        for await (const chunk of fs.createReadStream(path.join(source, file))) {
            digest.update(chunk);
            for (const byte of chunk) if (byte === 10) lines++;
        }
        if (digest.digest('hex') !== sha256 || lines !== expectedCount) {
            throw new Error('Backup checksum or document count did not match.');
        }
    }
}

async function restoreCollection(database, source, metadata) {
    const collection = await database.createCollection(metadata.name);
    const input = readline.createInterface({
        input: fs.createReadStream(path.join(source, metadata.file), 'utf8'),
        crlfDelay: Infinity
    });
    let batch = [];
    let restored = 0;

    for await (const line of input) {
        if (!line.trim()) continue;
        batch.push(EJSON.parse(line, { relaxed: false }));
        if (batch.length >= 500) {
            await collection.insertMany(batch, { ordered: true });
            restored += batch.length;
            batch = [];
        }
    }
    if (batch.length) {
        await collection.insertMany(batch, { ordered: true });
        restored += batch.length;
    }

    const indexes = (metadata.indexes || []).filter(index => index.name !== '_id_');
    for (const index of indexes) {
        const { key, name, v, ns, ...options } = index;
        await collection.createIndex(key, { ...options, name });
    }
    return restored;
}

async function run() {
    const sourceArgument = argument('--source');
    const uri = argument('--uri');
    const databaseName = argument('--database');
    const apply = process.argv.includes('--apply');
    if (!sourceArgument || !uri || !databaseName) {
        throw new Error('--source, --uri, and --database are required.');
    }
    const source = path.resolve(sourceArgument);

    const manifest = EJSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
    await verifyBackup(source, manifest);
    console.log(`Restore plan: ${manifest.collections.length} collection(s) into ${databaseName}.`);
    if (!apply) {
        console.log('Dry run only. Re-run with --apply after verifying the target is empty.');
        return;
    }

    await mongoose.connect(uri, { dbName: databaseName });
    const database = mongoose.connection.db;
    const existing = await database.listCollections({}, { nameOnly: true }).toArray();
    if (existing.length) throw new Error('Target database is not empty; restore refused.');

    let restored = 0;
    for (const metadata of manifest.collections) {
        restored += await restoreCollection(database, source, metadata);
    }
    console.log(`Restore complete: ${restored} document(s); no document contents were printed.`);
}

run()
    .catch(error => {
        console.error(`MongoDB restore failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
