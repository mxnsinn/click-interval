const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, 'updater.css'), 'utf8');
const errorCss = fs.readFileSync(path.join(__dirname, 'updater-error.css'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'updater-main.js'), 'utf8');
for (const color of ['#101010', '#3a3a3a', '#1683c7', '#242424', '#191919', '#0b253b']) if (!css.includes(color)) throw new Error(`Updater theme color missing: ${color}`);
if (!main.includes("backgroundColor: '#101010'")) throw new Error('Updater window background does not match the app.');
if (!errorCss.includes('#ff3b30') || !errorCss.includes('linear-gradient(#242424,#191919)')) throw new Error('Updater error theme is inconsistent.');
console.log(JSON.stringify({ passed: true, matchedAppTheme: true }));
