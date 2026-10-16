'use strict';

const assert = require('node:assert/strict');
const {
  RULE_GROUP,
  RULE_PREFIX,
  buildCleanupProfileScript,
  buildEnsureInboundUdpRuleScript,
  buildFirewallRuleIdentity,
  cleanupProfileFirewallRules,
  createWindowsUdpFirewallManager,
  ensureInboundUdpRule,
  normalizeUdpPort,
  parseLastJsonObject,
  quotePowerShellLiteral,
  sanitizeDisplayLabel
} = require('./windows-udp-firewall');

async function main() {
  assert.equal(normalizeUdpPort(24_454), 24_454);
  assert.equal(normalizeUdpPort(' 24455 '), 24_455);
  assert.equal(normalizeUdpPort('1e3'), null);
  assert.equal(normalizeUdpPort(0), null);
  assert.equal(normalizeUdpPort(65_536), null);
  assert.equal(quotePowerShellLiteral("server's name"), "'server''s name'");
  assert.equal(sanitizeDisplayLabel(' My <SMP>\n🔥 '), 'My SMP');

  const identity = buildFirewallRuleIdentity('Profile-ABC', "Alex's <SMP>");
  const sameIdentity = buildFirewallRuleIdentity('  profile-abc  ', 'Renamed server');
  const otherIdentity = buildFirewallRuleIdentity('profile-def', 'Other');
  assert.match(identity.ruleName, new RegExp(`^${RULE_PREFIX}-[a-f0-9]{24}$`));
  assert.equal(identity.ruleName, sameIdentity.ruleName, 'profile IDs are canonicalized deterministically');
  assert.notEqual(identity.ruleName, otherIdentity.ruleName);
  assert.equal(identity.displayName, 'Click Interval Voice UDP - Alex s SMP');
  assert.equal(identity.group, RULE_GROUP);
  assert.throws(() => buildFirewallRuleIdentity(''), /profile ID/i);

  const ensureScript = buildEnsureInboundUdpRuleScript({ ...identity, port: 24_454 });
  assert.match(ensureScript, /Import-Module NetSecurity/);
  assert.match(ensureScript, /Get-NetFirewallRule -PolicyStore PersistentStore/);
  assert.match(ensureScript, /-Name \$ruleName -ErrorAction Stop/,
    'rule lookup must use the exact deterministic name instead of enumerating the whole firewall policy');
  assert.doesNotMatch(ensureScript, /Get-NetFirewallRule[^\n]*\| Where-Object/,
    'startup must not scan every Windows Firewall rule');
  assert.doesNotMatch(ensureScript, /Get-NetFirewallRule[^\n]+ErrorAction SilentlyContinue/,
    'permission and policy-store lookup failures must not be mistaken for an absent rule');
  assert.match(ensureScript, /New-NetFirewallRule -PolicyStore PersistentStore/);
  assert.match(ensureScript, /Set-NetFirewallPortFilter -Protocol UDP -LocalPort \$udpPort/);
  assert.match(ensureScript, /Set-NetFirewallRule -PolicyStore PersistentStore -Name \$ruleName -Enabled True/);
  assert.doesNotMatch(ensureScript, /Set-NetFirewallRule[^\n]+-(?:DisplayName|Group)/,
    'mutable rule properties do not misuse selector-only Set-NetFirewallRule parameters');
  assert.match(ensureScript, /Direction Inbound -Action Allow/);
  assert.match(ensureScript, /\$udpPort = 24454/);
  assert.match(ensureScript, /verifiedRules\.Count -ne 1/);
  assert.doesNotMatch(ensureScript, /Profile-ABC|Alex's/,
    'raw profile identifiers and unsafe display strings are never interpolated');
  assert.throws(() => buildEnsureInboundUdpRuleScript({ ...identity, port: 70_000 }), /valid UDP port/);
  assert.throws(() => buildEnsureInboundUdpRuleScript({ ...identity, ruleName: 'bad*name', port: 24_454 }),
    /unsupported characters/);

  const cleanupScript = buildCleanupProfileScript(identity);
  assert.match(cleanupScript, /Remove-NetFirewallRule/);
  assert.match(cleanupScript, /remaining\.Count -ne 0/);

  let nonWindowsCalls = 0;
  const nonWindows = createWindowsUdpFirewallManager({
    platform: 'linux',
    runPowerShell: async () => {
      nonWindowsCalls += 1;
      throw new Error('must not execute');
    }
  });
  assert.deepEqual(await nonWindows.ensureInboundUdpRule({ profileId: 'one', port: 24_454 }), {
    ok: false,
    supported: false,
    changed: false,
    action: 'unsupported',
    code: 'unsupported-platform',
    message: 'Windows Firewall rules are only managed on Windows.',
    requiresElevation: false,
    profileHash: buildFirewallRuleIdentity('one').profileHash,
    ruleName: buildFirewallRuleIdentity('one').ruleName,
    displayName: buildFirewallRuleIdentity('one').displayName,
    protocol: 'UDP',
    port: 24_454
  });
  assert.equal(nonWindowsCalls, 0);

  const calls = [];
  let ensureCount = 0;
  const manager = createWindowsUdpFirewallManager({
    platform: 'win32',
    runPowerShell: async (script, options) => {
      calls.push({ script, options });
      if (options.operation === 'cleanup') {
        return { exitCode: 0, stdout: JSON.stringify({ ok: true, action: 'removed', removedCount: 1 }) };
      }
      ensureCount += 1;
      return {
        exitCode: 0,
        stdout: `PowerShell informational output\n${JSON.stringify({
          ok: true,
          action: ensureCount === 1 ? 'created' : 'unchanged',
          port: 24_460
        })}`
      };
    }
  });
  const created = await manager.ensureInboundUdpRule({ profileId: 'server-one', profileName: 'SMP', port: 24_460 });
  assert.equal(created.ok, true);
  assert.equal(created.supported, true);
  assert.equal(created.changed, true);
  assert.equal(created.action, 'created');
  assert.equal(created.port, 24_460);
  assert.equal(created.protocol, 'UDP');
  const unchanged = await manager.ensureInboundUdpRule({ profileId: 'server-one', profileName: 'SMP', port: 24_460 });
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.action, 'unchanged');
  assert.equal(created.ruleName, unchanged.ruleName);
  assert.equal(calls[0].options.operation, 'ensure');
  assert.equal(calls[0].options.ruleName, created.ruleName);

  const removed = await manager.cleanupProfile({ profileId: 'server-one', profileName: 'SMP' });
  assert.equal(removed.ok, true);
  assert.equal(removed.changed, true);
  assert.equal(removed.action, 'removed');
  assert.equal(removed.port, null);
  assert.equal(calls.at(-1).options.operation, 'cleanup');

  const invalidCalls = [];
  const invalidManager = createWindowsUdpFirewallManager({
    platform: 'win32',
    runPowerShell: async (...args) => invalidCalls.push(args)
  });
  const invalidPort = await invalidManager.ensureInboundUdpRule({ profileId: 'server-one', port: -1 });
  assert.equal(invalidPort.ok, false);
  assert.equal(invalidPort.code, 'invalid-input');
  const invalidProfile = await invalidManager.cleanupProfile({ profileId: '' });
  assert.equal(invalidProfile.code, 'invalid-input');
  assert.equal(invalidCalls.length, 0);

  const permissionManager = createWindowsUdpFirewallManager({
    platform: 'win32',
    autoElevate: false,
    runPowerShell: async () => {
      const error = new Error('Access is denied. Run as administrator.');
      error.code = 'EPERM';
      throw error;
    }
  });
  const denied = await permissionManager.ensureInboundUdpRule({ profileId: 'denied', port: 24_461 });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'permission-denied');
  assert.equal(denied.requiresElevation, true);
  assert.match(denied.message, /Access is denied/);

  const deniedJson = createWindowsUdpFirewallManager({
    platform: 'win32',
    autoElevate: false,
    runPowerShell: async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ ok: false, message: 'Requested operation requires elevation.' })
    })
  });
  const deniedCleanup = await deniedJson.cleanupProfile({ profileId: 'denied' });
  assert.equal(deniedCleanup.code, 'permission-denied');
  assert.equal(deniedCleanup.requiresElevation, true);

  const localizedDenied = createWindowsUdpFirewallManager({
    platform: 'win32',
    autoElevate: false,
    runPowerShell: async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        ok: false,
        message: 'Die Anforderung konnte nicht ausgeführt werden.',
        category: 'PermissionDenied',
        fullyQualifiedErrorId: 'Windows System Error 5'
      })
    })
  });
  assert.equal((await localizedDenied.cleanupProfile({ profileId: 'denied' })).code, 'permission-denied');

  let elevatedCalls = 0;
  const elevationManager = createWindowsUdpFirewallManager({
    platform: 'win32',
    runPowerShell: async () => {
      const error = new Error('Access is denied.');
      error.code = 'EPERM';
      throw error;
    },
    runElevatedPowerShell: async (_script, options) => {
      elevatedCalls += 1;
      assert.equal(options.operation, 'ensure-elevated');
      return { exitCode: 0, stdout: '', stderr: '' };
    }
  });
  const elevated = await elevationManager.ensureInboundUdpRule({ profileId: 'elevated', port: 24_461 });
  assert.equal(elevated.ok, true);
  assert.equal(elevated.action, 'elevated');
  assert.equal(elevated.requiresElevation, false);
  assert.equal(elevatedCalls, 1);

  let elevatedCleanupCalls = 0;
  const cleanupElevationManager = createWindowsUdpFirewallManager({
    platform: 'win32',
    runPowerShell: async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ ok: false, category: 'PermissionDenied', fullyQualifiedErrorId: 'AccessDenied' })
    }),
    runElevatedPowerShell: async (_script, options) => {
      elevatedCleanupCalls += 1;
      assert.equal(options.operation, 'cleanup-elevated');
      return { exitCode: 0, stdout: '', stderr: '' };
    }
  });
  const elevatedCleanup = await cleanupElevationManager.cleanupProfile({ profileId: 'elevated-cleanup' });
  assert.equal(elevatedCleanup.ok, true);
  assert.equal(elevatedCleanup.action, 'elevated');
  assert.equal(elevatedCleanupCalls, 1);

  const missingPowerShell = createWindowsUdpFirewallManager({
    platform: 'win32',
    autoElevate: false,
    runPowerShell: async () => {
      const error = new Error('spawn powershell.exe ENOENT');
      error.code = 'ENOENT';
      throw error;
    }
  });
  assert.equal((await missingPowerShell.cleanupProfile({ profileId: 'one' })).code, 'powershell-unavailable');

  const malformed = createWindowsUdpFirewallManager({
    platform: 'win32',
    runPowerShell: async () => ({ exitCode: 0, stdout: 'not JSON', stderr: '' })
  });
  const malformedResult = await malformed.ensureInboundUdpRule({ profileId: 'one', port: 24_462 });
  assert.equal(malformedResult.ok, false);
  assert.equal(malformedResult.code, 'command-failed');

  assert.deepEqual(parseLastJsonObject('warning\n{"ok":true,"action":"updated"}'), {
    ok: true,
    action: 'updated'
  });
  assert.equal(parseLastJsonObject('not-json'), null);

  const directEnsure = await ensureInboundUdpRule(
    { profileId: 'direct', port: 24_463 },
    { platform: 'win32', runPowerShell: async () => JSON.stringify({ ok: true, action: 'updated', port: 24_463 }) }
  );
  assert.equal(directEnsure.ok, true);
  assert.equal(directEnsure.action, 'updated');
  const directCleanup = await cleanupProfileFirewallRules(
    { profileId: 'direct' },
    { platform: 'win32', runPowerShell: async () => JSON.stringify({ ok: true, action: 'absent' }) }
  );
  assert.equal(directCleanup.ok, true);
  assert.equal(directCleanup.changed, false);

  console.log('PASS Windows UDP firewall helper tests');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
