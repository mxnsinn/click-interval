'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const project = path.join(__dirname, 'minecraft-server', 'server-teleport-fabric');
const serverSource = fs.readFileSync(path.join(
  project, 'src', 'main', 'java', 'dev', 'serverteleport', 'fabric', 'ServerTeleportFabric.java'
), 'utf8');
const componentSource = fs.readFileSync(path.join(
  project, 'src', 'main', 'java', 'dev', 'serverteleport', 'fabric', 'FabricMessageComponent.java'
), 'utf8');
const defaults = fs.readFileSync(path.join(
  project, 'src', 'main', 'resources', 'default-config.properties'
), 'utf8');

assert.match(serverSource, /\.then\(responseCommand\("accept", true\)\)/);
assert.match(serverSource, /\.then\(responseCommand\("decline", false\)\)/);
assert.match(serverSource, /responseCommand\(String name, boolean accept\)[\s\S]*?Commands\.argument\("player"[\s\S]*?incomingRequesters/,
  '/tpa accept and /tpa decline must allow selecting a requester when several are pending');
assert.match(componentSource, /new ClickEvent\.RunCommand\("\/tpa accept" \+ commandTarget\)/);
assert.match(componentSource, /new ClickEvent\.RunCommand\("\/tpa decline" \+ commandTarget\)/);
assert.match(componentSource, /withColor\(ChatFormatting\.GREEN\)/);
assert.match(componentSource, /withColor\(ChatFormatting\.RED\)/);
assert.match(defaults, /^message\.request-received-prompt=You got a TPA request from \{requester\}\. Would you like to$/m);
assert.doesNotMatch(defaults, /^message\.request-received=.*tpaccept/m);
assert.match(defaults, /^message\.usage-tpaccept=Usage: \/tpa accept \[player\]$/m);
assert.match(defaults, /^message\.usage-tpdeny=Usage: \/tpa decline \[player\]$/m);
assert.match(serverSource,
  /Commands\.argument\("destination", StringArgumentType\.greedyString\(\)\)[\s\S]*?tpaRootSuggestions\(context\.getSource\(\)\)[\s\S]*?resolveDirectDestination/,
  'the root /tpa argument must accept complete multi-word saved places and exact online player names');
assert.match(serverSource,
  /private List<String> tpaRootSuggestions[\s\S]*?savedLocationNames\(source\)[\s\S]*?onlinePlayerNames\(source\)[\s\S]*?suggestions\.values/,
  'root completion must expose bare exact names from both saved-place and online-player namespaces');
assert.match(serverSource,
  /Commands\.literal\("go"\)[\s\S]*?Commands\.argument\("name", StringArgumentType\.greedyString\(\)\)[\s\S]*?savedLocationNames/,
  '/tpa go must own saved-place completion and accept multi-word names');
assert.match(serverSource,
  /Commands\.literal\("player"\)[\s\S]*?Commands\.argument\("username", StringArgumentType\.word\(\)\)[\s\S]*?onlinePlayerNames[\s\S]*?requestPlayer/,
  '/tpa player must provide an explicit exact-player route');
assert.match(serverSource,
  /DirectDestinationMatch\.resolve\(savedLocation\.isPresent\(\), target != null\)[\s\S]*?case SAVED_PLACE[\s\S]*?case ONLINE_PLAYER[\s\S]*?case AMBIGUOUS/,
  'the shorthand resolver must route exact saved places and players while rejecting collisions');
assert.doesNotMatch(serverSource, /useDestination/,
  'the retired fuzzy/fallthrough destination resolver must stay removed');
assert.match(serverSource,
  /private boolean revokeOutgoingBeforeLocalTravel[\s\S]*?requests\.cancel\(requester\.getUUID\(\)\)/,
  'local saved-place travel must revoke a stale outgoing request before movement');
assert.match(defaults, /^message\.location-saved=.*Use \/tpa go \{name\} to return\.$/m,
  'save confirmation must advertise the unambiguous saved-place route');

console.log('PASS Fabric TPA prompt, exact dual-namespace routing, and stale-request safety tests');
