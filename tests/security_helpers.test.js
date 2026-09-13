const { validateSecurityConfig } = require('../startup/config');
const { describeMongoTarget } = require('../startup/dbconnection');
const { hashSessionToken, Session } = require('../models/session');
const loadEnvironment = require('../startup/environment');
const { parseEnvironment } = require('../startup/environment');

function configSource(values) {
    return {
        get(key) {
            if (!Object.prototype.hasOwnProperty.call(values, key)) throw new Error('missing');
            return values[key];
        }
    };
}

describe('Phase 0 security helpers', () => {
    it('rejects missing, tracked, and short JWT secrets outside tests', () => {
        const mongoURI = 'mongodb://localhost:27017/cinevault';

        expect(() => validateSecurityConfig(configSource({ mongoURI }), 'production')).toThrow(/jwtPrivateKey/);
        expect(() => validateSecurityConfig(configSource({
            jwtPrivateKey: 'cinevault_secret_key_change_me', mongoURI
        }), 'production')).toThrow(/unique secret/);
        expect(() => validateSecurityConfig(configSource({
            jwtPrivateKey: 'short-secret', mongoURI
        }), 'development')).toThrow(/32 characters/);
        expect(() => validateSecurityConfig(configSource({
            jwtPrivateKey: 'REPLACE_WITH_A_UNIQUE_RANDOM_SECRET_OF_32_OR_MORE_CHARACTERS', mongoURI
        }), 'production')).toThrow(/unique secret/);
    });

    it('accepts a sufficiently long non-default JWT secret', () => {
        expect(() => validateSecurityConfig(configSource({
            jwtPrivateKey: 'a-unique-development-secret-with-40-characters',
            mongoURI: 'mongodb://localhost:27017/cinevault'
        }), 'production')).not.toThrow();
    });

    it('redacts MongoDB credentials and query parameters from log targets', () => {
        const result = describeMongoTarget(
            'mongodb://admin:super-secret@db.internal:27017/cinevault?authSource=admin'
        );

        expect(result).toBe('mongodb://db.internal:27017/cinevault');
        expect(result).not.toContain('admin:super-secret');
        expect(result).not.toContain('authSource');
    });

    it('hashes session tokens and omits both forms from serialization', async () => {
        const rawToken = 'a-bearer-token-that-must-not-be-stored';
        const session = new Session({
            userId: '507f1f77bcf86cd799439011',
            token: rawToken
        });

        await session.validate();

        expect(session.token).toBeUndefined();
        expect(session.tokenDigest).toBe(hashSessionToken(rawToken));
        expect(session.tokenDigest).not.toBe(rawToken);
        expect(session.toJSON().token).toBeUndefined();
        expect(session.toJSON().tokenDigest).toBeUndefined();
    });

    it('loads .env-style values without overriding inherited environment values', () => {
        expect(parseEnvironment('A=one\n# comment\nB="two words"\nINVALID LINE')).toEqual({
            A: 'one',
            B: 'two words'
        });

        const target = { A: 'inherited' };
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const temporaryFile = path.join(os.tmpdir(), `cinevault-env-${process.pid}.env`);
        fs.writeFileSync(temporaryFile, 'A=file\nB=loaded\n');
        try {
            loadEnvironment(temporaryFile, target);
        } finally {
            fs.unlinkSync(temporaryFile);
        }

        expect(target).toEqual({ A: 'inherited', B: 'loaded' });
    });
});
