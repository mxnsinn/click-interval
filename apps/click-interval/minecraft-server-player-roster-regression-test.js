const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const sourcePath = path.join(__dirname, 'minecraft-server', 'main.js');
const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__test = {\n` +
  '  parsePlayerLogLine, analyzeMinecraftStatusRoster, reconcileLivePlayersFromMinecraftStatus, rememberEmbeddedSubscriber, emit, emitAll,\n' +
  '  replaceLivePlayers, restoreFailedPlayerHistoryBatch, livePlayers,\n' +
  '  getPlayerStateRevision: () => playerStateRevision, getPlayerRosterRevision: () => playerRosterRevision\n' +
  '};';

const testUserData = path.join(__dirname, 'work', `player-roster-test-${process.pid}`);
fs.rmSync(testUserData, { recursive: true, force: true });
fs.mkdirSync(testUserData, { recursive: true });
process.once('exit', () => {
  try { fs.rmSync(testUserData, { recursive: true, force: true }); } catch {}
});

const ipcHandlers = new Map();
const electronMock = {
  app: { getPath: () => testUserData, on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: (name, handler) => ipcHandlers.set(name, handler) },
  dialog: {}, shell: {}, Menu: {}, clipboard: {},
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
const test = moduleMock.exports.__test;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

assert.deepEqual(plain(test.parsePlayerLogLine('[12:34:56] [Server thread/INFO]: Alex joined the game')), {
  type: 'joined', name: 'Alex'
});
assert.deepEqual(plain(test.parsePlayerLogLine('\u001b[32m[12:34:57] [Server thread/INFO] (Minecraft): Alex left the game\u001b[0m')), {
  type: 'left', name: 'Alex'
});
assert.deepEqual(plain(test.parsePlayerLogLine('[12:34:58] [Server thread/INFO] (Minecraft) Steve[/127.0.0.1:25565] logged in with entity id 4 at (1, 64, 2)')), {
  type: 'logged-in', name: 'Steve'
});
assert.deepEqual(plain(test.parsePlayerLogLine('[12:34:59 INFO]: Steve lost connection: Timed out')), {
  type: 'disconnected', name: 'Steve', reason: 'Timed out'
});
assert.deepEqual(plain(test.parsePlayerLogLine('\u001b[0m[12:35:00] [Server thread/INFO]: There are 2 of a max of 20 players online: Alex, Steve')), {
  type: 'roster', online: 2, max: 20, players: ['Alex', 'Steve']
});
assert.equal(test.parsePlayerLogLine('[12:35:01] [Server thread/INFO]: <Mallory> Alex joined the game'), null,
  'chat text must not forge a roster transition');

const emptyStatus = test.analyzeMinecraftStatusRoster({ players: { online: 0, max: 20, sample: [] } });
assert.deepEqual(plain(emptyStatus.completeNames), [], 'zero-player status must authoritatively clear stale names');
const fullStatus = test.analyzeMinecraftStatusRoster({
  players: { online: 2, max: 20, sample: [{ name: 'Alex', id: 'a' }, { name: 'Steve', id: 'b' }] }
});
assert.deepEqual(plain(fullStatus.completeNames), ['Alex', 'Steve'], 'a full status sample must reconcile the exact roster');
const partialStatus = test.analyzeMinecraftStatusRoster({
  players: { online: 3, max: 20, sample: [{ name: 'Alex', id: 'a' }, { name: 'Steve', id: 'b' }] }
});
assert.equal(partialStatus.completeNames, null, 'a partial status sample must never evict unsampled players');
assert.equal(test.analyzeMinecraftStatusRoster({ players: { online: 1, max: 20 } }).completeNames, null,
  'hidden status samples require the authoritative console list response');

test.replaceLivePlayers(['Ghost'], { emit: false });
const rosterRevision = test.getPlayerRosterRevision();
const stateRevision = test.getPlayerStateRevision();
test.reconcileLivePlayersFromMinecraftStatus({ players: { online: 0, max: 20, sample: [] } }, {
  recordHistory: false,
  emit: false
});
assert.equal(test.livePlayers.size, 0, 'authoritative empty roster must remove a stale player');
assert.equal(test.getPlayerRosterRevision(), rosterRevision + 1);
assert.equal(test.getPlayerStateRevision(), stateRevision + 1);
test.reconcileLivePlayersFromMinecraftStatus({
  players: { online: 2, max: 20, sample: [{ name: 'Alex' }, { name: 'Steve' }] }
}, { recordHistory: false, emit: false });
assert.deepEqual(plain([...test.livePlayers.values()]), ['Alex', 'Steve']);
test.reconcileLivePlayersFromMinecraftStatus({
  players: { online: 3, max: 20, sample: [{ name: 'Alex' }, { name: 'Sam' }] }
}, { recordHistory: false, emit: false });
assert.deepEqual(plain([...test.livePlayers.values()]), ['Alex', 'Steve'],
  'partial ping samples must not replace an exact roster');

const failedBatch = [{ name: 'Alex', eventType: 'joined' }, { name: 'Alex', eventType: 'left', writeAttempts: 1 }];
const restored = test.restoreFailedPlayerHistoryBatch(failedBatch, [{ name: 'Steve', eventType: 'joined' }]);
assert.deepEqual(plain(restored.map(event => [event.name, event.eventType, event.writeAttempts || 0])), [
  ['Alex', 'joined', 1], ['Alex', 'left', 2], ['Steve', 'joined', 0]
], 'a failed history batch must remain ahead of later events for retry');

class Sender extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.destroyed = false;
    this.messages = [];
  }
  isDestroyed() { return this.destroyed; }
  send(channel, payload) { this.messages.push({ channel, payload }); }
  destroy() { this.destroyed = true; this.emit('destroyed'); }
}

const mainSender = new Sender('main');
const consoleSender = new Sender('console');
assert.equal(test.rememberEmbeddedSubscriber(mainSender), true);
assert.equal(test.rememberEmbeddedSubscriber(consoleSender), true);
assert.equal(test.rememberEmbeddedSubscriber(mainSender), false, 'repeat status requests must not duplicate subscriptions');
test.emit('server:players', { online: 1 });
assert.equal(mainSender.messages.length, 1);
assert.equal(consoleSender.messages.length, 1, 'a console status request must not steal events from the main UI');
mainSender.destroy();
test.emitAll('server:history', []);
assert.equal(mainSender.messages.length, 1, 'destroyed subscribers must be removed');
assert.equal(consoleSender.messages.length, 2);

assert(ipcHandlers.has('players:snapshot'), 'players:snapshot IPC must be registered');
const profileRoot = path.join(testUserData, 'minecraft-servers', 'Roster-Test');
fs.mkdirSync(profileRoot, { recursive: true });
fs.writeFileSync(path.join(testUserData, 'assembly-profiles.json'), JSON.stringify({
  activeProfileId: 'Roster-Test',
  profiles: [{ id: 'Roster-Test', name: 'Roster Test' }]
}));
fs.writeFileSync(path.join(profileRoot, 'assembly-config.json'), JSON.stringify({ maxPlayers: 20, playerHistoryLimit: 100 }));
fs.writeFileSync(path.join(profileRoot, 'assembly-player-history.json'), JSON.stringify({
  alex: {
    name: 'Alex', firstSeen: '2026-10-05T10:00:00.000Z', lastSeen: '2026-10-05T10:05:00.000Z',
    lastActive: '2026-10-05T10:05:00.000Z', lastEvent: 'left',
    events: [
      { type: 'joined', timestamp: '2026-10-05T10:00:00.000Z' },
      { type: 'left', timestamp: '2026-10-05T10:05:00.000Z' }
    ]
  }
}));

(async () => {
  const snapshot = plain(await ipcHandlers.get('players:snapshot')({}));
  assert.equal(snapshot.revision, test.getPlayerStateRevision());
  assert.equal(snapshot.players.online, 0);
  assert.equal(snapshot.history.length, 1);
  assert.deepEqual(snapshot.historyEvents.map(event => event.type), ['left', 'joined']);
  assert.deepEqual(snapshot.playerEvents, snapshot.historyEvents, 'snapshot must provide the frontend-compatible event alias');
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'events'), false, 'snapshot contract uses historyEvents, not a dead events field');
  fs.rmSync(testUserData, { recursive: true, force: true });
  console.log('PASS player roster, history, subscriber, and snapshot regressions');
})().catch(error => {
  fs.rmSync(testUserData, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
