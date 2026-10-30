import { yieldBackgroundTask } from './BackgroundTaskYield.js';
export const BACKGROUND_SNAPSHOT_SCHEMA = 'owned-background-snapshot-pages/v1';
export const BACKGROUND_SNAPSHOT_PACKET_BYTES = 65536;
export const BACKGROUND_SNAPSHOT_PACKET_OPERATIONS = 256;
export const BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES = 16 * 1048576;
const TEXT_UNITS = 4096, BINARY_BYTES = 32768;
const types = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, DataView };
const unsafe = key => ['__proto__', 'constructor', 'prototype'].includes(key);
const fail = message => Object.assign(new Error(message), { name: 'BackgroundSnapshotError', code: 'snapshot-transport' });
const shared = value => typeof globalThis.SharedArrayBuffer === 'function' && (value instanceof globalThis.SharedArrayBuffer || value?.buffer instanceof globalThis.SharedArrayBuffer);
const wasmModule = value => { if (typeof globalThis.WebAssembly?.Module !== 'function' || !(value instanceof WebAssembly.Module)) return false; try { return WebAssembly.Module.exports(value).length <= 256; } catch { return false; } };
const own = (value, key) => { const property = Object.getOwnPropertyDescriptor(value, key); if (!property || !Object.hasOwn(property, 'value')) throw fail('Snapshot transport requires own data properties.'); return property.value; };
const validLimits = ({ maxBytes, maxNodes, estimatedPeakBytes }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1048576 || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 4000000 || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 4096 || estimatedPeakBytes > 512 * 1048576) throw fail('Invalid snapshot transport limits.');
};
const operationBytes = operation => 64 + operation.reduce((sum, value) => sum + (typeof value === 'string' ? value.length * 2 : value instanceof ArrayBuffer ? operation[0] === 'owned-binary' ? 8 : value.byteLength : 8), 0);
function* snapshotOperations(value, limits) {
  const active = new WeakSet(), transferred = new WeakSet(); let nodes = 0, dataBytes = 0, nativeModules = 0;
  const claim = (bytes = 0) => { dataBytes += bytes; if (dataBytes > limits.maxBytes * 2 || dataBytes * 2 + nodes * 64 > limits.estimatedPeakBytes) throw fail('Snapshot transport exceeds its admitted footprint.'); };
  const visit = function*(input, depth) {
    if (++nodes > limits.maxNodes || depth > 48) throw fail('Snapshot transport exceeds its structural bound.'); claim();
    if (input === null || ['boolean', 'undefined', 'number'].includes(typeof input)) {
      if (typeof input === 'number' && !Number.isFinite(input)) throw fail('Snapshot numbers must be finite.'); claim(8); yield ['value', input]; return;
    }
    if (typeof input === 'string') {
      claim(input.length * 2); yield ['string', input.length];
      for (let index = 0; index < input.length; index += TEXT_UNITS) yield ['text', input.slice(index, index + TEXT_UNITS)];
      yield ['string-end']; return;
    }
    if (!input || typeof input !== 'object' || active.has(input) || shared(input)) throw fail('Snapshot transport requires acyclic, nonshared owned data.');
    if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
      const type = input instanceof ArrayBuffer ? 'ArrayBuffer' : input.constructor.name;
      if (type !== 'ArrayBuffer' && !Object.hasOwn(types, type)) throw fail('Unsupported snapshot binary view.');
      const buffer = input instanceof ArrayBuffer ? input : input.buffer;
      if (transferred.has(buffer)) throw fail('An explicitly transferred result buffer was referenced more than once.');
      const length = input.byteLength; claim(length);
      if (limits.ownedTransferBuffers?.has(buffer) && length === buffer.byteLength && (input instanceof ArrayBuffer || input.byteOffset === 0)) { transferred.add(buffer); yield ['owned-binary', type, buffer]; return; }
      const source = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, length); yield ['binary', type, length];
      for (let offset = 0; offset < length; offset += BINARY_BYTES) { if (source.byteLength !== length) throw fail('Owned snapshot buffer changed during transfer.'); const bytes = source.slice(offset, offset + BINARY_BYTES); yield ['bytes', bytes.buffer]; }
      yield ['binary-end']; return;
    }
    if (limits.allowOwnedWasmModule && wasmModule(input)) {
      if (nativeModules || transferred.has(input) || BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES > limits.maxBytes) throw fail('At most one unique owned WASM module must fit the declared result limit.');
      nativeModules++; transferred.add(input); claim(BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES); yield ['owned-wasm-module', input]; return;
    }
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) throw fail('Unsupported snapshot object prototype.');
    if (Object.hasOwn(input, 'toJSON')) throw fail('Snapshot serialization hooks are not supported.');
    active.add(input);
    try {
      if (array) {
        const length = input.length; if (length + nodes > limits.maxNodes) throw fail('Snapshot array exceeds its node bound.'); claim(length * 8); yield ['array', length];
        for (let index = 0; index < length; index++) { if (input.length !== length) throw fail('Owned snapshot array changed during transfer.'); yield* visit(own(input, index), depth + 1); }
      } else {
        yield ['object'];
        for (const key in input) if (Object.hasOwn(input, key)) { if (unsafe(key) || key.length > TEXT_UNITS) throw fail('Unsafe or oversized snapshot property.'); claim(key.length * 2 + 16); yield ['key', key]; yield* visit(own(input, key), depth + 1); }
      }
      yield ['end'];
    } finally { active.delete(input); }
  };
  yield* visit(value, 0);
}
export async function* encodeBackgroundSnapshotPages(value, { maxBytes = 64 * 1048576, maxNodes = 4000000, estimatedPeakBytes,
  signal, ownedTransferBuffers = null, allowOwnedWasmModule = false, isCurrent = () => true, yieldTask = yieldBackgroundTask, now = () => performance.now(), sliceMs = 3, onSlice = () => {} } = {}) {
  const limits = { maxBytes, maxNodes, estimatedPeakBytes, ownedTransferBuffers, allowOwnedWasmModule }; validLimits(limits);
  if (typeof allowOwnedWasmModule !== 'boolean') throw fail('Native module transport requires an explicit boolean capability.');
  if (ownedTransferBuffers != null && (!(ownedTransferBuffers instanceof Set) || ownedTransferBuffers.size > 32)) throw fail('Invalid explicitly owned result transfer set.');
  if (!Number.isFinite(sliceMs) || sliceMs <= 0 || sliceMs > 4) throw fail('Invalid snapshot slice target.');
  const check = () => { signal?.throwIfAborted(); if (!isCurrent()) throw fail('Snapshot source ownership changed.'); };
  const iterator = snapshotOperations(value, limits); let operations = [], bytes = 0, sequence = 0, started = now(); check();
  try {
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      const operation = next.value, size = operationBytes(operation); if (size > BACKGROUND_SNAPSHOT_PACKET_BYTES) throw fail('Snapshot operation exceeds packet capacity.');
      if (operations.length && (bytes + size > BACKGROUND_SNAPSHOT_PACKET_BYTES || operations.length >= BACKGROUND_SNAPSHOT_PACKET_OPERATIONS || now() - started >= sliceMs)) {
        onSlice({ durationMs: Math.max(0, now() - started), operations: operations.length, packetBytes: bytes }); check();
        yield { schema: BACKGROUND_SNAPSHOT_SCHEMA, sequence: ++sequence, operations, bytes };
        operations = []; bytes = 0; await yieldTask({ signal }); check(); started = now();
      }
      operations.push(operation); bytes += size;
    }
    if (operations.length) { onSlice({ durationMs: Math.max(0, now() - started), operations: operations.length, packetBytes: bytes }); check(); yield { schema: BACKGROUND_SNAPSHOT_SCHEMA, sequence: ++sequence, operations, bytes }; }
    check();
  } finally { iterator.return(); }
}
export function createBackgroundSnapshotReceiver({ maxBytes = 64 * 1048576, maxNodes = 4000000, estimatedPeakBytes, allowOwnedBinary = false, allowOwnedWasmModule = false } = {}) {
  const limits = { maxBytes, maxNodes, estimatedPeakBytes }; validLimits(limits);
  if (typeof allowOwnedWasmModule !== 'boolean') throw fail('Native module transport requires an explicit boolean capability.');
  const stack = []; let root, hasRoot = false, nodes = 0, dataBytes = 0, sequence = 0, finished = false, reading = false, nativeModules = 0;
  const claim = (bytes, futureNode = false) => { dataBytes += bytes; if (dataBytes > maxBytes * 2 || dataBytes * 2 + (nodes + Number(futureNode)) * 64 > estimatedPeakBytes) throw fail('Received snapshot exceeds its admitted footprint.'); };
  const attach = value => {
    if (++nodes > maxNodes || stack.length > 48) throw fail('Received snapshot exceeds its node/depth bound.'); claim(0);
    const parent = stack.at(-1);
    if (!parent) { if (hasRoot) throw fail('Snapshot contains multiple roots.'); root = value; hasRoot = true; }
    else if (parent.kind === 'array') { if (parent.index >= parent.length) throw fail('Snapshot array overflow.'); parent.value[parent.index++] = value; }
    else if (parent.kind === 'object' && parent.key !== null) { Object.defineProperty(parent.value, parent.key, { value, enumerable: true, configurable: true, writable: true }); parent.key = null; }
    else throw fail('Snapshot value has no writable parent.');
  };
  const consume = operation => {
    if (!Array.isArray(operation) || typeof operation[0] !== 'string') throw fail('Invalid snapshot operation.'); const [kind, value, extra] = operation, parent = stack.at(-1);
    if (['value', 'object', 'array', 'string', 'binary', 'owned-binary', 'owned-wasm-module'].includes(kind) && (nodes >= maxNodes || stack.length > 48 || parent && !(parent.kind === 'object' && parent.key !== null || parent.kind === 'array' && parent.index < parent.length) || !parent && hasRoot)) throw fail('Snapshot has no bounded writable value slot.');
    if (kind === 'key' && operation.length === 2) {
      if (parent?.kind !== 'object' || parent.key !== null || typeof value !== 'string' || value.length > TEXT_UNITS || unsafe(value) || Object.hasOwn(parent.value, value)) throw fail('Invalid or repeated snapshot property.'); claim(value.length * 2 + 16); parent.key = value;
    } else if (kind === 'value' && operation.length === 2) {
      if (value !== null && !['boolean', 'undefined', 'number'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw fail('Invalid snapshot scalar.'); claim(8, true); attach(value);
    } else if (kind === 'object' && operation.length === 1) { const object = {}; attach(object); stack.push({ kind, value: object, key: null }); }
    else if (kind === 'array' && operation.length === 2) {
      if (!Number.isSafeInteger(value) || value < 0 || value + nodes + 1 > maxNodes) throw fail('Invalid snapshot array size.'); claim(value * 8, true); const array = new Array(value); attach(array); stack.push({ kind, value: array, index: 0, length: value });
    } else if (kind === 'end' && operation.length === 1) {
      if (!parent || parent.kind === 'array' && parent.index !== parent.length || parent.kind === 'object' && parent.key !== null || !['object', 'array'].includes(parent.kind)) throw fail('Incomplete snapshot container.'); stack.pop();
    } else if (kind === 'string' && operation.length === 2) {
      if (!Number.isSafeInteger(value) || value < 0 || value > maxBytes) throw fail('Invalid snapshot string length.'); claim(value * 2, true); stack.push({ kind, length: value, received: 0, text: '' });
    } else if (kind === 'text' && operation.length === 2) {
      if (parent?.kind !== 'string' || typeof value !== 'string' || value.length > TEXT_UNITS || parent.received + value.length > parent.length) throw fail('Invalid snapshot text page.'); parent.text += value; parent.received += value.length;
    } else if (kind === 'string-end' && operation.length === 1) {
      if (parent?.kind !== 'string' || parent.received !== parent.length) throw fail('Incomplete snapshot text.'); stack.pop(); attach(parent.text);
    } else if (kind === 'owned-wasm-module' && operation.length === 2) {
      if (!allowOwnedWasmModule || nativeModules || BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES > maxBytes || !wasmModule(value)) throw fail('Invalid or unadmitted owned WASM module result.');
      nativeModules++; claim(BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES, true); attach(value);
    } else if (kind === 'owned-binary' && operation.length === 3) {
      if (!allowOwnedBinary || !(extra instanceof ArrayBuffer) || extra.byteLength > maxBytes || value !== 'ArrayBuffer' && !Object.hasOwn(types, value) || types[value]?.BYTES_PER_ELEMENT && extra.byteLength % types[value].BYTES_PER_ELEMENT) throw fail('Invalid explicitly owned binary result.');
      claim(extra.byteLength, true); attach(value === 'ArrayBuffer' ? extra : new types[value](extra));
    } else if (kind === 'binary' && operation.length === 3) {
      if (value !== 'ArrayBuffer' && !Object.hasOwn(types, value) || !Number.isSafeInteger(extra) || extra < 0 || extra > maxBytes || types[value]?.BYTES_PER_ELEMENT && extra % types[value].BYTES_PER_ELEMENT) throw fail('Invalid snapshot binary size or type.');
      claim(extra, true); const bytes = new Uint8Array(extra); stack.push({ kind, type: value, bytes, received: 0 });
    } else if (kind === 'bytes' && operation.length === 2) {
      if (parent?.kind !== 'binary' || !(value instanceof ArrayBuffer) || value.byteLength > BINARY_BYTES || parent.received + value.byteLength > parent.bytes.byteLength) throw fail('Invalid snapshot binary page.'); parent.bytes.set(new Uint8Array(value), parent.received); parent.received += value.byteLength;
    } else if (kind === 'binary-end' && operation.length === 1) {
      if (parent?.kind !== 'binary' || parent.received !== parent.bytes.byteLength) throw fail('Incomplete snapshot binary.'); stack.pop(); attach(parent.type === 'ArrayBuffer' ? parent.bytes.buffer : new types[parent.type](parent.bytes.buffer));
    } else throw fail('Unknown snapshot transport operation.');
  };
  const validatePacket = packet => {
    if (finished || reading || packet?.schema !== BACKGROUND_SNAPSHOT_SCHEMA || packet.sequence !== sequence + 1 || !Array.isArray(packet.operations) || packet.operations.length < 1 || packet.operations.length > BACKGROUND_SNAPSHOT_PACKET_OPERATIONS) throw fail('Stale or invalid snapshot packet.');
    const bytes = packet.operations.reduce((sum, operation) => { if (!Array.isArray(operation) || operation.length > 3) throw fail('Invalid snapshot operation envelope.'); return sum + operationBytes(operation); }, 0);
    if (bytes !== packet.bytes || bytes > BACKGROUND_SNAPSHOT_PACKET_BYTES) throw fail('Snapshot packet exceeds its byte bound.');
  };
  const receipt = () => ({ sequence, nodes, dataBytes, retainedEstimateBytes: dataBytes * 2 + nodes * 64, ...(nativeModules ? { nativeModules, nativeModuleEstimateBytes: nativeModules * BACKGROUND_SNAPSHOT_WASM_MODULE_ESTIMATE_BYTES } : {}) });
  return Object.freeze({ push(packet) {
    validatePacket(packet); reading = true;
    try { for (const operation of packet.operations) consume(operation); sequence++; return receipt(); } finally { reading = false; }
  }, async pushCooperative(packet, { signal, isCurrent = () => true, yieldTask = yieldBackgroundTask, now = () => performance.now(), sliceMs = 3, onSlice = () => {} } = {}) {
    validatePacket(packet); if (!Number.isFinite(sliceMs) || sliceMs <= 0 || sliceMs > 4) throw fail('Invalid snapshot receive slice target.'); reading = true;
    const check = () => { signal?.throwIfAborted(); if (finished || !isCurrent()) throw fail('Snapshot result owner retired.'); }; let started = now();
    try {
      check();
      for (let index = 0; index < packet.operations.length; index++) {
        consume(packet.operations[index]);
        if (index % 16 === 15 && now() - started >= sliceMs) { onSlice({ durationMs: Math.max(0, now() - started) }); await yieldTask({ signal }); check(); started = now(); }
      }
      check(); onSlice({ durationMs: Math.max(0, now() - started) }); sequence++; return receipt();
    } finally { reading = false; }
  }, finish(expectedSequence) { if (finished || reading || !hasRoot || stack.length || expectedSequence !== sequence) throw fail('Incomplete snapshot transport.'); finished = true; const result = root; root = null; return result; },
  dispose() { finished = true; root = null; stack.length = 0; }, diagnostics: () => ({ ...receipt(), finished, reading }) });
}

export const backgroundSnapshotTransfers = packet => packet.operations.filter(operation => ['bytes', 'owned-binary'].includes(operation[0])).map(operation => operation[operation[0] === 'bytes' ? 1 : 2]);
