'use strict';

const assert = require('node:assert/strict');
const {
  normalizeProtectionMessages,
  renderProtectionMessagesYaml
} = require('./protection-messages');

const defaults = normalizeProtectionMessages();
assert.doesNotMatch(defaults.warning.text, /click interval/i);
assert.equal(defaults.warning.color, '#ffff55');
assert.equal(defaults.warningCooldownSeconds, 10);

const normalized = normalizeProtectionMessages({
  warning: { text: '  {reason}\nnow  ', color: '#12A4fF' },
  kick: { text: '', color: 'not-a-color' },
  banSource: '  My server  ',
  warningCooldownSeconds: 999,
  checks: {
    reach: { text: 'Reach: {reason}', color: 'gold' },
    madeUp: { text: 'ignored', color: 'red' }
  }
});
assert.equal(normalized.warning.text, '{reason} now');
assert.equal(normalized.warning.color, '#12a4ff');
assert.equal(normalized.kick.text, defaults.kick.text);
assert.equal(normalized.kick.color, defaults.kick.color);
assert.equal(normalized.banSource, 'My server');
assert.equal(normalized.warningCooldownSeconds, 300);
assert.deepEqual(normalized.checks.reach, { text: 'Reach: {reason}', color: 'gold' });
assert.equal(normalized.checks.madeUp, undefined);

const yaml = renderProtectionMessagesYaml(normalized);
assert.match(yaml, /^messages:/);
assert.match(yaml, /warningCooldownSeconds: 300/);
assert.match(yaml, /banSource: "My server"/);
assert.match(yaml, /combat:\n      reach:\n        text: "Reach: \{reason\}"\n        color: "gold"/);
assert.doesNotMatch(yaml, /madeUp/);

console.log('PASS protection message config tests');
