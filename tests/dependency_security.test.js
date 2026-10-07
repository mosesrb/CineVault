const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const Joi = require('joi');
const proxyAddr = require('proxy-addr');
const shellQuote = require('shell-quote');
const { loadNycConfig } = require('@istanbuljs/load-nyc-config');
const frontendRequire = createRequire(path.resolve(__dirname, '../frontend/package.json'));
const { SourceMapConsumer } = frontendRequire('source-map-js');
const fixtures = path.resolve(__dirname, 'fixtures/dependencies');

function indexed(line, map = { version: 3, sources: ['a.js'], names: [], mappings: 'AAAA' }) {
    return { version: 3, sections: [{ offset: { line, column: 0 }, map }] };
}

describe('dependency advisory regressions', () => {
    it('keeps both lockfile representations free of the unpatched sprintf-js chain', () => {
        const lock = require('../package-lock.json');
        expect(Object.keys(lock.packages).some(name => name.endsWith('/sprintf-js'))).toBe(false);
        expect(lock.dependencies['sprintf-js']).toBeUndefined();
        expect(lock.packages['node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml']).toBeUndefined();
        expect(lock.dependencies['@istanbuljs/load-nyc-config'].dependencies['js-yaml']).toBeUndefined();
    });

    it('resolves the actual overridden consumers to YAML4 and the patched shell-quote', () => {
        const nycRequire = createRequire(require.resolve('@istanbuljs/load-nyc-config'));
        const concurrentlyRequire = createRequire(require.resolve('concurrently'));
        expect(nycRequire('js-yaml/package.json').version).toBe('4.3.2');
        expect(concurrentlyRequire('shell-quote/package.json').version).toBe('1.11.0');
    });

    it.each(['nyc.yml', 'nyc.yaml'])('loads normal NYC YAML with inheritance and relative cwd: %s', async file => {
        const result = await loadNycConfig({ cwd: fixtures, nycrcPath: path.join(fixtures, file) });
        expect(result).toMatchObject({
            cwd: path.join(fixtures, 'src'), include: ['**/*.js'], exclude: ['**/*.test.js'],
            extension: ['.js'], reporter: ['text'], all: true, checkCoverage: true
        });
    });

    it('preserves JSON NYC configuration loading', async () => {
        const result = await loadNycConfig({ cwd: fixtures, nycrcPath: path.join(fixtures, 'nyc.json') });
        expect(result).toMatchObject({ include: ['**/*.js'], extension: ['.js'], all: true });
    });

    it('does not permit executable JavaScript tags in NYC YAML', async () => {
        await expect(loadNycConfig({ cwd: fixtures, nycrcPath: path.join(fixtures, 'unsafe.yml') }))
            .rejects.toThrow(/unknown tag/);
    });

    it.each(['text', 'template'])('rejects flat __proto__ Joi message codes: %s', type => {
        const message = type === 'text' ? 'invalid' : Joi.x('invalid');
        expect(() => Joi.number().messages({ ['__proto__']: message })).toThrow(/__proto__/);
        expect(Joi.number().min(10).messages({ 'number.min': 'too small' }).validate(1).error.message).toBe('too small');
    });

    it('rejects localized __proto__ Joi message codes', () => {
        expect(() => Joi.number().messages({ en: { ['__proto__']: 'invalid' } })).toThrow(/__proto__/);
    });

    it('does not trust arbitrary IPv4 or mapped candidates through a short mapped prefix', () => {
        const trust = proxyAddr.compile(['::ffff:10.0.0.0/8']);
        for (const address of ['203.0.113.9', '10.0.0.1', '::ffff:203.0.113.9']) expect(trust(address)).toBe(false);
    });

    it.each(['10.0.0.0/8', '::ffff:10.0.0.0/104'])('preserves intended proxy trust: %s', subnet => {
        const trust = proxyAddr.compile([subnet]);
        expect(trust('10.0.0.1')).toBe(true);
        expect(trust('203.0.113.9')).toBe(false);
    });

    it('ignores forwarded headers supplied by an untrusted socket', () => {
        expect(proxyAddr({ connection: { remoteAddress: '127.0.0.1' },
            headers: { 'x-forwarded-for': '203.0.113.9' } }, ['::ffff:10.0.0.0/8'])).toBe('127.0.0.1');
    });

    it('rejects comment-breaking newline tokens without executing any shell', () => {
        for (const newline of ['\n', '\r', '\u2028', '\u2029']) {
            expect(() => shellQuote.quote(['echo', { comment: 'note' }, `value${newline}tail`])).toThrow(TypeError);
        }
    });

    it('preserves safe quoting and parsing used by the development launcher', () => {
        const tokens = ['npm', 'run', 'dev', '--', 'two words'];
        expect(shellQuote.parse(shellQuote.quote(tokens))).toEqual(tokens);
    });

    it('rejects oversized and invalid indexed source-map offsets at construction', () => {
        for (const value of [10000001, Infinity, -1, 1.5, '1']) {
            expect(() => new SourceMapConsumer(indexed(value))).toThrow();
        }
    });

    it('rejects cumulative nested offsets exceeding the source-map bound', () => {
        expect(() => new SourceMapConsumer(indexed(6000000, indexed(6000000)))).toThrow(/nested/);
    });

    it('preserves normal indexed source-map mapping', () => {
        const consumer = new SourceMapConsumer(indexed(2));
        const mappings = [];
        consumer.eachMapping(mapping => mappings.push(mapping.generatedLine));
        expect(mappings).toEqual([3]);
        expect(consumer.sources).toEqual(['a.js']);
        expect(frontendRequire('source-map-js/package.json').version).toBe('1.2.2');
    });

    it('keeps installed patched package bytes consistent with the lock', () => {
        const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package-lock.json')));
        for (const name of ['joi', 'proxy-addr', 'shell-quote']) {
            expect(require(`${name}/package.json`).version).toBe(lock.packages[`node_modules/${name}`].version);
        }
    });
});
