'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  assertSeamlessRestartBackendExited,
  assertSeamlessRestartTarget,
  buildMaintenanceCommand,
  evaluateSeamlessRestartPreparationMemory,
  isMaintenanceArmedAcknowledgement,
  isMaintenanceReadyAcknowledgement,
  isOperationRejection,
  isSeamlessRestartReadinessSource,
  normalizeSeamlessRestartMessage,
  parseSeamlessProxyProtocolLine,
  seamlessSidecarMemoryReserveMb
} = require('./seamless-restart-runtime');

const armed = parseSeamlessProxyProtocolLine(
  '[00:00:00 INFO]: CI_RESTART_ACK op=maintenance_on result=armed state=ARMED generation=4 managed=2 pending=0 main_inflight=0'
);
assert.equal(isMaintenanceArmedAcknowledgement(armed), true);
assert.equal(armed.fields.managed, '2');
assert.equal(isMaintenanceArmedAcknowledgement(parseSeamlessProxyProtocolLine(
  'CI_RESTART_ACK op=maintenance_on result=armed state=ARMED generation=4 managed=2 pending=0 main_inflight=1'
)), false);

const ready = parseSeamlessProxyProtocolLine(
  '\u001b[32mCI_RESTART_ACK op=ready_complete result=active state=ACTIVE generation=4 managed=0\u001b[0m'
);
assert.equal(isMaintenanceReadyAcknowledgement(ready), true);

const rejection = parseSeamlessProxyProtocolLine(
  'CI_RESTART_NACK op=maintenance_on result=maintenance_unreachable state=ACTIVE generation=4 managed=0'
);
assert.equal(isOperationRejection(rejection, 'maintenance_on'), true);
assert.equal(isMaintenanceArmedAcknowledgement(rejection), false);
assert.equal(parseSeamlessProxyProtocolLine('ordinary Velocity output'), null);

assert.equal(normalizeSeamlessRestartMessage('  Updating\n now  '), 'Updating now');
assert.equal(buildMaintenanceCommand('on', 'Updating now'), 'cirestart maintenance on Updating now');
assert.equal(buildMaintenanceCommand('off'), 'cirestart maintenance off');
assert.throws(() => normalizeSeamlessRestartMessage('x'.repeat(241)), /240 characters/);
assert.throws(() => buildMaintenanceCommand('delete'), /on, off, or status/);

assert.equal(seamlessSidecarMemoryReserveMb({ enabled: false }), 0);
assert.equal(seamlessSidecarMemoryReserveMb({ enabled: true }), 768);
assert.equal(seamlessSidecarMemoryReserveMb({ enabled: true, velocityRunning: true }), 256);
assert.equal(seamlessSidecarMemoryReserveMb({ enabled: true, limboRunning: true }), 512);
assert.equal(seamlessSidecarMemoryReserveMb({ enabled: true, velocityRunning: true, limboRunning: true }), 0,
  'already-resident proxy/lobby RAM must not be charged twice');
assert.equal(seamlessSidecarMemoryReserveMb({ enabled: true, lobbyMemoryMb: 1024 }), 1536);
assert.equal(seamlessSidecarMemoryReserveMb({ enabled: true, velocityRunning: true, lobbyMemoryMb: 1024 }), 1024);
assert.equal(seamlessSidecarMemoryReserveMb({ enabled: true, velocityRunning: true, limboRunning: true, lobbyMemoryMb: 1024 }), 0);
assert.equal(seamlessSidecarMemoryReserveMb({ enabled: true, lobbyMemoryMb: 10240 }), 768,
  'unbounded lobby memory input must not be accepted');
const playingMemory = { totalMemoryMb: 32768, freeMemoryMb: 1500, requiredBackendMemoryMb: 8192,
  velocityRunning: true, limboRunning: true };
assert.equal(evaluateSeamlessRestartPreparationMemory(playingMemory).allowed, true,
  'do not require a second backend heap while the original server is running');
assert.equal(evaluateSeamlessRestartPreparationMemory({ ...playingMemory, freeMemoryMb: 100 }).allowed, false);
assert.equal(evaluateSeamlessRestartPreparationMemory({ ...playingMemory, totalMemoryMb: 4096 }).allowed, false);
assert.equal(evaluateSeamlessRestartPreparationMemory({ ...playingMemory, freeMemoryMb: NaN }).code, 'MEMORY_UNVERIFIED');
assert.equal(evaluateSeamlessRestartPreparationMemory({ ...playingMemory, freeMemoryMb: 999999 }).allowed, false);
assert.equal(evaluateSeamlessRestartPreparationMemory({ ...playingMemory, freeMemoryMb: 100, configuredOldHeapMb: 100000 }).allowed, false,
  'a configured Xmx cannot invent reclaimable free RAM');
const target = { profileId: 'SMP', root: path.resolve(__dirname, 'test-world-parent'), worldName: 'world' };
assert.doesNotThrow(() => assertSeamlessRestartTarget(target, { ...target }));
for (const actual of [{ ...target, worldName: 'different' }, { ...target, profileId: 'Other' },
  { ...target, root: path.resolve(target.root, 'another') }, null]) {
  assert.throws(() => assertSeamlessRestartTarget(target, actual), /profile or world changed/);
}
const stopped = { previousPid: 1234, previousExited: true, previousPidAlive: false, currentBackendPresent: false };
assert.doesNotThrow(() => assertSeamlessRestartBackendExited(stopped));
for (const changed of [{ previousPid: 0 }, { previousExited: false }, { previousPidAlive: true },
  { currentBackendPresent: true }, { previousPidAlive: undefined }]) {
  assert.throws(() => assertSeamlessRestartBackendExited({ ...stopped, ...changed }), /second world server/);
}
assert.equal(isSeamlessRestartReadinessSource('socket', true), false);
assert.equal(isSeamlessRestartReadinessSource('marker', true), true);
assert.equal(isSeamlessRestartReadinessSource('socket', false), true);

console.log('PASS seamless restart runtime protocol, memory, world identity and readiness tests');
