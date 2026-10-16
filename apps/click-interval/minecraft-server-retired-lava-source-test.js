'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const sourcePath = path.join(root, 'minecraft-server', 'main.js');
const temporaryBase = path.resolve(os.tmpdir());
const testRoot = fs.mkdtempSync(path.join(temporaryBase, 'click-interval-retired-lava-source-'));

function assertSafeTemporaryPath(target) {
  const resolved = path.resolve(target);
  const prefix = `${temporaryBase}${path.sep}`;
  if (!resolved.startsWith(prefix) || !path.basename(resolved).startsWith('click-interval-retired-lava-source-')) {
    throw new Error(`Refusing to clean an unsafe test path: ${resolved}`);
  }
  return resolved;
}

function loadBackend() {
  const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__retiredLavaSourceTest = {\n`
    + '  isRetiredLavaSourceInspection, isRetiredLavaSourceProviderSelection, retireUnsafeLavaSourceBeforeStart\n'
    + '};';
  const moduleMock = { exports: {} };
  const electronMock = {
    app: { getPath: () => testRoot, on: () => {} },
    BrowserWindow: { fromWebContents: () => null },
    ipcMain: { handle: () => {} },
    dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {}, powerSaveBlocker: {},
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value, 'utf8'),
      decryptString: value => value.toString('utf8')
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
    require: id => {
      if (id === 'electron') return electronMock;
      if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
      if (id.startsWith('./')) return require(path.join(path.dirname(sourcePath), id));
      return require(id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  return moduleMock.exports.__retiredLavaSourceTest;
}

async function run() {
  const api = loadBackend();
  assert(api, 'Lava Source retirement hooks failed to load.');
  assert.equal(api.isRetiredLavaSourceInspection({
    fabricModId: 'mr_lava_source',
    fabricVersion: '1.6.1'
  }), true);
  assert.equal(api.isRetiredLavaSourceInspection({
    fabricModId: 'mr_lava_source',
    fabricVersion: '1.6.2'
  }), false);
  assert.equal(api.isRetiredLavaSourceProviderSelection(
    'mods', 'lava-source', { title: 'Lava Source' }, { versionName: '1.6.1' }, 'lava-source-1.6.1.jar'
  ), true);
  assert.equal(api.isRetiredLavaSourceProviderSelection(
    'mods', 'lava-source', { title: 'Lava Source' }, { versionName: '1.6.2' }, 'lava-source-1.6.2.jar'
  ), false);
  assert.equal(api.isRetiredLavaSourceProviderSelection(
    'mods', 'lava-source', { title: 'Lava Source' }, { versionName: '1.6.2' }, 'lava-source-1.6.1.jar'
  ), false, 'updating away from the retired version must remain possible even when the destination keeps its old name');

  const profileRoot = path.join(testRoot, 'profile');
  const mods = path.join(profileRoot, 'mods');
  const datapacks = path.join(profileRoot, 'world', 'datapacks');
  const hotfix = path.join(datapacks, 'click_interval_disable_lava_source');
  const unrelatedPack = path.join(datapacks, 'unrelated-pack');
  const unrelatedTick = path.join(unrelatedPack, 'data', 'minecraft', 'tags', 'function', 'tick.json');
  const retiredBytes = Buffer.from('deterministic retired Lava Source fixture');
  const retiredHash = crypto.createHash('sha256').update(retiredBytes).digest('hex');
  const retiredJar = path.join(mods, 'renamed-lava-source.jar');
  const wrongIdentityJar = path.join(mods, 'same-bytes-unrelated.jar');
  const unrelatedJar = path.join(mods, 'unrelated.jar');
  await fs.promises.mkdir(hotfix, { recursive: true });
  await fs.promises.mkdir(path.dirname(unrelatedTick), { recursive: true });
  await fs.promises.writeFile(path.join(hotfix, 'pack.mcmeta'), '{"pack":{"description":"managed hotfix"}}');
  const unrelatedTickText = '{"values":["example:tick"]}';
  await fs.promises.writeFile(unrelatedTick, unrelatedTickText);
  await fs.promises.mkdir(mods, { recursive: true });
  await fs.promises.writeFile(retiredJar, retiredBytes);
  await fs.promises.writeFile(wrongIdentityJar, retiredBytes);
  await fs.promises.writeFile(unrelatedJar, 'unrelated');
  const addonMetadata = path.join(profileRoot, 'installed-addons.json');
  await fs.promises.writeFile(addonMetadata, JSON.stringify({
    version: 2,
    addons: [
      { kind: 'mods', file: 'renamed-lava-source.jar', source: 'imported' },
      { kind: 'mods', file: 'unrelated.jar', source: 'imported' }
    ]
  }, null, 2));

  const descriptors = {
    'renamed-lava-source.jar': { fabricModId: 'mr_lava_source', fabricVersion: '1.6.1' },
    'same-bytes-unrelated.jar': { fabricModId: 'unrelated_mod', fabricVersion: '1.6.1' },
    'unrelated.jar': { fabricModId: 'unrelated_mod', fabricVersion: '1.0.0' }
  };
  let revalidations = 0;
  const result = await api.retireUnsafeLavaSourceBeforeStart({
    paths: { root: profileRoot, mods, addonMetadata },
    config: { levelName: 'world' },
    revalidate: async () => { revalidations += 1; },
    descriptorIndex: {
      files: Object.entries(descriptors).map(([name, descriptor]) => ({ name, descriptor })),
      partial: false,
      warning: ''
    },
    artifactPin: {
      modId: 'mr_lava_source',
      version: '1.6.1',
      sha256: retiredHash,
      size: retiredBytes.length
    }
  });

  assert.deepEqual([...result.retired], ['renamed-lava-source.jar']);
  assert.equal(result.hotfixPreserved, true);
  assert(revalidations >= 2, 'profile ownership must be revalidated before retirement commits');
  assert.equal(fs.existsSync(retiredJar), false, 'the exact verified bad JAR must not remain loadable');
  assert.equal(fs.existsSync(path.join(profileRoot, 'retired-lava-source', 'renamed-lava-source.jar')), true,
    'the bad JAR must be moved to recoverable quarantine');
  assert.equal(fs.existsSync(wrongIdentityJar), true,
    'a same-size, same-hash JAR with a different mod identity must remain untouched');
  assert.equal(fs.existsSync(unrelatedJar), true, 'an unrelated JAR must remain untouched');
  assert.equal(fs.existsSync(hotfix), true,
    'the narrow manager-owned tick override must remain as a fail-safe until explicitly retired');
  assert.equal(await fs.promises.readFile(unrelatedTick, 'utf8'), unrelatedTickText,
    'unrelated datapack tick functions must remain untouched');
  const metadata = JSON.parse(await fs.promises.readFile(addonMetadata, 'utf8'));
  assert.equal(metadata.addons.some(entry => entry.file === 'renamed-lava-source.jar'), false);
  assert.equal(metadata.addons.some(entry => entry.file === 'unrelated.jar'), true);

  const second = await api.retireUnsafeLavaSourceBeforeStart({
    paths: { root: profileRoot, mods, addonMetadata },
    config: { levelName: 'world' },
    revalidate: async () => {},
    descriptorIndex: {
      files: [
        { name: 'same-bytes-unrelated.jar', descriptor: descriptors['same-bytes-unrelated.jar'] },
        { name: 'unrelated.jar', descriptor: descriptors['unrelated.jar'] }
      ],
      partial: false,
      warning: ''
    },
    artifactPin: {
      modId: 'mr_lava_source',
      version: '1.6.1',
      sha256: retiredHash,
      size: retiredBytes.length
    }
  });
  assert.deepEqual([...second.retired], []);
  assert.equal(second.hotfixPreserved, true, 'the fail-safe override must remain preserved on repeated startup checks');
}

run()
  .then(() => console.log('PASS retired Lava Source startup quarantine'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await fs.promises.rm(assertSafeTemporaryPath(testRoot), { recursive: true, force: true });
  });
