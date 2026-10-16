const fs = require('fs');

const runtimeFiles = ['main.js', 'preload.js', 'renderer.js'];
for (const file of runtimeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (/ownerConsole|owner-console|showOwnerConsole/.test(source)) {
    throw new Error(`Owner console code remains in ${file}.`);
  }
}
for (const file of ['owner-console-main.js', 'owner-console-preload.js', 'owner-console.html', 'owner-console.css', 'owner-console.js']) {
  if (fs.existsSync(file)) throw new Error(`Removed owner console file still exists: ${file}`);
}
const builder = fs.readFileSync('build-development-update.ps1', 'utf8');
if (!builder.includes('removeFiles = @(') || !builder.includes("'owner-console-main.js'")) {
  throw new Error('The update does not remove owner console files left by an older version.');
}
console.log(JSON.stringify({ passed: true, runtimeFiles: runtimeFiles.length, removedFiles: 5 }));
