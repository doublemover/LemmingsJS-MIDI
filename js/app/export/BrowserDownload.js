const MAX_BROWSER_DOWNLOAD_BYTES = 128 * 1048576;
const URL_REVOKE_DELAY_MS = 1000;

// An anchor click is evidence that a download was requested, not that the
// browser offered, accepted, or saved the file.
export function requestBrowserDownload({ document, windowRef = globalThis, bytes, filename, mediaType = 'application/octet-stream' }) {
  if (typeof filename !== 'string' || !filename || filename.length > 160 || /[\\/\x00-\x1f]/.test(filename))
    throw new TypeError('Invalid download filename.');
  const BlobType = windowRef.Blob || Blob;
  const blob = bytes instanceof BlobType ? bytes : new BlobType([bytes], { type: mediaType });
  if (blob.size > MAX_BROWSER_DOWNLOAD_BYTES) throw new RangeError('Browser download exceeds the 128 MiB staging limit.');
  const urlApi = windowRef.URL || URL;
  const url = urlApi.createObjectURL(blob);
  let link = null, requested = false;
  const revoke = () => urlApi.revokeObjectURL(url);
  try {
    link = document.createElement('a');
    link.href = url; link.download = filename;
    if (document.body.append) document.body.append(link); else document.body.appendChild(link);
    link.click(); requested = true;
    return { state: 'delivery-requested', evidence: 'anchor-click-returned', filename, byteLength: blob.size };
  } finally {
    try {
      if (link?.remove) link.remove(); else if (link?.parentNode) link.parentNode.removeChild(link);
    } finally {
      if (requested) {
        try {
          if (typeof windowRef.setTimeout === 'function') windowRef.setTimeout(revoke, URL_REVOKE_DELAY_MS);
          else setTimeout(revoke, URL_REVOKE_DELAY_MS);
        }
        catch { revoke(); }
      } else revoke();
    }
  }
}

export { MAX_BROWSER_DOWNLOAD_BYTES };
