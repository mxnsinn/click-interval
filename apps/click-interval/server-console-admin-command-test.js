'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'server-console.js'), 'utf8');
const constantsStart = source.indexOf('const LOCAL_HELPERS');
const constantsEnd = source.indexOf('let renderedCharacters', constantsStart);
const commandStart = source.indexOf('async function runCommand(command)');
const commandEnd = source.indexOf('\ndocument.querySelector', commandStart);

assert.ok(constantsStart >= 0 && constantsEnd > constantsStart, 'console command constants could not be located');
assert.ok(commandStart >= 0 && commandEnd > commandStart, 'runCommand could not be located');

const calls = [];
const moduleMock = { exports: {} };
const sandbox = {
  module: moduleMock,
  exports: moduleMock.exports,
  calls,
  console,
  Promise
};

vm.runInNewContext(`
${source.slice(constantsStart, constantsEnd)}
const api = {
  runAssemblyCommand: async command => { calls.push(['manager', command]); return ''; },
  sendCommand: async command => { calls.push(['minecraft', command]); return true; },
  openChatHistory: async () => { calls.push(['chat-history']); }
};
function append(value) { calls.push(['append', value]); }
async function clearConsole() { calls.push(['clear-console']); }
async function runLifecycle(action) { calls.push(['lifecycle', action]); }
${source.slice(commandStart, commandEnd)}
module.exports = { runCommand, LOCAL_HELPERS, MINECRAFT_COMMAND_COMPLETIONS, COMPLETIONS, HELP_TEXT };
`, sandbox, { filename: 'server-console-admin-command-harness.js' });

const test = moduleMock.exports;

async function expectMinecraft(input, expected) {
  calls.length = 0;
  await test.runCommand(input);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['minecraft', expected]],
    `${input} must reach the Minecraft server console unchanged`);
}

(async () => {
  await expectMinecraft('/give Alex minecraft:diamond 3', 'give Alex minecraft:diamond 3');
  await expectMinecraft('/gamemode creative Alex', 'gamemode creative Alex');
  await expectMinecraft('/tp Alex 10 70 -5', 'tp Alex 10 70 -5');
  await expectMinecraft('/whitelist add Alex', 'whitelist add Alex');
  await expectMinecraft('/execute as Alex run say hello', 'execute as Alex run say hello');
  await expectMinecraft('/clear Alex minecraft:dirt', 'clear Alex minecraft:dirt');
  await expectMinecraft('op Alex', 'op Alex');

  for (const root of ['give', 'op', 'deop', 'gamemode', 'tp', 'teleport', 'whitelist', 'ban', 'pardon', 'execute', 'summon']) {
    assert.equal(test.LOCAL_HELPERS.has(root), false, `/${root} must not be captured by a local Console helper`);
  }

  calls.length = 0;
  await test.runCommand('/send help');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['manager', 'send help']],
    '/send must remain the explicit escape hatch for helper-name conflicts');

  calls.length = 0;
  await test.runCommand('/stop');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['lifecycle', 'stop']],
    'plain /stop must retain the immediate lifecycle-button behavior');

  calls.length = 0;
  await test.runCommand('/stop 30 Planned maintenance');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['manager', 'stop 30 Planned maintenance']],
    '/stop with countdown arguments must reach the announced-shutdown manager');

  calls.length = 0;
  await test.runCommand('/shutdown cancel');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['manager', 'shutdown cancel']],
    '/shutdown controls must not leak into the Minecraft command dispatcher');

  calls.length = 0;
  await test.runCommand('/silent-restart status');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['manager', 'silent-restart status']],
    '/silent-restart must be handled by the guarded server manager, not forwarded to Minecraft');
  assert.equal(test.LOCAL_HELPERS.has('silent-restart'), true);

  for (const prefix of ['/give ', '/clear ', '/tp ', '/execute as ', '/summon ', '/setblock ', '/gamerule ', '/scoreboard objectives list']) {
    assert.ok(test.COMPLETIONS.includes(prefix), `missing Minecraft console completion: ${prefix}`);
  }
  assert.match(test.HELP_TEXT, /dedicated-server console and are not limited by player roles/i);
  assert.match(test.HELP_TEXT, /Use \/send <command>/);
  assert.match(test.HELP_TEXT, /silent-restart \[now message\]/i);
  for (const command of ['silent restart setup', 'silent-restart delete', 'setup list', 'setup delete voice',
    'addons list', 'addons delete mods Example Mod.jar', 'anticheat list', 'anticheat disable fly']) {
    calls.length = 0;
    await test.runCommand(`/${command}`);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['manager', command]]);
  }

  console.log('PASS server console admin command routing and discovery');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
