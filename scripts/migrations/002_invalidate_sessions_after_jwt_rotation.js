const mongoose = require('mongoose');
require('../../startup/environment')();
const config = require('config');

async function run() {
    const apply = process.argv.includes('--apply');
    const mongoURI = config.get('mongoURI');
    await mongoose.connect(mongoURI);

    const sessions = mongoose.connection.collection('sessions');
    const pending = await sessions.countDocuments({});
    console.log(`002_invalidate_sessions_after_jwt_rotation: ${pending} session record(s) found.`);

    if (!apply) {
        console.log('Dry run only. Re-run with --apply after JWT rotation and backup verification.');
        return;
    }

    const result = await sessions.deleteMany({});
    console.log(`002_invalidate_sessions_after_jwt_rotation: invalidated ${result.deletedCount} session(s).`);
}

run()
    .catch(error => {
        console.error(`Session invalidation failed: ${error.name || 'error'}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
