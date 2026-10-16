'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'minecraft-server', 'main.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const standalonePreload = fs.readFileSync(path.join(root, 'minecraft-server', 'preload.js'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build-development-update.ps1'), 'utf8');

const startup = main.slice(main.indexOf('async function startServer'), main.indexOf('async function stopServer'));
assert(!startup.includes('refreshManagedTradeAssistantBeforeStartUnlocked'), 'startup must not install Trade Assistant');
assert(!main.includes("ipcMain.handle('tools:exportTradeAssistantClient'"), 'client export IPC must be retired');
assert(!main.includes("require('./trade-assistant-control')"), 'retired bridge must not be required at startup');
assert(!ui.includes('exportTradeAssistantClient'), 'installed add-on rows must not offer a Trade Assistant client mod');
assert(!ui.includes('server-trade-assistant-generated.png'), 'generated Trade Assistant artwork must not be used');
assert(!preload.includes('exportTradeAssistantClient'));
assert(!standalonePreload.includes('exportTradeAssistantClient'));
assert(build.includes('Trade Assistant is retired.'));
assert(build.includes("server-trade-assistant-generated.png') -Force -ErrorAction SilentlyContinue"));

console.log('PASS Trade Assistant retirement prevents startup reinstall and client export');
