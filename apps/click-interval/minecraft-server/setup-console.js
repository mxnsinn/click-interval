'use strict';

// This is a command catalog, not a file deletion API. Each handler must call
// its existing profile-bound backend operation and retain its lifecycle guards.
const SETUP_CATALOG = Object.freeze([
  {
    name: 'silent-restart',
    label: 'Silent restart',
    aliases: ['silentrestart', 'seamless-restart', 'seamlessrestart'],
    removal: 'Removes the setup and restores the previous backend forwarding settings. Stop Minecraft first.'
  },
  {
    name: 'teleport',
    label: 'Teleport Requests',
    aliases: ['teleport-requests'],
    removal: 'Removes the managed add-on; saved homes and warps stay. Stop Minecraft first.'
  },
  {
    name: 'voice',
    label: 'Proximity Voice',
    aliases: ['proximity-voice'],
    removal: 'Removes the managed add-on and its managed voice port mapping; saved data stays. Stop Minecraft first.'
  },
  {
    name: 'world-map',
    label: 'Live World Map',
    aliases: ['map'],
    removal: 'Queues removal for the next server start; rendered map data stays.'
  },
  {
    name: 'anticheat',
    label: 'Server Protection',
    aliases: ['protection', 'anti-cheat'],
    removal: 'Archives the managed protection add-on and disables protection; shared dependencies and saved settings stay. Stop Minecraft first.'
  },
  {
    name: 'direct-hosting',
    label: 'Direct hosting',
    aliases: ['direct'],
    removal: 'Disables direct hosting and removes its managed Minecraft TCP mapping; voice mapping stays separate.'
  },
  {
    name: 'local-only',
    label: 'Local-only mode',
    aliases: ['localonly'],
    removal: 'Disables local-only mode; public mappings and tunnels remain off.'
  }
].map((entry) => Object.freeze({ ...entry, aliases: Object.freeze(entry.aliases) })));

const SETUP_NAMES = new Map();
for (const entry of SETUP_CATALOG) {
  for (const name of [entry.name, ...entry.aliases]) SETUP_NAMES.set(name, entry);
}

const USAGE = 'Usage: /setup list | /setup delete <name> | /setup help';

function parseSetupConsoleArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || !arg || /\s/.test(arg))) {
    throw new Error(USAGE);
  }
  const action = args[0]?.toLowerCase() || 'list';
  if (action === 'list' || action === 'help') {
    if (args.length > 1) throw new Error(USAGE);
    return Object.freeze({ action });
  }
  if (action !== 'delete' || args.length !== 2) throw new Error(USAGE);
  const entry = SETUP_NAMES.get(args[1].toLowerCase());
  if (!entry) {
    throw new Error(`Unknown setup: ${args[1]}. Use /setup list to see supported names.`);
  }
  return Object.freeze({ action: 'delete', name: entry.name });
}

function requireHandler(handlers, name, operation) {
  const handler = handlers && Object.hasOwn(handlers, name) ? handlers[name]?.[operation] : null;
  if (typeof handler !== 'function') {
    throw new Error(`The ${name} setup ${operation} handler is unavailable.`);
  }
  return handler;
}

function formatHelp() {
  return [
    '[Server Console] Managed setups',
    '  /setup list                  Show setup status and removal behavior',
    '  /setup delete <name>         Remove or disable one named setup',
    `  Names: ${SETUP_CATALOG.map((entry) => entry.name).join(', ')}`,
    '  Removal uses each feature\'s existing rules. This command does not delete worlds or arbitrary files.'
  ].join('\n');
}

async function runSetupConsoleCommand(args, handlers) {
  const request = parseSetupConsoleArgs(args);
  if (request.action === 'help') return formatHelp();
  if (request.action === 'delete') {
    const remove = requireHandler(handlers, request.name, 'remove');
    const message = await remove();
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error(`The ${request.name} removal did not report its result.`);
    }
    return `[Server Console] ${message.trim()}`;
  }

  // Check every callback before invoking any, so an incomplete integration
  // cannot accidentally return a partial list of supported setup types.
  const callbacks = SETUP_CATALOG.map((entry) => requireHandler(handlers, entry.name, 'status'));
  const statuses = await Promise.all(callbacks.map((status) => status()));
  return [
    '[Server Console] Managed setups',
    ...SETUP_CATALOG.flatMap((entry, index) => [
      `  ${entry.name}: ${String(statuses[index] || 'status unavailable').replace(/\s+/g, ' ').trim()}`,
      `    /setup delete ${entry.name} — ${entry.removal}`
    ]),
    '  Setup stays saved across restarts until you explicitly remove or disable it.'
  ].join('\n');
}

module.exports = { SETUP_CATALOG, parseSetupConsoleArgs, runSetupConsoleCommand };
