'use strict';

// Source-only VM regression: never starts Electron/Minecraft or writes a live profile.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const accessPolicy = require('./minecraft-server/access-policy');

const sourcePath = path.join(__dirname, 'minecraft-server/main.js');
const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__teamTest = {
  classifyServerTeamsScoreboardOwnership, buildServerTeamsAccessTeamPlan,
  getRuntimeScoreboardOwnership, applyRuntimePvpProtection, inspectAntiCheatJar,
  configure(processRef, generation, players = [], reset = true) {
    serverProcess = processRef;
    serverLifecycleGeneration = generation;
    serverReadyGeneration = generation;
    serverState = 'running';
    livePlayers.clear();
    for (const player of players) livePlayers.set(player.toLowerCase(), player);
    if (reset) {
      runtimeScoreboardOwnership = null;
      lastPvpProtectionSignature = '';
      provisionedAccessTeams.clear();
      pvpTeamProvisioned = false;
      runtimeAccessTeamMutationQueue = Promise.resolve();
    }
  },
  inject(mocks) {
    getModDescriptorIndex = mocks.scan;
    readManagedAccessTeamIds = mocks.readTeams;
    rememberManagedAccessTeamIds = mocks.remember;
    sendServerCommandBatch = mocks.send;
    appendServerLog = mocks.log;
  }
};`;
const moduleMock = { exports: {} };
const electronMock = {
  app: { getPath: () => path.join(__dirname, 'work/team-ownership-test'), on() {} },
  BrowserWindow: { fromWebContents: () => null }, ipcMain: { handle() {} },
  dialog: {}, shell: {}, Menu: {}, clipboard: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8')
  }
};
vm.runInNewContext(source, {
  module: moduleMock, exports: moduleMock.exports,
  __dirname: path.dirname(sourcePath), __filename: sourcePath,
  Buffer, URL, URLSearchParams, process, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  require(id) {
    if (id === 'electron') return electronMock;
    if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
    return require(id.startsWith('./') ? path.join(path.dirname(sourcePath), id) : id);
  }
}, { filename: sourcePath });
const test = moduleMock.exports.__teamTest;
let assertions = 0;
function equal(actual, expected, message) {
  assertions++;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);
}
function check(value, message) { assertions++; assert.ok(value, message); }
function throws(callback, pattern, message) { assertions++; assert.throws(callback, pattern, message); }

const teamDescriptor = {
  kind: 'mods', descriptor: 'fabric.mod.json', fabricModId: 'serverteams_fabric',
  fabricEnvironment: 'server', fabricMainEntrypoints: ['dev.serverteams.fabric.ServerTeams']
};
function index(descriptor = teamDescriptor, partial = false) {
  return { files: descriptor ? [{ fileName: 'renamed.jar', descriptor }] : [], partial };
}
equal(test.classifyServerTeamsScoreboardOwnership(index()), 'serverteams', 'descriptor identity, not filename, determines ownership');
equal(test.classifyServerTeamsScoreboardOwnership(index(teamDescriptor, true)), 'serverteams', 'positively identified Teams remains authoritative in partial scan');
equal(test.classifyServerTeamsScoreboardOwnership(index(null)), 'app', 'complete absence preserves standalone role teams');
equal(test.classifyServerTeamsScoreboardOwnership(index(null, true)), 'unknown', 'partial absence never authorizes role-team assignment');
equal(test.classifyServerTeamsScoreboardOwnership(null), 'unknown', 'missing index fails closed');
for (const change of [
  { fabricEnvironment: 'client' }, { fabricMainEntrypoints: ['elsewhere.Main'] },
  { fabricMainEntrypoints: 'dev.serverteams.fabric.ServerTeams' },
  { kind: 'plugins' }, { descriptor: 'plugin.yml' }
]) {
  equal(test.classifyServerTeamsScoreboardOwnership(index({ ...teamDescriptor, ...change })), 'unknown', 'ambiguous matching mod ID cannot authorize destructive reassignment');
}
equal(test.classifyServerTeamsScoreboardOwnership({
  files: [{ fileName: 'ServerTeams-Fabric.jar', descriptor: { fabricModId: 'unrelated' } }], partial: false
}), 'app', 'a filename alone cannot disable role styling');

let access = accessPolicy.setRole({}, {
  id: 'guardian', name: 'Guardian', capabilities: ['player.spectate', 'protection.manage'],
  commands: { mode: 'allowlist', groups: ['moderation'], allow: ['say'], deny: ['ban'] },
  appearance: { enabled: true, prefix: '[Guard] ', suffix: '', color: 'aqua' }
}).config;
access = accessPolicy.setAssignment(access, { player: 'Alice', roleId: 'guardian' }).config;
const priorAccess = accessPolicy.setRole(access, {
  id: 'retired', name: 'Retired', capabilities: [],
  commands: { mode: 'allowlist' }, appearance: { enabled: true, prefix: '[Old] ', color: 'red' }
}).config;
const roleId = accessPolicy.managedRoleTeamId('guardian');
const retiredId = accessPolicy.managedRoleTeamId('retired');
const rememberedId = 'ci_r_0123456789';
const provisionedId = 'ci_r_9876543210';
const realTeamId = 'st_0123456789abcdef0123456789abcdef';
const options = {
  serverVersion: '26.2', onlinePlayers: ['Alice', 'Bob'], pvpEnabled: false,
  previousConfig: priorAccess, previousTeamIds: [rememberedId, realTeamId, 'admin_team'],
  provisionedTeamIds: [provisionedId, realTeamId, 'asm_pve']
};
const serializedAccess = JSON.stringify(access);
const originalYaml = accessPolicy.renderAccessYaml(access);
const plan = test.buildServerTeamsAccessTeamPlan(access, options);
equal(plan.commands[0], 'gamerule minecraft:pvp false', 'global PvP remains disabled before releasing any app scoreboard fallback');
equal(plan.commands.at(-1), 'team empty asm_pve', 'legacy unstyled fallback is released only by its own team ID');
for (const id of [roleId, retiredId, rememberedId, provisionedId]) {
  check(plan.commands.includes(`team remove ${id}`), 'current/previous/persisted/provisioned app-owned roles are removed');
}
check(!plan.commands.some((line) => /team (?:join|leave|add|modify)\b|st_|admin_team|@a/.test(line)), 'no reassignment, friendly-fire override, selectors, or foreign teams');
equal(plan.activeTeamIds, [], 'no active cosmetic role teams remain');
equal(plan.styledPlayers, [], 'role appearances are suspended, not actual role permissions');
equal(JSON.stringify(access), serializedAccess, 'access assignments and roles are not mutated');
equal(accessPolicy.renderAccessYaml(access), originalYaml, 'Protection access YAML, capabilities, command grants and denials remain identical');
check(accessPolicy.assignmentHasCapability(access, 'Alice', 'protection.manage'), 'role capabilities remain granted');
const pvpOn = test.buildServerTeamsAccessTeamPlan(access, { ...options, pvpEnabled: true });
equal(pvpOn.commands[0], 'gamerule minecraft:pvp true', 'explicit enabled PvP remains enabled');
check(pvpOn.signature !== plan.signature, 'PvP policy changes invalidate runtime signature');
for (const serverVersion of ['1.21.11', '26.1', '26.3', 'latest', '']) {
  throws(() => test.buildServerTeamsAccessTeamPlan(access, { ...options, serverVersion }), /verified Minecraft 26\.2/, 'unverified versions cannot release fallback protection');
}
const manyIds = Array.from({ length: 100 }, (_, n) => `ci_r_${n.toString(16).padStart(10, '0')}`);
const largePlan = test.buildServerTeamsAccessTeamPlan(access, { ...options, provisionedTeamIds: manyIds });
for (const id of manyIds) check(largePlan.commands.includes(`team remove ${id}`), 'cleanup does not silently truncate known role teams');

const paths = { root: path.join(__dirname, 'work/team-ownership-test/profile') };
const config = { serverType: 'fabric', serverVersion: '26.2', pvp: false };
const liveProcess = { pid: 1 };
let scannedIndex = index();
let scans = 0;
let batches = [];
let remembers = [];
let logs = [];
let deliver = true;
let remembered = [rememberedId];
function mocks(overrides = {}) {
  return {
    scan: async () => { scans++; return scannedIndex; },
    readTeams: async () => remembered,
    remember: async (_paths, ids) => { remembers.push([...ids]); remembered = [...ids]; },
    send: (commands) => { batches.push([...commands]); return deliver; },
    log: (message) => logs.push(message), ...overrides
  };
}
function reset() {
  scans = 0; batches = []; remembers = []; logs = []; deliver = true;
  remembered = [rememberedId]; scannedIndex = index();
  test.configure(liveProcess, 1, ['Alice', 'Bob']); test.inject(mocks());
}
function sync(extra = {}) { return test.applyRuntimePvpProtection(config, 'test', { paths, access, ...extra }); }

async function main() {
  const artifactJar = process.argv.find((arg) => arg.startsWith('--artifact-jar='))?.slice('--artifact-jar='.length);
  if (artifactJar) {
    const descriptor = await test.inspectAntiCheatJar(path.resolve(artifactJar));
    equal(test.classifyServerTeamsScoreboardOwnership(index(descriptor)), 'serverteams', 'actual release JAR is recognized through the bounded production descriptor parser');
  }
  const nativeJar = process.argv.find((arg) => arg.startsWith('--native-jar='))?.slice('--native-jar='.length);
  if (nativeJar) {
    function bytecode(className) {
      const result = spawnSync('javap', ['-classpath', path.resolve(nativeJar), '-c', '-p', className], {
        encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024
      });
      equal(result.status, 0, `read-only javap succeeds for ${className}`);
      return result.stdout;
    }
    function method(code, declaration) {
      const start = code.indexOf(`  ${declaration}`);
      check(start >= 0, `native bytecode contains ${declaration}`);
      const rest = code.slice(start);
      return rest.slice(0, rest.indexOf('\n\n'));
    }
    const player = bytecode('net.minecraft.server.level.ServerPlayer');
    const harm = method(player, 'public boolean canHarmPlayer(');
    check(harm.indexOf('isPvpAllowed') < harm.indexOf('Player.canHarmPlayer'), 'native global PvP check precedes any scoreboard friendly-fire check');
    check(/isPvpAllowed:[\s\S]*ifne\s+9[\s\S]*iconst_0[\s\S]*ireturn/.test(harm), 'native PvP=false directly returns false');
    const hurt = method(player, 'public boolean hurtServer(');
    check(hurt.includes('canHarmPlayer') && hurt.includes('Player.hurtServer'), 'player/projectile damage is gated while the general environmental damage path remains');
    const level = bytecode('net.minecraft.server.level.ServerLevel');
    check(method(level, 'public boolean isPvpAllowed(').includes('GameRules.PVP'), 'native PvP flag is the gamerule');
    check(method(level, 'public net.minecraft.world.level.gamerules.GameRules getGameRules(').includes('MinecraftServer.getGameRules'), 'dimensions share the server-wide gamerule policy');
    const properties = bytecode('net.minecraft.server.dedicated.DedicatedServerProperties');
    check(!/String pvp\b/.test(properties), 'legacy pvp server property is not parsed by the 26.2 dedicated properties');
  }
  reset();
  let result = await sync();
  equal(result.scoreboardOwner, 'serverteams', 'real runtime path selects the safe handoff');
  equal(batches[0][0], 'gamerule minecraft:pvp false', 'live runtime preserves configured false first');
  equal(remembers, [[]], 'persisted role-team manifest is cleared after accepted batch');
  check(logs.some((line) => line.includes('permissions remain unchanged')), 'log explains the scoped appearance tradeoff');
  check(!batches.flat().some((line) => /team join|friendlyFire|minecraft:pvp true/.test(line)), 'PvP-off sync cannot reassign or enable teammate damage');
  // Removing remembered IDs changes the cleanup signature once; it then stabilizes.
  await sync();
  const sent = batches.length;
  result = await sync();
  check(result.unchanged, 'steady state avoids recurring scoreboard commands');
  equal(batches.length, sent, 'unchanged plans do not resend');
  equal(scans, 1, 'loader ownership scan is latched for the running process');

  scannedIndex = index(null);
  test.configure(liveProcess, 1, ['Alice', 'Bob', 'Charlie'], false);
  await sync();
  equal(scans, 1, 'removing the JAR from disk does not revoke ownership before restart');
  check(!batches.flat().some((line) => line.startsWith('team join ')), 'new player cannot be stolen by role/PVE sync');
  test.configure({ pid: 2 }, 2, ['Alice', 'Bob'], false);
  result = await sync();
  equal(result.scoreboardOwner, 'app', 'new process refreshes actual installed-mod ownership');
  check(batches.at(-1).includes(`team join ${roleId} Alice`), 'standalone styled roles retain original behavior');
  check(batches.at(-1).includes('team join asm_pve Bob'), 'standalone PvP fallback retains original behavior');

  reset(); scannedIndex = index(null, true);
  result = await sync();
  equal(result.deferred, true, 'incomplete scan defers cosmetic writes');
  equal(batches, [], 'unknown ownership never steals scoreboard membership');
  equal(remembers, [], 'unknown ownership does not erase tracking state');
  scannedIndex = index();
  result = await sync();
  equal(result.scoreboardOwner, 'serverteams', 'incomplete discovery retries rather than latching uncertainty');
  equal(scans, 2, 'uncertain scan is retried');

  reset(); deliver = false;
  result = await sync();
  check(result.stale, 'failed command delivery is not marked synchronized');
  equal(remembers, [], 'failed batch preserves tracked cleanup IDs for retry');
  deliver = true;
  await sync();
  equal(batches.length, 2, 'failed command delivery retries full safe sequence');
  equal(batches[1][0], 'gamerule minecraft:pvp false', 'retry still sets PvP before cleanup');

  reset();
  result = await test.applyRuntimePvpProtection({ ...config, serverVersion: '26.3' }, 'test', { paths, access });
  check(result.deferred, 'runtime defers handoff on unverified native rule versions');
  equal(batches, [], 'unsupported version never clears PvP fallback');

  reset();
  let resolveScan;
  let scanStarted;
  const started = new Promise((resolve) => { scanStarted = resolve; });
  test.inject(mocks({ scan: () => { scanStarted(); return new Promise((resolve) => { resolveScan = resolve; }); } }));
  const pending = sync();
  await started;
  test.configure({ pid: 3 }, 3, ['Alice'], false);
  resolveScan(index());
  result = await pending;
  check(result.stale, 'process switch during async discovery invalidates captured work');
  equal(batches, [], 'stale work cannot target the replacement server process');
  equal(remembers, [], 'stale work cannot alter replacement profile state');

  reset();
  const first = sync();
  test.configure({ pid: 4 }, 4, [], false);
  result = await first;
  check(result.stale, 'queued work for previous process is ignored before reading/writing');
  equal(scans, 0, 'stale queued work does not scan the new profile');
  equal(batches, [], 'stale queued work cannot issue commands');

  reset();
  await test.getRuntimeScoreboardOwnership(paths, config, liveProcess, 1);
  scannedIndex = index(null);
  equal(await test.getRuntimeScoreboardOwnership({ root: `${paths.root}-other` }, config, liveProcess, 1), 'app', 'profile-root change cannot reuse another profile latch');
  equal(scans, 2, 'profile-root identity participates in ownership caching');
  reset();
  equal(await test.getRuntimeScoreboardOwnership(paths, { ...config, serverType: 'paper' }, liveProcess, 1), 'app', 'non-Fabric servers retain their existing role behavior');
  equal(scans, 0, 'Paper never treats an inert Fabric mod as authoritative');

  equal(JSON.stringify(access), serializedAccess, 'all runtime sync paths preserve access data');
  equal(accessPolicy.renderAccessYaml(access), originalYaml, 'all runtime sync paths preserve command/capability policy');
  console.log(`Team scoreboard ownership regression passed (${assertions} assertions; mocked runtime/read-only artifacts, no server/client startup or profile writes).`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
