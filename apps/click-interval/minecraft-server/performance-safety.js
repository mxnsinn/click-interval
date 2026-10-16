'use strict';

const fs = require('fs/promises');
const path = require('path');

const DEFAULT_DIRECTORY_LIMITS = Object.freeze({
  maxEntries: 50_000,
  maxDirectories: 8_000,
  maxDurationMs: 2_000,
  concurrency: 8
});

const FABRIC_ANTI_XRAY_MIN_HEAP_MB = 4096;
const FABRIC_ANTI_XRAY_RECOMMENDED_HEAP_MB = 6144;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const items = Array.from(values || []);
  if (!items.length) return [];
  const results = new Array(items.length);
  const workerCount = Math.min(items.length, positiveInteger(concurrency, 4, 32));
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function measureDirectoryBounded(root, options = {}) {
  const maxEntries = positiveInteger(options.maxEntries, DEFAULT_DIRECTORY_LIMITS.maxEntries, 500_000);
  const maxDirectories = positiveInteger(options.maxDirectories, DEFAULT_DIRECTORY_LIMITS.maxDirectories, 100_000);
  const maxDurationMs = positiveInteger(options.maxDurationMs, DEFAULT_DIRECTORY_LIMITS.maxDurationMs, 30_000);
  const concurrency = positiveInteger(options.concurrency, DEFAULT_DIRECTORY_LIMITS.concurrency, 32);
  const deadline = Date.now() + maxDurationMs;
  const directories = [path.resolve(root)];
  let directoryCursor = 0;
  let entriesVisited = 0;
  let filesVisited = 0;
  let bytes = 0;
  let truncated = false;

  while (directoryCursor < directories.length) {
    if (Date.now() >= deadline || entriesVisited >= maxEntries || directoryCursor >= maxDirectories) {
      truncated = true;
      break;
    }
    const directory = directories[directoryCursor++];
    const entries = [];
    let directoryHandle;
    let exhausted = false;
    try {
      directoryHandle = await fs.opendir(directory, { bufferSize: 64 });
      const remaining = maxEntries - entriesVisited;
      while (entries.length < remaining && Date.now() < deadline) {
        const entry = await directoryHandle.read();
        if (!entry) {
          exhausted = true;
          break;
        }
        entries.push(entry);
      }
    } catch {
      continue;
    } finally {
      await directoryHandle?.close().catch(() => {});
    }
    if (!exhausted) truncated = true;
    entriesVisited += entries.length;
    const files = [];
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (directories.length < maxDirectories) directories.push(file);
        else truncated = true;
      } else if (entry.isFile()) {
        files.push(file);
      }
    }
    const sizes = await mapWithConcurrency(files, concurrency, async (file) => {
      if (Date.now() >= deadline) return null;
      try {
        const stat = await fs.stat(file);
        return stat.isFile() ? stat.size : 0;
      } catch {
        return 0;
      }
    });
    for (const size of sizes) {
      if (size === null) {
        truncated = true;
        continue;
      }
      filesVisited += 1;
      bytes += size;
    }
    if (Date.now() >= deadline && directoryCursor < directories.length) truncated = true;
  }

  return {
    bytes,
    entriesVisited,
    filesVisited,
    directoriesVisited: directoryCursor,
    truncated
  };
}

function safeJavaMemoryMb(requestedMb, totalMemoryMb, freeMemoryMb) {
  const total = Math.floor(Number(totalMemoryMb));
  const freeValue = Math.floor(Number(freeMemoryMb));
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(freeValue) || freeValue <= 0) return 0;
  const free = Math.min(total, freeValue);
  const requested = positiveInteger(requestedMb, 2048, 131_072);
  const reserve = Math.max(1024, Math.min(4096, Math.floor(total * 0.2)));
  const physicalCeiling = Math.min(32 * 1024, Math.floor(total * 0.7), total - reserve);
  const currentCeiling = free - Math.min(2048, reserve);
  const safeCeiling = Math.floor(Math.min(physicalCeiling, currentCeiling));
  if (safeCeiling < 512) return 0;
  return Math.max(512, Math.min(requested, safeCeiling));
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function planMinecraftStartupResources(config = {}, options = {}) {
  const fabricAntiXrayEnabled = Boolean(options.fabricAntiXrayEnabled);
  const requestedMemoryMb = clampInteger(config.memoryMb, 512, 131_072, 2048);
  const requestedViewDistance = clampInteger(config.viewDistance, 2, 32, 10);
  const requestedSimulationDistance = clampInteger(config.simulationDistance, 2, 32, 10);
  const requiredMemoryMb = fabricAntiXrayEnabled ? FABRIC_ANTI_XRAY_MIN_HEAP_MB : 512;
  const recommendedMemoryMb = fabricAntiXrayEnabled && requestedViewDistance > 24
    ? FABRIC_ANTI_XRAY_RECOMMENDED_HEAP_MB
    : requiredMemoryMb;
  const effectiveMemoryMb = safeJavaMemoryMb(
    requestedMemoryMb,
    options.totalMemoryMb,
    options.freeMemoryMb
  );
  return {
    config: {
      ...config,
      memoryMb: requestedMemoryMb,
      viewDistance: requestedViewDistance,
      simulationDistance: requestedSimulationDistance
    },
    changes: [],
    requestedMemoryMb,
    effectiveMemoryMb,
    requiredMemoryMb,
    recommendedMemoryMb,
    canStart: effectiveMemoryMb >= requiredMemoryMb,
    fabricAntiXrayEnabled
  };
}

class BoundedChunkQueue {
  constructor(maxCharacters, maxChunks = 256) {
    this.maxCharacters = positiveInteger(maxCharacters, 1);
    this.maxChunks = positiveInteger(maxChunks, 256, 4096);
    this.chunks = [];
    this.length = 0;
  }

  append(value, metadata = null) {
    let text = String(value ?? '');
    if (!text) return 0;
    let dropped = 0;
    if (text.length > this.maxCharacters) {
      dropped += text.length - this.maxCharacters;
      text = text.slice(-this.maxCharacters);
    }
    this.chunks.push({ text, metadata });
    this.length += text.length;
    while (this.chunks.length > this.maxChunks) {
      const removed = this.chunks.shift();
      this.length -= removed.text.length;
      dropped += removed.text.length;
    }
    dropped += this.retainLatest(this.maxCharacters);
    return dropped;
  }

  retainLatest(maxCharacters) {
    const limit = Math.max(0, Math.min(this.maxCharacters, Math.floor(Number(maxCharacters)) || 0));
    let toDrop = Math.max(0, this.length - limit);
    const dropped = toDrop;
    while (toDrop > 0 && this.chunks.length) {
      const first = this.chunks[0];
      if (first.text.length <= toDrop) {
        this.chunks.shift();
        this.length -= first.text.length;
        toDrop -= first.text.length;
      } else {
        first.text = first.text.slice(toDrop);
        this.length -= toDrop;
        toDrop = 0;
      }
    }
    return dropped;
  }

  drain(maxCharacters = this.maxCharacters) {
    let remaining = positiveInteger(maxCharacters, this.maxCharacters, this.maxCharacters);
    const drained = [];
    while (remaining > 0 && this.chunks.length) {
      const first = this.chunks[0];
      if (first.text.length <= remaining) {
        this.chunks.shift();
        this.length -= first.text.length;
        remaining -= first.text.length;
        drained.push(first);
      } else {
        const text = first.text.slice(0, remaining);
        first.text = first.text.slice(remaining);
        this.length -= text.length;
        drained.push({ text, metadata: first.metadata });
        remaining = 0;
      }
    }
    return drained;
  }

  clear() {
    const dropped = this.length;
    this.chunks.length = 0;
    this.length = 0;
    return dropped;
  }
}

class BoundedTextBuffer {
  constructor(maxCharacters, maxChunks = 2048) {
    this.maxCharacters = positiveInteger(maxCharacters, 1);
    this.maxChunks = positiveInteger(maxChunks, 2048, 8192);
    this.chunks = [];
    this.length = 0;
  }

  append(value) {
    let text = String(value ?? '');
    if (!text) return 0;
    let dropped = 0;
    if (text.length >= this.maxCharacters) {
      dropped = this.length + text.length - this.maxCharacters;
      this.chunks = [text.slice(-this.maxCharacters)];
      this.length = this.maxCharacters;
      return dropped;
    }
    const lastIndex = this.chunks.length - 1;
    if (lastIndex >= 0 && this.chunks[lastIndex].length + text.length <= 4096) {
      this.chunks[lastIndex] += text;
    } else {
      this.chunks.push(text);
    }
    this.length += text.length;
    while (this.length > this.maxCharacters && this.chunks.length) {
      const overflow = this.length - this.maxCharacters;
      const first = this.chunks[0];
      if (first.length <= overflow) {
        this.chunks.shift();
        this.length -= first.length;
        dropped += first.length;
      } else {
        this.chunks[0] = first.slice(overflow);
        this.length -= overflow;
        dropped += overflow;
      }
    }
    if (this.chunks.length > this.maxChunks) {
      const mergeCount = this.chunks.length - this.maxChunks + 1;
      const merged = this.chunks.splice(0, mergeCount).join('');
      this.chunks.unshift(merged);
    }
    return dropped;
  }

  clear() {
    this.chunks.length = 0;
    this.length = 0;
  }

  drain() {
    const value = this.toString();
    this.clear();
    return value;
  }

  toString() {
    return this.chunks.join('');
  }
}

async function readFileTailUtf8(file, maximumBytes) {
  const limit = positiveInteger(maximumBytes, 512 * 1024, 8 * 1024 * 1024);
  let handle;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size <= 0) return '';
    const bytesToRead = Math.min(stat.size, limit);
    const buffer = Buffer.allocUnsafe(bytesToRead);
    handle = await fs.open(file, 'r');
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (stat.size > bytesToRead) {
      const firstLineEnd = text.indexOf('\n');
      if (firstLineEnd >= 0) text = text.slice(firstLineEnd + 1);
    }
    return text;
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readFileEdges(file, edgeBytes = 8 * 1024 * 1024, maximumFileBytes = 768 * 1024 * 1024) {
  const edgeLimit = positiveInteger(edgeBytes, 8 * 1024 * 1024, 32 * 1024 * 1024);
  const fileLimit = positiveInteger(maximumFileBytes, 768 * 1024 * 1024, 2 * 1024 * 1024 * 1024);
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > fileLimit) throw new Error('File has an unsafe size.');
  const handle = await fs.open(file, 'r');
  try {
    if (stat.size <= edgeLimit * 2) {
      const buffer = Buffer.allocUnsafe(stat.size);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    }
    const head = Buffer.allocUnsafe(edgeLimit);
    const tail = Buffer.allocUnsafe(edgeLimit);
    const [headRead, tailRead] = await Promise.all([
      handle.read(head, 0, head.length, 0),
      handle.read(tail, 0, tail.length, stat.size - edgeLimit)
    ]);
    return Buffer.concat([
      head.subarray(0, headRead.bytesRead),
      tail.subarray(0, tailRead.bytesRead)
    ]);
  } finally {
    await handle.close();
  }
}

module.exports = {
  BoundedChunkQueue,
  BoundedTextBuffer,
  FABRIC_ANTI_XRAY_MIN_HEAP_MB,
  FABRIC_ANTI_XRAY_RECOMMENDED_HEAP_MB,
  mapWithConcurrency,
  measureDirectoryBounded,
  planMinecraftStartupResources,
  readFileEdges,
  readFileTailUtf8,
  safeJavaMemoryMb
};
