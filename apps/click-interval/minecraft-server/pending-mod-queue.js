'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const zlib = require('node:zlib');

const MANIFEST_SCHEMA_VERSION = 1;
const PENDING_DIRECTORY = 'pending-mods';
const QUEUES_DIRECTORY = 'queues';
const TRANSACTIONS_DIRECTORY = 'transactions';
const ACTIVE_TRANSACTION_FILE = 'active-transaction.json';
const APPLY_LOCK_FILE = 'apply.lock';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAX_ARTIFACTS = 64;
const MAX_INSTALLED_JARS = 512;
const MAX_DESCRIPTOR_BYTES = 512 * 1024;
const MAX_ZIP_DIRECTORY_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 50_000;
const MAX_RESOURCE_PACK_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_RESOURCE_PACK_COMPRESSION_RATIO = 1000;
const DEFAULT_WORLD_BACKUP_MAX_BYTES = 64 * 1024 * 1024 * 1024;
const DEFAULT_WORLD_BACKUP_MAX_ENTRIES = 2_000_000;
const DEFAULT_WORLD_BACKUP_DISK_RESERVE_BYTES = 512 * 1024 * 1024;
const ABSOLUTE_WORLD_BACKUP_MAX_BYTES = 256 * 1024 * 1024 * 1024;
const ABSOLUTE_WORLD_BACKUP_MAX_ENTRIES = 5_000_000;
const DEFAULT_DOWNLOAD_HOSTS = Object.freeze(['cdn.modrinth.com']);
const HASH_LENGTHS = Object.freeze({ sha1: 40, sha256: 64, sha512: 128 });
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

class PendingModError extends Error {
  constructor(code, userMessage, details = {}, cause = undefined) {
    super(userMessage, cause ? { cause } : undefined);
    this.name = 'PendingModError';
    this.code = String(code || 'pending-mod-error');
    this.userMessage = String(userMessage || 'The pending mod operation could not be completed.');
    this.details = details && typeof details === 'object' ? details : {};
  }
}

function fail(code, message, details = {}, cause) {
  throw new PendingModError(code, message, details, cause);
}

function friendlyPendingModError(error) {
  if (error instanceof PendingModError) {
    return { code: error.code, message: error.userMessage, details: error.details };
  }
  return {
    code: 'pending-mod-error',
    message: 'The pending mod operation could not be completed safely.',
    details: { technicalMessage: String(error?.message || error || 'Unknown error').slice(0, 500) }
  };
}

function normalizedPathForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function containedPath(root, ...segments) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...segments);
  const relative = path.relative(base, candidate);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return candidate;
  }
  fail('unsafe-path', 'A pending mod path escaped the selected server profile.', { root: base });
}

function safeFilename(value, field = 'filename', extension = '.jar') {
  const name = String(value || '');
  const escapedExtension = String(extension).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!name || name.length > 180 || name !== path.basename(name) || name.includes('\0') ||
      !new RegExp(`^[A-Za-z0-9][A-Za-z0-9._+() -]*${escapedExtension}$`, 'i').test(name)) {
    fail('invalid-manifest', `The manifest has an unsafe ${field}.`, { field, value: name.slice(0, 200) });
  }
  return name;
}

function artifactType(artifact) {
  return String(artifact?.artifactType || 'fabric-mod').toLowerCase();
}

function artifactClientFolder(artifact) {
  return artifactType(artifact) === 'resource-pack' ? 'resourcepacks' : 'mods';
}

function artifactPortableExportMode(artifact) {
  return artifact?.distribution?.portableExport === 'reference-only' ? 'reference-only' : 'include';
}

function safeArtifactFilename(artifact) {
  return safeFilename(artifact?.filename, 'filename', artifactType(artifact) === 'resource-pack' ? '.zip' : '.jar');
}

function safeId(value, field, maximumLength = 96) {
  const id = String(value || '');
  if (!id || id.length > maximumLength || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(id)) {
    fail('invalid-manifest', `The manifest has an invalid ${field}.`, { field, value: id.slice(0, 120) });
  }
  return id;
}

function normalizeHash(value, algorithm, field) {
  const hash = String(value || '').toLowerCase();
  const length = HASH_LENGTHS[algorithm];
  if (!length || hash.length !== length || !/^[a-f0-9]+$/.test(hash)) {
    fail('invalid-manifest', `The manifest has an invalid ${field}.`, { field });
  }
  return hash;
}

function validateManifest(manifest, { allowedDownloadHosts = DEFAULT_DOWNLOAD_HOSTS } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('invalid-manifest', 'The pending mod manifest is not a JSON object.');
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail('invalid-manifest', `Pending mod manifest schema ${manifest.schemaVersion} is not supported.`, {
      supportedSchemaVersion: MANIFEST_SCHEMA_VERSION
    });
  }
  safeId(manifest.id, 'id');
  if (manifest.compatiblePreviousManifestDigests !== undefined) {
    if (!Array.isArray(manifest.compatiblePreviousManifestDigests) || manifest.compatiblePreviousManifestDigests.length > 16) {
      fail('invalid-manifest', 'Compatible previous manifests must be a bounded list of SHA-256 digests.');
    }
    for (const digest of manifest.compatiblePreviousManifestDigests) normalizeHash(digest, 'sha256', 'compatible previous manifest');
  }
  if (!manifest.target || manifest.target.loader !== 'fabric' || !/^\d+(?:\.\d+){1,2}$/.test(String(manifest.target.minecraftVersion || ''))) {
    fail('invalid-manifest', 'The manifest must target an exact Fabric Minecraft version.');
  }
  if (manifest.requiredInstalledModIds !== undefined) {
    if (!Array.isArray(manifest.requiredInstalledModIds) || manifest.requiredInstalledModIds.length > 32) {
      fail('invalid-manifest', 'requiredInstalledModIds must be a short array of Fabric mod ids.');
    }
    const requiredIds = new Set();
    for (const value of manifest.requiredInstalledModIds) {
      const id = safeId(value, 'required installed mod id', 128).toLowerCase();
      if (requiredIds.has(id)) fail('invalid-manifest', `The manifest repeats required mod ${id}.`);
      requiredIds.add(id);
    }
  }
  const artifacts = manifest.artifacts;
  if (!Array.isArray(artifacts) || !artifacts.length || artifacts.length > MAX_ARTIFACTS) {
    fail('invalid-manifest', `The manifest must contain between 1 and ${MAX_ARTIFACTS} artifacts.`);
  }

  const allowedHosts = new Set((allowedDownloadHosts || []).map(host => String(host).toLowerCase()));
  if (manifest.clientExternalDependencies !== undefined) {
    if (!Array.isArray(manifest.clientExternalDependencies) || manifest.clientExternalDependencies.length > 16) {
      fail('invalid-manifest', 'clientExternalDependencies must be a short array.');
    }
    const externalIds = new Set();
    for (const dependency of manifest.clientExternalDependencies) {
      if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) {
        fail('invalid-manifest', 'Every external client dependency must be an object.');
      }
      const modId = safeId(dependency.modId, 'external dependency modId', 128).toLowerCase();
      if (externalIds.has(modId)) fail('invalid-manifest', `The manifest repeats external client dependency ${modId}.`);
      externalIds.add(modId);
      safeId(dependency.projectId, `${modId} projectId`, 64);
      safeId(dependency.versionId, `${modId} versionId`, 64);
      const filename = safeFilename(dependency.filename, `${modId} filename`);
      if (!String(dependency.title || '').trim() || !String(dependency.version || '').trim()) {
        fail('invalid-manifest', `The external dependency metadata for ${modId} is incomplete.`);
      }
      if (!Number.isSafeInteger(dependency.size) || dependency.size <= 0 || dependency.size > MAX_ARTIFACT_BYTES) {
        fail('invalid-manifest', `The external dependency ${modId} has an unsafe file size.`);
      }
      normalizeHash(dependency.hashes?.sha1, 'sha1', `${modId}.hashes.sha1`);
      normalizeHash(dependency.hashes?.sha256, 'sha256', `${modId}.hashes.sha256`);
      normalizeHash(dependency.hashes?.sha512, 'sha512', `${modId}.hashes.sha512`);
      let parsedUrl;
      try {
        parsedUrl = new URL(dependency.url);
      } catch (error) {
        fail('invalid-manifest', `The download URL for external dependency ${modId} is invalid.`, {}, error);
      }
      if (parsedUrl.protocol !== 'https:' || !allowedHosts.has(parsedUrl.hostname.toLowerCase()) || parsedUrl.username || parsedUrl.password) {
        fail('invalid-manifest', `The external dependency URL for ${modId} is not an approved HTTPS Modrinth CDN URL.`);
      }
      let urlFilename = '';
      try {
        urlFilename = decodeURIComponent(parsedUrl.pathname.split('/').at(-1) || '');
      } catch {
        fail('invalid-manifest', `The external dependency URL for ${modId} contains invalid escaping.`);
      }
      if (urlFilename !== filename) fail('invalid-manifest', `The external dependency URL filename for ${modId} does not match.`);
      if (dependency.bundled !== false || dependency.required !== true) {
        fail('invalid-manifest', `External client dependency ${modId} must be explicitly required and not bundled.`);
      }
    }
  }
  const keys = new Set();
  const filenames = new Set();
  const fabricModIds = new Set();
  const resourcePackIds = new Set();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      fail('invalid-manifest', 'Every manifest artifact must be an object.');
    }
    const key = safeId(artifact.key, 'artifact key');
    if (keys.has(key.toLowerCase())) fail('invalid-manifest', `The manifest repeats artifact key ${key}.`);
    keys.add(key.toLowerCase());
    const type = artifactType(artifact);
    if (!['fabric-mod', 'resource-pack'].includes(type)) {
      fail('invalid-manifest', `The manifest has an invalid artifactType for ${key}.`);
    }
    const filename = safeArtifactFilename(artifact);
    const lowercaseFilename = filename.toLowerCase();
    if (filenames.has(lowercaseFilename)) fail('invalid-manifest', `The manifest repeats filename ${filename}.`);
    filenames.add(lowercaseFilename);
    safeId(artifact.projectId, `${key} projectId`, 64);
    safeId(artifact.versionId, `${key} versionId`, 64);
    if (type === 'fabric-mod') {
      const modId = safeId(artifact.modId, `${key} modId`, 128).toLowerCase();
      if (fabricModIds.has(modId)) fail('invalid-manifest', `The manifest would install ${artifact.modId} more than once.`);
      fabricModIds.add(modId);
    } else {
      const resourcePackId = safeId(artifact.resourcePackId, `${key} resourcePackId`, 128).toLowerCase();
      if (resourcePackIds.has(resourcePackId)) {
        fail('invalid-manifest', `The manifest repeats resource pack ${artifact.resourcePackId}.`);
      }
      resourcePackIds.add(resourcePackId);
    }
    if (!String(artifact.title || '').trim() || String(artifact.title).length > 120) {
      fail('invalid-manifest', `The manifest has an invalid title for ${key}.`);
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_ARTIFACT_BYTES) {
      fail('invalid-manifest', `The manifest has an unsafe file size for ${artifact.title}.`);
    }
    if (!artifact.hashes || typeof artifact.hashes !== 'object') {
      fail('invalid-manifest', `The manifest has no hashes for ${artifact.title}.`);
    }
    normalizeHash(artifact.hashes.sha1, 'sha1', `${key}.hashes.sha1`);
    if (artifact.hashes.sha256 !== undefined) normalizeHash(artifact.hashes.sha256, 'sha256', `${key}.hashes.sha256`);
    normalizeHash(artifact.hashes.sha512, 'sha512', `${key}.hashes.sha512`);
    let parsedUrl;
    try {
      parsedUrl = new URL(artifact.url);
    } catch (error) {
      fail('invalid-manifest', `The download URL for ${artifact.title} is invalid.`, {}, error);
    }
    if (parsedUrl.protocol !== 'https:' || !allowedHosts.has(parsedUrl.hostname.toLowerCase()) || parsedUrl.username || parsedUrl.password) {
      fail('invalid-manifest', `The download URL for ${artifact.title} is not an approved HTTPS Modrinth CDN URL.`, {
        hostname: parsedUrl.hostname
      });
    }
    let urlFilename = '';
    try {
      urlFilename = decodeURIComponent(parsedUrl.pathname.split('/').at(-1) || '');
    } catch {
      fail('invalid-manifest', `The download URL for ${artifact.title} contains invalid escaping.`);
    }
    if (urlFilename !== filename) {
      fail('invalid-manifest', `The URL filename for ${artifact.title} does not match its declared filename.`);
    }
    if (!['server', 'client-optional', 'client-resource-pack'].includes(artifact.installTarget)) {
      fail('invalid-manifest', `The install target for ${artifact.title} is invalid.`);
    }
    if (type === 'resource-pack' && artifact.installTarget !== 'client-resource-pack') {
      fail('invalid-manifest', `${artifact.title} is a resource pack and must target the client resourcepacks folder.`);
    }
    if (type === 'fabric-mod' && artifact.installTarget === 'client-resource-pack') {
      fail('invalid-manifest', `${artifact.title} is a Fabric mod and cannot target the resourcepacks folder.`);
    }
    if (typeof artifact.clientRequired !== 'boolean' || typeof artifact.serverOnly !== 'boolean' ||
        typeof artifact.clientOnly !== 'boolean') {
      fail('invalid-manifest', `The clientRequired, serverOnly, and clientOnly flags for ${artifact.title} must be explicit booleans.`);
    }
    if (artifact.clientRequired && artifact.serverOnly) {
      fail('invalid-manifest', `${artifact.title} cannot be both client-required and server-only.`);
    }
    if (['client-optional', 'client-resource-pack'].includes(artifact.installTarget) &&
        (artifact.clientRequired || artifact.serverOnly)) {
      fail('invalid-manifest', `${artifact.title} is optional client content and cannot be server-only or required for every client.`);
    }
    if ((artifact.installTarget === 'server' && artifact.clientOnly !== false) ||
        (['client-optional', 'client-resource-pack'].includes(artifact.installTarget) && artifact.clientOnly !== true)) {
      fail('invalid-manifest', `${artifact.title} has clientOnly metadata that conflicts with its install target.`);
    }
    if (['client-optional', 'client-resource-pack'].includes(artifact.installTarget) &&
        (!artifact.compatibility || artifact.compatibility.loader !== manifest.target.loader ||
         artifact.compatibility.minecraftVersion !== manifest.target.minecraftVersion)) {
      fail('invalid-manifest', `${artifact.title} must declare exact Fabric ${manifest.target.minecraftVersion} compatibility.`);
    }
    if (type === 'resource-pack') {
      if (artifact.optional !== true) {
        fail('invalid-manifest', `${artifact.title} must be explicitly optional client content.`);
      }
      if (!artifact.compatibility || artifact.compatibility.loader !== manifest.target.loader ||
          artifact.compatibility.minecraftVersion !== manifest.target.minecraftVersion) {
        fail('invalid-manifest', `${artifact.title} must declare the exact Fabric and Minecraft target used by this manifest.`);
      }
      if (!artifact.resourcePack || !Number.isSafeInteger(artifact.resourcePack.minFormat) ||
          !Number.isSafeInteger(artifact.resourcePack.maxFormat) || artifact.resourcePack.minFormat <= 0 ||
          artifact.resourcePack.maxFormat < artifact.resourcePack.minFormat || artifact.resourcePack.maxFormat > 10_000) {
        fail('invalid-manifest', `${artifact.title} must declare its verified pack.mcmeta format range.`);
      }
      if (!artifact.distribution || artifact.distribution.source !== 'official-cdn' ||
          artifact.distribution.embedInApp !== false || artifact.distribution.rehost !== false) {
        fail('invalid-manifest', `${artifact.title} must preserve its official-download and no-rehosting policy.`);
      }
    }
    if (artifact.distribution !== undefined) {
      if (!artifact.distribution || typeof artifact.distribution !== 'object' ||
          !['include', 'reference-only'].includes(String(artifact.distribution.portableExport || 'include')) ||
          (artifact.distribution.localDirectInstall !== undefined &&
           typeof artifact.distribution.localDirectInstall !== 'boolean')) {
        fail('invalid-manifest', `${artifact.title} has invalid portable distribution metadata.`);
      }
      if (artifact.distribution.rehost === false && artifactPortableExportMode(artifact) !== 'reference-only') {
        fail('invalid-manifest', `${artifact.title} forbids rehosting and must remain reference-only in portable exports.`);
      }
      if (artifactPortableExportMode(artifact) === 'reference-only' &&
          (artifact.distribution.source !== 'official-cdn' || artifact.distribution.embedInApp !== false ||
           artifact.distribution.rehost !== false || artifact.distribution.localDirectInstall !== true)) {
        fail('invalid-manifest', `${artifact.title} must retain an official direct-download reference and cannot be embedded or rehosted.`);
      }
    }
    if (artifact.replaceExisting !== undefined && typeof artifact.replaceExisting !== 'boolean') {
      fail('invalid-manifest', `replaceExisting for ${artifact.title} must be a boolean.`);
    }
    if (artifact.optional !== undefined && typeof artifact.optional !== 'boolean') {
      fail('invalid-manifest', `optional for ${artifact.title} must be a boolean.`);
    }
    if (artifact.requiresWorldBackup !== undefined && typeof artifact.requiresWorldBackup !== 'boolean') {
      fail('invalid-manifest', `requiresWorldBackup for ${artifact.title} must be a boolean.`);
    }
    if (artifact.requiresWorldBackup === true && artifact.installTarget !== 'server') {
      fail('invalid-manifest', `${artifact.title} cannot require a server world backup when it is not a server artifact.`);
    }
  }
  const artifactByKey = new Map(artifacts.map(artifact => [artifact.key.toLowerCase(), artifact]));
  const artifactByDependencyName = new Map(artifactByKey);
  for (const artifact of artifacts) {
    if (artifact.modId && !artifactByDependencyName.has(artifact.modId.toLowerCase())) {
      artifactByDependencyName.set(artifact.modId.toLowerCase(), artifact);
    }
  }
  for (const artifact of artifacts) {
    if (!Array.isArray(artifact.dependencies) || artifact.dependencies.length > MAX_ARTIFACTS) {
      fail('invalid-manifest', `${artifact.title} must have a bounded dependencies array.`);
    }
    const dependencies = new Set();
    for (const value of artifact.dependencies) {
      const dependencyKey = safeId(value, `${artifact.key} dependency`, 128).toLowerCase();
      if (dependencies.has(dependencyKey)) fail('invalid-manifest', `${artifact.title} repeats dependency ${dependencyKey}.`);
      dependencies.add(dependencyKey);
      const dependency = artifactByDependencyName.get(dependencyKey);
      if (dependency && (artifact.installTarget === 'server') !== (dependency.installTarget === 'server')) {
        fail('invalid-manifest', `${artifact.title} has an unsafe dependency across the server/client install boundary: ${dependency.key}.`);
      }
    }
  }
  validateClientBundleDefinitions(manifest);
  return manifest;
}

function validateClientBundleDefinitions(manifest) {
  if (manifest.clientBundles === undefined) return;
  if (!Array.isArray(manifest.clientBundles) || manifest.clientBundles.length > 32) {
    fail('invalid-manifest', 'clientBundles must be a short array.');
  }
  const artifactsByKey = new Map(manifest.artifacts.map(artifact => [artifact.key.toLowerCase(), artifact]));
  const artifactsByDependencyName = new Map(artifactsByKey);
  for (const artifact of manifest.artifacts) {
    if (artifact.modId && !artifactsByDependencyName.has(artifact.modId.toLowerCase())) {
      artifactsByDependencyName.set(artifact.modId.toLowerCase(), artifact);
    }
  }
  const bundleKeys = new Set();
  for (const bundle of manifest.clientBundles) {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      fail('invalid-manifest', 'Every client bundle definition must be an object.');
    }
    const key = safeId(bundle.key, 'client bundle key').toLowerCase();
    if (bundleKeys.has(key)) fail('invalid-manifest', `The manifest repeats client bundle ${bundle.key}.`);
    bundleKeys.add(key);
    if (!String(bundle.title || '').trim() || String(bundle.title).length > 120 || typeof bundle.available !== 'boolean') {
      fail('invalid-manifest', `Client bundle ${bundle.key} has incomplete availability metadata.`);
    }
    if (!bundle.target || bundle.target.loader !== manifest.target.loader ||
        bundle.target.minecraftVersion !== manifest.target.minecraftVersion) {
      fail('invalid-manifest', `Client bundle ${bundle.key} must target exact Fabric ${manifest.target.minecraftVersion}.`);
    }
    if (!Array.isArray(bundle.artifactKeys) || bundle.artifactKeys.length > MAX_ARTIFACTS) {
      fail('invalid-manifest', `Client bundle ${bundle.key} has an invalid artifact selection.`);
    }
    const selected = new Set();
    for (const value of bundle.artifactKeys) {
      const artifactKey = safeId(value, `${bundle.key} artifact key`).toLowerCase();
      if (selected.has(artifactKey)) fail('invalid-manifest', `Client bundle ${bundle.key} repeats artifact ${artifactKey}.`);
      selected.add(artifactKey);
      const artifact = artifactsByKey.get(artifactKey);
      if (!artifact || !['client-optional', 'client-resource-pack'].includes(artifact.installTarget)) {
        fail('invalid-manifest', `Client bundle ${bundle.key} references a missing or non-client artifact ${artifactKey}.`);
      }
    }
    for (const artifactKey of selected) {
      const artifact = artifactsByKey.get(artifactKey);
      for (const dependencyKey of artifact.dependencies || []) {
        const dependency = artifactsByDependencyName.get(String(dependencyKey).toLowerCase());
        if (dependency && ['client-optional', 'client-resource-pack'].includes(dependency.installTarget) &&
            !selected.has(dependency.key.toLowerCase())) {
          fail('invalid-manifest', `Client bundle ${bundle.key} omits client dependency ${dependencyKey} required by ${artifact.key}.`);
        }
      }
    }
    if (bundle.available && selected.size === 0) {
      fail('invalid-manifest', `Available client bundle ${bundle.key} must select at least one verified artifact.`);
    }
    if (!bundle.available) {
      if (selected.size !== 0 || !String(bundle.unavailableReason || '').trim()) {
        fail('invalid-manifest', `Unavailable client bundle ${bundle.key} must have no artifacts and explain what metadata is missing.`);
      }
      if (!Array.isArray(bundle.expectedArtifacts) || !bundle.expectedArtifacts.length || bundle.expectedArtifacts.length > 16) {
        fail('invalid-manifest', `Unavailable client bundle ${bundle.key} must list the artifacts still requiring verification.`);
      }
      for (const expected of bundle.expectedArtifacts) {
        if (!expected || typeof expected !== 'object' || !String(expected.title || '').trim() ||
            !['fabric-mod', 'resource-pack'].includes(String(expected.artifactType || '')) ||
            !['mods', 'resourcepacks'].includes(String(expected.targetFolder || ''))) {
          fail('invalid-manifest', `Client bundle ${bundle.key} has invalid expected artifact metadata.`);
        }
      }
    }
  }
}

async function readJsonFile(file, maximumBytes = MAX_MANIFEST_BYTES) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    fail('unsafe-json', `The file ${path.basename(file)} is missing or exceeds its safety limit.`);
  }
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    fail('invalid-json', `The file ${path.basename(file)} is not valid JSON.`, {}, error);
  }
}

async function readPlainRegularFile(file, maximumBytes, errorCode, description) {
  let before;
  try {
    before = await fsp.lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(errorCode, `${description} is missing.`);
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maximumBytes) {
    fail(errorCode, `${description} must be a bounded regular file, not a link or special entry.`);
  }
  const handle = await fsp.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size ||
        (Number.isSafeInteger(before.ino) && Number.isSafeInteger(opened.ino) && before.ino !== opened.ino) ||
        (Number.isSafeInteger(before.dev) && Number.isSafeInteger(opened.dev) && before.dev !== opened.dev)) {
      fail(errorCode, `${description} changed or resolved to an unsafe file while it was being verified.`);
    }
    const bytes = await handle.readFile();
    if (bytes.length !== before.size) fail(errorCode, `${description} changed while it was being verified.`);
    return bytes;
  } finally {
    await handle.close();
  }
}

function canonicalJson(value) {
  const jsonValue = JSON.parse(JSON.stringify(value));
  const sortValue = current => {
    if (Array.isArray(current)) return current.map(sortValue);
    if (!current || typeof current !== 'object') return current;
    const result = Object.create(null);
    for (const key of Object.keys(current).sort()) result[key] = sortValue(current[key]);
    return result;
  };
  return JSON.stringify(sortValue(jsonValue));
}

async function loadManifest(manifestPath, options = {}) {
  const resolved = path.resolve(String(manifestPath || ''));
  const manifest = await readJsonFile(resolved);
  if (!manifest) fail('manifest-not-found', 'The pending mod manifest could not be found.', { manifestPath: resolved });
  validateManifest(manifest, options);
  const bytes = await fsp.readFile(resolved);
  return {
    path: resolved,
    manifest,
    digest: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

function queueStateMatchesManifest(state, manifest, digest) {
  if (!state || state.manifestId !== manifest.id || state.schemaVersion !== MANIFEST_SCHEMA_VERSION) return false;
  return state.manifestDigest === digest ||
    (manifest.compatiblePreviousManifestDigests || []).includes(state.manifestDigest);
}

async function migrateCompatibleQueueState(paths, state, manifest, digest) {
  if (state.manifestDigest === digest) return;
  if (!queueStateMatchesManifest(state, manifest, digest)) fail('queue-not-ready', 'This pending queue belongs to a different manifest.');
  const activeKeys = new Set(manifest.artifacts.map(artifact => artifact.key));
  const optionalKeys = new Set(manifest.artifacts.filter(artifact => artifact.optional && artifact.installTarget === 'server').map(artifact => artifact.key));
  const clientKeys = new Set((manifest.clientBundles || []).map(bundle => bundle.key));
  const next = {
    ...state, manifestDigest: digest, previousManifestDigest: state.manifestDigest,
    updatedAt: new Date().toISOString(),
    artifacts: (state.artifacts || []).filter(artifact => activeKeys.has(artifact.key)),
    optionalServerKeys: (state.optionalServerKeys || []).filter(key => optionalKeys.has(key)),
    clientBundleKeys: (state.clientBundleKeys || []).filter(key => clientKeys.has(key))
  };
  await writeJsonAtomic(paths.queueManifest, manifest);
  await writeJsonAtomic(paths.queueState, next);
  Object.assign(state, next);
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await fsp.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await syncHandleBestEffort(handle);
    await handle.close();
    handle = null;
    await fsp.rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}

async function syncHandleBestEffort(handle) {
  try {
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error?.code)) throw error;
    // Some Windows filesystems reject fsync even though close + atomic rename
    // are supported. The transaction journal still provides crash recovery.
  }
}

async function withLock(lockFile, operation) {
  await fsp.mkdir(path.dirname(lockFile), { recursive: true });
  let handle;
  try {
    handle = await fsp.open(lockFile, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('operation-in-progress', 'Another pending mod operation is already in progress. Wait for it to finish, then try again.');
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await fsp.rm(lockFile, { force: true }).catch(() => {});
  }
}

async function moveFileNoReplace(source, destination) {
  try {
    await fsp.link(source, destination);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('destination-changed', `${path.basename(destination)} appeared while pending mods were being applied. No unknown file was overwritten.`);
    }
    throw error;
  }
  try {
    await fsp.unlink(source);
  } catch (error) {
    // The destination is a complete hard link, never a partial copy. Leave the
    // journal to recover both names instead of hiding an unlink failure.
    throw error;
  }
}

function profilePaths(profileRoot, manifestId = '') {
  const input = String(profileRoot || '').trim();
  if (!input || !path.isAbsolute(input)) fail('invalid-profile', 'Choose a valid absolute server profile folder.');
  const root = path.resolve(input);
  const pendingRoot = containedPath(root, PENDING_DIRECTORY);
  const queueRoot = manifestId ? containedPath(pendingRoot, QUEUES_DIRECTORY, safeId(manifestId, 'manifest id')) : '';
  return {
    root,
    platform: containedPath(root, 'assembly-platform.json'),
    config: containedPath(root, 'assembly-config.json'),
    mods: containedPath(root, 'mods'),
    pendingRoot,
    queueRoot,
    queueState: queueRoot ? containedPath(queueRoot, 'state.json') : '',
    queueManifest: queueRoot ? containedPath(queueRoot, 'manifest.json') : '',
    queueFiles: queueRoot ? containedPath(queueRoot, 'files') : '',
    transactions: containedPath(pendingRoot, TRANSACTIONS_DIRECTORY),
    activeTransaction: containedPath(pendingRoot, ACTIVE_TRANSACTION_FILE),
    applyLock: containedPath(pendingRoot, APPLY_LOCK_FILE)
  };
}

async function ensurePlainDirectory(directory, { create = false } = {}) {
  if (create) await fsp.mkdir(directory, { recursive: true });
  let stat;
  try {
    stat = await fsp.lstat(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('unsafe-directory', `${path.basename(directory)} must be a normal directory, not a link or file.`);
  }
  return true;
}

async function verifyProfileTarget(profileRoot, target) {
  const paths = profilePaths(profileRoot);
  await ensurePlainDirectory(paths.root);
  const platform = await readJsonFile(paths.platform);
  if (!platform) {
    fail('profile-not-ready', 'Install Fabric on this server profile before preparing these mods.');
  }
  const loader = String(platform.type || '').toLowerCase();
  const minecraftVersion = String(platform.minecraftVersion || '');
  if (loader !== target.loader || minecraftVersion !== target.minecraftVersion) {
    fail(
      'profile-mismatch',
      `These mods are for Fabric ${target.minecraftVersion}, but this profile uses ${loader || 'an unknown platform'} ${minecraftVersion || 'with an unknown version'}.`,
      { expected: target, actual: { loader, minecraftVersion } }
    );
  }
  return { paths, platform };
}

function selectManifestArtifacts(manifest, {
  includeClientOptional = false,
  includeOptionalServer = false,
  optionalServerKeys = [],
  clientBundleKeys = []
} = {}) {
  const requested = new Set((optionalServerKeys || []).map(value => String(value).toLowerCase()));
  const knownOptional = new Set(manifest.artifacts
    .filter(artifact => artifact.installTarget === 'server' && artifact.optional === true)
    .map(artifact => artifact.key.toLowerCase()));
  const unknown = [...requested].filter(key => !knownOptional.has(key));
  if (unknown.length) {
    fail('unknown-optional-mod', `The optional server mod selection is invalid: ${unknown.join(', ')}.`, { unknownKeys: unknown });
  }
  const requestedBundles = new Set((clientBundleKeys || []).map(value => String(value).toLowerCase()));
  const bundleDefinitions = new Map((manifest.clientBundles || [])
    .map(bundle => [String(bundle.key).toLowerCase(), bundle]));
  const unknownBundles = [...requestedBundles].filter(key => !bundleDefinitions.has(key));
  if (unknownBundles.length) {
    fail('unknown-client-bundle', `The optional client bundle selection is invalid: ${unknownBundles.join(', ')}.`, {
      unknownKeys: unknownBundles
    });
  }
  const selectedClientArtifacts = new Set();
  for (const key of requestedBundles) {
    const bundle = bundleDefinitions.get(key);
    if (bundle.available !== true) {
      fail('client-bundle-unavailable', `${bundle.title} is not downloadable yet. ${bundle.unavailableReason}`, {
        bundleKey: bundle.key,
        expectedArtifacts: bundle.expectedArtifacts || []
      });
    }
    for (const artifactKey of bundle.artifactKeys) selectedClientArtifacts.add(String(artifactKey).toLowerCase());
  }
  return manifest.artifacts.filter(artifact => {
    if (['client-optional', 'client-resource-pack'].includes(artifact.installTarget)) {
      return includeClientOptional || selectedClientArtifacts.has(artifact.key.toLowerCase());
    }
    if (artifact.installTarget !== 'server') return false;
    return artifact.optional !== true || includeOptionalServer || requested.has(artifact.key.toLowerCase());
  });
}

async function hashFile(file, algorithms = Object.keys(HASH_LENGTHS), maximumBytes = MAX_ARTIFACT_BYTES) {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximumBytes) {
    fail('unsafe-artifact', `${path.basename(file)} is not a safe mod file.`);
  }
  const hashers = new Map(algorithms.map(algorithm => [algorithm, crypto.createHash(algorithm)]));
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(file);
    input.on('data', chunk => {
      for (const hasher of hashers.values()) hasher.update(chunk);
    });
    input.once('error', reject);
    input.once('end', resolve);
  });
  return {
    size: stat.size,
    hashes: Object.fromEntries([...hashers].map(([algorithm, hasher]) => [algorithm, hasher.digest('hex')]))
  };
}

async function verifyArtifactFile(file, artifact) {
  let actual;
  try {
    actual = await hashFile(file, Object.keys(artifact.hashes), Math.min(MAX_ARTIFACT_BYTES, artifact.size + 1));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail('pending-file-missing', `${artifact.title} has not been downloaded yet.`, { artifactKey: artifact.key });
    }
    throw error;
  }
  if (actual.size !== artifact.size) {
    fail('artifact-size-mismatch', `${artifact.title} did not match the size published by Modrinth. It was not trusted.`, {
      artifactKey: artifact.key,
      expectedSize: artifact.size,
      actualSize: actual.size
    });
  }
  for (const [algorithm, expected] of Object.entries(artifact.hashes)) {
    if (actual.hashes[algorithm] !== String(expected).toLowerCase()) {
      fail('artifact-hash-mismatch', `${artifact.title} failed its ${algorithm.toUpperCase()} verification. It was not trusted.`, {
        artifactKey: artifact.key,
        algorithm,
        expected,
        actual: actual.hashes[algorithm]
      });
    }
  }
  return actual;
}

function findZipEndRecord(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (!result.bytesRead) fail('invalid-jar', 'A mod JAR ended unexpectedly while reading its descriptor.');
    offset += result.bytesRead;
  }
  return buffer;
}

function escapeJsonStringControls(source) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const character of String(source)) {
    if (!inString) {
      result += character;
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      result += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      result += character;
      inString = false;
      continue;
    }
    const code = character.charCodeAt(0);
    if (code >= 0x20) {
      result += character;
      continue;
    }
    result += ({ '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[character] ||
      `\\u${code.toString(16).padStart(4, '0')}`;
  }
  return result;
}

async function readFabricModDescriptor(file) {
  const stat = await fsp.stat(file);
  if (!stat.isFile() || stat.size < 22 || stat.size > MAX_ARTIFACT_BYTES) {
    fail('invalid-jar', `${path.basename(file)} is not a safe JAR file.`);
  }
  const handle = await fsp.open(file, 'r');
  try {
    const signature = await readExactly(handle, 4, 0);
    if (signature.readUInt32LE(0) !== 0x04034b50) fail('invalid-jar', `${path.basename(file)} is not a valid JAR archive.`);
    const tailLength = Math.min(stat.size, 65_557);
    const tail = await readExactly(handle, tailLength, stat.size - tailLength);
    const endOffset = findZipEndRecord(tail);
    if (endOffset < 0) fail('invalid-jar', `${path.basename(file)} has no valid ZIP directory.`);
    const entryCount = tail.readUInt16LE(endOffset + 10);
    const directorySize = tail.readUInt32LE(endOffset + 12);
    const directoryOffset = tail.readUInt32LE(endOffset + 16);
    if (!entryCount || entryCount === 0xffff || entryCount > MAX_ZIP_ENTRIES || directorySize === 0xffffffff ||
        directorySize > MAX_ZIP_DIRECTORY_BYTES || directoryOffset + directorySize > stat.size) {
      fail('invalid-jar', `${path.basename(file)} has an unsupported or unsafe ZIP directory.`);
    }
    const directory = await readExactly(handle, directorySize, directoryOffset);
    let descriptorEntry = null;
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) {
        fail('invalid-jar', `${path.basename(file)} has a damaged ZIP directory.`);
      }
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
      if (!nameLength || nextOffset > directory.length) fail('invalid-jar', `${path.basename(file)} has a damaged ZIP entry.`);
      const name = directory.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      if (name === 'fabric.mod.json') {
        descriptorEntry = {
          flags: directory.readUInt16LE(offset + 8),
          compressionMethod: directory.readUInt16LE(offset + 10),
          compressedSize: directory.readUInt32LE(offset + 20),
          uncompressedSize: directory.readUInt32LE(offset + 24),
          localOffset: directory.readUInt32LE(offset + 42)
        };
      }
      offset = nextOffset;
    }
    if (!descriptorEntry) fail('invalid-jar', `${path.basename(file)} is not a Fabric mod (fabric.mod.json is missing).`);
    if ((descriptorEntry.flags & 1) || ![0, 8].includes(descriptorEntry.compressionMethod) ||
        descriptorEntry.compressedSize > MAX_DESCRIPTOR_BYTES || descriptorEntry.uncompressedSize > MAX_DESCRIPTOR_BYTES) {
      fail('invalid-jar', `${path.basename(file)} has an unsupported Fabric descriptor.`);
    }
    const localHeader = await readExactly(handle, 30, descriptorEntry.localOffset);
    if (localHeader.readUInt32LE(0) !== 0x04034b50) fail('invalid-jar', `${path.basename(file)} has a damaged descriptor entry.`);
    const dataOffset = descriptorEntry.localOffset + 30 + localHeader.readUInt16LE(26) + localHeader.readUInt16LE(28);
    if (dataOffset + descriptorEntry.compressedSize > stat.size) fail('invalid-jar', `${path.basename(file)} has a truncated descriptor.`);
    const compressed = await readExactly(handle, descriptorEntry.compressedSize, dataOffset);
    const descriptorBytes = descriptorEntry.compressionMethod === 0
      ? compressed
      : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_DESCRIPTOR_BYTES });
    let descriptor;
    try {
      descriptor = JSON.parse(escapeJsonStringControls(descriptorBytes.toString('utf8')));
    } catch (error) {
      fail('invalid-jar', `${path.basename(file)} has invalid Fabric metadata.`, {}, error);
    }
    const id = String(descriptor?.id || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,127}$/.test(id)) fail('invalid-jar', `${path.basename(file)} has an invalid Fabric mod id.`);
    const environment = String(descriptor?.environment || '*').toLowerCase();
    if (!['*', 'client', 'server'].includes(environment)) {
      fail('invalid-jar', `${path.basename(file)} has invalid Fabric environment metadata.`);
    }
    return {
      id,
      version: String(descriptor?.version || '').slice(0, 160),
      environment,
      depends: descriptor?.depends && typeof descriptor.depends === 'object' ? descriptor.depends : {}
    };
  } finally {
    await handle.close();
  }
}

function safeZipEntryName(name) {
  if (!name || name.length > 1024 || name.includes('\0') || name.includes('\\') ||
      name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const directory = name.endsWith('/');
  const segments = name.split('/');
  if (directory) segments.pop();
  return segments.length > 0 && segments.every(segment => segment && segment !== '.' && segment !== '..');
}

function updateCrc32(current, chunk) {
  let value = current >>> 0;
  for (const byte of chunk) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

async function inspectResourcePackLocalEntry(handle, entry, directoryOffset, archiveName) {
  if (!Number.isSafeInteger(entry.localOffset) || entry.localOffset < 0 || entry.localOffset + 30 > directoryOffset) {
    fail('unsafe-resource-pack-entry', `${archiveName} contains an invalid local ZIP header offset.`);
  }
  const localHeader = await readExactly(handle, 30, entry.localOffset);
  if (localHeader.readUInt32LE(0) !== 0x04034b50) {
    fail('unsafe-resource-pack-entry', `${archiveName} has a missing or forged local ZIP header.`);
  }
  const localFlags = localHeader.readUInt16LE(6);
  const localMethod = localHeader.readUInt16LE(8);
  const localCrc = localHeader.readUInt32LE(14);
  const localCompressedSize = localHeader.readUInt32LE(18);
  const localUncompressedSize = localHeader.readUInt32LE(22);
  const localNameLength = localHeader.readUInt16LE(26);
  const localExtraLength = localHeader.readUInt16LE(28);
  if (!localNameLength || localFlags !== entry.flags || localMethod !== entry.compressionMethod) {
    fail('unsafe-resource-pack-entry', `${archiveName} contains inconsistent local and central ZIP headers.`);
  }
  const localName = (await readExactly(handle, localNameLength, entry.localOffset + 30)).toString('utf8');
  if (localName !== entry.name || localName.includes('\ufffd')) {
    fail('unsafe-resource-pack-entry', `${archiveName} contains a forged local ZIP path.`);
  }
  const usesDataDescriptor = (entry.flags & 0x08) !== 0;
  const localFieldsMatch = localCrc === entry.crc32 && localCompressedSize === entry.compressedSize &&
    localUncompressedSize === entry.uncompressedSize;
  const localFieldsEmpty = localCrc === 0 && localCompressedSize === 0 && localUncompressedSize === 0;
  if ((!usesDataDescriptor && !localFieldsMatch) || (usesDataDescriptor && !localFieldsMatch && !localFieldsEmpty)) {
    fail('unsafe-resource-pack-entry', `${archiveName} contains forged local ZIP sizes or checksum metadata.`);
  }
  const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (!Number.isSafeInteger(dataEnd) || dataOffset < entry.localOffset || dataEnd > directoryOffset) {
    fail('unsafe-resource-pack-entry', `${archiveName} contains an out-of-bounds ZIP entry.`);
  }
  let entryEnd = dataEnd;
  if (usesDataDescriptor) {
    const available = directoryOffset - dataEnd;
    if (available < 12) {
      fail('unsafe-resource-pack-entry', `${archiveName} is missing a ZIP data descriptor.`);
    }
    const descriptor = await readExactly(handle, Math.min(16, available), dataEnd);
    let descriptorLength = 0;
    if (descriptor.length >= 16 && descriptor.readUInt32LE(0) === 0x08074b50 &&
        descriptor.readUInt32LE(4) === entry.crc32 && descriptor.readUInt32LE(8) === entry.compressedSize &&
        descriptor.readUInt32LE(12) === entry.uncompressedSize) {
      descriptorLength = 16;
    } else if (descriptor.readUInt32LE(0) === entry.crc32 && descriptor.readUInt32LE(4) === entry.compressedSize &&
        descriptor.readUInt32LE(8) === entry.uncompressedSize) {
      descriptorLength = 12;
    }
    if (!descriptorLength) {
      fail('unsafe-resource-pack-entry', `${archiveName} contains a forged ZIP data descriptor.`);
    }
    entryEnd += descriptorLength;
  }
  return { ...entry, dataOffset, dataEnd, entryEnd };
}

async function verifyResourcePackEntryData(file, entry, outputState, archiveName) {
  if (entry.name.endsWith('/')) {
    if (entry.compressedSize !== 0 || entry.uncompressedSize !== 0 || entry.crc32 !== 0) {
      fail('unsafe-resource-pack-entry', `${archiveName} contains a directory entry with file data.`);
    }
    return null;
  }
  if ((entry.uncompressedSize > 0 && entry.compressedSize === 0) ||
      entry.uncompressedSize > entry.compressedSize * MAX_RESOURCE_PACK_COMPRESSION_RATIO) {
    fail('resource-pack-compression-ratio', `${archiveName} contains an entry with an unsafe compression ratio.`);
  }
  if (outputState.total + entry.uncompressedSize > MAX_RESOURCE_PACK_UNCOMPRESSED_BYTES) {
    fail('resource-pack-too-large', `${archiveName} expands beyond the resource-pack safety limit.`);
  }
  const captured = entry.name === 'pack.mcmeta' ? [] : null;
  if (entry.compressedSize === 0) {
    if (entry.uncompressedSize !== 0 || entry.crc32 !== 0) {
      fail('resource-pack-entry-mismatch', `${archiveName} contains an empty entry with forged size or checksum metadata.`);
    }
    return captured ? Buffer.alloc(0) : null;
  }
  let entryBytes = 0;
  let crc = 0xffffffff;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      entryBytes += chunk.length;
      if (entryBytes > entry.uncompressedSize) {
        callback(new PendingModError('resource-pack-entry-mismatch', `${archiveName} produced more data than its ZIP entry declares.`));
        return;
      }
      if (outputState.total + chunk.length > MAX_RESOURCE_PACK_UNCOMPRESSED_BYTES) {
        callback(new PendingModError('resource-pack-too-large', `${archiveName} expands beyond the resource-pack safety limit.`));
        return;
      }
      outputState.total += chunk.length;
      crc = updateCrc32(crc, chunk);
      if (captured) captured.push(Buffer.from(chunk));
      callback();
    }
  });
  let inflater = null;
  try {
    const input = fs.createReadStream(file, { start: entry.dataOffset, end: entry.dataEnd - 1 });
    if (entry.compressionMethod === 8) {
      inflater = zlib.createInflateRaw();
      await pipeline(input, inflater, sink);
    } else {
      await pipeline(input, sink);
    }
  } catch (error) {
    if (error instanceof PendingModError) throw error;
    fail('invalid-resource-pack', `${archiveName} contains compressed data that could not be verified.`, {
      entry: entry.name
    }, error);
  }
  if (inflater && Number(inflater.bytesWritten) !== entry.compressedSize) {
    fail('unsafe-resource-pack-entry', `${archiveName} contains trailing or truncated compressed ZIP data.`);
  }
  const actualCrc = (crc ^ 0xffffffff) >>> 0;
  if (entryBytes !== entry.uncompressedSize || actualCrc !== entry.crc32) {
    fail('resource-pack-entry-mismatch', `${archiveName} contains an entry whose real size or checksum does not match its ZIP metadata.`, {
      entry: entry.name,
      expectedSize: entry.uncompressedSize,
      actualSize: entryBytes
    });
  }
  return captured ? Buffer.concat(captured, entryBytes) : null;
}

async function readResourcePackDescriptor(file) {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 22 || stat.size > MAX_ARTIFACT_BYTES) {
    fail('invalid-resource-pack', `${path.basename(file)} is not a safe resource-pack ZIP.`);
  }
  const handle = await fsp.open(file, 'r');
  try {
    const signature = await readExactly(handle, 4, 0);
    if (signature.readUInt32LE(0) !== 0x04034b50) {
      fail('invalid-resource-pack', `${path.basename(file)} is not a valid ZIP archive.`);
    }
    const tailLength = Math.min(stat.size, 65_557);
    const tail = await readExactly(handle, tailLength, stat.size - tailLength);
    const endOffset = findZipEndRecord(tail);
    if (endOffset < 0 || tail.readUInt16LE(endOffset + 4) !== 0 || tail.readUInt16LE(endOffset + 6) !== 0 ||
        tail.readUInt16LE(endOffset + 8) !== tail.readUInt16LE(endOffset + 10)) {
      fail('invalid-resource-pack', `${path.basename(file)} has no supported ZIP directory.`);
    }
    const endRecordAbsoluteOffset = stat.size - tailLength + endOffset;
    const commentLength = tail.readUInt16LE(endOffset + 20);
    if (endRecordAbsoluteOffset + 22 + commentLength !== stat.size) {
      fail('invalid-resource-pack', `${path.basename(file)} has an invalid ZIP end record.`);
    }
    const entryCount = tail.readUInt16LE(endOffset + 10);
    const directorySize = tail.readUInt32LE(endOffset + 12);
    const directoryOffset = tail.readUInt32LE(endOffset + 16);
    if (!entryCount || entryCount === 0xffff || entryCount > MAX_ZIP_ENTRIES || directorySize === 0xffffffff ||
        directorySize > MAX_ZIP_DIRECTORY_BYTES || directoryOffset + directorySize !== endRecordAbsoluteOffset) {
      fail('invalid-resource-pack', `${path.basename(file)} has an unsupported or unsafe ZIP directory.`);
    }
    const directory = await readExactly(handle, directorySize, directoryOffset);
    const names = new Set();
    const centralEntries = [];
    let declaredUncompressed = 0;
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) {
        fail('invalid-resource-pack', `${path.basename(file)} has a damaged ZIP directory.`);
      }
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
      if (!nameLength || nextOffset > directory.length) {
        fail('invalid-resource-pack', `${path.basename(file)} has a damaged ZIP entry.`);
      }
      const name = directory.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      const lowerName = name.toLowerCase();
      const flags = directory.readUInt16LE(offset + 8);
      const compressionMethod = directory.readUInt16LE(offset + 10);
      const crc32 = directory.readUInt32LE(offset + 16);
      const compressedSize = directory.readUInt32LE(offset + 20);
      const uncompressedSize = directory.readUInt32LE(offset + 24);
      const versionMadeBy = directory.readUInt16LE(offset + 4);
      const externalAttributes = directory.readUInt32LE(offset + 38);
      const unixMode = (externalAttributes >>> 16) & 0xffff;
      if (!safeZipEntryName(name) || name.includes('\ufffd') || names.has(lowerName)) {
        fail('unsafe-resource-pack-entry', `${path.basename(file)} contains a duplicate or unsafe ZIP path.`);
      }
      names.add(lowerName);
      if ((flags & 0x41) || ![0, 8].includes(compressionMethod) || compressedSize === 0xffffffff ||
          uncompressedSize === 0xffffffff || ((versionMadeBy >>> 8) === 3 && (unixMode & 0xf000) === 0xa000)) {
        fail('unsafe-resource-pack-entry', `${path.basename(file)} contains an unsupported or linked ZIP entry.`);
      }
      declaredUncompressed += uncompressedSize;
      if (!Number.isSafeInteger(declaredUncompressed) || declaredUncompressed > MAX_RESOURCE_PACK_UNCOMPRESSED_BYTES) {
        fail('resource-pack-too-large', `${path.basename(file)} expands beyond the resource-pack safety limit.`);
      }
      centralEntries.push({
        name,
        flags,
        compressionMethod,
        crc32,
        compressedSize,
        uncompressedSize,
        localOffset: directory.readUInt32LE(offset + 42)
      });
      offset = nextOffset;
    }
    if (offset !== directory.length) {
      fail('invalid-resource-pack', `${path.basename(file)} has unexpected data in its ZIP directory.`);
    }
    if (!centralEntries.some(entry => entry.name === 'pack.mcmeta')) {
      fail('invalid-resource-pack', `${path.basename(file)} has no root pack.mcmeta file.`);
    }
    const descriptorEntry = centralEntries.find(entry => entry.name === 'pack.mcmeta');
    if (descriptorEntry.compressedSize > MAX_DESCRIPTOR_BYTES || descriptorEntry.uncompressedSize > MAX_DESCRIPTOR_BYTES) {
      fail('invalid-resource-pack', `${path.basename(file)} has an oversized pack.mcmeta file.`);
    }
    const entries = [];
    for (const entry of centralEntries) {
      entries.push(await inspectResourcePackLocalEntry(handle, entry, directoryOffset, path.basename(file)));
    }
    const ranges = [...entries].sort((left, right) => left.localOffset - right.localOffset);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index - 1].entryEnd > ranges[index].localOffset) {
        fail('unsafe-resource-pack-entry', `${path.basename(file)} contains overlapping ZIP entries.`);
      }
    }
    const outputState = { total: 0 };
    let metadataBytes = null;
    for (const entry of entries) {
      const captured = await verifyResourcePackEntryData(file, entry, outputState, path.basename(file));
      if (entry.name === 'pack.mcmeta') metadataBytes = captured;
    }
    if (!metadataBytes) {
      fail('invalid-resource-pack', `${path.basename(file)} has no readable root pack.mcmeta file.`);
    }
    let metadata;
    try {
      metadata = JSON.parse(metadataBytes.toString('utf8'));
    } catch (error) {
      fail('invalid-resource-pack', `${path.basename(file)} has invalid pack.mcmeta JSON.`, {}, error);
    }
    const legacyPackFormat = metadata?.pack?.pack_format;
    const minimumFormat = Number(metadata?.pack?.min_format ?? legacyPackFormat);
    const maximumFormat = Number(metadata?.pack?.max_format ?? legacyPackFormat);
    if (!Number.isSafeInteger(minimumFormat) || !Number.isSafeInteger(maximumFormat) ||
        minimumFormat <= 0 || maximumFormat < minimumFormat || maximumFormat > 10_000) {
      fail('invalid-resource-pack', `${path.basename(file)} has an invalid pack format or format range.`);
    }
    return {
      packFormat: Number.isSafeInteger(Number(legacyPackFormat)) ? Number(legacyPackFormat) : null,
      minFormat: minimumFormat,
      maxFormat: maximumFormat,
      supportedFormats: metadata?.pack?.supported_formats ?? null,
      entryCount,
      uncompressedBytes: outputState.total
    };
  } finally {
    await handle.close();
  }
}

async function assertArtifactDescriptor(file, artifact) {
  if (artifactType(artifact) === 'resource-pack') {
    const descriptor = await readResourcePackDescriptor(file);
    if (descriptor.minFormat !== artifact.resourcePack.minFormat ||
        descriptor.maxFormat !== artifact.resourcePack.maxFormat) {
      fail('artifact-identity-mismatch', `${artifact.title} has an unexpected pack.mcmeta format range and was not trusted.`, {
        artifactKey: artifact.key,
        expectedFormatRange: [artifact.resourcePack.minFormat, artifact.resourcePack.maxFormat],
        actualFormatRange: [descriptor.minFormat, descriptor.maxFormat]
      });
    }
    return {
      id: artifact.resourcePackId.toLowerCase(),
      version: String(artifact.version || '').slice(0, 160),
      environment: 'client',
      packFormat: descriptor.packFormat,
      minFormat: descriptor.minFormat,
      maxFormat: descriptor.maxFormat,
      supportedFormats: descriptor.supportedFormats
    };
  }
  const descriptor = await readFabricModDescriptor(file);
  if (descriptor.id !== artifact.modId.toLowerCase()) {
    fail('artifact-identity-mismatch', `${artifact.title} declared an unexpected Fabric mod id and was not trusted.`, {
      artifactKey: artifact.key,
      expectedModId: artifact.modId,
      actualModId: descriptor.id
    });
  }
  if (artifact.installTarget === 'client-optional' && descriptor.environment !== 'client') {
    fail('artifact-environment-mismatch', `${artifact.title} was expected to be client-only, but its JAR metadata says otherwise.`);
  }
  if (artifact.installTarget === 'server' && descriptor.environment === 'client') {
    fail('artifact-environment-mismatch', `${artifact.title} is client-only according to its Fabric metadata and cannot be queued or applied as a server mod.`);
  }
  return descriptor;
}

function validateDownloadUrl(url, allowedDownloadHosts) {
  const parsed = new URL(url);
  const hosts = new Set((allowedDownloadHosts || DEFAULT_DOWNLOAD_HOSTS).map(host => String(host).toLowerCase()));
  if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) {
    fail('download-not-allowed', 'The mod download was redirected outside the approved Modrinth CDN.');
  }
  return parsed;
}

async function requestDownload(url, { allowedDownloadHosts, redirectsRemaining = 3, timeoutMs = 30_000 } = {}) {
  const parsed = validateDownloadUrl(url, allowedDownloadHosts);
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      headers: {
        'User-Agent': 'ClickInterval-PendingMods/1.0',
        Accept: 'application/java-archive, application/octet-stream;q=0.9'
      }
    }, response => {
      const status = Number(response.statusCode) || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new PendingModError('download-failed', 'A mod download used too many redirects.'));
          return;
        }
        let redirected;
        try {
          redirected = new URL(response.headers.location, parsed).toString();
          validateDownloadUrl(redirected, allowedDownloadHosts);
        } catch (error) {
          reject(error instanceof PendingModError ? error : new PendingModError('download-failed', 'A mod download redirect was invalid.', {}, error));
          return;
        }
        requestDownload(redirected, { allowedDownloadHosts, redirectsRemaining: redirectsRemaining - 1, timeoutMs }).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new PendingModError('download-failed', `Modrinth returned HTTP ${status || 'error'} while downloading a mod.`));
        return;
      }
      resolve(response);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('The download timed out.')));
    request.once('error', error => reject(new PendingModError('download-failed', 'A mod could not be downloaded from Modrinth. Check the connection and try again.', {}, error)));
  });
}

async function downloadArtifact(artifact, destination, options = {}) {
  const response = await requestDownload(artifact.url, options);
  const declaredLength = Number(response.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > 0 && declaredLength !== artifact.size) {
    response.destroy();
    fail('download-size-mismatch', `${artifact.title} did not match the size advertised by Modrinth.`);
  }
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > artifact.size || received > MAX_ARTIFACT_BYTES) {
        callback(new PendingModError('download-too-large', `${artifact.title} exceeded its declared download size.`));
        return;
      }
      callback(null, chunk);
    }
  });
  await pipeline(response, limiter, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  const handle = await fsp.open(destination, 'r');
  try {
    await syncHandleBestEffort(handle);
  } finally {
    await handle.close();
  }
}

function artifactPendingPath(paths, artifact) {
  return containedPath(paths.queueFiles, artifact.installTarget, safeArtifactFilename(artifact));
}

async function quarantinePendingFile(paths, file) {
  const quarantine = containedPath(paths.queueRoot, 'quarantine');
  await ensurePlainDirectory(quarantine, { create: true });
  const target = containedPath(quarantine, `${path.basename(file)}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.untrusted`);
  await fsp.rename(file, target);
  return target;
}

function boundedPositiveInteger(value, fallback, maximum, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    fail('invalid-backup-limit', `${name} must be a positive integer no larger than ${maximum}.`);
  }
  return number;
}

function normalizeWorldBackupLimits(options = {}) {
  return {
    maxBytes: boundedPositiveInteger(options.maxBytes, DEFAULT_WORLD_BACKUP_MAX_BYTES, ABSOLUTE_WORLD_BACKUP_MAX_BYTES, 'World backup byte limit'),
    maxEntries: boundedPositiveInteger(options.maxEntries, DEFAULT_WORLD_BACKUP_MAX_ENTRIES, ABSOLUTE_WORLD_BACKUP_MAX_ENTRIES, 'World backup entry limit'),
    diskReserveBytes: boundedPositiveInteger(
      options.diskReserveBytes,
      DEFAULT_WORLD_BACKUP_DISK_RESERVE_BYTES,
      16 * 1024 * 1024 * 1024,
      'World backup disk reserve'
    )
  };
}

async function resolveWorldDirectory(paths) {
  const config = await readJsonFile(paths.config);
  if (!config) fail('server-config-missing', 'The server configuration is missing, so the world cannot be backed up safely.');
  const levelName = String(config.levelName || '').trim();
  if (!levelName || levelName.length > 160 || levelName.includes('\0')) {
    fail('unsafe-world-path', 'The server world name is missing or unsafe, so Lootr was not applied.');
  }
  const world = containedPath(paths.root, ...levelName.replace(/\\/g, '/').split('/'));
  if (normalizedPathForComparison(world) === normalizedPathForComparison(paths.root) ||
      normalizedPathForComparison(world) === normalizedPathForComparison(paths.pendingRoot) ||
      normalizedPathForComparison(world) === normalizedPathForComparison(paths.mods)) {
    fail('unsafe-world-path', 'The configured world folder overlaps a managed server folder, so Lootr was not applied.');
  }
  return { config, levelName, world };
}

async function inventoryWorldDirectory(world, limits) {
  let rootStat;
  try {
    rootStat = await fsp.lstat(world);
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, entries: [], bytes: 0, entryCount: 0 };
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail('unsafe-world-path', 'The configured world is not a normal directory, so Lootr was not applied.');
  }
  const entries = [];
  const pending = [{ absolute: world, relative: '' }];
  let bytes = 0;
  let entryCount = 0;
  while (pending.length) {
    const directory = pending.pop();
    const children = await fsp.readdir(directory.absolute, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = containedPath(world, directory.relative, child.name);
      const relative = path.join(directory.relative, child.name);
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) {
        fail('unsafe-world-entry', `The world contains a linked entry (${relative}); no backup or mod change was made.`);
      }
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        fail('world-backup-too-large', `The world has more than ${limits.maxEntries.toLocaleString()} entries. Increase the explicit backup limit or back it up separately before applying Lootr.`, {
          entryCount,
          maxEntries: limits.maxEntries
        });
      }
      if (stat.isDirectory()) {
        entries.push({ type: 'directory', absolute, relative, size: 0, mtimeMs: stat.mtimeMs });
        pending.push({ absolute, relative });
      } else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > limits.maxBytes) {
          fail('world-backup-too-large', `The world is larger than the ${(limits.maxBytes / 1024 / 1024 / 1024).toFixed(1)} GiB backup limit. Increase the explicit limit or back it up separately before applying Lootr.`, {
            bytes,
            maxBytes: limits.maxBytes
          });
        }
        entries.push({ type: 'file', absolute, relative, size: stat.size, mtimeMs: stat.mtimeMs });
      } else {
        fail('unsafe-world-entry', `The world contains an unsupported filesystem entry (${relative}); no backup or mod change was made.`);
      }
    }
  }
  return { exists: true, entries, bytes, entryCount };
}

async function assertWorldBackupDiskSpace(profileRoot, requiredBytes, reserveBytes) {
  if (typeof fsp.statfs !== 'function') return;
  try {
    const stats = await fsp.statfs(profileRoot, { bigint: true });
    const available = stats.bavail * stats.bsize;
    const required = BigInt(requiredBytes) + BigInt(reserveBytes);
    if (available < required) {
      fail('world-backup-disk-space', 'There is not enough free disk space to create the required world backup, so Lootr was not applied.', {
        requiredBytes: required.toString(),
        availableBytes: available.toString()
      });
    }
  } catch (error) {
    if (error instanceof PendingModError) throw error;
    // Some filesystems do not expose statfs. Copy limits and COPYFILE_EXCL
    // still fail closed if the destination cannot be completed.
  }
}

async function createBoundedWorldBackup({
  profileRoot,
  serverStopped = false,
  reasons = [],
  limits: requestedLimits = {}
} = {}) {
  if (serverStopped !== true) {
    fail('server-must-be-stopped', 'Stop the Minecraft server and wait for it to finish before backing up its world.');
  }
  const paths = profilePaths(profileRoot);
  await ensurePlainDirectory(paths.root);
  await ensurePlainDirectory(paths.pendingRoot, { create: true });
  const limits = normalizeWorldBackupLimits(requestedLimits);
  const { levelName, world } = await resolveWorldDirectory(paths);
  const inventory = await inventoryWorldDirectory(world, limits);
  await assertWorldBackupDiskSpace(paths.root, inventory.bytes, limits.diskReserveBytes);

  const backupsRoot = containedPath(paths.pendingRoot, 'world-backups');
  await ensurePlainDirectory(backupsRoot, { create: true });
  const backupId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(6).toString('hex')}`;
  const incomplete = containedPath(backupsRoot, `${backupId}.incomplete`);
  const completed = containedPath(backupsRoot, backupId);
  const worldCopy = containedPath(incomplete, 'world');
  await fsp.mkdir(incomplete, { recursive: false });
  const verifiedFiles = [];
  try {
    if (inventory.exists) {
      await fsp.mkdir(worldCopy, { recursive: false });
      const directories = inventory.entries
        .filter(entry => entry.type === 'directory')
        .sort((left, right) => left.relative.split(path.sep).length - right.relative.split(path.sep).length);
      for (const entry of directories) await fsp.mkdir(containedPath(worldCopy, entry.relative), { recursive: false });
      for (const entry of inventory.entries.filter(candidate => candidate.type === 'file')) {
        const current = await fsp.lstat(entry.absolute);
        if (!current.isFile() || current.isSymbolicLink() || current.size !== entry.size || current.mtimeMs !== entry.mtimeMs) {
          fail('world-changed-during-backup', `The world changed while ${entry.relative} was being backed up. Lootr was not applied.`);
        }
        const destination = containedPath(worldCopy, entry.relative);
        await fsp.copyFile(entry.absolute, destination, fs.constants.COPYFILE_EXCL);
        const copied = await fsp.lstat(destination);
        if (!copied.isFile() || copied.size !== entry.size) {
          fail('world-backup-incomplete', `The backup copy of ${entry.relative} could not be verified. Lootr was not applied.`);
        }
        const checksum = async file => {
          const hasher = crypto.createHash('sha256');
          for await (const chunk of fs.createReadStream(file)) hasher.update(chunk);
          return hasher.digest('hex');
        };
        const [originalHash, copiedHash] = await Promise.all([checksum(entry.absolute), checksum(destination)]);
        const after = await fsp.lstat(entry.absolute);
        if (originalHash !== copiedHash || !after.isFile() || after.isSymbolicLink() ||
            after.size !== entry.size || after.mtimeMs !== entry.mtimeMs) {
          fail('world-backup-incomplete', `The backup checksum of ${entry.relative} did not match. No mod change was made.`);
        }
        verifiedFiles.push({ path: entry.relative.replace(/\\/g, '/'), size: entry.size, sha256: originalHash });
      }
    }
    const metadata = {
      schemaVersion: 1,
      id: backupId,
      createdAt: new Date().toISOString(),
      worldName: levelName,
      worldRelative: inventory.exists ? relativePortable(paths.root, world) : '',
      worldPresent: inventory.exists,
      bytes: inventory.bytes,
      entries: inventory.entryCount,
      verification: { algorithm: 'sha256', files: verifiedFiles },
      reasons: [...new Set((reasons || []).map(String).filter(Boolean))].slice(0, 32),
      limits
    };
    await writeJsonAtomic(containedPath(incomplete, 'world-backup.json'), metadata);
    await fsp.rename(incomplete, completed);
    return {
      ok: true,
      id: backupId,
      path: completed,
      relativePath: relativePortable(paths.root, completed),
      worldPresent: inventory.exists,
      bytes: inventory.bytes,
      entries: inventory.entryCount,
      message: inventory.exists
        ? `World backup completed (${inventory.entryCount.toLocaleString()} entries, ${(inventory.bytes / 1024 / 1024).toFixed(1)} MiB).`
        : 'The profile has no generated world yet; an explicit empty-world backup record was created.'
    };
  } catch (error) {
    const failure = {
      failedAt: new Date().toISOString(),
      error: friendlyPendingModError(error),
      worldName: levelName,
      plannedBytes: inventory.bytes,
      plannedEntries: inventory.entryCount
    };
    await writeJsonAtomic(containedPath(incomplete, 'backup-failed.json'), failure).catch(() => {});
    throw error;
  }
}

async function queuePendingMods({
  profileRoot,
  manifestPath,
  includeClientOptional = false,
  includeOptionalServer = false,
  optionalServerKeys = [],
  clientBundleKeys = [],
  downloadFile = downloadArtifact,
  allowedDownloadHosts = DEFAULT_DOWNLOAD_HOSTS
} = {}) {
  const loaded = await loadManifest(manifestPath, { allowedDownloadHosts });
  const { manifest, digest } = loaded;
  const { paths } = await verifyProfileTarget(profileRoot, manifest.target);
  const scopedPaths = profilePaths(paths.root, manifest.id);
  await ensurePlainDirectory(scopedPaths.pendingRoot, { create: true });
  await ensurePlainDirectory(containedPath(scopedPaths.pendingRoot, QUEUES_DIRECTORY), { create: true });
  await ensurePlainDirectory(scopedPaths.queueRoot, { create: true });
  await ensurePlainDirectory(scopedPaths.queueFiles, { create: true });
  const selected = selectManifestArtifacts(manifest, {
    includeClientOptional, includeOptionalServer, optionalServerKeys, clientBundleKeys
  });
  const state = {
    schemaVersion: 1,
    manifestId: manifest.id,
    manifestDigest: digest,
    target: manifest.target,
    status: 'downloading',
    includeClientOptional: Boolean(includeClientOptional),
    includeOptionalServer: Boolean(includeOptionalServer),
    optionalServerKeys: [...new Set((optionalServerKeys || []).map(String))],
    clientBundleKeys: [...new Set((clientBundleKeys || []).map(String))],
    updatedAt: new Date().toISOString(),
    artifacts: []
  };

  return withLock(containedPath(scopedPaths.queueRoot, 'download.lock'), async () => {
    await writeJsonAtomic(scopedPaths.queueManifest, manifest);
    await writeJsonAtomic(scopedPaths.queueState, state);
    const failures = [];
    for (const artifact of selected) {
      try {
        const destination = artifactPendingPath(scopedPaths, artifact);
        await ensurePlainDirectory(path.dirname(destination), { create: true });
        let reused = false;
        try {
          await verifyArtifactFile(destination, artifact);
          await assertArtifactDescriptor(destination, artifact);
          reused = true;
        } catch (error) {
          if (error?.code !== 'ENOENT' && error?.code !== 'pending-file-missing') {
            let exists = false;
            try {
              exists = (await fsp.lstat(destination)).isFile();
            } catch (statError) {
              if (statError?.code !== 'ENOENT') throw statError;
            }
            if (exists) await quarantinePendingFile(scopedPaths, destination);
          }
        }
        if (!reused) {
          const temporary = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.part`;
          try {
            await downloadFile(artifact, temporary, { allowedDownloadHosts });
            await verifyArtifactFile(temporary, artifact);
            await assertArtifactDescriptor(temporary, artifact);
            await moveFileNoReplace(temporary, destination);
          } finally {
            await fsp.rm(temporary, { force: true }).catch(() => {});
          }
        }
        const verified = await verifyArtifactFile(destination, artifact);
        const descriptor = await assertArtifactDescriptor(destination, artifact);
        state.artifacts.push({
          key: artifact.key,
          title: artifact.title,
          filename: artifact.filename,
          installTarget: artifact.installTarget,
          clientRequired: artifact.clientRequired,
          serverOnly: artifact.serverOnly,
          status: reused ? 'verified-existing' : 'downloaded-and-verified',
          size: verified.size,
          hashes: verified.hashes,
          artifactType: artifactType(artifact),
          identity: descriptor.id,
          modId: artifactType(artifact) === 'fabric-mod' ? descriptor.id : undefined,
          resourcePackId: artifactType(artifact) === 'resource-pack' ? descriptor.id : undefined,
          version: descriptor.version
        });
      } catch (error) {
        const friendly = friendlyPendingModError(error);
        state.artifacts.push({
          key: artifact.key,
          title: artifact.title,
          filename: artifact.filename,
          installTarget: artifact.installTarget,
          clientRequired: artifact.clientRequired,
          serverOnly: artifact.serverOnly,
          status: 'failed',
          artifactType: artifactType(artifact),
          error: friendly
        });
        failures.push({ artifact, error, friendly });
      }
      state.updatedAt = new Date().toISOString();
      await writeJsonAtomic(scopedPaths.queueState, state);
    }
    const verifiedArtifacts = state.artifacts.filter(item => item.status !== 'failed');
    state.status = failures.length ? (verifiedArtifacts.length ? 'partial' : 'failed') : 'ready';
    if (failures.length) {
      state.error = {
        code: 'queue-incomplete',
        message: `${failures.length} selected artifact${failures.length === 1 ? '' : 's'} could not be downloaded and verified.`,
        details: {
          failedArtifacts: failures.map(item => ({ key: item.artifact.key, error: item.friendly }))
        }
      };
    }
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(scopedPaths.queueState, state);
    const serverCount = verifiedArtifacts.filter(item => item.installTarget === 'server').length;
    const optionalServerCount = verifiedArtifacts.filter(item => item.installTarget === 'server' &&
      manifest.artifacts.find(artifact => artifact.key === item.key)?.optional === true).length;
    const defaultServerCount = serverCount - optionalServerCount;
    const clientModCount = verifiedArtifacts.filter(item => item.installTarget === 'client-optional').length;
    const resourcePackCount = verifiedArtifacts.filter(item => item.installTarget === 'client-resource-pack').length;
    const clientCount = clientModCount + resourcePackCount;
    if (failures.length) {
      const first = failures[0].error;
      if (first instanceof PendingModError) {
        first.details = {
          ...first.details,
          failedArtifacts: failures.map(item => ({ key: item.artifact.key, error: item.friendly }))
        };
      }
      throw first;
    }
    return {
      ok: true,
      state: 'ready',
      manifestId: manifest.id,
      queueRoot: scopedPaths.queueRoot,
      serverCount,
      defaultServerCount,
      optionalServerCount,
      clientOptionalCount: clientCount,
      clientModCount,
      clientResourcePackCount: resourcePackCount,
      message: `${defaultServerCount} default server mod${defaultServerCount === 1 ? '' : 's'} verified and ready for the next stopped-server start${optionalServerCount ? `; ${optionalServerCount} optional server mod${optionalServerCount === 1 ? '' : 's'} downloaded but not selected` : ''}${clientCount ? `; ${clientCount} optional client file${clientCount === 1 ? '' : 's'} packaged separately` : ''}.`
    };
  });
}

async function getPendingModQueueStatus({
  profileRoot,
  manifestPath,
  includeClientOptional = false,
  includeOptionalServer = false,
  optionalServerKeys = [],
  clientBundleKeys = []
} = {}) {
  const loaded = await loadManifest(manifestPath);
  const { manifest, digest } = loaded;
  let paths;
  try {
    ({ paths } = await verifyProfileTarget(profileRoot, manifest.target));
  } catch (error) {
    const friendly = friendlyPendingModError(error);
    return { ok: false, state: 'blocked', ...friendly };
  }
  const scopedPaths = profilePaths(paths.root, manifest.id);
  const state = await readJsonFile(scopedPaths.queueState).catch(() => null);
  if (!queueStateMatchesManifest(state, manifest, digest)) {
    return {
      ok: false,
      state: 'not-downloaded',
      code: 'queue-not-ready',
      message: 'These mods have not been downloaded and verified for this manifest yet.'
    };
  }
  const selected = selectManifestArtifacts(manifest, {
    includeClientOptional, includeOptionalServer, optionalServerKeys, clientBundleKeys
  });
  const artifacts = [];
  for (const artifact of selected) {
    try {
      const file = artifactPendingPath(scopedPaths, artifact);
      await verifyArtifactFile(file, artifact);
      await assertArtifactDescriptor(file, artifact);
      artifacts.push({ key: artifact.key, title: artifact.title, status: 'ready', installTarget: artifact.installTarget });
    } catch (error) {
      artifacts.push({
        key: artifact.key,
        title: artifact.title,
        status: 'blocked',
        installTarget: artifact.installTarget,
        error: friendlyPendingModError(error)
      });
    }
  }
  const blocked = artifacts.filter(item => item.status !== 'ready');
  const serverCount = artifacts.filter(item => item.status === 'ready' && item.installTarget === 'server').length;
  const optionalServerCount = artifacts.filter(item => item.status === 'ready' && item.installTarget === 'server' &&
    manifest.artifacts.find(artifact => artifact.key === item.key)?.optional === true).length;
  const defaultServerCount = serverCount - optionalServerCount;
  const clientModCount = artifacts.filter(item => item.status === 'ready' && item.installTarget === 'client-optional').length;
  const resourcePackCount = artifacts.filter(item => item.status === 'ready' && item.installTarget === 'client-resource-pack').length;
  const clientCount = clientModCount + resourcePackCount;
  if (blocked.length) {
    const blockedServerCount = blocked.filter(item => item.installTarget === 'server').length;
    const blockedClientCount = blocked.length - blockedServerCount;
    return {
      ok: false,
      state: 'partial',
      code: 'queue-incomplete',
      message: blockedServerCount
        ? `${blockedServerCount} selected server mod file${blockedServerCount === 1 ? ' is' : 's are'} missing or untrusted. Download the queue again before starting the server.`
        : `Required server files are ready, but ${blockedClientCount} selected client file${blockedClientCount === 1 ? ' is' : 's are'} missing or untrusted. Download that client bundle again before exporting it.`,
      artifacts,
      serverReady: blockedServerCount === 0,
      serverCount,
      defaultServerCount,
      optionalServerCount,
      clientOptionalCount: clientCount,
      clientModCount,
      clientResourcePackCount: resourcePackCount
    };
  }
  return {
    ok: true,
    state: 'ready',
    message: `${defaultServerCount} default server mod${defaultServerCount === 1 ? ' is' : 's are'} verified and ready${optionalServerCount ? `; ${optionalServerCount} optional server mod${optionalServerCount === 1 ? ' is' : 's are'} downloaded but not selected` : ''}${clientCount ? `; ${clientCount} optional client file${clientCount === 1 ? ' is' : 's are'} packaged separately` : ''}.`,
    artifacts,
    serverReady: true,
    serverCount,
    defaultServerCount,
    optionalServerCount,
    clientOptionalCount: clientCount,
    clientModCount,
    clientResourcePackCount: resourcePackCount
  };
}

function pathIsAtOrInside(parent, candidate) {
  const base = normalizedPathForComparison(parent);
  const target = normalizedPathForComparison(candidate);
  if (base === target) return true;
  const relative = path.relative(base, target);
  return Boolean(relative) && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function selectedClientBundleDefinitions(manifest, includeClientOptional, clientBundleKeys) {
  const requested = new Set((clientBundleKeys || []).map(value => String(value).toLowerCase()));
  return (manifest.clientBundles || []).filter(bundle => bundle.available === true &&
    (requested.has(String(bundle.key).toLowerCase()) || includeClientOptional));
}

function clientBundleVariant(selectedBundles, includeClientOptional) {
  if (!selectedBundles.length) return includeClientOptional ? 'optional-client-content' : 'required-client-content';
  const suffix = selectedBundles.map(bundle => safeId(bundle.key, 'client bundle key').toLowerCase()).sort().join('-');
  if (suffix.length <= 96) return `client-${suffix}`;
  return `client-${crypto.createHash('sha256').update(suffix).digest('hex').slice(0, 16)}`;
}

function resolveClientBundleDestination(paths, manifest, destinationDirectory, includeClientOptional, selectedBundles) {
  const variant = clientBundleVariant(selectedBundles, includeClientOptional);
  let destination;
  if (destinationDirectory === undefined || destinationDirectory === null || String(destinationDirectory).trim() === '') {
    destination = containedPath(paths.pendingRoot, 'client-exports', manifest.id, variant);
  } else {
    const input = String(destinationDirectory).trim();
    if (!path.isAbsolute(input)) fail('invalid-export-path', 'Choose an absolute folder for the client mod bundle.');
    destination = path.resolve(input);
  }
  const parsed = path.parse(destination);
  if (destination === parsed.root || !path.basename(destination)) {
    fail('invalid-export-path', 'The client bundle cannot use a drive or filesystem root as its destination.');
  }
  if (pathIsAtOrInside(paths.mods, destination) || pathIsAtOrInside(destination, paths.mods)) {
    fail('unsafe-export-path', 'The client bundle destination cannot be the server mods folder or contain it.');
  }
  if (normalizedPathForComparison(destination) === normalizedPathForComparison(paths.root)) {
    fail('unsafe-export-path', 'The client bundle destination cannot be the server profile root.');
  }
  return { destination, variant };
}

async function verifyExistingClientBundle({ destination, bundleManifest, selected }) {
  let stat;
  try {
    stat = await fsp.lstat(destination);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('client-bundle-conflict', 'The client bundle destination already exists and is not a normal bundle folder.');
  }
  const byFolder = new Map();
  const included = selected.filter(item => artifactPortableExportMode(item.artifact) === 'include');
  for (const item of included) {
    const folder = artifactClientFolder(item.artifact);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(item);
  }
  const expectedTopLevel = ['README.txt', 'client-bundle.json', ...byFolder.keys()].sort();
  const actualTopLevel = (await fsp.readdir(destination, { withFileTypes: true }))
    .map(entry => entry.name).sort();
  if (JSON.stringify(actualTopLevel) !== JSON.stringify(expectedTopLevel)) {
    fail('client-bundle-conflict', 'The existing client bundle has unexpected top-level files. Choose another folder; nothing was overwritten.');
  }
  const manifestFile = containedPath(destination, 'client-bundle.json');
  const readmeFile = containedPath(destination, 'README.txt');
  let stored;
  try {
    stored = JSON.parse((await readPlainRegularFile(
      manifestFile, MAX_MANIFEST_BYTES, 'client-bundle-conflict', 'client-bundle.json')).toString('utf8'));
  } catch (error) {
    if (error instanceof PendingModError && error.code === 'client-bundle-conflict') throw error;
    fail('client-bundle-conflict', 'The existing client-bundle.json is invalid or was changed.', {}, error);
  }
  if (!stored || canonicalJson(stored) !== canonicalJson(bundleManifest)) {
    fail('client-bundle-conflict', 'The existing client-bundle.json does not exactly match the requested verified bundle. Nothing was overwritten.');
  }
  const actualReadme = (await readPlainRegularFile(
    readmeFile, MAX_MANIFEST_BYTES, 'client-bundle-conflict', 'README.txt')).toString('utf8');
  if (actualReadme !== renderClientBundleReadme(bundleManifest)) {
    fail('client-bundle-conflict', 'The existing README.txt was changed. Nothing was overwritten.');
  }
  for (const [folder, items] of byFolder) {
    const directory = containedPath(destination, folder);
    await ensurePlainDirectory(directory);
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    if (entries.some(entry => !entry.isFile() || entry.isSymbolicLink())) {
      fail('client-bundle-conflict', `The existing client bundle has unsafe entries in ${folder}.`);
    }
    const actualNames = entries.map(entry => entry.name.toLowerCase()).sort();
    const expectedNames = items.map(item => item.artifact.filename.toLowerCase()).sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      fail('client-bundle-conflict', `The existing client bundle has missing, duplicate, or extra files in ${folder}.`);
    }
  }
  for (const item of included) {
    const file = containedPath(destination, artifactClientFolder(item.artifact), item.artifact.filename);
    await verifyArtifactFile(file, item.artifact);
    await assertArtifactDescriptor(file, item.artifact);
  }
  return true;
}

function renderClientBundleReadme(bundleManifest) {
  const artifactLines = bundleManifest.artifacts.filter(item => item.bundled).map(item =>
    `- ${item.title}: ${item.targetFolder}/${item.filename}${item.clientRequired ? ' (required for this server)' : ' (optional client content)'}`);
  const referenceLines = bundleManifest.artifacts.filter(item => !item.bundled).flatMap(item => [
    `- ${item.title} ${item.version}: download ${item.url}`,
    `  Save as ${item.targetFolder}/${item.filename}; size ${item.size} bytes; SHA-1 ${item.hashes.sha1};${item.hashes.sha256 ? ` SHA-256 ${item.hashes.sha256};` : ''} SHA-512 ${item.hashes.sha512}.`,
    item.license?.id || item.distribution?.notice
      ? `  ${item.license?.id ? `License: ${item.license.id}. ` : ''}${item.distribution?.notice || ''}`.trimEnd()
      : ''
  ].filter(Boolean));
  const resourcePackLines = bundleManifest.artifacts
    .filter(item => item.artifactType === 'resource-pack')
    .map(item => item.bundled
      ? `- ${item.title} came from ${item.url}. Keep the ZIP intact. Do not rehost or redistribute it; its official source is ${item.sourcePage}.`
      : `- ${item.title} must be downloaded directly from ${item.url}. Keep the ZIP intact. Do not rehost or redistribute it; its official source is ${item.sourcePage}.`);
  const dependencyLines = bundleManifest.externalDependencies.map(item =>
    `- ${item.title} ${item.version}: install ${item.filename} from ${item.url}`);
  const target = `${bundleManifest.target.loader === 'fabric' ? 'Fabric' : bundleManifest.target.loader} ${bundleManifest.target.minecraftVersion}`;
  const hasFreshAnimations = bundleManifest.artifacts.some(item => item.resourcePackId === 'fresh-animations');
  return [
    `Click Interval ${target} optional client bundle`,
    '',
    `This bundle is only compatible with ${target}.`,
    `Copy every JAR in mods into this player\'s ${target} mods folder.`,
    'Copy every ZIP in resourcepacks into this player\'s resourcepacks folder without extracting it.',
    'Never copy anything from this bundle into the Minecraft server mods folder.',
    '',
    'Included files:',
    ...(artifactLines.length ? artifactLines : ['- None']),
    '',
    'Verified files to download directly (not bundled or rehosted):',
    ...(referenceLines.length ? referenceLines : ['- None']),
    '',
    'Required files not bundled:',
    ...(dependencyLines.length ? dependencyLines : ['- None']),
    '',
    'All included files were verified against the hashes in client-bundle.json.',
    '',
    'Resource-pack source and redistribution notice:',
    ...(resourcePackLines.length ? resourcePackLines : ['- No resource packs are selected.']),
    ...(hasFreshAnimations ? [
      '',
      'Fresh Animations activation:',
      '- Install the exact EMF and ETF JARs listed above, then fully restart the Minecraft client.',
      '- Open Options > Resource Packs and enable Fresh Animations; copying or downloading the ZIP alone does not activate it.',
      '- If you install Fresh Animations extension packs separately, place each extension above the base Fresh Animations pack.'
    ] : [])
  ].join('\n') + '\n';
}

async function exportClientModBundle({
  profileRoot,
  manifestPath,
  destinationDirectory,
  includeClientOptional = false,
  clientBundleKeys = []
} = {}) {
  const loaded = await loadManifest(manifestPath);
  const { manifest, digest } = loaded;
  const verifiedProfile = await verifyProfileTarget(profileRoot, manifest.target);
  const paths = profilePaths(verifiedProfile.paths.root, manifest.id);
  const artifacts = selectManifestArtifacts(manifest, { includeClientOptional, clientBundleKeys })
    .filter(artifact => artifact.clientRequired === true ||
      ['client-optional', 'client-resource-pack'].includes(artifact.installTarget));
  const selectedBundles = selectedClientBundleDefinitions(manifest, includeClientOptional, clientBundleKeys);
  const queueState = await readJsonFile(paths.queueState);
  if (!queueStateMatchesManifest(queueState, manifest, digest) ||
      !['ready', 'partial', 'failed', 'applied'].includes(queueState.status)) {
    fail('queue-not-ready', 'Download and verify the pending mods before exporting a client bundle.');
  }
  if (!artifacts.length) fail('client-bundle-empty', 'This manifest has no client mod files to export.');
  const selected = [];
  for (const artifact of artifacts) {
    const file = artifactPendingPath(paths, artifact);
    await verifyArtifactFile(file, artifact);
    const descriptor = await assertArtifactDescriptor(file, artifact);
    selected.push({ artifact, file, descriptor });
  }
  const { destination, variant } = resolveClientBundleDestination(
    paths, manifest, destinationDirectory, includeClientOptional, selectedBundles);
  const externalDependencies = (manifest.clientExternalDependencies || []).map(dependency => ({
    modId: dependency.modId,
    title: dependency.title,
    projectId: dependency.projectId,
    versionId: dependency.versionId,
    version: dependency.version,
    filename: dependency.filename,
    url: dependency.url,
    size: dependency.size,
    hashes: dependency.hashes,
    bundled: false,
    required: true,
    reason: dependency.reason || ''
  }));
  const bundleManifest = {
    schemaVersion: 1,
    type: 'fabric-client-mod-bundle',
    id: `${manifest.id}-${variant}`,
    variant,
    target: manifest.target,
    sourceManifest: { id: manifest.id, digest },
    includeClientOptional: Boolean(includeClientOptional),
    selectedClientBundles: selectedBundles.map(bundle => ({
      key: bundle.key,
      title: bundle.title,
      target: bundle.target,
      artifactKeys: [...bundle.artifactKeys]
    })),
    artifacts: selected.map(item => ({
      key: item.artifact.key,
      title: item.artifact.title,
      projectId: item.artifact.projectId,
      versionId: item.artifact.versionId,
      version: item.artifact.version,
      releaseType: item.artifact.releaseType,
      sourcePage: item.artifact.sourcePage,
      url: item.artifact.url,
      filename: item.artifact.filename,
      artifactType: artifactType(item.artifact),
      targetFolder: artifactClientFolder(item.artifact),
      size: item.artifact.size,
      hashes: item.artifact.hashes,
      modId: artifactType(item.artifact) === 'fabric-mod' ? item.descriptor.id : undefined,
      resourcePackId: artifactType(item.artifact) === 'resource-pack' ? item.descriptor.id : undefined,
      packFormat: artifactType(item.artifact) === 'resource-pack' ? item.descriptor.packFormat : undefined,
      minFormat: artifactType(item.artifact) === 'resource-pack' ? item.descriptor.minFormat : undefined,
      maxFormat: artifactType(item.artifact) === 'resource-pack' ? item.descriptor.maxFormat : undefined,
      distribution: item.artifact.distribution,
      compatibility: item.artifact.compatibility || manifest.target,
      officialCompatibility: item.artifact.officialCompatibility,
      license: item.artifact.license,
      environment: item.descriptor.environment,
      clientRequired: item.artifact.clientRequired,
      optional: item.artifact.optional === true,
      portableExport: artifactPortableExportMode(item.artifact),
      bundled: artifactPortableExportMode(item.artifact) === 'include'
    })),
    externalDependencies,
    serverOnlyArtifactsExcluded: manifest.artifacts
      .filter(artifact => artifact.serverOnly === true)
      .map(artifact => ({ key: artifact.key, title: artifact.title, modId: artifact.modId }))
  };

  await ensurePlainDirectory(path.dirname(destination), { create: true });
  return withLock(`${destination}.lock`, async () => {
    const included = selected.filter(item => artifactPortableExportMode(item.artifact) === 'include');
    const referenced = selected.filter(item => artifactPortableExportMode(item.artifact) === 'reference-only');
    if (await verifyExistingClientBundle({ destination, bundleManifest, selected })) {
      return {
        ok: true,
        state: 'already-exported',
        destination,
        includedCount: included.length,
        referencedCount: referenced.length,
        clientRequiredCount: selected.filter(item => item.artifact.clientRequired).length,
        clientOptionalCount: selected.filter(item =>
          ['client-optional', 'client-resource-pack'].includes(item.artifact.installTarget)).length,
        clientResourcePackCount: selected.filter(item => item.artifact.installTarget === 'client-resource-pack').length,
        externalDependencies,
        message: `The verified client bundle already exists at ${destination}${referenced.length ? ` with ${referenced.length} official direct-download reference${referenced.length === 1 ? '' : 's'}` : ''}. Fabric API ${externalDependencies[0]?.version || ''} is still required separately.`.trim()
      };
    }
    const incomplete = `${destination}.incomplete-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
    await fsp.mkdir(incomplete, { recursive: false });
    try {
      for (const item of included) {
        const outputDirectory = containedPath(incomplete, artifactClientFolder(item.artifact));
        await ensurePlainDirectory(outputDirectory, { create: true });
        const output = containedPath(outputDirectory, item.artifact.filename);
        await fsp.copyFile(item.file, output, fs.constants.COPYFILE_EXCL);
        await verifyArtifactFile(output, item.artifact);
        await assertArtifactDescriptor(output, item.artifact);
      }
      await writeJsonAtomic(containedPath(incomplete, 'client-bundle.json'), bundleManifest);
      await fsp.writeFile(containedPath(incomplete, 'README.txt'), renderClientBundleReadme(bundleManifest), { flag: 'wx', mode: 0o600 });
      const destinationExists = await fsp.lstat(destination).then(() => true, error => {
        if (error?.code === 'ENOENT') return false;
        throw error;
      });
      if (destinationExists) fail('client-bundle-conflict', 'The client bundle destination appeared during export. No existing folder was overwritten.');
      await fsp.rename(incomplete, destination);
    } catch (error) {
      await writeJsonAtomic(containedPath(incomplete, 'export-failed.json'), {
        failedAt: new Date().toISOString(),
        error: friendlyPendingModError(error)
      }).catch(() => {});
      throw error;
    }
    const requiredCount = selected.filter(item => item.artifact.clientRequired).length;
    const optionalCount = selected.filter(item =>
      ['client-optional', 'client-resource-pack'].includes(item.artifact.installTarget)).length;
    const resourcePackCount = selected.filter(item => item.artifact.installTarget === 'client-resource-pack').length;
    return {
      ok: true,
      state: 'exported',
      destination,
      manifest: containedPath(destination, 'client-bundle.json'),
      includedCount: included.length,
      referencedCount: referenced.length,
      clientRequiredCount: requiredCount,
      clientOptionalCount: optionalCount,
      clientResourcePackCount: resourcePackCount,
      externalDependencies,
      message: `Exported ${included.length} verified client file${included.length === 1 ? '' : 's'}${referenced.length ? ` and recorded ${referenced.length} official direct-download reference${referenced.length === 1 ? '' : 's'}` : ''} to ${destination}. Install Fabric API ${externalDependencies[0]?.version || `for Fabric ${manifest.target.minecraftVersion}`} separately.`
    };
  });
}

async function listInstalledFabricMods(modsDirectory) {
  const exists = await ensurePlainDirectory(modsDirectory, { create: true });
  if (!exists) return [];
  const entries = await fsp.readdir(modsDirectory, { withFileTypes: true });
  if (entries.length > MAX_INSTALLED_JARS * 4) {
    fail('mods-folder-too-large', 'The mods folder has too many entries to check safely. Clean it up before applying pending mods.');
  }
  const linkedJar = entries.find(entry => entry.isSymbolicLink() && entry.name.toLowerCase().endsWith('.jar'));
  if (linkedJar) {
    fail('unsafe-installed-jar', `The active mod ${linkedJar.name} is a symbolic link and cannot be checked safely.`);
  }
  const jars = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.jar'));
  if (jars.length > MAX_INSTALLED_JARS) {
    fail('mods-folder-too-large', `The mods folder has more than ${MAX_INSTALLED_JARS} active JARs and cannot be checked safely.`);
  }
  const result = [];
  for (const entry of jars) {
    const file = containedPath(modsDirectory, entry.name);
    let descriptor;
    try {
      descriptor = await readFabricModDescriptor(file);
    } catch (error) {
      fail('installed-jar-unreadable', `The active mod ${entry.name} could not be identified safely. Fix or remove it before applying pending mods.`, {
        filename: entry.name,
        reason: friendlyPendingModError(error).message
      }, error);
    }
    result.push({ name: entry.name, file, descriptor });
  }
  const identities = new Map();
  for (const item of result) {
    const matches = identities.get(item.descriptor.id) || [];
    matches.push(item.name);
    identities.set(item.descriptor.id, matches);
  }
  const duplicates = [...identities].filter(([, names]) => names.length > 1);
  if (duplicates.length) {
    fail('existing-duplicate-mods', `The mods folder already contains duplicate copies of ${duplicates[0][0]}. Remove the duplicates before applying pending mods.`, {
      duplicates: Object.fromEntries(duplicates)
    });
  }
  return result;
}

function relativePortable(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    fail('unsafe-path', 'A transaction path escaped the server profile.');
  }
  return relative.split(path.sep).join('/');
}

function journalPath(profileRoot, relative) {
  const normalized = String(relative || '').split('/');
  return containedPath(profileRoot, ...normalized);
}

async function persistJournal(paths, journal) {
  const transactionRoot = containedPath(paths.transactions, safeId(journal.id, 'transaction id', 120));
  await writeJsonAtomic(containedPath(transactionRoot, 'journal.json'), journal);
  await writeJsonAtomic(paths.activeTransaction, journal);
}

async function inspectActiveTransaction(paths) {
  const journal = await readJsonFile(paths.activeTransaction).catch(error => {
    if (error?.code === 'invalid-json' || error?.code === 'unsafe-json') throw error;
    return null;
  });
  if (!journal) return null;
  if (!journal.id || !Array.isArray(journal.actions) ||
      !['prepared', 'applying', 'complete', 'recovering', 'rolling-back', 'recovered', 'rolled-back', 'recovery-required'].includes(journal.status)) {
    fail('invalid-transaction', 'The pending mod recovery journal is invalid. Do not start the server until it is repaired.');
  }
  return journal;
}

async function recoverJournal(paths, journal, finalStatus = 'recovered') {
  const transactionRoot = containedPath(paths.transactions, safeId(journal.id, 'transaction id', 120));
  const recoveredRoot = containedPath(transactionRoot, 'recovered-files');
  await ensurePlainDirectory(recoveredRoot, { create: true });
  journal.recoveryTarget = finalStatus;
  journal.status = finalStatus === 'rolled-back' ? 'rolling-back' : 'recovering';
  await persistJournal(paths, journal);
  const reversed = [...journal.actions].reverse();
  for (const action of reversed) {
    const destination = journalPath(paths.root, action.destinationRelative);
    const destinationExists = await fsp.stat(destination).then(stat => stat.isFile(), () => false);
    if (destinationExists) {
      const actual = await hashFile(destination, Object.keys(action.expectedHashes));
      const isAppliedFile = Object.entries(action.expectedHashes).every(([algorithm, expected]) => actual.hashes[algorithm] === expected);
      const isUntouchedPrior = action.priorRelative === action.destinationRelative && action.priorHashes &&
        Object.entries(action.priorHashes).every(([algorithm, expected]) => actual.hashes[algorithm] === expected) &&
        !(await fsp.stat(journalPath(paths.root, action.backupRelative || action.priorRelative)).then(stat =>
          action.backupRelative ? stat.isFile() : false, () => false));
      if (!isAppliedFile && !isUntouchedPrior) {
        fail('recovery-conflict', `Recovery stopped because ${path.basename(destination)} changed after the pending mod transaction.`, {
          filename: path.basename(destination),
          transactionId: journal.id
        });
      }
      if (isAppliedFile) {
        const recovered = containedPath(recoveredRoot, `${path.basename(destination)}.${crypto.randomBytes(4).toString('hex')}.applied`);
        await moveFileNoReplace(destination, recovered);
        action.recoveredAppliedFileRelative = relativePortable(paths.root, recovered);
      }
    }
    if (action.backupRelative && action.priorRelative) {
      const backup = journalPath(paths.root, action.backupRelative);
      const prior = journalPath(paths.root, action.priorRelative);
      const backupExists = await fsp.stat(backup).then(stat => stat.isFile(), () => false);
      const priorExists = await fsp.stat(prior).then(stat => stat.isFile(), () => false);
      if (backupExists && priorExists) {
        fail('recovery-conflict', `Recovery found both the backup and active copy of ${path.basename(prior)}. No file was overwritten.`, {
          filename: path.basename(prior),
          transactionId: journal.id
        });
      }
      if (backupExists) {
        await moveFileNoReplace(backup, prior);
      } else if (!priorExists) {
        fail('recovery-missing-backup', `Recovery could not find the backup for ${path.basename(prior)}. Do not start the server yet.`, {
          filename: path.basename(prior),
          transactionId: journal.id
        });
      }
    }
    action.phase = finalStatus;
    await persistJournal(paths, journal);
  }
  journal.status = finalStatus;
  journal.finishedAt = new Date().toISOString();
  await persistJournal(paths, journal);
  if (journal.manifestId) {
    const queuePaths = profilePaths(paths.root, journal.manifestId);
    const queueState = await readJsonFile(queuePaths.queueState).catch(() => null);
    if (queueState && (!journal.manifestDigest || queueState.manifestDigest === journal.manifestDigest)) {
      queueState.status = Array.isArray(queueState.artifacts) && queueState.artifacts.some(item => item.status === 'failed')
        ? 'partial'
        : 'ready';
      queueState.lastRecoveryAt = journal.finishedAt;
      queueState.lastRecoveredTransactionId = journal.id;
      await writeJsonAtomic(queuePaths.queueState, queueState);
    }
  }
  return {
    ok: true,
    state: finalStatus,
    transactionId: journal.id,
    message: finalStatus === 'rolled-back'
      ? 'The last pending mod installation was rolled back. Previous mod files were restored.'
      : 'The interrupted pending mod installation was recovered. Previous mod files were restored.'
  };
}

async function applyPendingModQueue({
  profileRoot,
  manifestPath,
  serverStopped = false,
  optionalServerKeys = [],
  worldBackupLimits = {}
} = {}) {
  if (serverStopped !== true) {
    fail('server-must-be-stopped', 'Stop the Minecraft server and wait for it to finish before applying pending mods.');
  }
  const loaded = await loadManifest(manifestPath);
  const { manifest, digest } = loaded;
  const verifiedProfile = await verifyProfileTarget(profileRoot, manifest.target);
  const paths = profilePaths(verifiedProfile.paths.root, manifest.id);
  await ensurePlainDirectory(paths.pendingRoot, { create: true });
  await ensurePlainDirectory(paths.transactions, { create: true });

  return withLock(paths.applyLock, async () => {
    const previous = await inspectActiveTransaction(paths);
    if (previous && ['prepared', 'applying', 'recovering', 'rolling-back', 'recovery-required'].includes(previous.status)) {
      fail('recovery-required', 'A previous pending mod installation was interrupted. Recover it before starting the server.', {
        transactionId: previous.id
      });
    }
    const queueState = await readJsonFile(paths.queueState);
    if (!queueStateMatchesManifest(queueState, manifest, digest) ||
        !['ready', 'partial', 'failed', 'applied'].includes(queueState.status)) {
      fail('queue-not-ready', 'Download and verify the pending mods before applying them.');
    }
    const serverArtifacts = selectManifestArtifacts(manifest, { optionalServerKeys })
      .filter(artifact => artifact.installTarget === 'server');
    const pending = [];
    for (const artifact of serverArtifacts) {
      const file = artifactPendingPath(paths, artifact);
      await verifyArtifactFile(file, artifact);
      const descriptor = await assertArtifactDescriptor(file, artifact);
      pending.push({ artifact, file, descriptor });
    }

    await ensurePlainDirectory(paths.mods, { create: true });
    const installed = await listInstalledFabricMods(paths.mods);
    const byId = new Map(installed.map(item => [item.descriptor.id, item]));
    const byFilename = new Map(installed.map(item => [item.name.toLowerCase(), item]));
    const missingRequirements = (manifest.requiredInstalledModIds || [])
      .map(value => String(value).toLowerCase())
      .filter(modId => !byId.has(modId));
    if (missingRequirements.length) {
      fail('missing-dependency', `Install ${missingRequirements.join(', ')} before applying these pending mods. No mods were changed.`, {
        missingModIds: missingRequirements
      });
    }
    const plan = [];
    const alreadyInstalled = [];
    for (const item of pending) {
      const sameId = byId.get(item.descriptor.id);
      const sameFilename = byFilename.get(item.artifact.filename.toLowerCase());
      if (sameFilename && sameId && sameFilename.file !== sameId.file) {
        fail('mod-conflict', `${item.artifact.title} conflicts with more than one active JAR. No mods were changed.`);
      }
      const existing = sameId || sameFilename || null;
      if (existing) {
        if (existing.descriptor.id !== item.descriptor.id) {
          fail('mod-conflict', `${item.artifact.filename} is already used by ${existing.descriptor.id}. No mods were changed.`, {
            pendingModId: item.descriptor.id,
            existingModId: existing.descriptor.id
          });
        }
        const current = await hashFile(existing.file, Object.keys(item.artifact.hashes));
        const exact = Object.entries(item.artifact.hashes).every(([algorithm, expected]) => current.hashes[algorithm] === expected);
        if (exact) {
          alreadyInstalled.push({ key: item.artifact.key, filename: existing.name, modId: item.descriptor.id });
          continue;
        }
        if (item.artifact.replaceExisting !== true) {
          fail('mod-conflict', `${item.artifact.title} is already installed as ${existing.name}, but it is a different build. No mods were changed.`, {
            pendingModId: item.descriptor.id,
            existingFilename: existing.name
          });
        }
      }
      plan.push({ ...item, existing, existingHashes: existing ? (await hashFile(existing.file, Object.keys(item.artifact.hashes))).hashes : null });
    }

    // Only an explicitly trusted previous manifest may reuse its download queue.
    // Every selected remaining artifact above was rehashed and descriptor-checked;
    // now remove retired selections from the stored state before any startup.
    await migrateCompatibleQueueState(paths, queueState, manifest, digest);
    if (!plan.length) {
      return {
        ok: true,
        state: 'already-applied',
        installedCount: 0,
        alreadyInstalledCount: alreadyInstalled.length,
        clientOptionalInstalledCount: 0,
        message: 'All pending server mods are already installed. No duplicate copies were added.'
      };
    }

    const worldSensitive = plan.filter(item => item.artifact.requiresWorldBackup === true);
    const worldBackup = worldSensitive.length
      ? await createBoundedWorldBackup({
        profileRoot: paths.root,
        serverStopped: true,
        reasons: worldSensitive.map(item => item.artifact.key),
        limits: worldBackupLimits
      })
      : null;
    const transactionId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(6).toString('hex')}`;
    const transactionRoot = containedPath(paths.transactions, transactionId);
    const stagedRoot = containedPath(transactionRoot, 'staged');
    const backupRoot = containedPath(transactionRoot, 'backups');
    await ensurePlainDirectory(stagedRoot, { create: true });
    await ensurePlainDirectory(backupRoot, { create: true });
    const journal = {
      schemaVersion: 1,
      id: transactionId,
      manifestId: manifest.id,
      manifestDigest: digest,
      status: 'prepared',
      createdAt: new Date().toISOString(),
      worldBackup: worldBackup ? {
        id: worldBackup.id,
        relativePath: worldBackup.relativePath,
        bytes: worldBackup.bytes,
        entries: worldBackup.entries,
        requiredBy: worldSensitive.map(item => item.artifact.key)
      } : null,
      actions: []
    };

    for (const item of plan) {
      const staged = containedPath(stagedRoot, item.artifact.filename);
      await fsp.copyFile(item.file, staged, fs.constants.COPYFILE_EXCL);
      await verifyArtifactFile(staged, item.artifact);
      await assertArtifactDescriptor(staged, item.artifact);
      let backup = '';
      if (item.existing) backup = containedPath(backupRoot, item.existing.name);
      journal.actions.push({
        artifactKey: item.artifact.key,
        title: item.artifact.title,
        modId: item.descriptor.id,
        stagedRelative: relativePortable(paths.root, staged),
        destinationRelative: relativePortable(paths.root, containedPath(paths.mods, item.artifact.filename)),
        priorRelative: item.existing ? relativePortable(paths.root, item.existing.file) : '',
        backupRelative: backup ? relativePortable(paths.root, backup) : '',
        priorHashes: item.existingHashes,
        expectedHashes: item.artifact.hashes,
        requiresWorldBackup: item.artifact.requiresWorldBackup === true,
        phase: 'prepared'
      });
    }
    await persistJournal(paths, journal);

    try {
      journal.status = 'applying';
      await persistJournal(paths, journal);
      for (const action of journal.actions) {
        const staged = journalPath(paths.root, action.stagedRelative);
        const destination = journalPath(paths.root, action.destinationRelative);
        if (action.priorRelative) {
          action.phase = 'backup-started';
          await persistJournal(paths, journal);
          await fsp.rename(journalPath(paths.root, action.priorRelative), journalPath(paths.root, action.backupRelative));
          action.phase = 'backed-up';
          await persistJournal(paths, journal);
        }
        action.phase = 'install-started';
        await persistJournal(paths, journal);
        await moveFileNoReplace(staged, destination);
        action.phase = 'installed';
        await persistJournal(paths, journal);
      }
      for (const item of plan) {
        const destination = containedPath(paths.mods, item.artifact.filename);
        await verifyArtifactFile(destination, item.artifact);
        await assertArtifactDescriptor(destination, item.artifact);
      }
      journal.status = 'complete';
      journal.finishedAt = new Date().toISOString();
      await persistJournal(paths, journal);
      queueState.status = 'applied';
      queueState.appliedAt = journal.finishedAt;
      queueState.transactionId = transactionId;
      await writeJsonAtomic(paths.queueState, queueState);
      return {
        ok: true,
        state: 'applied',
        transactionId,
        installedCount: plan.length,
        alreadyInstalledCount: alreadyInstalled.length,
        clientOptionalInstalledCount: 0,
        backupRoot,
        worldBackup: journal.worldBackup,
        message: `${plan.length} pending server mod${plan.length === 1 ? '' : 's'} installed safely${worldBackup ? ` after creating world backup ${worldBackup.id}` : ''}. Optional files were not copied into the server.`
      };
    } catch (error) {
      try {
        const recovery = await recoverJournal(paths, journal, 'recovered');
        fail('apply-rolled-back', `The pending mods could not be installed, so every completed change was rolled back. ${friendlyPendingModError(error).message}`, {
          transactionId,
          recovery
        }, error);
      } catch (recoveryError) {
        if (recoveryError?.code === 'apply-rolled-back') throw recoveryError;
        journal.status = 'recovery-required';
        journal.error = friendlyPendingModError(error);
        journal.recoveryError = friendlyPendingModError(recoveryError);
        await persistJournal(paths, journal).catch(() => {});
        fail('recovery-required', 'The pending mod installation was interrupted and automatic recovery could not finish. Do not start the server yet.', {
          transactionId,
          recoveryError: friendlyPendingModError(recoveryError)
        }, error);
      }
    }
  });
}

async function recoverPendingModTransaction({ profileRoot, serverStopped = false } = {}) {
  if (serverStopped !== true) {
    fail('server-must-be-stopped', 'Stop the Minecraft server and wait for it to finish before recovering pending mods.');
  }
  const paths = profilePaths(profileRoot);
  await ensurePlainDirectory(paths.pendingRoot, { create: true });
  await ensurePlainDirectory(paths.transactions, { create: true });
  return withLock(paths.applyLock, async () => {
    const journal = await inspectActiveTransaction(paths);
    if (!journal) return { ok: true, state: 'nothing-to-recover', message: 'There is no pending mod transaction to recover.' };
    if (['complete', 'recovered', 'rolled-back'].includes(journal.status)) {
      return { ok: true, state: 'nothing-to-recover', transactionId: journal.id, message: 'There is no interrupted pending mod transaction.' };
    }
    return recoverJournal(paths, journal, journal.recoveryTarget === 'rolled-back' ? 'rolled-back' : 'recovered');
  });
}

async function rollbackPendingModApplication({
  profileRoot,
  serverStopped = false,
  confirmWorldUnchangedSinceApply = false
} = {}) {
  if (serverStopped !== true) {
    fail('server-must-be-stopped', 'Stop the Minecraft server and wait for it to finish before rolling back mods.');
  }
  const paths = profilePaths(profileRoot);
  await ensurePlainDirectory(paths.pendingRoot, { create: true });
  await ensurePlainDirectory(paths.transactions, { create: true });
  return withLock(paths.applyLock, async () => {
    const journal = await inspectActiveTransaction(paths);
    if (!journal || journal.status !== 'complete') {
      fail('nothing-to-rollback', 'There is no completed pending mod installation available to roll back.');
    }
    if (journal.actions.some(action => action.requiresWorldBackup === true) && confirmWorldUnchangedSinceApply !== true) {
      fail(
        'world-restore-required',
        'This installation added Lootr. If the server has run since then, restore the recorded world backup before removing Lootr. Rollback was not started.',
        { transactionId: journal.id, worldBackup: journal.worldBackup || null }
      );
    }
    return recoverJournal(paths, journal, 'rolled-back');
  });
}

function formatPendingModStatus(result) {
  if (!result || typeof result !== 'object') return 'Pending mod status is unavailable.';
  return String(result.message || friendlyPendingModError(result).message);
}

module.exports = {
  ACTIVE_TRANSACTION_FILE,
  DEFAULT_DOWNLOAD_HOSTS,
  MANIFEST_SCHEMA_VERSION,
  MAX_ARTIFACT_BYTES,
  PENDING_DIRECTORY,
  PendingModError,
  applyPendingModQueue,
  createBoundedWorldBackup,
  downloadArtifact,
  exportClientModBundle,
  formatPendingModStatus,
  friendlyPendingModError,
  getPendingModQueueStatus,
  hashFile,
  loadManifest,
  profilePaths,
  queuePendingMods,
  queueStateMatchesManifest,
  readFabricModDescriptor,
  readResourcePackDescriptor,
  recoverPendingModTransaction,
  rollbackPendingModApplication,
  selectManifestArtifacts,
  validateManifest,
  verifyArtifactFile,
  verifyProfileTarget
};
