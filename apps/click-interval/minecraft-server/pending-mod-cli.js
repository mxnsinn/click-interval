#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  applyPendingModQueue,
  createBoundedWorldBackup,
  exportClientModBundle,
  formatPendingModStatus,
  friendlyPendingModError,
  getPendingModQueueStatus,
  queuePendingMods,
  recoverPendingModTransaction,
  rollbackPendingModApplication
} = require('./pending-mod-queue');

const DEFAULT_MANIFEST = path.join(__dirname, 'manifests', 'fabric-26.2-smp-mods.json');

function parseArguments(values) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const equal = value.indexOf('=');
    if (equal >= 0) {
      flags.set(value.slice(2, equal), value.slice(equal + 1));
      continue;
    }
    const name = value.slice(2);
    if (values[index + 1] && !values[index + 1].startsWith('--')) {
      flags.set(name, values[index + 1]);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positional, flags };
}

function selectedOptionalKeys(flags) {
  const value = flags.get('optional') || '';
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function selectedClientBundleKeys(flags) {
  const value = flags.get('client-bundles') || '';
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function numericFlag(flags, name) {
  if (!flags.has(name)) return undefined;
  const result = Number(flags.get(name));
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`--${name} must be a positive integer.`);
  return result;
}

function usage() {
  return [
    'Pending Fabric mod queue (does not start or stop Minecraft)',
    '',
    'Usage:',
    '  node minecraft-server/pending-mod-cli.js status   --profile-root <absolute path>',
    '  node minecraft-server/pending-mod-cli.js download --profile-root <absolute path> [--include-optional-server] [--include-client | --client-bundles litematica,fresh-animations]',
    '  node minecraft-server/pending-mod-cli.js export-client --profile-root <absolute path> [--include-client | --client-bundles litematica,fresh-animations] [--destination <absolute path>]',
    '  node minecraft-server/pending-mod-cli.js apply    --profile-root <absolute path> --confirm-server-stopped [--optional chunky,squaremap]',
    '  node minecraft-server/pending-mod-cli.js recover  --profile-root <absolute path> --confirm-server-stopped',
    '  node minecraft-server/pending-mod-cli.js rollback --profile-root <absolute path> --confirm-server-stopped --confirm-world-unchanged',
    '',
    `Default manifest: ${DEFAULT_MANIFEST}`,
    'Optional client bundles remain in pending-mods and are never applied to the server; optional server mods require --optional when applying.'
  ].join('\n');
}

async function main() {
  const { positional, flags } = parseArguments(process.argv.slice(2));
  const command = String(positional[0] || '').toLowerCase();
  if (!command || flags.has('help') || command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const profileRoot = flags.get('profile-root');
  if (!profileRoot) throw new Error('--profile-root is required and must be an absolute path.');
  const manifestPath = path.resolve(String(flags.get('manifest') || DEFAULT_MANIFEST));
  const serverStopped = flags.get('confirm-server-stopped') === true;
  const optionalServerKeys = selectedOptionalKeys(flags);
  const clientBundleKeys = selectedClientBundleKeys(flags);
  const commonSelection = {
    includeClientOptional: flags.get('include-client') === true,
    includeOptionalServer: flags.get('include-optional-server') === true,
    optionalServerKeys,
    clientBundleKeys
  };
  let result;
  if (command === 'status') {
    result = await getPendingModQueueStatus({ profileRoot, manifestPath, ...commonSelection });
  } else if (command === 'download') {
    result = await queuePendingMods({ profileRoot, manifestPath, ...commonSelection });
  } else if (command === 'apply') {
    result = await applyPendingModQueue({
      profileRoot,
      manifestPath,
      serverStopped,
      optionalServerKeys,
      worldBackupLimits: {
        maxBytes: numericFlag(flags, 'world-backup-max-bytes'),
        maxEntries: numericFlag(flags, 'world-backup-max-entries'),
        diskReserveBytes: numericFlag(flags, 'world-backup-reserve-bytes')
      }
    });
  } else if (command === 'export-client') {
    result = await exportClientModBundle({
      profileRoot,
      manifestPath,
      destinationDirectory: flags.get('destination'),
      includeClientOptional: flags.get('include-client') === true,
      clientBundleKeys
    });
  } else if (command === 'recover') {
    result = await recoverPendingModTransaction({ profileRoot, serverStopped });
  } else if (command === 'rollback') {
    result = await rollbackPendingModApplication({
      profileRoot,
      serverStopped,
      confirmWorldUnchangedSinceApply: flags.get('confirm-world-unchanged') === true
    });
  } else if (command === 'backup-world') {
    result = await createBoundedWorldBackup({
      profileRoot,
      serverStopped,
      reasons: ['manual'],
      limits: {
        maxBytes: numericFlag(flags, 'world-backup-max-bytes'),
        maxEntries: numericFlag(flags, 'world-backup-max-entries'),
        diskReserveBytes: numericFlag(flags, 'world-backup-reserve-bytes')
      }
    });
  } else {
    throw new Error(`Unknown command ${command}.\n\n${usage()}`);
  }
  if (flags.get('json') === true) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${formatPendingModStatus(result)}\n`);
  if (result && result.ok === false) process.exitCode = 2;
}

main().catch(error => {
  const friendly = friendlyPendingModError(error);
  const message = error?.userMessage || (error?.name === 'Error' ? error.message : '') || friendly.message;
  process.stderr.write(`${message}\n`);
  if (process.argv.includes('--json')) process.stderr.write(`${JSON.stringify(friendly, null, 2)}\n`);
  process.exitCode = 1;
});
