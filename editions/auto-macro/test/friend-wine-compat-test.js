'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isWineEnvironment, enableWineElectronCompatibility } = require('../app/wine-compat');

assert.equal(isWineEnvironment({ platform: 'darwin', environment: { WINEPREFIX: '/tmp/wine' } }), false);
assert.equal(isWineEnvironment({ platform: 'win32', environment: { WINEPREFIX: 'Z:\\Users\\test' } }), true);
assert.equal(isWineEnvironment({ platform: 'win32', environment: { CX_BOTTLE: 'ClickInterval' } }), true);
assert.equal(isWineEnvironment({ platform: 'win32', environment: { CLICK_INTERVAL_WINE_COMPAT: '1' } }), true);
assert.equal(isWineEnvironment({
  platform: 'win32',
  environment: { SystemRoot: 'C:\\windows' },
  run: () => ({ status: 0 })
}), true);
assert.equal(isWineEnvironment({
  platform: 'win32',
  environment: { SystemRoot: 'C:\\windows' },
  run: () => ({ status: 1 })
}), false);

const calls = [];
const fakeApp = {
  disableHardwareAcceleration: () => calls.push('software'),
  commandLine: { appendSwitch: value => calls.push(value) }
};
assert.equal(enableWineElectronCompatibility(fakeApp, {
  platform: 'win32',
  environment: { WINEPREFIX: 'Z:\\Users\\test' }
}), true);
assert.deepEqual(calls, ['software', 'disable-gpu']);

const backend = fs.readFileSync(path.join(__dirname, '..', 'app', 'backend.py'), 'utf8');
assert(backend.includes('WINE_RUNTIME = is_wine_runtime()'));
assert(backend.includes('if not WINE_RUNTIME:'));
assert(backend.includes('create_timer = kernel32.CreateWaitableTimerW'));
assert(backend.includes('"wine_compatibility": WINE_RUNTIME'));

console.log(JSON.stringify({ passed: true, assertions: 11 }, null, 2));
