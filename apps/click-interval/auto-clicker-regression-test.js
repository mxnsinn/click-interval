const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const backendPath = process.env.AUTO_CLICKER_TEST_BACKEND
  ? path.resolve(process.env.AUTO_CLICKER_TEST_BACKEND)
  : path.join(projectRoot, 'backend.py');
const backendSource = fs.readFileSync(backendPath, 'utf8');
const launcherSource = fs.readFileSync(path.join(projectRoot, 'build-branded-launcher.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
const checks = {
  hookProcessesKeyboardEdge: backendSource.includes('process_auto_hotkey_event(int(data.vkCode), is_key_down)'),
  hookProcessesMouseEdge: backendSource.includes('process_auto_hotkey_event(physical_vk, message in (WM_MBUTTONDOWN, WM_XBUTTONDOWN))'),
  testUsesRealWindowsHook: backendSource.includes('def inject_test_hotkey(vk):'),
  mouseHookIgnoresInjectedClicks: !backendSource.includes('now - last_mouse_hotkey_at'),
  pollingWorkerNotStarted: !backendSource.includes('threading.Thread(target=hotkey_worker'),
  clicksAreIndividuallyPaced: backendSource.includes('else click_once(settings)') && !backendSource.includes('def click_batch') && !backendSource.includes('math.ceil(target_cps'),
  missedTicksNeverBurst: backendSource.includes('def next_click_deadline') && backendSource.includes('return completed_at + period_seconds') && !backendSource.includes('remaining < -0.25'),
  clickSettingsAreLockFree: backendSource.includes('settings = auto_click_settings_snapshot') && !/with state_lock/.test(backendSource.slice(backendSource.indexOf('def click_worker'), backendSource.indexOf('def command_worker'))),
  generatedTelemetryIsBounded: backendSource.includes('generated_event_now - generated_event_last_sent >= (1.0 / 30.0)') && mainSource.includes('emit_generated_input_events: Boolean(settings.showInputDisplay && settings.inputDisplayGenerated)'),
  sendInputDeliveryIsVerified: backendSource.includes('if int(user32.SendInput(2, inputs, ctypes.sizeof(Input))) == 2:'),
  blockedInputStopsWithExplanation: backendSource.includes('Windows blocked simulated mouse input.'),
  launcherDoesNotForceElevation: !launcherSource.includes("'requested-execution-level': 'requireAdministrator'"),
  launcherAppliesProductBranding: launcherSource.includes("icon: path.join(projectRoot, 'assets', 'toolbox-icon.ico')") && launcherSource.includes("'product-version': packageDocument.version"),
  startupUsesOneWindow: !mainSource.includes('await createSplashWindow();'),
  startupRevealIsScheduledBeforePageLoad: mainSource.indexOf("setTimeout(revealMainWindow, 1500);") < mainSource.indexOf("await window.loadFile('index.html');"),
  secondInstanceFocusesWithoutRelaunch: !mainSource.includes('app.relaunch(') && mainSource.includes("app.on('second-instance'"),
  rendererDoesNotRestartBackendAtStartup: !fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8').includes('window.bridge.restartBackend();'),
  backendQueuesUntilReady: mainSource.includes('pendingBackendCommands') && mainSource.includes("if (event.type === 'ready')"),
  backendRestartsAfterUnexpectedExit: mainSource.includes('scheduleBackendRestart(`The click engine stopped'),
  emergencyStopDoesNotQuitApp: !/event\.type === 'emergency_stop'[\s\S]{0,120}quitCleanly/.test(mainSource),
  stoppedCpsIsCleared: mainSource.includes('currentGeneratedCps = clickerRunning || running ? Math.max(0, Number(cps) || 0) : 0;'),
  staleCpsEventsAreIgnored: mainSource.includes("if (event.type === 'cps' && clickerRunning)")
};

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function run() {
  const backend = spawn(path.join(projectRoot, 'runtime', 'python.exe'), ['-u', backendPath], {
    cwd: projectRoot,
    windowsHide: true,
    env: { ...process.env, CLICK_INTERVAL_TEST: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let output = '';
  backend.stdout.on('data', chunk => { output += chunk.toString(); });
  backend.stderr.on('data', chunk => { output += chunk.toString(); });
  const send = payload => backend.stdin.write(`${JSON.stringify(payload)}\n`);

  for (let attempt = 0; attempt < 100 && !output.includes('"type": "ready"'); attempt += 1) await wait(20);
  send({ action: 'configure', enabled: true, auto_tool_active: true, hotkey_vk: 0x51, hotkey_name: 'Q' });
  send({ action: '_test_inject_hotkey', vk: 0x51 });
  await wait(100);
  send({ action: '_test_inject_hotkey', vk: 0x51 });
  await wait(100);
  send({ action: 'configure', enabled: true, auto_tool_active: true, hotkey_vk: 0x06, hotkey_name: 'MB5' });
  await wait(900);
  send({ action: '_test_inject_hotkey', vk: 0x06 });
  await wait(100);
  send({ action: '_test_inject_hotkey', vk: 0x06 });
  await wait(100);
  await wait(100);
  backend.kill();

  const starts = (output.match(/"type": "started"/g) || []).length;
  const stops = (output.match(/"type": "stopped"/g) || []).length;
  checks.oneTogglePerKeyPress = starts === 2 && stops === 2;
  checks.backendStayedHealthy = !output.includes('"type": "error"');
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  process.stdout.write(JSON.stringify({ passed: failed.length === 0, backendPath, checks, starts, stops, failed, output: failed.length ? output : undefined }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
