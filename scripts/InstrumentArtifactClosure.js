import { collectRuntimeSourceClosure } from './RuntimeSourceClosure.js';
import { INSTRUMENT_ARTIFACT_ROOTS } from '../js/runtime/InstrumentArtifactManifest.js';

export async function collectInstrumentArtifactProfiles({ rootDir, inventory = null, fsImpl } = {}) {
  const available = inventory && new Map(inventory.map(file => [file.path, file])), profiles = [], sources = new Map();
  for (const [engineId, entry] of Object.entries(INSTRUMENT_ARTIFACT_ROOTS).sort(([left], [right]) => left < right ? -1 : 1)) {
    if (available && !available.has(entry)) continue;
    const closure = await collectRuntimeSourceClosure({ rootDir, entries: [entry], fsImpl, maxFiles: 1024, maxBytes: 64 * 1048576 });
    if (closure.dependencies.length) throw new Error('Instrument artifact has unresolved package dependencies: ' + engineId);
    for (const file of closure.files) {
      const expected = available?.get(file.path) || sources.get(file.path);
      if (expected && (expected.sha256 !== file.sha256 || expected.bytes !== file.bytes) || available && !expected)
        throw new Error('Instrument artifact source differs from its application inventory: ' + file.path);
      if (!/\.(?:[cm]?js|json|wasm)$/.test(file.path)) throw new Error('Instrument artifact requires an unsupported external resource: ' + file.path);
      sources.set(file.path, file);
    }
    profiles.push({ engineId, engineVersion: 1, entry, files: closure.files.map(file => file.path) });
  }
  return { profiles, files: [...sources.values()].sort((left, right) => left.path < right.path ? -1 : 1) };
}
