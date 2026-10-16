'use strict';

const assert = require('node:assert/strict');
const {
  parseAddonConsoleArgs,
  parseAntiCheatConsoleArgs,
  runAddonConsoleCommand,
  runAntiCheatConsoleCommand
} = require('./minecraft-server/addon-console');

function harness() {
  const calls = [];
  const handlers = Object.fromEntries(['list', 'remove', 'setCheck', 'removeCustom'].map((operation) => [operation,
    async (...args) => { calls.push([operation, ...args]); return `${operation} complete`; }
  ]));
  return { calls, handlers };
}

(async () => {
  for (const action of ['delete', 'remove', 'DELETE', 'REMOVE']) {
    const { calls, handlers } = harness();
    assert.equal(await runAddonConsoleCommand([action, 'MODS', 'Example', 'Mod', '1.2.3.JAR'], handlers), '[Server Console] remove complete');
    assert.deepEqual(calls, [['remove', 'mods', 'Example Mod 1.2.3.JAR']]);
  }
  {
    const { calls, handlers } = harness();
    await runAddonConsoleCommand(['delete', 'plugins', 'My  Plugin.jar'], handlers);
    assert.deepEqual(calls, [['remove', 'plugins', 'My  Plugin.jar']], 'exact internal filename spaces must be preserved');
  }
  for (const args of [[], ['list'], ['LIST'], ['list', 'mods'], ['list', 'PLUGINS']]) {
    const { calls, handlers } = harness();
    await runAddonConsoleCommand(args, handlers);
    assert.deepEqual(calls, [['list', args[1]?.toLowerCase()]]);
  }
  for (const args of [
    ['delete'], ['remove', 'mods'], ['delete', 'world', 'A.jar'], ['delete', 'mods', 'A.txt'],
    ['list', 'all'], ['list', 'mods', 'more'], ['help', 'mods'], ['install', 'mods', 'A.jar'],
    ['delete', 'mods', '../A.jar'], ['delete', 'mods', 'a/Thing.jar'], ['delete', 'mods', 'a\\Thing.jar'],
    ['delete', 'mods', 'C:\\A.jar'], ['delete', 'mods', 'A.jar:stream'], ['delete', 'mods', 'A..jar'],
    ['delete', 'mods', '*A.jar'], ['delete', 'mods', 'A?.jar'], ['delete', 'mods', 'A|B.jar'],
    ['delete', 'mods', 'A<1>.jar'], ['delete', 'mods', '"A.jar"'], ['delete', 'mods', 'A\n.jar'],
    ['delete', 'mods', 'A\0.jar'], ['delete', 'mods', 'A\t.jar'], ['delete', 'mods', 'CON.jar'],
    ['delete', 'mods', 'nul.version.jar'], ['delete', 'mods', 'lpt9.jar'], ['delete', 'mods', '.jar'],
    ['delete', 'mods', 'A.jar', 'unexpected'], ['delete', 'mods', ' A.jar'], ['delete', 'mods', 'A.jar '],
    ['delete', 'mods', `${'a'.repeat(252)}.jar`], ['delete', 'mods', {}], [null], undefined, 'list'
  ]) {
    const { calls, handlers } = harness();
    await assert.rejects(runAddonConsoleCommand(args, handlers));
    assert.deepEqual(calls, [], `malformed add-on command must not invoke a backend: ${JSON.stringify(args)}`);
  }

  for (const action of ['enable', 'disable', 'ENABLE', 'DISABLE']) {
    const { calls, handlers } = harness();
    assert.equal(await runAntiCheatConsoleCommand([action, 'autoClicker'], handlers), '[Server Console] setCheck complete');
    assert.deepEqual(calls, [['setCheck', 'autoClicker', action.toLowerCase() === 'enable']], 'check IDs retain case');
  }
  for (const action of ['enable', 'disable']) {
    const { calls, handlers } = harness();
    await runAntiCheatConsoleCommand([action, 'all'], handlers);
    assert.deepEqual(calls, [['setCheck', 'all', action === 'enable']], 'all delegates the master switch to the backend');
  }
  for (const action of ['delete', 'remove', 'DELETE', 'REMOVE']) {
    const { calls, handlers } = harness();
    const customId = '12345678-abcd-4abc-9abc-123456789abc';
    await runAntiCheatConsoleCommand([action, customId], handlers);
    assert.deepEqual(calls, [['removeCustom', customId]]);
  }
  for (const args of [[], ['list'], ['LIST']]) {
    const { calls, handlers } = harness();
    await runAntiCheatConsoleCommand(args, handlers);
    assert.deepEqual(calls, [['list']]);
  }
  for (const args of [
    ['list', 'all'], ['help', 'all'], ['disable'], ['enable', 'speed', 'flight'], ['remove'],
    ['delete', '12345678', 'extra'], ['toggle', 'speed'], ['enable', '../speed'], ['disable', 'speed/flight'],
    ['disable', 'speed\\flight'], ['disable', 'speed flight'], ['disable', 'speed\n'], ['disable', 'a..b'],
    ['disable', 'A'.repeat(97)], ['delete', 'speed'], ['delete', '12345678.jar'], ['delete', '../12345678'],
    ['delete', 'A'.repeat(65)], ['delete', {}], [null], undefined, 'list'
  ]) {
    const { calls, handlers } = harness();
    await assert.rejects(runAntiCheatConsoleCommand(args, handlers));
    assert.deepEqual(calls, [], `malformed anti-cheat command must not invoke a backend: ${JSON.stringify(args)}`);
  }

  for (const run of [runAddonConsoleCommand, runAntiCheatConsoleCommand]) {
    const { calls, handlers } = harness();
    assert.match(await run(['help'], handlers), /\[Server Console\]/);
    assert.deepEqual(calls, []);
    assert.match(await run(['help']), /\[Server Console\]/);
    await assert.rejects(run(['list'], {}), /handler is unavailable/);
    const readError = new Error('Selected profile changed');
    handlers.list = async () => { throw readError; };
    await assert.rejects(run(['list'], handlers), (error) => error === readError);
  }
  {
    const { calls, handlers } = harness();
    const guardedError = new Error('The installed JAR changed; no file was removed.');
    handlers.remove = async (...args) => { calls.push(['remove', ...args]); throw guardedError; };
    await assert.rejects(runAddonConsoleCommand(['delete', 'mods', 'Exact.jar'], handlers), (error) => error === guardedError);
    assert.deepEqual(calls, [['remove', 'mods', 'Exact.jar']]);
  }
  {
    const { calls, handlers } = harness();
    handlers.setCheck = async (id, enabled) => { calls.push(['setCheck', id, enabled]); throw new Error('Unknown check ID'); };
    await assert.rejects(runAntiCheatConsoleCommand(['disable', 'unknownCheck'], handlers), /Unknown check ID/);
    assert.deepEqual(calls, [['setCheck', 'unknownCheck', false]], 'the authoritative backend must decide valid check IDs');
    handlers.removeCustom = async () => undefined;
    await assert.rejects(runAntiCheatConsoleCommand(['delete', '12345678'], handlers), /did not report its result/);
  }

  assert.equal(Object.isFrozen(parseAddonConsoleArgs(['list'])), true);
  assert.equal(Object.isFrozen(parseAntiCheatConsoleArgs(['disable', 'speed'])), true);
  console.log('PASS add-on and anti-cheat console strict parsing, safe filenames, exact dispatch, and authoritative backend error propagation');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
