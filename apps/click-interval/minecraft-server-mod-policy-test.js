'use strict';

const assert = require('node:assert/strict');
const {
  CHECK_IDS,
  normalizeModPolicyConfig,
  mergeModPolicyConfig,
  renderModPolicyYaml,
  getCompatibilityPresets,
  applyPlayerCompatibilityPreset
} = require('./minecraft-server/mod-policy');

const defaults = normalizeModPolicyConfig({});
assert.deepEqual(defaults.compatibility.playerOverrides, {});
assert.equal(defaults.modPolicy.advisory, true);
assert.equal(defaults.modPolicy.enabled, false);
assert.equal(defaults.modPolicy.requireDeclaration, false);
assert.equal(defaults.modPolicy.enforcement, 'report');

const presets = Object.fromEntries(getCompatibilityPresets().map((preset) => [preset.id, preset]));
assert.deepEqual(presets['mouse-tweaks'].exemptChecks, ['abuse.inventorySpam']);
assert.deepEqual(presets['quick-inventory'].exemptChecks, ['abuse.inventorySpam']);
assert.deepEqual(presets['click-interval-auto-clicker'].exemptChecks, ['combat.autoClicker', 'combat.clickPattern']);

const configured = normalizeModPolicyConfig({
  compatibility: {
    playerOverrides: {
      Alex: {
        name: 'Alex: main account',
        reason: 'Uses a supported inventory helper',
        presets: ['mouse-tweaks'],
        exemptChecks: ['combat.autoClicker']
      }
    },
    permissionOverrides: {
      'ClickInterval.Compat.Inventory': ['abuse.inventorySpam']
    }
  },
  modPolicy: {
    enabled: true,
    enforcement: 'kick',
    requireDeclaration: false,
    declarationGraceSeconds: 12,
    enforceAllowlist: true,
    allowed: ['MouseTweaks', 'sodium', 'sodium'],
    blocked: ['example_cheat']
  }
});
assert.deepEqual(configured.compatibility.playerOverrides.alex.exemptChecks, [
  'combat.autoClicker',
  'abuse.inventorySpam'
]);
assert.deepEqual(configured.modPolicy.allowed, ['mousetweaks', 'sodium']);
assert.deepEqual(configured.modPolicy.blocked, ['example_cheat']);

const updated = mergeModPolicyConfig(configured, {
  compatibility: {
    playerOverrides: {
      Alex: { reason: 'Updated reason' },
      Steve: { presets: ['click-interval-auto-clicker'] }
    }
  },
  modPolicy: { enforcement: 'report', blocked: ['another_cheat'] }
});
assert.equal(updated.compatibility.playerOverrides.alex.reason, 'Updated reason');
assert.deepEqual(updated.compatibility.playerOverrides.steve.exemptChecks, ['combat.autoClicker', 'combat.clickPattern']);
assert.equal(updated.modPolicy.enforcement, 'report');
assert.deepEqual(updated.modPolicy.allowed, ['mousetweaks', 'sodium']);
assert.deepEqual(updated.modPolicy.blocked, ['another_cheat']);

const removed = mergeModPolicyConfig(updated, {
  compatibility: { playerOverrides: { Alex: null } }
});
assert.equal(removed.compatibility.playerOverrides.alex, undefined);
assert.ok(removed.compatibility.playerOverrides.steve);

const withPreset = applyPlayerCompatibilityPreset({}, 'Builder_1', 'mouse-tweaks', {
  name: 'Builder 1'
});
assert.deepEqual(withPreset.compatibility.playerOverrides.builder_1.exemptChecks, ['abuse.inventorySpam']);

const withQuickInventory = applyPlayerCompatibilityPreset({}, 'Sorter_1', 'quick-inventory');
assert.deepEqual(withQuickInventory.compatibility.playerOverrides.sorter_1.exemptChecks, ['abuse.inventorySpam']);
assert.deepEqual(withQuickInventory.compatibility.playerOverrides.sorter_1.presets, ['quick-inventory']);

const yaml = renderModPolicyYaml(configured);
assert.match(yaml, /^compatibility:\n/);
assert.match(yaml, /    "alex":\n/);
assert.match(yaml, /name: "Alex: main account"/);
assert.match(yaml, /exemptChecks: \["combat\.autoClicker", "abuse\.inventorySpam"\]/);
assert.match(yaml, /    - permission: "clickinterval\.compat\.inventory"\n/);
assert.match(yaml, /# Advisory: A server cannot independently discover hidden client-only mods\./);
assert.match(yaml, /  allowed: \["mousetweaks", "sodium"\]/);
assert.match(yaml, /  blocked: \["example_cheat"\]/);
assert.equal(yaml.endsWith('\n'), true);

for (const invalid of [
  () => normalizeModPolicyConfig({ compatibility: { playerOverrides: { 'bad player': ['combat.reach'] } } }),
  () => normalizeModPolicyConfig({ compatibility: { playerOverrides: { alex: ['all'] } } }),
  () => normalizeModPolicyConfig({ modPolicy: { blocked: ['bad mod id'] } }),
  () => normalizeModPolicyConfig({ modPolicy: { enforcement: 'ban' } }),
  () => normalizeModPolicyConfig({ modPolicy: { declarationGraceSeconds: 2 } }),
  () => normalizeModPolicyConfig({ modPolicy: { allowed: ['same'], blocked: ['same'] } }),
  () => applyPlayerCompatibilityPreset({}, 'alex', 'unknown-preset')
]) {
  assert.throws(invalid);
}

const pollution = JSON.parse('{"compatibility":{"playerOverrides":{"__proto__":{"exemptChecks":["combat.reach"]}}}}');
assert.throws(() => normalizeModPolicyConfig(pollution));
assert.equal({}.exemptChecks, undefined);
assert.equal(CHECK_IDS.length, 27);
assert(CHECK_IDS.includes('movement.invalidPosition'));
assert(CHECK_IDS.includes('combat.wallHit'));
assert(CHECK_IDS.includes('combat.multiTarget'));
assert(CHECK_IDS.includes('combat.aimDirection'));
assert(CHECK_IDS.includes('combat.killAura'));
assert(CHECK_IDS.includes('combat.clickPattern'));
assert(CHECK_IDS.includes('world.breakReach'));

console.log('PASS minecraft server mod policy tests');
