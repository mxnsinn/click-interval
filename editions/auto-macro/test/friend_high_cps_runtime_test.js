'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const friendRoot = path.resolve(__dirname, '..');
const backendPath = path.join(friendRoot, 'app', 'backend.py');
const stagedPython = path.resolve(friendRoot, '..', '..', 'artifacts', 'auto-macro-stage', 'runtime', 'python.exe');
const pythonPath = process.env.PYTHON || (require('node:fs').existsSync(stagedPython) ? stagedPython : 'python');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function run() {
  const backend = spawn(pythonPath, ['-u', backendPath], {
    cwd: path.dirname(backendPath),
    windowsHide: true,
    env: { ...process.env, CLICK_INTERVAL_TEST: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let output = '';
  backend.stdout.on('data', chunk => { output += chunk.toString(); });
  backend.stderr.on('data', chunk => { output += chunk.toString(); });
  const send = payload => backend.stdin.write(`${JSON.stringify(payload)}\n`);

  try {
    for (let attempt = 0; attempt < 100 && !output.includes('"type": "ready"'); attempt += 1) await wait(20);
    assert.match(output, /"type": "ready"/, 'Backend did not become ready.');
    send({
      action: 'configure', enabled: false, auto_tool_active: true,
      interval_ms: 0, random_enabled: false, mouse_button: 'Left',
      click_type: 'Single', cps_cap: 1000, cursor_mode: 'current'
    });
    send({ action: 'start' });
    await wait(1250);
    send({ action: 'stop' });
    await wait(80);

    // Repeated UI configuration wakes must reschedule the clock, not become
    // one immediate click each. Keep this in backend test mode: no input is sent.
    send({
      action: 'configure', enabled: false, auto_tool_active: true,
      interval_ms: 0, random_enabled: false, mouse_button: 'Left',
      click_type: 'Single', cps_cap: 20, cursor_mode: 'current'
    });
    send({ action: 'start' });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await wait(5);
      send({
        action: 'configure', enabled: false, auto_tool_active: true,
        interval_ms: 0, random_enabled: false, mouse_button: 'Left',
        click_type: 'Single', cps_cap: 20, cursor_mode: 'current'
      });
    }
    await wait(900);
    send({ action: 'stop' });
    await wait(80);

    // Genuinely changing timing values may defer the next click until the UI
    // settles, but must never turn those changes into an overspeed burst.
    send({ action: 'start' });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await wait(5);
      send({
        action: 'configure', enabled: false, auto_tool_active: true,
        interval_ms: 0, random_enabled: false, mouse_button: 'Left',
        click_type: 'Single', cps_cap: attempt % 2 === 0 ? 18 : 22,
        cursor_mode: 'current'
      });
    }
    send({
      action: 'configure', enabled: false, auto_tool_active: true,
      interval_ms: 0, random_enabled: false, mouse_button: 'Left',
      click_type: 'Single', cps_cap: 20, cursor_mode: 'current'
    });
    await wait(2200);
    send({ action: 'stop' });
    await wait(80);
  } finally {
    backend.kill();
  }

  const events = output.split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch (_) { return []; }
  });
  const samples = events.filter(event => event.type === 'cps').map(event => Number(event.value));
  const autoEvents = events.filter(event => event.type === 'input_event' && event.source === 'auto');
  assert(samples.length >= 1, `No aggregate CPS sample was emitted. Output: ${output}`);
  assert(samples[0] >= 850 && samples[0] <= 1100, `Unexpected 1000-CPS scheduler sample: ${samples[0]}`);
  assert(samples.length >= 2, `No configuration-wakeup CPS sample was emitted. Output: ${output}`);
  assert(samples[1] >= 15 && samples[1] <= 30, `Configuration wakes generated early clicks: ${samples[1]} CPS`);
  const changingSamples = samples.slice(2);
  assert(changingSamples.length >= 2, `No changing-configuration CPS samples were emitted. Output: ${output}`);
  assert(changingSamples.every(value => value >= 0 && value <= 30), `Changing settings caused an overspeed burst: ${changingSamples}`);
  assert(changingSamples.at(-1) >= 15, `The click clock did not recover after settings settled: ${changingSamples}`);
  assert.equal(autoEvents.length, 0, 'The two-tool backend emitted per-click auto telemetry.');
  console.log(JSON.stringify({
    passed: true,
    requestedCps: 1000,
    measuredCps: samples[0],
    configuredCps: 20,
    measuredDuringConfigureSpam: samples[1],
    measuredDuringChangingSpam: changingSamples,
    autoTelemetryEvents: 0
  }));
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
