'use strict';

const assert = require('assert');
const {
  COMMAND_GROUPS,
  DEFAULT_PLAYER_COMMANDS,
  CAPABILITY_DEFINITIONS,
  MINECRAFT_COLORS,
  normalizeCommandRoot,
  normalizeFormattedText,
  normalizeAccessConfig,
  setAssignment,
  removeAssignment,
  setRole,
  removeRole,
  assignmentHasCapability,
  assignmentCompatibilityRole,
  accessConfigForUi,
  managedRoleTeamId,
  formattedTextComponent,
  buildAccessTeamCommandPlan,
  renderAccessYaml
} = require('./minecraft-server/access-policy');

let assertions = 0;
function equal(actual, expected, message) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}
function throws(action, pattern, message) {
  assertions += 1;
  assert.throws(action, pattern, message);
}

equal(normalizeCommandRoot('/minecraft:KICK'), 'kick', 'namespaced command roots normalize');
equal(normalizeCommandRoot('/example:KICK'), 'example:kick', 'third-party namespaces remain scoped');
equal(COMMAND_GROUPS.protection.commands, ['serverprotection', 'protect'], 'protection group exposes neutral roots');
assert(COMMAND_GROUPS.players.commands.includes('tpa') && COMMAND_GROUPS.players.commands.includes('tpacancel'),
  'players group includes teleport-request commands');
equal(DEFAULT_PLAYER_COMMANDS, [
  'tpa', 'tpaccept', 'tpdeny', 'tpacancel', 'msg', 'tell', 'w', 'whisper', 'bounties', 'setbounty',
  'teams', 'create;team', 'team;invite', 'team;accept', 'team;decline', 'team;leave', 'team;disband'
], 'roleless players receive basic-player, funded-bounty and self-service team roots by default');
for (const root of ['create;team', 'team;invite', 'team;accept', 'team;decline', 'team;leave', 'team;disband']) {
  equal(normalizeCommandRoot('/' + root), root, 'exact team alias is accepted');
}
for (const root of ['team;op', 'create;op', 'minecraft:team;invite', 'team;invite Friend', 'team;invite;op']) {
  throws(() => normalizeCommandRoot(root), /without spaces|Invalid command/i, 'other semicolon routes remain invalid');
}
check(!DEFAULT_PLAYER_COMMANDS.includes('team') && !DEFAULT_PLAYER_COMMANDS.includes('create'),
  'safe team aliases never grant generic vanilla team or create administration');
check(!DEFAULT_PLAYER_COMMANDS.includes('set') && !DEFAULT_PLAYER_COMMANDS.includes('give'),
  'public bounty menus must not grant a generic set root or operator commands');
check(Object.hasOwn(CAPABILITY_DEFINITIONS, 'player.spectate'), 'spectate is a known capability');
for (const capability of ['player.coordinates', 'player.dimension', 'server.stop', 'server.restart']) {
  check(Object.hasOwn(CAPABILITY_DEFINITIONS, capability), `${capability} is a known capability`);
}
check(MINECRAFT_COLORS.includes('dark_aqua'), 'Minecraft team colors are exposed');
throws(() => normalizeCommandRoot('execute run stop'), /without spaces/i, 'arguments are never accepted as custom roots');
equal(normalizeFormattedText('§C[Mod] §LHi'), '§c[Mod] §lHi', 'valid Minecraft formatting codes normalize');
throws(() => normalizeFormattedText('bad §z code', { strict: true }), /formatting code/i, 'unknown formatting codes are rejected');
throws(() => normalizeFormattedText('x'.repeat(33), { strict: true }), /visible characters/i, 'tag text has a visible-length bound');

const empty = normalizeAccessConfig();
equal(empty.version, 2, 'new access configs use schema v2');
equal(normalizeAccessConfig(empty), empty, 'already-normalized configs are reused on permission hot paths');
equal(empty.roles.map((role) => role.id), ['owner', 'admin', 'member'], 'built-in roles always exist in stable order');
check(empty.roles.find((role) => role.id === 'owner').capabilities.includes('protection.bypass'), 'owner always bypasses protection');
equal(empty.roles.find((role) => role.id === 'member').commands.allow, DEFAULT_PLAYER_COMMANDS,
  'the compatibility member role carries the default basic-player commands');
equal(accessConfigForUi(empty).roles, [], 'runtime compatibility roles never appear as preset editor roles');

const migrated = normalizeAccessConfig({
  version: 1,
  updatedAt: '2026-10-04T00:00:00.000Z',
  assignments: [
    { player: 'Owner', role: 'owner', groups: ['server'], commands: ['stop'] },
    { player: 'Mod_One', role: 'admin', groups: ['moderation', 'players'], commands: ['/say', 'minecraft:locate'] },
    { player: 'Mod_Two', role: 'admin', groups: ['world'], commands: ['seed'] },
    { player: 'Builder', role: 'member', groups: ['server'], commands: ['stop'] }
  ]
}, { strict: true });
equal(migrated.version, 2, 'v1 config migrates to v2');
equal(migrated.assignments.find((entry) => entry.player === 'Owner').roleId, 'owner', 'legacy owner maps to built-in owner');
equal(migrated.assignments.find((entry) => entry.player === 'Builder').roleId, 'member', 'legacy member maps to built-in member');
equal(migrated.assignments.find((entry) => entry.player === 'Mod_One').roleId, 'legacy-admin-mod_one', 'legacy admin receives a private deterministic role');
equal(migrated.roles.find((role) => role.id === 'legacy-admin-mod_one').commands, {
  mode: 'allowlist', groups: ['moderation', 'players'], allow: ['say', 'locate'], deny: []
}, 'v1 admin command access migrates exactly');
equal(migrated.roles.find((role) => role.id === 'legacy-admin-mod_two').commands.groups, ['world'], 'different v1 admin scopes do not become coupled');

const migratedUi = accessConfigForUi(migrated);
equal(migratedUi.assignments.find((entry) => entry.player === 'Mod_One').role, 'admin', 'UI keeps the compatibility role field');
equal(migratedUi.assignments.find((entry) => entry.player === 'Mod_One').groups, ['moderation', 'players'], 'UI keeps legacy group fields');
equal(migratedUi.assignments.find((entry) => entry.player === 'Mod_One').commands, ['say', 'locate'], 'UI keeps legacy command fields');
equal(migratedUi.roles, [], 'legacy compatibility roles are not selectable in the UI');
equal(migratedUi.assignments.find((entry) => entry.player === 'Mod_One').roleUnavailable, true, 'legacy assignments are explicitly marked for reassignment');
check(migratedUi.capabilityDefinitions['protection.bypass'], 'UI includes capability definitions');
equal(migratedUi.minecraftColors, MINECRAFT_COLORS, 'UI includes safe Minecraft colors');

let result = setAssignment({}, {
  player: 'Owner', role: 'owner', groups: ['server'], commands: ['stop']
});
equal(result.config.assignments[0], { player: 'Owner', uuid: '', roleId: 'owner' }, 'legacy owner payload remains accepted');

result = setAssignment(result.config, {
  player: 'Mod_One', role: 'admin', groups: ['moderation', 'players'], commands: ['/say', 'minecraft:locate']
});
equal(accessConfigForUi(result.config).assignments.find((entry) => entry.player === 'Mod_One').commands, ['say', 'locate'], 'legacy admin payload remains accepted and normalized');

result = setAssignment(result.config, { player: 'NewOwner', role: 'owner' });
equal(result.replacedOwner, 'Owner', 'setting a new owner reports the replaced owner');
equal(result.config.assignments.filter((entry) => entry.roleId === 'owner').length, 1, 'only one owner remains');
equal(assignmentCompatibilityRole(result.config, 'Owner'), 'admin', 'the previous owner is safely demoted to a scoped admin');
equal(accessConfigForUi(result.config).assignments.find((entry) => entry.player === 'Owner').groups, ['moderation'], 'demoted owner receives the legacy moderation scope');

let custom = setRole(result.config, {
  id: 'guardian',
  name: 'Guardian',
  tradeDiscountPercent: 18,
  capabilities: ['player.spectate', 'player.coordinates', 'player.dimension', 'server.stop', 'server.restart', 'protection.manage', 'protection.bypass'],
  commands: {
    mode: 'allowlist',
    groups: ['moderation'],
    allow: ['say'],
    deny: ['ban']
  },
  appearance: {
    enabled: true,
    prefix: '§b[Guard] §r',
    suffix: ' §7✦',
    color: 'aqua'
  }
});
equal(custom.roleId, 'guardian', 'custom role save reports its id');
const guardian = custom.config.roles.find((role) => role.id === 'guardian');
equal(guardian.capabilities, ['player.spectate', 'player.coordinates', 'player.dimension', 'server.stop', 'server.restart', 'protection.manage', 'protection.bypass'], 'custom capabilities persist');
equal(guardian.commands.deny, ['ban'], 'command deny list persists');
equal(guardian.tradeDiscountPercent, 18, 'custom role villager discount persists');
equal(guardian.appearance, {
  enabled: true, prefix: '§b[Guard] §r', suffix: ' §7✦', color: 'aqua'
}, 'bounded name-tag appearance persists');

result = setAssignment(custom.config, {
  player: 'Guard_One',
  uuid: '123e4567-e89b-42d3-a456-426614174000',
  roleId: 'guardian'
});
equal(result.config.assignments.find((entry) => entry.player === 'Guard_One').roleId, 'guardian', 'role-id assignment works');
equal(accessConfigForUi(result.config).roles.find((role) => role.id === 'guardian').memberCount, 1, 'UI includes custom-role member counts');
check(assignmentHasCapability(result.config, 'guard_one', 'player.spectate'), 'capability lookup is case insensitive by player name');
check(assignmentHasCapability(result.config, 'guard_one', 'player.coordinates'), 'coordinate lookup capability persists');
check(assignmentHasCapability(result.config, 'guard_one', 'player.dimension'), 'dimension lookup capability persists');
check(assignmentHasCapability(result.config, 'guard_one', 'server.stop'), 'server stop capability persists');
check(assignmentHasCapability(result.config, 'guard_one', 'server.restart'), 'server restart capability persists');
check(assignmentHasCapability(result.config, '123e4567-e89b-42d3-a456-426614174000', 'protection.bypass'), 'capability lookup supports UUID');
equal(assignmentHasCapability(result.config, { player: 'NotAssigned', roleId: 'owner' }, 'protection.bypass'), false, 'capability lookup never trusts an unassigned claimed role ID');
equal(assignmentCompatibilityRole(result.config, 'Guard_One'), 'admin', 'capable custom role has a safe legacy admin projection');

const yaml = renderAccessYaml(result.config);
check(yaml.includes('version: 2'), 'generated runtime config declares v2');
check(yaml.includes('id: "guardian"'), 'generated runtime config includes role definitions');
check(yaml.includes('roleId: "guardian"'), 'generated runtime config includes assignment role IDs');
check(yaml.includes('role: admin'), 'generated runtime config retains compatibility role fields');
check(yaml.includes('prefix: "§b[Guard] §r"'), 'generated runtime config includes formatted tag appearance');
check(yaml.includes('tradeDiscountPercent: 18'), 'generated runtime config includes the role trade discount');
const assignmentYaml = yaml.slice(yaml.indexOf('assignments:'));
check(assignmentYaml.includes('      - "kick"') && !assignmentYaml.includes('      - "ban"'), 'legacy projection expands a partially denied group without granting its denied command');
check(assignmentYaml.includes('      - "serverprotection"'), 'manage-protection capability projects its command for old adapters');
check(assignmentYaml.includes('      - "stop"') && assignmentYaml.includes('      - "restart"'), 'server lifecycle capabilities project their command roots');
check(assignmentYaml.includes('      - "ci-spectate"') && assignmentYaml.includes('      - "ci-unspectate"'),
  'player-view capability projects the non-conflicting command aliases');
check(assignmentYaml.includes('      - "view"'),
  'coordinate and dimension capabilities project their shared command root');

const guardianTeam = managedRoleTeamId('guardian');
equal(guardianTeam, managedRoleTeamId('guardian'), 'managed role team IDs are deterministic');
check(guardianTeam.length <= 16 && guardianTeam.startsWith('ci_r_'), 'managed role team IDs satisfy Minecraft bounds');
check(managedRoleTeamId('guardian') !== managedRoleTeamId('builder'), 'different role IDs receive different managed team IDs');
equal(formattedTextComponent('§b[Guard] §lHi§r!'), {
  text: '',
  extra: [
    { text: '[Guard] ', color: 'aqua' },
    { text: 'Hi', color: 'aqua', bold: true },
    { text: '!' }
  ]
}, 'legacy role formatting becomes safe structured text components');
const teamPlan = buildAccessTeamCommandPlan(result.config, {
  onlinePlayers: ['Guard_One', 'PlainPlayer'],
  pvpEnabled: false,
  pvpTeamId: 'asm_pve'
});
check(teamPlan.commands.includes(`team modify ${guardianTeam} friendlyFire false`), 'styled role teams inherit the PvP setting');
check(teamPlan.commands.includes(`team join ${guardianTeam} Guard_One`), 'styled player joins the managed role team');
check(teamPlan.commands.includes('team join asm_pve PlainPlayer'), 'unstyled player remains covered by the PvP fallback team');
check(!teamPlan.commands.includes('team join asm_pve Guard_One'), 'styled player is never moved into the fallback team');
check(!teamPlan.commands.some((command) => command.includes('@a')), 'team plans never use a broad player selector');
const disabledGuardian = setRole(result.config, {
  id: 'guardian',
  appearance: { enabled: false, prefix: '', suffix: '', color: 'white' }
}).config;
const cleanupPlan = buildAccessTeamCommandPlan(disabledGuardian, {
  previousConfig: result.config,
  onlinePlayers: ['Guard_One'],
  pvpEnabled: true
});
check(cleanupPlan.commands.includes(`team remove ${guardianTeam}`), 'disabling a role tag removes only its deterministic managed team');
const rememberedCleanupPlan = buildAccessTeamCommandPlan(disabledGuardian, {
  previousTeamIds: [guardianTeam, 'ci_r_not-allowed', '../scoreboard'],
  onlinePlayers: [],
  pvpEnabled: true
});
check(rememberedCleanupPlan.commands.includes(`team remove ${guardianTeam}`), 'remembered managed teams are removed after an offline role change');
check(!rememberedCleanupPlan.commands.some(command => command.includes('not-allowed') || command.includes('scoreboard')), 'unsafe remembered team ids are ignored');

throws(() => removeRole(result.config, 'guardian'), /Reassign.*before deleting/i, 'an assigned role cannot disappear silently');
const reassigned = removeRole(result.config, { roleId: 'guardian', reassignRoleId: 'member' });
equal(reassigned.roles.some((role) => role.id === 'guardian'), false, 'custom role can be deleted with explicit reassignment');
equal(reassigned.assignments.find((entry) => entry.player === 'Guard_One').roleId, 'member', 'role deletion applies the requested replacement');
const removedWithAssignments = removeRole(result.config, { roleId: 'guardian', removeAssignments: true });
equal(removedWithAssignments.roles.some((role) => role.id === 'guardian'), false, 'explicit delete removes a custom role');
equal(removedWithAssignments.assignments.some((entry) => entry.player === 'Guard_One'), false, 'explicit delete also removes assigned access entries');
throws(() => removeRole(reassigned, 'owner'), /Built-in roles/i, 'built-in roles cannot be deleted');

const removed = removeAssignment(result.config, 'guard_one');
equal(removed.assignments.some((entry) => entry.player === 'Guard_One'), false, 'assignment removal is case insensitive');
throws(() => setAssignment({}, { player: 'Bad Name', role: 'admin' }), /valid Minecraft player name/i, 'invalid names are rejected');
throws(() => setAssignment({}, { player: 'Admin', role: 'admin', groups: ['unknown'] }), /unknown command group/i, 'unknown groups are rejected');
throws(() => setAssignment({}, { player: 'Admin', roleId: 'missing' }), /unknown access role/i, 'orphan role assignments are rejected');
throws(() => setRole({}, { id: 'Bad Role', name: 'Bad' }), /Role IDs/i, 'unsafe role IDs are rejected');
throws(() => setRole({}, { id: 'owner', name: 'Not a preset' }), /reserved for runtime compatibility/i, 'compatibility IDs cannot become selectable roles');
throws(() => setRole({}, { id: 'legacy-admin-fake', name: 'Reserved' }), /reserved/i, 'migration role namespace is reserved');
throws(() => setRole({}, { id: 'badcap', name: 'Bad capability', capabilities: ['server.root'] }), /Unknown role capability/i, 'unknown capabilities are rejected');
throws(() => setRole({}, { id: 'badcolor', name: 'Bad color', appearance: { color: '#abcdef' } }), /valid Minecraft name color/i, 'arbitrary tag colors are rejected');
throws(() => setRole({}, { id: 'badname', name: 'Bad\nName' }), /control characters/i, 'role names cannot inject terminal or command controls');
throws(() => setRole({}, { id: 'baddiscount', name: 'Bad discount', tradeDiscountPercent: 56 }), /0 to 55/i, 'trade discounts are bounded');
throws(() => setRole({}, { id: 'fractiondiscount', name: 'Fraction discount', tradeDiscountPercent: 4.5 }), /whole percentage/i, 'trade discounts must be whole percentages');
throws(() => setRole({}, { id: 'longname', name: 'x'.repeat(41) }), /at most 40/i, 'role names have a strict character bound');
throws(() => setRole({}, { id: 'badcommand', name: 'Bad command', commands: { allow: ['execute run stop'] } }), /without spaces/i, 'role commands remain roots only');

const malformed = normalizeAccessConfig({
  assignments: [
    { player: 'Safe', role: 'admin', groups: ['moderation'], commands: [] },
    { player: '../bad', role: 'owner' }
  ]
});
equal(malformed.assignments.map((entry) => entry.player), ['Safe'], 'invalid v1 stored entries are ignored in recovery mode');
throws(() => normalizeAccessConfig({ assignments: [{ player: '../bad', role: 'owner' }] }, { strict: true }), /valid Minecraft player name/i, 'strict v1 config rejects corruption');
throws(() => normalizeAccessConfig({
  version: 2,
  roles: [],
  assignments: [{ player: 'Alex', roleId: 'missing' }]
}, { strict: true }), /unknown access role/i, 'strict v2 config rejects orphan assignments');
throws(() => normalizeAccessConfig({
  version: 2,
  roles: [],
  assignments: [
    { player: 'One', roleId: 'owner' },
    { player: 'Two', roleId: 'owner' }
  ]
}, { strict: true }), /Only one owner/i, 'strict v2 config rejects multiple owners');
throws(() => normalizeAccessConfig({
  assignments: Array.from({ length: 257 }, (_, index) => ({ player: `P${index}`, role: 'member' }))
}, { strict: true }), /At most 256/i, 'assignment count is bounded');
throws(() => normalizeAccessConfig({
  version: 2,
  roles: Array.from({ length: 65 }, (_, index) => ({ id: `role-${index}`, name: `Role ${index}` })),
  assignments: []
}, { strict: true }), /At most 64 custom/i, 'custom role count is bounded for the editor and selectors');
equal(normalizeAccessConfig({
  assignments: Array.from({ length: 65 }, (_, index) => ({ player: `Admin${index}`, role: 'admin' }))
}, { strict: true }).assignments.length, 65, 'the custom-role cap does not lose exact legacy per-admin migrations');

console.log(`PASS Minecraft server access policy (${assertions} assertions)`);
