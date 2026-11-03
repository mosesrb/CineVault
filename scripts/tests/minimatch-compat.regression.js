const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const lintConsumers = [
  'eslint',
  '@eslint/config-array',
  '@eslint/eslintrc',
  'eslint-plugin-react'
];

for (const consumer of lintConsumers) {
  test(`${consumer} can use the patched matcher through its legacy interface`, () => {
    const consumerRequire = createRequire(require.resolve(consumer));
    const matcher = consumerRequire('minimatch');

    assert.equal(consumerRequire('minimatch/package.json').name, '@cinevault/minimatch-compat');
    assert.equal(matcher('MovieCard', 'Movie*'), true);
    assert.equal(matcher('SeriesCard', 'Movie*'), false);
    const lintPattern = new matcher.Minimatch('src/**/*.{js,jsx}', { dot: true });
    assert.equal(lintPattern.match('src/.shared/Player.jsx'), true);
    assert.equal(lintPattern.match('src/styles.css'), false);
    assert.equal(lintPattern.match('src/.shared', true), true);
  });
}
