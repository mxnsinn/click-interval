'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ui = fs.readFileSync(path.join(__dirname, 'minecraft-server-ui.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

function extractFunction(name) {
  const start = ui.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const bodyStart = ui.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < ui.length; index += 1) {
    const character = ui[index];
    const next = ui[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (character === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (character === '\'' || character === '"' || character === '`') { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return ui.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const atlasSandbox = {};
vm.runInNewContext(`${extractFunction('skinBustParts')}\nthis.skinBustParts = skinBustParts;`, atlasSandbox);
const plain = value => JSON.parse(JSON.stringify(value));

const classic = plain(atlasSandbox.skinBustParts('classic', false));
assert.deepEqual(classic.find(part => part.name === 'head'), { name: 'head', source: [8, 8, 8, 8], target: [4, 0, 8, 8] });
assert.deepEqual(classic.find(part => part.name === 'body'), { name: 'body', source: [20, 20, 8, 12], target: [4, 8, 8, 12] });
assert.deepEqual(classic.find(part => part.name === 'right-arm'), { name: 'right-arm', source: [44, 20, 4, 12], target: [0, 8, 4, 12] });
assert.deepEqual(classic.find(part => part.name === 'left-arm'), { name: 'left-arm', source: [36, 52, 4, 12], target: [12, 8, 4, 12], mirror: false });
assert.deepEqual(classic.find(part => part.name === 'hat'), { name: 'hat', source: [40, 8, 8, 8], target: [4, 0, 8, 8] });
assert.ok(classic.some(part => part.name === 'jacket'), 'modern skins should render the jacket layer');
assert.ok(classic.some(part => part.name === 'right-sleeve'), 'modern skins should render sleeve layers');

const slim = plain(atlasSandbox.skinBustParts('slim', false));
assert.deepEqual(slim.find(part => part.name === 'right-arm').source, [44, 20, 3, 12], 'slim arms should use the three-pixel UV width');
assert.deepEqual(slim.find(part => part.name === 'right-arm').target, [1, 8, 3, 12], 'slim arms should stay centered around the torso');
assert.deepEqual(slim.find(part => part.name === 'left-sleeve').source, [52, 52, 3, 12], 'slim left sleeve should use its independent modern UV');

const legacy = plain(atlasSandbox.skinBustParts('classic', true));
assert.deepEqual(legacy.find(part => part.name === 'left-arm'), { name: 'left-arm', source: [44, 20, 4, 12], target: [12, 8, 4, 12], mirror: true }, 'legacy left arm should mirror the only stored arm');
assert.ok(!legacy.some(part => ['jacket', 'right-sleeve', 'left-sleeve'].includes(part.name)), 'legacy skins should not sample nonexistent outer body layers');
assert.ok(legacy.some(part => part.name === 'hat'), 'legacy skins should retain their valid hat layer');

const drawCalls = [];
const drawContext = {
  drawImage: (...arguments_) => drawCalls.push(['drawImage', ...arguments_]),
  save: () => drawCalls.push(['save']),
  restore: () => drawCalls.push(['restore']),
  translate: (...arguments_) => drawCalls.push(['translate', ...arguments_]),
  scale: (...arguments_) => drawCalls.push(['scale', ...arguments_])
};
const drawSandbox = { PLAYER_BUST_PIXEL_SCALE: 2 };
vm.runInNewContext(`${extractFunction('drawSkinPart')}\nthis.drawSkinPart = drawSkinPart;`, drawSandbox);
const fakeImage = {};
drawSandbox.drawSkinPart(drawContext, fakeImage, 2, { source: [44, 20, 4, 12], target: [0, 8, 4, 12] });
assert.deepEqual(drawCalls[0].slice(2), [88, 40, 8, 24, 0, 16, 8, 24], 'HD atlas coordinates and two-pixel output scale should be applied exactly once');
drawCalls.length = 0;
drawSandbox.drawSkinPart(drawContext, fakeImage, 1, { source: [44, 20, 4, 12], target: [12, 8, 4, 12], mirror: true });
assert.deepEqual(drawCalls.map(call => call[0]), ['save', 'translate', 'scale', 'drawImage', 'restore'], 'legacy mirroring should be isolated to one canvas transform');
assert.deepEqual(drawCalls[1], ['translate', 32, 16], 'legacy left arm should mirror inside the viewer-right arm bounds');

const identitySandbox = {};
vm.runInNewContext([
  extractFunction('normalizedPlayerUuid'),
  extractFunction('normalizedPlayerName'),
  extractFunction('playerVisualKeys'),
  extractFunction('playerVisualIdentifier'),
  'this.playerVisualKeys = playerVisualKeys; this.playerVisualIdentifier = playerVisualIdentifier;'
].join('\n'), identitySandbox);
assert.equal(identitySandbox.playerVisualIdentifier({ id: '12345678-90ab-cdef-1234-567890abcdef' }, 'Player'), 'uuid:1234567890abcdef1234567890abcdef', 'protocol id should be normalized as the preferred UUID cache key');
assert.deepEqual(plain(identitySandbox.playerVisualKeys({ uuid: '12345678-90ab-cdef-1234-567890abcdef' }, 'Player')), ['uuid:1234567890abcdef1234567890abcdef'], 'UUID-backed rows must never reuse a possibly stale username skin');
assert.deepEqual(plain(identitySandbox.playerVisualKeys({}, 'Mixed_Name')), ['name:mixed_name'], 'valid player names should provide a case-insensitive cache key');
assert.equal(identitySandbox.playerVisualIdentifier({ id: 'not-a-uuid' }, '<invalid>'), '', 'invalid identifiers should never trigger a skin lookup');

const signatureSandbox = {
  playerAccess: { loaded: true, assignments: [], commandGroups: {} },
  playerAccessLoading: false,
  playerAccessError: ''
};
vm.runInNewContext(`${extractFunction('playerRowFingerprint')}\n${extractFunction('playerRenderSignature')}\nthis.playerRenderSignature = playerRenderSignature;`, signatureSandbox);
const ban = { name: 'Player', uuid: 'abc', temporary: true, endAt: 1234, reason: 'test', remainingMs: 900 };
const sameBanLater = { ...ban, remainingMs: 400 };
assert.equal(signatureSandbox.playerRenderSignature('banned', [ban]), signatureSandbox.playerRenderSignature('banned', [sameBanLater]), 'countdown-only polling must not rebuild a banned row');
assert.notEqual(signatureSandbox.playerRenderSignature('banned', [ban]), signatureSandbox.playerRenderSignature('banned', [{ ...ban, reason: 'changed' }]), 'visible ban changes must rebuild the row');

assert.doesNotMatch(ui, /mc-heads\.net/i, 'third-party rendered avatars must be fully removed');
assert.match(ui, /const atlasScale = width \/ 64/, 'HD skin UV coordinates should scale from the canonical 64-pixel atlas');
assert.match(ui, /context\.imageSmoothingEnabled = false/g, 'both atlas rendering and cached copies should preserve crisp pixels');
assert.match(ui, /const cached = cachedPlayerBust\(keys\);\s*if \(cached\) showPlayerBust\(figure, cached\)/s, 'cached canvases should paint synchronously during row creation');
assert.match(ui, /api\.getPlayerSkin\(\{\s*name:[\s\S]*uuid:/, 'skin data should come from the verified local bridge contract');
assert.match(ui, /authoritativeUuid && resultUuid !== authoritativeUuid/, 'a UUID-backed row must reject a skin returned for another account');
assert.match(ui, /PLAYER_BUST_CACHE_LIMIT = 256/, 'rendered player skins should use a bounded LRU cache');
assert.match(ui, /key\.startsWith\('uuid:'\) \? PLAYER_BUST_UUID_TTL_MS : PLAYER_BUST_NAME_TTL_MS/, 'name aliases should expire sooner than authoritative UUID skins');
assert.match(ui, /if \(playerSkinRequests\.get\(key\) === request\) playerSkinRequests\.delete\(key\)/, 'failed skin lookups should be evicted so a transient outage can recover');
assert.match(ui, /playerSkinRequests\.clear\(\);\s*playerBustCanvases\.clear\(\);[\s\S]*delete playerList\.dataset\.playerRenderSignature/, 'switching servers should clear profile-specific skin state and row identity');
assert.match(ui, /requestGeneration !== playerSkinGeneration/, 'a request from a previous server profile must not repopulate the current cache');
assert.match(ui, /if \(!figure\.isConnected \|\| generation !== playerSkinGeneration\) return;/, 'late skin lookups should not paint detached or previous-profile rows');
assert.match(ui, /const playerSkinRetryAfter = new Map\(\)/, 'transient failures should share a bounded retry cooldown instead of creating a timer per row');
assert.match(ui, /PLAYER_SKIN_MAX_CONCURRENCY = 4/, 'skin lookups must be concurrency bounded');
assert.match(ui, /new window\.IntersectionObserver/, 'off-screen player rows should defer skin work until they approach the viewport');
assert.doesNotMatch(`${extractFunction('loadSkinImage')}\n${extractFunction('createPlayerFigure')}`, /\.loading\s*=|loading=["']lazy/i, 'skin loading should never be deferred by lazy-loading');
const figureRule = styles.match(/\.ms-player-figure\s*\{[^}]*\}/s)?.[0] || '';
assert.match(figureRule, /background:\s*transparent\s*;/i, 'the figure container should have a transparent background');
assert.doesNotMatch(figureRule, /background:\s*(?:color-mix|#[0-9a-f]{3,8}|rgb\()/i, 'the figure container should not paint a colored background');
assert.doesNotMatch(styles.match(/\.ms-player-(?:figure|bust)[^}]*\}/gs)?.join('\n') || '', /transition\s*:/i, 'player visuals should never flash through a fade transition');
assert.match(ui, /list\.dataset\.playerRenderSignature === renderSignature && list\.childElementCount/, 'unchanged player collections should reuse their DOM rows');

console.log('PASS Minecraft player skin rendering and stable-row contract');
