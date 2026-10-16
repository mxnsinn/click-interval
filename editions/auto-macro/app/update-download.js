'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { secureHttpsUrl } = require('./update-manifest');

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

async function cancelResponse(response) {
  try { await response?.body?.cancel?.(); } catch (_) {}
}

async function fetchWithLimits(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Secure update downloads are unavailable.');
  // Validate before allocating timers/listeners. An invalid URL must fail
  // synchronously without leaving a long-lived timeout behind.
  let current = secureHttpsUrl(url).href;
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(20 * 60_000, Number(options.timeoutMs) || 30_000));
  const externalSignal = options.signal;
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) throw externalSignal.reason || new Error('The update download was canceled.');
  externalSignal?.addEventListener?.('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('The update server timed out.')), timeoutMs);
  const visited = new Set();
  try {
    for (let redirects = 0; ; redirects += 1) {
      if (visited.has(current)) throw new Error('The update server returned a redirect loop.');
      visited.add(current);
      let response;
      try {
        response = await fetchImpl(current, { cache: 'no-store', redirect: 'manual', signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason || error;
        throw error;
      }
      if (!REDIRECT_CODES.has(response.status)) return response;
      if (redirects >= MAX_REDIRECTS) {
        await cancelResponse(response);
        throw new Error('The update server returned too many redirects.');
      }
      const location = response.headers?.get?.('location');
      if (!location) {
        await cancelResponse(response);
        throw new Error('The update server returned an invalid redirect.');
      }
      const next = secureHttpsUrl(new URL(location, current).href).href;
      await cancelResponse(response);
      current = next;
    }
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abort);
  }
}

function declaredLength(response, maxBytes) {
  const raw = response.headers?.get?.('content-length');
  if (raw == null || raw === '') return null;
  if (!/^\d+$/.test(raw.trim())) throw new Error('The update server returned an invalid content length.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maxBytes) throw new Error('The update download is larger than allowed.');
  return value;
}

async function readBoundedResponse(response, maxBytes, onChunk, options = {}) {
  if (!response?.ok || !response.body) throw new Error(`The update server returned ${response?.status ?? 'an invalid response'}.`);
  const expected = declaredLength(response, maxBytes);
  const enforceLength = expected != null && !String(response.headers?.get?.('content-encoding') || '').trim();
  const chunks = onChunk ? null : [];
  const totalTimeoutMs = Math.max(1000, Math.min(20 * 60_000, Number(options.totalTimeoutMs) || 20 * 60_000));
  const idleTimeoutMs = Math.max(1000, Math.min(60_000, Number(options.idleTimeoutMs) || 45_000));
  const deadline = Date.now() + totalTimeoutMs;
  const iterator = response.body[Symbol.asyncIterator]?.();
  if (!iterator) throw new Error('The update server returned an unreadable response.');
  let received = 0;
  let completed = false;
  try {
    while (!completed) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('The update download exceeded its time limit.');
      let timer;
      const next = await Promise.race([
        iterator.next(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('The update download stopped making progress.')), Math.min(remaining, idleTimeoutMs));
        })
      ]).finally(() => clearTimeout(timer));
      completed = Boolean(next.done);
      if (completed) break;
      const bytes = Buffer.from(next.value || []);
      if (!bytes.length) continue;
      received += bytes.length;
      if (received > maxBytes || (enforceLength && received > expected)) throw new Error('The update download exceeded its allowed size.');
      if (onChunk) await onChunk(bytes, received, expected);
      else chunks.push(bytes);
    }
  } finally {
    if (!completed) {
      try { await iterator.return?.(); } catch (_) {}
      await cancelResponse(response);
    }
  }
  if (received === 0) throw new Error('The update server returned an empty response.');
  if (enforceLength && received !== expected) throw new Error('The update download ended before its declared size.');
  return onChunk ? { received, expected } : Buffer.concat(chunks, received);
}

async function fetchUpdateEnvelope(url, options = {}) {
  const maxBytes = Math.max(1024, Math.min(256 * 1024, Number(options.maxBytes) || 256 * 1024));
  const response = await fetchWithLimits(url, { ...options, timeoutMs: options.timeoutMs || 15_000 });
  const bytes = await readBoundedResponse(response, maxBytes, null, {
    totalTimeoutMs: options.totalTimeoutMs || options.timeoutMs || 15_000,
    idleTimeoutMs: options.idleTimeoutMs || options.timeoutMs || 10_000
  });
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (_) { throw new Error('The update service returned invalid JSON.'); }
}

async function downloadVerifiedFile(options = {}) {
  const destinationPath = path.resolve(String(options.destinationPath || ''));
  const expectedSize = Number(options.expectedSize);
  const expectedSha256 = String(options.expectedSha256 || '').toLowerCase();
  if (!options.destinationPath || destinationPath === path.parse(destinationPath).root) throw new Error('The update destination is invalid.');
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('The expected update file identity is invalid.');
  }
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.part-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  let handle;
  try {
    handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    const response = await fetchWithLimits(options.url, { signal: options.signal, timeoutMs: options.timeoutMs || 20 * 60_000, fetchImpl: options.fetchImpl });
    const { received } = await readBoundedResponse(response, expectedSize, async (bytes, totalReceived) => {
      if (totalReceived > expectedSize) throw new Error('The update file is larger than its signed size.');
      await handle.write(bytes);
      hash.update(bytes);
      options.onProgress?.(totalReceived, expectedSize);
    }, { totalTimeoutMs: options.timeoutMs || 20 * 60_000, idleTimeoutMs: options.idleTimeoutMs || 45_000 });
    if (received !== expectedSize || hash.digest('hex') !== expectedSha256) throw new Error('An update file failed its signed checksum.');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.promises.rename(temporaryPath, destinationPath);
    return { bytes: received, destinationPath };
  } catch (error) {
    try { await handle?.close(); } catch (_) {}
    try { await fs.promises.rm(temporaryPath, { force: true }); } catch (_) {}
    throw error;
  }
}

module.exports = { downloadVerifiedFile, fetchUpdateEnvelope, fetchWithLimits };
