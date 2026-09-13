const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');
const { EJSON } = require('bson');

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

async function restoreCollection(database, source, metadata) {
    const collection = database.collection(metadata.name);
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
    const source = path.resolve(argument('--source') || '');
    const uri = argument('--uri');
    const databaseName = argument('--database');
    const apply = process.argv.includes('--apply');
    if (!source || !uri || !databaseName) {
        throw new Error('--source, --uri, and --database are required.');
    }

    const manifest = EJSON.parse(
        fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'),
        { relaxed: false }
    );
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
