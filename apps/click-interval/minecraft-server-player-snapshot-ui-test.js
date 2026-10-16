'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ui = fs.readFileSync(path.join(__dirname, 'minecraft-server-ui.js'), 'utf8');
const helperStart = ui.indexOf('  function createPlayerStreamState()');
const helperEnd = ui.indexOf('\n  const protectionCheckGroups', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'player stream helpers should remain available to behavioral tests');
const helperSource = ui.slice(helperStart, helperEnd);

function createHelperSandbox(extraSource = '') {
  const sandbox = { Promise, setTimeout, clearTimeout };
  vm.runInNewContext(`
    const PLAYER_STREAM_KINDS = Object.freeze(['players', 'bans', 'history', 'historyEvents']);
    const INVALID_PLAYER_STREAM_VALUE = Symbol('invalid-player-stream-value');
    ${helperSource}
    ${extraSource}
    this.helpers = {
      createPlayerStreamState,
      capturePlayerStreamVersions,
      rememberPlayerStream,
      reconcilePlayerStreams,
      settleWithTimeout
    };
  `, sandbox, { filename: 'minecraft-server-ui-player-stream-helpers.js' });
  return sandbox;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const { helpers } = createHelperSandbox();

{
  const streams = helpers.createPlayerStreamState();
  helpers.rememberPlayerStream(streams, 'players', { online: 0, max: 20, sample: [] });
  helpers.rememberPlayerStream(streams, 'bans', [{ name: 'CurrentBan' }]);
  helpers.rememberPlayerStream(streams, 'history', [{ name: 'CurrentHistory' }]);
  helpers.rememberPlayerStream(streams, 'historyEvents', [{ name: 'CurrentEvent', type: 'left' }]);
  const versionsAfterBufferedEvents = helpers.capturePlayerStreamVersions(streams);
  const staleInitialStatus = {
    players: { online: 1, max: 20, sample: [{ name: 'Ghost' }] },
    bans: [{ name: 'OldBan' }],
    playerHistory: [{ name: 'OldHistory' }],
    playerEvents: [{ name: 'OldEvent', type: 'joined' }]
  };
  helpers.reconcilePlayerStreams(staleInitialStatus, staleInitialStatus, streams, versionsAfterBufferedEvents, true);
  assert.deepEqual(plain(staleInitialStatus.players), { online: 0, max: 20, sample: [] },
    'a pre-hydration player event must beat the initial full status response');
  assert.equal(staleInitialStatus.bans[0].name, 'CurrentBan');
  assert.equal(staleInitialStatus.playerHistory[0].name, 'CurrentHistory');
  assert.equal(staleInitialStatus.playerEvents[0].name, 'CurrentEvent');
  assert.equal(staleInitialStatus.playerHistoryEvents[0].name, 'CurrentEvent');
}

{
  const streams = helpers.createPlayerStreamState();
  const versionsAtRequest = helpers.capturePlayerStreamVersions(streams);
  helpers.rememberPlayerStream(streams, 'players', { online: 0, max: 10, sample: [] });
  helpers.rememberPlayerStream(streams, 'historyEvents', [{ name: 'Alex', type: 'left', timestamp: '2026-10-05T00:00:01Z' }]);
  const staleResponse = {
    players: { online: 1, max: 10, sample: [{ name: 'Alex' }] },
    bans: [{ name: 'Blocked' }],
    playerHistory: [],
    playerEvents: [{ name: 'Alex', type: 'joined', timestamp: '2026-10-05T00:00:00Z' }]
  };
  helpers.reconcilePlayerStreams(staleResponse, staleResponse, streams, versionsAtRequest);
  assert.equal(staleResponse.players.online, 0, 'a late full status response must not resurrect an offline player');
  assert.equal(staleResponse.playerEvents[0].type, 'left', 'a late full status response must not roll history backward');
  assert.equal(staleResponse.bans[0].name, 'Blocked', 'unchanged streams should still accept the response payload');
  assert.ok(streams.bans.version > versionsAtRequest.bans, 'accepted response fields should advance monotonically');
}

{
  const streams = helpers.createPlayerStreamState();
  const fullRequestVersions = helpers.capturePlayerStreamVersions(streams);
  const snapshotRequestVersions = helpers.capturePlayerStreamVersions(streams);
  const current = {};
  helpers.reconcilePlayerStreams(current, {
    players: { online: 0, max: 8, sample: [] },
    historyEvents: [{ name: 'Sam', type: 'left' }]
  }, streams, snapshotRequestVersions);
  const lateFullStatus = {
    players: { online: 1, max: 8, sample: [{ name: 'Sam' }] },
    playerEvents: [{ name: 'Sam', type: 'joined' }]
  };
  helpers.reconcilePlayerStreams(lateFullStatus, lateFullStatus, streams, fullRequestVersions);
  assert.equal(lateFullStatus.players.online, 0, 'a newer narrow snapshot must beat an older full request');
  assert.equal(lateFullStatus.playerEvents[0].type, 'left');
}

const runtimeStart = ui.indexOf('  function playerPageIsVisible()');
const runtimeEnd = ui.indexOf('\n  const bundledTeleportIcon', runtimeStart);
assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart, 'snapshot runtime should remain available to behavioral tests');
const runtimeSource = ui.slice(runtimeStart, runtimeEnd);

(async () => {
  await assert.rejects(
    helpers.settleWithTimeout(new Promise(() => {}), 15, 'snapshot timeout'),
    /snapshot timeout/,
    'a hung request should reject within its fixed timeout'
  );
  assert.equal(await helpers.settleWithTimeout(Promise.resolve('ok'), 100, 'too slow'), 'ok');

  const runtime = createHelperSandbox(`
    const elements = new Map([
      ['minecraftServerView', { hidden: false }],
      ['msWorkspacePanel', { hidden: false }],
      ['msPlayersPage', { hidden: false }]
    ]);
    const document = { hidden: false };
    const $ = id => elements.get(id) || { hidden: true };
    let status = { players: { online: 1, max: 20, sample: [{ name: 'Ghost' }] }, bans: [], playerHistory: [], playerEvents: [] };
    let playersView = 'online';
    let playerSnapshotPending = null;
    let playerSnapshotRequestGeneration = 0;
    const PLAYER_SNAPSHOT_TIMEOUT_MS = 15;
    const playerStreams = createPlayerStreamState();
    let renderOverviewCalls = 0;
    let renderPlayersCalls = 0;
    function renderOverview() { renderOverviewCalls += 1; }
    function renderPlayers() { renderPlayersCalls += 1; }
    let snapshotCalls = 0;
    const api = {
      getPlayerSnapshot() {
        snapshotCalls += 1;
        if (snapshotCalls === 1) return new Promise(() => {});
        return Promise.resolve({ players: { online: 0, max: 20, sample: [] }, bans: [], history: [], historyEvents: [] });
      }
    };
    ${runtimeSource}
    this.snapshotRuntime = {
      refreshPlayerSnapshot,
      getPending: () => playerSnapshotPending,
      getSnapshotCalls: () => snapshotCalls,
      getStatus: () => status
    };
  `).snapshotRuntime;

  const first = runtime.refreshPlayerSnapshot();
  const shared = runtime.refreshPlayerSnapshot();
  assert.strictEqual(shared, first, 'concurrent snapshot refreshes should share one request');
  await assert.rejects(first, /timed out/);
  assert.equal(runtime.getPending(), null, 'a timed-out request must release the single-flight lock');
  await runtime.refreshPlayerSnapshot();
  assert.equal(runtime.getSnapshotCalls(), 2, 'a later poll should recover after a hung request');
  assert.equal(runtime.getStatus().players.online, 0, 'the recovered snapshot should update the Player section');

  console.log('PASS Player snapshot event ordering and timeout recovery');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
