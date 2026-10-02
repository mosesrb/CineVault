const { spawnSync } = require('child_process');
const path = require('path');

function isManagedLocalMongo(mongoURI, platform = process.platform) {
    if (platform !== 'win32') return false;
    try {
        const target = new URL(mongoURI);
        return target.protocol === 'mongodb:' && target.port === '27018' &&
            ['127.0.0.1', 'localhost'].includes(target.hostname);
    } catch {
        return false;
    }
}

/** Start only the dedicated Windows database; other deployments manage their own DB. */
function ensureLocalMongo({ mongoURI, platform = process.platform, run = spawnSync }) {
    if (!isManagedLocalMongo(mongoURI, platform)) return;
    const result = run('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'start_cinevault.ps1'), '-DatabaseOnly'
    ], { stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) {
        throw new Error('CineVault database startup failed. Check runtime/mongodb/mongod.log before starting the application.');
    }
}

if (require.main === module && process.platform === 'win32') {
    try {
        require('../startup/environment')();
        const config = require('config');
        const mongoURI = config.has('mongoURI') ? config.get('mongoURI') : config.get('host.domain');
        ensureLocalMongo({ mongoURI });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { isManagedLocalMongo, ensureLocalMongo };
