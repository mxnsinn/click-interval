'use strict';

// Compatibility anchor for clients updating from v1.5.143. The previous
// signed verifier requires this path to exist in the next staged release.
// New code uses release-control.js directly.
module.exports = require('./release-control');
