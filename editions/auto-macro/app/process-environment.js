'use strict';

const SAFE_CHILD_ENVIRONMENT_KEYS = Object.freeze([
  'ComSpec', 'NUMBER_OF_PROCESSORS', 'OS', 'PATHEXT', 'PROCESSOR_ARCHITECTURE',
  'SystemDrive', 'SystemRoot', 'TEMP', 'TMP', 'windir',
  'CLICK_INTERVAL_WINE_COMPAT'
]);

function minimalChildEnvironment(source = process.env) {
  const result = {};
  for (const key of SAFE_CHILD_ENVIRONMENT_KEYS) {
    if (typeof source[key] === 'string' && source[key]) result[key] = source[key];
  }
  return result;
}

module.exports = { minimalChildEnvironment, SAFE_CHILD_ENVIRONMENT_KEYS };
