const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

export async function* readOwnedNdjsonLines(source, { maxBytes, maxLineBytes, resourceBudget = null, signal, yieldControl = yieldTask } = {}) {
  if ((!source?.[Symbol.asyncIterator] && !source?.[Symbol.iterator]) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1048576 ||
      !Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1 || maxLineBytes > maxBytes || typeof yieldControl !== 'function') throw new TypeError('Invalid owned NDJSON source or bounds.');
  const create = () => ({ pieces: [], bytes: 0, capacity: 0, tail: null, tailUsed: 0, releaseAttempted: false, held: false, token: {} });
  let record = create(), totalBytes = 0, workBytes = 0;
  const retire = owned => {
    if (owned.releaseAttempted) return; owned.releaseAttempted = true; owned.pieces = []; owned.tail = null;
    if (owned.held) {
      const ack = resourceBudget.release({ token: owned.token, owner: 'ndjson-source-line' });
      if (ack === false || ack && typeof ack.then === 'function') { if (ack?.then) Promise.resolve(ack).catch(() => {}); throw new Error('NDJSON source line retirement is unresolved.'); }
    }
  };
  try {
    for await (const part of source) {
      signal?.throwIfAborted();
      if (!(part instanceof Uint8Array)) throw new TypeError('NDJSON source must yield owned byte views.');
      totalBytes += part.byteLength; if (totalBytes > maxBytes) throw new RangeError('NDJSON source exceeds its byte limit.');
      for (let offset = 0; offset < part.byteLength;) {
        signal?.throwIfAborted();
        const bound = Math.min(part.byteLength, offset + 65536), newline = part.subarray(offset, bound).indexOf(10), end = newline < 0 ? bound : offset + newline;
        const count = end - offset;
        if (record.bytes + count > maxLineBytes) throw new RangeError('NDJSON entry exceeds its size limit.');
        for (let copied = 0; copied < count;) {
          if (!record.tail || record.tailUsed === record.tail.byteLength) {
            const capacity = Math.min(65536, maxLineBytes - record.capacity);
            resourceBudget?.reserve({ token: record.token, owner: 'ndjson-source-line', category: 'import', bytes: (record.capacity + capacity) * 3 + 4096, pinned: true, reloadable: false });
            record.held = !!resourceBudget; record.tail = new Uint8Array(capacity); record.tailUsed = 0; record.capacity += capacity; record.pieces.push(record.tail);
          }
          const length = Math.min(count - copied, record.tail.byteLength - record.tailUsed);
          record.tail.set(part.subarray(offset + copied, offset + copied + length), record.tailUsed); copied += length; record.tailUsed += length; record.bytes += length;
        }
        offset = end + (newline >= 0 ? 1 : 0);
        if (newline >= 0) {
          if (!record.bytes) throw new Error('NDJSON source has an empty entry.');
          let consumed = false; const owned = record, byteLength = owned.bytes;
          const line = Object.freeze({ byteLength, totalBytes: totalBytes - (part.byteLength - offset),
            takeText() {
              if (consumed || owned.releaseAttempted) throw new Error('NDJSON source line is no longer available.'); consumed = true;
              const decoder = new TextDecoder('utf-8', { fatal: true }), strings = [];
              for (const piece of owned.pieces) strings.push(decoder.decode(piece === owned.tail ? piece.subarray(0, owned.tailUsed) : piece, { stream: true })); strings.push(decoder.decode());
              const text = strings.join(''); owned.pieces = []; owned.tail = null; return text;
            }, release: () => retire(owned) });
          try { yield line; } finally { retire(owned); }
          record = create();
        }
        workBytes += count + (newline >= 0 ? 1 : 0);
        if (workBytes >= 1048576) { signal?.throwIfAborted(); await yieldControl(); workBytes = 0; }
      }
    }
    signal?.throwIfAborted();
    if (record.bytes) throw new Error('NDJSON source ended before its final newline.');
  } finally { retire(record); }
}
