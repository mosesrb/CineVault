const config = require('config');

const UNSAFE_JWT_SECRETS = new Set([
    'delatron_jwtPrivateKey',
    'cinevault_secret_key_change_me',
    'your_super_secret',
    'change_me',
    'REPLACE_WITH_A_UNIQUE_RANDOM_SECRET_OF_32_OR_MORE_CHARACTERS',
    'REPLACE_WITH_A_DIFFERENT_UNIQUE_RANDOM_SECRET_OF_32_OR_MORE_CHARACTERS'
]);

function getOptional(source, key) {
    try {
        return source.get(key);
    } catch (_) {
        return undefined;
    }
}

function validateSecurityConfig(source = config, nodeEnv = process.env.NODE_ENV) {
    const jwtPrivateKey = getOptional(source, 'jwtPrivateKey');

    if (typeof jwtPrivateKey !== 'string' || !jwtPrivateKey.trim()) {
        throw new Error('Fatal Error: jwtPrivateKey is not defined.');
    }

    // Tests use short, isolated fixtures. Every runnable non-test environment
    // must use a high-entropy secret and must never fall back to a tracked value.
    if (nodeEnv !== 'test' &&
        (jwtPrivateKey.length < 32 || UNSAFE_JWT_SECRETS.has(jwtPrivateKey))) {
        throw new Error('Fatal Error: jwtPrivateKey must be a unique secret of at least 32 characters.');
    }

    const mongoURI = getOptional(source, 'mongoURI') || getOptional(source, 'host.domain');
    if (nodeEnv !== 'test' && (typeof mongoURI !== 'string' || !mongoURI.trim())) {
        throw new Error('Fatal Error: MongoDB connection URI is not defined.');
    }
}

module.exports = function () {
    validateSecurityConfig();
};

module.exports.validateSecurityConfig = validateSecurityConfig;
module.exports.UNSAFE_JWT_SECRETS = UNSAFE_JWT_SECRETS;
