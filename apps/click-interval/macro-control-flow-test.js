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
  send({ action: 'macro_set_actions', actions: [
    { type: 'label', name: 'Loop' },
    { type: 'wait', ms: 20 },
    { type: 'goto', name: 'Loop' }
  ] });
  send({ action: 'macro_play', repeat: false, repeat_count: 1, speed: 1 });
  await wait(130);
  send({ action: 'macro_stop' });
  for (let attempt = 0; attempt < 100 && !output.includes('"type": "macro_playback_stopped"'); attempt += 1) await wait(20);
  backend.kill();
  const passed = output.includes('"type": "macro_playback_started"') &&
    output.includes('"type": "macro_playback_stopped"') &&
    !output.includes('"type": "macro_error"') &&
    !output.includes('Traceback');
  process.stdout.write(JSON.stringify({ passed, output: output.trim().split(/\r?\n/) }, null, 2));
  process.exitCode = passed ? 0 : 1;
}

run();
