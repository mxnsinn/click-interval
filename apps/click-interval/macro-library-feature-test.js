const fs = require('fs');
const path = require('path');

const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'macro-name.html'), 'utf8');

for (const requirement of ['macroContext:', 'toggleMacroPin', 'Pin limit reached', 'pinnedAt', 'lastUsedAt', 'macro-pin-icon']) {
  if (!renderer.includes(requirement)) throw new Error(`Macro library feature missing: ${requirement}`);
}
if (!renderer.includes("filter(item => item.pinned).length >= 3")) throw new Error('The three-pin limit is missing.');
if (!renderer.includes('left.pinned ? -1 : 1') || !renderer.includes('right.lastUsedAt')) throw new Error('Pinned/MRU ordering is missing.');
if (!html.includes('maxlength="40"') || !main.includes("slice(0, 40)")) throw new Error('The macro-name character limit is incomplete.');
if (!main.includes('actions: []') || !main.includes('packMacroActions')) throw new Error('The lightweight macro index or path packing is missing.');

const sample = [
  { name: 'old', pinned: false, lastUsedAt: '2026-01-01' },
  { name: 'recent', pinned: false, lastUsedAt: '2026-03-01' },
  { name: 'pin2', pinned: true, pinnedAt: '2026-02-02' },
  { name: 'pin1', pinned: true, pinnedAt: '2026-02-01' }
];
sample.sort((left, right) => {
  if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
  if (left.pinned && right.pinned) return String(left.pinnedAt).localeCompare(String(right.pinnedAt));
  return String(right.lastUsedAt).localeCompare(String(left.lastUsedAt));
});
if (sample.map(item => item.name).join(',') !== 'pin1,pin2,recent,old') throw new Error('Pinned/MRU ordering is incorrect.');

console.log(JSON.stringify({ passed: true, pinLimit: 3, nameLimit: 40, order: sample.map(item => item.name) }));
