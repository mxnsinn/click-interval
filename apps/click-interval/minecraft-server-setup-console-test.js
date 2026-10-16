'use strict';

const assert = require('node:assert/strict');
const { SETUP_CATALOG, parseSetupConsoleArgs, runSetupConsoleCommand } = require('./minecraft-server/setup-console');

function createHarness() {
  const calls = [];
  const handlers = Object.fromEntries(SETUP_CATALOG.map((entry) => [entry.name, {
    status: async () => { calls.push(['status', entry.name]); return `${entry.label} configured`; },
    remove: async () => { calls.push(['remove', entry.name]); return `${entry.label} removed.`; }
  }]));
  return { calls, handlers };
}

(async () => {
  assert.equal(Object.isFrozen(SETUP_CATALOG), true);
  assert.equal(SETUP_CATALOG.length, 7);
  for (const entry of SETUP_CATALOG) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.aliases), true);
    for (const name of [entry.name, ...entry.aliases]) {
      const { calls, handlers } = createHarness();
      const output = await runSetupConsoleCommand(['DELETE', name.toUpperCase()], handlers);
      assert.deepEqual(calls, [['remove', entry.name]], `${name} must invoke only its own removal handler`);
      assert.equal(output, `[Server Console] ${entry.label} removed.`);
    }
  }

  for (const args of [
    ['delete'], ['delete', 'silent-restart', 'now'], ['list', 'all'], ['help', 'delete'],
    ['remove', 'silent-restart'], ['delete', ''], ['delete', 'silent restart'],
    ['delete', '../SMP'], ['delete', 'C:\\Users\\example'], ['delete', '/silent-restart'],
    ['delete', '*'], ['delete', 'all'], ['delete', '__proto__'], ['delete', 'constructor'],
    ['delete', 'world'], ['delete', 'silent-restart;stop'], ['delete', 'Silent-Restart\n'],
    ['delete', {}], [null], 'delete silent-restart', undefined
  ]) {
    const { calls, handlers } = createHarness();
    await assert.rejects(runSetupConsoleCommand(args, handlers), /Usage:|Unknown setup:/);
    assert.deepEqual(calls, [], 'invalid command must not read or remove anything');
  }

  assert.deepEqual(parseSetupConsoleArgs([]), { action: 'list' });
  for (const args of [[], ['list'], ['LIST']]) {
    const { calls, handlers } = createHarness();
    const output = await runSetupConsoleCommand(args, handlers);
    assert.deepEqual(calls, SETUP_CATALOG.map((entry) => ['status', entry.name]));
    for (const entry of SETUP_CATALOG) {
      assert.ok(output.includes(`${entry.name}: ${entry.label} configured`));
      assert.ok(output.includes(`/setup delete ${entry.name} — ${entry.removal}`));
    }
    assert.match(output, /saved across restarts/);
    assert.match(output, /next server start; rendered map data stays/);
    assert.match(output, /public mappings and tunnels remain off/);
  }

  {
    const { calls, handlers } = createHarness();
    assert.match(await runSetupConsoleCommand(['help'], handlers), /does not delete worlds or arbitrary files/);
    assert.deepEqual(calls, [], 'help must not need backend access');
    assert.match(await runSetupConsoleCommand(['help']), /Managed setups/);
  }

  {
    const { calls, handlers } = createHarness();
    const guardedError = new Error('Stop Minecraft first; no server files changed.');
    handlers['silent-restart'].remove = async () => { calls.push(['remove', 'silent-restart']); throw guardedError; };
    await assert.rejects(runSetupConsoleCommand(['delete', 'silent-restart'], handlers), (error) => error === guardedError);
    assert.deepEqual(calls, [['remove', 'silent-restart']], 'a rejected removal must not fall back to another operation');
  }

  {
    const { calls, handlers } = createHarness();
    delete handlers.voice;
    await assert.rejects(runSetupConsoleCommand(['list'], handlers), /voice setup status handler is unavailable/);
    assert.deepEqual(calls, [], 'list must validate its handlers before invoking any');
    await assert.rejects(runSetupConsoleCommand(['delete', 'voice'], handlers), /voice setup remove handler is unavailable/);
    assert.deepEqual(calls, []);
  }

  {
    const { handlers } = createHarness();
    handlers.voice.status = async () => { throw new Error('Cannot read the selected profile'); };
    await assert.rejects(runSetupConsoleCommand(['list'], handlers), /Cannot read the selected profile/);
    handlers.voice.remove = async () => undefined;
    await assert.rejects(runSetupConsoleCommand(['delete', 'voice'], handlers), /removal did not report its result/);
  }

  console.log('PASS setup console finite catalog, strict parsing, read-only listing, exact removal dispatch, and backend error propagation');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
