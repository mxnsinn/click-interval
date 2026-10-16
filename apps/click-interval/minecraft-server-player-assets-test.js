'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  EQUIPMENT_SLOT_ENTRY_CANDIDATES,
  HUD_ENTRY_CANDIDATES,
  LIMITS,
  SafeZipArchive,
  crc32,
  defaultMinecraftVersionRoots,
  equipmentTexturePath,
  findLocalMinecraftClientJar,
  normalizeResourceLocation,
  normalizeVersion,
  readAssetsFromClientJar,
  resolveLocalMinecraftAssets,
  validatePng,
  validateZipEntryName
} = require('./minecraft-server/player-assets');

function pngChunk(type, payload) {
  const name = Buffer.from(type, 'ascii');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, payload])));
  return Buffer.concat([header, name, payload, checksum]);
}

function makePng(red = 170, green = 40, blue = 75, alpha = 255) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = zlib.deflateSync(Buffer.from([0, red, green, blue, alpha]));
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', pixels),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function makeZip(entries, options = {}) {
  const locals = [];
  const central = [];
  let localOffset = 0;
  for (const [index, entry] of entries.entries()) {
    const name = Buffer.from(entry.name, 'utf8');
    const source = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const method = entry.method === 8 ? 8 : 0;
    const compressed = method === 8 ? zlib.deflateRawSync(source) : source;
    const checksum = entry.badChecksum ? ((crc32(source) + 1) >>> 0) : crc32(source);
    const flags = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(source.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(0, 30);
    record.writeUInt16LE(0, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt32LE(0, 38);
    record.writeUInt32LE(localOffset, 42);
    central.push(record, name);
    localOffset += local.length + name.length + compressed.length;
    assert.equal(index < 0xffff, true);
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  if (options.badDirectoryOffset) end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([...locals, directory, end]);
}

function fixtureEntries(version, png) {
  const entries = [
    { name: 'version.json', data: JSON.stringify({ id: version }), method: 8 },
    { name: 'assets/minecraft/textures/item/sweet_berries.png', data: png, method: 8 },
    { name: 'assets/minecraft/textures/item/diamond_chestplate.png', data: png, method: 8 },
    { name: 'assets/minecraft/textures/entity/equipment/humanoid/diamond.png', data: png, method: 8 },
    { name: 'assets/minecraft/textures/block/stone.png', data: png },
    {
      name: 'assets/minecraft/items/model_only.json',
      data: JSON.stringify({ model: { type: 'minecraft:model', model: 'minecraft:item/model_only' } })
    },
    {
      name: 'assets/minecraft/items/dynamic_item.json',
      data: JSON.stringify({
        model: {
          type: 'minecraft:select',
          cases: [{ model: { type: 'minecraft:range_dispatch', entries: [{ threshold: 0, model: { type: 'minecraft:model', model: 'minecraft:item/model_only' } }] } }]
        }
      })
    },
    {
      name: 'assets/minecraft/models/item/model_only.json',
      data: JSON.stringify({ parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:item/sweet_berries' } })
    },
    {
      name: 'assets/minecraft/models/item/old_alias.json',
      data: JSON.stringify({ parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:item/sweet_berries' } })
    }
  ];
  for (const groups of Object.values(HUD_ENTRY_CANDIDATES)) {
    for (const candidates of Object.values(groups)) entries.push({ name: candidates[0], data: png });
  }
  for (const entry of Object.values(EQUIPMENT_SLOT_ENTRY_CANDIDATES)) entries.push({ name: entry, data: png });
  return entries;
}

async function main() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'click-interval-player-assets-'));
  const versionsRoot = path.join(temporaryRoot, 'versions');
  const version = '1.21.4';
  const versionRoot = path.join(versionsRoot, version);
  const jarPath = path.join(versionRoot, `${version}.jar`);
  const metadataPath = path.join(versionRoot, `${version}.json`);
  const png = makePng();
  await fs.mkdir(versionRoot, { recursive: true });
  try {
    assert.equal(normalizeVersion('1.21.4'), '1.21.4');
    for (const unsafe of ['', '.', '..', '../1.21', '1.21/../../bad', 'C:\\bad', 'bad version']) {
      assert.throws(() => normalizeVersion(unsafe), /safe folder name/);
    }
    assert.deepEqual(normalizeResourceLocation('sweet_berries'), {
      namespace: 'minecraft', path: 'sweet_berries', id: 'minecraft:sweet_berries'
    });
    assert.deepEqual(normalizeResourceLocation('example:tool/part'), {
      namespace: 'example', path: 'tool/part', id: 'example:tool/part'
    });
    assert.equal(equipmentTexturePath(normalizeResourceLocation('minecraft:diamond_chestplate')), 'assets/minecraft/textures/entity/equipment/humanoid/diamond.png');
    assert.equal(equipmentTexturePath(normalizeResourceLocation('minecraft:golden_leggings')), 'assets/minecraft/textures/entity/equipment/humanoid_leggings/gold.png');
    for (const unsafe of ['minecraft:../secret', 'minecraft:/root', 'Bad:thing', 'minecraft:a//b']) {
      assert.equal(normalizeResourceLocation(unsafe), null);
    }
    assert.equal(validateZipEntryName('assets/minecraft/test.png'), 'assets/minecraft/test.png');
    for (const unsafe of ['../escape', '/absolute', 'C:/absolute', 'bad\\path', `nul\0name`]) {
      assert.throws(() => validateZipEntryName(unsafe), /unsafe archive path/);
    }
    assert(defaultMinecraftVersionRoots({ APPDATA: 'C:\\Users\\Test\\AppData\\Roaming' }, 'C:\\Users\\Test').some((root) => root.endsWith(path.join('.minecraft', 'versions'))));

    const jar = makeZip(fixtureEntries(version, png));
    await fs.writeFile(jarPath, jar);
    const sha1 = crypto.createHash('sha1').update(jar).digest('hex');
    await fs.writeFile(metadataPath, JSON.stringify({ id: version, downloads: { client: { size: jar.length, sha1 } } }));

    const located = await findLocalMinecraftClientJar(version, { roots: [versionsRoot] });
    assert(located, 'the exact injected client version should be found');
    assert.equal(located.jarPath, await fs.realpath(jarPath));
    assert.equal(located.verification, 'sha1');

    const result = await readAssetsFromClientJar(jarPath, {
      version,
      itemIds: [
        'minecraft:sweet_berries',
        'minecraft:stone',
        'minecraft:model_only',
        'minecraft:dynamic_item',
        'minecraft:old_alias',
        'minecraft:diamond_chestplate',
        'example:modded_item',
        'minecraft:not_real',
        '../invalid',
        'minecraft:sweet_berries'
      ]
    });
    assert.equal(result.available, true);
    assert.match(result.hud.heart.empty, /^data:image\/png;base64,/);
    assert.match(result.hud.heart.half, /^data:image\/png;base64,/);
    assert.match(result.hud.heart.full, /^data:image\/png;base64,/);
    assert.match(result.hud.hunger.empty, /^data:image\/png;base64,/);
    assert.match(result.hud.hunger.half, /^data:image\/png;base64,/);
    assert.match(result.hud.hunger.full, /^data:image\/png;base64,/);
    assert.match(result.hud.xp.background, /^data:image\/png;base64,/);
    assert.match(result.hud.xp.progress, /^data:image\/png;base64,/);
    assert(Object.values(result.equipmentSlots).every((value) => /^data:image\/png;base64,/.test(value)), 'equipment slot textures should come from the local client JAR');
    assert.equal(result.items.length, 9, 'duplicate requests should be coalesced');
    assert.deepEqual(result.items.map((item) => [item.id, item.status, item.kind]), [
      ['minecraft:sweet_berries', 'resolved', 'item'],
      ['minecraft:stone', 'resolved', 'block'],
      ['minecraft:model_only', 'resolved', 'model'],
      ['minecraft:dynamic_item', 'resolved', 'model'],
      ['minecraft:old_alias', 'resolved', 'model'],
      ['minecraft:diamond_chestplate', 'resolved', 'item'],
      ['example:modded_item', 'unsupported-namespace', ''],
      ['minecraft:not_real', 'missing', ''],
      ['../invalid', 'invalid', '']
    ]);
    assert(result.items.slice(0, 6).every((item) => /^data:image\/png;base64,/.test(item.dataUrl)));
    assert.match(result.items.find((item) => item.id === 'minecraft:diamond_chestplate').equipmentDataUrl, /^data:image\/png;base64,/);
    validatePng(Buffer.from(result.items[0].dataUrl.split(',')[1], 'base64'));

    const localResult = await resolveLocalMinecraftAssets({ version, roots: [versionsRoot], itemIds: ['sweet_berries', 'mod:item'] });
    assert.equal(localResult.available, true);
    assert.equal(localResult.clientVerification, 'sha1');
    assert.deepEqual(localResult.items.map((item) => item.status), ['resolved', 'unsupported-namespace']);

    const missingResult = await resolveLocalMinecraftAssets({
      version: '1.20.1', roots: [versionsRoot], itemIds: ['minecraft:stone', 'mod:item', '../bad']
    });
    assert.equal(missingResult.available, false);
    assert.equal(missingResult.reason, 'client-jar-not-found');
    assert.deepEqual(missingResult.items.map((item) => item.status), ['client-unavailable', 'unsupported-namespace', 'invalid']);
    assert.deepEqual(missingResult.hud, {
      heart: { empty: '', half: '', full: '' },
      hunger: { empty: '', half: '', full: '' },
      xp: { background: '', progress: '' }
    });
    assert.deepEqual(missingResult.equipmentSlots, { helmet: '', chestplate: '', leggings: '', boots: '', offhand: '' });

    const tooMany = Array.from({ length: LIMITS.maximumRequestedItems + 5 }, (_, index) => `minecraft:item_${index}`);
    const limitedResult = await resolveLocalMinecraftAssets({ version: '1.20.1', roots: [], itemIds: tooMany });
    assert.equal(limitedResult.truncated, true);
    assert.equal(limitedResult.items.length, LIMITS.maximumRequestedItems);

    await fs.writeFile(metadataPath, JSON.stringify({ id: version, downloads: { client: { size: jar.length, sha1: '0'.repeat(40) } } }));
    assert.equal(await findLocalMinecraftClientJar(version, { roots: [versionsRoot] }), null, 'a sidecar hash mismatch must reject the JAR');
    await fs.writeFile(metadataPath, JSON.stringify({ id: version, downloads: { client: { size: jar.length, sha1 } } }));

    const mismatchJar = path.join(temporaryRoot, 'mismatch.jar');
    await fs.writeFile(mismatchJar, makeZip(fixtureEntries('1.20.1', png)));
    await assert.rejects(readAssetsFromClientJar(mismatchJar, { version, itemIds: [] }), /does not match/);

    const traversalJar = path.join(temporaryRoot, 'traversal.jar');
    await fs.writeFile(traversalJar, makeZip([{ name: '../escape.png', data: png }]));
    await assert.rejects(SafeZipArchive.open(traversalJar), /unsafe archive path/);

    const duplicateJar = path.join(temporaryRoot, 'duplicate.jar');
    await fs.writeFile(duplicateJar, makeZip([
      { name: 'assets/minecraft/test.png', data: png },
      { name: 'ASSETS/MINECRAFT/TEST.PNG', data: png }
    ]));
    await assert.rejects(SafeZipArchive.open(duplicateJar), /duplicate archive paths/);

    const corruptJar = path.join(temporaryRoot, 'corrupt.jar');
    await fs.writeFile(corruptJar, makeZip([
      { name: 'version.json', data: JSON.stringify({ id: version }) },
      { name: HUD_ENTRY_CANDIDATES.heart.full[0], data: png, badChecksum: true }
    ]));
    await assert.rejects(readAssetsFromClientJar(corruptJar, { version, itemIds: [] }), /integrity check/);

    const badDirectoryJar = path.join(temporaryRoot, 'bad-directory.jar');
    await fs.writeFile(badDirectoryJar, makeZip([{ name: 'version.json', data: '{}' }], { badDirectoryOffset: true }));
    await assert.rejects(SafeZipArchive.open(badDirectoryJar), /unsupported ZIP directory/);

    const fallback = await resolveLocalMinecraftAssets({ version: '../unsafe', roots: [versionsRoot], itemIds: ['minecraft:stone'] });
    assert.equal(fallback.reason, 'invalid-version');
    assert.equal(fallback.items[0].status, 'client-unavailable');

    console.log('PASS Minecraft local player asset helper');
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
