const fs = require('fs');
const path = require('path');

const files = ['main.js', 'renderer.js', 'preload.js', 'index.html', 'styles.css', 'README.md'];
const source = files.map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n').toLowerCase();
const forbidden = [
  'image trigger', 'choose-smart-template', 'read-smart-template', 'smarttemplatedirectory',
  'findtemplatematch', 'bitmapdifferenceat', 'templatepath', 'templatename',
  'reference image', 'detection image', 'value="image"', "value: 'image'", "kind === 'image'"
];
const found = forbidden.filter(value => source.includes(value));
if (found.length) throw new Error(`Removed trigger traces remain: ${found.join(', ')}`);
console.log(JSON.stringify({ passed: true, checkedFiles: files.length }));
