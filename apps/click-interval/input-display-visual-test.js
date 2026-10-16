const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', path.join(__dirname, 'work', `input-display-visual-${process.pid}`));
app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay();
  const x = display.bounds.x + 90;
  const y = display.bounds.y + 90;
  const target = new BrowserWindow({
    x, y, width: 300, height: 112, frame: false, transparent: true, backgroundColor: '#00000000',
    show: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'input-display-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  await target.loadFile('input-display.html');
  target.showInactive();
  target.webContents.send('input-display-config', {
    inputDisplayScale: 100, inputDisplayLingerMs: 3000, inputDisplayOpacity: 88,
    inputDisplayAccent: '#42a5f5', inputDisplayBackground: '#11151a', inputDisplayText: '#ffffff'
  });
  target.webContents.send('input-display-event', { device: 'mouse', control: 'Left', action: 'down', source: 'macro' });
  target.webContents.send('input-display-event', { device: 'keyboard', control: 65, action: 'down', source: 'macro' });
  target.webContents.send('input-display-event', { device: 'keyboard', control: 81, action: 'up', source: 'macro' });
  await new Promise(resolve => setTimeout(resolve, 300));
  const crop = await target.webContents.capturePage();
  const output = path.join(__dirname, 'work', 'input-display-visual-test.png');
  fs.writeFileSync(output, crop.toPNG());
  const state = await target.webContents.executeJavaScript(`({
    mouseDown: document.querySelector('[data-button="Left"]').classList.contains('down'),
    keyDown: [...document.querySelectorAll('.keycap.down b')].some(item => item.textContent === 'A'),
    keyUp: [...document.querySelectorAll('.keycap.up b')].some(item => item.textContent === 'Q')
  })`);
  const passed = state.mouseDown && state.keyDown && state.keyUp;
  console.log(JSON.stringify({ passed, ...state, output }));
  target.destroy();
  app.exit(passed ? 0 : 1);
}).catch(error => { console.error(error); app.exit(1); });
