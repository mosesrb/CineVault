const mongoose = require('mongoose');
const config = require('config');
const { hashSessionToken } = require('../../models/session');

const APPLY_FLAG = '--apply';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function getMongoURI() {
    try {
        return config.get('mongoURI');
    } catch (_) {
        return config.get('host.domain');
    }
}

async function run() {
    const apply = process.argv.includes(APPLY_FLAG);
    const mongoURI = argument('--uri') || getMongoURI();

    if (!mongoURI) throw new Error('MongoDB connection URI is not configured.');

    await mongoose.connect(mongoURI);
    const sessions = mongoose.connection.collection('sessions');
    const legacyFilter = {
        token: { $type: 'string', $ne: '' },
        $or: [
            { tokenDigest: { $exists: false } },
            { tokenDigest: null },
            { tokenDigest: '' }
        ]
    };

    const pending = await sessions.countDocuments(legacyFilter);
    console.log(`001_hash_session_tokens: ${pending} legacy session record(s) found.`);

    if (!apply) {
        console.log(`Dry run only. Re-run with ${APPLY_FLAG} after taking a database backup.`);
        return;
    }

    let migrated = 0;
    const cursor = sessions.find(legacyFilter, { projection: { token: 1 } });
    for await (const session of cursor) {
        const tokenDigest = hashSessionToken(session.token);
        if (!tokenDigest) continue;

        const result = await sessions.updateOne(
            { _id: session._id, token: session.token },
            { $set: { tokenDigest }, $unset: { token: '' } }
        );
        migrated += result.modifiedCount;
    }

    console.log(`001_hash_session_tokens: migrated ${migrated} record(s); no bearer tokens were printed.`);
}

run()
    .catch((error) => {
        console.error(`Migration failed: ${error.name || 'error'}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
