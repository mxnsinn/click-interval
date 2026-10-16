'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const NatAPI = require('./minecraft-server/vendor/node_modules/nat-api');
const NatPMP = require('./minecraft-server/vendor/node_modules/nat-api/lib/pmp');
const natPmpSource = fs.readFileSync(path.join(__dirname, 'minecraft-server', 'vendor', 'node_modules', 'nat-api', 'lib', 'pmp', 'index.js'), 'utf8');
const {
  createDirectHostingState,
  getNatLease,
  getOwnedNatLease,
  claimNatLease,
  clearOwnedNatLease,
  scopeDirectHostingState
} = require('./minecraft-server/nat-lease-ownership');

function call(client, method, options) {
  return new Promise((resolve, reject) => {
    client[method](options, error => error ? reject(error) : resolve());
  });
}

function bareClient() {
  const client = Object.create(NatAPI.prototype);
  Object.assign(client, {
    _destroyed: false,
    _openPorts: [],
    _upnpIntervals: {},
    _pmpIntervals: {},
    autoUpdate: false,
    description: 'test',
    ttl: 3600,
    gateway: null
  });
  return client;
}

(async () => {
  assert.match(natPmpSource, /socket\.on\('message', \(msg, rinfo\) => this\.onMessage\(msg, rinfo\)\)/,
    'the NAT-PMP socket must forward the response packet to its parser');
  const queuedPmpClient = Object.create(NatPMP.Client.prototype);
  Object.assign(queuedPmpClient, {
    _queue: [], _connecting: true, _listening: false, _req: null, _reqActive: false, socket: {}
  });
  queuedPmpClient._request(1, { private: 24_454, public: 24_454, ttl: 3600 }, () => {});
  assert.equal(queuedPmpClient._queue[0].op, 1,
    'NAT-PMP requests must retain their opcode so valid gateway replies are accepted');

  let parsedMapping = null;
  const responsePmpClient = Object.create(NatPMP.Client.prototype);
  Object.assign(responsePmpClient, {
    _queue: [{ op: 1, cb: (error, info) => { assert.ifError(error); parsedMapping = info; } }],
    _connecting: false, _listening: true, _req: {}, _reqActive: true, socket: {}
  });
  const mapResponse = Buffer.alloc(16);
  mapResponse.writeUInt8(0, 0);
  mapResponse.writeUInt8(129, 1);
  mapResponse.writeUInt16BE(0, 2);
  mapResponse.writeUInt32BE(1, 4);
  mapResponse.writeUInt16BE(24_454, 8);
  mapResponse.writeUInt16BE(24_454, 10);
  mapResponse.writeUInt32BE(3600, 12);
  responsePmpClient.onMessage(mapResponse, { address: '192.168.1.1' });
  assert.equal(parsedMapping.public, 24_454);
  assert.equal(parsedMapping.private, 24_454);

  const mapping = { publicPort: 24454, privatePort: 24454, protocol: 'UDP', ttl: 3600 };
  const client = bareClient();
  client._map = (_options, callback) => callback();
  client._unmap = (_options, callback) => callback();

  await call(client, 'map', mapping);
  await call(client, 'map', mapping);
  assert.equal(client._openPorts.length, 1, 'repeated mapping must have one ownership record');

  client._unmap = (_options, callback) => callback(new Error('gateway refused'));
  await assert.rejects(call(client, 'unmap', mapping), /gateway refused/);
  assert.equal(client._openPorts.length, 1, 'failed unmapping must retain ownership for retry');

  client._unmap = (_options, callback) => callback();
  await call(client, 'unmap', mapping);
  assert.equal(client._openPorts.length, 0, 'successful unmapping must clear ownership');

  const renewalClient = bareClient();
  renewalClient.autoUpdate = true;
  renewalClient._timeout = 60_000;
  renewalClient._upnpClient = {
    portMapping: (_options, callback) => callback(),
    portUnmapping: (_options, callback) => callback()
  };
  await new Promise((resolve, reject) => renewalClient._upnpMap(mapping, error => error ? reject(error) : resolve()));
  const key = '24454:24454-UDP';
  const firstRenewal = renewalClient._upnpIntervals[key];
  assert.ok(firstRenewal, 'first mapping must create a renewal timer');
  await new Promise((resolve, reject) => renewalClient._upnpMap(mapping, error => error ? reject(error) : resolve()));
  const secondRenewal = renewalClient._upnpIntervals[key];
  assert.notStrictEqual(secondRenewal, firstRenewal, 'refresh should replace the renewal timer');
  assert.equal(firstRenewal._destroyed, true, 'replaced renewal timer must be cleared');
  await new Promise((resolve, reject) => renewalClient._upnpUnmap(mapping, error => error ? reject(error) : resolve()));
  assert.equal(secondRenewal._destroyed, true, 'unmapping must stop renewal');
  assert.equal(renewalClient._upnpIntervals[key], undefined);

  const pmpIpClient = bareClient();
  pmpIpClient._pmpClient = {
    gateway: '192.168.1.1',
    socket: {},
    externalIp: callback => callback(null, { ip: [8, 8, 4, 4] }),
    close() { this.socket = null; }
  };
  pmpIpClient._upnpClient = { externalIp: () => { throw new Error('UPnP fallback should not run'); } };
  const pmpIp = await new Promise((resolve, reject) => pmpIpClient.externalIp((error, ip) => error ? reject(error) : resolve(ip)));
  assert.equal(pmpIp, '8.8.4.4', 'NAT-PMP external-IP objects must be normalized to an IPv4 string');

  const pmpTimeoutClient = bareClient();
  let timedOutPmpClosed = false;
  let upnpFallbackCalls = 0;
  pmpTimeoutClient._pmpClient = {
    gateway: '192.168.1.1',
    socket: {},
    externalIp: () => {},
    close() { timedOutPmpClosed = true; this.socket = null; }
  };
  pmpTimeoutClient._upnpClient = {
    externalIp: callback => { upnpFallbackCalls += 1; callback(null, '1.1.1.1'); }
  };
  const fallbackIp = await new Promise((resolve, reject) =>
    pmpTimeoutClient.externalIp((error, ip) => error ? reject(error) : resolve(ip))
  );
  assert.equal(fallbackIp, '1.1.1.1');
  assert.equal(timedOutPmpClosed, true);
  assert.equal(upnpFallbackCalls, 1, 'a silent NAT-PMP gateway must fall back to UPnP');

  const mismatchClient = bareClient();
  let mismatchCleanup = null;
  mismatchClient._pmpClient = {
    gateway: '192.168.1.1',
    socket: {},
    portMapping: (_options, callback) => callback(null, { public: 24_455, private: 24_454 }),
    portUnmapping: (options, callback) => { mismatchCleanup = { ...options }; callback(); },
    close() { this.socket = null; }
  };
  const mismatchError = await new Promise(resolve => mismatchClient._pmpMap(mapping, resolve));
  assert.equal(mismatchError?.code, 'NAT_PMP_PORT_MISMATCH');
  assert.equal(mismatchCleanup.public, 24_455,
    'an unexpected NAT-PMP mapping must be removed before falling back');

  const ownedState = createDirectHostingState('profile-a');
  claimNatLease(ownedState, 'tcp', 'profile-a', 25570);
  claimNatLease(ownedState, 'voice', 'profile-a', 24454);
  assert.deepEqual(getOwnedNatLease(ownedState, 'tcp', 'profile-a'), {
    kind: 'tcp', profileId: 'profile-a', port: 25570
  });
  assert.equal(getOwnedNatLease(ownedState, 'voice', 'profile-b'), null,
    'another profile must not inherit a voice lease even when it requests the same port');
  assert.equal(clearOwnedNatLease(ownedState, 'voice', 'profile-b'), false,
    'removal in profile B must not clear profile A ownership');
  assert.equal(getNatLease(ownedState, 'voice').profileId, 'profile-a');
  const scopedToB = scopeDirectHostingState(ownedState, 'profile-b');
  assert.equal(scopedToB.mapped, false, 'status for profile B must not expose profile A TCP state');
  assert.equal(scopedToB.tcpPort, 0);
  assert.equal(scopedToB.voiceMapped, false, 'status for profile B must not expose profile A voice state');
  assert.equal(scopedToB.voicePort, 0);

  const mainPath = path.join(root, 'minecraft-server', 'main.js');
  const mainText = fs.readFileSync(mainPath, 'utf8');
  const unmapSource = mainText.slice(
    mainText.indexOf('async function unmapManagedVoiceUdpUnlocked'),
    mainText.indexOf('async function reconcileManagedVoiceUdpMapping')
  );
  const reconcileSource = mainText.slice(
    mainText.indexOf('async function reconcileManagedVoiceUdpMapping'),
    mainText.indexOf('function mapManagedVoiceUdpForDirectHosting')
  );
  assert.match(mainText, /function runNatMappingMutation\(/,
    'router mapping mutations must be serialized');
  assert.doesNotMatch(unmapSource, /\.catch\(\(\) => \{\}\)/,
    'voice unmapping errors must not be suppressed');
  assert.match(unmapSource, /getOwnedNatLease\(directHostingState, 'voice', profileId\)/,
    'voice removal must resolve the lease by profile ownership');
  assert.match(reconcileSource, /releaseOwnedNatLeaseUnlocked\('voice', previous\.profileId\)/,
    'changing voice ports must remove the owned previous mapping first');
  assert.match(mainText, /serverState === 'running' && runtime\?\.state === 'running'/,
    'stale stopped-server status must not override the configured UDP port');
  assert.match(mainText, /tcpPort: tcpLease\?\.port \|\| 0/,
    'direct-hosting status must report the historical owned TCP port');
  assert.match(mainText, /destroyNatClientBestEffort\(\)/,
    'application shutdown must run bounded NAT client cleanup');

  const createSource = mainText.slice(mainText.indexOf('function createProfile('), mainText.indexOf('function switchProfile('));
  const switchSource = mainText.slice(mainText.indexOf('function switchProfile('), mainText.indexOf('function deleteProfile('));
  const deleteSource = mainText.slice(mainText.indexOf('function deleteProfile('), mainText.indexOf('async function renameProfile('));
  assert.match(createSource, /await transitionNatMappingsToProfile\(id\)/,
    'creating and activating a profile must clean mappings owned by the previous profile');
  assert.match(switchSource, /await transitionNatMappingsToProfile\(requestedProfileId\)/,
    'switching profiles must reconcile NAT ownership before changing the active profile');
  assert.match(deleteSource, /transitionNatMappingsToProfile\(nextActiveProfileId, requestedProfileId\)/,
    'deleting a profile must clean only that profile and preserve the next active owner');

  class NatApiMock {
    static instances = [];
    constructor() {
      this.unmaps = [];
      this.destroyCalls = 0;
      this._upnpIntervals = {};
      this._pmpIntervals = {};
      NatApiMock.instances.push(this);
    }
    unmap(options, callback) {
      this.unmaps.push({ ...options });
      if (this.failuresRemaining > 0) {
        this.failuresRemaining -= 1;
        callback(new Error('temporary gateway failure'));
        return;
      }
      callback();
    }
    destroy(callback) {
      this.destroyCalls += 1;
      if (this.hangDestroy) return;
      callback();
    }
  }
  const ipcHandlers = new Map();
  const electronMock = {
    app: { getPath: () => path.join(root, 'work', 'nat-lifecycle-unused'), on: () => {}, quit: () => {} },
    BrowserWindow: { fromWebContents: () => null },
    ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
    dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {},
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value, 'utf8'),
      decryptString: value => value.toString('utf8')
    }
  };
  const moduleMock = { exports: {} };
  const source = `${mainText}\nmodule.exports.__natLifecycleTest = {\n` +
    '  unmapManagedVoiceUdpUnlocked, transitionNatMappingsToProfile, destroyNatClientBestEffort,\n' +
    '  setState: (state, client) => { directHostingState = state; natClient = client; natShutdownStarted = false; natMappingMutationQueue = Promise.resolve(); },\n' +
    '  getState: () => directHostingState\n' +
    '};';
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
      if (id === './vendor/node_modules/nat-api') return NatApiMock;
      if (id.startsWith('./')) return require(path.join(path.dirname(mainPath), id));
      return require(id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: mainPath });
  const lifecycle = moduleMock.exports.__natLifecycleTest;

  const crossProfileClient = new NatApiMock();
  const crossProfileState = createDirectHostingState('profile-a');
  claimNatLease(crossProfileState, 'voice', 'profile-a', 24454);
  lifecycle.setState(crossProfileState, crossProfileClient);
  const foreignRemoval = await lifecycle.unmapManagedVoiceUdpUnlocked(25599, 'profile-b');
  assert.equal(foreignRemoval.attempted, false);
  assert.equal(foreignRemoval.ignoredForeignLease, true);
  assert.equal(crossProfileClient.unmaps.length, 0,
    'removing voice in profile B must never issue an unmap for profile A');
  assert.equal(lifecycle.getState().voiceProfileId, 'profile-a');

  await lifecycle.unmapManagedVoiceUdpUnlocked(25599, 'profile-a');
  assert.equal(crossProfileClient.unmaps.length, 1);
  assert.equal(crossProfileClient.unmaps[0].publicPort, 24454,
    'cleanup must use the historical owned port instead of a stale requested/configured port');
  assert.equal(crossProfileClient.unmaps[0].protocol, 'UDP');

  const retainedClient = new NatApiMock();
  retainedClient.failuresRemaining = 2;
  const retainedState = createDirectHostingState('profile-a');
  claimNatLease(retainedState, 'voice', 'profile-a', 24456);
  lifecycle.setState(retainedState, retainedClient);
  await assert.rejects(
    lifecycle.unmapManagedVoiceUdpUnlocked(24456, 'profile-a'),
    /Could not remove Minecraft voice UDP 24456 mapping/
  );
  assert.equal(lifecycle.getState().voiceMapped, true,
    'failed local-only cleanup must retain the owned lease so status stays unsafe and startup can retry');
  await lifecycle.unmapManagedVoiceUdpUnlocked(24456, 'profile-a');
  assert.equal(lifecycle.getState().voiceMapped, false,
    'a later successful cleanup retry must clear the retained lease');

  const switchClient = new NatApiMock();
  const switchState = createDirectHostingState('profile-a');
  claimNatLease(switchState, 'tcp', 'profile-a', 25570);
  claimNatLease(switchState, 'voice', 'profile-a', 24455);
  lifecycle.setState(switchState, switchClient);
  await lifecycle.transitionNatMappingsToProfile('profile-b');
  assert.deepEqual(switchClient.unmaps.map(entry => `${entry.protocol}:${entry.publicPort}`).sort(),
    ['TCP:25570', 'UDP:24455']);
  assert.equal(lifecycle.getState().profileId, 'profile-b');
  assert.equal(lifecycle.getState().mapped, false);
  assert.equal(lifecycle.getState().voiceMapped, false);

  const retryClient = new NatApiMock();
  retryClient.failuresRemaining = 1;
  const retryState = createDirectHostingState('profile-a');
  claimNatLease(retryState, 'tcp', 'profile-a', 25571);
  lifecycle.setState(retryState, retryClient);
  await lifecycle.transitionNatMappingsToProfile('profile-b');
  assert.equal(retryClient.unmaps.length, 2, 'a transient unmap failure should receive one bounded retry');
  assert.ok(retryClient.unmaps.every(entry => entry.publicPort === 25571 && entry.protocol === 'TCP'),
    'unmap retries must keep using the historical owned TCP lease');
  assert.equal(lifecycle.getState().mapped, false);

  const failedTransitionClient = new NatApiMock();
  failedTransitionClient.failuresRemaining = 4;
  const failedTransitionState = createDirectHostingState('profile-a');
  claimNatLease(failedTransitionState, 'tcp', 'profile-a', 25572);
  lifecycle.setState(failedTransitionState, failedTransitionClient);
  const failedTransition = await lifecycle.transitionNatMappingsToProfile('profile-b');
  assert.equal(failedTransition.failures.length, 1);
  assert.equal(lifecycle.getState().mapped, true,
    'a failed profile-transition cleanup must retain the known public mapping for later local-only retry');
  assert.equal(lifecycle.getState().tcpProfileId, 'profile-a');

  const shutdownClient = new NatApiMock();
  shutdownClient.hangDestroy = true;
  const renewal = setInterval(() => {}, 60_000);
  shutdownClient._upnpIntervals.stale = renewal;
  lifecycle.setState(createDirectHostingState('profile-a'), shutdownClient);
  const shutdownStartedAt = Date.now();
  await lifecycle.destroyNatClientBestEffort(50);
  assert.ok(Date.now() - shutdownStartedAt < 1000, 'shutdown NAT cleanup must be bounded');
  assert.equal(renewal._destroyed, true, 'shutdown must synchronously stop renewal timers');
  assert.equal(lifecycle.getState().profileId, '', 'shutdown must discard stale remembered ownership');

  console.log('PASS managed NAT mapping lifecycle');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
