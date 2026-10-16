'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, 'minecraft-server', 'main.js');

function loadRenderer() {
  const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__antiXrayContainerSafetyTest = { renderFabricPacketAntiXrayConfig };`;
  const moduleMock = { exports: {} };
  const electronMock = {
    app: { getPath: () => os.tmpdir(), on: () => {} },
    BrowserWindow: { fromWebContents: () => null },
    ipcMain: { handle: () => {} },
    dialog: {},
    shell: {},
    Menu: {},
    clipboard: {},
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (value) => value.toString('utf8')
    }
  };
  const sandbox = {
    module: moduleMock,
    exports: moduleMock.exports,
    __dirname: path.dirname(sourcePath),
    __filename: sourcePath,
    Buffer,
    URL,
    URLSearchParams,
    process,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    require: (id) => {
      if (id === 'electron') return electronMock;
      if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
      if (id.startsWith('./')) return require(path.join(path.dirname(sourcePath), id));
      return require(id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  return moduleMock.exports.__antiXrayContainerSafetyTest.renderFabricPacketAntiXrayConfig;
}

function normalizeId(value) {
  return String(value || '')
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
}

function hiddenBlockLists(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const lists = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)hidden-blocks:\s*(.*?)\s*(?:#.*)?$/);
    if (!match) continue;
    const indent = match[1].length;
    const inline = match[2].trim();
    if (inline === '[]') {
      lists.push([]);
      continue;
    }
    const values = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const lineIndent = line.match(/^\s*/)[0].length;
      if (lineIndent <= indent) break;
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (!item) break;
      values.push(normalizeId(item[1]));
    }
    lists.push(values);
  }
  return lists;
}

function assertNoUnsafeHiddenBlocks(source, context) {
  const lists = hiddenBlockLists(source);
  assert.ok(lists.length >= 4,
    `${context} must explicitly own the global and three supported dimension hidden-block lists`);
  const ids = lists.flat();
  const unsafe = new Set([
    'minecraft:chest',
    'minecraft:trapped_chest',
    'minecraft:ender_chest',
    'minecraft:barrel',
    'minecraft:hopper',
    'minecraft:dispenser',
    'minecraft:dropper',
    'minecraft:furnace',
    'minecraft:blast_furnace',
    'minecraft:smoker',
    'minecraft:brewing_stand',
    'minecraft:crafter',
    'minecraft:chiseled_bookshelf',
    'minecraft:decorated_pot',
    'minecraft:shulker_box'
  ]);
  for (const id of ids) {
    assert.equal(unsafe.has(id) || /(?:^|:)\w+_shulker_box$/.test(id), false,
      `${context} must not obfuscate block-entity/container ${id}`);
  }
  return lists;
}

const renderFabricPacketAntiXrayConfig = loadRenderer();

const generated = renderFabricPacketAntiXrayConfig('', true);
const generatedLists = assertNoUnsafeHiddenBlocks(generated, 'new managed config');
assert.ok(generatedLists.flat().includes('minecraft:diamond_ore'),
  'new managed config should continue protecting ores');
assert.equal(renderFabricPacketAntiXrayConfig(generated, true), generated,
  'rendering a safe generated config twice should be byte-stable');

const legacy = `# retain this comment
anti-xray:
  enabled: true
  engine-mode: 1
  hidden-blocks:
    - minecraft:diamond_ore
    - minecraft:chest
    - minecraft:trapped_chest
    - minecraft:ender_chest
    - minecraft:barrel
    - minecraft:purple_shulker_box
  replacement-blocks:
    - minecraft:deepslate
  dimension-settings:
    minecraft:overworld:
      max-block-height: 320
      hidden-blocks:
        - minecraft:deepslate_diamond_ore
        - minecraft:chest
    minecraft:the_nether:
      custom-setting: preserve
      hidden-blocks:
        - minecraft:ancient_debris
        - minecraft:ender_chest
    minecraft:the_end:
      hidden-blocks:
        - minecraft:barrel
unrelated:
  keep: yes
`;

const migrated = renderFabricPacketAntiXrayConfig(legacy, true);
const migratedLists = assertNoUnsafeHiddenBlocks(migrated, 'migrated managed config');
assert.ok(migratedLists.flat().includes('minecraft:diamond_ore'));
assert.ok(migratedLists.flat().includes('minecraft:deepslate_diamond_ore'));
assert.ok(migratedLists.flat().includes('minecraft:ancient_debris'));
assert.match(migrated, /^# retain this comment$/m);
assert.match(migrated, /^\s+custom-setting: preserve$/m);
assert.match(migrated, /^unrelated:\n  keep: yes$/m);
assert.equal(renderFabricPacketAntiXrayConfig(migrated, true), migrated,
  'container cleanup should be idempotent after the first migration');

console.log('Minecraft Server Anti-Xray container safety test passed.');
