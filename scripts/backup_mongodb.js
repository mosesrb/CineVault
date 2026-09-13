const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('config');
const { EJSON } = require('bson');

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function configuredURI() {
    try {
        return config.get('mongoURI');
    } catch (_) {
        return config.get('host.domain');
    }
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeCollection(database, collectionName, destination) {
    const outputPath = path.join(destination, `${collectionName}.jsonl`);
    const output = fs.createWriteStream(outputPath, { encoding: 'utf8', flags: 'wx' });
    const digest = crypto.createHash('sha256');
    let count = 0;

    for await (const document of database.collection(collectionName).find({})) {
        const line = `${EJSON.stringify(document, { relaxed: false })}\n`;
        digest.update(line);
        if (!output.write(line)) await new Promise(resolve => output.once('drain', resolve));
        count += 1;
    }

    await new Promise((resolve, reject) => {
        output.on('error', reject);
        output.end(resolve);
    });

    return {
        name: collectionName,
        count,
        file: path.basename(outputPath),
        sha256: digest.digest('hex'),
        indexes: await database.collection(collectionName).indexes()
    };
}

async function run() {
    const uri = argument('--uri') || configuredURI();
    if (!uri) throw new Error('MongoDB connection URI is not configured.');

    const parsed = new URL(uri);
    const databaseName = argument('--database') || parsed.pathname.replace(/^\//, '');
    if (!databaseName) throw new Error('A database name is required.');

    const destination = path.resolve(
        argument('--output') || path.join('backups', 'mongodb', `${databaseName}-${timestamp()}`)
    );
    fs.mkdirSync(destination, { recursive: true });

    await mongoose.connect(uri, { dbName: databaseName });
    const database = mongoose.connection.db;
    const collectionNames = (await database.listCollections({}, { nameOnly: true }).toArray())
        .map(item => item.name)
        .filter(name => !name.startsWith('system.'))
        .sort();

    const collections = [];
    for (const collectionName of collectionNames) {
        collections.push(await writeCollection(database, collectionName, destination));
    }

    const manifest = {
        format: 'cinevault-mongodb-ejsonl-v1',
        createdAt: new Date().toISOString(),
        database: databaseName,
        collections
    };
    fs.writeFileSync(
        path.join(destination, 'manifest.json'),
        `${EJSON.stringify(manifest, { relaxed: false }, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' }
    );

    console.log(`MongoDB backup complete: ${collections.length} collection(s), ${collections.reduce((sum, item) => sum + item.count, 0)} document(s).`);
    console.log(`Backup directory: ${destination}`);
}

run()
    .catch(error => {
        console.error(`MongoDB backup failed: ${error.name || 'error'}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
