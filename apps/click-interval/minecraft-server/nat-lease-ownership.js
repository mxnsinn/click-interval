'use strict';

const LEASE_FIELDS = Object.freeze({
  tcp: Object.freeze({ mapped: 'mapped', owner: 'tcpProfileId', port: 'tcpPort' }),
  voice: Object.freeze({ mapped: 'voiceMapped', owner: 'voiceProfileId', port: 'voicePort' })
});

function normalizeProfileId(profileId) {
  return String(profileId || '').trim();
}

function fieldsFor(kind) {
  const fields = LEASE_FIELDS[kind];
  if (!fields) throw new Error(`Unknown NAT lease kind: ${kind}`);
  return fields;
}

function createDirectHostingState(profileId = '') {
  return {
    profileId: normalizeProfileId(profileId),
    mapped: false,
    tcpProfileId: '',
    tcpPort: 0,
    publicIp: '',
    publicAddress: '',
    voiceProfileId: '',
    voicePort: 0,
    voiceMapped: false,
    voiceMappingError: '',
    message: ''
  };
}

function getNatLease(state, kind) {
  const fields = fieldsFor(kind);
  const profileId = normalizeProfileId(state?.[fields.owner]);
  const port = Number(state?.[fields.port]) || 0;
  if (!state?.[fields.mapped] || !profileId || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { kind, profileId, port };
}

function getOwnedNatLease(state, kind, profileId) {
  const owner = normalizeProfileId(profileId);
  const lease = getNatLease(state, kind);
  return owner && lease?.profileId === owner ? lease : null;
}

function claimNatLease(state, kind, profileId, port) {
  const fields = fieldsFor(kind);
  const owner = normalizeProfileId(profileId);
  const normalizedPort = Number(port) || 0;
  if (!owner) throw new Error('A NAT lease must have a server profile owner.');
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw new Error('A NAT lease must have a valid port.');
  }
  const current = getNatLease(state, kind);
  if (current && current.profileId !== owner) {
    throw new Error(`The ${kind} NAT lease is still owned by another server profile.`);
  }
  state.profileId = owner;
  state[fields.mapped] = true;
  state[fields.owner] = owner;
  state[fields.port] = normalizedPort;
  return state;
}

function clearOwnedNatLease(state, kind, profileId) {
  const fields = fieldsFor(kind);
  const owner = normalizeProfileId(profileId);
  if (!owner || normalizeProfileId(state?.[fields.owner]) !== owner) return false;
  state[fields.mapped] = false;
  state[fields.owner] = '';
  state[fields.port] = 0;
  return true;
}

function getNatLeaseOwners(state) {
  return [...new Set(['tcp', 'voice']
    .map(kind => getNatLease(state, kind)?.profileId || '')
    .filter(Boolean))];
}

function scopeDirectHostingState(state, profileId) {
  const owner = normalizeProfileId(profileId);
  const next = createDirectHostingState(owner);
  if (normalizeProfileId(state?.profileId) === owner) {
    next.publicIp = String(state.publicIp || '');
    next.publicAddress = String(state.publicAddress || '');
    next.voiceMappingError = String(state.voiceMappingError || '');
    next.message = String(state.message || '');
  }
  for (const kind of ['tcp', 'voice']) {
    const lease = getOwnedNatLease(state, kind, owner);
    if (lease) claimNatLease(next, kind, owner, lease.port);
  }
  return next;
}

module.exports = {
  createDirectHostingState,
  getNatLease,
  getOwnedNatLease,
  claimNatLease,
  clearOwnedNatLease,
  getNatLeaseOwners,
  scopeDirectHostingState
};
