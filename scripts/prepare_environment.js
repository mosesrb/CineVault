const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseEnvironment } = require('../startup/environment');

const environmentPath = path.resolve(__dirname, '..', '.env');
const existing = fs.existsSync(environmentPath)
    ? parseEnvironment(fs.readFileSync(environmentPath, 'utf8'))
    : {};

function secret(bytes = 48) {
    return crypto.randomBytes(bytes).toString('base64url');
}

const mongoUsername = 'cinevault_app';
const mongoPassword = secret();
const jwtPrivateKey = secret(64);
const rootPassword = secret();
const redisPassword = secret();
const mongoURI = `mongodb://${mongoUsername}:${mongoPassword}@127.0.0.1:27018/cinevault?authSource=cinevault`;

const values = {
    NODE_ENV: 'production',
    PORT: existing.PORT || '3000',
    delatron_jwtPrivateKey: jwtPrivateKey,
    delatron_MONGODB_URI: mongoURI,
    delatron_TMDB_API_KEY: existing.delatron_TMDB_API_KEY || existing.TMDB_API_KEY || '',
    JWT_PRIVATE_KEY: jwtPrivateKey,
    MONGO_USERNAME: mongoUsername,
    MONGO_PASSWORD: mongoPassword,
    MONGO_ROOT_USERNAME: 'cinevault_root',
    MONGO_ROOT_PASSWORD: rootPassword,
    REDIS_PASSWORD: redisPassword,
    TMDB_API_KEY: existing.TMDB_API_KEY || existing.delatron_TMDB_API_KEY || '',
    HOST_MEDIA_PATH: existing.HOST_MEDIA_PATH || './media'
};

const output = [
    '# Generated locally by scripts/prepare_environment.js.',
    '# Contains production credentials. Never commit or share this file.',
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    ''
].join('\n');

const temporaryPath = `${environmentPath}.phase0.tmp`;
const previousPath = `${environmentPath}.pre-phase0`;
fs.writeFileSync(temporaryPath, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
if (fs.existsSync(environmentPath)) {
    if (fs.existsSync(previousPath)) {
        throw new Error('Refusing to replace the existing .env.pre-phase0 backup.');
    }
    fs.renameSync(environmentPath, previousPath);
}
fs.renameSync(temporaryPath, environmentPath);
console.log('Protected environment credentials generated; no secret values were printed.');
