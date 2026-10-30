import { OWNED_STRETCH_CORE } from '../../midi/content/OwnedStretchCoreIdentity.js';
import { freezeData } from '../../core/CanonicalData.js';

export const STRETCH_IMAGE_ABI_REVISION = 'pinned-export-only-quiescent-stack-and-heap-image-v1';
export const STRETCH_STACK_EXPORT = '__owned_stack_pointer';
const fail = message => { throw new TypeError('Stretch image ABI: ' + message); };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const encode = value => { const bytes = []; do { const part = value % 128; value = Math.floor(value / 128); bytes.push(part | (value ? 128 : 0)); } while (value); return bytes; };

// This walks binary structure, never WebAssembly.compile/instantiate/validate.
export function inspectWasmHeapImageState(bytes) {
  if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.length < 8 || bytes.length > 131072 || bytes.slice(0, 8).some((value, index) => value !== [0, 97, 115, 109, 1, 0, 0, 0][index])) fail('Choose one bounded complete WASM v1 module.');
  let at = 8, end = bytes.length, startFunction = null, exportSection = null, importedGlobals = 0, memoryGrowthInstructions = 0, tableMutationInstructions = 0, codeFunctions = 0, declaredFunctions = 0;
  const globals = [], memories = [], tables = [], exports = [], imports = [], sections = [], decoder = new TextDecoder('utf-8', { fatal: true });
  const byte = () => { if (at >= end) fail('Truncated section or instruction.'); return bytes[at++]; };
  const skip = count => { if (!Number.isSafeInteger(count) || count < 0 || at + count > end) fail('Truncated immediate.'); at += count; };
  const unsigned = () => { let value = 0; for (let index = 0; index < 5; index++) { const next = byte(); value += (next & 127) * 2 ** (index * 7); if (!(next & 128)) { if (value > 0xffffffff) fail('Unsigned immediate overflow.'); return value; } } fail('Unterminated unsigned immediate.'); };
  const signed = bits => { let value = 0, shift = 0; for (let index = 0; index < Math.ceil(bits / 7); index++) { const next = byte(); value += (next & 127) * 2 ** shift; shift += 7; if (!(next & 128)) { if (next & 64) value -= 2 ** shift; if (value < -(2 ** (bits - 1)) || value >= 2 ** (bits - 1)) fail('Signed immediate overflow.'); return value; } } fail('Unterminated signed immediate.'); };
  const skipI64 = () => { for (let index = 0; index < 10; index++) { const next = byte(); if (!(next & 128)) { if (index === 9 && next !== 0 && next !== 127) fail('Signed i64 overflow.'); return; } } fail('Unterminated i64 immediate.'); };
  const name = () => { const size = unsigned(); if (size > 1024) fail('An ABI name exceeds its bound.'); const first = at; skip(size); return decoder.decode(bytes.subarray(first, at)); };
  const limits = () => { const flags = unsigned(); if (flags > 1) fail('Shared or memory64/table64 storage is unsupported.'); const minimum = unsigned(), maximum = flags ? unsigned() : null; if (maximum !== null && maximum < minimum) fail('Invalid storage limits.'); return { minimum, maximum }; };
  const table = () => { const elementType = byte(); if (elementType !== 112) fail('Only the pinned function-reference table is supported.'); return { elementType, ...limits() }; };
  const instructionBody = bodyEnd => {
    const sectionEnd = end; end = bodyEnd; const locals = unsigned(); if (locals > 65536) fail('Local declaration bound exceeded.');
    for (let index = 0; index < locals; index++) { unsigned(); if (![127, 126, 125, 124].includes(byte())) fail('Unsupported local value type.'); }
    let depth = 1;
    while (at < end) {
      const opcode = byte();
      if ([2, 3, 4].includes(opcode)) { signed(33); depth++; }
      else if (opcode === 11) { if (--depth === 0) { if (at !== end) fail('Bytes follow a completed function.'); break; } }
      else if (opcode === 5) { if (depth < 2) fail('Else outside a block.'); }
      else if ([12, 13, 16, 32, 33, 34, 35, 36].includes(opcode)) unsigned();
      else if (opcode === 14) { const count = unsigned(); if (count > 65536) fail('Branch table bound exceeded.'); for (let index = 0; index <= count; index++) unsigned(); }
      else if (opcode === 17) { unsigned(); if (unsigned() !== 0) fail('Unqualified indirect table.'); }
      else if (opcode >= 40 && opcode <= 62) { unsigned(); unsigned(); }
      else if (opcode === 63 || opcode === 64) { if (unsigned() !== 0) fail('Unqualified memory index.'); if (opcode === 64) memoryGrowthInstructions++; }
      else if (opcode === 65) signed(32);
      else if (opcode === 66) skipI64();
      else if (opcode === 67) skip(4);
      else if (opcode === 68) skip(8);
      else if (opcode === 37 || opcode === 38) { unsigned(); if (opcode === 38) tableMutationInstructions++; }
      else if (opcode === 252) {
        const operation = unsigned();
        if (operation <= 7) continue;
        if (operation === 8 || operation === 10 || operation === 12 || operation === 14) { unsigned(); unsigned(); }
        else if ([9, 11, 13, 15, 16, 17].includes(operation)) unsigned();
        else fail('Unsupported prefixed instruction.');
        if ([12, 13, 14, 15, 17].includes(operation)) tableMutationInstructions++;
      } else if (![0, 1, 15, 26, 27].includes(opcode) && !(opcode >= 69 && opcode <= 196)) fail('Unsupported instruction or reference-state extension.');
    }
    if (depth !== 0) fail('Unterminated function body.'); end = sectionEnd;
  };
  const seen = new Set();
  while (at < bytes.length) {
    end = bytes.length; const first = at, id = byte(), size = unsigned(), payload = at, sectionEnd = at + size;
    if (sectionEnd > bytes.length || id > 12 || id !== 0 && seen.has(id)) fail('Invalid or duplicate section.'); if (id) seen.add(id); end = sectionEnd;
    if (id === 2) {
      const count = unsigned(); if (count > 256) fail('Import bound exceeded.');
      for (let index = 0; index < count; index++) { const module = name(), field = name(), kind = byte(); imports.push({ module, name: field, kind }); if (kind === 0) unsigned(); else if (kind === 1) tables.push({ imported: true, ...table() }); else if (kind === 2) memories.push({ imported: true, ...limits() }); else if (kind === 3) { byte(); byte(); importedGlobals++; } else fail('Unsupported imported state.'); }
    } else if (id === 3) { declaredFunctions = unsigned(); if (declaredFunctions > 4096) fail('Function bound exceeded.'); for (let index = 0; index < declaredFunctions; index++) unsigned(); }
    else if (id === 4) { const count = unsigned(); if (count > 1) fail('Multiple tables are unsupported.'); for (let index = 0; index < count; index++) tables.push({ imported: false, ...table() }); }
    else if (id === 5) { const count = unsigned(); if (count > 1) fail('Multiple memories are unsupported.'); for (let index = 0; index < count; index++) memories.push({ imported: false, ...limits() }); }
    else if (id === 6) {
      const count = unsigned(); if (count > 256) fail('Global bound exceeded.');
      for (let index = 0; index < count; index++) { const type = byte(), mutable = byte(); if (type !== 127 || mutable > 1 || byte() !== 65) fail('Only explicit i32 constant globals can be inspected.'); const initialValue = signed(32); if (byte() !== 11) fail('Unknown global initializer.'); globals.push({ index: importedGlobals + index, type, mutable: !!mutable, initialValue }); }
    } else if (id === 7) {
      const count = unsigned(), entriesAt = at; if (count > 256) fail('Export bound exceeded.');
      for (let index = 0; index < count; index++) { const exportName = name(), kind = byte(), itemIndex = unsigned(); if (kind > 3 || exports.some(value => value.name === exportName)) fail('Unknown or duplicate export.'); exports.push({ name: exportName, kind, index: itemIndex }); }
      exportSection = { first, payload, entriesAt, end: sectionEnd, count };
    } else if (id === 8) startFunction = unsigned();
    else if (id === 10) { codeFunctions = unsigned(); if (codeFunctions > 4096) fail('Code bound exceeded.'); for (let index = 0; index < codeFunctions; index++) { const size = unsigned(), bodyEnd = at + size; if (bodyEnd > end) fail('A function exceeds its section.'); instructionBody(bodyEnd); } }
    else at = sectionEnd;
    if (at !== sectionEnd) fail('Section payload length changed.'); sections.push({ id, first, payload, end: sectionEnd }); at = sectionEnd;
  }
  const mutable = globals.filter(value => value.mutable), stack = mutable.length === 1 ? mutable[0] : null;
  const heapImageEligible = importedGlobals === 0 && globals.length === 1 && stack?.index === 0 && stack.initialValue > 0 && stack.initialValue % 16 === 0 && startFunction === null && memories.length === 1 && !memories[0].imported && tables.length === 1 && !tables[0].imported && tables[0].minimum === tables[0].maximum && memoryGrowthInstructions === 0 && tableMutationInstructions === 0 && declaredFunctions === codeFunctions;
  return freezeData({ schema: 'lemmings-wasm-heap-image-static-abi/v1', byteLength: bytes.length, heapImageEligible, globals, memories, tables, imports, exports, exportSection, sections, startFunction, memoryGrowthInstructions, tableMutationInstructions, declaredFunctions, codeFunctions,
    evidence: 'bounded-binary-section-and-instruction-walk;no-compilation-or-execution;quiescent-stack-value-still-requires-runtime-check', qualification: 'not-DSP-state-cost-or-listening-qualification' });
}

export async function prepareStretchImageModuleBytes(raw, { signal, current = () => true } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('The source owner changed.'); }; check();
  if (!(raw instanceof Uint8Array) || !(raw.buffer instanceof ArrayBuffer) || raw.byteLength !== OWNED_STRETCH_CORE.wasmBytes) fail('Choose the complete exact pinned core bytes.');
  const original = raw.slice(); if (await digest(original) !== OWNED_STRETCH_CORE.wasmSha256) fail('The original core byte identity changed.'); check();
  const proof = inspectWasmHeapImageState(original), section = proof.exportSection;
  if (!proof.heapImageEligible || !section || proof.exports.some(value => value.name === STRETCH_STACK_EXPORT) || proof.imports.length !== 4 || proof.imports.some((value, index) => value.module !== 'a' || value.name !== 'abcd'[index] || value.kind !== 0)) fail('The pinned module has unqualified non-memory state or import behavior.');
  const name = new TextEncoder().encode(STRETCH_STACK_EXPORT), extra = [...encode(name.length), ...name, 3, 0], count = encode(section.count + 1), size = count.length + section.end - section.entriesAt + extra.length, header = [7, ...encode(size)], bytes = new Uint8Array(section.first + header.length + size + original.length - section.end);
  let at = 0; const append = part => { bytes.set(part, at); at += part.length; };
  append(original.subarray(0, section.first)); append(header); append(count); append(original.subarray(section.entriesAt, section.end)); append(extra); append(original.subarray(section.end));
  if (at !== bytes.length) fail('Derived export inventory changed.'); const derivedModuleHash = await digest(bytes); check();
  const pin = OWNED_STRETCH_CORE.imageModule;
  if (pin.revision !== STRETCH_IMAGE_ABI_REVISION || pin.stackExport !== STRETCH_STACK_EXPORT || pin.expectedQuiescentStack !== proof.globals[0].initialValue || pin.bytes !== bytes.length || pin.sha256 !== derivedModuleHash) fail('The export-only derivation differs from its exact pinned ABI.');
  return { bytes, metadata: freezeData({ schema: 'lemmings-stretch-image-module/v1', revision: STRETCH_IMAGE_ABI_REVISION, originalArtifactHash: OWNED_STRETCH_CORE.wasmSha256, derivedModuleHash, byteLength: bytes.length, stackExport: STRETCH_STACK_EXPORT, expectedQuiescentStack: proof.globals[0].initialValue,
    mutation: 'one-additional-global-export;all-other-section-payloads-and-all-DSP-instructions-unchanged', staticState: proof, execution: 'not-compiled-or-executed-by-preparation', qualification: 'heap-image-transport-foundation;not-an-installed-live-warp-voice' }) };
}
