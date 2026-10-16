const { spawn } = require('child_process');
const path = require('path');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function run() {
  const backend = spawn(path.join(__dirname, 'runtime', 'python.exe'), ['-u', path.join(__dirname, 'backend.py')], {
    cwd: __dirname,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let output = '';
  backend.stdout.on('data', data => { output += data.toString(); });
  backend.stderr.on('data', data => { output += data.toString(); });
  const send = value => backend.stdin.write(`${JSON.stringify(value)}\n`);
  for (let attempt = 0; attempt < 100 && !output.includes('"type": "ready"'); attempt += 1) await wait(20);
  send({ action: 'macro_record_start', settings: { mouse_movement: true, mouse_buttons: true, keyboard: true, delays: true, position_mode: 'absolute' } });
  await wait(350);
  send({ action: 'macro_record_stop' });
  for (let attempt = 0; attempt < 100 && !output.includes('"type": "macro_recording_stopped"'); attempt += 1) await wait(20);
  send({ action: 'macro_set_actions', actions: [{ type: 'wait', ms: 60 }] });
  const playbackStartedAt = process.hrtime.bigint();
  send({ action: 'macro_play', repeat: true, repeat_count: 3, speed: 2 });
  for (let attempt = 0; attempt < 100 && !output.includes('"type": "macro_playback_stopped"'); attempt += 1) await wait(20);
  const playbackElapsedMs = Number(process.hrtime.bigint() - playbackStartedAt) / 1e6;
  send({ action: 'macro_set_actions', actions: [{ type: 'wait', ms: 20 }] });
  send({ action: 'macro_play', repeat: true, repeat_count: 0, speed: 1 });
  await wait(110);
  send({ action: 'macro_stop' });
  for (let attempt = 0; attempt < 100 && (output.match(/"type": "macro_playback_stopped"/g) || []).length < 2; attempt += 1) await wait(20);
  backend.kill();
  const completedLoops = (output.match(/"type": "macro_playback_loop"/g) || []).length;
  const infiniteLoops = completedLoops - 3;
  const stoppedEvents = (output.match(/"type": "macro_playback_stopped"/g) || []).length;
  const passed = output.includes('"type": "macro_recording_started"') &&
    output.includes('"type": "macro_recording_stopped"') &&
    output.includes('"type": "macro_playback_started"') &&
    output.includes('"type": "macro_playback_stopped"') &&
    completedLoops >= 5 && infiniteLoops >= 2 && stoppedEvents === 2 &&
    playbackElapsedMs >= 70 && playbackElapsedMs < 300 &&
    !output.includes('"type": "error"');
  process.stdout.write(JSON.stringify({ passed, completedLoops, infiniteLoops, stoppedEvents, playbackElapsedMs, output: output.trim().split(/\r?\n/) }, null, 2));
  process.exitCode = passed ? 0 : 1;
}

run();
