const fs = require('fs');
const path = require('path');
const projectRoot = __dirname;
const source = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const launcherDirectory = path.dirname(source);
const destination = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(launcherDirectory, 'Click Interval.exe');
const legacyDestination = path.join(projectRoot, 'work', 'launcher', 'Click Interval.exe');

async function main() {
  fs.mkdirSync(launcherDirectory, { recursive: true });
  fs.copyFileSync(source, destination);
  const packageDocument = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const { rcedit } = await import('rcedit');
  await rcedit(destination, {
    icon: path.join(projectRoot, 'assets', 'toolbox-icon.ico'),
    'file-version': packageDocument.version,
    'product-version': packageDocument.version,
    'version-string': {
      CompanyName: 'Mxnsinn',
      FileDescription: 'Click Interval',
      InternalName: 'Click Interval',
      OriginalFilename: 'Click Interval.exe',
      ProductName: 'Click Interval'
    }
  });
  if (!process.argv[2] && fs.existsSync(legacyDestination)) fs.unlinkSync(legacyDestination);
  process.stdout.write(`${destination}\n`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
