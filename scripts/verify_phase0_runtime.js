const mongoose = require('mongoose');
require('../startup/environment')();
const config = require('config');
const { validateSecurityConfig } = require('../startup/config');
const { describeMongoTarget } = require('../startup/dbconnection');

async function run() {
    validateSecurityConfig(config, process.env.NODE_ENV);
    const mongoURI = config.get('mongoURI');
    await mongoose.connect(mongoURI);

    const database = mongoose.connection.db;
    const sessions = database.collection('sessions');
    const legacySessions = await sessions.countDocuments({ token: { $type: 'string', $ne: '' } });
    const digestSessions = await sessions.countDocuments({ tokenDigest: { $type: 'string', $ne: '' } });
    const users = await database.collection('users').countDocuments();
    const movies = await database.collection('movies').countDocuments();
    const episodes = await database.collection('episodes').countDocuments();

    if (legacySessions !== 0) throw new Error('Plaintext session records remain.');

    console.log(`Authenticated database verified: ${describeMongoTarget(mongoURI)}.`);
    console.log(`Runtime data verified: ${users} user(s), ${movies} movie(s), ${episodes} episode(s), ${digestSessions} digest-only session(s).`);
}

run()
    .catch(error => {
        console.error(`Phase 0 runtime verification failed: ${error.name || 'error'}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
