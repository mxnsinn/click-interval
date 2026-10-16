const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, 'minecraft-server', 'main.js');
const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__test = {\n`
  + '  PLAYER_INSPECTION_PHASES, parsePlayerInventorySnbt, parsePlayerEquipmentSnbt,\n'
  + '  mergePlayerInspectionItems, playerInspectionCommand\n'
  + '};';

const moduleMock = { exports: {} };
const electronMock = {
  app: { getPath: () => path.join(__dirname, 'work', 'player-equipment-test'), on: () => {} },
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
  },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }) }
};

vm.runInNewContext(source, {
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
}, { filename: sourcePath });

const test = moduleMock.exports.__test;
assert(test, 'Player equipment inspection hooks failed to load.');

const equipmentSnbt = '{'
  + 'feet:{id:"minecraft:diamond_boots",count:1},'
  + 'legs:{id:"minecraft:diamond_leggings",count:1},'
  + 'chest:{id:"minecraft:diamond_chestplate",count:1,components:{"minecraft:custom_name":\'{' 
  + '"text":"Comma, braces { and } stay inside this quoted component"}\'}},'
  + 'head:{id:"minecraft:diamond_helmet",count:1},'
  + 'offhand:{id:"minecraft:shield",count:1},'
  + 'mainhand:{id:"minecraft:diamond_sword",count:1}'
  + '}';

const equipment = JSON.parse(JSON.stringify(test.parsePlayerEquipmentSnbt(equipmentSnbt)));
assert.deepEqual(equipment.map(({ id, slot, section, index }) => ({ id, slot, section, index })), [
  { id: 'minecraft:shield', slot: -106, section: 'offhand', index: 0 },
  { id: 'minecraft:diamond_boots', slot: 100, section: 'armor', index: 3 },
  { id: 'minecraft:diamond_leggings', slot: 101, section: 'armor', index: 2 },
  { id: 'minecraft:diamond_chestplate', slot: 102, section: 'armor', index: 1 },
  { id: 'minecraft:diamond_helmet', slot: 103, section: 'armor', index: 0 }
]);
assert.deepEqual(JSON.parse(JSON.stringify(test.parsePlayerEquipmentSnbt('{}'))), []);

const legacyInventory = test.parsePlayerInventorySnbt('['
  + '{Slot:0b,id:"minecraft:sweet_berries",count:12},'
  + '{Slot:103b,id:"minecraft:iron_helmet",count:1},'
  + '{Slot:-106b,id:"minecraft:torch",count:32}'
  + ']');
const merged = JSON.parse(JSON.stringify(test.mergePlayerInspectionItems(legacyInventory, equipment)));
assert.equal(merged.find((item) => item.section === 'hotbar' && item.index === 0)?.id, 'minecraft:sweet_berries');
assert.equal(merged.find((item) => item.section === 'armor' && item.index === 0)?.id, 'minecraft:diamond_helmet');
assert.equal(merged.find((item) => item.section === 'offhand')?.id, 'minecraft:shield');
assert.equal(merged.filter((item) => item.section === 'armor' && item.index === 0).length, 1);
assert.equal(merged.filter((item) => item.section === 'offhand').length, 1);

const equipmentPhase = Array.from(test.PLAYER_INSPECTION_PHASES).find(([name]) => name === 'equipment');
assert.deepEqual(Array.from(equipmentPhase), ['equipment', 'equipment']);
assert.equal(test.playerInspectionCommand({ player: 'TestPlayer', phase: 'equipment' }), 'data get entity TestPlayer equipment');

const backendSource = fs.readFileSync(sourcePath, 'utf8');
assert.match(backendSource, /request\.phase === 'equipment' \? 1000 : 3000/,
  'an empty equipment compound must not stall each player refresh for three seconds');
assert.match(backendSource, /request\.phase === 'equipment' && \/Found no elements matching/,
  'Minecraft missing-path output should immediately advance an empty equipment phase');

const inspectorSource = fs.readFileSync(path.join(__dirname, 'player-inspector.js'), 'utf8');
assert.match(inspectorSource, /makeSlots\(\$\('armorInventory'\),\s*4,\s*'armor'\)/);
assert.match(inspectorSource, /makeSlots\(\$\('offhandInventory'\),\s*1,\s*'offhand'\)/);
assert.match(inspectorSource, /helmet:\s*normalize\(armor\.get\(0\)\)/);
assert.match(inspectorSource, /boots:\s*normalize\(armor\.get\(3\)\)/);

console.log('Minecraft 26.2 player equipment inspection tests passed.');
