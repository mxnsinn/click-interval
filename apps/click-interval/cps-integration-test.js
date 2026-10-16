const { app, BrowserWindow, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const resultPath = path.join(__dirname, 'cps-integration-result.json');
const clickType = process.env.CPS_TEST_CLICK_TYPE === 'Double' ? 'Double' : 'Single';
const mouseButton = ['Left', 'Right', 'Middle'].includes(process.env.CPS_TEST_MOUSE_BUTTON)
  ? process.env.CPS_TEST_MOUSE_BUTTON
  : 'Left';
const configuredCpsCap = Math.max(1, Number(process.env.CPS_TEST_CAP) || 250);
const backendPath = process.env.CPS_TEST_BACKEND
  ? path.resolve(process.env.CPS_TEST_BACKEND)
  : path.join(__dirname, 'backend.py');

app.setPath('userData', path.join(__dirname, 'work', `cps-integration-profile-${process.pid}`));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const originalCursor = screen.getCursorScreenPoint();
  const target = new BrowserWindow({
    width: 320,
    height: 220,
    x: 100,
    y: 100,
    frame: false,
    alwaysOnTop: true,
    webPreferences: { backgroundThrottling: false }
  });

  const html = `<!doctype html><html><body style="margin:0;background:#eef6ff;font:20px Segoe UI;display:grid;place-items:center;height:100vh;user-select:none">
    <div><strong>Automatic CPS test</strong><div id="count" style="text-align:center;font-size:42px">0</div></div>
    <script>window.testCounts={down:0,up:0,click:0,buttons:{0:0,1:0,2:0},activations:{Left:0,Right:0,Middle:0}};
      addEventListener('mousedown',event=>{window.testCounts.down++;window.testCounts.buttons[event.button]++});
      addEventListener('mouseup',()=>window.testCounts.up++);
      addEventListener('click',()=>{window.testCounts.click++;window.testCounts.activations.Left++;document.getElementById('count').textContent=window.testCounts.activations.Left});
      addEventListener('contextmenu',event=>{event.preventDefault();window.testCounts.activations.Right++;document.getElementById('count').textContent=window.testCounts.activations.Right});
      addEventListener('auxclick',event=>{if(event.button===1){window.testCounts.activations.Middle++;document.getElementById('count').textContent=window.testCounts.activations.Middle}});
    <\/script></body></html>`;
  await target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  target.show();
  target.focus();
  await wait(300);

  const bounds = target.getBounds();
  const center = { x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) };
  const python = spawn(path.join(__dirname, 'runtime', 'python.exe'), ['-u', backendPath], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let backendOutput = '';
  python.stdout.on('data', data => { backendOutput += data.toString(); });
  python.stderr.on('data', data => { backendOutput += data.toString(); });
  const send = command => python.stdin.write(`${JSON.stringify(command)}\n`);

  for (let attempt = 0; attempt < 50 && !backendOutput.includes('"ready"'); attempt++) await wait(20);
  send({
    action: 'configure', enabled: false, interval_ms: 1, random_enabled: false,
    mouse_button: mouseButton, click_type: clickType, cps_cap: configuredCpsCap,
    cursor_mode: 'picked', cursor_x: center.x, cursor_y: center.y
  });

  const started = process.hrtime.bigint();
  send({ action: 'start' });
  await wait(1000);
  send({ action: 'stop' });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  await wait(100);

  const counts = await target.webContents.executeJavaScript('window.testCounts');
  send({ action: 'set_cursor', x: originalCursor.x, y: originalCursor.y });
  await wait(50);
  python.kill();

  fs.writeFileSync(resultPath, JSON.stringify({
    configuredCpsCap,
    configuredClickType: clickType,
    configuredMouseButton: mouseButton,
    elapsedMs,
    ...counts,
    cps: counts.click / (elapsedMs / 1000),
    backendReady: backendOutput.includes('"ready"'),
    backendPath,
    backendOutput
  }, null, 2));
  target.close();
  app.quit();
});
