'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, 'minecraft-server', 'main.js'), 'utf8');
const start = main.slice(
  main.indexOf('async function startServerOperationInternal'),
  main.indexOf('function stopServer', main.indexOf('async function startServerOperationInternal'))
);
const helper = main.slice(
  main.indexOf('async function applyQueuedSmpModsBeforeStart'),
  main.indexOf('function startServer', main.indexOf('async function applyQueuedSmpModsBeforeStart'))
);

assert.match(main, /require\('\.\/pending-mod-queue'\)/,
  'the server lifecycle should use the verified pending-mod subsystem');
assert.match(helper, /serverType !== 'fabric' \|\| minecraftVersion !== '26\.2'/,
  'the pinned queue must never be applied to another runtime');
assert.match(helper, /await recoverPendingModTransaction\([\s\S]*?serverStopped: true/,
  'startup must recover an interrupted transaction before applying anything');
assert.match(helper, /await getPendingModQueueStatus\(/,
  'startup must verify the current manifest and pending files');
assert.match(helper, /await applyPendingModQueue\([\s\S]*?optionalServerKeys: \[\]/,
  'only the conservative default set should auto-apply');
assert.match(helper, /await revalidate\(\);[\s\S]*?if \(serverProcess\)/,
  'the active profile and absent Minecraft process must be rechecked before apply');

const pendingIndex = start.indexOf('await applyQueuedSmpModsBeforeStart');
const mapIndex = start.indexOf('await applyQueuedWorldMapChangeBeforeStart');
const protectionIndex = start.indexOf('await refreshManagedBundledProtectionBeforeStartUnlocked');
const spawnIndex = start.indexOf('processRef = await launchPersistentProcess(');
assert(pendingIndex >= 0 && mapIndex > pendingIndex && protectionIndex > mapIndex && spawnIndex > protectionIndex,
  'pending mods, optional map changes, and managed protection must commit before Java can spawn');

console.log('PASS pending Fabric mod queue startup integration');
