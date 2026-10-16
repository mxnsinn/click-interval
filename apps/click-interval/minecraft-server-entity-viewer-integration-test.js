'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'minecraft-server', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'entity-viewer-preload.js'), 'utf8');

assert(main.includes("require('./entity-control')"), 'backend must use the standalone bounded entity bridge');
assert(!main.includes("require('./trade-assistant-control')"), 'entity controls must not restore the retired Trade Assistant module');
assert(main.includes("async function createEntityViewerWindow(selector = '')"));
assert.match(main, /async function createEntityViewerWindow[\s\S]*?resizable: false[\s\S]*?title: 'Entity Viewer'[\s\S]*?sandbox: true/,
  'Entity Viewer must be fixed-size and sandboxed');
assert(main.includes("preload: path.join(__dirname, '..', 'entity-viewer-preload.js')"));
assert(main.includes("ipcMain.handle('entity-viewer:open'"));

for (const channel of ['list', 'inspect', 'updateOffer', 'setAge', 'setCooldown']) {
  assert(main.includes(`ipcMain.handle('entity-viewer:${channel}'`), `missing backend channel entity-viewer:${channel}`);
  assert(preload.includes(`ipcRenderer.invoke('entity-viewer:${channel}'`), `missing preload channel entity-viewer:${channel}`);
}

assert.match(main, /snapshot\.bridge\.readMapSnapshot\(\)/,
  'Entity Viewer must consume bounded real entity snapshots');
assert.match(main, /getTradeAssistantRuntimeState[\s\S]*tokenReady[\s\S]*snapshotReady/,
  'Entity Viewer availability must be based on the server-owned entity bridge');
assert.match(main, /filter\(\(entry\) => entry\?\.player !== true\)\.slice\(0, 512\)/,
  'fallback entity lists must stay non-player and bounded');
assert.doesNotMatch(main, /fakeStructure|generatedStructure|mockEntit|sampleEntit/i,
  'backend must not invent entity or structure telemetry');

console.log('PASS bounded Entity Viewer backend integration');
