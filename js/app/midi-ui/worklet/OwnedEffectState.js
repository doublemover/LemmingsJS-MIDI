export const OWNED_EFFECT_STATE_ABI = 'owned-effect-state-le-v1';
const HEADER = 4096, MAGIC = 0x45465331, MAX_BYTES = 64 * 1048576;
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let value = i; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); crcTable[i] = value >>> 0; }
const checksum = bytes => { let value = 0xffffffff; for (let i = 0; i < bytes.length; i++) value = value >>> 8 ^ crcTable[(value ^ (i >= HEADER - 4 && i < HEADER ? 0 : bytes[i])) & 255]; return (value ^ 0xffffffff) >>> 0; };
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'incompatible-owned-effect-state' }); };
export function createOwnedEffectState({ kernel, identity, arrays, scalars, configurationBytes = null, validate = () => {} }) {
  if (!kernel || typeof identity !== 'string' || !identity.length || identity.length > 3000 || /[^\x20-\x7e]/.test(identity) || !Array.isArray(arrays) || !arrays.length || arrays.length > 16 ||
      arrays.some(array => !(array instanceof Float32Array || array instanceof Float64Array) || !(array.buffer instanceof ArrayBuffer)) ||
      !Array.isArray(scalars) || scalars.length > 64 || scalars.some(field => !field || !['number', 'boolean'].includes(field.type) || typeof field.name !== 'string') || new Set(scalars.map(field => field.name)).size !== scalars.length || typeof validate !== 'function') throw new TypeError('Invalid owned effect state layout.');
  if (configurationBytes !== null && (!(configurationBytes instanceof Uint8Array) || !(configurationBytes.buffer instanceof ArrayBuffer) || configurationBytes.byteLength > 524288)) throw new TypeError('Invalid bounded effect configuration bytes.');
  if (configurationBytes) configurationBytes = configurationBytes.slice();
  const layout = JSON.stringify({ ...(configurationBytes ? { configurationBytes: configurationBytes.byteLength } : {}), abi: OWNED_EFFECT_STATE_ABI, identity, arrays: arrays.map(array => [array.BYTES_PER_ELEMENT, array.length]), scalars: scalars.map(field => [field.name, field.type]) });
  if (layout.length > 3900) throw new TypeError('Owned effect state identity exceeds its fixed header.');
  const configurationOffset = HEADER + scalars.length * 8 + arrays.reduce((sum, array) => sum + array.byteLength, 0), byteLength = configurationOffset + (configurationBytes?.byteLength || 0);
  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_BYTES) throw new TypeError('Owned effect state exceeds its transfer profile.');
  const access = bytes => {
    if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteOffset || bytes.byteLength !== byteLength || bytes.buffer.byteLength !== byteLength || arrays.some(array => array.buffer === bytes.buffer)) fail('State transfer must be exclusively owned, exact-sized and separate from active DSP.');
    const view = new DataView(bytes.buffer), scalar = index => view.getFloat64(HEADER + index * 8, true); let offset = HEADER + scalars.length * 8;
    const planes = arrays.map(array => { const at = offset; offset += array.byteLength; return { array, at, read: index => array.BYTES_PER_ELEMENT === 4 ? view.getFloat32(at + index * 4, true) : view.getFloat64(at + index * 8, true) }; });
    return { view, scalar, planes, named: name => { const index = scalars.findIndex(field => field.name === name); if (index < 0) fail('Unknown state frontier.'); return scalar(index); } };
  };
  return Object.freeze({ byteLength,
    write(bytes) {
      const data = access(bytes), { view, planes } = data; bytes.fill(0); view.setUint32(0, MAGIC, true); view.setUint32(4, 1, true); view.setUint32(8, layout.length, true); view.setUint32(12, byteLength, true);
      for (let i = 0; i < layout.length; i++) view.setUint8(64 + i, layout.charCodeAt(i));
      for (let i = 0; i < scalars.length; i++) { const field = scalars[i], value = kernel[field.name]; if (field.type === 'boolean' ? typeof value !== 'boolean' : !Number.isFinite(value)) fail('Active effect contains invalid scalar state.'); view.setFloat64(HEADER + i * 8, field.type === 'boolean' ? Number(value) : value, true); }
      for (const plane of planes) for (let i = 0; i < plane.array.length; i++) { const value = plane.array[i]; if (!Number.isFinite(value)) fail('Active effect contains nonfinite history.'); if (plane.array.BYTES_PER_ELEMENT === 4) view.setFloat32(plane.at + i * 4, value, true); else view.setFloat64(plane.at + i * 8, value, true); }
      if (configurationBytes) bytes.set(configurationBytes, configurationOffset);
      validate(data); view.setUint32(HEADER - 4, checksum(bytes), true); return Object.freeze({ abi: OWNED_EFFECT_STATE_ABI, bytes: byteLength, frame: kernel.frame });
    },
    restore(bytes) {
      const data = access(bytes), { view, planes, scalar } = data;
      if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 1 || view.getUint32(8, true) !== layout.length || view.getUint32(12, true) !== byteLength || view.getUint32(HEADER - 4, true) !== checksum(bytes)) fail('Corrupt or incompatible effect state.');
      for (let i = 0; i < layout.length; i++) if (view.getUint8(64 + i) !== layout.charCodeAt(i)) fail('Effect state belongs to another processor, profile, rate or immutable configuration.');
      for (let i = 0; i < scalars.length; i++) { const value = scalar(i); if (!Number.isFinite(value) || scalars[i].type === 'boolean' && value !== 0 && value !== 1) fail('Invalid effect scalar frontier.'); }
      for (const plane of planes) for (let i = 0; i < plane.array.length; i++) if (!Number.isFinite(plane.read(i))) fail('Nonfinite effect history.');
      if (configurationBytes) for (let index = 0; index < configurationBytes.length; index++) if (bytes[configurationOffset + index] !== configurationBytes[index]) fail('Effect state belongs to a different exact prepared configuration.');
      validate(data);
      // All compatibility/domain checks finish before any live field changes.
      for (const plane of planes) for (let i = 0; i < plane.array.length; i++) plane.array[i] = plane.read(i);
      for (let i = 0; i < scalars.length; i++) kernel[scalars[i].name] = scalars[i].type === 'boolean' ? Boolean(scalar(i)) : scalar(i);
      return Object.freeze({ status: 'restored', abi: OWNED_EFFECT_STATE_ABI, frame: kernel.frame });
    } });
}
