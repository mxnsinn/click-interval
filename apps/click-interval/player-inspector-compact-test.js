'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('./player-inspector-data');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

const statistics = {
  categories: [
    {
      id: 'minecraft:custom',
      entries: [
        { id: 'minecraft:walk_one_cm', value: 123456 },
        ...Array.from({ length: 149 }, (_, index) => ({ id: `minecraft:custom_${index}`, value: index }))
      ]
    },
    {
      id: 'minecraft:killed',
      entries: [
        { id: 'minecraft:zombie', value: 12 },
        ...Array.from({ length: 149 }, (_, index) => ({ id: `minecraft:mob_${index}`, value: index }))
      ]
    }
  ]
};

const timestamp = '2026-10-03T08:30:00.000Z';
const moderation = data.buildModerationHistory('Alex', [
  { name: 'Alex', type: 'cheat-detected', timestamp, reason: 'Reach violation' },
  { name: 'Alex', type: 'kicked', timestamp: '2026-10-03T08:20:00.000Z', reason: 'Movement check' },
  { name: 'Alex', type: 'temp-ban', timestamp: '2026-10-03T08:10:00.000Z', reason: 'Repeated violations', expiresAt: '2026-10-03T09:10:00.000Z' },
  { name: 'Alex', type: 'ban', timestamp: '2026-10-03T08:00:00.000Z', reason: 'Final offense' },
  { name: 'Steve', type: 'ban', timestamp: '2026-10-03T09:00:00.000Z', reason: 'Wrong player' }
], [
  { id: 'incident-1', player: 'Alex', action: 'warn', check: 'combat.reach', timestamp, reason: 'Reach violation' }
]);

assert.deepEqual(moderation.map(row => row.action), ['warning', 'kick', 'temp-ban', 'ban']);
assert.equal(moderation[0].check, 'combat.reach', 'the detailed protection incident should win duplicate merging');
assert.equal(moderation.some(row => row.reason === 'Wrong player'), false, 'another player history must not leak into the profile');

const rows = data.buildRows(statistics, moderation);
assert.equal(rows.filter(row => row.kind === 'statistic').length, 300, 'every saved vanilla statistic should remain available');
assert.equal(data.filterRows(rows, 'walk one cm').length, 1, 'search should understand readable Minecraft statistic names');
assert.equal(data.filterRows(rows, 'zombie').length, 1, 'per-mob statistics should be searchable');
assert.equal(data.filterRows(rows, 'temporary ban').length, 1, 'moderation actions should share statistics search');

const collected = [];
for (let pageIndex = 0; pageIndex < Math.ceil(rows.length / data.DEFAULT_PAGE_SIZE); pageIndex += 1) {
  const page = data.paginateRows(rows, pageIndex);
  assert.ok(page.rows.length <= data.DEFAULT_PAGE_SIZE, 'each render should have a bounded row count');
  collected.push(...page.rows.map(row => row.id));
}
assert.equal(collected.length, rows.length, 'paging should retain every row');
assert.deepEqual(collected, rows.map(row => row.id), 'paging should preserve source order');

const html = read('player-inspector.html');
const css = read('player-inspector.css');
const ui = read('player-inspector.js');
const main = read('main.js');
const builder = read('build-development-update.ps1');

assert.match(main, /width: 800,[\s\S]*height: 510,[\s\S]*title: `View \$\{playerInspectorName\}`,[\s\S]*resizable: false/,
  'the compact inspector window should remain fixed-size');
assert.match(css, /body\s*\{[^}]*width:\s*800px;[^}]*height:\s*510px;/s);
assert.match(css, /\.xp-track\s*\{[^}]*overflow:\s*hidden;/s, 'XP progress must stay clipped to its track');
assert.match(ui, /style\.backgroundColor = 'transparent'/, 'a real XP texture must not bleed over a fallback green fill');
assert.doesNotMatch(html, /id="healthValue"|id="hungerValue"|class="vital-label"/, 'redundant HUD labels and x/20 text should be gone');
assert.match(html, /id="healthBar"[^>]*aria-label="Health"[\s\S]*id="hungerBar"[^>]*aria-label="Hunger"/,
  'compact icon bars should remain accessible');
assert.match(html, /player-inspector-data\.js[\s\S]*player-inspector\.js/, 'the data helper should load before the inspector UI');
assert.match(ui, /api\.getPlayerEvents\(\)/, 'the inspector should include persisted kick and ban history');
assert.match(ui, /api\.getProtectionHistory\(\{ player: requestedPlayer, limit: 1000 \}\)/,
  'the inspector should include detailed warnings and protection actions');
assert.match(ui, /inspectorData\.paginateRows\(filteredRows, statisticsPageIndex\)/,
  'statistics rendering should stay bounded');
assert.match(builder, /'player-inspector-data\.js'/, 'development updates must include the inspector runtime helper');

console.log('PASS compact player inspector statistics and moderation history');
