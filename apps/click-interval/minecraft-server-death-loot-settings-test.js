'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const mainPath = path.join(root, 'minecraft-server', 'main.js');
const mainText = fs.readFileSync(mainPath, 'utf8');
const uiText = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');
const source = `${mainText}\nmodule.exports.__deathLootSettingsTest = { normalizeServerConfig, serializeDeathLootRuntimeConfig };`;
const electronMock = {
  app: { getPath: () => path.join(root, 'work', 'death-loot-settings-unused'), on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: () => {} },
  dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => value.toString('utf8')
  }
};
const moduleMock = { exports: {} };
const sandbox = {
  module: moduleMock,
  exports: moduleMock.exports,
  __dirname: path.dirname(mainPath),
  __filename: mainPath,
  Buffer,
  URL,
  URLSearchParams,
  process,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  require: id => {
    if (id === 'electron') return electronMock;
    if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
    if (id.startsWith('./')) return require(path.join(path.dirname(mainPath), id));
    return require(id);
  }
};
vm.runInNewContext(source, sandbox, { filename: mainPath });
const test = moduleMock.exports.__deathLootSettingsTest;

const defaults = test.normalizeServerConfig({});
assert.equal(defaults.deathLootMode, 'vanilla');
assert.equal(defaults.deathDropLifetimeSeconds, 300);
assert.equal(defaults.deathChestLifetimeSeconds, 900);
assert.equal(defaults.deathChestTorches, true);

assert.equal(test.normalizeServerConfig({ deathLootMode: 'timed' }).deathLootMode, 'timed');
assert.equal(test.normalizeServerConfig({ deathLootMode: 'chest' }).deathLootMode, 'chest');
assert.equal(test.normalizeServerConfig({ deathLootMode: 'everything' }).deathLootMode, 'vanilla');
assert.equal(test.normalizeServerConfig({ deathDropLifetimeSeconds: -50 }).deathDropLifetimeSeconds, 1);
assert.equal(test.normalizeServerConfig({ deathDropLifetimeSeconds: 999999 }).deathDropLifetimeSeconds, 86400);
assert.equal(test.normalizeServerConfig({ deathChestLifetimeSeconds: 0 }).deathChestLifetimeSeconds, 0);
assert.equal(test.normalizeServerConfig({ deathChestLifetimeSeconds: 1 }).deathChestLifetimeSeconds, 1);
assert.equal(test.normalizeServerConfig({ deathChestLifetimeSeconds: 9999999 }).deathChestLifetimeSeconds, 604800);
assert.equal(test.normalizeServerConfig({ deathChestTorches: false }).deathChestTorches, false);

assert.equal(test.serializeDeathLootRuntimeConfig({
  deathLootMode: 'chest',
  deathDropLifetimeSeconds: 450,
  deathChestLifetimeSeconds: 1200,
  deathChestTorches: false
}), [
  '# Server Death Loot - managed by the server settings page',
  'mode=chest',
  'death-drop-lifetime-seconds=450',
  'death-chest-lifetime-seconds=1200',
  'place-torches=false',
  ''
].join('\n'));

assert.match(uiText, /\['deathLootMode','Death loot','select',[\s\S]*?\['vanilla','Vanilla drops'\][\s\S]*?\['timed','Timed death drops'\][\s\S]*?\['chest','Death chest'\]/);
assert.match(uiText, /Ordinary dropped items keep their normal Minecraft lifetime/,
  'the setting must state that ordinary item drops are untouched');
assert.match(uiText, /function syncDeathLootSettings\(\)[\s\S]*?mode === 'timed'[\s\S]*?mode === 'chest'/,
  'irrelevant death-loot controls should stay hidden');
assert.match(mainText, /await writeDeathLootRuntimeConfig\(paths, next\)/,
  'saving server settings must write the bounded mod config atomically');

console.log('PASS death-only loot settings normalization and UI contract');
