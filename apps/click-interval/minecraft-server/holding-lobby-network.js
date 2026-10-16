'use strict';

// Separate ownership from the SMP's voice lease: preparing a lobby must never
// replace, unmap, or repair the main server's UDP 24454 mapping/rule.
const NatAPI = require('./vendor/node_modules/nat-api');
const path = require('node:path');
const { ensureInboundUdpRule, defaultPowerShellRunner, parseLastJsonObject, quotePowerShellLiteral } = require('./windows-udp-firewall');

async function existingJavaFirewall(javaPath) {
  if (process.platform !== 'win32' || !javaPath || !path.isAbsolute(javaPath)) return { ok: false };
  const script = [
    "$ErrorActionPreference='Stop'",
    `$program=${quotePowerShellLiteral(path.normalize(javaPath))}`,
    "$profiles=@(Get-NetConnectionProfile | Where-Object { [string]$_.IPv4Connectivity -ne 'Disconnected' } | ForEach-Object { if([string]$_.NetworkCategory -eq 'DomainAuthenticated'){'Domain'}else{[string]$_.NetworkCategory} } | Select-Object -Unique)",
    "$matches=@(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | Where-Object { $_.Program -eq $program } | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | Where-Object {",
    " $rule=$_; $ports=@($rule|Get-NetFirewallPortFilter); $addresses=@($rule|Get-NetFirewallAddressFilter); $interfaces=@($rule|Get-NetFirewallInterfaceTypeFilter); $security=@($rule|Get-NetFirewallSecurityFilter); $services=@($rule|Get-NetFirewallServiceFilter)",
    " $covered=$profiles.Count -gt 0; foreach($profile in $profiles){ if([string]$rule.Profile -ne 'Any' -and ([string]$rule.Profile -split ',\\s*') -notcontains $profile){$covered=$false} }",
    " $covered -and $ports.Count -eq 1 -and [string]$ports[0].Protocol -in @('UDP','17','Any') -and [string]$ports[0].LocalPort -eq 'Any' -and [string]$ports[0].RemotePort -eq 'Any' -and $addresses.Count -eq 1 -and [string]$addresses[0].LocalAddress -eq 'Any' -and [string]$addresses[0].RemoteAddress -eq 'Any' -and $interfaces.Count -eq 1 -and [string]$interfaces[0].InterfaceType -eq 'Any' -and $security.Count -eq 1 -and [string]$security[0].Authentication -eq 'NotRequired' -and $services.Count -eq 1 -and [string]$services[0].Service -eq 'Any'",
    "})",
    "[pscustomobject]@{ok=($matches.Count -gt 0);action='existing-java-rule';changed=$false;profiles=$profiles} | ConvertTo-Json -Compress"
  ].join('\n');
  const result = await defaultPowerShellRunner(script);
  return result.exitCode === 0 ? (parseLastJsonObject(result.stdout) || { ok: false }) : { ok: false };
}

function createHoldingLobbyNetwork({
  createNat = () => new NatAPI({ ttl: 3600, description: 'Click Interval Holding Lobby Voice', autoUpdate: true, enablePMP: true }),
  ensureFirewall = options => ensureInboundUdpRule(options, { autoElevate: false }),
  inspectJavaFirewall = existingJavaFirewall,
  timeoutMs = 8000
} = {}) {
  const owners = new Map();
  function validate(options) {
    const profileId = String(options.profileId || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profileId)) throw new Error('Invalid holding-lobby profile');
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 24454) throw new Error('Invalid or reserved holding-lobby UDP port');
    return { profileId, port };
  }
  async function prepare(options = {}) {
    const { profileId, port } = validate(options);
    if (options.localOnly === true) return { localOnly: true, port, mappingReady: false, firewallReady: false, mapping: { attempted: false, mapped: false }, firewall: { attempted: false }, externalVerified: false };
    const previous = owners.get(port);
    if (previous && previous.profileId !== profileId) throw new Error('Holding-lobby voice port already belongs to another profile');
    const entry = previous || { profileId, nat: createNat(), pending: null };
    owners.set(port, entry);
    if (entry.pending) return entry.pending;
    entry.pending = (async () => {
      const firewallPromise = (async () => {
        const dedicated = await ensureFirewall({ profileId: `${profileId}:holding-lobby`, profileName: `${String(options.profileName || profileId).slice(0,48)} lobby`, port });
        if (dedicated.ok || !options.javaPath) return dedicated;
        const existing = await inspectJavaFirewall(options.javaPath);
        return existing.ok ? { ...existing, port, requiresElevation: false } : dedicated;
      })().catch(error => ({ ok: false, message: String(error.message || error) }));
      const mapping = await new Promise(resolve => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          resolve({ attempted: true, mapped: !error, message: error ? String(error.message || error) : '' });
        };
        const timer = setTimeout(() => finish(new Error('Holding-lobby router mapping timed out')), timeoutMs);
        try { entry.nat.map({ publicPort: port, privatePort: port, protocol: 'UDP', ttl: 3600, description: 'Click Interval Holding Lobby Voice' }, finish); }
        catch (error) { finish(error); }
      });
      for (const field of ['_upnpIntervals', '_pmpIntervals']) for (const timer of Object.values(entry.nat[field] || {})) timer?.unref?.();
      const firewall = await firewallPromise;
      return { localOnly: false, port, mappingReady: mapping.mapped, firewallReady: firewall.ok === true, mapping, firewall, externalVerified: false };
    })();
    try { return await entry.pending; } finally { entry.pending = null; }
  }
  function suspend() {
    // App-update handoff preserves the already-established router leases.
    // NatAPI.destroy() is intentionally not used: it unmaps remembered ports.
    for (const entry of owners.values()) {
      for (const field of ['_upnpIntervals', '_pmpIntervals']) for (const timer of Object.values(entry.nat[field] || {})) clearInterval(timer);
      try { entry.nat._pmpClient?.close(); } catch {}
      try { entry.nat._upnpClient?.destroy(); } catch {}
    }
    owners.clear();
  }
  return { prepare, suspend };
}

const shared = createHoldingLobbyNetwork();
module.exports = { existingJavaFirewall, createHoldingLobbyNetwork, prepareHoldingLobbyVoiceNetwork: shared.prepare, suspendHoldingLobbyVoiceNetwork: shared.suspend };
