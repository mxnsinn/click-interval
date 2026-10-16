'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_EXPECTED_CHECK_COUNT,
  MAX_LOG_LINE_LENGTH,
  createProtectionRuntimeHandshake,
  beginProtectionRuntimeLifecycle,
  observeProtectionRuntimeLine,
  requestProtectionRuntimeReload,
  expireProtectionRuntimeReload,
  endProtectionRuntimeLifecycle,
  getProtectionRuntimeStatus,
  parseProtectionRuntimeLine
} = require('./minecraft-server/protection-runtime-handshake');

const fabricLine = (message, level = 'INFO') => `[16:44:01] [Server thread/${level}]: ${message}`;
const bukkitLine = (message, level = 'INFO') => `[16:44:01 ${level}]: ${message}`;
const context = Object.freeze({ generation: 7, adapterId: 'fabric-26.2' });

let state = createProtectionRuntimeHandshake();
assert.equal(state.phase, 'idle');
assert.equal(state.active, false);
assert.equal(state.degraded, false);
assert.equal(Object.isFrozen(state), true);
assert.equal(Object.isFrozen(state.reload), true);
assert.equal(getProtectionRuntimeStatus(state), state);

state = beginProtectionRuntimeLifecycle(state, { ...context, now: 100 });
assert.equal(state.phase, 'starting');
assert.equal(state.expectedAdapterId, 'fabric-26.2');
assert.equal(state.expectedCheckCount, DEFAULT_EXPECTED_CHECK_COUNT);
assert.equal(state.observedCheckCount, null);
assert.equal(state.packetAntiXrayActive, null, 'packet provider state is unknown until Fabric reports it');

const validStartup = fabricLine('Server Protection Fabric started with 13 bounded checks.');
assert.equal(observeProtectionRuntimeLine(state, { ...context, generation: 6, line: validStartup }), state,
  'a stale lifecycle must not mutate the handshake');
assert.equal(observeProtectionRuntimeLine(state, { ...context, adapterId: 'fabric-26.3', line: validStartup }), state,
  'a different exact adapter must not mutate the handshake');
assert.equal(observeProtectionRuntimeLine(state, { ...context, line: 'Server Protection Fabric started with 13 bounded checks.' }), state,
  'an untrusted unprefixed line must not acknowledge startup');
assert.equal(observeProtectionRuntimeLine(state, {
  ...context,
  line: fabricLine('<Alex> Server Protection Fabric started with 13 bounded checks.')
}), state, 'player chat must not spoof a runtime marker');
assert.equal(observeProtectionRuntimeLine(state, {
  ...context,
  line: `${validStartup}${'x'.repeat(MAX_LOG_LINE_LENGTH)}`
}), state, 'oversized lines must be ignored without retaining them');

state = observeProtectionRuntimeLine(state, {
  ...context,
  line: `\u001b[32m${validStartup}\u001b[0m`,
  now: 120
});
assert.equal(state.phase, 'active');
assert.equal(state.active, true);
assert.equal(state.degraded, false);
assert.equal(state.checkCount, 13);
assert.equal(state.observedCheckCount, 13);
assert.equal(state.expectedCheckCount, 13);
assert.equal(state.lastMarkerAt, 120);

const packetReady = fabricLine(
  'Server Protection Fabric packet Anti-Xray provider loaded; concealed-ore detection remains available as a secondary signal.'
);
assert.equal(observeProtectionRuntimeLine(state, {
  ...context,
  line: 'Server Protection Fabric packet Anti-Xray provider loaded; concealed-ore detection remains available as a secondary signal.'
}), state, 'an unprefixed packet-provider marker must not be trusted');
assert.equal(observeProtectionRuntimeLine(state, {
  ...context,
  line: fabricLine('<Alex> Server Protection Fabric packet Anti-Xray provider loaded; concealed-ore detection remains available as a secondary signal.')
}), state, 'player chat must not spoof the packet-provider handshake');
assert.equal(observeProtectionRuntimeLine(state, {
  ...context,
  line: fabricLine('<Alex> Server Protection Fabric packet Anti-Xray provider is missing; ore packets are not being obfuscated.')
}), state, 'player chat must not spoof a missing-provider warning');
assert.equal(observeProtectionRuntimeLine(state, {
  ...context,
  generation: context.generation - 1,
  line: packetReady
}), state, 'a stale lifecycle must not activate packet obfuscation');
state = observeProtectionRuntimeLine(state, { ...context, line: packetReady, now: 125 });
assert.equal(state.packetAntiXrayActive, true, 'the exact trusted provider marker should activate packet obfuscation');
assert.equal(state.startupWarning, null);
assert.equal(state.degraded, false);
assert.equal(state.lastMarkerAt, 125);

let missingPacketProvider = beginProtectionRuntimeLifecycle(state, { ...context, generation: 9, now: 200 });
missingPacketProvider = observeProtectionRuntimeLine(missingPacketProvider, {
  ...context,
  generation: 9,
  line: validStartup,
  now: 210
});
missingPacketProvider = observeProtectionRuntimeLine(missingPacketProvider, {
  ...context,
  generation: 9,
  line: fabricLine('Server Protection Fabric packet Anti-Xray provider is missing; ore packets are not being obfuscated.'),
  now: 220
});
assert.equal(missingPacketProvider.active, true, 'the other protection checks remain active when the packet provider is absent');
assert.equal(missingPacketProvider.packetAntiXrayActive, false);
assert.equal(missingPacketProvider.startupWarning.code, 'packet-antixray-missing');
assert.equal(missingPacketProvider.degraded, true);
missingPacketProvider = observeProtectionRuntimeLine(missingPacketProvider, {
  ...context,
  generation: 9,
  line: packetReady,
  now: 230
});
assert.equal(missingPacketProvider.packetAntiXrayActive, true);
assert.equal(missingPacketProvider.startupWarning, null,
  'a later healthy provider marker must clear only the stale packet-provider warning');
assert.equal(missingPacketProvider.degraded, false);

let inactivePacketProvider = beginProtectionRuntimeLifecycle(state, { ...context, generation: 12, now: 231 });
inactivePacketProvider = observeProtectionRuntimeLine(inactivePacketProvider, {
  ...context,
  generation: 12,
  line: fabricLine('Server Protection Fabric packet Anti-Xray provider is inactive; ore packets are not being obfuscated.'),
  now: 232
});
assert.equal(inactivePacketProvider.startupWarning.code, 'packet-antixray-inactive');
inactivePacketProvider = observeProtectionRuntimeLine(inactivePacketProvider, {
  ...context,
  generation: 12,
  line: packetReady,
  now: 233
});
assert.equal(inactivePacketProvider.startupWarning, null);
assert.equal(inactivePacketProvider.packetAntiXrayActive, true);

let unrelatedWarning = beginProtectionRuntimeLifecycle(state, { ...context, generation: 11, now: 240 });
unrelatedWarning = observeProtectionRuntimeLine(unrelatedWarning, {
  ...context,
  generation: 11,
  line: fabricLine('Server Protection ignored access.yml exemptions: unknown role', 'WARN')
});
unrelatedWarning = observeProtectionRuntimeLine(unrelatedWarning, {
  ...context,
  generation: 11,
  line: packetReady
});
assert.equal(unrelatedWarning.startupWarning.code, 'access-config-rejected',
  'a healthy packet provider must not clear an unrelated startup warning');

let layeredWarnings = beginProtectionRuntimeLifecycle(state, { ...context, generation: 13, now: 250 });
layeredWarnings = observeProtectionRuntimeLine(layeredWarnings, {
  ...context,
  generation: 13,
  line: fabricLine('Server Protection Fabric packet Anti-Xray provider is missing; ore packets are not being obfuscated.'),
  now: 251
});
layeredWarnings = observeProtectionRuntimeLine(layeredWarnings, {
  ...context,
  generation: 13,
  line: fabricLine('Server Protection ignored access.yml exemptions: unknown role', 'WARN'),
  now: 252
});
assert.equal(layeredWarnings.generalStartupWarning.code, 'access-config-rejected');
assert.equal(layeredWarnings.packetAntiXrayWarning.code, 'packet-antixray-missing');
layeredWarnings = observeProtectionRuntimeLine(layeredWarnings, {
  ...context,
  generation: 13,
  line: packetReady,
  now: 253
});
assert.equal(layeredWarnings.startupWarning.code, 'access-config-rejected',
  'provider recovery must retain a warning observed after the packet warning');
assert.equal(layeredWarnings.packetAntiXrayWarning, null);

let disabledPacketProvider = beginProtectionRuntimeLifecycle(state, { ...context, generation: 10, now: 300 });
disabledPacketProvider = observeProtectionRuntimeLine(disabledPacketProvider, {
  ...context,
  generation: 10,
  line: validStartup,
  now: 310
});
disabledPacketProvider = observeProtectionRuntimeLine(disabledPacketProvider, {
  ...context,
  generation: 10,
  line: fabricLine('Server Protection Fabric packet Anti-Xray provider is missing and ore protection is disabled.'),
  now: 320
});
assert.equal(disabledPacketProvider.packetAntiXrayActive, false);
assert.equal(disabledPacketProvider.startupWarning, null,
  'an intentionally disabled packet provider should not degrade the protection runtime');
assert.equal(disabledPacketProvider.degraded, false);
let disabledAfterMissing = beginProtectionRuntimeLifecycle(state, { ...context, generation: 14, now: 330 });
disabledAfterMissing = observeProtectionRuntimeLine(disabledAfterMissing, {
  ...context,
  generation: 14,
  line: fabricLine('Server Protection Fabric packet Anti-Xray provider is missing; ore packets are not being obfuscated.')
});
disabledAfterMissing = observeProtectionRuntimeLine(disabledAfterMissing, {
  ...context,
  generation: 14,
  line: fabricLine('Server Protection Fabric packet Anti-Xray provider loaded but ore obfuscation is disabled.')
});
assert.equal(disabledAfterMissing.startupWarning, null,
  'an intentional disable marker should clear an earlier packet-provider warning');
assert.equal(disabledAfterMissing.degraded, false);
assert.equal(parseProtectionRuntimeLine(fabricLine(
  'Server Protection Fabric packet Anti-Xray provider loaded but ore obfuscation is disabled.'
)).kind, 'packet-antixray-disabled');

let oldRuntime = beginProtectionRuntimeLifecycle(state, context);
oldRuntime = observeProtectionRuntimeLine(oldRuntime, {
  ...context,
  line: fabricLine('Server Protection Fabric started with 8 bounded checks.')
});
assert.equal(oldRuntime.startupConfirmed, true);
assert.equal(oldRuntime.active, false, 'an old eight-check Fabric runtime must not be reported active');
assert.equal(oldRuntime.degraded, true);
assert.equal(oldRuntime.observedCheckCount, 8);
assert.equal(oldRuntime.expectedCheckCount, 13);
assert.equal(oldRuntime.startupFailure.code, 'check-count-mismatch');

let failed = beginProtectionRuntimeLifecycle(state, context);
failed = observeProtectionRuntimeLine(failed, {
  ...context,
  line: fabricLine('Server Protection could not load config.yml; protection is disabled: bad threshold', 'ERROR')
});
failed = observeProtectionRuntimeLine(failed, { ...context, line: validStartup });
assert.equal(failed.startupConfirmed, true);
assert.equal(failed.checkCount, 13);
assert.equal(failed.active, false, 'a later startup marker must not clear a latched config failure');
assert.equal(failed.startupFailure.code, 'config-load-failed');

let warned = beginProtectionRuntimeLifecycle(state, context);
warned = observeProtectionRuntimeLine(warned, {
  ...context,
  line: fabricLine('Server Protection ignored access.yml exemptions: unknown role', 'WARN')
});
warned = observeProtectionRuntimeLine(warned, { ...context, line: validStartup });
assert.equal(warned.active, true);
assert.equal(warned.degraded, true);
assert.equal(warned.startupWarning.code, 'access-config-rejected');

let bukkit = beginProtectionRuntimeLifecycle(state, { generation: 8, adapterId: 'bukkit' });
bukkit = observeProtectionRuntimeLine(bukkit, {
  generation: 8,
  adapterId: 'bukkit',
  line: bukkitLine('[ServerProtection] Server Protection enabled with the balanced preset.')
});
assert.equal(bukkit.active, true);
assert.equal(bukkit.observedCheckCount, null, 'the Bukkit marker does not claim a count');
assert.equal(bukkit.expectedCheckCount, 13);
assert.equal(observeProtectionRuntimeLine(bukkit, { ...context, line: validStartup }), bukkit,
  'a marker from another adapter family must be ignored');

state = requestProtectionRuntimeReload(state, {
  ...context,
  requestId: 'settings-42',
  now: 1_000,
  timeoutMs: 2_000
});
assert.equal(state.reload.status, 'pending');
assert.equal(state.reload.deadlineAt, 3_000);
assert.equal(Object.isFrozen(state.reload), true);
assert.equal(requestProtectionRuntimeReload(state, {
  ...context,
  requestId: 'settings-43',
  now: 1_100
}), state, 'only one marker-less reload acknowledgement may be pending');
assert.equal(observeProtectionRuntimeLine(state, {
  ...context,
  generation: 6,
  line: fabricLine('Server Protection config reloaded.')
}), state);
state = observeProtectionRuntimeLine(state, {
  ...context,
  line: fabricLine('Server Protection config reloaded.'),
  now: 1_200
});
assert.equal(state.reload.status, 'succeeded');
assert.equal(state.reload.requestId, 'settings-42');
assert.equal(state.reload.completedAt, 1_200);
assert.equal(state.degraded, false);

state = requestProtectionRuntimeReload(state, {
  ...context,
  requestId: 'settings-44',
  now: 2_000,
  timeoutMs: 1_000
});
state = observeProtectionRuntimeLine(state, {
  ...context,
  line: fabricLine('Server Protection reload failed: invalid maxReach', 'ERROR'),
  now: 2_100
});
assert.equal(state.active, true, 'a rejected reload leaves the previously loaded protection active');
assert.equal(state.degraded, true);
assert.equal(state.reload.status, 'failed');
assert.equal(state.reload.failure.code, 'reload-rejected');

state = requestProtectionRuntimeReload(state, {
  ...context,
  requestId: 'settings-45',
  now: 4_000,
  timeoutMs: 500
});
assert.equal(expireProtectionRuntimeReload(state, { ...context, now: 4_499 }), state,
  'expiry is explicit and must not fire before the deadline');
state = expireProtectionRuntimeReload(state, { ...context, now: 4_500 });
assert.equal(state.reload.status, 'timed-out');
assert.equal(state.reload.failure.code, 'reload-timeout');
assert.equal(state.active, true);
assert.equal(state.degraded, true);

state = requestProtectionRuntimeReload(state, {
  ...context,
  requestId: 'settings-46',
  now: 5_000
});
state = observeProtectionRuntimeLine(state, {
  ...context,
  line: fabricLine('Server Protection config reloaded.'),
  now: 5_100
});
assert.equal(state.reload.status, 'succeeded');
assert.equal(state.degraded, false, 'a later acknowledged reload clears reload-only degradation');

bukkit = requestProtectionRuntimeReload(bukkit, {
  generation: 8,
  adapterId: 'bukkit',
  requestId: 'bukkit-reload',
  now: 6_000
});
bukkit = observeProtectionRuntimeLine(bukkit, {
  generation: 8,
  adapterId: 'bukkit',
  line: bukkitLine('\u00a7eProtection reloaded, but player access was rejected: invalid owner', 'WARN'),
  now: 6_050
});
assert.equal(bukkit.reload.status, 'failed');
assert.equal(bukkit.reload.failure.code, 'access-reload-rejected');
assert.equal(bukkit.active, true);

state = endProtectionRuntimeLifecycle(state, { ...context, now: 7_000 });
assert.equal(state.phase, 'stopped');
assert.equal(state.active, false);
assert.equal(observeProtectionRuntimeLine(state, { ...context, line: validStartup }), state,
  'late output from a stopped generation must be ignored');

const parsedFailure = parseProtectionRuntimeLine(
  bukkitLine('[ServerProtection] Protection config is invalid: x'.padEnd(700, 'y'), 'ERROR')
);
assert.equal(parsedFailure.kind, 'startup-failure');
assert.equal(parsedFailure.issue.message.length, 512, 'failure details must be bounded');
assert.equal(parseProtectionRuntimeLine(bukkitLine('Reload rejected: broken', 'ERROR')).kind, 'reload-failure');
assert.equal(parseProtectionRuntimeLine(fabricLine('Server Protection config reloaded.')).kind, 'reload-success');
assert.equal(parseProtectionRuntimeLine(fabricLine('Server Protection Fabric started with 13 bounded checks!')), null,
  'near-miss marker text must not be accepted');
assert.equal(parseProtectionRuntimeLine(fabricLine(
  'Server Protection Fabric packet Anti-Xray provider loaded; concealed-ore detection remains available as a secondary signal!'
)), null, 'near-miss packet-provider marker text must not be accepted');

assert.throws(() => beginProtectionRuntimeLifecycle(state, { generation: -1, adapterId: 'bukkit' }), TypeError);
assert.throws(() => beginProtectionRuntimeLifecycle(state, { generation: 1, adapterId: 'forge' }), TypeError);

console.log('Minecraft Server protection runtime handshake tests passed.');
