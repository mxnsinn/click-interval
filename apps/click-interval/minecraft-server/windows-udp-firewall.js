'use strict';

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const RULE_PREFIX = 'ClickInterval-Minecraft-Voice-UDP';
const RULE_GROUP = 'Click Interval Minecraft Servers';
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

function normalizeUdpPort(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT ? value : null;
  }
  if (typeof value === 'string' && /^\s*\d{1,5}\s*$/.test(value)) {
    const port = Number(value.trim());
    return port >= MIN_PORT && port <= MAX_PORT ? port : null;
  }
  return null;
}

function normalizeProfileId(profileId) {
  return String(profileId ?? '').normalize('NFKC').trim().toLowerCase();
}

function sanitizeDisplayLabel(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[^a-z0-9 ._-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

function buildFirewallRuleIdentity(profileId, profileName = '') {
  const canonicalProfileId = normalizeProfileId(profileId);
  if (!canonicalProfileId) throw new TypeError('A non-empty server profile ID is required.');
  const profileHash = crypto.createHash('sha256').update(canonicalProfileId, 'utf8').digest('hex').slice(0, 24);
  const ruleName = `${RULE_PREFIX}-${profileHash}`;
  const label = sanitizeDisplayLabel(profileName) || `server ${profileHash.slice(0, 8)}`;
  return {
    canonicalProfileId,
    profileHash,
    ruleName,
    displayName: `Click Interval Voice UDP - ${label}`,
    group: RULE_GROUP
  };
}

function quotePowerShellLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function buildEnsureInboundUdpRuleScript({ ruleName, displayName, group = RULE_GROUP, port }) {
  const udpPort = normalizeUdpPort(port);
  if (udpPort === null) throw new RangeError('A valid UDP port from 1 through 65535 is required.');
  if (!/^[A-Za-z0-9-]{1,128}$/.test(String(ruleName || ''))) {
    throw new TypeError('Firewall rule name contains unsupported characters.');
  }

  const ruleLiteral = quotePowerShellLiteral(ruleName);
  const displayLiteral = quotePowerShellLiteral(displayName);
  const groupLiteral = quotePowerShellLiteral(group);
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  Import-Module NetSecurity -ErrorAction Stop',
    `  $ruleName = ${ruleLiteral}`,
    `  $displayName = ${displayLiteral}`,
    `  $ruleGroup = ${groupLiteral}`,
    `  $udpPort = ${udpPort}`,
    '  function Get-VoiceUdpRules {',
    '    try { return @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction Stop) }',
    '    catch {',
    "      $notFound = $_.CategoryInfo.Category -eq 'ObjectNotFound' -or [string]$_.FullyQualifiedErrorId -match 'NoMatching|ObjectNotFound' -or [string]$_.Exception.Message -match 'No MSFT_NetFirewallRule objects found'",
    '      if ($notFound) { return @() }',
    '      throw',
    '    }',
    '  }',
    '  function Test-VoiceUdpRule([object]$candidate) {',
    '    if ($null -eq $candidate) { return $false }',
    "    if ([string]$candidate.Enabled -ne 'True' -or [string]$candidate.Direction -ne 'Inbound' -or [string]$candidate.Action -ne 'Allow' -or [string]$candidate.Profile -ne 'Any') { return $false }",
    '    $filters = @($candidate | Get-NetFirewallPortFilter -ErrorAction Stop)',
    '    if ($filters.Count -ne 1) { return $false }',
    '    $filter = $filters[0]',
    "    $protocol = [string]$filter.Protocol",
    "    return (($protocol -eq 'UDP' -or $protocol -eq '17') -and [string]$filter.LocalPort -eq [string]$udpPort -and [string]$filter.RemotePort -eq 'Any')",
    '  }',
    '  $rules = @(Get-VoiceUdpRules)',
    "  $action = 'unchanged'",
    '  if ($rules.Count -eq 0) {',
    '    New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName $displayName -Group $ruleGroup -Enabled True -Direction Inbound -Action Allow -Profile Any -Protocol UDP -LocalPort $udpPort -RemotePort Any -ErrorAction Stop | Out-Null',
    "    $action = 'created'",
    '  } elseif ($rules.Count -ne 1) {',
    '    $rules | Remove-NetFirewallRule -ErrorAction Stop',
    '    New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName $displayName -Group $ruleGroup -Enabled True -Direction Inbound -Action Allow -Profile Any -Protocol UDP -LocalPort $udpPort -RemotePort Any -ErrorAction Stop | Out-Null',
    "    $action = 'repaired'",
    '  } else {',
    '    $rule = $rules[0]',
    '    $filters = @($rule | Get-NetFirewallPortFilter -ErrorAction Stop)',
    '    if ($filters.Count -ne 1 -or [string]$rule.DisplayName -ne $displayName -or [string]$rule.Group -ne $ruleGroup) {',
    '      $rule | Remove-NetFirewallRule -ErrorAction Stop',
    '      New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName $displayName -Group $ruleGroup -Enabled True -Direction Inbound -Action Allow -Profile Any -Protocol UDP -LocalPort $udpPort -RemotePort Any -ErrorAction Stop | Out-Null',
    "      $action = 'repaired'",
    '    } elseif (-not (Test-VoiceUdpRule $rule)) {',
    '      Set-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Any -ErrorAction Stop | Out-Null',
    '      $filters | Set-NetFirewallPortFilter -Protocol UDP -LocalPort $udpPort -RemotePort Any -ErrorAction Stop | Out-Null',
    "      $action = 'updated'",
    '    }',
    '  }',
    '  $verifiedRules = @(Get-VoiceUdpRules)',
    "  if ($verifiedRules.Count -ne 1 -or -not (Test-VoiceUdpRule $verifiedRules[0])) { throw 'Firewall rule verification failed after applying it.' }",
    "  [pscustomobject]@{ok=$true;action=$action;ruleName=$ruleName;displayName=$displayName;port=$udpPort;protocol='UDP'} | ConvertTo-Json -Compress",
    '} catch {',
    "  [pscustomobject]@{ok=$false;action='failed';message=[string]$_.Exception.Message;category=[string]$_.CategoryInfo.Category;fullyQualifiedErrorId=[string]$_.FullyQualifiedErrorId} | ConvertTo-Json -Compress",
    '  exit 1',
    '}'
  ].join('\n');
}

function buildCleanupProfileScript({ ruleName }) {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(String(ruleName || ''))) {
    throw new TypeError('Firewall rule name contains unsupported characters.');
  }
  const ruleLiteral = quotePowerShellLiteral(ruleName);
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  Import-Module NetSecurity -ErrorAction Stop',
    `  $ruleName = ${ruleLiteral}`,
    '  function Get-VoiceUdpRules {',
    '    try { return @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction Stop) }',
    '    catch {',
    "      $notFound = $_.CategoryInfo.Category -eq 'ObjectNotFound' -or [string]$_.FullyQualifiedErrorId -match 'NoMatching|ObjectNotFound' -or [string]$_.Exception.Message -match 'No MSFT_NetFirewallRule objects found'",
    '      if ($notFound) { return @() }',
    '      throw',
    '    }',
    '  }',
    '  $rules = @(Get-VoiceUdpRules)',
    "  $action = 'absent'",
    '  if ($rules.Count -gt 0) {',
    '    $rules | Remove-NetFirewallRule -ErrorAction Stop',
    "    $action = 'removed'",
    '  }',
    '  $remaining = @(Get-VoiceUdpRules)',
    "  if ($remaining.Count -ne 0) { throw 'Firewall rule verification failed after removing it.' }",
    '  [pscustomobject]@{ok=$true;action=$action;ruleName=$ruleName;removedCount=$rules.Count} | ConvertTo-Json -Compress',
    '} catch {',
    "  [pscustomobject]@{ok=$false;action='failed';message=[string]$_.Exception.Message;category=[string]$_.CategoryInfo.Category;fullyQualifiedErrorId=[string]$_.FullyQualifiedErrorId} | ConvertTo-Json -Compress",
    '  exit 1',
    '}'
  ].join('\n');
}

function defaultPowerShellRunner(script, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 256 * 1024 },
      (error, stdout, stderr) => resolve({
        exitCode: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error
      })
    );
  });
}

function defaultElevatedPowerShellRunner(script, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const encodedCommand = Buffer.from(String(script || ''), 'utf16le').toString('base64');
  const launcher = [
    "$ErrorActionPreference = 'Stop'",
    `try { $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}'); exit $process.ExitCode }`,
    "catch { [Console]::Error.WriteLine([string]$_.Exception.Message); exit 1 }"
  ].join('\n');
  return defaultPowerShellRunner(launcher, { timeoutMs: Math.max(timeoutMs, 60_000) });
}

function normalizeRunnerResponse(response) {
  if (typeof response === 'string') return { exitCode: 0, stdout: response, stderr: '', error: null };
  const error = response?.error || null;
  let exitCode = Number(response?.exitCode);
  if (!Number.isInteger(exitCode)) {
    exitCode = Number.isInteger(response?.code) ? response.code : (error ? 1 : 0);
  }
  return {
    exitCode,
    stdout: String(response?.stdout || ''),
    stderr: String(response?.stderr || ''),
    error
  };
}

function parseLastJsonObject(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {}
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function cleanFailureMessage(value) {
  return String(value || '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function classifyFailure({ message, error, stderr = '' }) {
  const detail = cleanFailureMessage(message || stderr || error?.message || error || 'Windows Firewall command failed.');
  const combined = `${detail} ${error?.code || ''}`;
  if (/access (?:is )?denied|unauthori[sz]ed|administrator|elevat(?:e|ion)|permission|privilege|not permitted|0x80070005/i.test(combined)) {
    return { code: 'permission-denied', requiresElevation: true, message: detail || 'Administrator permission is required to change Windows Firewall.' };
  }
  if (/ENOENT|not recognized as the name of a cmdlet|cannot find.*powershell/i.test(combined)) {
    return { code: 'powershell-unavailable', requiresElevation: false, message: detail || 'Windows PowerShell is unavailable.' };
  }
  if (/NetSecurity|Get-NetFirewallRule|New-NetFirewallRule|Set-NetFirewallRule/i.test(combined) &&
      /module|not recognized|could not be loaded|was not found/i.test(combined)) {
    return { code: 'netsecurity-unavailable', requiresElevation: false, message: detail };
  }
  return { code: 'command-failed', requiresElevation: false, message: detail || 'Windows Firewall command failed.' };
}

function baseResult(identity, platform, port = null) {
  return {
    ok: false,
    supported: platform === 'win32',
    changed: false,
    action: 'failed',
    code: '',
    message: '',
    requiresElevation: false,
    profileHash: identity?.profileHash || '',
    ruleName: identity?.ruleName || '',
    displayName: identity?.displayName || '',
    protocol: 'UDP',
    port
  };
}

async function invokeFirewallCommand({ script, runPowerShell, operation, identity, platform, port }) {
  const initial = baseResult(identity, platform, port);
  let response;
  try {
    response = normalizeRunnerResponse(await runPowerShell(script, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      operation,
      ruleName: identity.ruleName
    }));
  } catch (error) {
    const failure = classifyFailure({ error });
    return { ...initial, ...failure };
  }

  const parsed = parseLastJsonObject(response.stdout);
  if (response.exitCode === 0 && parsed?.ok === true) {
    const action = String(parsed.action || (operation === 'cleanup' ? 'absent' : 'unchanged'));
    return {
      ...initial,
      ok: true,
      changed: !['unchanged', 'absent'].includes(action),
      action,
      code: '',
      message: '',
      requiresElevation: false,
      port: normalizeUdpPort(parsed.port) ?? port
    };
  }

  const failure = classifyFailure({
    message: [parsed?.message, parsed?.category, parsed?.fullyQualifiedErrorId].filter(Boolean).join(' '),
    error: response.error,
    stderr: response.stderr || response.stdout
  });
  return { ...initial, ...failure };
}

function createWindowsUdpFirewallManager({
  platform = process.platform,
  runPowerShell = defaultPowerShellRunner,
  runElevatedPowerShell = defaultElevatedPowerShellRunner,
  autoElevate = true
} = {}) {
  const normalizedPlatform = String(platform || '');

  async function ensureInboundUdpRule({ profileId, profileName = '', port } = {}) {
    const udpPort = normalizeUdpPort(port);
    let identity;
    try {
      identity = buildFirewallRuleIdentity(profileId, profileName);
    } catch (error) {
      return {
        ...baseResult(null, normalizedPlatform, udpPort),
        code: 'invalid-input',
        message: cleanFailureMessage(error.message)
      };
    }
    const initial = baseResult(identity, normalizedPlatform, udpPort);
    if (udpPort === null) {
      return { ...initial, code: 'invalid-input', message: 'A valid UDP port from 1 through 65535 is required.' };
    }
    if (normalizedPlatform !== 'win32') {
      return {
        ...initial,
        action: 'unsupported',
        code: 'unsupported-platform',
        message: 'Windows Firewall rules are only managed on Windows.'
      };
    }
    if (typeof runPowerShell !== 'function') {
      return { ...initial, code: 'runner-unavailable', message: 'No PowerShell command runner is available.' };
    }
    const script = buildEnsureInboundUdpRuleScript({ ...identity, port: udpPort });
    let result = await invokeFirewallCommand({
      script,
      runPowerShell,
      operation: 'ensure',
      identity,
      platform: normalizedPlatform,
      port: udpPort
    });
    if (result.ok || result.code !== 'permission-denied' || autoElevate !== true || typeof runElevatedPowerShell !== 'function') {
      return result;
    }
    let elevated;
    try {
      elevated = normalizeRunnerResponse(await runElevatedPowerShell(script, {
        timeoutMs: 60_000,
        operation: 'ensure-elevated',
        ruleName: identity.ruleName
      }));
    } catch (error) {
      const failure = classifyFailure({ error });
      return { ...result, ...failure };
    }
    if (elevated.exitCode !== 0 || elevated.error) {
      const failure = classifyFailure({ error: elevated.error, stderr: elevated.stderr || elevated.stdout });
      return { ...result, ...failure };
    }
    return {
      ...initial,
      ok: true,
      changed: true,
      action: 'elevated',
      code: '',
      message: '',
      requiresElevation: false
    };
  }

  async function cleanupProfile({ profileId, profileName = '' } = {}) {
    let identity;
    try {
      identity = buildFirewallRuleIdentity(profileId, profileName);
    } catch (error) {
      return {
        ...baseResult(null, normalizedPlatform),
        code: 'invalid-input',
        message: cleanFailureMessage(error.message)
      };
    }
    const initial = baseResult(identity, normalizedPlatform);
    if (normalizedPlatform !== 'win32') {
      return {
        ...initial,
        action: 'unsupported',
        code: 'unsupported-platform',
        message: 'Windows Firewall rules are only managed on Windows.'
      };
    }
    if (typeof runPowerShell !== 'function') {
      return { ...initial, code: 'runner-unavailable', message: 'No PowerShell command runner is available.' };
    }
    const script = buildCleanupProfileScript(identity);
    let result = await invokeFirewallCommand({
      script,
      runPowerShell,
      operation: 'cleanup',
      identity,
      platform: normalizedPlatform,
      port: null
    });
    if (result.ok || result.code !== 'permission-denied' || autoElevate !== true || typeof runElevatedPowerShell !== 'function') {
      return result;
    }
    let elevated;
    try {
      elevated = normalizeRunnerResponse(await runElevatedPowerShell(script, {
        timeoutMs: 60_000,
        operation: 'cleanup-elevated',
        ruleName: identity.ruleName
      }));
    } catch (error) {
      const failure = classifyFailure({ error });
      return { ...result, ...failure };
    }
    if (elevated.exitCode !== 0 || elevated.error) {
      const failure = classifyFailure({ error: elevated.error, stderr: elevated.stderr || elevated.stdout });
      return { ...result, ...failure };
    }
    return {
      ...initial,
      ok: true,
      changed: true,
      action: 'elevated',
      code: '',
      message: '',
      requiresElevation: false
    };
  }

  return { ensureInboundUdpRule, cleanupProfile };
}

async function ensureInboundUdpRule(options = {}, dependencies = {}) {
  return createWindowsUdpFirewallManager(dependencies).ensureInboundUdpRule(options);
}

async function cleanupProfileFirewallRules(options = {}, dependencies = {}) {
  return createWindowsUdpFirewallManager(dependencies).cleanupProfile(options);
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  RULE_GROUP,
  RULE_PREFIX,
  buildCleanupProfileScript,
  buildEnsureInboundUdpRuleScript,
  buildFirewallRuleIdentity,
  cleanupProfileFirewallRules,
  createWindowsUdpFirewallManager,
  defaultElevatedPowerShellRunner,
  defaultPowerShellRunner,
  ensureInboundUdpRule,
  normalizeUdpPort,
  parseLastJsonObject,
  quotePowerShellLiteral,
  sanitizeDisplayLabel
};
