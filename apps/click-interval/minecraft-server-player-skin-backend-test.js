const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, 'minecraft-server', 'main.js');
const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__test = {\n`
  + '  normalizePlayerSkinRequest, emptyPlayerSkinResult, normalizeOfficialSkinTextureUrl,\n'
  + '  parseOfficialPlayerSkinProfile, validatePlayerSkinPng, normalizePlayerSkinDataUrl,\n'
  + '  getPlayerSkinCacheFiles, normalizeCachedPlayerSkin, readCachedPlayerSkin, writeCachedPlayerSkin\n'
  + '};';

const ipcHandlers = new Map();
const testUserData = path.join(__dirname, 'work', `player-skin-test-${process.pid}`);
const electronMock = {
  app: { getPath: () => testUserData, on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: (name, handler) => ipcHandlers.set(name, handler) },
  dialog: {},
  shell: {},
  Menu: {},
  clipboard: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8')
  },
  nativeImage: {
    createFromBuffer: (value) => ({
      isEmpty: () => !Buffer.isBuffer(value) || value.length < 57,
      getSize: () => ({ width: value.readUInt32BE(16), height: value.readUInt32BE(20) })
    })
  }
};
const moduleMock = { exports: {} };
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
    if (id === './mod-policy') return require(path.join(path.dirname(sourcePath), 'mod-policy.js'));
    if (id === './access-policy') return require(path.join(path.dirname(sourcePath), 'access-policy.js'));
    if (id === './protection-messages') return require(path.join(path.dirname(sourcePath), 'protection-messages.js'));
    if (id === './protection-tuning') return require(path.join(path.dirname(sourcePath), 'protection-tuning.js'));
    if (id === './player-assets') return require(path.join(path.dirname(sourcePath), 'player-assets.js'));
    if (id === './nat-lease-ownership') return require(path.join(path.dirname(sourcePath), 'nat-lease-ownership.js'));
    if (id === './performance-safety') return require(path.join(path.dirname(sourcePath), 'performance-safety.js'));
    return require(id);
  }
};

vm.runInNewContext(source, sandbox, { filename: sourcePath });
const test = moduleMock.exports.__test;

function minecraftPng(width = 64, height = 64) {
  const chunk = (type, data = Buffer.alloc(0)) => {
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length, 0);
    output.write(type, 4, 'ascii');
    data.copy(output, 8);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
    chunk('IEND')
  ]);
}

(async () => {
  assert(test, 'Player skin backend hooks failed to load.');
  assert(ipcHandlers.has('players:getSkin'), 'Missing player skin IPC handler.');
  assert.deepEqual(
    JSON.parse(JSON.stringify(await ipcHandlers.get('players:getSkin')({}, {}))),
    { name: '', uuid: '', model: 'classic', skinDataUrl: '' }
  );

  const compactUuid = '069a79f444e94726a5befca90e38aaf5';
  const uuid = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
  const textureHash = 'a'.repeat(64);
  const textureSignature = Buffer.alloc(256, 0xa5).toString('base64');
  const texturePayload = Buffer.from(JSON.stringify({
    profileId: compactUuid,
    profileName: 'Notch',
    textures: {
      SKIN: {
        url: `http://textures.minecraft.net/texture/${textureHash}`,
        metadata: { model: 'slim' }
      }
    }
  }), 'utf8').toString('base64');
  const parsed = test.parseOfficialPlayerSkinProfile({
    id: compactUuid,
    name: 'Notch',
    properties: [{ name: 'textures', value: texturePayload, signature: textureSignature }]
  }, { name: 'Notch', uuid });
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    name: 'Notch',
    uuid,
    model: 'slim',
    skinUrl: `https://textures.minecraft.net/texture/${textureHash}`
  });
  const renamedUuidProfile = test.parseOfficialPlayerSkinProfile({
    id: compactUuid,
    name: 'Notch',
    properties: [{ name: 'textures', value: texturePayload, signature: textureSignature }]
  }, { name: 'DifferentName', uuid });
  assert.equal(renamedUuidProfile.uuid, uuid, 'a caller-supplied UUID should remain authoritative after an account rename');
  assert.throws(() => test.parseOfficialPlayerSkinProfile({
    id: compactUuid,
    name: 'Notch',
    properties: [{ name: 'textures', value: texturePayload, signature: textureSignature }]
  }, { name: 'DifferentName', uuid }, { enforceRequestedName: true }), /name did not match/, 'a UUID obtained only from a stale local name mapping must be re-resolved');
  assert.equal(
    test.normalizeOfficialSkinTextureUrl(`http://textures.minecraft.net/texture/${textureHash}`),
    `https://textures.minecraft.net/texture/${textureHash}`
  );
  assert.equal(
    test.normalizeOfficialSkinTextureUrl(`https://textures.minecraft.net/texture/${textureHash}`),
    `https://textures.minecraft.net/texture/${textureHash}`
  );
  for (const unsafe of [
    `http://evil.example/texture/${textureHash}`,
    `https://cdn.textures.minecraft.net/texture/${textureHash}`,
    `https://user@textures.minecraft.net/texture/${textureHash}`,
    `https://textures.minecraft.net:444/texture/${textureHash}`,
    `https://textures.minecraft.net/texture/${textureHash}?download=1`,
    'file:///skin.png'
  ]) assert.throws(() => test.normalizeOfficialSkinTextureUrl(unsafe), /skin URL/);
  assert.throws(() => test.parseOfficialPlayerSkinProfile({
    id: '12345678123442349234123456789abc',
    name: 'Notch',
    properties: [{ name: 'textures', value: texturePayload }]
  }, { name: 'Notch', uuid }), /UUID did not match/);
  assert.throws(() => test.parseOfficialPlayerSkinProfile({
    id: compactUuid,
    name: 'Notch',
    properties: [{ name: 'textures', value: texturePayload }]
  }, { name: 'Notch', uuid }), /not signed/);

  const png = minecraftPng();
  assert.strictEqual(test.validatePlayerSkinPng(png), png);
  assert.throws(() => test.validatePlayerSkinPng(minecraftPng(128, 64)), /64-pixel/);
  const forgedHeader = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(forgedHeader, 0);
  forgedHeader.writeUInt32BE(13, 8);
  forgedHeader.write('IHDR', 12, 'ascii');
  forgedHeader.writeUInt32BE(64, 16);
  forgedHeader.writeUInt32BE(64, 20);
  assert.throws(() => test.validatePlayerSkinPng(forgedHeader), /invalid|incomplete/, 'a forged PNG header must not enter the persistent cache');
  assert.throws(() => test.validatePlayerSkinPng(Buffer.from('not a png')), /invalid/);
  const skinDataUrl = `data:image/png;base64,${png.toString('base64')}`;
  assert.equal(test.normalizePlayerSkinDataUrl(skinDataUrl), skinDataUrl);

  fs.rmSync(testUserData, { recursive: true, force: true });
  const stored = await test.writeCachedPlayerSkin({ name: 'Notch', uuid, model: 'slim', skinDataUrl });
  assert.equal(stored.uuid, uuid);
  const cacheFiles = test.getPlayerSkinCacheFiles({ name: 'Notch', uuid });
  assert.equal(cacheFiles.length, 2);
  assert(cacheFiles.every((file) => path.resolve(file).startsWith(path.resolve(testUserData, 'cache', 'player-skins') + path.sep)));
  assert(cacheFiles.every((file) => fs.existsSync(file)));
  const byUuid = await test.readCachedPlayerSkin({ uuid }, false);
  assert.equal(byUuid.result.name, 'Notch');
  assert.equal(byUuid.result.model, 'slim');
  const byName = await test.readCachedPlayerSkin({ name: 'notch' }, true);
  assert.equal(byName.result.uuid, uuid);
  assert.equal(await test.readCachedPlayerSkin({ name: 'notch' }, false), null, 'Offline mode must not trust a public name alias.');

  const rootPreload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const legacyPreload = fs.readFileSync(path.join(__dirname, 'minecraft-server', 'preload.js'), 'utf8');
  for (const preload of [rootPreload, legacyPreload]) {
    assert.match(preload, /getPlayerSkin:\s*[^\n]*players:getSkin/, 'Preload must expose the player skin API.');
  }
  assert.match(source, /const candidates = \[paths\.playerCache, paths\.nativePlayerBans/, 'authenticated usercache identity should outrank stale ban records');
  assert.match(source, /statusPlayersByName[\s\S]*uuid: statusPlayersByName\.get\(name\.toLowerCase\(\)\)\?\.uuid/, 'live log names should retain UUIDs supplied by the status protocol');
  assert.match(source, /nativeImage\?\.createFromBuffer/, 'skin PNGs should be decoded before they enter the persistent cache');

  fs.rmSync(testUserData, { recursive: true, force: true });
  console.log('Minecraft player skin backend tests passed.');
})().catch((error) => {
  fs.rmSync(testUserData, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
