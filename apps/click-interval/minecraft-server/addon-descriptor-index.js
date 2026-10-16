'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { mapWithConcurrency } = require('./performance-safety');

const DEFAULT_IMPLEMENTATION_VERSION = 'plugin-descriptor-index-v2';
const DEFAULT_PARTIAL_WARNING =
  'Plugin conflict scan is incomplete. Remove unreadable or malformed plugin JARs, reduce the plugin folder if it exceeds safety limits, then retry.';
const DEFAULT_MAX_JAR_INSPECTIONS = 128;
const DEFAULT_MAX_SCAN_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_PARSED_ENTRIES = 50_000;
const DEFAULT_MAX_DURATION_MS = 2_000;

function normalizeProfileKey(profileKey, directory) {
  const value = String(profileKey || path.resolve(directory || '.')).trim();
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function fileIdentity(file) {
  return JSON.stringify({
    lowercaseName: String(file?.name || '').toLowerCase(),
    size: Number(file?.size) || 0,
    mtimeMs: Number(file?.modifiedAt) || 0,
    ctimeMs: Number(file?.createdAt) || 0,
    fileId: String(file?.fileId || '')
  });
}

function buildSignature(files, implementationVersion, partial) {
  const identities = files
    .map(file => ({
      lowercaseName: String(file.name || '').toLowerCase(),
      size: Number(file.size) || 0,
      mtimeMs: Number(file.modifiedAt) || 0,
      ctimeMs: Number(file.createdAt) || 0,
      fileId: String(file.fileId || '')
    }))
    .sort((left, right) => left.lowercaseName.localeCompare(right.lowercaseName) ||
      left.size - right.size || left.mtimeMs - right.mtimeMs || left.ctimeMs - right.ctimeMs ||
      left.fileId.localeCompare(right.fileId));
  return JSON.stringify({ implementationVersion, partial: Boolean(partial), files: identities });
}

async function enumerateJarFilesBounded(directory, maxEntries, deadlineAt = Number.POSITIVE_INFINITY) {
  let handle;
  try {
    handle = await fs.opendir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return { files: [], entriesVisited: 0, partial: false };
    return {
      files: [],
      entriesVisited: 0,
      partial: true,
      partialReasons: ['plugin directory could not be read'],
      directoryError: String(error?.message || error || 'Plugin directory could not be read.').slice(0, 240)
    };
  }

  const candidates = [];
  let entriesVisited = 0;
  let partial = false;
  const partialReasons = [];
  try {
    for await (const entry of handle) {
      if (Date.now() >= deadlineAt) {
        partial = true;
        partialReasons.push('wall-time budget exceeded');
        break;
      }
      if (entriesVisited >= maxEntries) {
        partial = true;
        partialReasons.push('directory-entry budget exceeded');
        break;
      }
      entriesVisited += 1;
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.jar')) {
        candidates.push({ name: entry.name, path: path.join(directory, entry.name) });
      }
    }
  } finally {
    // A completed async iterator closes itself. A broken one may already be
    // closed, so deliberately ignore ERR_DIR_CLOSED here.
    await handle.close().catch(error => {
      if (error?.code !== 'ERR_DIR_CLOSED') throw error;
    });
  }

  const rows = await mapWithConcurrency(candidates, 8, async candidate => {
    if (Date.now() >= deadlineAt) {
      return {
        ...candidate,
        size: 0,
        modifiedAt: 0,
        createdAt: 0,
        fileId: '',
        statError: 'Not statted: wall-time budget exceeded.'
      };
    }
    try {
      const stat = await fs.stat(candidate.path);
      if (!stat.isFile()) {
        return { ...candidate, size: 0, modifiedAt: 0, createdAt: 0, fileId: '', statError: 'File changed during the scan.' };
      }
      const device = Number.isSafeInteger(stat.dev) && stat.dev >= 0 ? String(stat.dev) : '';
      const inode = Number.isSafeInteger(stat.ino) && stat.ino > 0 ? String(stat.ino) : '';
      return {
        ...candidate,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        createdAt: stat.ctimeMs,
        fileId: inode ? `${device}:${inode}` : ''
      };
    } catch (error) {
      return {
        ...candidate,
        size: 0,
        modifiedAt: 0,
        createdAt: 0,
        fileId: '',
        statError: String(error?.message || error || 'File metadata could not be read.').slice(0, 240)
      };
    }
  });

  if (rows.some(row => row?.statError)) {
    partial = true;
    partialReasons.push('one or more plugin files could not be statted');
  }
  if (Date.now() >= deadlineAt && !partialReasons.includes('wall-time budget exceeded')) {
    partial = true;
    partialReasons.push('wall-time budget exceeded');
  }

  return {
    files: rows.filter(Boolean).sort((left, right) => left.name.localeCompare(right.name)),
    entriesVisited,
    partial,
    partialReasons
  };
}

function createPluginDescriptorIndex({
  inspectDescriptor,
  enumerateFiles = enumerateJarFilesBounded,
  maxEntries,
  maxProfiles = 64,
  maxJarInspections = DEFAULT_MAX_JAR_INSPECTIONS,
  maxScanBytes = DEFAULT_MAX_SCAN_BYTES,
  maxParsedEntries = DEFAULT_MAX_PARSED_ENTRIES,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
  implementationVersion = DEFAULT_IMPLEMENTATION_VERSION,
  partialWarning = DEFAULT_PARTIAL_WARNING
} = {}) {
  if (typeof inspectDescriptor !== 'function') throw new TypeError('inspectDescriptor must be a function.');
  if (typeof enumerateFiles !== 'function') throw new TypeError('enumerateFiles must be a function.');
  const entryLimit = Math.max(1, Math.floor(Number(maxEntries) || 1));
  const profileLimit = Math.max(1, Math.floor(Number(maxProfiles) || 1));
  const inspectionLimit = Math.max(1, Math.floor(Number(maxJarInspections) || 1));
  const byteLimit = Math.max(1, Math.floor(Number(maxScanBytes) || 1));
  const parsedEntryLimit = Math.max(1, Math.floor(Number(maxParsedEntries) || 1));
  const durationLimit = Math.max(1, Math.floor(Number(maxDurationMs) || 1));
  const cache = new Map();
  const inFlight = new Map();

  function remember(profileKey, value) {
    cache.delete(profileKey);
    cache.set(profileKey, value);
    while (cache.size > profileLimit) cache.delete(cache.keys().next().value);
  }

  async function build(profileKey, directory) {
    const startedAt = Date.now();
    const deadlineAt = startedAt + durationLimit;
    const listing = await enumerateFiles(directory, entryLimit, deadlineAt);
    const signature = buildSignature(listing.files, implementationVersion, listing.partial);
    const previous = cache.get(profileKey);
    if (previous?.signature === signature && !previous.value.partial) {
      remember(profileKey, previous);
      return previous.value;
    }

    const previousRows = new Map((previous?.value?.files || []).map(file => [fileIdentity(file), file]));
    const partialReasons = new Set(listing.partialReasons || []);
    if (listing.directoryError) partialReasons.add('plugin directory could not be read');
    let inspections = 0;
    let scanBytes = 0;
    let parsedEntries = 0;
    let terminalBudgetReason = '';
    const files = [];
    for (const file of listing.files) {
      const identity = fileIdentity(file);
      const reusable = previousRows.get(identity);
      if (reusable?.descriptor && !reusable.inspectionError) {
        files.push(reusable);
        continue;
      }
      if (file.statError) {
        partialReasons.add('plugin file metadata error');
        files.push({ ...file, descriptor: null, inspectionError: file.statError });
        continue;
      }
      let budgetReason = '';
      if (terminalBudgetReason) budgetReason = terminalBudgetReason;
      else if (inspections >= inspectionLimit) budgetReason = 'JAR inspection-count budget exceeded';
      else if (scanBytes >= byteLimit) budgetReason = 'central-directory/descriptor byte budget exceeded';
      else if (parsedEntries >= parsedEntryLimit) budgetReason = 'ZIP-entry parsing budget exceeded';
      else if (Date.now() >= deadlineAt) budgetReason = 'wall-time budget exceeded';
      if (budgetReason) {
        partialReasons.add(budgetReason);
        files.push({ ...file, descriptor: null, inspectionError: `Not inspected: ${budgetReason}.` });
        continue;
      }
      inspections += 1;
      try {
        const descriptor = await inspectDescriptor(file.path, {
          deadlineAt,
          maxScanBytes: byteLimit - scanBytes,
          maxParsedEntries: parsedEntryLimit - parsedEntries
        });
        const consumedBytes = Math.max(0, Math.floor(Number(descriptor?.scanBytes) || 0));
        const consumedEntries = Math.max(0, Math.floor(Number(descriptor?.parsedEntries) || 0));
        scanBytes += consumedBytes;
        parsedEntries += consumedEntries;
        if (scanBytes > byteLimit) terminalBudgetReason = 'central-directory/descriptor byte budget exceeded';
        else if (parsedEntries > parsedEntryLimit) terminalBudgetReason = 'ZIP-entry parsing budget exceeded';
        else if (Date.now() > deadlineAt) terminalBudgetReason = 'wall-time budget exceeded';
        if (terminalBudgetReason) partialReasons.add(terminalBudgetReason);
        files.push({ ...file, descriptor, inspectionError: '' });
      } catch (error) {
        scanBytes += Math.max(0, Math.floor(Number(error?.scanBytes) || 0));
        parsedEntries += Math.max(0, Math.floor(Number(error?.parsedEntries) || 0));
        const errorReason = String(error?.budgetReason || 'plugin descriptor inspection error');
        partialReasons.add(errorReason);
        if (/budget exceeded/i.test(errorReason)) terminalBudgetReason = errorReason;
        files.push({
          ...file,
          descriptor: null,
          inspectionError: String(error?.message || error || 'The JAR descriptor could not be inspected.').slice(0, 240)
        });
      }
    }

    const partial = Boolean(listing.partial || listing.directoryError || partialReasons.size);
    const reasonList = [...partialReasons];
    const warning = partial
      ? `${partialWarning} (${reasonList.join('; ').slice(0, 360)})`
      : '';

    const value = {
      profileKey,
      signature,
      implementationVersion,
      files,
      entriesVisited: listing.entriesVisited,
      inspections,
      scanBytes,
      parsedEntries,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      budgets: {
        maxEntries: entryLimit,
        maxJarInspections: inspectionLimit,
        maxScanBytes: byteLimit,
        maxParsedEntries: parsedEntryLimit,
        maxDurationMs: durationLimit
      },
      partial,
      partialReasons: reasonList,
      warning
    };
    remember(profileKey, { signature, value });
    return value;
  }

  function get(profileKey, directory) {
    const normalizedProfileKey = normalizeProfileKey(profileKey, directory);
    const existing = inFlight.get(normalizedProfileKey);
    if (existing) return existing;
    let pending;
    pending = Promise.resolve()
      .then(() => build(normalizedProfileKey, directory))
      .finally(() => {
        if (inFlight.get(normalizedProfileKey) === pending) inFlight.delete(normalizedProfileKey);
      });
    inFlight.set(normalizedProfileKey, pending);
    return pending;
  }

  function invalidate(profileKey, directory) {
    if (!profileKey && !directory) {
      cache.clear();
      return;
    }
    cache.delete(normalizeProfileKey(profileKey, directory));
  }

  return Object.freeze({ get, invalidate });
}

module.exports = {
  DEFAULT_IMPLEMENTATION_VERSION,
  DEFAULT_MAX_DURATION_MS,
  DEFAULT_MAX_JAR_INSPECTIONS,
  DEFAULT_MAX_PARSED_ENTRIES,
  DEFAULT_MAX_SCAN_BYTES,
  DEFAULT_PARTIAL_WARNING,
  buildSignature,
  createPluginDescriptorIndex,
  enumerateJarFilesBounded,
  fileIdentity
};
