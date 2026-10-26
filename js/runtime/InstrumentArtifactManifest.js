import { hashData } from '../core/CanonicalData.js';

export const INSTRUMENT_ARTIFACT_ROOTS = Object.freeze({
  'native-oscillator': 'js/app/midi-ui/nativeOscillatorBackend.js',
  'native-fm': 'js/app/midi-ui/nativeOscillatorBackend.js',
  'native-modal': 'js/app/midi-ui/nativeOscillatorBackend.js',
  'native-sample': 'js/app/midi-ui/sampleInstrumentBackend.js',
  'worklet-wind': 'js/app/midi-ui/workletInstrumentBackend.js',
  'worklet-friction': 'js/app/midi-ui/workletInstrumentBackend.js',
  'worklet-choir': 'js/app/midi-ui/workletInstrumentBackend.js',
  'worklet-pluck': 'js/app/midi-ui/workletInstrumentBackend.js',
  'worklet-spectrum': 'js/app/midi-ui/workletInstrumentBackend.js',
  'worklet-granular': 'js/app/midi-ui/workletInstrumentBackend.js',
  'worklet-seed-layers': 'js/app/midi-ui/workletInstrumentBackend.js',
  'worklet-sample': 'js/app/midi-ui/workletInstrumentBackend.js',
  'worklet-texture': 'js/app/midi-ui/workletInstrumentBackend.js',
  'worklet-sine': 'js/app/midi-ui/workletInstrumentBackend.js'
});

export async function computeInstrumentArtifacts(files, profiles) {
  if (!Array.isArray(files) || !Array.isArray(profiles) || profiles.length > Object.keys(INSTRUMENT_ARTIFACT_ROOTS).length) throw new Error('Unsupported instrument artifact inventory.');
  const inventory = new Map(files.map(file => [file.path, file])), artifacts = [], seen = new Set(); let previous = '';
  for (const profile of profiles) {
    if (!profile || !Object.hasOwn(INSTRUMENT_ARTIFACT_ROOTS, profile.engineId) || seen.has(profile.engineId) || profile.engineId <= previous ||
        profile.engineVersion !== 1 || profile.entry !== INSTRUMENT_ARTIFACT_ROOTS[profile.engineId] || !Array.isArray(profile.files) ||
        !profile.files.length || profile.files.length > 1024 || !profile.files.includes(profile.entry)) throw new Error('Invalid instrument artifact profile.');
    previous = profile.engineId; seen.add(profile.engineId);
    let prior = '', bytes = 0;
    const vector = profile.files.map(name => {
      const file = inventory.get(name);
      if (typeof name !== 'string' || name <= prior || !file || !/\.(?:[cm]?js|json|wasm)$/.test(name) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
          !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Instrument artifact references a missing or duplicate source.');
      prior = name; bytes += file.bytes; if (bytes > 64 * 1048576) throw new Error('Instrument artifact exceeds its source byte bound.');
      return { path: name, bytes: file.bytes, sha256: file.sha256 };
    });
    artifacts.push(Object.freeze({ engineId: profile.engineId, engineVersion: 1,
      artifactHash: await hashData({ schema: 'lemmings-instrument-artifact/v1', engineId: profile.engineId, engineVersion: 1, files: vector }) }));
  }
  return Object.freeze(artifacts);
}
