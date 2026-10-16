'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'minecraft-server', 'main.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const backendSearch = main.slice(
  main.indexOf('async function searchAddons(options = {})'),
  main.indexOf('async function getAddonDetails(options = {})')
);
assert.match(backendSearch, /const nextOffset = offset \+ rawResults\.length/,
  'CurseForge cursors must advance by provider results consumed');
assert.match(backendSearch, /const nextOffset = resultOffset \+ rawHits\.length/,
  'Modrinth cursors must advance before unsupported server-only results are filtered');
assert.match(backendSearch, /hasMore: rawHits\.length > 0 && nextOffset < total/,
  'Modrinth pagination must expose an explicit continuation signal');
assert.doesNotMatch(backendSearch, /Math\.min\(10_000/,
  'the backend must not pin every later request to a repeated 10,000-row cursor');
assert.match(backendSearch, /String\(hit\.server_side \|\| ''\).*unsupported/,
  'unsupported server-side projects should remain filtered without corrupting the provider cursor');

const uiSearch = ui.slice(
  ui.indexOf('async function searchAddons({ append = false } = {})'),
  ui.indexOf('function renderAll()')
);
assert.match(uiSearch, /offset: append \? addonNextOffset : 0/,
  'the UI must request the provider cursor instead of its filtered visible-row count');
assert.match(uiSearch, /addonHasMore = typeof result\?\.hasMore === 'boolean'/,
  'the UI must honor the provider continuation signal');
assert.match(uiSearch, /renderAddonResults\(message, append \? \{ appendFrom: previousLength \} : \{\}\)/,
  'appending a page must add only the new rows');
assert.doesNotMatch(ui, /MAX_RENDERED_ADDON_RESULTS/,
  'there must be no artificial result ceiling that makes later projects unreachable');

const renderer = ui.slice(
  ui.indexOf('function renderAddonResults(message ='),
  ui.indexOf('function normalizeModPolicy')
);
const incrementalBranch = renderer.slice(0, renderer.indexOf('const preserveScroll'));
assert.match(incrementalBranch, /createDocumentFragment\(\)/,
  'new rows should be appended in one lightweight DOM batch');
assert.doesNotMatch(incrementalBranch, /innerHTML\s*=\s*''/,
  'appending must not clear the scroller and disturb its visual position');
assert.match(renderer, /const previousScrollTop = preserveScroll \? list\.scrollTop : 0/,
  'status-driven full refreshes must preserve scroll position within the same query');
assert.match(renderer, /addonBrowseRenderSignature === signature/,
  'unchanged status refreshes must not reconstruct a long add-on result list');
assert.match(styles, /\.ms-addon-row\s*\{[^}]*height:\s*50px;[^}]*flex:\s*0 0 50px/,
  'add-on rows need a fixed non-shrinking extent when the list fills');
assert.match(styles, /\.ms-addon-row\s*\{[^}]*content-visibility:\s*auto/,
  'off-screen add-on cards should skip rendering work');

console.log('PASS Minecraft add-on continuation and smooth append contract');
