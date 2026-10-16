'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'minecraft-server', 'main.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');

assert.match(main, /emptyServerAction:\s*'never'[\s\S]*?emptyServerStopMinutes:\s*30/,
  'servers must remain running by default when empty');
assert.match(main, /keepSystemAwakeWhileRunning:\s*true/,
  'the default should prevent app suspension without keeping the monitor awake');
assert.match(main, /emptyServerAction:[\s\S]*?=== 'stop'[\s\S]*?\? 'stop'[\s\S]*?: 'never'/,
  'unknown empty-server actions must normalize to the safe keep-running behavior');
assert.match(main, /emptyServerStopMinutes:\s*clampInteger\([^\n]+1,\s*1440/,
  'empty-server delay must stay between one minute and one day');

const scheduler = main.slice(
  main.indexOf('function cancelEmptyServerAutoStop'),
  main.indexOf('function setState', main.indexOf('function cancelEmptyServerAutoStop'))
);
assert.match(scheduler, /isServerRuntimeReady\(/,
  'idle shutdown must only schedule for a fully running server');
assert.match(scheduler, /livePlayers\.size > 0/,
  'players joining must prevent an automatic shutdown');
assert.match(scheduler, /latestProfile\?\.id !== expectedProfileId/,
  'a timer from one profile must never stop another profile');
assert.match(scheduler, /processRef !== serverProcess[\s\S]*?generation !== serverLifecycleGeneration/,
  'stale process generations must be rejected before shutdown');
assert.match(scheduler, /latestConfig\.emptyServerAction !== 'stop'/,
  'turning automatic shutdown off must invalidate a pending timer');
assert.match(scheduler, /await stopServer\(\{ automaticEmptyStop: true \}\)/,
  'the timer must use the normal save-and-stop lifecycle');
assert.match(main, /if \(livePlayers\.size > 0\) cancelEmptyServerAutoStop\(\);[\s\S]*?syncEmptyServerAutoStop\('player list changed', config\)/,
  'the live player feed must cancel or create the timer immediately');

assert.match(ui, /\['emptyServerAction', 'When nobody is online', 'select', \[\['never','Keep the server running'\],\['stop','Stop the server after a delay'\]\]\]/,
  'settings must expose a clear keep-running or delayed-stop choice');
assert.match(ui, /control\.closest\('\.ms-setting-row'\)\.hidden = \$\('msSetting_emptyServerAction'\)\?\.value !== 'stop'/,
  'the delay field should only occupy space when delayed stop is enabled');
assert.match(main, /powerSaveBlocker\.start\('prevent-app-suspension'\)/,
  'running servers should block app suspension while still allowing display sleep');
assert.doesNotMatch(main, /powerSaveBlocker\.start\('prevent-display-sleep'\)/,
  'the overnight setting must not force the monitor to remain on');
assert.match(main, /stopServerPowerSaveBlocker\(\);[\s\S]*?cancelPendingSafeModeRetry/,
  'quit cleanup should always release the power blocker');
assert.match(ui, /\['keepSystemAwakeWhileRunning', 'Keep PC awake while server runs', 'checkbox'\]/,
  'settings should expose the keep-awake behavior explicitly');

console.log('PASS configurable empty-server shutdown safety');
