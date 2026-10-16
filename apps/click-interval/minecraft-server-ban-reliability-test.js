const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, 'minecraft-server', 'main.js');
const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__test = {\n`
  + '  normalizeBanMessage, normalizeTempBanRequest, normalizeTempBanDurationMs,\n'
  + '  formatMinecraftBanDate, upsertNativePlayerBan, removeNativePlayerBan,\n'
  + '  resetProtectionOffenseProperties, prunePlayerHistory, normalizePlayerHistoryLimit\n'
  + '};';

const ipcHandlers = new Map();
const testUserData = path.join(__dirname, 'work', `ban-reliability-test-${process.pid}`);
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
const playerUuid = '12345678-1234-4234-9234-123456789abc';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

(async () => {
  assert(ipcHandlers.has('players:tempBan'));
  assert(ipcHandlers.has('players:tempBanUntil'));
  assert(ipcHandlers.has('players:pardon'));
  assert.match(source, /const snapshot = Object\.fromEntries\(assemblyBans\);\s+await serializeFileWrite\(paths\.assemblyBans/,
    'managed-ban writes must snapshot profile-scoped state before entering a queued file mutation');
  assert.match(source, /if \(await serverPathsAreActive\(paths\)\) replaceAssemblyBanCache\(paths, stored\)/,
    'old-profile file work must not repopulate the active profile ban cache');
  assert.match(source, /rememberPlayerHistory\(clean, 'temp-ban',[\s\S]*?\}, paths\);[\s\S]*?assertServerPathsAreActive\(paths, 'the temporary ban'\)/,
    'temporary-ban history and runtime effects must remain pinned to the selected server profile');
  assert.match(source, /pardonPlayer\(clean, \{ paths: pathsOverride, expectedEndAt: Number\(endAt\) \}\)/,
    'temporary-ban expiry must remain bound to the original profile and exact ban revision');

  assert.equal(test.normalizeBanMessage(' reason\n/pardon everyone '), 'reason /pardon everyone');
  assert.equal(test.normalizePlayerHistoryLimit(0), 10);
  assert.equal(test.normalizePlayerHistoryLimit(999999), 1000);
  assert.equal(test.normalizeTempBanDurationMs(525_600 * 60_000), 525_600 * 60_000);
  assert.equal(test.normalizeTempBanDurationMs(900_000_000_000), 525_600 * 60_000);
  const fixedNow = Date.parse('2026-10-02T10:00:00.000Z');
  const absolute = test.normalizeTempBanRequest({
    endAt: '2026-10-03T10:00:00.000Z',
    reason: 'Testing'
  }, '', fixedNow);
  assert.equal(absolute.endAt, Date.parse('2026-10-03T10:00:00.000Z'));
  assert.equal(absolute.message, 'Testing');
  assert.equal(test.formatMinecraftBanDate(absolute.endAt), '2026-10-03 10:00:00 +0000');

  const pruned = test.prunePlayerHistory({
    alex: { name: 'Alex', events: [
      { type: 'joined', timestamp: '2026-10-02T10:00:00.000Z' },
      { type: 'left', timestamp: '2026-10-02T10:01:00.000Z' },
      { type: 'joined', timestamp: '2026-10-02T10:02:00.000Z' },
      { type: 'left', timestamp: '2026-10-02T10:03:00.000Z' },
      { type: 'joined', timestamp: '2026-10-02T10:04:00.000Z' },
      { type: 'left', timestamp: '2026-10-02T10:05:00.000Z' }
    ] },
    steve: { name: 'Steve', events: [
      { type: 'joined', timestamp: '2026-10-02T10:06:00.000Z' },
      { type: 'left', timestamp: '2026-10-02T10:07:00.000Z' },
      { type: 'joined', timestamp: '2026-10-02T10:08:00.000Z' },
      { type: 'left', timestamp: '2026-10-02T10:09:00.000Z' },
      { type: 'joined', timestamp: '2026-10-02T10:10:00.000Z' },
      { type: 'left', timestamp: '2026-10-02T10:11:00.000Z' }
    ] }
  }, 10);
  assert.equal(pruned.history.alex.events.length, 4);
  assert.equal(pruned.history.steve.events.length, 6);

  const native = test.upsertNativePlayerBan([], {
    name: 'Friend', uuid: playerUuid, createdAt: fixedNow,
    endAt: absolute.endAt, source: 'Server', commandReason: 'Testing. Banned until tomorrow.'
  });
  assert.equal(native.length, 1);
  assert.equal(native[0].expires, '2026-10-03 10:00:00 +0000');
  assert.equal(test.removeNativePlayerBan(native, 'friend', playerUuid).length, 0);

  const properties = [
    `players=${playerUuid}`,
    `${playerUuid}.name=Friend`,
    `${playerUuid}.offenses=4`,
    `${playerUuid}.temporaryBanUntil=9999999999999`,
    `${playerUuid}.permanentBan=true`,
    `${playerUuid}.lastAction=temp_ban`,
    ''
  ].join('\n');
  const reset = test.resetProtectionOffenseProperties(properties, 'Friend', playerUuid);
  assert.equal(reset.changed, true);
  assert.match(reset.text, new RegExp(`${playerUuid}\\.offenses=0`));
  assert.match(reset.text, new RegExp(`${playerUuid}\\.temporaryBanUntil=0`));
  assert.match(reset.text, new RegExp(`${playerUuid}\\.permanentBan=false`));
  assert.match(reset.text, new RegExp(`${playerUuid}\\.lastAction=pardoned`));

  fs.rmSync(testUserData, { recursive: true, force: true });
  const profileRoot = path.join(testUserData, 'minecraft-servers', 'TestServer');
  const pluginData = path.join(profileRoot, 'plugins', 'ClickIntervalAntiCheat');
  fs.mkdirSync(pluginData, { recursive: true });
  fs.writeFileSync(path.join(testUserData, 'assembly-profiles.json'), JSON.stringify({
    activeProfileId: 'TestServer',
    profiles: [{ id: 'TestServer', name: 'Test Server' }]
  }));
  fs.writeFileSync(path.join(profileRoot, 'assembly-config.json'), JSON.stringify({
    levelName: 'world', onlineMode: true, playerHistoryLimit: 10
  }));
  fs.writeFileSync(path.join(profileRoot, 'usercache.json'), JSON.stringify([
    { name: 'Friend', uuid: playerUuid, expiresOn: '2099-01-01 00:00:00 +0000' }
  ]));
  fs.writeFileSync(path.join(profileRoot, 'assembly-bans.json'), JSON.stringify({
    other: { name: 'Other', endAt: 0, createdAt: fixedNow, source: 'Server', reason: '', message: '', managed: true }
  }));
  fs.writeFileSync(path.join(pluginData, 'offenses.properties'), properties);

  const firstEndAt = Date.now() + 2 * 60 * 60 * 1000;
  await ipcHandlers.get('players:tempBanUntil')({}, 'Friend', new Date(firstEndAt).toISOString(), 'First reason');
  let managed = readJson(path.join(profileRoot, 'assembly-bans.json'));
  let nativeRows = readJson(path.join(profileRoot, 'banned-players.json'));
  assert.equal(Object.keys(managed).length, 2, 'A new ban must preserve other managed bans.');
  assert.equal(managed.friend.endAt, firstEndAt);
  assert.equal(managed.friend.reason, 'First reason');
  assert.equal(nativeRows.length, 1);
  assert.equal(nativeRows[0].uuid, playerUuid);
  assert.match(nativeRows[0].reason, /^First reason Banned until /);
  assert.doesNotMatch(nativeRows[0].reason, /Click Interval|Assembly/i);

  const replacementEndAt = Date.now() + 3 * 60 * 60 * 1000;
  await ipcHandlers.get('players:tempBan')({}, 'Friend', {
    endAt: replacementEndAt,
    reason: 'Replacement reason'
  });
  managed = readJson(path.join(profileRoot, 'assembly-bans.json'));
  nativeRows = readJson(path.join(profileRoot, 'banned-players.json'));
  assert.equal(Object.keys(managed).length, 2, 'Replacing a temporary ban must be idempotent and preserve other bans.');
  assert.equal(nativeRows.length, 1, 'Replacing a temporary ban must not duplicate native entries.');
  assert.equal(managed.friend.endAt, replacementEndAt);
  assert.equal(managed.friend.reason, 'Replacement reason');

  await ipcHandlers.get('players:pardon')({}, 'Friend');
  managed = readJson(path.join(profileRoot, 'assembly-bans.json'));
  nativeRows = readJson(path.join(profileRoot, 'banned-players.json'));
  assert.deepEqual(Object.keys(managed), ['other']);
  assert.equal(nativeRows.length, 0);
  const pardonedProperties = fs.readFileSync(path.join(pluginData, 'offenses.properties'), 'utf8');
  assert.match(pardonedProperties, new RegExp(`${playerUuid}\\.temporaryBanUntil=0`));
  assert.match(pardonedProperties, new RegExp(`${playerUuid}\\.permanentBan=false`));

  for (let index = 0; index < 4; index += 1) {
    await ipcHandlers.get('players:ban')({}, 'Friend', `Reason ${index + 1}`);
    await ipcHandlers.get('players:pardon')({}, 'Friend');
  }
  const history = await ipcHandlers.get('players:historyEvents')({});
  assert.equal(history.length, 10, 'Configured global history retention must prune oldest events immediately.');
  assert.equal(history[0].name, 'Friend');

  fs.rmSync(testUserData, { recursive: true, force: true });
  console.log('Minecraft server ban reliability tests passed.');
})().catch((error) => {
  fs.rmSync(testUserData, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
