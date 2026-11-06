import { parseWords } from '../protocol/UmpPacketCodec.js';

export const NATIVE_MIDI_BRIDGE_PROTOCOL = 'lemmings-native-midi/v1';
export const NATIVE_MIDI_BRIDGE_VERSION = 1;
export const NATIVE_MIDI_MAX_WORDS = 4096;
export const NATIVE_MIDI_MAX_METADATA_BYTES = 8192;
const HEADER_BYTES = 40, MAGIC = 0x504d554c;
const integer = (value, maximum, label) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error('Invalid native MIDI ' + label);
  return value;
};
export function encodeNativeMidiBatch({ session, requestId, grant, execution, deadlineUs, priority = 1, words, provenance = {} }) {
  if (typeof SharedArrayBuffer === 'function' && words?.buffer instanceof SharedArrayBuffer) throw new Error('Shared native MIDI words are unsupported');
  const owned = Array.from(words || []);
  parseWords(owned, { maximumWords: NATIVE_MIDI_MAX_WORDS, preserveUnknown: false });
  if (!owned.length) throw new Error('Empty native MIDI batch');
  const metadata = new TextEncoder().encode(JSON.stringify(provenance));
  if (metadata.byteLength > NATIVE_MIDI_MAX_METADATA_BYTES) throw new Error('Native MIDI provenance capacity');
  const bytes = new Uint8Array(HEADER_BYTES + owned.length * 4 + metadata.byteLength), view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true); view.setUint16(4, 1, true); view.setUint16(6, HEADER_BYTES, true);
  for (const [offset, value, label] of [[8, session, 'session'], [12, requestId, 'request'], [16, grant, 'grant'], [20, execution, 'execution']]) {
    if (!integer(value, 0xffffffff, label)) throw new Error('Missing native MIDI ' + label);
    view.setUint32(offset, value, true);
  }
  view.setFloat64(24, integer(deadlineUs, Number.MAX_SAFE_INTEGER, 'deadline'), true);
  view.setUint32(32, owned.length, true); view.setUint8(36, integer(priority, 2, 'priority')); view.setUint16(38, metadata.length, true);
  owned.forEach((word, index) => view.setUint32(HEADER_BYTES + index * 4, word, true));
  bytes.set(metadata, HEADER_BYTES + owned.length * 4); return bytes.buffer;
}
export function decodeNativeMidiBatch(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES || bytes.byteLength > HEADER_BYTES + NATIVE_MIDI_MAX_WORDS * 4 + NATIVE_MIDI_MAX_METADATA_BYTES ||
      typeof SharedArrayBuffer === 'function' && bytes.buffer instanceof SharedArrayBuffer) throw new Error('Invalid native MIDI frame capacity');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC || view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== HEADER_BYTES || view.getUint8(37)) throw new Error('Native MIDI binary version or flags');
  const count = view.getUint32(32, true), metadataBytes = view.getUint16(38, true);
  if (!count || count > NATIVE_MIDI_MAX_WORDS || metadataBytes > NATIVE_MIDI_MAX_METADATA_BYTES || bytes.length !== HEADER_BYTES + count * 4 + metadataBytes) throw new Error('Native MIDI declared length mismatch');
  const words = Array.from({ length: count }, (_, index) => view.getUint32(HEADER_BYTES + index * 4, true));
  parseWords(words, { maximumWords: NATIVE_MIDI_MAX_WORDS, preserveUnknown: false });
  const provenance = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER_BYTES + count * 4)));
  if (!provenance || Object.getPrototypeOf(provenance) !== Object.prototype) throw new Error('Invalid native MIDI provenance');
  const result = { session: view.getUint32(8, true), requestId: view.getUint32(12, true), grant: view.getUint32(16, true), execution: view.getUint32(20, true),
    deadlineUs: integer(view.getFloat64(24, true), Number.MAX_SAFE_INTEGER, 'deadline'), priority: integer(view.getUint8(36), 2, 'priority'), words, provenance };
  if (!result.session || !result.requestId || !result.grant || !result.execution) throw new Error('Missing native MIDI frame identity');
  return result;
}
