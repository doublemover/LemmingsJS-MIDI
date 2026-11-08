import { decodeUmpPacket, UMP_WORD_COUNTS } from './UmpPacketCodec.js';
const failure = (code, message) => Object.assign(new Error(message), { name: 'UmpStreamError', code });

export function createUmpStreamDecoder({ maximumWordsPerPush = 4096, maximumDiagnostics = 64 } = {}) {
  if (!Number.isInteger(maximumWordsPerPush) || maximumWordsPerPush < 4 || maximumWordsPerPush > 65536 || !Number.isInteger(maximumDiagnostics) || maximumDiagnostics < 0 || maximumDiagnostics > 256) throw new RangeError('Invalid UMP stream bounds.');
  let words = [], bytes = [], mode = null, poisoned = false, received = 0, omitted = 0; const diagnostics = [];
  const check = type => { if (poisoned) throw failure('stream-poisoned', 'Reset the failed UMP stream before accepting new input.'); if (mode && mode !== type) throw failure('stream-mode', 'Do not mix host words and wire bytes within one UMP stream.'); mode = type; };
  const fail = error => { poisoned = true; words = []; bytes = []; throw error; };
  const consume = input => {
    const combined = words.concat(input), result = []; let cursor = 0;
    while (cursor < combined.length) {
      const length = UMP_WORD_COUNTS[combined[cursor] >>> 28]; if (cursor + length > combined.length) break;
      const packet = decodeUmpPacket(combined.slice(cursor, cursor + length)); result.push(packet); cursor += length;
    }
    if (!Number.isSafeInteger(received + result.length)) throw failure('stream-capacity', 'UMP stream counters exhausted.');
    words = combined.slice(cursor); received += result.length;
    for (const packet of result) if (!packet.known) { if (diagnostics.length < maximumDiagnostics) diagnostics.push(packet); else omitted = Math.min(Number.MAX_SAFE_INTEGER, omitted + 1); }
    return Object.freeze(result);
  };
  return Object.freeze({
    pushWords(input) {
      try {
        check('words');
        if (!Array.isArray(input) && !(input instanceof Uint32Array) || input.length > maximumWordsPerPush) throw failure('stream-capacity', 'UMP push exceeds its word bound.');
        const owned = Array.from(input); if (owned.some(word => !Number.isInteger(word) || word < 0 || word > 0xffffffff)) throw failure('invalid-word', 'UMP host words must be unsigned 32-bit integers.');
        return consume(owned);
      } catch (error) { return fail(error); }
    },
    pushBytes(input) {
      try {
        check('bytes'); if (!(input instanceof Uint8Array) || input.byteLength > maximumWordsPerPush * 4) throw failure('stream-capacity', 'UMP push exceeds its wire-byte bound.');
        const owned = new Uint8Array(bytes.length + input.length); owned.set(bytes); owned.set(input, bytes.length);
        const view = new DataView(owned.buffer), count = Math.floor(owned.length / 4), complete = [];
        for (let index = 0; index < count; index++) complete.push(view.getUint32(index * 4, false));
        const result = consume(complete); bytes = Array.from(owned.subarray(count * 4)); return result;
      } catch (error) { return fail(error); }
    },
    end() { if (poisoned) throw failure('stream-poisoned', 'UMP stream failed.'); if (words.length || bytes.length) return fail(failure('truncated-stream', 'UMP stream ended inside a packet.')); return Object.freeze({ status: 'complete', packets: received }); },
    reset() { words = []; bytes = []; mode = null; poisoned = false; received = omitted = 0; diagnostics.length = 0; },
    diagnostics: () => Object.freeze({ poisoned, mode, packets: received, retainedBytes: words.length * 4 + bytes.length, unknown: Object.freeze(diagnostics.slice()), omittedUnknown: omitted })
  });
}
