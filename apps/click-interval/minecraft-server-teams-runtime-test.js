'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const teams = require('./minecraft-server/teams-runtime');
const mainPath = path.join(__dirname, 'minecraft-server/main.js');
const artifact = path.join(__dirname, 'minecraft-server/server-teams-fabric/dist', teams.ARTIFACT);
const older = path.join(__dirname, 'minecraft-server/server-teams-fabric/dist/ServerTeams-Fabric-1.0.3+mc26.2.jar');
let root;
function backend() {
  const module = { exports: {} };
  const source = fss.readFileSync(mainPath, 'utf8') + '\nmodule.exports.test = { inspectAntiCheatJar, getBundledDeathLootAdapter, findBundledDeathLootDependencyArtifact, prepareTeamsBeforeStart };';
  const sandbox = { module, exports: module.exports, __dirname: path.dirname(mainPath), __filename: mainPath, Buffer, URL, URLSearchParams,
    process, console, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    require(id) {
      if (id === 'electron') return { app: { getPath: () => root, on() {} }, BrowserWindow: { fromWebContents: () => null }, ipcMain: { handle() {} }, dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {}, safeStorage: { isEncryptionAvailable: () => false } };
      if (id === './vendor/node_modules/nat-api') return class {};
      return id.startsWith('./') ? require(path.join(path.dirname(mainPath), id)) : require(id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: mainPath }); return module.exports.test;
}
async function context(name, api, dependency) {
  const profile = path.join(root, name), mods = path.join(profile, 'mods');
  await fs.mkdir(mods, { recursive: true });
  return { root: profile, mods, artifact, inspectJar: api.inspectAntiCheatJar, dependency, revalidate: async () => {},
    getIndex: async () => ({ partial: false, files: await Promise.all((await fs.readdir(mods)).filter(name => name.endsWith('.jar')).map(async name => ({ name, descriptor: await api.inspectAntiCheatJar(path.join(mods, name)) }))) }) };
}
async function sha(api, file) { return (await api.inspectAntiCheatJar(file)).sha256; }
(async () => {
  await fs.mkdir(path.join(__dirname, 'work'), { recursive: true });
  root = await fs.mkdtemp(path.join(__dirname, 'work', 'teams-runtime-test-'));
  const api = backend(), dependency = await api.findBundledDeathLootDependencyArtifact(api.getBundledDeathLootAdapter('fabric', '26.2'));
  assert.ok(dependency);
  assert.equal(teams.isSupported({ serverType: 'fabric', serverVersion: '26.2' }, { verified: true, compatible: true, build: '0.19.5' }), true);
  for (const build of [undefined, '', '0.19.4', '0.18.9', '0.19.5-beta', 'malformed']) assert.equal(teams.isSupported({ serverType: 'fabric', serverVersion: '26.2' }, { verified: true, compatible: true, build }), false);
  for (const build of ['0.19.5', '0.19.6', '0.20.0', '1.0.0']) assert.equal(teams.isSupported({ serverType: 'fabric', serverVersion: '26.2' }, { verified: true, compatible: true, build }), true);
  for (const value of ['0.160.0+26.2', '0.161.0+26.3', 'garbage+26.2', '0.161.0+26.2+extra']) assert.equal(teams.isFabricApiVersion(value), false);
  for (const value of ['0.161.0+26.2', '0.162.1+26.2', '1.0.0+26.2']) assert.equal(teams.isFabricApiVersion(value), true);
  for (const platform of [{ verified: false }, { verified: true, compatible: false }, { verified: true, minecraftVersion: '26.3' }]) assert.equal(teams.isSupported({ serverType: 'fabric', serverVersion: '26.2' }, platform), false);
  assert.equal((await api.prepareTeamsBeforeStart({ serverConfig: { serverType: 'paper', serverVersion: '26.2' }, platform: { verified: true } })).installed, false);
  const fresh = await context('new', api, dependency), freshJar = path.join(fresh.mods, 'ServerTeams-Fabric.jar');
  assert.equal((await teams.prepareRuntime(fresh)).previouslyInstalled, false);
  assert.equal(await sha(api, freshJar), teams.SHA256);
  const stat = await fs.stat(freshJar);
  assert.equal((await teams.prepareRuntime(fresh)).updated, false);
  assert.equal((await fs.stat(freshJar)).mtimeMs, stat.mtimeMs, 'unchanged runtime must not be rewritten');
  const upgraded = await context('upgrade', api, dependency), renamed = path.join(upgraded.mods, 'custom-teams-name.jar');
  await fs.copyFile(older, renamed);
  const teamState = path.join(upgraded.root, 'world/server-teams');
  await fs.mkdir(teamState, { recursive: true }); await fs.writeFile(path.join(teamState, 'teams.json'), '{"membership":"preserve"}');
  const result = await teams.prepareRuntime(upgraded);
  assert.equal(result.updated, true); assert.equal(result.previouslyInstalled, true);
  assert.equal(await sha(api, result.backup), teams.RELEASES['1.0.3']);
  assert.equal(await sha(api, renamed), teams.SHA256);
  assert.equal(await fs.readFile(path.join(teamState, 'teams.json'), 'utf8'), '{"membership":"preserve"}');
  const duplicate = await context('duplicate', api, dependency);
  await fs.copyFile(older, path.join(duplicate.mods, 'one.jar')); await fs.copyFile(artifact, path.join(duplicate.mods, 'two.jar'));
  await assert.rejects(teams.prepareRuntime(duplicate), /Multiple Teams mods/);
  assert.equal((await fs.readdir(duplicate.mods)).length, 2);
  const unknown = await context('unknown', api, dependency), unknownFile = path.join(unknown.mods, 'custom.jar');
  await fs.copyFile(older, unknownFile); await fs.appendFile(unknownFile, '\nmodified');
  const unknownSha = await sha(api, unknownFile);
  await assert.rejects(teams.prepareRuntime(unknown), /differs from known releases/);
  assert.equal(await sha(api, unknownFile), unknownSha);
  const invalid = await context('invalid-bundle', api, dependency);
  await assert.rejects(teams.prepareRuntime({ ...invalid, artifact: older }), /Bundled Teams runtime/);
  await assert.rejects(teams.prepareRuntime({ ...invalid, getIndex: async () => ({ partial: true, files: [] }) }), /could not be fully checked/);
  await assert.rejects(teams.prepareRuntime({ ...invalid, dependency: null }), /Fabric API is missing/);
  await fs.copyFile(dependency.path, path.join(invalid.mods, 'ServerTeams-Fabric.jar'));
  await assert.rejects(teams.prepareRuntime(invalid), /differs from known releases/);
  for (const oldInstalled of [false, true]) {
    const cancelled = await context(`cancel-${oldInstalled}`, api, dependency), target = path.join(cancelled.mods, 'ServerTeams-Fabric.jar');
    if (oldInstalled) await fs.copyFile(older, target);
    cancelled.revalidate = async () => {
      try { if (await sha(api, target) === teams.SHA256) throw Error('Stopped profile changed during preparation.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
    await assert.rejects(teams.prepareRuntime(cancelled), /Stopped profile changed/);
    if (oldInstalled) assert.equal(await sha(api, target), teams.RELEASES['1.0.3']);
    else await assert.rejects(fs.access(target), { code: 'ENOENT' });
    assert.equal((await fs.readdir(cancelled.mods)).length, oldInstalled ? 1 : 0, 'rollback removes only the dependency it added');
  }
  const duplicateRace = await context('duplicate-race', api, dependency);
  let checked = 0;
  duplicateRace.revalidate = async () => { if (++checked === 3) await fs.copyFile(older, path.join(duplicateRace.mods, 'external.jar')); };
  await assert.rejects(teams.prepareRuntime(duplicateRace), /mods folder changed/);
  assert.equal(await sha(api, path.join(duplicateRace.mods, 'external.jar')), teams.RELEASES['1.0.3']);
  assert.equal((await fs.readdir(duplicateRace.mods)).length, 1);
  const linked = await context('linked', api, dependency), destination = path.join(root, 'link-destination');
  await fs.mkdir(destination); await fs.rmdir(linked.mods); await fs.symlink(destination, linked.mods, 'junction');
  await assert.rejects(teams.prepareRuntime(linked), /link or junction/);
  assert.deepEqual(await fs.readdir(destination), []);
  console.log('PASS Teams runtime: real JAR descriptors/hashes, new install, idempotent upgrade, verified backup, preserved state, unknown/duplicate rejection, cancelled start rollback, concurrent mod changes, and linked-path rejection');
})().catch(error => { console.error(error); process.exitCode = 1; });
