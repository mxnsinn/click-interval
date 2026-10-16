'use strict';

// These commands delegate to managed backends. No filenames are resolved and no
// files are changed here; the backend must verify ownership, profile and state.
const ADDON_USAGE = 'Usage: /addons list [mods|plugins] | /addons delete <mods|plugins> <exact jar filename>';
const ANTICHEAT_USAGE = 'Usage: /anticheat list | /anticheat enable|disable <check-id> | /anticheat delete <custom-id>';
const ADDON_CONSOLE_HELP = [
  '[Server Console] Installed add-ons',
  '  /addons list [mods|plugins]                    Show installed JAR filenames',
  '  /addons delete <mods|plugins> <exact filename> Remove one installed JAR',
  '  /addons remove <mods|plugins> <exact filename> Alias for delete',
  '  Use the exact .jar filename from the list. Spaces are supported; paths are not.'
].join('\n');
const ANTICHEAT_CONSOLE_HELP = [
  '[Server Console] Anti-cheat controls',
  '  /anticheat list                  Show individual checks and custom add-ons',
  '  /anticheat enable <check-id>      Enable one individual check',
  '  /anticheat disable <check-id>     Disable one individual check',
  '  /anticheat delete <custom-id>     Remove one imported anti-cheat add-on',
  '  /anticheat remove <custom-id>     Alias for delete',
  '  /anticheat enable|disable all    Turn the protection master switch on or off',
  '  Use check IDs and custom add-on IDs from /anticheat list.'
].join('\n');

function assertArgs(args, usage) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || !arg || /[\x00-\x1f\x7f]/.test(arg))) {
    throw new Error(usage);
  }
}

function normalizeAddonKind(value) {
  const kind = typeof value === 'string' ? value.toLowerCase() : '';
  if (!['mods', 'plugins'].includes(kind)) throw new Error(ADDON_USAGE);
  return kind;
}

function assertJarFileName(file) {
  if (typeof file !== 'string' || file !== file.trim() || file.length > 255 ||
      !/^.+\.jar$/i.test(file) || /[\\/:<>"|?*\x00-\x1f\x7f]/.test(file) || file.includes('..') ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file)) {
    throw new Error('Use an exact .jar filename from /addons list, without paths or wildcard characters.');
  }
  return file;
}

function parseAddonConsoleArgs(args) {
  assertArgs(args, ADDON_USAGE);
  const action = args[0]?.toLowerCase() || 'list';
  if (action === 'help') {
    if (args.length !== 1) throw new Error(ADDON_USAGE);
    return Object.freeze({ action });
  }
  if (action === 'list') {
    if (args.length > 2) throw new Error(ADDON_USAGE);
    return Object.freeze({ action, kind: args.length === 2 ? normalizeAddonKind(args[1]) : undefined });
  }
  if (!['delete', 'remove'].includes(action) || args.length < 3) throw new Error(ADDON_USAGE);
  const kind = normalizeAddonKind(args[1]);
  const file = assertJarFileName(args.slice(2).join(' '));
  return Object.freeze({ action: 'delete', kind, file });
}

function parseAntiCheatConsoleArgs(args) {
  assertArgs(args, ANTICHEAT_USAGE);
  const action = args[0]?.toLowerCase() || 'list';
  if (action === 'list' || action === 'help') {
    if (args.length > 1) throw new Error(ANTICHEAT_USAGE);
    return Object.freeze({ action });
  }
  if (args.length !== 2) throw new Error(ANTICHEAT_USAGE);
  const id = args[1];
  if (action === 'enable' || action === 'disable') {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(id) || id.includes('..')) {
      throw new Error('Use one check ID from /anticheat list.');
    }
    return Object.freeze({ action: 'set-check', id, enabled: action === 'enable' });
  }
  if (action === 'delete' || action === 'remove') {
    if (!/^[a-f0-9-]{8,64}$/i.test(id)) throw new Error('Use one custom add-on ID from /anticheat list.');
    return Object.freeze({ action: 'delete-custom', id });
  }
  throw new Error(ANTICHEAT_USAGE);
}

function requireHandler(handlers, operation) {
  if (!handlers || !Object.hasOwn(handlers, operation) || typeof handlers[operation] !== 'function') {
    throw new Error(`The ${operation} console handler is unavailable.`);
  }
  return handlers[operation];
}

async function callHandler(handlers, operation, ...args) {
  const message = await requireHandler(handlers, operation)(...args);
  if (typeof message !== 'string' || !message.trim()) throw new Error(`The ${operation} console operation did not report its result.`);
  return `[Server Console] ${message.trim()}`;
}

async function runAddonConsoleCommand(args, handlers) {
  const request = parseAddonConsoleArgs(args);
  if (request.action === 'help') return ADDON_CONSOLE_HELP;
  if (request.action === 'list') return callHandler(handlers, 'list', request.kind);
  return callHandler(handlers, 'remove', request.kind, request.file);
}

async function runAntiCheatConsoleCommand(args, handlers) {
  const request = parseAntiCheatConsoleArgs(args);
  if (request.action === 'help') return ANTICHEAT_CONSOLE_HELP;
  if (request.action === 'list') return callHandler(handlers, 'list');
  if (request.action === 'set-check') return callHandler(handlers, 'setCheck', request.id, request.enabled);
  return callHandler(handlers, 'removeCustom', request.id);
}

module.exports = {
  ADDON_CONSOLE_HELP,
  ANTICHEAT_CONSOLE_HELP,
  parseAddonConsoleArgs,
  parseAntiCheatConsoleArgs,
  runAddonConsoleCommand,
  runAntiCheatConsoleCommand
};
