'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const commands = fs.readFileSync(path.join(
  root,
  'minecraft-server',
  'server-teleport',
  'src',
  'main',
  'java',
  'com',
  'servermanager',
  'teleport',
  'TeleportCommands.java'
), 'utf8');
const config = fs.readFileSync(path.join(
  root,
  'minecraft-server',
  'server-teleport',
  'src',
  'main',
  'resources',
  'config.yml'
), 'utf8');

assert.match(commands, /args\[0\]\.equalsIgnoreCase\("accept"\)[\s\S]*?handleResponse\(requester,[\s\S]*?true\)/,
  '/tpa accept must use the normal bounded response path');
assert.match(commands, /args\[0\]\.equalsIgnoreCase\("decline"\)[\s\S]*?handleResponse\(requester,[\s\S]*?false\)/,
  '/tpa decline must use the normal bounded response path');
assert.match(commands, /coloredText\("You got a TPA request from ", ChatColor\.YELLOW\)/,
  'the incoming prompt must identify itself clearly');
assert.match(commands, /coloredText\("Accept", ChatColor\.GREEN\)[\s\S]*?ClickEvent\.Action\.RUN_COMMAND, "\/tpa accept " \+ request\.requesterName\(\)/,
  'Accept must be green and clickable');
assert.match(commands, /coloredText\("Decline", ChatColor\.RED\)[\s\S]*?ClickEvent\.Action\.RUN_COMMAND, "\/tpa decline " \+ request\.requesterName\(\)/,
  'Decline must be red and clickable');
assert.match(commands, /target\.spigot\(\)\.sendMessage/,
  'the clickable prompt must remain compatible with Spigot as well as Paper');
assert.match(config, /request-received:.*TPA request from \{requester\}.*accept or decline/i,
  'the plain-text fallback must use the new wording');
assert.doesNotMatch(config, /request-received:.*\/tpaccept/i,
  'the player-facing request message must not advertise the legacy command');

console.log('PASS ServerTeleport clickable request UX contract');
