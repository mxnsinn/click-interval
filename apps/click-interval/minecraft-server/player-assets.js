'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const LIMITS = Object.freeze({
  maximumRoots: 16,
  maximumJarBytes: 512 * 1024 * 1024,
  maximumEntries: 100_000,
  maximumDirectoryBytes: 64 * 1024 * 1024,
  maximumEntryCompressedBytes: 8 * 1024 * 1024,
  maximumEntryUncompressedBytes: 8 * 1024 * 1024,
  maximumJsonBytes: 512 * 1024,
  maximumPngBytes: 8 * 1024 * 1024,
  maximumPngDimension: 4096,
  maximumRequestedItems: 64,
  maximumInflateRatio: 200
});

const HUD_ENTRY_CANDIDATES = Object.freeze({
  heart: Object.freeze({
    empty: Object.freeze(['assets/minecraft/textures/gui/sprites/hud/heart/container.png']),
    half: Object.freeze(['assets/minecraft/textures/gui/sprites/hud/heart/half.png']),
    full: Object.freeze(['assets/minecraft/textures/gui/sprites/hud/heart/full.png'])
  }),
  hunger: Object.freeze({
    empty: Object.freeze(['assets/minecraft/textures/gui/sprites/hud/food_empty.png']),
    half: Object.freeze(['assets/minecraft/textures/gui/sprites/hud/food_half.png']),
    full: Object.freeze(['assets/minecraft/textures/gui/sprites/hud/food_full.png'])
  }),
  xp: Object.freeze({
    background: Object.freeze(['assets/minecraft/textures/gui/sprites/hud/experience_bar_background.png']),
    progress: Object.freeze(['assets/minecraft/textures/gui/sprites/hud/experience_bar_progress.png'])
  })
});

const EQUIPMENT_SLOT_ENTRY_CANDIDATES = Object.freeze({
  helmet: 'assets/minecraft/textures/gui/sprites/container/slot/helmet.png',
  chestplate: 'assets/minecraft/textures/gui/sprites/container/slot/chestplate.png',
  leggings: 'assets/minecraft/textures/gui/sprites/container/slot/leggings.png',
  boots: 'assets/minecraft/textures/gui/sprites/container/slot/boots.png',
  offhand: 'assets/minecraft/textures/gui/sprites/container/slot/shield.png'
});

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_MAXIMUM_TAIL_BYTES = 65_557;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
const SAFE_NAMESPACE = /^[a-z0-9_.-]{1,64}$/;
const SAFE_RESOURCE_PATH = /^[a-z0-9][a-z0-9/._-]{0,199}$/;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function normalizeVersion(value) {
  const version = String(value || '').trim();
  if (!SAFE_VERSION.test(version) || version === '.' || version === '..') {
    throw new Error('Minecraft version must be one safe folder name.');
  }
  return version;
}

function normalizeResourceLocation(value, defaultNamespace = 'minecraft') {
  const input = String(value || '').trim();
  if (input !== input.toLowerCase()) return null;
  const separator = input.indexOf(':');
  const namespace = separator < 0 ? defaultNamespace : input.slice(0, separator);
  const resourcePath = separator < 0 ? input : input.slice(separator + 1);
  if (!SAFE_NAMESPACE.test(namespace) || !SAFE_RESOURCE_PATH.test(resourcePath)) return null;
  if (resourcePath.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return { namespace, path: resourcePath, id: `${namespace}:${resourcePath}` };
}

function validateZipEntryName(value) {
  const name = String(value || '');
  if (!name || name.length > 512 || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new Error('The client JAR contains an unsafe archive path.');
  }
  if (name.includes('\ufffd') || name.split('/').some((part) => part === '..')) {
    throw new Error('The client JAR contains an unsafe archive path.');
  }
  return name;
}

function isContainedPath(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function defaultMinecraftVersionRoots(environment = process.env, homeDirectory = os.homedir()) {
  const roots = [];
  if (environment.APPDATA) roots.push(path.join(environment.APPDATA, '.minecraft', 'versions'));
  if (homeDirectory) roots.push(path.join(homeDirectory, 'AppData', 'Roaming', '.minecraft', 'versions'));
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function normalizeRoots(roots) {
  const source = roots === undefined ? defaultMinecraftVersionRoots() : roots;
  if (!Array.isArray(source) || source.length > LIMITS.maximumRoots) {
    throw new Error(`Minecraft version roots must be an array of at most ${LIMITS.maximumRoots} paths.`);
  }
  return [...new Set(source
    .filter((root) => typeof root === 'string' && root.trim())
    .map((root) => path.resolve(root)))];
}

async function readSmallJsonFile(file, maximumBytes = LIMITS.maximumJsonBytes) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) throw new Error('JSON metadata has an unsafe size.');
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON metadata must contain an object.');
  return value;
}

async function sha1File(file) {
  const hash = crypto.createHash('sha1');
  const handle = await fs.open(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function findLocalMinecraftClientJar(versionValue, options = {}) {
  const version = normalizeVersion(versionValue);
  for (const configuredRoot of normalizeRoots(options.roots)) {
    let root;
    try {
      root = await fs.realpath(configuredRoot);
    } catch {
      continue;
    }
    const candidate = path.join(root, version, `${version}.jar`);
    let resolvedCandidate;
    let stat;
    try {
      resolvedCandidate = await fs.realpath(candidate);
      if (!isContainedPath(root, resolvedCandidate)) continue;
      stat = await fs.stat(resolvedCandidate);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size < 22 || stat.size > LIMITS.maximumJarBytes) continue;

    let verification = 'path';
    const metadataPath = path.join(root, version, `${version}.json`);
    try {
      const metadataRealPath = await fs.realpath(metadataPath);
      if (!isContainedPath(root, metadataRealPath)) continue;
      const metadata = await readSmallJsonFile(metadataRealPath, 2 * 1024 * 1024);
      if (metadata.id && String(metadata.id) !== version) continue;
      const client = metadata.downloads?.client;
      if (client?.size !== undefined) {
        const expectedSize = Number(client.size);
        if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize !== stat.size) continue;
      }
      if (client?.sha1 !== undefined) {
        const expectedSha1 = String(client.sha1).toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(expectedSha1) || await sha1File(resolvedCandidate) !== expectedSha1) continue;
        verification = 'sha1';
      } else if (metadata.id) {
        verification = 'version-id';
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') continue;
    }

    return { version, jarPath: resolvedCandidate, size: stat.size, verification };
  }
  return null;
}

async function readExactly(handle, length, position) {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) {
    throw new Error('The client JAR requested an invalid read.');
  }
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (!result.bytesRead) throw new Error('The client JAR ended unexpectedly.');
    offset += result.bytesRead;
  }
  return buffer;
}

function findZipEndRecord(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_SIGNATURE) return offset;
  }
  return -1;
}

class SafeZipArchive {
  constructor(file, handle, size, directoryOffset, entries) {
    this.file = file;
    this.handle = handle;
    this.size = size;
    this.directoryOffset = directoryOffset;
    this.entries = entries;
    this.closed = false;
  }

  static async open(file, options = {}) {
    const maximumJarBytes = Number(options.maximumJarBytes) || LIMITS.maximumJarBytes;
    const resolvedFile = path.resolve(String(file || ''));
    const stat = await fs.stat(resolvedFile);
    if (!stat.isFile() || stat.size < 22 || stat.size > maximumJarBytes) {
      throw new Error('The Minecraft client JAR has an unsafe size.');
    }
    const handle = await fs.open(resolvedFile, 'r');
    try {
      const tailLength = Math.min(stat.size, ZIP_MAXIMUM_TAIL_BYTES);
      const tailStart = stat.size - tailLength;
      const tail = await readExactly(handle, tailLength, tailStart);
      const endOffset = findZipEndRecord(tail);
      if (endOffset < 0) throw new Error('The Minecraft client JAR has no valid ZIP directory.');
      const endAbsoluteOffset = tailStart + endOffset;
      const diskNumber = tail.readUInt16LE(endOffset + 4);
      const directoryDisk = tail.readUInt16LE(endOffset + 6);
      const diskEntries = tail.readUInt16LE(endOffset + 8);
      const totalEntries = tail.readUInt16LE(endOffset + 10);
      const directorySize = tail.readUInt32LE(endOffset + 12);
      const directoryOffset = tail.readUInt32LE(endOffset + 16);
      const commentLength = tail.readUInt16LE(endOffset + 20);
      if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries ||
          totalEntries === 0 || totalEntries === 0xffff || totalEntries > LIMITS.maximumEntries ||
          directorySize === 0xffffffff || directorySize <= 0 || directorySize > LIMITS.maximumDirectoryBytes ||
          directoryOffset === 0xffffffff || directoryOffset + directorySize > endAbsoluteOffset ||
          endOffset + 22 + commentLength !== tail.length) {
        throw new Error('The Minecraft client JAR has an unsupported ZIP directory.');
      }

      const directory = await readExactly(handle, directorySize, directoryOffset);
      const entries = new Map();
      let offset = 0;
      for (let index = 0; index < totalEntries; index += 1) {
        if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
          throw new Error('The Minecraft client JAR has a damaged ZIP directory.');
        }
        const flags = directory.readUInt16LE(offset + 8);
        const compressionMethod = directory.readUInt16LE(offset + 10);
        const checksum = directory.readUInt32LE(offset + 16);
        const compressedSize = directory.readUInt32LE(offset + 20);
        const uncompressedSize = directory.readUInt32LE(offset + 24);
        const nameLength = directory.readUInt16LE(offset + 28);
        const extraLength = directory.readUInt16LE(offset + 30);
        const entryCommentLength = directory.readUInt16LE(offset + 32);
        const startDisk = directory.readUInt16LE(offset + 34);
        const localOffset = directory.readUInt32LE(offset + 42);
        const nextOffset = offset + 46 + nameLength + extraLength + entryCommentLength;
        if (!nameLength || nextOffset > directory.length || startDisk !== 0 || localOffset === 0xffffffff || localOffset >= directoryOffset) {
          throw new Error('The Minecraft client JAR has a damaged archive entry.');
        }
        const nameBuffer = directory.subarray(offset + 46, offset + 46 + nameLength);
        const name = validateZipEntryName(nameBuffer.toString('utf8'));
        const key = name.toLowerCase();
        if (entries.has(key)) throw new Error('The Minecraft client JAR contains duplicate archive paths.');
        entries.set(key, {
          name,
          nameBuffer: Buffer.from(nameBuffer),
          flags,
          encrypted: Boolean(flags & 1),
          compressionMethod,
          checksum,
          compressedSize,
          uncompressedSize,
          localOffset
        });
        offset = nextOffset;
      }
      if (offset !== directory.length) throw new Error('The Minecraft client JAR has trailing central-directory data.');
      return new SafeZipArchive(resolvedFile, handle, stat.size, directoryOffset, entries);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  has(name) {
    return this.entries.has(String(name || '').toLowerCase());
  }

  async readEntry(name, options = {}) {
    if (this.closed) throw new Error('The Minecraft client JAR is already closed.');
    const entry = this.entries.get(String(name || '').toLowerCase());
    if (!entry) return null;
    const maximumCompressedBytes = Number(options.maximumCompressedBytes) || LIMITS.maximumEntryCompressedBytes;
    const maximumUncompressedBytes = Number(options.maximumUncompressedBytes) || LIMITS.maximumEntryUncompressedBytes;
    if (entry.encrypted || ![0, 8].includes(entry.compressionMethod) ||
        entry.compressedSize > maximumCompressedBytes || entry.uncompressedSize > maximumUncompressedBytes ||
        (entry.compressedSize === 0 && entry.uncompressedSize !== 0) ||
        entry.uncompressedSize > entry.compressedSize * LIMITS.maximumInflateRatio + 1024) {
      throw new Error('The requested client asset has unsafe compression metadata.');
    }
    if (entry.compressionMethod === 0 && entry.compressedSize !== entry.uncompressedSize) {
      throw new Error('The requested client asset has inconsistent stored sizes.');
    }
    const localHeader = await readExactly(this.handle, 30, entry.localOffset);
    if (localHeader.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE) throw new Error('The requested client asset has a damaged local header.');
    const localFlags = localHeader.readUInt16LE(6);
    const localMethod = localHeader.readUInt16LE(8);
    const localNameLength = localHeader.readUInt16LE(26);
    const localExtraLength = localHeader.readUInt16LE(28);
    if (localFlags !== entry.flags || (localFlags & 1) || localMethod !== entry.compressionMethod || localNameLength !== entry.nameBuffer.length) {
      throw new Error('The requested client asset has inconsistent local metadata.');
    }
    const localName = await readExactly(this.handle, localNameLength, entry.localOffset + 30);
    if (!localName.equals(entry.nameBuffer)) throw new Error('The requested client asset changed names between ZIP headers.');
    const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + entry.compressedSize > this.directoryOffset) throw new Error('The requested client asset overlaps the ZIP directory.');
    const compressed = await readExactly(this.handle, entry.compressedSize, dataOffset);
    let output;
    if (entry.compressionMethod === 0) output = compressed;
    else output = zlib.inflateRawSync(compressed, { maxOutputLength: maximumUncompressedBytes });
    if (output.length !== entry.uncompressedSize || crc32(output) !== entry.checksum) {
      throw new Error('The requested client asset failed its integrity check.');
    }
    return output;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close();
  }
}

function validatePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 57 || buffer.length > LIMITS.maximumPngBytes || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('The requested client texture is not a valid PNG.');
  }
  let offset = 8;
  let sawHeader = false;
  let sawEnd = false;
  let chunks = 0;
  while (offset + 12 <= buffer.length && chunks < 10_000) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const chunkEnd = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || length > LIMITS.maximumPngBytes || chunkEnd > buffer.length) {
      throw new Error('The requested client texture has a damaged PNG chunk.');
    }
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) {
      throw new Error('The requested client texture failed its PNG checksum.');
    }
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new Error('The requested client texture has no valid PNG header.');
      const width = buffer.readUInt32BE(offset + 8);
      const height = buffer.readUInt32BE(offset + 12);
      if (!width || !height || width > LIMITS.maximumPngDimension || height > LIMITS.maximumPngDimension ||
          width * height > LIMITS.maximumPngDimension * LIMITS.maximumPngDimension) {
        throw new Error('The requested client texture has unsafe PNG dimensions.');
      }
      sawHeader = true;
    }
    if (type === 'IEND') {
      if (length !== 0 || chunkEnd !== buffer.length) throw new Error('The requested client texture has an invalid PNG end marker.');
      sawEnd = true;
      break;
    }
    offset = chunkEnd;
    chunks += 1;
  }
  if (!sawHeader || !sawEnd) throw new Error('The requested client texture is incomplete.');
  return buffer;
}

function pngDataUrl(buffer) {
  return `data:image/png;base64,${validatePng(buffer).toString('base64')}`;
}

async function readJsonEntry(archive, entryName) {
  const buffer = await archive.readEntry(entryName, {
    maximumCompressedBytes: LIMITS.maximumJsonBytes,
    maximumUncompressedBytes: LIMITS.maximumJsonBytes
  });
  if (!buffer) return null;
  const parsed = JSON.parse(buffer.toString('utf8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

async function readPngEntry(archive, entryName) {
  const buffer = await archive.readEntry(entryName, {
    maximumCompressedBytes: LIMITS.maximumPngBytes,
    maximumUncompressedBytes: LIMITS.maximumPngBytes
  });
  return buffer ? pngDataUrl(buffer) : '';
}

function normalizeModelReference(value, defaultNamespace = 'minecraft') {
  const resource = normalizeResourceLocation(value, defaultNamespace);
  if (!resource) return null;
  const modelPath = resource.path.startsWith('models/') ? resource.path.slice(7) : resource.path;
  if (!SAFE_RESOURCE_PATH.test(modelPath)) return null;
  return { namespace: resource.namespace, path: modelPath };
}

async function modelTextureReference(archive, initialModel, maximumDepth = 8) {
  let model = initialModel;
  const textures = {};
  const visited = new Set();
  for (let depth = 0; model && depth < maximumDepth; depth += 1) {
    const key = `${model.namespace}:${model.path}`;
    if (visited.has(key)) return null;
    visited.add(key);
    if (model.path.startsWith('builtin/')) break;
    const document = await readJsonEntry(archive, `assets/${model.namespace}/models/${model.path}.json`);
    if (!document) break;
    if (document.textures && typeof document.textures === 'object' && !Array.isArray(document.textures)) {
      for (const [name, value] of Object.entries(document.textures)) {
        if (textures[name] === undefined && typeof value === 'string') textures[name] = value;
      }
    }
    model = typeof document.parent === 'string' ? normalizeModelReference(document.parent, model.namespace) : null;
  }

  const resolveTexture = (value, seen = new Set()) => {
    if (typeof value !== 'string') return null;
    if (!value.startsWith('#')) return normalizeResourceLocation(value, initialModel.namespace);
    const key = value.slice(1);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    return resolveTexture(textures[key], seen);
  };
  const preferredKeys = ['layer0', 'all', 'top', 'side', 'end', 'particle'];
  for (const key of [...preferredKeys, ...Object.keys(textures)]) {
    const texture = resolveTexture(textures[key]);
    if (texture) return texture;
  }
  return null;
}

function modelFromModernItemDefinition(document, defaultNamespace) {
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 16) return null;
    const type = String(node.type || '');
    if ((!type || type === 'model' || type === 'minecraft:model') && typeof node.model === 'string') {
      return normalizeModelReference(node.model, defaultNamespace);
    }
    // Dynamic item definitions cannot be evaluated without the live stack
    // components. Pick their explicit fallback first, then a deterministic
    // representative model, so the inspector still shows a genuine texture.
    for (const key of ['fallback', 'on_false', 'on_true']) {
      const match = visit(node[key], depth + 1);
      if (match) return match;
    }
    for (const key of ['entries', 'cases', 'models']) {
      if (!Array.isArray(node[key])) continue;
      for (const child of node[key]) {
        const match = visit(child?.model && typeof child.model === 'object' ? child.model : child, depth + 1);
        if (match) return match;
      }
    }
    return typeof node.model === 'object' ? visit(node.model, depth + 1) : null;
  };
  return visit(document?.model);
}

async function resolveItemTexture(archive, resource) {
  const direct = [
    { kind: 'item', path: `assets/${resource.namespace}/textures/item/${resource.path}.png` },
    { kind: 'block', path: `assets/${resource.namespace}/textures/block/${resource.path}.png` }
  ];
  for (const candidate of direct) {
    if (archive.has(candidate.path)) return candidate;
  }

  const modernDefinition = await readJsonEntry(archive, `assets/${resource.namespace}/items/${resource.path}.json`);
  let model = modelFromModernItemDefinition(modernDefinition, resource.namespace);
  if (!model) model = { namespace: resource.namespace, path: `item/${resource.path}` };
  const texture = await modelTextureReference(archive, model);
  if (!texture) return null;
  const texturePath = `assets/${texture.namespace}/textures/${texture.path}.png`;
  return archive.has(texturePath) ? { kind: 'model', path: texturePath } : null;
}

function normalizeItemRequests(itemIds) {
  const source = Array.isArray(itemIds) ? itemIds : [];
  const requests = [];
  const seen = new Set();
  for (const rawValue of source.slice(0, LIMITS.maximumRequestedItems)) {
    const raw = String(rawValue || '').trim().slice(0, 256);
    const resource = normalizeResourceLocation(raw, 'minecraft');
    const key = resource?.id || `invalid:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requests.push({ raw, resource });
  }
  return { requests, truncated: source.length > LIMITS.maximumRequestedItems };
}

function fallbackItems(itemRequests, status) {
  return itemRequests.map(({ raw, resource }) => ({
    id: resource?.id || raw,
    dataUrl: '',
    equipmentDataUrl: '',
    texturePath: '',
    equipmentTexturePath: '',
    kind: '',
    status: resource ? (resource.namespace === 'minecraft' ? status : 'unsupported-namespace') : 'invalid'
  }));
}

function equipmentTexturePath(resource) {
  if (!resource || resource.namespace !== 'minecraft') return '';
  const match = resource.path.match(/^(leather|chainmail|copper|iron|golden|diamond|netherite)_(helmet|chestplate|leggings|boots)$/);
  if (match) {
    const material = match[1] === 'golden' ? 'gold' : match[1];
    const layer = match[2] === 'leggings' ? 'humanoid_leggings' : 'humanoid';
    return `assets/minecraft/textures/entity/equipment/${layer}/${material}.png`;
  }
  if (resource.path === 'turtle_helmet') {
    return 'assets/minecraft/textures/entity/equipment/humanoid/turtle_scute.png';
  }
  return '';
}

function emptyHud() {
  return {
    heart: { empty: '', half: '', full: '' },
    hunger: { empty: '', half: '', full: '' },
    xp: { background: '', progress: '' }
  };
}

function emptyEquipmentSlots() {
  return { helmet: '', chestplate: '', leggings: '', boots: '', offhand: '' };
}

async function readHudAssets(archive) {
  const hud = emptyHud();
  for (const [group, states] of Object.entries(HUD_ENTRY_CANDIDATES)) {
    for (const [state, candidates] of Object.entries(states)) {
      for (const candidate of candidates) {
        if (!archive.has(candidate)) continue;
        hud[group][state] = await readPngEntry(archive, candidate);
        break;
      }
    }
  }
  return hud;
}

async function readEquipmentSlotAssets(archive) {
  const slots = emptyEquipmentSlots();
  for (const [slot, entry] of Object.entries(EQUIPMENT_SLOT_ENTRY_CANDIDATES)) {
    if (archive.has(entry)) slots[slot] = await readPngEntry(archive, entry);
  }
  return slots;
}

async function readAssetsFromClientJar(jarPath, options = {}) {
  const version = options.version ? normalizeVersion(options.version) : '';
  const normalized = normalizeItemRequests(options.itemIds);
  const archive = await SafeZipArchive.open(jarPath);
  try {
    if (version && archive.has('version.json')) {
      const embeddedVersion = await readJsonEntry(archive, 'version.json');
      if (embeddedVersion?.id && String(embeddedVersion.id) !== version) {
        throw new Error('The Minecraft client JAR does not match the requested version.');
      }
    }
    const [hud, equipmentSlots] = await Promise.all([readHudAssets(archive), readEquipmentSlotAssets(archive)]);
    const items = [];
    for (const request of normalized.requests) {
      if (!request.resource) {
        items.push({ id: request.raw, dataUrl: '', equipmentDataUrl: '', texturePath: '', equipmentTexturePath: '', kind: '', status: 'invalid' });
        continue;
      }
      if (request.resource.namespace !== 'minecraft') {
        items.push({ id: request.resource.id, dataUrl: '', equipmentDataUrl: '', texturePath: '', equipmentTexturePath: '', kind: '', status: 'unsupported-namespace' });
        continue;
      }
      const resolved = await resolveItemTexture(archive, request.resource);
      const equipmentPath = equipmentTexturePath(request.resource);
      let equipmentDataUrl = '';
      if (equipmentPath && archive.has(equipmentPath)) {
        try { equipmentDataUrl = await readPngEntry(archive, equipmentPath); } catch {}
      }
      if (!resolved) {
        items.push({ id: request.resource.id, dataUrl: '', equipmentDataUrl, texturePath: '', equipmentTexturePath: equipmentDataUrl ? equipmentPath : '', kind: '', status: 'missing' });
        continue;
      }
      try {
        const dataUrl = await readPngEntry(archive, resolved.path);
        items.push({
          id: request.resource.id,
          dataUrl,
          equipmentDataUrl,
          texturePath: resolved.path,
          equipmentTexturePath: equipmentDataUrl ? equipmentPath : '',
          kind: resolved.kind,
          status: dataUrl ? 'resolved' : 'missing'
        });
      } catch {
        items.push({ id: request.resource.id, dataUrl: '', equipmentDataUrl, texturePath: '', equipmentTexturePath: equipmentDataUrl ? equipmentPath : '', kind: '', status: 'invalid-texture' });
      }
    }
    return { available: true, version, reason: '', truncated: normalized.truncated, hud, equipmentSlots, items };
  } finally {
    await archive.close();
  }
}

async function resolveLocalMinecraftAssets(options = {}) {
  let version;
  const normalized = normalizeItemRequests(options.itemIds);
  try {
    version = normalizeVersion(options.version);
  } catch {
    return {
      available: false,
      version: '',
      reason: 'invalid-version',
      truncated: normalized.truncated,
      hud: emptyHud(),
      equipmentSlots: emptyEquipmentSlots(),
      items: fallbackItems(normalized.requests, 'client-unavailable')
    };
  }
  let client;
  try {
    client = await findLocalMinecraftClientJar(version, { roots: options.roots });
  } catch {
    client = null;
  }
  if (!client) {
    return {
      available: false,
      version,
      reason: 'client-jar-not-found',
      truncated: normalized.truncated,
      hud: emptyHud(),
      equipmentSlots: emptyEquipmentSlots(),
      items: fallbackItems(normalized.requests, 'client-unavailable')
    };
  }
  try {
    const result = await readAssetsFromClientJar(client.jarPath, { version, itemIds: options.itemIds });
    return { ...result, clientVerification: client.verification };
  } catch {
    return {
      available: false,
      version,
      reason: 'client-jar-invalid',
      truncated: normalized.truncated,
      hud: emptyHud(),
      equipmentSlots: emptyEquipmentSlots(),
      items: fallbackItems(normalized.requests, 'client-unavailable')
    };
  }
}

module.exports = {
  EQUIPMENT_SLOT_ENTRY_CANDIDATES,
  HUD_ENTRY_CANDIDATES,
  LIMITS,
  SafeZipArchive,
  crc32,
  defaultMinecraftVersionRoots,
  equipmentTexturePath,
  findLocalMinecraftClientJar,
  normalizeResourceLocation,
  normalizeVersion,
  pngDataUrl,
  readAssetsFromClientJar,
  resolveLocalMinecraftAssets,
  validatePng,
  validateZipEntryName
};
