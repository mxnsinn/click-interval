'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = require('./player-inspector-data');

const source = fs.readFileSync(path.join(__dirname, 'player-inspector.js'), 'utf8');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

const createdElements = [];
class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.childElementCount = 0;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.parentElement = null;
    this.style = { setProperty() {} };
    this.textContent = '';
    this.value = '';
    this.className = '';
    this.listeners = new Map();
    createdElements.push(this);
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type, event = {}) { return this.listeners.get(type)?.({ clientX: 0, pointerId: 1, ...event }); }
  append(...children) {
    for (const child of children) {
      if (child && typeof child === 'object') child.parentElement = this;
      this.children.push(child);
    }
    this.childElementCount = this.children.length;
  }
  removeAttribute(name) { delete this[name]; }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) { this[name] = String(value); }
  setPointerCapture() {}
  querySelector(selector) {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    return this.children.find(child => String(child?.className || '').split(/\s+/).includes(className)) || null;
  }
  set innerHTML(value) { this._innerHTML = String(value); this.replaceChildren(); }
  get innerHTML() { return this._innerHTML || ''; }
}

const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, new FakeElement());
  return elements.get(id);
};
element('xpProgress').parentElement = new FakeElement();
element('xpProgress').parentElement.clientWidth = 200;

const documentMock = {
  hidden: false,
  title: '',
  createElement: tagName => new FakeElement(tagName),
  createDocumentFragment: () => new FakeElement('fragment'),
  getElementById: element,
  querySelectorAll(selector) {
    if (selector !== '.inventory-slot') return [];
    return createdElements.filter(candidate => String(candidate.className).split(/\s+/).includes('inventory-slot'));
  }
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush(turns = 8) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function spectate(target, state = '', viewer = 'Owner_1') {
  return {
    target,
    onlinePlayers: [viewer],
    companion: { supported: true, available: true, file: 'Companion.jar', minecraftVersion: '26.2' },
    sessions: state ? [{ viewer, target, state, online: true }] : []
  };
}

function snapshot(player, options = {}) {
  return {
    player,
    position: { x: options.x ?? 12.5, y: 64, z: -7 },
    dimension: 'overworld',
    inventory: options.inventory || [{ section: 'hotbar', index: 0, id: 'minecraft:stone', name: 'Stone', count: 2 }],
    vitals: { health: 20, food: 18, xpLevel: 7, xpProgress: 0.5 },
    skin: null,
    assets: {},
    updatedAt: '2026-10-05T10:00:00.000Z',
    spectate: options.spectate || spectate(player)
  };
}

const inspectQueue = [];
const statusQueue = [];
const stopQueue = [];
const statisticsQueue = [];
const playerEventsQueue = [];
const protectionQueue = [];
let inspectCalls = 0;
let statusCalls = 0;
let playerEventsCalls = 0;
let playerNameListener = null;
let intervalCallback = null;

const next = (queue, fallback) => {
  const value = queue.length ? queue.shift() : fallback;
  return value && typeof value.then === 'function' ? value : Promise.resolve(value);
};

const api = {
  inspectPlayer() { inspectCalls += 1; return next(inspectQueue, new Promise(() => {})); },
  getPlayerSpectateStatus(name) { statusCalls += 1; return next(statusQueue, spectate(name)); },
  stopPlayerSpectating(value) { return next(stopQueue, spectate(value.target)); },
  getPlayerStatistics() { return next(statisticsQueue, { categories: [], totalEntries: 0, updatedAt: '' }); },
  getPlayerEvents() { playerEventsCalls += 1; return next(playerEventsQueue, []); },
  getProtectionHistory() { return next(protectionQueue, []); }
};

const windowMock = {
  PlayerInspectorData: data,
  location: { search: '?player=Alex' },
  addEventListener() {},
  bridge: {
    minecraftServer: api,
    closeCurrentWindow() {},
    loadPlayerInspectorName: () => 'Alex',
    onPlayerInspectorName(callback) { playerNameListener = callback; }
  }
};

const initial = deferred();
inspectQueue.push(initial.promise);
vm.runInNewContext(source, {
  Date,
  Image: class {},
  Promise,
  URLSearchParams,
  clearInterval() {},
  document: documentMock,
  setInterval(callback) { intervalCallback = callback; return 1; },
  window: windowMock
}, { filename: 'player-inspector.js' });

(async () => {
  assert.equal(element('playerViewPanel').hidden, true, 'retired view controls must stay hidden while status is loading');
  initial.resolve(snapshot('Alex', { spectate: spectate('Alex', 'starting') }));
  await flush();
  assert.equal(element('playerX').textContent, '12.5');
  assert.match(element('playerViewStatus').textContent, /Starting the view/i);
  assert.doesNotMatch(element('playerViewStatus').textContent, /^Viewing\b/i,
    'a durable starting record must not be presented as a confirmed view');
  assert.equal(statusCalls, 0, 'the spectate snapshot bundled with inspection should avoid a duplicate status request');

  inspectQueue.push(Promise.reject(new Error('Alex is no longer online.')));
  statusQueue.push(Promise.resolve(spectate('Alex', 'restoring')));
  element('refreshPlayer').dispatch('click');
  await flush();
  assert.equal(element('playerX').textContent, '—', 'offline refresh must clear stale coordinates');
  assert.equal(element('playerDimension').textContent, '—');
  assert.equal(element('inventoryStatus').textContent, 'Unavailable', 'offline refresh must clear stale inventory state');
  assert.equal(element('xpLevel').textContent, '0', 'offline refresh must clear stale vitals');
  assert.equal(element('modelFallback').textContent, 'Player unavailable', 'offline refresh must clear the stale model');
  assert.match(element('playerUpdated').textContent, /Unavailable · last available/i);
  assert.match(element('playerViewStatus').textContent, /Returning Owner_1/i);
  assert.doesNotMatch(element('playerViewStatus').textContent, /^Viewing\b/i,
    'a restoring record must remain pending');

  assert.equal(element('playerViewPanel').hidden, false, 'existing sessions retain recovery');
  assert.equal(element('stopPlayerView').disabled, false);
  const pendingStop = deferred();
  const pendingBob = deferred();
  stopQueue.push(pendingStop.promise);
  element('playerViewViewer').value = 'Owner_1';
  element('stopPlayerView').dispatch('click');
  inspectQueue.push(pendingBob.promise);
  playerNameListener('Bob');
  assert.equal(documentMock.title, 'View Bob');
  assert.equal(element('stopPlayerView').disabled, true,
    'a target switch must preserve mutation loading until the original request settles');
  assert.match(element('playerViewStatus').textContent, /Returning to the saved position/i);
  statusQueue.push(Promise.resolve(spectate('Bob')));
  pendingStop.resolve(spectate('Alex'));
  await flush();
  assert.doesNotMatch(element('playerViewStatus').textContent, /Viewing Alex through/i,
    'a completed mutation for the previous target must not repaint the new target');
  pendingBob.resolve(snapshot('Bob', { x: 44, spectate: spectate('Bob') }));
  await flush();
  assert.equal(element('playerX').textContent, '44');
  assert.equal(element('playerViewPanel').hidden, true, 'no recovery controls appear without a saved session');
  assert.equal(element('playerViewViewer').value, '', 'online players without a session are not choices');
  assert.doesNotMatch(source, /api\.(?:startPlayerSpectating|exportPlayerViewCompanion)/);

  statisticsQueue.push(Promise.resolve({ categories: [], totalEntries: 0, updatedAt: '' }));
  playerEventsQueue.push(Promise.reject(new Error('history disk busy')));
  protectionQueue.push(Promise.resolve([
    { player: 'Bob', action: 'warn', check: 'combat.reach', timestamp: '2026-10-05T09:00:00.000Z', reason: 'Reach' }
  ]));
  element('openStatistics').dispatch('click');
  await flush();
  assert.equal(element('inspectorError').hidden, false, 'partial history failure must be visible');
  assert.match(element('inspectorError').textContent, /player history: history disk busy/i);
  assert.match(element('statisticsSummary').textContent, /1 actions/, 'fulfilled history sources must still render');

  element('backToProfile').dispatch('click');
  statisticsQueue.push(Promise.resolve({ categories: [], totalEntries: 0, updatedAt: '' }));
  playerEventsQueue.push(Promise.resolve([
    { name: 'Bob', type: 'ban', timestamp: '2026-10-05T08:00:00.000Z', reason: 'Test ban' }
  ]));
  protectionQueue.push(Promise.resolve([
    { player: 'Bob', action: 'warn', check: 'combat.reach', timestamp: '2026-10-05T09:00:00.000Z', reason: 'Reach' }
  ]));
  element('openStatistics').dispatch('click');
  await flush();
  assert.equal(playerEventsCalls, 2, 'reopening Statistics must retry a failed source');
  assert.equal(element('inspectorError').hidden, true, 'a successful retry must clear the partial-data warning');
  assert.match(element('statisticsSummary').textContent, /2 actions/);

  element('backToProfile').dispatch('click');
  const pendingCharlie = deferred();
  const pendingStatus = deferred();
  inspectQueue.push(pendingCharlie.promise);
  playerNameListener('Charlie');
  statusQueue.push(pendingStatus.promise);
  intervalCallback();
  intervalCallback();
  await flush();
  assert.equal(statusCalls, 3, 'overlapping status refreshes for one target must share one in-flight request');
  pendingCharlie.resolve(snapshot('Charlie', { spectate: spectate('Charlie') }));
  await flush();
  pendingStatus.resolve(spectate('Charlie', 'active'));
  await flush();
  assert.doesNotMatch(element('playerViewStatus').textContent, /^Viewing\b/i,
    'a slower standalone status response must not overwrite the newer inspect-returned snapshot');

  const offlineView = spectate('Charlie', 'active');
  offlineView.sessions[0].online = false;
  inspectQueue.push(snapshot('Charlie', { spectate: offlineView }));
  element('refreshPlayer').dispatch('click');
  await flush();
  assert.equal(element('playerViewPanel').hidden, false);
  assert.equal(element('stopPlayerView').disabled, true, 'offline return awaits a reconnect');
  assert.match(element('playerViewStatus').textContent, /recover when they reconnect/);
  assert.ok(inspectCalls >= 5);
  console.log('PASS player inspector reliability');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
