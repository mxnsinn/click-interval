'use strict';

const fs = require('fs');
const path = require('path');

async function main() {
  const executablePath = path.resolve(process.argv[2] || '');
  const packagePath = path.resolve(process.argv[3] || '');
  const iconPath = path.resolve(process.argv[4] || '');
  if (!fs.statSync(executablePath).isFile()) throw new Error('The Click Interval executable is missing.');
  const packageDocument = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const { rcedit } = await import('rcedit');
  await rcedit(executablePath, {
    icon: iconPath,
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
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
