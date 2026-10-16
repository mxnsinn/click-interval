'use strict';

const crypto = require('crypto');

const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;
const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const COMMAND_ROOT_PATTERN = /^(?:[a-z0-9._-]+:)?[a-z0-9._-]{1,64}$/;
const TEAM_COMMAND_ALIASES = new Set([
  'create;team', 'team;invite', 'team;accept', 'team;decline', 'team;leave', 'team;disband'
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ASSIGNMENTS = 256;
const MAX_CUSTOM_ROLES = 64;
const MAX_ROLES = MAX_ASSIGNMENTS + MAX_CUSTOM_ROLES + 3;
const MAX_COMMANDS_PER_ROLE = 64;
const MAX_FORMATTED_TEXT_LENGTH = 128;
const MAX_FORMATTED_VISIBLE_LENGTH = 32;
const MAX_TRADE_DISCOUNT_PERCENT = 55;
const LEGACY_ADMIN_PREFIX = 'legacy-admin-';
const DEFAULT_PLAYER_COMMANDS = Object.freeze([
  'tpa', 'tpaccept', 'tpdeny', 'tpacancel',
  'msg', 'tell', 'w', 'whisper', 'bounties', 'setbounty',
  'teams', ...TEAM_COMMAND_ALIASES
]);
const NORMALIZED_ACCESS_CONFIGS = new WeakSet();
const ACCESS_CONFIG_INDEXES = new WeakMap();

const COMMAND_GROUPS = Object.freeze({
  moderation: Object.freeze({
    label: 'Moderation',
    commands: Object.freeze(['kick', 'ban', 'ban-ip', 'pardon', 'pardon-ip', 'whitelist'])
  }),
  players: Object.freeze({
    label: 'Players',
    commands: Object.freeze([
      'teleport', 'tp', 'gamemode', 'give', 'clear', 'effect', 'experience', 'xp',
      'tpa', 'tpaccept', 'tpdeny', 'tpacancel'
    ])
  }),
  world: Object.freeze({
    label: 'World',
    commands: Object.freeze(['time', 'weather', 'difficulty', 'gamerule', 'setworldspawn', 'spawnpoint'])
  }),
  server: Object.freeze({
    label: 'Server',
    commands: Object.freeze(['stop', 'reload', 'save-all', 'save-off', 'save-on'])
  }),
  protection: Object.freeze({
    label: 'Protection',
    commands: Object.freeze(['serverprotection', 'protect'])
  })
});
const COMMAND_CATALOG = Object.freeze([...new Set([
  ...DEFAULT_PLAYER_COMMANDS,
  'help', 'list', 'me', 'seed', 'version', 'plugins', 'locate', 'locatebiome', 'say',
  'teleport', 'tp', 'gamemode', 'give', 'clear', 'effect', 'experience', 'xp',
  'item', 'kill', 'ride', 'summon', 'spreadplayers', 'fill', 'clone', 'setblock',
  'time', 'weather', 'difficulty', 'gamerule', 'setworldspawn', 'spawnpoint',
  'kick', 'ban', 'ban-ip', 'pardon', 'pardon-ip', 'whitelist', 'op', 'deop',
  'stop', 'reload', 'save-all', 'save-off', 'save-on', 'function', 'execute',
  'scoreboard', 'team', 'data', 'tag', 'bossbar', 'tellraw', 'title', 'playsound',
  'particle', 'recipe', 'advancement', 'attribute', 'debug', 'spectate', 'damage',
  'datapack', 'defaultgamemode', 'enchant', 'forceload', 'jfr', 'loot', 'perf',
  'place', 'publish', 'return', 'schedule', 'setidletimeout', 'teammsg', 'trigger',
  'transfer', 'waypoint', 'worldborder', 'spark',
  'serverprotection', 'protect', 'serverteleport', 'ci-spectate', 'ci-unspectate',
  'unspectate', 'view', 'entityadmin', 'entityids', 'tradeassistant', 'tradecycle',
  'cycletrades'
])].sort());

const CAPABILITY_DEFINITIONS = Object.freeze({
  'player.spectate': Object.freeze({
    label: 'View players',
    description: 'Use /ci-spectate and /ci-unspectate without replacing Minecraft\'s vanilla /spectate command.'
  }),
  'player.coordinates': Object.freeze({
    label: 'View coordinates',
    description: 'Use /view coordinate to check another player\'s position.'
  }),
  'player.dimension': Object.freeze({
    label: 'View dimensions',
    description: 'Use /view dimension to check which world another player is in.'
  }),
  'trade.reroll': Object.freeze({
    label: 'Cycle villager trades',
    description: 'Use the Trade Assistant cycle button before a villager trade is locked.'
  }),
  'entity.labels': Object.freeze({
    label: 'Show entity IDs',
    description: 'Toggle local entity ID labels in the client companion.'
  }),
  'entity.inspect': Object.freeze({
    label: 'Inspect entities',
    description: 'View loaded entity details and villager offers in Entity Viewer; /entityadmin shows where to find it.'
  }),
  'entity.edit': Object.freeze({
    label: 'Edit entities',
    description: 'Change supported villager offers and bounded age or breeding cooldown values.'
  }),
  'server.stop': Object.freeze({
    label: 'Stop server',
    description: 'Run the server stop command.'
  }),
  'server.restart': Object.freeze({
    label: 'Restart server',
    description: 'Run the restart command when the selected server software provides it.'
  }),
  'protection.manage': Object.freeze({
    label: 'Manage protection',
    description: 'View, reload, and manage Server Protection in game.'
  }),
  'protection.bypass': Object.freeze({
    label: 'Bypass protection',
    description: 'Skip all built-in protection checks for players with this role.'
  })
});

const MINECRAFT_COLORS = Object.freeze([
  'black', 'dark_blue', 'dark_green', 'dark_aqua',
  'dark_red', 'dark_purple', 'gold', 'gray',
  'dark_gray', 'blue', 'green', 'aqua',
  'red', 'light_purple', 'yellow', 'white'
]);
const MINECRAFT_COLOR_SET = new Set(MINECRAFT_COLORS);
const FORMAT_CODE_PATTERN = /^[0-9a-fk-or]$/i;
const BUILT_IN_ROLE_IDS = new Set(['owner', 'admin', 'member']);
const LEGACY_COLOR_CODES = Object.freeze({
  0: 'black', 1: 'dark_blue', 2: 'dark_green', 3: 'dark_aqua',
  4: 'dark_red', 5: 'dark_purple', 6: 'gold', 7: 'gray',
  8: 'dark_gray', 9: 'blue', a: 'green', b: 'aqua',
  c: 'red', d: 'light_purple', e: 'yellow', f: 'white'
});

const BUILT_IN_ROLE_TEMPLATES = Object.freeze({
  owner: Object.freeze({
    id: 'owner',
    name: 'Owner',
    capabilities: Object.freeze(['player.spectate', 'protection.manage', 'protection.bypass']),
    commands: Object.freeze({ mode: 'all', groups: Object.freeze([]), allow: Object.freeze([]), deny: Object.freeze([]) })
  }),
  admin: Object.freeze({
    id: 'admin',
    name: 'Admin',
    capabilities: Object.freeze(['player.spectate']),
    commands: Object.freeze({ mode: 'allowlist', groups: Object.freeze(['moderation']), allow: Object.freeze([]), deny: Object.freeze([]) })
  }),
  member: Object.freeze({
    id: 'member',
    name: 'Member',
    capabilities: Object.freeze([]),
    commands: Object.freeze({
      mode: 'allowlist',
      groups: Object.freeze([]),
      allow: DEFAULT_PLAYER_COMMANDS,
      deny: Object.freeze([])
    })
  })
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePlayerName(value) {
  const player = String(value || '').trim();
  if (!PLAYER_NAME_PATTERN.test(player)) throw new Error('Enter a valid Minecraft player name.');
  return player;
}

function normalizePlayerUuid(value, options = {}) {
  const uuid = String(value || '').trim().toLowerCase();
  if (!uuid) return '';
  if (!UUID_PATTERN.test(uuid)) {
    if (options.strict === true) throw new Error('Enter a valid Minecraft player UUID.');
    return '';
  }
  return uuid;
}

function normalizeRoleId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!ROLE_ID_PATTERN.test(id)) {
    throw new Error('Role IDs must use lowercase letters, numbers, dots, dashes, or underscores.');
  }
  return id;
}

function roleIdFromName(value) {
  const id = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 32);
  return normalizeRoleId(id || 'role');
}

function normalizeRoleName(value, fallback = '', options = {}) {
  const strict = options.strict === true;
  const source = String(value || fallback || '').trim();
  const characters = Array.from(source);
  if (strict && characters.length > 40) throw new Error('Role names must be at most 40 characters.');
  const output = [];
  for (const character of characters) {
    if (/[\u0000-\u001f\u007f]/u.test(character)) {
      if (strict) throw new Error('Role names cannot contain control characters.');
      continue;
    }
    if (output.length >= 40) break;
    output.push(character);
  }
  const name = output.join('').trim();
  if (!name) throw new Error('Enter a role name.');
  return name;
}

function normalizeCommandRoot(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^\/+/, '');
  if (TEAM_COMMAND_ALIASES.has(raw)) return raw;
  if (!raw || /\s/.test(raw) || !COMMAND_ROOT_PATTERN.test(raw)) {
    throw new Error('Custom commands must be command names only, without spaces or arguments.');
  }
  const separator = raw.indexOf(':');
  const namespace = separator >= 0 ? raw.slice(0, separator) : '';
  const command = separator >= 0 ? raw.slice(separator + 1) : raw;
  const root = namespace === 'minecraft' || namespace === 'bukkit' ? command : raw;
  if (!root || !COMMAND_ROOT_PATTERN.test(root)) throw new Error('Invalid command name.');
  return root;
}

function normalizeStringList(value, normalizer, maximum, options = {}) {
  const output = [];
  const seen = new Set();
  const candidates = Array.isArray(value) ? value : [];
  if (options.strict === true && candidates.length > maximum) {
    throw new Error(`At most ${maximum} ${options.label || 'entries'} are supported.`);
  }
  for (const candidate of candidates) {
    let normalized;
    try {
      normalized = normalizer(candidate);
    } catch (error) {
      if (options.strict === true) throw error;
      continue;
    }
    const key = String(normalized).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maximum) break;
  }
  return output;
}

function normalizeFormattedText(value, options = {}) {
  const strict = options.strict === true;
  const source = String(value || '');
  if (strict && source.length > MAX_FORMATTED_TEXT_LENGTH) {
    throw new Error(`Role tag text must be at most ${MAX_FORMATTED_TEXT_LENGTH} characters including formatting.`);
  }
  const characters = Array.from(source);
  const output = [];
  let visible = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === '§') {
      const code = characters[index + 1];
      if (!code || !FORMAT_CODE_PATTERN.test(code)) {
        if (strict) throw new Error('Role tag text contains an invalid Minecraft formatting code.');
        continue;
      }
      if (output.join('').length + 2 > MAX_FORMATTED_TEXT_LENGTH) break;
      output.push(`§${code.toLowerCase()}`);
      index += 1;
      continue;
    }
    if (/[\u0000-\u001f\u007f]/u.test(character)) {
      if (strict && !/\s/u.test(character)) throw new Error('Role tag text contains an unsupported control character.');
      if (/\s/u.test(character) && visible < MAX_FORMATTED_VISIBLE_LENGTH) {
        output.push(' ');
        visible += 1;
      }
      continue;
    }
    if (visible >= MAX_FORMATTED_VISIBLE_LENGTH || output.join('').length + character.length > MAX_FORMATTED_TEXT_LENGTH) {
      if (strict) throw new Error(`Role tag text must contain at most ${MAX_FORMATTED_VISIBLE_LENGTH} visible characters.`);
      break;
    }
    output.push(character);
    visible += 1;
  }
  return output.join('');
}

function normalizeAppearance(value = {}, options = {}) {
  const source = isRecord(value) ? value : {};
  const color = String(source.color || 'white').trim().toLowerCase();
  if (!MINECRAFT_COLOR_SET.has(color) && options.strict === true) {
    throw new Error('Choose a valid Minecraft name color.');
  }
  return {
    enabled: Boolean(source.enabled),
    prefix: normalizeFormattedText(source.prefix, options),
    suffix: normalizeFormattedText(source.suffix, options),
    color: MINECRAFT_COLOR_SET.has(color) ? color : 'white'
  };
}

function normalizeTradeDiscountPercent(value, options = {}) {
  const raw = value === undefined || value === null || value === '' ? 0 : Number(value);
  if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0 || raw > MAX_TRADE_DISCOUNT_PERCENT) {
    if (options.strict === true) {
      throw new Error(`Villager trade discounts must be a whole percentage from 0 to ${MAX_TRADE_DISCOUNT_PERCENT}.`);
    }
    return 0;
  }
  return raw;
}

function normalizeCapabilities(value, options = {}) {
  return normalizeStringList(value, (candidate) => {
    const id = String(candidate || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(CAPABILITY_DEFINITIONS, id)) {
      throw new Error(`Unknown role capability: ${id || '(blank)'}.`);
    }
    return id;
  }, Object.keys(CAPABILITY_DEFINITIONS).length, { ...options, label: 'role capabilities' });
}

function normalizeCommandGroups(value, options = {}) {
  return normalizeStringList(value, (candidate) => {
    const id = String(candidate || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(COMMAND_GROUPS, id)) {
      throw new Error(`Unknown command group: ${id || '(blank)'}.`);
    }
    return id;
  }, Object.keys(COMMAND_GROUPS).length, { ...options, label: 'command groups' });
}

function normalizeRoleCommands(value = {}, options = {}) {
  const source = isRecord(value) ? value : {};
  const mode = String(source.mode || options.defaultMode || 'allowlist').trim().toLowerCase();
  if (!['all', 'allowlist'].includes(mode) && options.strict === true) {
    throw new Error('Command access mode must be all or allowlist.');
  }
  return {
    mode: ['all', 'allowlist'].includes(mode) ? mode : 'allowlist',
    groups: normalizeCommandGroups(source.groups, options),
    allow: normalizeStringList(source.allow, normalizeCommandRoot, MAX_COMMANDS_PER_ROLE, {
      ...options,
      label: 'allowed commands'
    }),
    deny: normalizeStringList(source.deny, normalizeCommandRoot, MAX_COMMANDS_PER_ROLE, {
      ...options,
      label: 'denied commands'
    })
  };
}

function roleTemplate(id) {
  const template = BUILT_IN_ROLE_TEMPLATES[id];
  if (!template) return null;
  return {
    id: template.id,
    name: template.name,
    capabilities: [...template.capabilities],
    commands: {
      mode: template.commands.mode,
      groups: [...template.commands.groups],
      allow: [...template.commands.allow],
      deny: [...template.commands.deny]
    },
    appearance: { enabled: false, prefix: '', suffix: '', color: 'white' },
    tradeDiscountPercent: 0
  };
}

function normalizeRole(value = {}, options = {}) {
  const source = isRecord(value) ? value : {};
  const id = normalizeRoleId(source.id || roleIdFromName(source.name));
  const template = roleTemplate(id);
  const strict = options.strict === true;
  const name = normalizeRoleName(source.name, template?.name || id, { strict });
  if (id.startsWith(LEGACY_ADMIN_PREFIX) && !options.allowLegacy && !source.legacy) {
    throw new Error('That role ID is reserved for migrated access entries.');
  }
  const commandSource = isRecord(source.commands)
    ? source.commands
    : {
        mode: source.commandMode,
        groups: source.groups,
        allow: source.allow,
        deny: source.deny
      };
  const defaults = template || {
    capabilities: [],
    commands: { mode: 'allowlist', groups: [], allow: [], deny: [] },
    appearance: { enabled: false, prefix: '', suffix: '', color: 'white' },
    tradeDiscountPercent: 0
  };
  let capabilities = normalizeCapabilities(
    Object.prototype.hasOwnProperty.call(source, 'capabilities') ? source.capabilities : defaults.capabilities,
    { strict }
  );
  const commands = normalizeRoleCommands(
    Object.keys(commandSource).some((key) => commandSource[key] !== undefined) ? commandSource : defaults.commands,
    { strict, defaultMode: defaults.commands.mode }
  );
  if (id === 'member') {
    commands.allow = [...new Set([...DEFAULT_PLAYER_COMMANDS, ...commands.allow])];
  }
  if (id === 'owner') {
    capabilities = [...new Set([...capabilities, 'player.spectate', 'protection.manage', 'protection.bypass'])];
    commands.mode = 'all';
    commands.groups = [];
    commands.allow = [];
    commands.deny = [];
  }
  return {
    id,
    name,
    builtIn: BUILT_IN_ROLE_IDS.has(id),
    legacy: Boolean(source.legacy && id.startsWith(LEGACY_ADMIN_PREFIX)),
    capabilities,
    commands,
    tradeDiscountPercent: BUILT_IN_ROLE_IDS.has(id) || Boolean(source.legacy && id.startsWith(LEGACY_ADMIN_PREFIX))
      ? 0
      : normalizeTradeDiscountPercent(source.tradeDiscountPercent, { strict }),
    appearance: normalizeAppearance(
      Object.prototype.hasOwnProperty.call(source, 'appearance') ? source.appearance : defaults.appearance,
      { strict }
    )
  };
}

function defaultRoles() {
  return ['owner', 'admin', 'member'].map((id) => normalizeRole(roleTemplate(id)));
}

function normalizeLegacyAssignment(value = {}, options = {}) {
  const source = isRecord(value) ? value : {};
  const player = normalizePlayerName(source.player);
  const role = String(source.role || 'member').trim().toLowerCase();
  if (!BUILT_IN_ROLE_IDS.has(role)) throw new Error('Role must be owner, admin, or member.');
  const groups = role === 'admin' ? normalizeCommandGroups(source.groups, options) : [];
  const commands = role === 'admin'
    ? normalizeStringList(source.commands, normalizeCommandRoot, 32, { ...options, label: 'custom commands' })
    : [];
  return {
    player,
    uuid: normalizePlayerUuid(source.uuid, options),
    role,
    groups,
    commands
  };
}

function legacyAdminRole(assignment) {
  const player = normalizePlayerName(assignment.player);
  return normalizeRole({
    id: `${LEGACY_ADMIN_PREFIX}${player.toLowerCase()}`,
    name: `Admin · ${player}`,
    legacy: true,
    capabilities: ['player.spectate'],
    commands: {
      mode: 'allowlist',
      groups: assignment.groups,
      allow: assignment.commands,
      deny: []
    }
  }, { strict: true, allowLegacy: true });
}

function roleMap(config) {
  if (NORMALIZED_ACCESS_CONFIGS.has(config)) return accessConfigIndexes(config).rolesById;
  return new Map((Array.isArray(config?.roles) ? config.roles : []).map((role) => [String(role.id), role]));
}

function roleForAssignment(config, assignment) {
  if (!assignment) return null;
  return roleMap(config).get(String(assignment.roleId || '')) || null;
}

function compatibilityRoleForRole(role) {
  if (!role) return 'member';
  if (role.id === 'owner') return 'owner';
  if (role.id === 'member') return 'member';
  if (role.commands.mode === 'all' || role.commands.groups.length || role.commands.allow.length || role.capabilities.length) {
    return 'admin';
  }
  return 'member';
}

function capabilityCommandRoots(role) {
  const commands = [];
  if (role?.capabilities?.includes('protection.manage')) commands.push('serverprotection', 'protect');
  if (role?.capabilities?.includes('player.spectate')) commands.push('ci-spectate', 'ci-unspectate', 'unspectate');
  if (role?.capabilities?.includes('player.coordinates') || role?.capabilities?.includes('player.dimension')) commands.push('view');
  if (role?.capabilities?.includes('server.stop')) commands.push('stop');
  if (role?.capabilities?.includes('server.restart')) commands.push('restart');
  if (role?.capabilities?.includes('trade.reroll')) commands.push('tradeassistant', 'tradecycle', 'cycletrades');
  if (role?.capabilities?.includes('entity.labels')) commands.push('entityids');
  if (role?.capabilities?.includes('entity.inspect') || role?.capabilities?.includes('entity.edit')) commands.push('entityadmin');
  return commands;
}

function compatibilityCommandFields(role) {
  const compatibilityRole = compatibilityRoleForRole(role);
  if (!role || compatibilityRole !== 'admin' || role.commands.mode === 'all') {
    return { role: compatibilityRole, groups: [], commands: [] };
  }
  const denied = new Set(role.commands.deny);
  const groups = [];
  const commands = [];
  const seen = new Set();
  const addCommand = (command) => {
    const deniedByLegacyAlias = (command === 'ci-spectate' && denied.has('spectate'))
      || ((command === 'ci-unspectate' || command === 'unspectate') && denied.has('unspectate'));
    if (!command || denied.has(command) || deniedByLegacyAlias || seen.has(command)) return;
    seen.add(command);
    commands.push(command);
  };
  for (const group of role.commands.groups) {
    const groupCommands = COMMAND_GROUPS[group]?.commands || [];
    if (!groupCommands.some((command) => denied.has(command))) groups.push(group);
    else groupCommands.forEach(addCommand);
  }
  role.commands.allow.forEach(addCommand);
  capabilityCommandRoots(role).forEach(addCommand);
  return { role: compatibilityRole, groups, commands };
}

function normalizeV1Config(source, options = {}) {
  const strict = options.strict === true;
  const roles = defaultRoles();
  const rolesById = new Map(roles.map((role) => [role.id, role]));
  const byPlayer = new Map();
  const candidates = Array.isArray(source.assignments) ? source.assignments : [];
  if (strict && candidates.length > MAX_ASSIGNMENTS) {
    throw new Error(`At most ${MAX_ASSIGNMENTS} player access entries are supported.`);
  }
  for (const candidate of candidates.slice(0, MAX_ASSIGNMENTS)) {
    let legacy;
    try {
      legacy = normalizeLegacyAssignment(candidate, { strict });
    } catch (error) {
      if (strict) throw error;
      continue;
    }
    let roleId = legacy.role;
    if (legacy.role === 'admin') {
      const migrated = legacyAdminRole(legacy);
      rolesById.set(migrated.id, migrated);
      roleId = migrated.id;
    }
    const key = legacy.player.toLowerCase();
    if (strict && byPlayer.has(key)) throw new Error(`Duplicate player access entry: ${legacy.player}.`);
    byPlayer.set(key, { player: legacy.player, uuid: legacy.uuid, roleId });
  }
  return finalizeConfig({
    roles: [...rolesById.values()],
    assignments: [...byPlayer.values()],
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : ''
  }, { strict });
}

function normalizeV2Assignment(value, rolesById, options = {}) {
  const source = isRecord(value) ? value : {};
  const player = normalizePlayerName(source.player);
  let roleId = String(source.roleId || '').trim().toLowerCase();
  if (!roleId && source.role) roleId = String(source.role).trim().toLowerCase();
  roleId = normalizeRoleId(roleId || 'member');
  if (!rolesById.has(roleId)) throw new Error(`Unknown access role: ${roleId}.`);
  return {
    player,
    uuid: normalizePlayerUuid(source.uuid, options),
    roleId
  };
}

function finalizeConfig(value = {}, options = {}) {
  const strict = options.strict === true;
  const roleCandidates = Array.isArray(value.roles) ? value.roles : [];
  if (strict && roleCandidates.length > MAX_ROLES) throw new Error(`At most ${MAX_ROLES} access roles are supported.`);
  const rolesById = new Map();
  let customRoleCount = 0;
  for (const builtIn of defaultRoles()) rolesById.set(builtIn.id, builtIn);
  for (const candidate of roleCandidates.slice(0, MAX_ROLES)) {
    let role;
    try {
      role = normalizeRole(candidate, { strict, allowLegacy: true });
    } catch (error) {
      if (strict) throw error;
      continue;
    }
    if (strict && rolesById.has(role.id) && !BUILT_IN_ROLE_IDS.has(role.id)) {
      throw new Error(`Duplicate access role: ${role.id}.`);
    }
    const isNewCustomRole = !rolesById.has(role.id) && !role.builtIn && !role.legacy;
    if (isNewCustomRole && customRoleCount >= MAX_CUSTOM_ROLES) {
      if (strict) throw new Error(`At most ${MAX_CUSTOM_ROLES} custom access roles are supported.`);
      continue;
    }
    if (isNewCustomRole) customRoleCount += 1;
    rolesById.set(role.id, role);
  }

  const candidates = Array.isArray(value.assignments) ? value.assignments : [];
  if (strict && candidates.length > MAX_ASSIGNMENTS) {
    throw new Error(`At most ${MAX_ASSIGNMENTS} player access entries are supported.`);
  }
  const byPlayer = new Map();
  const byUuid = new Map();
  for (const candidate of candidates.slice(0, MAX_ASSIGNMENTS)) {
    let assignment;
    try {
      assignment = normalizeV2Assignment(candidate, rolesById, { strict });
    } catch (error) {
      if (strict) throw error;
      continue;
    }
    const playerKey = assignment.player.toLowerCase();
    if (strict && byPlayer.has(playerKey)) throw new Error(`Duplicate player access entry: ${assignment.player}.`);
    if (assignment.uuid && strict && byUuid.has(assignment.uuid) && byUuid.get(assignment.uuid) !== playerKey) {
      throw new Error(`Duplicate Minecraft UUID in player access: ${assignment.uuid}.`);
    }
    const previous = byPlayer.get(playerKey);
    if (previous?.uuid) byUuid.delete(previous.uuid);
    byPlayer.set(playerKey, assignment);
    if (assignment.uuid) byUuid.set(assignment.uuid, playerKey);
  }

  const assignments = [];
  let owner = '';
  for (const [key, assignment] of byPlayer) {
    if (assignment.roleId === 'owner' && owner && owner !== key) {
      if (strict) throw new Error('Only one owner can be assigned.');
      continue;
    }
    if (assignment.roleId === 'owner') owner = key;
    assignments.push(assignment);
  }
  const roleRank = (role) => role.id === 'owner' ? 0 : role.id === 'admin' ? 1 : role.id === 'member' ? 2 : 3;
  const roles = [...rolesById.values()].sort((left, right) =>
    roleRank(left) - roleRank(right) || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id));
  assignments.sort((left, right) => {
    const leftRole = compatibilityRoleForRole(rolesById.get(left.roleId));
    const rightRole = compatibilityRoleForRole(rolesById.get(right.roleId));
    const rank = { owner: 0, admin: 1, member: 2 };
    return rank[leftRole] - rank[rightRole] || left.player.localeCompare(right.player, undefined, { sensitivity: 'base' });
  });
  const config = {
    version: 2,
    roles,
    assignments,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : ''
  };
  NORMALIZED_ACCESS_CONFIGS.add(config);
  return config;
}

function normalizeAccessConfig(value = {}, options = {}) {
  if (NORMALIZED_ACCESS_CONFIGS.has(value)) return value;
  const source = isRecord(value) ? value : {};
  if (Number(source.version) < 2 || !Array.isArray(source.roles)) return normalizeV1Config(source, options);
  return finalizeConfig(source, options);
}

function normalizeAssignment(value = {}, config = normalizeAccessConfig(), options = {}) {
  const current = normalizeAccessConfig(config);
  const rolesById = roleMap(current);
  if (isRecord(value) && value.roleId) return normalizeV2Assignment(value, rolesById, { strict: options.strict === true });
  const legacy = normalizeLegacyAssignment(value, { strict: options.strict === true });
  return {
    player: legacy.player,
    uuid: legacy.uuid,
    roleId: legacy.role
  };
}

function pruneUnusedLegacyRoles(config) {
  const used = new Set(config.assignments.map((assignment) => assignment.roleId));
  return {
    ...config,
    roles: config.roles.filter((role) => !role.legacy || used.has(role.id))
  };
}

function updatedConfig(value) {
  return normalizeAccessConfig({ ...value, version: 2, updatedAt: new Date().toISOString() });
}

function setAssignment(config, value) {
  const current = normalizeAccessConfig(config);
  const source = isRecord(value) ? value : {};
  const player = normalizePlayerName(source.player);
  const playerKey = player.toLowerCase();
  const existing = current.assignments.find((entry) => entry.player.toLowerCase() === playerKey);
  const roles = [...current.roles];
  const rolesById = new Map(roles.map((role) => [role.id, role]));
  let roleId;
  if (source.roleId) {
    roleId = normalizeRoleId(source.roleId);
    if (!rolesById.has(roleId)) throw new Error(`Unknown access role: ${roleId}.`);
  } else {
    const legacy = normalizeLegacyAssignment({ ...source, player }, { strict: true });
    roleId = legacy.role;
    if (legacy.role === 'admin') {
      const migrated = legacyAdminRole(legacy);
      roleId = migrated.id;
      const index = roles.findIndex((role) => role.id === roleId);
      if (index >= 0) roles[index] = migrated;
      else roles.push(migrated);
      rolesById.set(roleId, migrated);
    }
  }

  const assignments = current.assignments.filter((entry) => entry.player.toLowerCase() !== playerKey);
  let replacedOwner = '';
  if (roleId === 'owner') {
    const previousOwner = assignments.find((entry) => entry.roleId === 'owner');
    if (previousOwner) {
      replacedOwner = previousOwner.player;
      const demoted = legacyAdminRole({
        player: previousOwner.player,
        groups: ['moderation'],
        commands: []
      });
      const index = roles.findIndex((role) => role.id === demoted.id);
      if (index >= 0) roles[index] = demoted;
      else roles.push(demoted);
      previousOwner.roleId = demoted.id;
    }
  }
  assignments.push({
    player,
    uuid: normalizePlayerUuid(source.uuid || existing?.uuid, { strict: true }),
    roleId
  });
  const next = pruneUnusedLegacyRoles(updatedConfig({ roles, assignments }));
  return { config: normalizeAccessConfig(next), replacedOwner };
}

function removeAssignment(config, player) {
  const clean = normalizePlayerName(player);
  const key = clean.toLowerCase();
  const current = normalizeAccessConfig(config);
  return normalizeAccessConfig(pruneUnusedLegacyRoles(updatedConfig({
    roles: current.roles,
    assignments: current.assignments.filter((entry) => entry.player.toLowerCase() !== key)
  })));
}

function setRole(config, value = {}) {
  const current = normalizeAccessConfig(config);
  const source = isRecord(value) ? value : {};
  const requestedId = normalizeRoleId(source.id || roleIdFromName(source.name));
  if (BUILT_IN_ROLE_IDS.has(requestedId)) {
    throw new Error('That role ID is reserved for runtime compatibility. Choose a different role ID.');
  }
  const existing = current.roles.find((role) => role.id === requestedId);
  const customRoleCount = current.roles.filter((role) => !role.builtIn && !role.legacy).length;
  if (!existing && customRoleCount >= MAX_CUSTOM_ROLES) {
    throw new Error(`At most ${MAX_CUSTOM_ROLES} custom access roles are supported.`);
  }
  const merged = {
    ...(existing || {}),
    ...source,
    id: requestedId,
    commands: { ...(existing?.commands || {}), ...(isRecord(source.commands) ? source.commands : {}) },
    appearance: { ...(existing?.appearance || {}), ...(isRecord(source.appearance) ? source.appearance : {}) },
    legacy: Boolean(existing?.legacy)
  };
  const role = normalizeRole(merged, { strict: true, allowLegacy: Boolean(existing?.legacy) });
  const roles = current.roles.filter((entry) => entry.id !== role.id);
  roles.push(role);
  const next = updatedConfig({ roles, assignments: current.assignments });
  return { config: next, roleId: role.id };
}

function removeRole(config, value) {
  const current = normalizeAccessConfig(config);
  const source = isRecord(value) ? value : { roleId: value };
  const roleId = normalizeRoleId(source.roleId || source.id);
  if (BUILT_IN_ROLE_IDS.has(roleId)) throw new Error('Built-in roles cannot be deleted.');
  if (!current.roles.some((role) => role.id === roleId)) throw new Error(`Unknown access role: ${roleId}.`);
  const assigned = current.assignments.filter((assignment) => assignment.roleId === roleId);
  let reassignRoleId = '';
  if (assigned.length) {
    if (source.removeAssignments === true) {
      return updatedConfig({
        roles: current.roles.filter((role) => role.id !== roleId),
        assignments: current.assignments.filter((assignment) => assignment.roleId !== roleId)
      });
    }
    reassignRoleId = source.reassignRoleId ? normalizeRoleId(source.reassignRoleId) : '';
    if (!reassignRoleId) throw new Error('Reassign this role’s players before deleting it.');
    if (reassignRoleId === roleId || !current.roles.some((role) => role.id === reassignRoleId)) {
      throw new Error('Choose a valid replacement role.');
    }
  }
  return updatedConfig({
    roles: current.roles.filter((role) => role.id !== roleId),
    assignments: current.assignments.map((assignment) =>
      assignment.roleId === roleId ? { ...assignment, roleId: reassignRoleId } : assignment)
  });
}

function accessConfigIndexes(config) {
  let indexes = ACCESS_CONFIG_INDEXES.get(config);
  if (indexes) return indexes;
  const rolesById = new Map();
  const assignmentsByPlayer = new Map();
  const assignmentsByUuid = new Map();
  for (const role of Array.isArray(config?.roles) ? config.roles : []) rolesById.set(role.id, role);
  for (const assignment of Array.isArray(config?.assignments) ? config.assignments : []) {
    assignmentsByPlayer.set(assignment.player.toLowerCase(), assignment);
    if (assignment.uuid) assignmentsByUuid.set(assignment.uuid, assignment);
  }
  indexes = { rolesById, assignmentsByPlayer, assignmentsByUuid };
  ACCESS_CONFIG_INDEXES.set(config, indexes);
  return indexes;
}

function findAssignment(config, playerOrAssignment) {
  const current = normalizeAccessConfig(config);
  const indexes = accessConfigIndexes(current);
  if (isRecord(playerOrAssignment)) {
    const player = String(playerOrAssignment.player || '').trim().toLowerCase();
    const uuid = String(playerOrAssignment.uuid || '').trim().toLowerCase();
    return (uuid && indexes.assignmentsByUuid.get(uuid)) ||
      (player && indexes.assignmentsByPlayer.get(player)) || null;
  }
  const key = String(playerOrAssignment || '').trim().toLowerCase();
  return indexes.assignmentsByPlayer.get(key) || indexes.assignmentsByUuid.get(key) || null;
}

function assignmentHasCapability(config, playerOrAssignment, capability) {
  const id = String(capability || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CAPABILITY_DEFINITIONS, id)) return false;
  const current = normalizeAccessConfig(config);
  const assignment = findAssignment(current, playerOrAssignment);
  const role = assignment ? accessConfigIndexes(current).rolesById.get(assignment.roleId) : null;
  return Boolean(role?.capabilities?.includes(id));
}

function assignmentCompatibilityRole(config, playerOrAssignment) {
  const current = normalizeAccessConfig(config);
  const assignment = findAssignment(current, playerOrAssignment);
  const role = assignment ? accessConfigIndexes(current).rolesById.get(assignment.roleId) : null;
  return compatibilityRoleForRole(role);
}

function accessConfigForUi(value) {
  const config = normalizeAccessConfig(value);
  const rolesById = roleMap(config);
  const memberCounts = new Map();
  for (const assignment of config.assignments) {
    memberCounts.set(assignment.roleId, (memberCounts.get(assignment.roleId) || 0) + 1);
  }
  return {
    ...config,
    // Owner/admin/member and per-player migration roles exist only as a compatibility layer for
    // old protection adapters. They are never choices in the editor: every visible role is one
    // the server owner deliberately created and can later delete.
    roles: config.roles
      .filter((role) => !role.builtIn && !role.legacy)
      .map((role) => ({ ...role, memberCount: memberCounts.get(role.id) || 0 })),
    assignments: config.assignments.map((assignment) => {
      const storedRole = rolesById.get(assignment.roleId) || null;
      const role = storedRole && !storedRole.builtIn && !storedRole.legacy ? storedRole : null;
      const compatibilityRole = storedRole || rolesById.get('member');
      const compatibility = compatibilityCommandFields(compatibilityRole);
      return {
        ...assignment,
        role: compatibility.role,
        roleName: role?.name || 'Previous access',
        roleUnavailable: !role,
        groups: [...(compatibilityRole?.commands.groups || [])],
        commands: [...(compatibilityRole?.commands.allow || [])],
        deniedCommands: [...(compatibilityRole?.commands.deny || [])],
        commandMode: compatibilityRole?.commands.mode || 'allowlist',
        capabilities: [...(compatibilityRole?.capabilities || [])],
        appearance: { ...(compatibilityRole?.appearance || { enabled: false, prefix: '', suffix: '', color: 'white' }) }
      };
    }),
    commandGroups: Object.fromEntries(Object.entries(COMMAND_GROUPS).map(([id, group]) => [id, {
      label: group.label,
      commands: [...group.commands]
    }])),
    commandCatalog: [...COMMAND_CATALOG],
    capabilityDefinitions: Object.fromEntries(Object.entries(CAPABILITY_DEFINITIONS).map(([id, capability]) => [id, { ...capability }])),
    minecraftColors: [...MINECRAFT_COLORS]
  };
}

function managedRoleTeamId(roleId) {
  const id = normalizeRoleId(roleId);
  const digest = crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 10);
  return `ci_r_${digest}`;
}

function formattedTextComponent(value) {
  const text = normalizeFormattedText(value);
  if (!text) return { text: '' };
  const characters = Array.from(text);
  const extra = [];
  let buffer = '';
  let style = {};
  const flush = () => {
    if (!buffer) return;
    extra.push({ text: buffer, ...style });
    buffer = '';
  };
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character !== '§' || !characters[index + 1]) {
      buffer += character;
      continue;
    }
    const code = characters[index + 1].toLowerCase();
    index += 1;
    flush();
    if (Object.prototype.hasOwnProperty.call(LEGACY_COLOR_CODES, code)) {
      style = { color: LEGACY_COLOR_CODES[code] };
    } else if (code === 'k') style = { ...style, obfuscated: true };
    else if (code === 'l') style = { ...style, bold: true };
    else if (code === 'm') style = { ...style, strikethrough: true };
    else if (code === 'n') style = { ...style, underlined: true };
    else if (code === 'o') style = { ...style, italic: true };
    else if (code === 'r') style = {};
  }
  flush();
  return extra.length === 1 ? extra[0] : { text: '', extra };
}

function formattedTextComponentJson(value) {
  return JSON.stringify(formattedTextComponent(value));
}

function buildAccessTeamCommandPlan(value, options = {}) {
  const config = normalizeAccessConfig(value);
  const previous = options.previousConfig ? normalizeAccessConfig(options.previousConfig) : null;
  const rolesById = roleMap(config);
  const activeRoles = config.roles.filter((role) => role.appearance.enabled);
  const activeTeamIds = new Set(activeRoles.map((role) => managedRoleTeamId(role.id)));
  const rememberedTeamIds = (Array.isArray(options.previousTeamIds) ? options.previousTeamIds : [])
    .map((teamId) => String(teamId || '').trim().toLowerCase())
    .filter((teamId) => /^ci_r_[a-f0-9]{10}$/.test(teamId));
  const previousConfigTeamIds = previous
    ? previous.roles.filter((role) => role.appearance.enabled).map((role) => managedRoleTeamId(role.id))
    : [];
  const staleTeamIds = [...new Set([...rememberedTeamIds, ...previousConfigTeamIds])]
    .filter((teamId) => !activeTeamIds.has(teamId))
    .sort();
  const onlineByKey = new Map();
  for (const candidate of Array.isArray(options.onlinePlayers) ? options.onlinePlayers : []) {
    try {
      const player = normalizePlayerName(candidate);
      onlineByKey.set(player.toLowerCase(), player);
    } catch {}
  }
  const styledAssignments = [];
  const styledPlayerKeys = new Set();
  for (const assignment of config.assignments) {
    const player = onlineByKey.get(assignment.player.toLowerCase());
    const role = rolesById.get(assignment.roleId);
    if (!player || !role?.appearance.enabled) continue;
    styledPlayerKeys.add(player.toLowerCase());
    styledAssignments.push({ player, role, teamId: managedRoleTeamId(role.id) });
  }

  const pvpEnabled = options.pvpEnabled !== false;
  const pvpTeamId = String(options.pvpTeamId || 'asm_pve').trim();
  if (!/^[A-Za-z0-9_.+-]{1,16}$/.test(pvpTeamId)) throw new Error('Managed PvP team ID is invalid.');
  const commands = [];
  staleTeamIds.forEach((teamId) => commands.push(`team remove ${teamId}`));
  for (const role of activeRoles) {
    const teamId = managedRoleTeamId(role.id);
    commands.push(`team add ${teamId} ${JSON.stringify({ text: role.name })}`);
    commands.push(`team modify ${teamId} color ${role.appearance.color}`);
    commands.push(`team modify ${teamId} prefix ${formattedTextComponentJson(role.appearance.prefix)}`);
    commands.push(`team modify ${teamId} suffix ${formattedTextComponentJson(role.appearance.suffix)}`);
    commands.push(`team modify ${teamId} nametagVisibility always`);
    commands.push(`team modify ${teamId} friendlyFire ${pvpEnabled ? 'true' : 'false'}`);
    commands.push(`team empty ${teamId}`);
  }

  // Keep the existing unstyled-player PvP fallback separate. Styled players must remain in their
  // role team because Minecraft allows only one scoreboard team per player.
  commands.push(`team add ${pvpTeamId}`);
  commands.push(`team modify ${pvpTeamId} friendlyFire ${pvpEnabled ? 'true' : 'false'}`);
  commands.push(`team empty ${pvpTeamId}`);
  if (!pvpEnabled) {
    for (const [key, player] of onlineByKey) {
      if (!styledPlayerKeys.has(key)) commands.push(`team join ${pvpTeamId} ${player}`);
    }
  }
  styledAssignments.forEach(({ player, teamId }) => commands.push(`team join ${teamId} ${player}`));

  const signatureSource = {
    pvpEnabled,
    players: [...onlineByKey.values()].sort((left, right) => left.localeCompare(right)),
    roles: activeRoles.map((role) => ({ id: role.id, appearance: role.appearance })),
    assignments: styledAssignments.map(({ player, role }) => ({ player, roleId: role.id })),
    staleTeamIds
  };
  return {
    commands,
    activeTeamIds: [...activeTeamIds],
    staleTeamIds,
    styledPlayers: styledAssignments.map((entry) => entry.player),
    signature: crypto.createHash('sha256').update(JSON.stringify(signatureSource), 'utf8').digest('hex')
  };
}

function quoteYaml(value) {
  return JSON.stringify(String(value));
}

function renderYamlList(lines, indentation, name, values, quote = false) {
  const prefix = ' '.repeat(indentation);
  if (!values.length) {
    lines.push(`${prefix}${name}: []`);
    return;
  }
  lines.push(`${prefix}${name}:`);
  values.forEach((value) => lines.push(`${prefix}  - ${quote ? quoteYaml(value) : value}`));
}

function renderAccessYaml(value) {
  const config = normalizeAccessConfig(value);
  const rolesById = roleMap(config);
  const lines = [
    '# Managed by Server Manager. Change player access in the app.',
    'version: 2',
    `updatedAt: ${quoteYaml(config.updatedAt)}`,
    'deniedMessage: "&cYou do not have access to that command."',
    'roles:'
  ];
  for (const role of config.roles) {
    lines.push(`  - id: ${quoteYaml(role.id)}`);
    lines.push(`    name: ${quoteYaml(role.name)}`);
    lines.push(`    builtIn: ${Boolean(role.builtIn)}`);
    lines.push(`    tradeDiscountPercent: ${role.tradeDiscountPercent}`);
    renderYamlList(lines, 4, 'capabilities', role.capabilities, true);
    lines.push('    commandPolicy:');
    lines.push(`      mode: ${role.commands.mode}`);
    renderYamlList(lines, 6, 'groups', role.commands.groups);
    renderYamlList(lines, 6, 'allow', role.commands.allow, true);
    renderYamlList(lines, 6, 'deny', role.commands.deny, true);
    lines.push('    appearance:');
    lines.push(`      enabled: ${Boolean(role.appearance.enabled)}`);
    lines.push(`      prefix: ${quoteYaml(role.appearance.prefix)}`);
    lines.push(`      suffix: ${quoteYaml(role.appearance.suffix)}`);
    lines.push(`      color: ${role.appearance.color}`);
  }
  if (!config.assignments.length) lines.push('assignments: []');
  else lines.push('assignments:');
  for (const assignment of config.assignments) {
    const role = rolesById.get(assignment.roleId) || rolesById.get('member');
    const compatibility = compatibilityCommandFields(role);
    lines.push(`  - player: ${quoteYaml(assignment.player)}`);
    if (assignment.uuid) lines.push(`    uuid: ${quoteYaml(assignment.uuid)}`);
    lines.push(`    roleId: ${quoteYaml(assignment.roleId)}`);
    // These fields keep older Server Protection adapters working while v2-aware adapters use roleId.
    lines.push(`    role: ${compatibility.role}`);
    renderYamlList(lines, 4, 'groups', compatibility.groups);
    renderYamlList(lines, 4, 'commands', compatibility.commands, true);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  COMMAND_GROUPS,
  COMMAND_CATALOG,
  DEFAULT_PLAYER_COMMANDS,
  CAPABILITY_DEFINITIONS,
  MINECRAFT_COLORS,
  normalizePlayerName,
  normalizePlayerUuid,
  normalizeRoleId,
  normalizeCommandRoot,
  normalizeFormattedText,
  normalizeAppearance,
  normalizeRole,
  normalizeAssignment,
  normalizeAccessConfig,
  setAssignment,
  removeAssignment,
  setRole,
  removeRole,
  findAssignment,
  assignmentHasCapability,
  assignmentCompatibilityRole,
  accessConfigForUi,
  managedRoleTeamId,
  formattedTextComponent,
  formattedTextComponentJson,
  buildAccessTeamCommandPlan,
  renderAccessYaml
};
