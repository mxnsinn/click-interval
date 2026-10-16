'use strict';

// Compatibility anchor for clients updating from v1.5.143. The previous
// signed verifier requires this path to exist in the next staged release.
// Remote release control has been retired; this module has no runtime effect.
module.exports = require('./release-control');
