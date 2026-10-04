if (process.env.NODE_ENV !== 'test') require('../../startup/environment')();
const { connectDatabase, disconnectDatabase } = require('../../startup/dbconnection');
const { ensureServerIdentity, readServerIdentity } = require('../../services/serverIdentityService');

async function run() {
    await connectDatabase();
    if (process.argv.includes('--apply')) {
        await ensureServerIdentity();
        console.log('003_initialize_server_identity: persistent identity initialized or preserved.');
    } else {
        try {
            await readServerIdentity();
            console.log('003_initialize_server_identity: existing identity valid; no changes made.');
        } catch {
            console.log('003_initialize_server_identity: identity missing or invalid; no changes made.');
            process.exitCode = 1;
        }
    }
}

if (require.main === module) {
    run().catch(() => {
        console.error('003_initialize_server_identity: operation failed; identity not rotated.');
        process.exitCode = 1;
    }).finally(disconnectDatabase);
}

module.exports = { run };
