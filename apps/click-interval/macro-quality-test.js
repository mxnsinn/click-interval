const { spawn } = require('child_process');
const path = require('path');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function run() {
  const backend = spawn(path.join(__dirname, 'runtime', 'python.exe'), ['-u', path.join(__dirname, 'backend.py')], {
    cwd: __dirname,
    windowsHide: true,
    env: { ...process.env, CLICK_INTERVAL_TEST: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let output = '';
  backend.stdout.on('data', data => { output += data.toString(); });
  backend.stderr.on('data', data => { output += data.toString(); });
  const send = command => backend.stdin.write(`${JSON.stringify(command)}\n`);
  for (let attempt = 0; attempt < 100 && !output.includes('"type": "ready"'); attempt += 1) await wait(20);
  send({ action: 'macro_record_start', settings: { mouse_movement: true, mouse_buttons: true, keyboard: true, delays: true, position_mode: 'absolute', quality: 'smooth' } });
  await wait(330);
  for (let index = 0; index < 20; index += 1) {
    send({ action: '_test_recorded_move', x: 400 + index * 3, y: 300 + index * 2 });
    await wait(10);
  }
  await wait(320);
  send({ action: 'macro_record_stop' });
  for (let attempt = 0; attempt < 100 && !output.includes('"type": "macro_recording_stopped"'); attempt += 1) await wait(20);
  const events = output.trim().split(/\r?\n/).map(line => {
    try { return JSON.parse(line); } catch (_) { return null; }
  }).filter(Boolean);
  const stopped = events.find(event => event.type === 'macro_recording_stopped');
  const paths = stopped?.actions?.filter(action => action.type === 'move_path') || [];
  const points = paths.reduce((total, action) => total + action.points.length, 0);
  const playbackBefore = (output.match(/"type": "macro_playback_stopped"/g) || []).length;
  send({ action: 'macro_set_actions', actions: [{ type: 'move_path', relative: true, quality: 'smooth', playback_hz: 144, points: Array.from({ length: 10 }, () => [20, 0, 0]) }] });
  const playbackStartedAt = process.hrtime.bigint();
  send({ action: 'macro_play', repeat: false, repeat_count: 1, speed: 2 });
  for (let attempt = 0; attempt < 100 && (output.match(/"type": "macro_playback_stopped"/g) || []).length <= playbackBefore; attempt += 1) await wait(20);
  const playbackElapsedMs = Number(process.hrtime.bigint() - playbackStartedAt) / 1e6;
  const playbackStopped = (output.match(/"type": "macro_playback_stopped"/g) || []).length > playbackBefore;
  backend.kill();
  const passed = paths.length === 1 && points === 20 && stopped.actions.length === 1 && playbackStopped && playbackElapsedMs >= 80 && playbackElapsedMs < 350 && !output.includes('"type": "error"');
  process.stdout.write(JSON.stringify({ passed, storedActions: stopped?.actions?.length || 0, paths: paths.length, points, playbackStopped, playbackElapsedMs }, null, 2));
  process.exitCode = passed ? 0 : 1;
}

run();
