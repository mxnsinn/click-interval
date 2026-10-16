'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, 'minecraft-server', 'main.js');
const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__spectateTest = {\n`
  + '  PLAYER_SPECTATE_RESTORE_TAGS, PLAYER_SPECTATE_ACTIVE_TAG,\n'
  + '  normalizePlayerViewOrigin, normalizePlayerSpectateSession, playerPoseMatchesOrigin,\n'
  + '  parsePlayerPositionSnbt, parsePlayerRotationSnbt,\n'
  + '  buildStartPlayerSpectateCommands, buildStopPlayerSpectateCommands,\n'
  + '  getOnlinePrivilegedSpectateViewers, getPrivilegedSpectateAssignment,\n'
  + '  getPlayerViewCompanionStatus, getBundledPlayerViewCompanionRelease, exportBundledPlayerViewCompanion,\n'
  + '  loadPlayerSpectateSessions, startPlayerSpectating, stopPlayerSpectating,\n'
  + '  retryReadyPlayerSpectateRecovery, restoreRevokedPlayerSpectateSessions,\n'
  + '  nativeCapturePlayerPose: capturePlayerPose, feedPlayerPoseOutput: notePlayerPoseOutput,\n'
  + '  sessions: playerSpectateSessions, livePlayers,\n'
  + '  configure({ paths, accessReader, poseReader, processRef, generation = 7 }) {\n'
  + '    getPaths = async () => paths; readPlayerAccess = accessReader; capturePlayerPose = poseReader;\n'
  + '    serverProcess = processRef; serverState = "running"; serverLifecycleGeneration = generation; serverReadyGeneration = generation;\n'
  + '    playerSpectateSessions.clear(); playerSpectateRecoveryPath = path.resolve(paths.playerViewRecovery); playerSpectateSessionsLoaded = true;\n'
  + '  },\n'
  + '  dropRuntimeCache() { resetPlayerSpectateRuntimeCache(); },\n'
  + '  setAccessReader(reader) { readPlayerAccess = reader; },\n'
  + '  setPoseReader(reader) { capturePlayerPose = reader; }\n'
  + '};';

const moduleMock = { exports: {} };
let saveDialogResult = { canceled: true };
const electronMock = {
  app: { getPath: () => path.join(__dirname, 'work', 'player-spectate-test'), on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: () => {} },
  dialog: { showSaveDialog: async () => saveDialogResult }, shell: {}, Menu: {}, clipboard: {},
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

const test = moduleMock.exports.__spectateTest;
assert(test, 'Player spectate helpers failed to load.');

const origin = {
  dimension: 'minecraft:the_nether',
  position: { x: 123.125, y: 64.5, z: -88.75 },
  rotation: { yaw: -37.25, pitch: 18.5 },
  gameMode: 'survival'
};
const activePose = { ...origin, activeView: true };
const startCommands = Array.from(test.buildStartPlayerSpectateCommands('Owner_1', 'Friend_2', origin));
const stopCommands = Array.from(test.buildStopPlayerSpectateCommands('Owner_1', origin));
assert.deepEqual(startCommands, ['serverprotection view start Owner_1 Friend_2']);
assert(!startCommands.some((command) => /gamemode|\bspectate\b/.test(command)), 'POV start must preserve the viewer game mode');
assert.deepEqual(stopCommands, ['serverprotection view stop Owner_1']);
assert.doesNotMatch([...startCommands, ...stopCommands].join('\n'), /(?:^|\s)(?:gamemode|spectate|teleport|tag)(?:\s|$)/m,
  'the app must delegate player-view lifecycle exclusively to managed ServerProtection commands');

assert.throws(() => test.buildStartPlayerSpectateCommands('SamePlayer', 'sameplayer', origin), /different online player/i);
assert.throws(() => test.buildStartPlayerSpectateCommands('Owner\nstop', 'Friend', origin), /Invalid player name/);
assert.throws(() => test.normalizePlayerViewOrigin({ ...origin, dimension: 'minecraft:overworld run stop' }), /dimension is invalid/i);
assert.throws(() => test.normalizePlayerViewOrigin({ ...origin, position: { ...origin.position, x: Infinity } }), /coordinate is invalid/i);
assert(test.playerPoseMatchesOrigin(origin, JSON.parse(JSON.stringify(origin))), 'the exact return pose should acknowledge');
assert(!test.playerPoseMatchesOrigin({ ...origin, position: { ...origin.position, x: origin.position.x + 1 } }, origin), 'a wrong return must not acknowledge');
assert.deepEqual(JSON.parse(JSON.stringify(test.parsePlayerPositionSnbt('[1.25E-4d, 64.0d, -2.5E7d]'))), { x: 0.000125, y: 64, z: -25_000_000 });
assert.deepEqual(JSON.parse(JSON.stringify(test.parsePlayerRotationSnbt('[-3.725E1f, 18.5f]'))), { yaw: -37.25, pitch: 18.5 });

const ownerAccess = {
  assignments: [
    { player: 'Owner_1', role: 'owner' },
    { player: 'Admin_2', role: 'admin' },
    { player: 'Member_3', role: 'member' },
    { player: 'OfflineAdmin', role: 'admin' }
  ]
};
const online = new Map([
  ['owner_1', 'Owner_1'],
  ['admin_2', 'Admin_2'],
  ['member_3', 'Member_3'],
  ['unassigned', 'Unassigned']
]);
assert.deepEqual(Array.from(test.getOnlinePrivilegedSpectateViewers(ownerAccess, online)), ['Admin_2', 'Owner_1']);
assert.equal(test.getPrivilegedSpectateAssignment(ownerAccess, 'owner_1')?.role, 'owner');
assert.equal(test.getPrivilegedSpectateAssignment(ownerAccess, 'Member_3'), null);
const customViewerAccess = {
  version: 2,
  roles: [{
    id: 'observer',
    name: 'Observer',
    capabilities: ['player.spectate'],
    commands: { mode: 'allowlist', groups: [], allow: [], deny: [] },
    appearance: { enabled: false, prefix: '', suffix: '', color: 'white' }
  }],
  assignments: [{ player: 'Custom_4', roleId: 'observer' }]
};
assert.deepEqual(
  Array.from(test.getOnlinePrivilegedSpectateViewers(customViewerAccess, new Map([['custom_4', 'Custom_4']]))),
  ['Custom_4'],
  'a deliberate custom role with View players permission must be eligible'
);

async function runBehaviorTests() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'server-player-view-'));
  const paths = {
    root,
    config: path.join(root, 'server-config.json'),
    platform: path.join(root, 'assembly-platform.json'),
    playerViewRecovery: path.join(root, 'player-view-recovery.json')
  };
  fs.writeFileSync(paths.config, JSON.stringify({ serverVersion: '26.2' }));
  const writes = [];
  const processRef = {
    stdin: {
      writable: true,
      destroyed: false,
      writableEnded: false,
      write(value, callback) { writes.push(String(value)); callback?.(); return true; }
    }
  };
  let access = ownerAccess;
  const poses = [];
  test.configure({
    paths,
    accessReader: async () => access,
    poseReader: async () => {
      if (!poses.length) throw new Error('No test pose queued.');
      return poses.shift();
    },
    processRef
  });
  test.livePlayers.set('owner_1', 'Owner_1');
  test.livePlayers.set('friend_2', 'Friend_2');

  const companion = await test.getPlayerViewCompanionStatus(paths);
  assert.equal(companion.supported, true);
  assert.equal(companion.available, true, 'the exact pinned owner-side companion artifact should pass integrity inspection');
  assert.equal(companion.file, 'MXN-SI-NN-Mod-Companion-1.5.3+mc26.2.jar');
  assert.equal(companion.version, '1.5.3');
  assert.equal(companion.sha256, 'bd1f1a2c4e1997be68f8e60b996c443182be3c61197f0bc53e8a11945bd7c765');
  const exportedCompanion = path.join(root, companion.file);
  fs.writeFileSync(exportedCompanion, 'replace this stale companion');
  saveDialogResult = { canceled: false, filePath: exportedCompanion };
  const exported = await test.exportBundledPlayerViewCompanion();
  assert.equal(exported.cancelled, false);
  assert.equal(exported.sha256, companion.sha256, 'companion export must publish only the pinned verified artifact');
  assert.equal(fs.statSync(exportedCompanion).size, companion.size);
  fs.writeFileSync(paths.config, JSON.stringify({ serverVersion: '26.3' }));
  const companion263 = await test.getPlayerViewCompanionStatus(paths);
  assert.equal(companion263.available, true, 'the Minecraft 26.3 companion should also pass its independent integrity pin');
  assert.equal(companion263.sha256, 'b1ac9e8f6b7d9325fefbdf8107079b9b5ce2e7ba1e929ffbc9b66c2ab76c961b');
  fs.writeFileSync(paths.config, JSON.stringify({ serverVersion: '26.2' }));

  poses.push(origin, activePose);
  await test.startPlayerSpectating({ viewer: 'Owner_1', target: 'Friend_2' });
  let saved = JSON.parse(fs.readFileSync(paths.playerViewRecovery, 'utf8'));
  assert.equal(saved.sessions.length, 1, 'start must durably save recovery before relying on server commands');
  assert.equal(saved.sessions[0].state, 'active', 'player view must be marked active only after Minecraft confirms the POV tag');
  assert.deepEqual(saved.sessions[0].origin, origin);
  assert.match(writes.join('\n'), /serverprotection view start Owner_1 Friend_2/);
  assert.doesNotMatch(writes.join('\n'), /gamemode spectator/);

  writes.length = 0;
  poses.push(origin);
  await test.stopPlayerSpectating({ viewer: 'Owner_1', target: 'Friend_2' });
  saved = JSON.parse(fs.readFileSync(paths.playerViewRecovery, 'utf8'));
  assert.equal(saved.sessions.length, 0, 'positive pose acknowledgement should clear durable recovery');
  assert.equal(writes.join('').trim(), 'serverprotection view stop Owner_1',
    'restore must use only the managed stop command; the server module owns the exact return');
  assert.doesNotMatch(writes.join('\n'), /(?:^|\s)(?:gamemode|spectate|teleport|tag)(?:\s|$)/m);

  poses.push(origin, origin, origin);
  await assert.rejects(
    test.startPlayerSpectating({ viewer: 'Owner_1', target: 'Friend_2' }),
    /managed player view was not confirmed/i
  );
  assert.equal(test.sessions.size, 0, 'a rejected start must safely restore and clear recovery');

  poses.push(origin, activePose);
  await test.startPlayerSpectating({ viewer: 'Owner_1', target: 'Friend_2' });
  test.dropRuntimeCache();
  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'server-player-view-other-'));
  const otherPaths = { root: otherRoot, playerViewRecovery: path.join(otherRoot, 'player-view-recovery.json') };
  await test.loadPlayerSpectateSessions(otherPaths);
  assert.equal(test.sessions.size, 0, 'another server profile must not inherit player-view recovery');
  test.dropRuntimeCache();
  await test.loadPlayerSpectateSessions(paths);
  assert.equal(test.sessions.get('owner_1')?.origin.dimension, 'minecraft:the_nether', 'app restart must reload per-profile recovery');
  poses.push(origin);
  await test.retryReadyPlayerSpectateRecovery();
  assert.equal(test.sessions.size, 0, 'ready retry must restore a persisted online viewer');

  poses.push(origin, activePose);
  await test.startPlayerSpectating({ viewer: 'Owner_1', target: 'Friend_2' });
  poses.push({ ...origin, position: { ...origin.position, x: origin.position.x + 1 } });
  await assert.rejects(test.stopPlayerSpectating({ viewer: 'Owner_1' }), /did not confirm the exact player-view return/i);
  saved = JSON.parse(fs.readFileSync(paths.playerViewRecovery, 'utf8'));
  assert.equal(saved.sessions.length, 1, 'failed in-game acknowledgement must retain recovery');
  poses.push(origin);
  await test.stopPlayerSpectating({ viewer: 'Owner_1' });

  poses.push(origin, activePose);
  await test.startPlayerSpectating({ viewer: 'Owner_1', target: 'Friend_2' });
  access = { assignments: [{ player: 'Owner_1', role: 'member' }] };
  test.setAccessReader(async () => access);
  poses.push(origin);
  const revoked = await test.restoreRevokedPlayerSpectateSessions(access, paths);
  assert.equal(revoked.restored, 1, 'role revocation must immediately restore an online viewer');
  assert.equal(test.sessions.size, 0);

  await assert.rejects(test.startPlayerSpectating({ viewer: 'Owner_1', target: 'Friend_2' }), /Owner or Admin access/i);

  access = ownerAccess;
  test.setAccessReader(async () => access);
  poses.push(origin, activePose);
  await test.startPlayerSpectating({ viewer: 'Owner_1', target: 'Friend_2' });
  test.livePlayers.delete('owner_1');
  access = { assignments: [{ player: 'Owner_1', role: 'member' }] };
  const offlineRevoked = await test.restoreRevokedPlayerSpectateSessions(access, paths);
  assert.equal(offlineRevoked.pending, 1, 'an offline revoked viewer must keep durable recovery');
  assert.equal(test.sessions.size, 1);
  test.livePlayers.set('owner_1', 'Owner_1');
  poses.push(origin);
  await test.retryReadyPlayerSpectateRecovery();
  assert.equal(test.sessions.size, 0, 'the offline viewer must recover as soon as they return');

  const parsedPosePromise = test.nativeCapturePlayerPose('Owner_1');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: [123.125d, 64.5d, -88.75d]\n');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: [-37.25f, 18.5f]\n');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: "minecraft:the_nether"\n');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: 0\n');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: []\n');
  const parsedPose = await parsedPosePromise;
  assert.deepEqual(JSON.parse(JSON.stringify(parsedPose)), { ...origin, activeView: false },
    'runtime NBT acknowledgement should parse exact pose, game mode, and POV state');

  const activePosePromise = test.nativeCapturePlayerPose('Owner_1');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: [123.125d, 64.5d, -88.75d]\n');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: [-37.25f, 18.5f]\n');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: "minecraft:the_nether"\n');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: 0\n');
  test.feedPlayerPoseOutput('[Server thread/INFO]: Owner_1 has the following entity data: ["server_pov_active", "other_tag"]\n');
  assert.equal((await activePosePromise).activeView, true, 'the POV marker must confirm a started session');
}

runBehaviorTests()
  .then(() => console.log('PASS durable no-gamemode Minecraft player POV and exact-return behavior'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
