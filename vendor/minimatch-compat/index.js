'use strict';

const matcher = require('minimatch-modern');

function minimatch(...args) {
  return matcher.minimatch(...args);
}

module.exports = Object.assign(minimatch, matcher);
