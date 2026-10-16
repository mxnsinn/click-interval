'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = require('./player-inspector-data');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

assert.equal(data.validPlayerName(' Mxnsinn '), 'Mxnsinn');
assert.equal(data.validPlayerName(''), '');
assert.equal(data.validPlayerName('../player'), '');
assert.equal(data.validPlayerName('a'.repeat(17)), '');

assert.equal(
  data.resolveInitialPlayerName('?player=Mxnsinn', ''),
  'Mxnsinn',
  'the per-window URL must carry the selected player without relying on shared mutable state'
);
assert.equal(
  data.resolveInitialPlayerName('?player=bad%2Fname', 'Fallback_1'),
  'Fallback_1',
  'an invalid URL target must fall back to the validated IPC value'
);
assert.equal(data.resolveInitialPlayerName('', ''), '', 'a genuinely missing target must remain explicit');

const main = read('main.js');
const inspector = read('player-inspector.js');

assert.doesNotMatch(inspector, /\brenderSpectateControls\(/,
  'profile reset must not call the retired spectate-control renderer before assigning the selected player');

const validationIndex = main.indexOf("if (!/^[A-Za-z0-9_]{1,16}$/.test(requestedPlayer)) return;");
const assignmentIndex = main.indexOf('playerInspectorName = requestedPlayer;', validationIndex);
assert.ok(validationIndex >= 0 && assignmentIndex > validationIndex,
  'an invalid open request must not erase the active inspector target');
assert.match(main, /inspectorWebContents\.once\('did-finish-load'[\s\S]*const currentPlayer = String\(playerInspectorName \|\| ''\)\.trim\(\);[\s\S]*\^\[A-Za-z0-9_\]\{1,16\}\$[\s\S]*send\('player-inspector-name', currentPlayer\)/,
  'the latest validated player must be delivered after the renderer installs its listener');
assert.match(main, /loadFile\('player-inspector\.html', \{ query: \{ player: requestedPlayer \} \}\)/,
  'each inspector window must also receive an immutable URL target');
assert.match(inspector, /resolveInitialPlayerName\(window\.location\.search, bridgedPlayer\)/,
  'the inspector must resolve the immutable and IPC startup targets');
assert.match(inspector, /No player was selected[\s\S]*No player selected/,
  'a missing target must not leave the inspector in an endless loading state');

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

class FakeElement {
  constructor() {
    this.children = [];
    this.childElementCount = 0;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.hidden = false;
    this.parentElement = null;
    this.style = { setProperty() {} };
    this.textContent = '';
    this.value = '';
  }
  addEventListener() {}
  append(...children) { this.children.push(...children); this.childElementCount = this.children.length; }
  removeAttribute() {}
  replaceChildren(...children) { this.children = children; this.childElementCount = children.length; }
  setAttribute() {}
  setPointerCapture() {}
}

const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, new FakeElement());
  return elements.get(id);
};
element('xpProgress').parentElement = new FakeElement();
element('xpProgress').parentElement.clientWidth = 200;
const inspectedPlayers = [];
let playerNameListener = null;
const documentMock = {
  hidden: false,
  title: '',
  createElement: () => new FakeElement(),
  createDocumentFragment: () => new FakeElement(),
  getElementById: element,
  querySelectorAll: () => []
};
const windowMock = {
  PlayerInspectorData: data,
  location: { search: '?player=Mxnsinn' },
  addEventListener() {},
  bridge: {
    minecraftServer: {
      inspectPlayer(name) {
        inspectedPlayers.push(name);
        return new Promise(() => {});
      }
    },
    closeCurrentWindow() {},
    loadPlayerInspectorName: () => 'Player_B',
    onPlayerInspectorName(callback) { playerNameListener = callback; }
  }
};
vm.runInNewContext(inspector, {
  Date,
  Image: class {},
  Promise,
  URLSearchParams,
  clearInterval() {},
  document: documentMock,
  setInterval: () => 1,
  window: windowMock
}, { filename: 'player-inspector.js' });
assert.equal(documentMock.title, 'View Mxnsinn', 'startup must finish assigning the selected player');
assert.deepEqual(inspectedPlayers, ['Mxnsinn'], 'startup must immediately request the selected player snapshot');
assert.equal(typeof playerNameListener, 'function', 'startup must subscribe before the post-load target is delivered');
playerNameListener('Player_B');
assert.equal(documentMock.title, 'View Player_B', 'a newer player selection during initial load must win');
assert.deepEqual(inspectedPlayers, ['Mxnsinn', 'Player_B'], 'the post-load current target must replace the URL fallback');

console.log('PASS player inspector startup handoff');
