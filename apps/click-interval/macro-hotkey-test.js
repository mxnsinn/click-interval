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
  const send = value => backend.stdin.write(`${JSON.stringify(value)}\n`);
  const press = async keys => {
    send({ action: '_test_physical_keys', keys });
    await wait(25);
    send({ action: '_test_physical_keys', keys: [] });
    await wait(25);
  };
  for (let attempt = 0; attempt < 100 && !output.includes('"type": "ready"'); attempt += 1) await wait(20);
  send({
    action: 'configure',
    macro_tool_active: false,
    auto_tool_active: false,
    macro_record_hotkey_keys: [0x11, 0x79],
    macro_play_hotkey_keys: [0x11, 0x7A],
    macro_repeat_mode: 'constant',
    macro_repeat_count: 1,
    macro_playback_speed: 1,
    macro_control_capture_active: false
  });
  await press([0x11, 0x79]);
  send({ action: 'configure', macro_tool_active: true });
  await press([0x11, 0x79]);
  await wait(340);
  await press([0x11, 0x79]);
  send({ action: 'macro_set_actions', actions: [{ type: 'wait', ms: 20 }] });
  await press([0x11, 0x7A]);
  await wait(75);
  await press([0x11, 0x7A]);
  await wait(50);
  send({ action: 'configure', macro_stop_on_input: true });
  send({ action: 'macro_set_actions', actions: [{ type: 'wait', ms: 1000 }] });
  await press([0x11, 0x7A]);
  await wait(400);
  await press([0x41]);
  await wait(50);
  backend.kill();
  const recordingStarts = (output.match(/"type": "macro_recording_started"/g) || []).length;
  const recordingStops = (output.match(/"type": "macro_recording_stopped"/g) || []).length;
  const playbackStarts = (output.match(/"type": "macro_playback_started"/g) || []).length;
  const playbackStops = (output.match(/"type": "macro_playback_stopped"/g) || []).length;
  const passed = recordingStarts === 1 && recordingStops === 1 && playbackStarts === 2 && playbackStops === 2 && !output.includes('"type": "error"');
  process.stdout.write(JSON.stringify({ passed, recordingStarts, recordingStops, playbackStarts, playbackStops }, null, 2));
  process.exitCode = passed ? 0 : 1;
}

run();
