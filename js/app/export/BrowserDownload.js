const MAX_BROWSER_DOWNLOAD_BYTES = 128 * 1048576;
const URL_REVOKE_DELAY_MS = 1000;
const MAX_ACTIVE_URLS = 16, MAX_URL_SOURCE_BYTES = 256 * 1048576;
const ownedUrls = new Set(); let ownedSourceBytes = 0, retirementCallbackFailures = 0, anchorCleanupFailures = 0;

export const browserDownloadDiagnostics = () => Object.freeze({ sourceOwners: ownedUrls.size, activeUrls: [...ownedUrls].filter(owner => !owner.revoked).length, sourceBytes: ownedSourceBytes,
  unknownRetirement: [...ownedUrls].filter(owner => !owner.revoked && owner.error).length,
  sourceRetirementFailures: [...ownedUrls].filter(owner => owner.revoked && owner.callbackError).length,
  retirementCallbackFailures, anchorCleanupFailures, maxActiveUrls: MAX_ACTIVE_URLS, maxSourceBytes: MAX_URL_SOURCE_BYTES });

// An anchor click is evidence that a download was requested, not that the
// browser offered, accepted, or saved the file.
export function requestBrowserDownload({ document, windowRef = globalThis, bytes, filename, mediaType = 'application/octet-stream', onURLAcquired = () => {}, onURLRetired = () => {} }) {
  if (typeof filename !== 'string' || !filename || filename.length > 160 || /[\\/\x00-\x1f]/.test(filename))
    throw new TypeError('Invalid download filename.');
  if (typeof onURLRetired !== 'function' || typeof onURLAcquired !== 'function') throw new TypeError('Invalid download ownership observer.');
  if (ownedUrls.size >= MAX_ACTIVE_URLS) throw new RangeError('Prior browser download resources still occupy delivery capacity.');
  const BlobType = windowRef.Blob || Blob;
  const blob = bytes instanceof BlobType ? bytes : new BlobType([bytes], { type: mediaType });
  if (blob.size > MAX_BROWSER_DOWNLOAD_BYTES) throw new RangeError('Browser download exceeds the 128 MiB staging limit.');
  if (ownedSourceBytes + blob.size > MAX_URL_SOURCE_BYTES) throw new RangeError('Browser download URL sources exceed their retained byte limit.');
  const urlApi = windowRef.URL || URL;
  const url = urlApi.createObjectURL(blob);
  const owner = { url, urlApi, onURLRetired, bytes: blob.size, attempted: false, error: null, revoked: false, callbackError: null }; ownedUrls.add(owner); ownedSourceBytes += blob.size;
  let link = null, requested = false, failed = false, cleanupFailed = false, operationError = null, cleanupError = null;
  const revoke = () => {
    if (owner.attempted) return; owner.attempted = true;
    try {
      const acknowledged = urlApi.revokeObjectURL(url);
      if (acknowledged === false || acknowledged && typeof acknowledged.then === 'function') {
        if (acknowledged?.then) Promise.resolve(acknowledged).catch(() => {});
        throw new Error('Browser URL revocation was not acknowledged synchronously.');
      }
      owner.revoked = true; ownedUrls.delete(owner); ownedSourceBytes -= owner.bytes;
    } catch (error) { owner.error = error instanceof Error ? error : new Error(String(error)); }
    try { owner.onURLRetired(Object.freeze({ state: owner.error ? 'failed-or-unknown' : 'revoked', error: owner.error ? String(owner.error.message).slice(0, 240) : null })); }
    catch (error) { owner.callbackError = error instanceof Error ? error : new Error(String(error)); ownedUrls.add(owner); retirementCallbackFailures++; }
  };
  try {
    onURLAcquired();
    link = document.createElement('a');
    link.href = url; link.download = filename;
    if (document.body.append) document.body.append(link); else document.body.appendChild(link);
    link.click(); requested = true;
  } catch (error) { operationError = error; failed = true; }
  finally {
    try {
      if (link?.remove) link.remove(); else if (link?.parentNode) link.parentNode.removeChild(link);
    } catch (error) { cleanupError = error; cleanupFailed = true; anchorCleanupFailures++; }
    finally {
      if (requested) {
        try {
          if (typeof windowRef.setTimeout === 'function') windowRef.setTimeout(revoke, URL_REVOKE_DELAY_MS);
          else setTimeout(revoke, URL_REVOKE_DELAY_MS);
        }
        catch { revoke(); }
      } else revoke();
    }
  }
  if (failed) {
    if (cleanupFailed) throw Object.assign(new Error('Download request failed and anchor cleanup was incomplete.'), { cause: operationError, cleanupError });
    throw operationError instanceof Error ? operationError : new Error('Download request failed.', { cause: operationError });
  }
  return { state: 'delivery-requested', evidence: 'anchor-click-returned', filename, byteLength: blob.size,
    ...(cleanupFailed ? { cleanupState: 'failed-or-unknown' } : {}) };
}

export { MAX_BROWSER_DOWNLOAD_BYTES };
