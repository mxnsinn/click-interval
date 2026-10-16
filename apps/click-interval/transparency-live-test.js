const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', path.join(__dirname, 'work', `transparency-live-${process.pid}`));
app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay();
  const width = 390;
  const height = 400;
  const x = display.bounds.x + 80;
  const y = display.bounds.y + 80;
  const background = new BrowserWindow({ x, y, width, height, frame: false, resizable: false, show: false });
  await background.loadURL(`data:text/html,<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%}body{background:linear-gradient(90deg,%23f02 0 50%,%2309f 50%)}</style>`);
  background.showInactive();

  const foreground = new BrowserWindow({
    x, y, width, height, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, alwaysOnTop: true, show: false
  });
  await foreground.loadURL(`data:text/html,<style>html,body{margin:0;width:100%;height:100%;background:transparent}body{background:rgba(7,9,11,.5);backdrop-filter:blur(24px) saturate(135%)}</style>`);
  foreground.showInactive();
  await new Promise(resolve => setTimeout(resolve, 500));

  const source = (await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: display.size
  })).find(item => item.display_id === String(display.id));
  if (!source) throw new Error('Primary display capture was unavailable.');
  const scale = display.scaleFactor || 1;
  const crop = source.thumbnail.crop({
    x: Math.round((x - display.bounds.x) * scale),
    y: Math.round((y - display.bounds.y) * scale),
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  });
  const output = path.join(__dirname, 'work', 'transparency-live-test.png');
  fs.writeFileSync(output, crop.toPNG());
  const bitmap = crop.toBitmap();
  const pixel = (px, py) => {
    const offset = (py * crop.getSize().width + px) * 4;
    return { b: bitmap[offset], g: bitmap[offset + 1], r: bitmap[offset + 2], a: bitmap[offset + 3] };
  };
  const left = pixel(30, 200);
  const right = pixel(width - 30, 200);
  const passed = left.r > left.b + 35 && right.b > right.r + 35;
  console.log(JSON.stringify({ passed, left, right, output }));
  background.destroy();
  foreground.destroy();
  app.exit(passed ? 0 : 1);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
