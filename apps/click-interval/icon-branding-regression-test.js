'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = relative => fs.readFileSync(path.join(root, relative));
const text = relative => read(relative).toString('utf8');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const toolboxIco = read('assets/toolbox-icon.ico');
const legacyIco = read('assets/mouse-icon.ico');
const toolboxPng = read('assets/toolbox-icon.png');
const legacyPng = read('assets/mouse-icon.png');
const toolboxSvg = read('assets/toolbox-icon.svg');
const legacySvg = read('assets/mouse-icon.svg');

assert.equal(hash(legacyIco), hash(toolboxIco), 'The legacy shortcut ICO must contain the toolbox artwork.');
assert.equal(hash(legacyPng), hash(toolboxPng), 'The legacy PNG must contain the toolbox artwork.');
assert.equal(hash(legacySvg), hash(toolboxSvg), 'The legacy SVG must contain the toolbox artwork.');
assert.equal(toolboxIco.readUInt16LE(2), 1, 'The toolbox asset is not an ICO file.');
assert.equal(toolboxIco.readUInt16LE(4), 7, 'The toolbox ICO must contain all seven Windows icon sizes.');
assert.deepEqual(
  Array.from({ length: 7 }, (_, index) => toolboxIco.readUInt8(6 + index * 16) || 256),
  [16, 24, 32, 48, 64, 128, 256],
  'The toolbox ICO is missing a required Windows size.'
);
assert.equal(toolboxPng.subarray(1, 4).toString('ascii'), 'PNG', 'The toolbox PNG is invalid.');
assert.equal(toolboxPng.readUInt32BE(16), 256, 'The toolbox PNG width must be 256.');
assert.equal(toolboxPng.readUInt32BE(20), 256, 'The toolbox PNG height must be 256.');

for (const relative of ['main.js', 'updater-main.js', 'build-branded-launcher.js', 'install-start-menu.ps1']) {
  const source = text(relative);
  assert(source.includes('toolbox-icon.ico'), `${relative} does not use the toolbox Windows icon.`);
  assert(!source.includes("assets', 'mouse-icon.ico"), `${relative} still selects the old mouse icon.`);
}
for (const relative of ['index.html', 'splash.html', 'updater.html', 'active-indicator.html']) {
  const source = text(relative);
  assert(source.includes('assets/toolbox-icon.svg'), `${relative} does not use the toolbox logo.`);
  assert(!source.includes('assets/mouse-icon.svg'), `${relative} still selects the old mouse logo.`);
}

const mainSource = text('main.js');
const visibleWindowIcons = [...mainSource.matchAll(/icon:\s*path\.join\(__dirname, 'assets', 'toolbox-icon\.ico'\)/g)];
assert(visibleWindowIcons.length >= 13, 'One or more visible Click Interval windows lost the toolbox taskbar icon.');
assert(mainSource.includes('refreshToolboxIconCacheOnce();'), 'The upgraded app no longer refreshes existing pinned shortcut icons.');
assert(mainSource.includes("'.toolbox-icon-cache-v1'"), 'The one-time Windows icon-cache migration marker is missing.');
const updaterSource = text('updater-main.js');
assert(updaterSource.includes('refreshWindowsIconCache();'), 'The updater no longer refreshes cached Windows shortcut icons.');
assert(updaterSource.includes("'-ClearIconCache'") && updaterSource.includes("'-show'"), 'The Windows icon-cache refresh is incomplete.');

console.log(JSON.stringify({
  passed: true,
  icoSizes: [16, 24, 32, 48, 64, 128, 256],
  visibleWindowIcons: visibleWindowIcons.length,
  legacyAssetsMatch: true
}));
