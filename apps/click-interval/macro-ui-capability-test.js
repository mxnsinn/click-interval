const fs = require('fs');
const path = require('path');

const project = __dirname;
const html = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(project, 'renderer.js'), 'utf8');
const documents = process.env.OneDrive
  ? path.join(process.env.OneDrive, 'Documents')
  : path.join(process.env.USERPROFILE, 'Documents');
const macroPath = path.join(documents, 'Click Interval', 'Macros', 'Bar Keeper.json');
const macro = JSON.parse(fs.readFileSync(macroPath, 'utf8'));

for (const requirement of [
  'value="relation"',
  'value="mouse_down"',
  'value="mouse_up"',
  'id="newActionButton"',
  'id="relationBoundaryColor"',
  'id="relationTargetColor"',
  'id="relationTolerance"',
  'id="relationEdgeMargin"'
]) {
  if (!html.includes(requirement)) throw new Error(`Missing UI capability: ${requirement}`);
}

if (!renderer.includes("['mouse_click', 'mouse_down', 'mouse_up']")) {
  throw new Error('The Add Action UI does not handle independent mouse actions.');
}
if (!renderer.includes("smartActivation.kind === 'relation'")) {
  throw new Error('The Color Relation trigger editor is not connected.');
}
if (!renderer.includes('function playbackMacroActions() {\n  return macroActions;')) {
  throw new Error('Advanced triggers are still being removed before playback.');
}
if (renderer.includes('onSmartActivationStatus')) {
  throw new Error('The removed whole-macro screen monitor is still connected.');
}
for (const label of ['Color Presence', 'Pixel Color', 'Color Zone', 'Bar Fill', 'Screen Change']) {
  if (!html.includes(label) || !renderer.includes(label)) throw new Error(`Missing accurate trigger label: ${label}`);
}

const allowedPresetTypes = new Set(['flow_trigger', 'mouse_down', 'mouse_up', 'wait']);
const invalid = macro.actions.filter(action => !allowedPresetTypes.has(action.type));
if (invalid.length) throw new Error(`Bar Keeper contains unavailable actions: ${invalid.map(action => action.type).join(', ')}`);
if (macro.actions.filter(action => action.type === 'flow_trigger').some(action => action.config?.kind !== 'relation')) {
  throw new Error('Bar Keeper contains a trigger not created by the Color Relation editor.');
}

console.log(JSON.stringify({
  passed: true,
  actionCount: macro.actions.length,
  actionTypes: macro.actions.map(action => action.type)
}, null, 2));
