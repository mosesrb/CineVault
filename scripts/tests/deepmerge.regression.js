const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const jestRequire = createRequire(require.resolve('jest-config/package.json'));
const merge = jestRequire('deepmerge');
const payload = () => JSON.parse('{"__proto__":{"cvPoisoned":true},"safe":7}');

function assertSafe(value) {
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(value.cvPoisoned, undefined);
  assert.equal(Object.hasOwn(value, '__proto__'), false);
  assert.equal(({}).cvPoisoned, undefined);
}

test('Jest resolves the private fork and the vulnerable registry package is absent', () => {
  const installed = jestRequire('deepmerge');
  assert.equal(installed, merge);
  const metadata = jestRequire('deepmerge/package.json');
  assert.equal(metadata.name, '@cinevault/deepmerge-guard');
  assert.equal(metadata.version, '1.0.0');
  const root = path.resolve(__dirname, '../..');
  assert.deepEqual(fs.readFileSync(jestRequire.resolve('deepmerge')),
    fs.readFileSync(path.join(root, 'vendor/deepmerge-guard/index.js')));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert.equal(manifest.devDependencies['@cinevault/deepmerge-guard'], 'file:vendor/deepmerge-guard');
  assert.equal(manifest.overrides[`jest-config@${jestRequire('jest-config/package.json').version}`].deepmerge, 'file:../../vendor/deepmerge-guard');
  assert.match(fs.readFileSync(path.join(root, '.npmrc'), 'utf8'), /^install-links=true\s*$/);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  assert(!Object.entries(lock.packages).some(([name, entry]) =>
    name.endsWith('/deepmerge') && entry.resolved?.startsWith('https://registry.npmjs.org/deepmerge/')));
});

for (const [name, target, source] of [
  ['own poisoned target', () => payload(), () => ({ good: true })],
  ['null-prototype target', () => Object.create(null), payload],
  ['null target', () => null, payload],
  ['primitive target', () => 1, payload],
  ['own poisoned target and source', payload, payload]
]) {
  test(`reject prototype replacement: ${name}`, () => {
    const result = merge(target(), source());
    assertSafe(result);
    if (Object.hasOwn(result, 'safe')) assert.equal(result.safe, 7);
  });
}

test('nested null placeholders cannot acquire the source prototype', () => {
  const result = merge({ session: null }, { session: payload() });
  assertSafe(result.session);
  assert.equal(result.session.safe, 7);
});

test('recursive target copies and default array cloning reject the key', () => {
  const result = merge({ session: payload(), list: [payload()] }, {});
  assertSafe(result.session);
  assertSafe(result.list[0]);
  assert.equal(result.session.safe, 7);
});

test('merge.all and clone:false still reject forbidden assignment', () => {
  assertSafe(merge.all([payload(), { good: true }]));
  assertSafe(merge(payload(), payload(), { clone: false }));
});

test('forbidden getters are skipped without reading their values', () => {
  const object = Object.create(null);
  Object.defineProperty(object, '__proto__', {
    enumerable: true, get() { throw new Error('Forbidden key must not be read'); }
  });
  assertSafe(merge(object, {}));
  assertSafe(merge(Object.create(null), object));
});

test('ordinary deep merge, array concatenation and input immutability remain', () => {
  const target = { env: { one: 1 }, list: [{ a: 1 }] };
  const source = { env: { two: 2 }, list: [{ b: 2 }] };
  const result = merge(target, source);
  assert.deepEqual(result, { env: { one: 1, two: 2 }, list: [{ a: 1 }, { b: 2 }] });
  result.list[0].a = 3;
  result.env.one = 4;
  assert.deepEqual(target, { env: { one: 1 }, list: [{ a: 1 }] });
  assert.deepEqual(source, { env: { two: 2 }, list: [{ b: 2 }] });
});

test('Jest preset/global merge and merge.all precedence remain', () => {
  assert.deepEqual(merge.all([{ timeout: 5, globals: { preset: true } }, { timeout: 9, globals: { local: true } }]), {
    timeout: 9, globals: { preset: true, local: true }
  });
  assert.throws(() => merge.all({}), /first argument should be an array/);
});

test('enumerable symbols merge, non-enumerable properties do not', () => {
  const symbol = Symbol('config');
  const source = { [symbol]: { enabled: true } };
  Object.defineProperty(source, 'hidden', { value: 5 });
  assert.deepEqual(merge({}, source)[symbol], { enabled: true });
  assert.equal(Object.hasOwn(merge({}, source), 'hidden'), false);
});

test('dates, regular expressions, functions and React elements retain identity', () => {
  const values = [new Date(0), /test/g, () => 1, { $$typeof: Symbol.for('react.element') }];
  for (const value of values) assert.equal(merge({}, { value }).value, value);
});

test('custom array merge, custom property merge and object predicate remain', () => {
  assert.deepEqual(merge({ list: [1] }, { list: [2] }, { arrayMerge: (_target, source) => source }), { list: [2] });
  assert.deepEqual(merge({ config: { a: 1 } }, { config: { b: 2 } }, {
    customMerge: key => key === 'config' ? (target, source) => ({ ...target, ...source, custom: true }) : undefined
  }), { config: { a: 1, b: 2, custom: true } });
  const value = { keepIdentity: true };
  assert.equal(merge({}, { value }, { isMergeableObject: object => object !== value }).value, value);
});

test('ordinary constructor and prototype data are not gratuitously rewritten', () => {
  const source = JSON.parse('{"constructor":{"setting":true},"prototype":{"data":true}}');
  const result = merge(Object.create(null), source);
  assert.deepEqual(result.constructor, { setting: true });
  assert.deepEqual(result.prototype, { data: true });
  assertSafe(result);
});
