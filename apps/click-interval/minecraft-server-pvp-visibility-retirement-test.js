'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const bukkitRoot = ['minecraft-server', 'click-interval-anticheat', 'src', 'main'];
const listener = read(...bukkitRoot, 'java', 'com', 'clickinterval', 'anticheat', 'ProtectionListener.java');
const plugin = read(...bukkitRoot, 'java', 'com', 'clickinterval', 'anticheat', 'ClickIntervalAntiCheat.java');
const config = read(...bukkitRoot, 'java', 'com', 'clickinterval', 'anticheat', 'ProtectionConfig.java');
const defaults = read(...bukkitRoot, 'resources', 'config.yml');
const backend = read('minecraft-server', 'main.js');
const ui = read('minecraft-server-ui.js');

assert.doesNotMatch(listener, /EntityEspMitigation|tickMitigations/,
  'the Bukkit event listener must not run a player-visibility scan');
assert.doesNotMatch(plugin, /tickMitigations/,
  'the Bukkit plugin must not schedule a per-tick visibility task');
assert.equal(fs.existsSync(path.join(root, ...bukkitRoot, 'java', 'com', 'clickinterval', 'anticheat', 'EntityEspMitigation.java')), false,
  'the Bukkit player-hiding implementation must remain retired');
assert.match(config, /new EntityEsp\(\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*false,/,
  'stale entityEsp.enabled=true input must normalize to false');
assert.match(defaults, /Retired compatibility block[\s\S]*?entityEsp:\s*\n\s*enabled: false/,
  'the bundled Bukkit config must describe the retired compatibility block');
assert.match(plugin, /PvP visibility uses vanilla player and nametag tracking/,
  'the Bukkit status command must report the actual PvP-safe policy');
assert.match(backend, /older[\s\S]*entityEsp\.enabled=true[\s\S]*never hide PvP players or nametags/i,
  'Paper startup must rewrite stale managed protection config before Bukkit loads it');
assert.match(backend, /visibilityRestartRequired[\s\S]*updateAvailable \|\| !loadedBeforeStart/,
  'a running older adapter must keep PvP visibility in restart-required state');
assert.match(backend, /Update and restart required[\s\S]*retired player-hiding behavior/,
  'backend status must not claim PvP-safe visibility while an older adapter is running');
assert.match(ui, /visibilityRestartRequired[\s\S]*Update and restart required · running adapter may still affect player visibility/,
  'the protection UI must show the pending update/restart instead of a false PvP-safe state');

const javaSources = fs.readdirSync(path.join(root, ...bukkitRoot, 'java', 'com', 'clickinterval', 'anticheat'))
  .filter(name => name.endsWith('.java'))
  .map(name => read(...bukkitRoot, 'java', 'com', 'clickinterval', 'anticheat', name))
  .join('\n');
assert.doesNotMatch(javaSources, /\.hidePlayer\(|\.showPlayer\(/,
  'the bundled Bukkit runtime must not call Bukkit player-hiding APIs');

console.log('PASS PvP visibility retirement tests');
