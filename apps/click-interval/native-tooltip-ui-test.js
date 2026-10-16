const fs = require('fs');
const path = require('path');

const files = ['index.html', 'renderer.js', 'main.js', 'preload.js'];
const source = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(__dirname, file), 'utf8')]));

for (const tooltip of ['Set a random offset for the interval.', 'Right-click for tab options', 'Open a macro file', '250 CPS is the recommended warning threshold for this PC. The selected cap is the maximum click rate regardless of the click interval.']) {
  if (!source['index.html'].includes(`title="${tooltip}"`)) throw new Error(`Missing native tooltip: ${tooltip}`);
}
for (const assignment of ["$('cpsWarning').setAttribute('title'", "$('showAutoClicker').title", 'updateButton.title']) {
  if (!source['renderer.js'].includes(assignment)) throw new Error(`Missing dynamic native tooltip assignment: ${assignment}`);
}
if (/name\.title\s*=\s*`Open \$\{macro\.name\}`/.test(source['renderer.js'])) {
  throw new Error('Saved macro rows should not show an obvious Open tooltip.');
}
for (const marker of ['showHoverHint', 'hideHoverHint', 'customTooltip']) {
  if (!source['renderer.js'].includes(marker)) throw new Error(`Missing custom tooltip UI: ${marker}`);
}
if (!source['renderer.js'].includes("querySelectorAll('[title]').forEach(migrateNativeHint)")) {
  throw new Error('Native title migration is missing.');
}

console.log(JSON.stringify({ passed: true, nativeTooltipSources: true, inlineCustomTooltip: true }));
