const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('entity-viewer.html');
const css = read('entity-viewer.css');
const renderer = read('entity-viewer.js');
const preload = read('entity-viewer-preload.js');

assert.match(html, /Content-Security-Policy[^>]*default-src 'self'[^>]*connect-src 'none'[^>]*frame-src 'none'[^>]*object-src 'none'/,
  'the entity viewer must use a strict offline CSP');
assert.doesNotMatch(html, /https?:\/\//i, 'the entity viewer must not load remote resources');
assert.match(html, /theme\.css[\s\S]*entity-viewer\.css[\s\S]*theme-loader\.js[\s\S]*entity-viewer\.js/,
  'the entity viewer should use the shared theme without inline scripts');

for (const channel of ['list', 'inspect', 'updateOffer', 'setAge', 'setCooldown']) {
  assert.match(preload, new RegExp(`entity-viewer:${channel}`), `preload should expose entity-viewer:${channel}`);
}
assert.match(preload, /minimizeWindow[\s\S]*window:minimize[\s\S]*closeWindow[\s\S]*window:close/,
  'the dedicated preload should expose only explicit window controls');
assert.doesNotMatch(preload, /require\(['"](?:fs|child_process|net|http|https)/,
  'the renderer must not receive filesystem, process, or network primitives');

for (const id of ['entitySearch', 'entityList', 'entityCount']) {
  assert(html.includes(`id="${id}"`), `loaded-entity UI is missing ${id}`);
}
assert.match(html, /id="entityId"[\s\S]*id="entityDimension"[\s\S]*id="entityX"[\s\S]*id="entityY"[\s\S]*id="entityZ"/,
  'details should expose stable ID, dimension, and exact coordinates');
assert.match(renderer, /value\.entityUuid \|\| value\.uuid[\s\S]*uuid \|\| value\.stableId \|\| value\.id/,
  'entity rows should accept UUIDs and bounded stable IDs');
assert.match(renderer, /new URLSearchParams\(location\.search\)\.get\('entity'\)/,
  'the renderer should honor the entity selected by the map window');
assert.match(renderer, /ENTITY_ID_PATTERN[\s\S]*\{1,128\}/,
  'entity IDs should be format and length checked before IPC');

assert.match(html, /id="entityGrowthSeconds"[^>]*min="1"[^>]*max="1200"/,
  'baby growth must have a bounded numeric input');
assert.match(html, /id="entityCooldownSeconds"[^>]*min="0"[^>]*max="3600"/,
  'breeding cooldown must have a bounded numeric input');
assert.match(html, />Save age<[\s\S]*>Save cooldown</,
  'age and cooldown changes need explicit save actions');
assert.match(renderer, /ITEM_ID_PATTERN[\s\S]*namespace:item format/,
  'villager item IDs should be validated as namespace:item');
assert.match(renderer, /Cost count', 1, 64[\s\S]*Max uses', 1, 999[\s\S]*Price multiplier', 0, 1/,
  'offer numeric values should be bounded before IPC');
assert.match(renderer, /updateOffer\(selectedDetail\.id, index, payload\)/,
  'each offer should use an explicit save mutation');
assert.match(renderer, /setAge\(selectedDetail\.id, \{ baby, remainingTicks: seconds \* 20 \}\)/,
  'age values should be sent as explicit bounded tick payloads');
assert.match(renderer, /setCooldown\(selectedDetail\.id, \{ ticks: seconds \* 20 \}\)/,
  'cooldown values should be sent as explicit bounded tick payloads');

for (const state of ['Server is stopped', 'Entity bridge unavailable', 'No loaded entities', 'Select an entity']) {
  assert(renderer.includes(state), `friendly empty state missing: ${state}`);
}
assert.doesNotMatch(renderer, /innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(/,
  'untrusted entity data must be rendered with DOM text APIs only');
assert.match(css, /grid-template-columns:\s*220px minmax\(0, 1fr\)/,
  'the viewer should keep a compact fixed-window-friendly layout');
assert.match(css, /overflow-x:\s*hidden;\s*overflow-y:\s*auto/,
  'long loaded-entity and offer lists should scroll instead of squashing');

console.log('PASS standalone entity viewer renderer contract');
