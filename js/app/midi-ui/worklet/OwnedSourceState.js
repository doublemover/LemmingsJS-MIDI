import { SEALED_BODY_STATE, SEALED_BODY_PARAMETERS, validateOwnedSealedBody } from './OwnedSealedBody.js';
import { validateOwnedWindState } from './OwnedWindState.js';
import { WIND_MODEL_LIMITS } from '../../../midi/content/WindModel.js';
import { validateOwnedFrictionState } from './OwnedFrictionState.js';
import { FRICTION_MODEL_LIMITS } from '../../../midi/content/FrictionModel.js';
import { validateOwnedTextureState } from './OwnedTextureState.js';
import { TEXTURE_EXCITER_LIMITS } from '../../../midi/content/TextureExciter.js';
import { resolveCircularSpectrum } from '../../../midi/content/CircularSpectrum.js';
import { ownedKernelStateBytes, writeOwnedKernelState, restoreOwnedKernelState } from './OwnedSineState.js';
import { PLUCK_LAYOUT, CHOIR_LAYOUT, SPECTRUM_LAYOUT, GRANULAR_LAYOUT, SAMPLE_LAYOUT, TEXTURE_LAYOUT, FRICTION_LAYOUT, WIND_LAYOUT } from '../OwnedSourceLayout.js';

export const OWNED_SOURCE_STATE_ABI = 'owned-source-state-le-v3-lane-transfer';
const HEADER = 256, MAX_BYTES = 16 * 1048576;
const profiles = Object.freeze({
  [WIND_LAYOUT.width]: { id: 'worklet-wind', kind: 8, layout: WIND_LAYOUT, arrays: ['state', 'modes', 'graftState', 'graftParameters'], scalars: ['leftSample', 'rightSample'] },
  [FRICTION_LAYOUT.width]: { id: 'worklet-friction', kind: 7, layout: FRICTION_LAYOUT, arrays: ['state', 'modes', 'graftState', 'graftParameters'], scalars: ['leftSample', 'rightSample'] },
  80: { id: 'worklet-texture', kind: 6, layout: TEXTURE_LAYOUT, arrays: ['state', 'modes', 'pulses', 'observation', 'admission'], scalars: ['leftSample', 'rightSample'] },
  24: { id: 'worklet-pluck', kind: 1, layout: PLUCK_LAYOUT, arrays: ['state', 'buffer', 'scratch'], scalars: ['initializationWrites', 'initializationDenials', 'initializationBucket'] },
  26: { id: 'worklet-choir', kind: 2, layout: CHOIR_LAYOUT, arrays: ['state', 'bands'], scalars: [] },
  73: { id: 'worklet-spectrum', kind: 3, layout: SPECTRUM_LAYOUT, arrays: ['state', 'partials'], scalars: [] },
  40: { id: 'worklet-sample', kind: 5, layout: SAMPLE_LAYOUT, arrays: ['state', 'cursorQueues', 'cursorScalars'], scalars: ['leftSample', 'rightSample', 'readLeft', 'readRight'] },
  33: { id: 'worklet-granular', kind: 4, layout: GRANULAR_LAYOUT, arrays: ['state', 'grains'], scalars: ['birthBucket', 'bucketBirths', 'leftSample', 'rightSample'] }
});
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'incompatible-owned-source-state' }); };
const integer = (v, lo, hi = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const finite = (v, lo = -1000000, hi = 1000000) => Number.isFinite(v) && v >= lo && v <= hi;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let value = i; for (let b = 0; b < 8; b++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); crcTable[i] = value >>> 0; }
const checksum = bytes => {
  let value = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) value = value >>> 8 ^ crcTable[(value ^ (i >= 252 && i < 256 ? 0 : bytes[i])) & 255];
  return (value ^ 0xffffffff) >>> 0;
};
const profileFor = kernel => {
  const profile = profiles[kernel?.width], source = kernel?.source;
  if (!profile || !source || source.rate !== kernel.sampleRate || source.voices !== kernel.maxVoices ||
      !integer(source.voices, 1, profile.layout.voices)) fail('Unknown source or incompatible owned voice profile.');
  const t = TEXTURE_EXCITER_LIMITS;
  const expected = profile.kind === 8 ? [source.voices * WIND_MODEL_LIMITS.state, source.voices * WIND_MODEL_LIMITS.modes * WIND_MODEL_LIMITS.modeWidth, source.voices * SEALED_BODY_STATE, source.voices * SEALED_BODY_PARAMETERS] : profile.kind === 7 ? [source.voices * FRICTION_MODEL_LIMITS.state, source.voices * FRICTION_MODEL_LIMITS.modes * FRICTION_MODEL_LIMITS.modeWidth, source.voices * SEALED_BODY_STATE, source.voices * SEALED_BODY_PARAMETERS] : profile.kind === 6 ? [source.voices * t.state, source.voices * t.modes * t.modeWidth, source.voices * t.pulses * t.pulseWidth, source.voices * t.modes, 2] : profile.kind === 1 ? [source.voices * PLUCK_LAYOUT.state, source.voices * source.stride, source.stride] :
    profile.kind === 2 ? [source.voices * CHOIR_LAYOUT.state, source.voices * 3 * CHOIR_LAYOUT.bandState] :
      profile.kind === 3 ? [source.voices * SPECTRUM_LAYOUT.state, source.voices * 16 * SPECTRUM_LAYOUT.partialState] :
        profile.kind === 5 ? [source.voices * SAMPLE_LAYOUT.state, source.voices * SAMPLE_LAYOUT.zones * SAMPLE_LAYOUT.cursorCapacity * SAMPLE_LAYOUT.cursorWidth, source.voices * SAMPLE_LAYOUT.zones * SAMPLE_LAYOUT.cursorScalars] :
          [source.voices * GRANULAR_LAYOUT.cloudState, source.voices * GRANULAR_LAYOUT.grains * GRANULAR_LAYOUT.grainState];
  for (let i = 0; i < profile.arrays.length; i++) {
    const array = source[profile.arrays[i]], type = profile.kind === 1 && i === 1 ? Float32Array : Float64Array;
    if (!(array instanceof type) || array.length !== expected[i] || !(array.buffer instanceof ArrayBuffer)) fail('Owned source storage differs from its state ABI.');
  }
  if (profile.kind === 1 && (source.stride !== Math.ceil(kernel.sampleRate / PLUCK_LAYOUT.delayFloorHz) + PLUCK_LAYOUT.delayMargin || source.maxInitializationWrites !== 65536))
    fail('Pluck storage or initialization budget differs from its state profile.');
  if (![1, 6, 7, 8].includes(profile.kind) && !hash(source.bank?.hash) || profile.kind === 4 && (!hash(source.descriptor?.bankHash) ||
      source.sourceGain !== 0.9 / Math.max(1, source.descriptor.peak) / 4)) fail('Source asset identity or derived gain is unavailable.');
  if (profile.kind === 5 && (!(source.configuration instanceof Uint8Array) || !(source.configuration.buffer instanceof ArrayBuffer) || source.configuration.length > 524288 ||
      !hash(source.descriptor?.bankHash) || source.ownsEnvelope !== true || typeof source.validateStoredState !== 'function' || typeof source.synchronizeState !== 'function' || typeof source.rehydrateState !== 'function' ||
      source.sourceGain !== 0.9 / (2 * Math.SQRT2 * source.reader.maximumL1 * Math.max(1, ...source.descriptor.banks.map(bank => bank.peak))))) fail('Sample source configuration, PCM identity or layer ownership differs.');
  return profile;
};
const sizeFor = (kernel, profile) => HEADER + ownedKernelStateBytes(kernel) + profile.scalars.length * 8 +
  profile.arrays.reduce((sum, key) => sum + kernel.source[key].byteLength, 0) + (profile.kind === 5 ? kernel.source.configuration.byteLength : 0);
export function ownedSourceStateBytes(kernel) {
  const bytes = sizeFor(kernel, profileFor(kernel)); if (!integer(bytes, HEADER, MAX_BYTES)) fail('Owned state exceeds its bounded transfer profile.'); return bytes;
}
const viewFor = (kernel, bytes, profile) => {
  if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.length !== sizeFor(kernel, profile) || bytes.length > MAX_BYTES)
    fail('Owned state requires one exclusively owned exact-size transfer buffer.');
  const arrays = [kernel.queue, kernel.voice, kernel.mix, kernel.laneRoutes, kernel.pendingLanes, kernel.active, kernel.receipts, kernel.counters, ...profile.arrays.map(key => kernel.source[key]),
    ...(kernel.source.bank?.planes || []), ...(profile.kind === 5 ? kernel.source.pcm.flat() : kernel.source.pcm || []), ...(profile.kind === 5 ? [kernel.source.configuration] : [])];
  if (arrays.some(array => array.buffer === bytes.buffer)) fail('State transfer buffer aliases active DSP or immutable source storage.');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};
const identities = (view, source, writing) => {
  for (const [field, value] of [[64, source.bank?.hash], [96, source.descriptor?.bankHash]]) for (let i = 0; i < 32; i++) {
    const expected = value ? parseInt(value.slice(i * 2, i * 2 + 2), 16) : 0;
    if (writing) view.setUint8(field + i, expected); else if (view.getUint8(field + i) !== expected) fail('Immutable source bank or PCM hash differs from the state cut.');
  }
};
const accessors = (kernel, profile, view) => {
  let offset = HEADER + ownedKernelStateBytes(kernel);
  const scalars = profile.scalars.map((_, i) => view.getFloat64(offset + i * 8, true)); offset += scalars.length * 8;
  const arrays = profile.arrays.map(key => { const target = kernel.source[key], at = offset; offset += target.byteLength;
    return { target, at, get: index => target instanceof Float32Array ? view.getFloat32(at + index * 4, true) : view.getFloat64(at + index * 8, true) }; });
  return { scalars, arrays };
};
const inspectSource = (kernel, profile, view) => {
  const data = accessors(kernel, profile, view), source = kernel.source, state = data.arrays[0].get;
  for (const array of data.arrays) for (let i = 0; i < array.target.length; i++) if (!finite(array.get(i), -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) fail('Source memory contains nonfinite or excessive state.');
  if (data.scalars.some(value => !Number.isFinite(value))) fail('Source scalar state is nonfinite.');
  if (profile.kind === 1 && (!integer(data.scalars[0], 0, 65536) || !integer(data.scalars[1], 0) || !integer(data.scalars[2], -1))) fail('Pluck initialization frontier is invalid.');
  if (profile.kind === 4 && (!integer(data.scalars[0], -1) || !integer(data.scalars[1], 0, GRANULAR_LAYOUT.birthsPerBucket) ||
      !finite(data.scalars[2]) || !finite(data.scalars[3]))) fail('Granular birth frontier is invalid.');
  const core = HEADER, width = kernel.width, voiceOffset = core + 128 + 512 * width * 8, activeOffset = voiceOffset + 64 * 28 * 8;
  if (profile.kind === 8) {
    validateOwnedWindState({ source, arrays: data.arrays, scalars: data.scalars, frame: view.getFloat64(core + 24, true), active: slot => view.getUint8(activeOffset + slot), voice: (slot, field) => view.getFloat64(voiceOffset + (slot * 28 + field) * 8, true) });
    validateOwnedSealedBody({ source, arrays: data.arrays, active: slot => view.getUint8(activeOffset + slot), voice: (slot, field) => view.getFloat64(voiceOffset + (slot * 28 + field) * 8, true) }); return data;
  }
  if (profile.kind === 7) {
    validateOwnedFrictionState({ source, arrays: data.arrays, scalars: data.scalars, frame: view.getFloat64(core + 24, true), active: slot => view.getUint8(activeOffset + slot), voice: (slot, field) => view.getFloat64(voiceOffset + (slot * 28 + field) * 8, true) });
    validateOwnedSealedBody({ source, arrays: data.arrays, active: slot => view.getUint8(activeOffset + slot), voice: (slot, field) => view.getFloat64(voiceOffset + (slot * 28 + field) * 8, true) }); return data;
  }
  if (profile.kind === 6) {
    validateOwnedTextureState({ source, arrays: data.arrays, scalars: data.scalars, frame: view.getFloat64(core + 24, true), active: slot => view.getUint8(activeOffset + slot), voice: (slot, field) => view.getFloat64(voiceOffset + (slot * 28 + field) * 8, true) });
    return data;
  }
  if (profile.kind === 5) {
    if (data.scalars.some(value => Math.abs(value) > 256)) fail('Sample read scalar state exceeds its source bound.');
    source.validateStoredState(state, data.arrays[1].get, data.arrays[2].get);
    const frame = view.getFloat64(core + 24, true);
    for (let slot = 0; slot < source.voices; slot++) if (view.getUint8(activeOffset + slot)) {
      const at = slot * SAMPLE_LAYOUT.state, get = field => view.getFloat64(voiceOffset + (slot * 28 + field) * 8, true), entry = source.plan.entries[state(at)];
      if (state(at + 25) !== get(2) || state(at + 26) !== get(0) || state(at + 27) !== get(1) || state(at + 3) !== frame ||
          !source.frequencyValid(entry.attack, get(5)) || !source.frequencyValid(entry.attack, get(6)) || entry.release && (!source.frequencyValid(entry.release, get(5)) || !source.frequencyValid(entry.release, get(6))) ||
          entry.attack.mode === 'positionDriven' && get(5) !== get(6)) fail('Sample source and shared gate ancestry or pitch differ.');
    }
    return data;
  }
  for (let slot = 0; slot < source.voices; slot++) {
    if (!view.getUint8(activeOffset + slot)) continue;
    const at = slot * (profile.layout.state || profile.layout.cloudState), get = field => state(at + field),
      frequency = view.getFloat64(voiceOffset + (slot * 28 + 5) * 8, true), target = view.getFloat64(voiceOffset + (slot * 28 + 6) * 8, true);
    const low = get(profile.kind === 4 ? 25 : 4), high = get(profile.kind === 4 ? 26 : 5);
    if (!finite(low, Number.MIN_VALUE, kernel.sampleRate / 2) || !finite(high, low, kernel.sampleRate / 2) ||
        !finite(frequency, low, high) || !finite(target, low, high)) fail('Source pitch state disagrees with its owned gate.');
    if (profile.kind === 1 && (!integer(get(0), 2, source.stride) || !integer(get(1), 0, get(0) - 1) ||
        !integer(get(6), 0, 0xffffffff) || !integer(get(7), 0, get(0) - 1) || !finite(get(16), -1, 1))) fail('Pluck fractional delay or seed state is invalid.');
    if (profile.kind === 2 && (!finite(get(0), 0, 1) || !finite(get(1), 0, 1) || !integer(get(2), 0, 0xffffffff))) fail('Choir phase or PRNG state is invalid.');
    if (profile.kind === 3) {
      if (!finite(get(0), 0, 1) || ![0, 1, 2].includes(get(1)) || !integer(get(2), 1, 16)) fail('Spectrum phase or partial topology is invalid.');
      const partial = data.arrays[1].get;
      if (get(1) === 2) {
        const meta = (slot * 16 + 10) * SPECTRUM_LAYOUT.partialState; let recipe;
        try { recipe = resolveCircularSpectrum({ referenceFrequencyHz: partial(meta), frequencyCenterHz: partial(meta + 1), spectralWidthOctaves: partial(meta + 2), bandLowHz: partial(meta + 3), bandHighHz: partial(meta + 4), partialCountCap: partial(meta + 5), weight01: partial(meta + 6) }, kernel.sampleRate, get(3) / 261.6255653005986); } catch { fail('Circular source recipe is invalid.'); }
        const base = at + 24, phase = state(base), targetPhase = state(base + 1), remaining = state(base + 2), step = state(base + 3), whole = state(base + 4);
        if (get(2) !== recipe.partialCountCap || !finite(phase, -1000000, 1000000) || !finite(targetPhase, -1000000, 1000000) || !integer(remaining, 0, kernel.sampleRate * 2) || !finite(step, -4 / kernel.sampleRate, 4 / kernel.sampleRate) ||
            !integer(whole, -1000001, 1000001) || Math.abs(Math.floor(phase) - whole) > 1 || !integer(state(base + 5), 0, 0xffffffff) || !integer(state(base + 7), 0, 8) || !integer(state(base + 8), 0, recipe.partialCountCap) || !integer(state(base + 9), 0) || state(base + 10) || state(base + 11) ||
            remaining && Math.abs(targetPhase - phase - remaining * step) > 1e-6 || remaining && Math.abs(state(base + 6) - 2 ** step) > 1e-12) fail('Circular distance-phase or interpolation frontier is invalid.');
        const indices = new Set(); let amplitude = 0, targetAmplitude = 0;
        for (let p = 0; p < recipe.partialCountCap; p++) {
          const offset = (slot * 16 + p) * SPECTRUM_LAYOUT.partialState, index = partial(offset), expected = recipe.referenceFrequencyHz * 2 ** (index + phase - whole);
          if (!integer(index, recipe.minimumIndex, recipe.maximumIndex) || indices.has(index) || !finite(partial(offset + 1), 0, 1) || !finite(partial(offset + 2), 0, 10000000) || Math.abs(partial(offset + 2) - expected) > 1e-6 * Math.max(1, expected) ||
              !finite(partial(offset + 3), 0, 0.8) || !finite(partial(offset + 4), 0, 0.8) || partial(offset + 5)) fail('Circular oscillator phase, lattice handoff or amplitude is invalid.');
          indices.add(index); amplitude += partial(offset + 3); targetAmplitude += partial(offset + 4);
        }
        if (amplitude > 0.800000001 || targetAmplitude > 0.800000001) fail('Circular amplitude normalization exceeds the declared peak bound.');
        continue;
      }
      for (let p = 0; p < 16; p++) { const offset = (slot * 16 + p) * SPECTRUM_LAYOUT.partialState;
        if (!finite(partial(offset), 0.125, 32) || !finite(partial(offset + 2), 0, 1) || !finite(partial(offset + 4), 0, 1)) fail('Spectrum partial phase or decay state is invalid.');
      }
    }
    if (profile.kind === 4) {
      if (!integer(get(0), 0, 0xffffffff) || ![0, 1].includes(get(15)) || ![0, 1].includes(get(17)) || ![0, 1].includes(get(18)) ||
          !integer(get(22), 0, source.descriptor.frames - 2) || !integer(get(23), get(22) + 2, source.descriptor.frames) ||
          !integer(get(27), 0, GRANULAR_LAYOUT.grains) || !integer(get(38), -1)) fail('Granular region, seed or time frontier is invalid.');
      const grains = data.arrays[1].get; let active = 0;
      for (let g = 0; g < GRANULAR_LAYOUT.grains; g++) { const offset = (slot * GRANULAR_LAYOUT.grains + g) * GRANULAR_LAYOUT.grainState, remaining = grains(offset);
        if (!integer(remaining, 0, Math.ceil(kernel.sampleRate * 0.14))) fail('Grain lifetime is invalid.');
        if (!remaining) continue; active++;
        if (!integer(grains(offset + 1), remaining, Math.ceil(kernel.sampleRate * 0.14)) || !integer(grains(offset + 7), 1) ||
            !integer(grains(offset + 8), 1) || !integer(grains(offset + 9), 0)) fail('Grain birth identity is invalid.');
      }
      if (active !== get(27)) fail('Granular child membership differs from its cloud state.');
    }
  }
  return data;
};
const verify = (kernel, bytes, profile) => {
  const view = viewFor(kernel, bytes, profile), coreBytes = ownedKernelStateBytes(kernel);
  if (view.getUint32(0, true) !== 0x3153444c || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length ||
      view.getUint32(12, true) !== coreBytes || view.getUint32(16, true) !== profile.kind || view.getUint32(20, true) !== kernel.width ||
      view.getUint32(24, true) !== profile.arrays.length || view.getUint32(28, true) !== profile.scalars.length || view.getUint32(252, true) !== checksum(bytes)) fail('Source state ABI, profile, size or checksum differs.');
  for (let i = 0; i < (profile.kind === 6 ? 5 : 3); i++) if (view.getUint32(32 + i * 4, true) !== (kernel.source[profile.arrays[i]]?.byteLength || 0)) fail('Source memory shape differs.');
  if (profile.kind === 5 && view.getUint32(44, true) !== kernel.source.configuration.length) fail('Sample state configuration size differs.');
  for (let i = 44; i < 252; i++) if (!(i >= 64 && i < 128) && !([5, 7, 8].includes(profile.kind) && i < 48) && !(profile.kind === 6 && i < 52) && bytes[i]) fail('Source state reserved header is noncanonical.');
  if (profile.kind === 5) { const configuration = kernel.source.configuration, offset = bytes.length - configuration.length; for (let i = 0; i < configuration.length; i++) if (bytes[offset + i] !== configuration[i]) fail('Sample state belongs to a different exact prepared map.'); }
  identities(view, kernel.source, false); return { view, data: inspectSource(kernel, profile, view), coreBytes };
};

export function writeOwnedSourceState(kernel, destination, identity) {
  const profile = profileFor(kernel), view = viewFor(kernel, destination, profile), coreBytes = ownedKernelStateBytes(kernel);
  kernel.source.synchronizeState?.();
  destination.fill(0); const cut = writeOwnedKernelState(kernel, destination.subarray(HEADER, HEADER + coreBytes), identity);
  for (const [at, value] of [[0, 0x3153444c], [4, 2], [8, destination.length], [12, coreBytes], [16, profile.kind], [20, kernel.width], [24, profile.arrays.length], [28, profile.scalars.length]]) view.setUint32(at, value, true);
  for (let i = 0; i < profile.arrays.length; i++) view.setUint32(32 + i * 4, kernel.source[profile.arrays[i]].byteLength, true);
  if (profile.kind === 5) view.setUint32(44, kernel.source.configuration.length, true);
  identities(view, kernel.source, true); let offset = HEADER + coreBytes;
  for (const key of profile.scalars) { view.setFloat64(offset, kernel.source[key], true); offset += 8; }
  for (const key of profile.arrays) { const array = kernel.source[key];
    for (let i = 0; i < array.length; i++) if (array instanceof Float32Array) view.setFloat32(offset + i * 4, array[i], true); else view.setFloat64(offset + i * 8, array[i], true);
    offset += array.byteLength;
  }
  if (profile.kind === 5) destination.set(kernel.source.configuration, offset);
  view.setUint32(252, checksum(destination), true); verify(kernel, destination, profile);
  return Object.freeze({ ...cut, abi: OWNED_SOURCE_STATE_ABI, engineId: profile.id, bytes: destination.length,
    immutableAssets: profile.kind === 8 ? 'original-sealed-wind-and-inline-controls-bound-to-core-artifact-and-patch-pins' : profile.kind === 7 ? 'original-sealed-friction-and-inline-controls-bound-to-core-artifact-and-patch-pins' : profile.kind === 6 ? 'original-spatial-kernel-and-inline-body-bound-to-core-artifact-and-patch-pins' : 'pinned-exact-bank-hashes-not-copied', qualification: 'state-contract-awaiting-pcm-equivalence' });
}

export function restoreOwnedSourceState(kernel, source, identity) {
  const profile = profileFor(kernel), { view, data, coreBytes } = verify(kernel, source, profile);
  // All source validation precedes mutation. The core adapter independently
  // validates its identities, heap, frontiers and receipts before committing.
  const cut = restoreOwnedKernelState(kernel, source.subarray(HEADER, HEADER + coreBytes), identity);
  for (let i = 0; i < profile.scalars.length; i++) kernel.source[profile.scalars[i]] = data.scalars[i];
  for (const array of data.arrays) for (let i = 0; i < array.target.length; i++) array.target[i] = array.get(i);
  kernel.source.rehydrateState?.(kernel.active);
  return Object.freeze({ ...cut, abi: OWNED_SOURCE_STATE_ABI, engineId: profile.id, sourceMemory: 'independent-mutable-copy', checksum: view.getUint32(252, true) });
}
