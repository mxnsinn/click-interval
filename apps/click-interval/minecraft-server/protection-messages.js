'use strict';

const PROTECTION_MESSAGE_DEFINITIONS = Object.freeze({
  warning: Object.freeze({ text: '{reason}. Please stop.', color: '#ffff55' }),
  alert: Object.freeze({ text: 'Suspicious activity detected: {reason}.', color: '#ff5555' }),
  kick: Object.freeze({ text: 'Removed for suspicious activity: {reason}.', color: '#ff5555' }),
  temporaryBan: Object.freeze({
    text: 'Temporarily banned for suspicious activity: {reason} ({duration_minutes}m).',
    color: '#aa0000'
  }),
  permanentBan: Object.freeze({ text: 'Banned for suspicious activity: {reason}.', color: '#aa0000' }),
  loginTemporaryBan: Object.freeze({ text: 'Temporarily banned ({remaining_minutes}m remaining).', color: '#ff5555' }),
  loginPermanentBan: Object.freeze({ text: 'You are banned from this server.', color: '#ff5555' }),
  modPolicyKick: Object.freeze({ text: 'Client mod policy: {reason}.', color: '#ff5555' })
});

const PROTECTION_CHECK_PATHS = Object.freeze({
  speed: 'movement.speed',
  flight: 'movement.flight',
  phase: 'movement.phase',
  invalidPosition: 'movement.invalidPosition',
  invalidRotation: 'movement.invalidRotation',
  groundSpoof: 'movement.groundSpoof',
  waterWalk: 'movement.waterWalk',
  step: 'movement.step',
  timer: 'movement.timer',
  noSlow: 'movement.noSlow',
  reach: 'combat.reach',
  wallHit: 'combat.wallHit',
  autoClicker: 'combat.autoClicker',
  multiTarget: 'combat.multiTarget',
  aimDirection: 'combat.aimDirection',
  killAura: 'combat.killAura',
  clickPattern: 'combat.clickPattern',
  criticals: 'combat.criticals',
  fastBreak: 'world.fastBreak',
  fastPlace: 'world.fastPlace',
  breakReach: 'world.breakReach',
  placeReach: 'world.placeReach',
  scaffold: 'world.scaffold',
  multiBreak: 'world.multiBreak',
  chatSpam: 'abuse.chatSpam',
  commandSpam: 'abuse.commandSpam',
  inventorySpam: 'abuse.inventorySpam'
});

const NAMED_MESSAGE_COLORS = new Set([
  'none', 'black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple',
  'gold', 'gray', 'grey', 'dark_gray', 'dark_grey', 'blue', 'green', 'aqua', 'red',
  'light_purple', 'yellow', 'white'
]);

function cleanMessageText(value, fallback, maxLength = 512) {
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return cleaned || fallback;
}

function normalizeMessageColor(value, fallback) {
  const color = String(value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color) || NAMED_MESSAGE_COLORS.has(color) || /^[&\u00a7][0-9a-f]$/.test(color)) {
    return color;
  }
  return fallback;
}

function normalizeMessageEntry(value, fallback) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    text: cleanMessageText(source.text, fallback.text),
    color: normalizeMessageColor(source.color, fallback.color)
  };
}

function normalizeProtectionMessages(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const messages = {};
  for (const [key, fallback] of Object.entries(PROTECTION_MESSAGE_DEFINITIONS)) {
    messages[key] = normalizeMessageEntry(source[key], fallback);
  }
  const sourceChecks = source.checks && typeof source.checks === 'object' && !Array.isArray(source.checks)
    ? source.checks
    : {};
  const checks = {};
  for (const key of Object.keys(PROTECTION_CHECK_PATHS)) {
    if (!Object.prototype.hasOwnProperty.call(sourceChecks, key)) continue;
    checks[key] = normalizeMessageEntry(sourceChecks[key], messages.warning);
  }
  return {
    ...messages,
    banSource: cleanMessageText(source.banSource, 'Server protection', 64),
    warningCooldownSeconds: Math.max(1, Math.min(300, Math.round(Number(source.warningCooldownSeconds) || 10))),
    checks
  };
}

function quoteYaml(value) {
  return JSON.stringify(String(value));
}

function renderProtectionMessagesYaml(value = {}) {
  const messages = normalizeProtectionMessages(value);
  const lines = ['messages:'];
  for (const key of Object.keys(PROTECTION_MESSAGE_DEFINITIONS)) {
    lines.push(`  ${key}:`);
    lines.push(`    text: ${quoteYaml(messages[key].text)}`);
    lines.push(`    color: ${quoteYaml(messages[key].color)}`);
  }
  lines.push(`  banSource: ${quoteYaml(messages.banSource)}`);
  lines.push(`  warningCooldownSeconds: ${messages.warningCooldownSeconds}`);
  const grouped = {};
  for (const [key, entry] of Object.entries(messages.checks)) {
    const full = PROTECTION_CHECK_PATHS[key];
    if (!full) continue;
    const [category, check] = full.split('.');
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push([check, entry]);
  }
  if (!Object.keys(grouped).length) {
    lines.push('  checks: {}');
    return `${lines.join('\n')}\n`;
  }
  lines.push('  checks:');
  for (const [category, checks] of Object.entries(grouped)) {
    lines.push(`    ${category}:`);
    for (const [check, entry] of checks) {
      lines.push(`      ${check}:`);
      lines.push(`        text: ${quoteYaml(entry.text)}`);
      lines.push(`        color: ${quoteYaml(entry.color)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  PROTECTION_MESSAGE_DEFINITIONS,
  PROTECTION_CHECK_PATHS,
  cleanMessageText,
  normalizeMessageColor,
  normalizeProtectionMessages,
  renderProtectionMessagesYaml
};
