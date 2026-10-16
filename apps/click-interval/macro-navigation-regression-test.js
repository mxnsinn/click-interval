const fs = require('fs');
const path = require('path');

const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

const advancedOpen = renderer.match(/\$\('openAdvancedMacro'\)\.addEventListener[\s\S]*?\n\}\);/)?.[0] || '';
const advancedBack = renderer.match(/\$\('macroAdvancedBack'\)\.addEventListener[\s\S]*?\n\}\);/)?.[0] || '';
if (!advancedOpen || !advancedBack) throw new Error('Advanced navigation handlers are missing.');
if (advancedOpen.includes('persistSelectedMacro') || advancedBack.includes('persistSelectedMacro')) {
  throw new Error('Read-only Advanced navigation still rewrites macro state.');
}
if (!renderer.includes("$('macroRecorderBack').addEventListener('click', async () => {\n  if (!await confirmMacroExit()) return;")) {
  throw new Error('The real editor exit no longer checks unsaved changes.');
}
const toggleCheck = "dropdownOwnerId === event.sender.id && dropdownSelectId === requestedId";
if (!main.includes(toggleCheck) || main.indexOf(toggleCheck) > main.indexOf('closeDropdownWindow();', main.indexOf('async function openDropdownWindow'))) {
  throw new Error('An already-open dropdown is still destroyed and reopened instead of toggled closed.');
}

console.log(JSON.stringify({ passed: true, readOnlyAdvancedNavigation: true, dropdownToggle: true }));
