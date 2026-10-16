'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const controls = require('./dimension-lock-controls');
const plain = value => JSON.parse(JSON.stringify(value));
function harness(changes = {}) {
  const details = { revision: 'revision-one', worldName: 'world', canEdit: true, canUnlock: true,
    nether: { locked: true, unlockAtMillis: '0', startOnLaunchMillis: '0', openingDurationMillis: '0' },
    end: { locked: true, unlockAtMillis: '0', startOnLaunchMillis: '0', openingDurationMillis: '0' }, ...changes };
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { checked: false, disabled: false, value: '', hidden: false, handlers: {},
      addEventListener(event, action) { this.handlers[event] = action; } });
    return elements.get(id);
  };
  const draft = controls.createDraft(details, 'profile-one');
  let edits = 0;
  controls.hydrate(draft, get); controls.sync(details, get);
  controls.bind(get, () => details, () => edits++);
  const change = (id, value) => { const element = get(id); if (typeof value === 'boolean') element.checked = value; else element.value = String(value); element.handlers[id.endsWith('Duration') ? 'input' : 'change'](); };
  return { details, elements, get, draft, change, collect: () => controls.collect(draft, get), edits: () => edits };
}

{
  const h = harness();
  assert.equal(h.get('netherAutoOpen').checked, false);
  assert.equal(h.get('endAutoOpen').checked, false);
  assert.equal(h.get('netherDuration').value, '', 'no suggested timer silently becomes a schedule');
  assert.equal(h.get('netherTimer').hidden, true);
  assert.equal(h.collect(), null, 'unrelated settings save emits no dimension operation');
  assert.match(h.get('netherLockHint').textContent, /Stays locked/);
  h.change('netherAutoOpen', true);
  assert.equal(h.get('netherTimer').hidden, false);
  assert.throws(h.collect, /Choose a Nether opening timer/, 'checking Auto requires an explicit duration');
  h.change('netherDuration', 2);
  h.change('netherDurationUnit', 'hours');
  assert.deepEqual(h.collect(), { revision: 'revision-one', worldName: 'world', profileId: 'profile-one', changes: { lockNether: { locked: true, autoOpen: true, durationSeconds: 7200 } } });
  assert.equal(h.get('endAutoOpen').checked, false, 'choosing Nether never enables End');
}
{
  const h = harness({ nether: { locked: true, unlockAtMillis: String(Date.now() + 7200000), durationSeconds: 7199 } });
  assert.equal(h.get('netherAutoOpen').checked, true);
  assert.match(h.get('netherLockHint').textContent, /Current opening:/);
  const oldNow = Date.now;
  Date.now = () => oldNow() + 60000;
  try { assert.equal(h.collect(), null, 'time passing does not restart an existing countdown on Save'); }
  finally { Date.now = oldNow; }
  h.change('netherAutoOpen', false);
  assert.deepEqual(h.collect().changes, { lockNether: true }, 'turning Auto off keeps locked and cancels schedule');
  h.change('lockNether', false);
  assert.equal(h.get('netherAutoOpen').checked, false);
  assert.equal(h.get('netherAutoOpen').disabled, true);
  assert.deepEqual(h.collect().changes, { lockNether: false }, 'manual opening cancels the timer');
}
{
  const h = harness({ nether: { locked: false, unlockAtMillis: '0' } });
  h.change('lockNether', true);
  assert.deepEqual(h.collect().changes, { lockNether: true }, 'manual locking never adds a schedule');
  assert.equal(h.get('netherAutoOpen').checked, false);
}
{
  const h = harness({ nether: { locked: true, startOnLaunchMillis: '172800000', openingDurationMillis: '172800000' } });
  assert.equal(h.get('netherDuration').value, '2');
  assert.equal(h.get('netherDurationUnit').value, 'days');
  assert.equal(h.collect(), null, 'a pending next-start timer remains unchanged');
  h.change('netherDuration', 0.5);
  assert.equal(h.collect().changes.lockNether.durationSeconds, 43200);
  for (const invalid of ['', '-1', '366', 'Infinity', 'not-a-number']) {
    h.change('netherDuration', invalid); assert.throws(h.collect, /1 second and 365 days/);
  }
  h.change('netherDurationUnit', 'seconds');
  h.change('netherDuration', 1.5); assert.throws(h.collect, /1 second and 365 days/);
  h.change('netherDuration', 1); assert.equal(h.collect().changes.lockNether.durationSeconds, 1);
}
{
  const h = harness({ canEdit: false, canUnlock: false, message: 'Unsupported server' });
  assert.equal(h.get('lockEnd').disabled, true);
  assert.equal(h.get('netherAutoOpen').disabled, true);
  assert.equal(h.collect(), null);
}

// Exercise the real collection functions used by both screens with the shared controls.
function slice(source, from, to) { const start = source.indexOf(from), end = source.indexOf(to, start); assert.ok(start >= 0 && end > start); return source.slice(start, end); }
for (const standalone of [false, true]) {
  const h = harness(); h.change('endAutoOpen', true); h.change('endDuration', 15); h.change('endDurationUnit', 'minutes');
  const source = fs.readFileSync(path.join(__dirname, standalone ? 'minecraft-server/renderer/renderer.js' : 'minecraft-server-ui.js'), 'utf8');
  const sandbox = { window: { DimensionLockControls: controls }, status: { config: { motd: 'Keep me' } }, currentConfig: { motd: 'Keep me' }, fields: [],
    dimensionLockDraft: h.draft, standaloneDimensionLockDraft: h.draft,
    $: id => h.get(id.replace(/^msSetting_/, '')), document: { getElementById: h.get, querySelectorAll: () => [] } };
  vm.runInNewContext(standalone ? slice(source, 'function collectConfig(', '\nfunction isEditingSettingsInput') : slice(source, '  function collectSettings(', '\n  function formatPlayerDate'), sandbox);
  const result = standalone ? sandbox.collectConfig(true) : sandbox.collectSettings();
  assert.equal(result.motd, 'Keep me');
  assert.deepEqual(plain(result._dimensionLockChanges.changes), { lockEnd: { locked: true, autoOpen: true, durationSeconds: 900 } });
  if (standalone) assert.equal(sandbox.collectConfig(false)._dimensionLockChanges, undefined, 'autosave must not apply a pending timer');
}
console.log('Dimension timer UI passed: explicit opt-in, duration validation, manual opening, cancellation, no rearming, independent dimensions, both Settings screens.');
