const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const renderWindow = new BrowserWindow({
    width: 256,
    height: 256,
    useContentSize: true,
    frame: false,
    transparent: true,
    show: false
  });
  await renderWindow.loadURL('about:blank');
  const dataUrl = await renderWindow.webContents.executeJavaScript(`(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 256, 256);
    context.fillStyle = '#e6e8ea';
    context.beginPath();
    context.roundRect(82, 32, 92, 70, 24);
    context.fill();
    context.clearRect(102, 51, 52, 34);
    context.beginPath();
    context.roundRect(32, 72, 192, 148, 28);
    context.fill();
    context.fillStyle = '#159bd7';
    context.fillRect(32, 111, 192, 34);
    context.fillStyle = '#090a0c';
    context.beginPath();
    context.roundRect(112, 123, 32, 42, 7);
    context.fill();
    context.fillStyle = '#e6e8ea';
    context.beginPath();
    context.roundRect(119, 129, 18, 18, 4);
    context.fill();
    return canvas.toDataURL('image/png');
  })()`);
  const source = nativeImage.createFromDataURL(dataUrl);
  renderWindow.destroy();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map(size => source.resize({ width: size, height: size, quality: 'best' }).toPNG());
  const headerSize = 6 + sizes.length * 16;
  let offset = headerSize;
  const directory = Buffer.alloc(headerSize);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  const iconBytes = Buffer.concat([directory, ...images]);
  const pngBytes = images[images.length - 1];
  fs.writeFileSync(path.join(__dirname, 'assets', 'toolbox-icon.ico'), iconBytes);
  fs.writeFileSync(path.join(__dirname, 'assets', 'toolbox-icon.png'), pngBytes);
  // Preserve legacy asset paths so existing pinned shortcuts immediately pick
  // up the toolbox artwork after an in-place update.
  fs.writeFileSync(path.join(__dirname, 'assets', 'mouse-icon.ico'), iconBytes);
  fs.writeFileSync(path.join(__dirname, 'assets', 'mouse-icon.png'), pngBytes);
  app.quit();
});
