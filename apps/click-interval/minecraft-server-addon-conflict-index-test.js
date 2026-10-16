'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createPluginDescriptorIndex } = require('./minecraft-server/addon-descriptor-index');

const root = __dirname;
const mainPath = path.join(root, 'minecraft-server', 'main.js');
const mainText = fs.readFileSync(mainPath, 'utf8');
const uiText = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');
const source = `${mainText}\nmodule.exports.__addonConflictTest = {\n` +
  '  getPluginDescriptorIndex, findBundledTeleportCommandConflicts, findVoicePluginConflicts,\n' +
  '  inspectJarDescriptor, inspectAntiCheatJar\n' +
  '};';

let hashCalls = 0;
const cryptoMock = Object.create(crypto);
cryptoMock.createHash = (...args) => {
  hashCalls += 1;
  return crypto.createHash(...args);
};
const electronMock = {
  app: { getPath: () => path.join(root, 'work', 'addon-conflict-unused'), on: () => {} },
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
    if (id === 'crypto') return cryptoMock;
    if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
    if (id.startsWith('./')) return require(path.join(path.dirname(mainPath), id));
    return require(id);
  }
};
vm.runInNewContext(source, sandbox, { filename: mainPath });
const main = moduleMock.exports.__addonConflictTest;

assert.ok(main, 'Add-on conflict test hooks failed to load.');
const teleportConflictSource = mainText.slice(
  mainText.indexOf('async function findBundledTeleportCommandConflicts'),
  mainText.indexOf('function isServerStoppedForServerToolChanges')
);
const voiceConflictSource = mainText.slice(
  mainText.indexOf('async function findVoicePluginConflicts'),
  mainText.indexOf('async function readBundledVoiceRuntimeStatus')
);
for (const conflictSource of [teleportConflictSource, voiceConflictSource]) {
  assert.doesNotMatch(conflictSource, /calculateFileHash|inspectAntiCheatJar/,
    'descriptor-only conflict discovery must never hash unrelated JARs');
  assert.match(conflictSource, /getPluginDescriptorIndex/,
    'both conflict paths must use the shared per-profile descriptor index');
}
assert.match(mainText, /async function inspectAntiCheatJar\(file\)[\s\S]*?calculateFileHash\(file, 'sha256'\)/,
  'integrity-sensitive managed and import paths must retain SHA-256 inspection');
assert.doesNotMatch(mainText.slice(mainText.indexOf('async function listJarFiles'), mainText.indexOf('function installedAddonKey')),
  /fs\.readdir/,
  'add-on enumeration must not materialize an unbounded directory listing');
for (const budget of [
  'MAX_PLUGIN_DESCRIPTOR_INSPECTIONS',
  'MAX_PLUGIN_DESCRIPTOR_SCAN_BYTES',
  'MAX_PLUGIN_DESCRIPTOR_PARSED_ENTRIES',
  'MAX_PLUGIN_DESCRIPTOR_SCAN_MS'
]) assert.match(mainText, new RegExp(budget), `missing aggregate descriptor budget ${budget}`);
assert.match(mainText, /canInstall: Boolean\([\s\S]*?!descriptorIndex\.partial/,
  'a partial descriptor scan must fail built-in tool installation closed');
assert.match(mainText, /if \(descriptorIndex\.partial\) throw new Error\(`\$\{descriptorIndex\.warning\} No files were changed\.`\)/,
  'mutation-time conflict checks must reject partial scans');

assert.doesNotMatch(uiText, /load(?:Teleport|Voice)AddonStatus|renderBundled(?:Teleport|Voice)Result/,
  'retired built-in add-on cards must not trigger conflict scans from the add-ons page');
assert.match(uiText, /INSTALLED_ADDON_UPDATE_CONCURRENCY = 4/,
  'provider update checks must use bounded concurrency');
assert.match(uiText, /task\.generation !== installedAddonUpdateGeneration/,
  'provider update checks must ignore stale profile generations');
const refreshSource = uiText.slice(uiText.indexOf('function refresh()'), uiText.indexOf('buildSettings();'));
assert.doesNotMatch(refreshSource, /load(?:Teleport|Voice)AddonStatus\(true\)/,
  'the routine status poll must not force conflict scans');
const installedRenderSource = uiText.slice(
  uiText.indexOf('function installedAddonListSignature'),
  uiText.indexOf('function normalizeAddonName')
);
assert.match(installedRenderSource, /installedAddonRenderSignature === signature/,
  'unchanged installed add-on lists must skip DOM reconstruction');
assert.match(installedRenderSource, /previousScrollTop/,
  'installed add-on refreshes must preserve list scrolling');

(async () => {
  const temporaryRoot = path.join(root, 'work', 'addon-conflict-index-test');
  const plugins = path.join(temporaryRoot, 'profile-a', 'plugins');
  const otherPlugins = path.join(temporaryRoot, 'profile-b', 'plugins');
  const budgetPlugins = path.join(temporaryRoot, 'budget-profile', 'plugins');
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
  await fsp.mkdir(plugins, { recursive: true });
  await fsp.mkdir(otherPlugins, { recursive: true });
  await fsp.mkdir(budgetPlugins, { recursive: true });
  try {
    const teleportJar = path.join(root, 'minecraft-server', 'server-teleport', 'dist', 'ServerTeleport.jar');
    const voiceJar = path.join(root, 'minecraft-server', 'proximity-voice', 'dist', 'ProximityVoice-Server.jar');
    assert.ok(fs.existsSync(teleportJar), 'Bundled teleport artifact is missing.');
    assert.ok(fs.existsSync(voiceJar), 'Bundled voice artifact is missing.');
    await fsp.copyFile(teleportJar, path.join(plugins, 'JustTPA.jar'));
    await fsp.copyFile(voiceJar, path.join(plugins, 'SimpleVoiceChat.jar'));

    const paths = { root: path.dirname(plugins), plugins };
    const pendingA = main.getPluginDescriptorIndex(paths);
    const pendingB = main.getPluginDescriptorIndex(paths);
    assert.strictEqual(pendingA, pendingB, 'concurrent same-profile scans must return the same pending promise');
    const first = await pendingA;
    assert.equal(hashCalls, 0, 'descriptor conflict discovery must not invoke SHA-256');
    assert.equal(first.partial, false);
    assert.equal(first.files.length, 2);
    assert.ok(first.files.every(file => file.descriptor?.scanBytes > 0 && file.descriptor?.parsedEntries > 0),
      'real descriptor inspection must report aggregate byte and ZIP-entry consumption');
    assert.ok(first.scanBytes <= first.budgets.maxScanBytes);
    assert.ok(first.parsedEntries <= first.budgets.maxParsedEntries);

    const teleportConflicts = await main.findBundledTeleportCommandConflicts(paths, first);
    const voiceConflicts = await main.findVoicePluginConflicts(paths, first);
    assert.ok(teleportConflicts.some(conflict => conflict.file === 'JustTPA.jar'));
    assert.ok(voiceConflicts.some(conflict => conflict.file === 'SimpleVoiceChat.jar'));
    assert.equal(hashCalls, 0, 'filtering both tools from the shared index must remain descriptor-only');

    const unchanged = await main.getPluginDescriptorIndex(paths);
    assert.strictEqual(unchanged, first, 'an unchanged strong file-identity signature must reuse descriptor results');
    assert.equal(hashCalls, 0);

    await fsp.copyFile(teleportJar, path.join(plugins, 'Essentials.jar'));
    const changed = await main.getPluginDescriptorIndex(paths);
    assert.notEqual(changed.signature, first.signature, 'a plugin mutation must change the descriptor signature');
    assert.ok((await main.findBundledTeleportCommandConflicts(paths, changed))
      .some(conflict => conflict.file === 'Essentials.jar'));
    assert.equal(hashCalls, 0);

    const replacement = path.join(plugins, 'JustTPA.jar');
    const previousStat = await fsp.stat(replacement);
    const stagedReplacement = path.join(plugins, 'JustTPA.replacement');
    await fsp.copyFile(teleportJar, stagedReplacement);
    await fsp.utimes(stagedReplacement, previousStat.atime, previousStat.mtime);
    await fsp.rm(replacement, { force: true });
    await fsp.rename(stagedReplacement, replacement);
    await fsp.utimes(replacement, previousStat.atime, previousStat.mtime);
    const replaced = await main.getPluginDescriptorIndex(paths);
    assert.notEqual(replaced.signature, changed.signature,
      'same-name/size/mtime replacement must invalidate through ctime or filesystem identity');
    assert.equal(hashCalls, 0);

    await fsp.writeFile(path.join(plugins, 'ordinary.jar'), Buffer.from('not a jar'));
    const malformed = await main.getPluginDescriptorIndex(paths);
    assert.equal(malformed.partial, true, 'any malformed descriptor must make the whole conflict scan partial');
    assert.match(malformed.warning, /unreadable or malformed/i, 'partial warnings must tell the user how to recover');
    assert.ok(malformed.files.find(file => file.name === 'ordinary.jar')?.inspectionError,
      'a malformed JAR must be isolated while making installation fail safe');
    assert.ok(malformed.partialReasons.some(reason => /inspection error/i.test(reason)));
    assert.equal(hashCalls, 0, 'malformed descriptor handling must not fall back to hashing');

    await assert.rejects(
      () => main.inspectJarDescriptor(teleportJar, {
        deadlineAt: Date.now() + 5_000,
        maxScanBytes: 1,
        maxParsedEntries: 50_000
      }),
      error => error?.code === 'PLUGIN_DESCRIPTOR_SCAN_BUDGET' && /byte budget/i.test(error.budgetReason),
      'the real ZIP inspector must reject a central directory before exceeding its remaining byte budget'
    );
    await assert.rejects(
      () => main.inspectJarDescriptor(teleportJar, {
        deadlineAt: Date.now() + 5_000,
        maxScanBytes: 16 * 1024 * 1024,
        maxParsedEntries: 1
      }),
      error => error?.code === 'PLUGIN_DESCRIPTOR_SCAN_BUDGET' && /entry parsing budget/i.test(error.budgetReason),
      'the real ZIP inspector must enforce the remaining parsed-entry budget'
    );
    assert.equal(hashCalls, 0, 'budget failures must remain descriptor-only');

    let inspections = 0;
    const bounded = createPluginDescriptorIndex({
      maxEntries: 2,
      implementationVersion: 'bounded-test-v1',
      inspectDescriptor: async file => {
        inspections += 1;
        if (path.basename(file).startsWith('bad')) throw new Error('malformed');
        return { pluginName: path.basename(file), declaredCommands: [], scanBytes: 1, parsedEntries: 1 };
      }
    });
    await Promise.all([
      fsp.writeFile(path.join(otherPlugins, 'a.jar'), 'a'),
      fsp.writeFile(path.join(otherPlugins, 'bad.jar'), 'bad'),
      fsp.writeFile(path.join(otherPlugins, 'c.jar'), 'c')
    ]);
    const boundedPendingA = bounded.get('profile-b', otherPlugins);
    const boundedPendingB = bounded.get('profile-b', otherPlugins);
    assert.strictEqual(boundedPendingA, boundedPendingB, 'index singleflight must expose the same promise');
    const boundedResult = await boundedPendingA;
    assert.equal(boundedResult.partial, true, 'enumeration over the hard cap must be marked partial');
    assert.match(boundedResult.warning, /safety limit/i, 'a partial scan must surface a safe warning');
    assert.ok(boundedResult.entriesVisited <= 2, 'bounded enumeration must respect its configured entry budget');
    assert.ok(boundedResult.files.length <= 2);
    assert.ok(boundedResult.files.every(file => file.descriptor || file.inspectionError),
      'malformed JARs must not fail the whole index');
    const isolated = await bounded.get('different-profile', otherPlugins);
    assert.notStrictEqual(isolated, boundedResult, 'descriptor caches must remain profile-isolated');

    let statErrorInspections = 0;
    const statErrorIndex = createPluginDescriptorIndex({
      maxEntries: 4,
      implementationVersion: 'stat-error-v1',
      enumerateFiles: async () => ({
        files: [{
          name: 'unreadable.jar', path: path.join(otherPlugins, 'unreadable.jar'), size: 0,
          modifiedAt: 0, createdAt: 0, fileId: '', statError: 'access denied'
        }],
        entriesVisited: 1,
        partial: false,
        partialReasons: []
      }),
      inspectDescriptor: async () => { statErrorInspections += 1; return {}; }
    });
    const statFailed = await statErrorIndex.get('stat-error', otherPlugins);
    assert.equal(statErrorInspections, 0, 'a failed stat must never continue into descriptor I/O');
    assert.equal(statFailed.partial, true, 'any stat failure must fail the aggregate scan closed');
    assert.ok(statFailed.partialReasons.includes('plugin file metadata error'));

    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      fsp.writeFile(path.join(budgetPlugins, `${String(index).padStart(2, '0')}.jar`), String(index))));

    let inspectionBudgetCalls = 0;
    const inspectionBudgetIndex = createPluginDescriptorIndex({
      maxEntries: 64,
      maxJarInspections: 2,
      maxScanBytes: 1024,
      maxParsedEntries: 1024,
      maxDurationMs: 5000,
      implementationVersion: 'inspection-budget-v1',
      inspectDescriptor: async file => {
        inspectionBudgetCalls += 1;
        return { pluginName: path.basename(file), scanBytes: 10, parsedEntries: 1 };
      }
    });
    const inspectionLimited = await inspectionBudgetIndex.get('inspection-budget', budgetPlugins);
    assert.equal(inspectionBudgetCalls, 2, 'the aggregate inspection-count budget must stop opening additional JARs');
    assert.equal(inspectionLimited.partial, true);
    assert.ok(inspectionLimited.partialReasons.some(reason => /inspection-count budget/i.test(reason)));

    let byteBudgetCalls = 0;
    const byteBudgetIndex = createPluginDescriptorIndex({
      maxEntries: 64,
      maxJarInspections: 64,
      maxScanBytes: 10,
      maxParsedEntries: 1024,
      maxDurationMs: 5000,
      implementationVersion: 'byte-budget-v1',
      inspectDescriptor: async (file, budget) => {
        byteBudgetCalls += 1;
        if (budget.maxScanBytes < 6) {
          const error = new Error('byte budget');
          error.budgetReason = 'central-directory/descriptor byte budget exceeded';
          throw error;
        }
        return { pluginName: path.basename(file), scanBytes: 6, parsedEntries: 1 };
      }
    });
    const byteLimited = await byteBudgetIndex.get('byte-budget', budgetPlugins);
    assert.equal(byteBudgetCalls, 2, 'remaining byte budget must be passed to and enforced by the inspector');
    assert.ok(byteLimited.scanBytes <= 10);
    assert.ok(byteLimited.partialReasons.some(reason => /byte budget/i.test(reason)));

    let entryBudgetCalls = 0;
    const entryBudgetIndex = createPluginDescriptorIndex({
      maxEntries: 64,
      maxJarInspections: 64,
      maxScanBytes: 1024,
      maxParsedEntries: 3,
      maxDurationMs: 5000,
      implementationVersion: 'entry-budget-v1',
      inspectDescriptor: async (file, budget) => {
        entryBudgetCalls += 1;
        if (budget.maxParsedEntries < 2) {
          const error = new Error('entry budget');
          error.budgetReason = 'ZIP-entry parsing budget exceeded';
          throw error;
        }
        return { pluginName: path.basename(file), scanBytes: 1, parsedEntries: 2 };
      }
    });
    const entryLimited = await entryBudgetIndex.get('entry-budget', budgetPlugins);
    assert.equal(entryBudgetCalls, 2, 'remaining ZIP-entry budget must stop further parsing');
    assert.ok(entryLimited.parsedEntries <= 3);
    assert.ok(entryLimited.partialReasons.some(reason => /entry parsing budget/i.test(reason)));

    let timeBudgetCalls = 0;
    const timeBudgetIndex = createPluginDescriptorIndex({
      maxEntries: 64,
      maxJarInspections: 64,
      maxScanBytes: 1024,
      maxParsedEntries: 1024,
      maxDurationMs: 5,
      implementationVersion: 'time-budget-v1',
      inspectDescriptor: async file => {
        timeBudgetCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { pluginName: path.basename(file), scanBytes: 1, parsedEntries: 1 };
      }
    });
    const timeLimited = await timeBudgetIndex.get('time-budget', budgetPlugins);
    assert.ok(timeBudgetCalls <= 1, 'wall-time exhaustion must prevent subsequent JAR inspections');
    assert.equal(timeLimited.partial, true);
    assert.ok(timeLimited.partialReasons.some(reason => /wall-time budget/i.test(reason)));

    console.log('PASS bounded shared add-on conflict index');
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
