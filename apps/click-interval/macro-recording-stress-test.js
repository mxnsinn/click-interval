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
  send({ action: 'macro_record_start', settings: { mouse_movement: true, delays: false, position_mode: 'absolute', quality: 'ultra' } });
  await wait(320);
  const started = process.hrtime.bigint();
  for (let index = 0; index < 5000; index += 1) {
    send({ action: '_test_recorded_move', x: index % 1920, y: (index * 3) % 1080 });
  }
  const barrierToken = `recording-${process.pid}`;
  send({ action: '_test_command_barrier', token: barrierToken });
  for (let attempt = 0; attempt < 500 && !output.includes(`\"type\": \"test_command_barrier\", \"token\": \"${barrierToken}\"`); attempt += 1) await wait(20);
  await wait(320);
  send({ action: 'macro_record_stop' });
  for (let attempt = 0; attempt < 500 && !output.includes('"type": "macro_recording_stopped"'); attempt += 1) await wait(20);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const events = output.trim().split(/\r?\n/).map(line => {
    try { return JSON.parse(line); } catch (_) { return null; }
  }).filter(Boolean);
  const stopped = events.find(event => event.type === 'macro_recording_stopped');
  const paths = stopped?.actions?.filter(action => action.type === 'move_path') || [];
  const points = paths.reduce((total, action) => total + action.points.length, 0);
  const encodedBytes = Buffer.byteLength(JSON.stringify(stopped?.actions || []));
  backend.kill();
  const passed = points === 5000 && paths.length === 3 && paths.every(pathAction => pathAction.points.length <= 2048) && encodedBytes < 150000 && elapsedMs < 10000 && !output.includes('Traceback');
  process.stdout.write(JSON.stringify({ passed, points, pathActions: paths.length, encodedBytes, elapsedMs: Math.round(elapsedMs) }, null, 2));
  process.exitCode = passed ? 0 : 1;
}

run();
