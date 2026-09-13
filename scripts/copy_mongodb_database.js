const mongoose = require('mongoose');

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

async function run() {
    const sourceURI = argument('--source-uri');
    const targetURI = argument('--target-uri');
    const sourceDatabase = argument('--source-database');
    const targetDatabase = argument('--target-database');
    const apply = process.argv.includes('--apply');

    if (![sourceURI, targetURI, sourceDatabase, targetDatabase].every(Boolean)) {
        throw new Error('Source/target URI and database arguments are required.');
    }

    const sourceConnection = mongoose.createConnection(sourceURI, { dbName: sourceDatabase });
    const targetConnection = mongoose.createConnection(targetURI, { dbName: targetDatabase });
    await Promise.all([sourceConnection.asPromise(), targetConnection.asPromise()]);

    try {
        const collections = (await sourceConnection.db.listCollections({}, { nameOnly: true }).toArray())
            .map(item => item.name)
            .filter(name => !name.startsWith('system.'))
            .sort();
        const targetCollections = await targetConnection.db.listCollections({}, { nameOnly: true }).toArray();

        console.log(`Copy plan: ${collections.length} collection(s), ${sourceDatabase} -> ${targetDatabase}.`);
        if (!apply) {
            console.log('Dry run only. Re-run with --apply after verifying the target is empty.');
            return;
        }
        if (targetCollections.length) throw new Error('Target database is not empty; copy refused.');

        let copied = 0;
        for (const collectionName of collections) {
            const sourceCollection = sourceConnection.db.collection(collectionName);
            const targetCollection = targetConnection.db.collection(collectionName);
            const cursor = sourceCollection.find({});
            let batch = [];

            for await (const document of cursor) {
                batch.push(document);
                if (batch.length >= 500) {
                    await targetCollection.insertMany(batch, { ordered: true });
                    copied += batch.length;
                    batch = [];
                }
            }
            if (batch.length) {
                await targetCollection.insertMany(batch, { ordered: true });
                copied += batch.length;
            }

            const indexes = (await sourceCollection.indexes()).filter(index => index.name !== '_id_');
            for (const index of indexes) {
                const { key, name, v, ns, ...options } = index;
                await targetCollection.createIndex(key, { ...options, name });
            }
        }
        console.log(`Database copy complete: ${copied} document(s); no document contents were printed.`);
    } finally {
        await Promise.all([sourceConnection.close(), targetConnection.close()]);
    }
}

run().catch(error => {
    console.error(`MongoDB copy failed: ${error.message}`);
    process.exitCode = 1;
});
