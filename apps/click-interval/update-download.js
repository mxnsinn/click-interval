'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_UPDATE_PACKAGE_BYTES = 1024 * 1024 * 1024;
const MAX_UPDATE_MANIFEST_BYTES = 256 * 1024;
const MAX_UPDATE_REDIRECTS = 5;
const UPDATE_HEADERS_TIMEOUT_MS = 30_000;
const UPDATE_IDLE_TIMEOUT_MS = 45_000;
const UPDATE_TOTAL_TIMEOUT_MS = 20 * 60_000;
const UPDATE_MANIFEST_TIMEOUT_MS = 15_000;
const PROGRESS_INTERVAL_MS = 100;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class UpdateDownloadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UpdateDownloadError';
    this.code = code;
  }
}

function secureUpdateUrl(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch (_) { throw new UpdateDownloadError('The update download URL is invalid.', 'UPDATE_URL_INVALID'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new UpdateDownloadError('The update download must use HTTPS without embedded credentials.', 'UPDATE_URL_UNSAFE');
  }
  return parsed;
}

function externalAbortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The update download was canceled.');
  error.name = 'AbortError';
  return error;
}

function contentLength(response, maxBytes) {
  const raw = response.headers?.get?.('content-length');
  if (raw == null || raw === '') return null;
  if (!/^\d+$/.test(raw.trim())) {
    throw new UpdateDownloadError('The update server returned an invalid package size.', 'UPDATE_LENGTH_INVALID');
  }
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new UpdateDownloadError('The update server returned an invalid package size.', 'UPDATE_LENGTH_INVALID');
  }
  if (length > maxBytes) {
    throw new UpdateDownloadError(`The update package exceeds the ${Math.floor(maxBytes / 1048576)} MiB safety limit.`, 'UPDATE_TOO_LARGE');
  }
  return length;
}

async function settleCleanup(value, timeoutMs = 250) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve(value),
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })
    ]);
  } catch (_) {
  } finally {
    clearTimeout(timer);
  }
}

async function cancelBody(response) {
  try { await settleCleanup(response?.body?.cancel?.()); } catch (_) {}
}

async function writeAll(file, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await file.write(bytes, offset, bytes.length - offset, null);
    if (!result || result.bytesWritten <= 0) throw new UpdateDownloadError('The update package could not be written to disk.', 'UPDATE_WRITE_FAILED');
    offset += result.bytesWritten;
  }
}

async function fetchWithRedirectLimit(initialUrl, options) {
  const {
    controller,
    deadline,
    fetchImpl,
    headersTimeoutMs,
    maxRedirects,
    setFailure
  } = options;
  let currentUrl = secureUpdateUrl(initialUrl);
  const visited = new Set();

  for (let redirectCount = 0; ; redirectCount += 1) {
    if (visited.has(currentUrl.href)) {
      throw new UpdateDownloadError('The update server returned a redirect loop.', 'UPDATE_REDIRECT_LOOP');
    }
    visited.add(currentUrl.href);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const error = new UpdateDownloadError('The update download exceeded its time limit.', 'UPDATE_TOTAL_TIMEOUT');
      setFailure(error);
      throw error;
    }

    let timeout;
    const headerTimeout = Math.max(1, Math.min(headersTimeoutMs, remaining));
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        const error = new UpdateDownloadError('The update server took too long to respond.', 'UPDATE_HEADERS_TIMEOUT');
        setFailure(error);
        reject(error);
      }, headerTimeout);
    });

    let response;
    try {
      response = await Promise.race([
        fetchImpl(currentUrl.href, {
          cache: 'no-store',
          redirect: 'manual',
          signal: controller.signal
        }),
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timeout);
    }

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirectCount >= maxRedirects) {
      await cancelBody(response);
      throw new UpdateDownloadError(`The update server exceeded the ${maxRedirects}-redirect safety limit.`, 'UPDATE_TOO_MANY_REDIRECTS');
    }
    const location = response.headers?.get?.('location');
    if (!location) {
      await cancelBody(response);
      throw new UpdateDownloadError('The update server returned a redirect without a destination.', 'UPDATE_REDIRECT_INVALID');
    }
    const nextUrl = secureUpdateUrl(new URL(location, currentUrl).href);
    await cancelBody(response);
    currentUrl = nextUrl;
  }
}

async function downloadUpdatePackage(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new UpdateDownloadError('Secure update downloads are not available.', 'UPDATE_FETCH_UNAVAILABLE');
  if (!/^[a-f0-9]{64}$/i.test(String(options.expectedSha256 || ''))) {
    throw new UpdateDownloadError('The published update checksum is invalid.', 'UPDATE_CHECKSUM_INVALID');
  }

  const maxBytes = Math.max(1, Math.min(MAX_UPDATE_PACKAGE_BYTES, Number(options.maxBytes) || MAX_UPDATE_PACKAGE_BYTES));
  const maxRedirects = Math.max(0, Math.min(MAX_UPDATE_REDIRECTS, Number.isInteger(options.maxRedirects) ? options.maxRedirects : MAX_UPDATE_REDIRECTS));
  const headersTimeoutMs = Math.max(1, Math.min(UPDATE_HEADERS_TIMEOUT_MS, Number(options.headersTimeoutMs) || UPDATE_HEADERS_TIMEOUT_MS));
  const idleTimeoutMs = Math.max(1, Math.min(UPDATE_IDLE_TIMEOUT_MS, Number(options.idleTimeoutMs) || UPDATE_IDLE_TIMEOUT_MS));
  const totalTimeoutMs = Math.max(1, Math.min(UPDATE_TOTAL_TIMEOUT_MS, Number(options.totalTimeoutMs) || UPDATE_TOTAL_TIMEOUT_MS));
  const destinationPath = path.resolve(String(options.destinationPath || ''));
  if (!options.destinationPath || destinationPath === path.parse(destinationPath).root) {
    throw new UpdateDownloadError('The update destination is invalid.', 'UPDATE_DESTINATION_INVALID');
  }

  const controller = new AbortController();
  const externalSignal = options.signal;
  let failure = null;
  let response = null;
  let file = null;
  let temporaryPath = '';
  let totalTimer = null;
  let succeeded = false;
  const deadline = Date.now() + totalTimeoutMs;
  const setFailure = error => {
    if (!failure) failure = error;
    if (!controller.signal.aborted) controller.abort(error);
  };
  const onExternalAbort = () => {
    if (!controller.signal.aborted) controller.abort(externalSignal.reason);
  };

  if (externalSignal?.aborted) throw externalAbortError(externalSignal);
  externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
  totalTimer = setTimeout(() => {
    setFailure(new UpdateDownloadError('The update download exceeded its time limit.', 'UPDATE_TOTAL_TIMEOUT'));
  }, totalTimeoutMs);

  try {
    response = await fetchWithRedirectLimit(options.url, {
      controller,
      deadline,
      fetchImpl,
      headersTimeoutMs,
      maxRedirects,
      setFailure
    });
    if (!response?.ok || !response.body) {
      throw new UpdateDownloadError(`The update server returned ${response?.status ?? 'an invalid response'}.`, 'UPDATE_HTTP_ERROR');
    }

    const expectedLength = contentLength(response, maxBytes);
    const encoded = String(response.headers?.get?.('content-encoding') || '').trim().toLowerCase();
    const enforceExactLength = expectedLength != null && (!encoded || encoded === 'identity');
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    temporaryPath = `${destinationPath}.download-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
    file = await fs.promises.open(temporaryPath, 'wx', 0o600);

    const hash = crypto.createHash('sha256');
    const iterator = response.body[Symbol.asyncIterator]?.();
    if (!iterator) throw new UpdateDownloadError('The update server returned an unreadable package.', 'UPDATE_BODY_INVALID');
    let received = 0;
    let lastProgressAt = 0;
    let completed = false;

    try {
      while (!completed) {
        if (externalSignal?.aborted) throw externalAbortError(externalSignal);
        if (failure) throw failure;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          const error = new UpdateDownloadError('The update download exceeded its time limit.', 'UPDATE_TOTAL_TIMEOUT');
          setFailure(error);
          throw error;
        }
        let idleTimer;
        const next = await Promise.race([
          iterator.next(),
          new Promise((_, reject) => {
            idleTimer = setTimeout(() => {
              const error = new UpdateDownloadError('The update download stopped making progress.', 'UPDATE_IDLE_TIMEOUT');
              setFailure(error);
              reject(error);
            }, Math.max(1, Math.min(idleTimeoutMs, remaining)));
          })
        ]).finally(() => clearTimeout(idleTimer));
        completed = Boolean(next.done);
        if (completed) break;
        const bytes = Buffer.from(next.value || []);
        if (!bytes.length) continue;
        received += bytes.length;
        if (received > maxBytes || (enforceExactLength && received > expectedLength)) {
          const error = new UpdateDownloadError(`The update package exceeded its declared or ${Math.floor(maxBytes / 1048576)} MiB safety limit.`, 'UPDATE_STREAM_TOO_LARGE');
          setFailure(error);
          throw error;
        }
        await writeAll(file, bytes);
        hash.update(bytes);
        const now = Date.now();
        if (typeof options.onProgress === 'function' && (lastProgressAt === 0 || now - lastProgressAt >= PROGRESS_INTERVAL_MS)) {
          lastProgressAt = now;
          options.onProgress({ received, total: expectedLength });
        }
      }
    } finally {
      if (!completed) {
        try { await settleCleanup(iterator.return?.()); } catch (_) {}
      }
    }

    if (received === 0) throw new UpdateDownloadError('The update server returned an empty package.', 'UPDATE_EMPTY_PACKAGE');
    if (enforceExactLength && received !== expectedLength) {
      throw new UpdateDownloadError('The update download ended before the declared package size was received.', 'UPDATE_LENGTH_MISMATCH');
    }
    if (externalSignal?.aborted) throw externalAbortError(externalSignal);
    if (failure) throw failure;
    if (typeof options.onProgress === 'function') options.onProgress({ received, total: expectedLength });
    const digest = hash.digest('hex');
    if (digest.toLowerCase() !== String(options.expectedSha256).toLowerCase()) {
      throw new UpdateDownloadError('The downloaded update failed its security check.', 'UPDATE_CHECKSUM_MISMATCH');
    }

    await file.sync();
    if (externalSignal?.aborted) throw externalAbortError(externalSignal);
    if (failure || Date.now() > deadline) {
      const error = failure || new UpdateDownloadError('The update download exceeded its time limit.', 'UPDATE_TOTAL_TIMEOUT');
      setFailure(error);
      throw error;
    }
    await file.close();
    file = null;
    try {
      await fs.promises.rename(temporaryPath, destinationPath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      await fs.promises.rm(destinationPath, { force: true });
      await fs.promises.rename(temporaryPath, destinationPath);
    }
    temporaryPath = '';
    succeeded = true;
    return { destinationPath, bytes: received, sha256: digest };
  } catch (error) {
    if (externalSignal?.aborted) throw externalAbortError(externalSignal);
    if (failure) throw failure;
    throw error;
  } finally {
    clearTimeout(totalTimer);
    externalSignal?.removeEventListener?.('abort', onExternalAbort);
    if (file) {
      try { await file.close(); } catch (_) {}
    }
    if (temporaryPath) {
      try { await fs.promises.rm(temporaryPath, { force: true }); } catch (_) {}
    }
    if (!succeeded) await cancelBody(response);
  }
}

async function fetchBoundedUpdateManifest(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new UpdateDownloadError('Secure update checks are not available.', 'UPDATE_FETCH_UNAVAILABLE');
  const maxBytes = Math.max(1, Math.min(MAX_UPDATE_MANIFEST_BYTES, Number(options.maxBytes) || MAX_UPDATE_MANIFEST_BYTES));
  const timeoutMs = Math.max(1, Math.min(UPDATE_MANIFEST_TIMEOUT_MS, Number(options.timeoutMs) || UPDATE_MANIFEST_TIMEOUT_MS));
  const maxRedirects = Math.max(0, Math.min(MAX_UPDATE_REDIRECTS, Number.isInteger(options.maxRedirects) ? options.maxRedirects : MAX_UPDATE_REDIRECTS));
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let failure = null;
  let response = null;
  let timer = null;
  let succeeded = false;
  const setFailure = error => {
    if (!failure) failure = error;
    if (!controller.signal.aborted) controller.abort(error);
  };
  timer = setTimeout(() => {
    setFailure(new UpdateDownloadError('The update check exceeded its time limit.', 'UPDATE_MANIFEST_TIMEOUT'));
  }, timeoutMs);

  try {
    response = await fetchWithRedirectLimit(options.url, {
      controller,
      deadline,
      fetchImpl,
      headersTimeoutMs: timeoutMs,
      maxRedirects,
      setFailure
    });
    if (!response?.ok || !response.body) {
      throw new UpdateDownloadError(`Update server returned ${response?.status ?? 'an invalid response'}.`, 'UPDATE_MANIFEST_HTTP_ERROR');
    }

    const declaredLength = response.headers?.get?.('content-length');
    let expectedLength = null;
    if (declaredLength != null && declaredLength !== '') {
      if (!/^\d+$/.test(declaredLength.trim())) {
        throw new UpdateDownloadError('The update server returned an invalid manifest size.', 'UPDATE_MANIFEST_LENGTH_INVALID');
      }
      expectedLength = Number(declaredLength);
      if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) {
        throw new UpdateDownloadError('The update server returned an invalid manifest size.', 'UPDATE_MANIFEST_LENGTH_INVALID');
      }
      if (expectedLength > maxBytes) {
        throw new UpdateDownloadError(`The update manifest exceeds the ${maxBytes}-byte safety limit.`, 'UPDATE_MANIFEST_TOO_LARGE');
      }
    }

    const encoded = String(response.headers?.get?.('content-encoding') || '').trim().toLowerCase();
    const enforceExactLength = expectedLength != null && (!encoded || encoded === 'identity');
    const iterator = response.body[Symbol.asyncIterator]?.();
    if (!iterator) throw new UpdateDownloadError('The update server returned an unreadable manifest.', 'UPDATE_MANIFEST_BODY_INVALID');
    const bodyBytes = Buffer.allocUnsafe(maxBytes);
    let received = 0;
    let completed = false;
    try {
      while (!completed) {
        if (failure) throw failure;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          const error = new UpdateDownloadError('The update check exceeded its time limit.', 'UPDATE_MANIFEST_TIMEOUT');
          setFailure(error);
          throw error;
        }
        let bodyTimer;
        const next = await Promise.race([
          iterator.next(),
          new Promise((_, reject) => {
            bodyTimer = setTimeout(() => {
              const error = new UpdateDownloadError('The update check exceeded its time limit.', 'UPDATE_MANIFEST_TIMEOUT');
              setFailure(error);
              reject(error);
            }, remaining);
          })
        ]).finally(() => clearTimeout(bodyTimer));
        completed = Boolean(next.done);
        if (completed) break;
        const bytes = Buffer.from(next.value || []);
        if (!bytes.length) continue;
        const nextReceived = received + bytes.length;
        if (nextReceived > maxBytes || (enforceExactLength && nextReceived > expectedLength)) {
          const error = new UpdateDownloadError(`The update manifest exceeds the ${maxBytes}-byte safety limit.`, 'UPDATE_MANIFEST_TOO_LARGE');
          setFailure(error);
          throw error;
        }
        bytes.copy(bodyBytes, received);
        received = nextReceived;
      }
    } finally {
      if (!completed) {
        try { await settleCleanup(iterator.return?.()); } catch (_) {}
      }
    }

    if (failure || Date.now() > deadline) {
      const error = failure || new UpdateDownloadError('The update check exceeded its time limit.', 'UPDATE_MANIFEST_TIMEOUT');
      setFailure(error);
      throw error;
    }
    if (enforceExactLength && received !== expectedLength) {
      throw new UpdateDownloadError('The update manifest ended before its declared size was received.', 'UPDATE_MANIFEST_LENGTH_MISMATCH');
    }
    let manifest;
    try { manifest = JSON.parse(bodyBytes.subarray(0, received).toString('utf8')); }
    catch (_) { throw new UpdateDownloadError('The update server returned an invalid manifest.', 'UPDATE_MANIFEST_INVALID'); }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new UpdateDownloadError('The update server returned an invalid manifest.', 'UPDATE_MANIFEST_INVALID');
    }
    succeeded = true;
    return manifest;
  } catch (error) {
    if (failure) throw failure;
    throw error;
  } finally {
    clearTimeout(timer);
    if (!succeeded) await cancelBody(response);
  }
}

module.exports = {
  MAX_UPDATE_MANIFEST_BYTES,
  MAX_UPDATE_PACKAGE_BYTES,
  MAX_UPDATE_REDIRECTS,
  UPDATE_HEADERS_TIMEOUT_MS,
  UPDATE_IDLE_TIMEOUT_MS,
  UPDATE_MANIFEST_TIMEOUT_MS,
  UPDATE_TOTAL_TIMEOUT_MS,
  UpdateDownloadError,
  downloadUpdatePackage,
  fetchBoundedUpdateManifest,
  secureUpdateUrl
};
