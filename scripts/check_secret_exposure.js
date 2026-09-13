const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseEnvironment } = require('../startup/environment');

const root = path.resolve(__dirname, '..');
const environment = parseEnvironment(fs.readFileSync(path.join(root, '.env'), 'utf8'));
const secretKeys = [
    'delatron_jwtPrivateKey',
    'JWT_PRIVATE_KEY',
    'MONGO_PASSWORD',
    'MONGO_ROOT_PASSWORD',
    'REDIS_PASSWORD'
];
const secrets = [...new Set(secretKeys.map(key => environment[key]).filter(value => value && value.length >= 16))];

function filesBelow(directory) {
    if (!fs.existsSync(directory)) return [];
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const resolved = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...filesBelow(resolved));
        else if (entry.isFile()) files.push(resolved);
    }
    return files;
}

const trackedResult = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' });
if (trackedResult.status !== 0) throw new Error('Unable to enumerate tracked files.');
const tracked = trackedResult.stdout.toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(file => path.join(root, file))
    // A tracked file may be intentionally deleted in the current remediation.
    .filter(file => fs.existsSync(file));
const generatedAndLogs = [
    ...filesBelow(path.join(root, 'frontend', 'dist')),
    ...filesBelow(path.join(root, 'runtime')).filter(file => file.endsWith('.log')),
    path.join(root, 'common.log'),
    path.join(root, 'uncaughtException.log')
].filter(file => fs.existsSync(file));

const exposedFiles = [];
for (const file of [...new Set([...tracked, ...generatedAndLogs])]) {
    const content = fs.readFileSync(file);
    if (secrets.some(secret => content.includes(Buffer.from(secret, 'utf8')))) {
        exposedFiles.push(path.relative(root, file));
    }
}

if (exposedFiles.length) {
    throw new Error(`Generated credentials were found outside protected configuration: ${exposedFiles.join(', ')}`);
}
console.log(`Secret exposure scan passed across ${tracked.length} tracked and ${generatedAndLogs.length} generated/log file(s).`);
