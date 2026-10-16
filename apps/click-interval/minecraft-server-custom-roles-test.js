'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeAccessConfig,
  accessConfigForUi,
  setRole,
  setAssignment,
  removeRole,
  renderAccessYaml
} = require('./minecraft-server/access-policy');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

const emptyUi = accessConfigForUi(normalizeAccessConfig());
assert.deepEqual(emptyUi.roles, [], 'compatibility owner/admin/member roles must stay out of the editor');

let policy = setRole({}, {
  id: 'event-host',
  name: 'Event Host',
  tradeDiscountPercent: 12,
  capabilities: [
    'player.spectate',
    'player.coordinates',
    'player.dimension',
    'trade.reroll',
    'entity.labels',
    'entity.inspect',
    'entity.edit',
    'server.stop',
    'server.restart'
  ]
}).config;
policy = setAssignment(policy, { player: 'Alex', roleId: 'event-host' }).config;

const visible = accessConfigForUi(policy);
assert.deepEqual(visible.roles.map(role => role.id), ['event-host']);
assert.equal(visible.roles[0].memberCount, 1);
assert.equal(visible.roles[0].tradeDiscountPercent, 12);
assert.equal(visible.assignments[0].roleId, 'event-host');

const yaml = renderAccessYaml(policy);
for (const capability of ['player.coordinates', 'player.dimension', 'trade.reroll', 'entity.labels', 'entity.inspect', 'entity.edit', 'server.stop', 'server.restart']) {
  assert.ok(yaml.includes(`- "${capability}"`), `${capability} should render into runtime access.yml`);
}

const deleted = removeRole(policy, { roleId: 'event-host', removeAssignments: true });
assert.equal(accessConfigForUi(deleted).roles.length, 0);
assert.equal(deleted.assignments.length, 0, 'confirmed deletion must not leave orphan assignments');

const ui = read('minecraft-server-ui.js');
assert.doesNotMatch(ui, /const roles = playerAccess\.roles\.length \? playerAccess\.roles : \[/,
  'assignment picker must not manufacture preset roles');
assert.match(ui, /Create a role before assigning player access/);
assert.match(ui, /delete-access-role[\s\S]*removeAssignments: true/);

const editor = read('player-role-editor.html');
for (const id of ['canViewCoordinates', 'canViewDimension', 'canCycleTrades', 'canShowEntityIds', 'canInspectEntities', 'canEditEntities', 'canStopServer', 'canRestartServer']) {
  assert.match(editor, new RegExp(`id="${id}"`));
}

const fabric = read('minecraft-server/server-protection-fabric/src/main/java/dev/serverprotection/fabric/ServerProtectionFabric.java');
assert.match(fabric, /Commands\.literal\("view"\)[\s\S]*Commands\.literal\("coordinate"\)[\s\S]*Commands\.literal\("dimension"\)/);
assert.match(fabric, /AccessPolicy\.PLAYER_COORDINATES[\s\S]*AccessPolicy\.PLAYER_DIMENSION/);

console.log('PASS custom player roles and scoped server commands');
