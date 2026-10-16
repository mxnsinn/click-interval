'use strict';

const assert = require('node:assert/strict');
const { CHECK_IDS, normalizeModPolicyConfig } = require('./mod-policy');

const added = [
  'movement.groundSpoof', 'movement.waterWalk', 'movement.step', 'movement.timer', 'movement.noSlow',
  'combat.criticals', 'world.scaffold', 'world.multiBreak'
];

for (const check of added) assert.ok(CHECK_IDS.includes(check), `${check} must be a compatibility check`);
const normalized = normalizeModPolicyConfig({
  compatibility: {
    playerOverrides: {
      tester: { exemptChecks: added }
    }
  }
});
assert.deepEqual(normalized.compatibility.playerOverrides.tester.exemptChecks, added);
assert.throws(() => normalizeModPolicyConfig({
  compatibility: { playerOverrides: { tester: { exemptChecks: ['movement.notReal'] } } }
}), /Unknown protection check/);

console.log('mod-policy-checks-test: passed');
