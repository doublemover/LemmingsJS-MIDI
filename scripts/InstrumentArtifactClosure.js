import { collectRuntimeSourceClosure } from './RuntimeSourceClosure.js';
import { INSTRUMENT_ARTIFACT_ROOTS } from '../js/runtime/InstrumentArtifactManifest.js';

export async function collectInstrumentArtifactProfiles({ rootDir, inventory = null, fsImpl } = {}) {
  const available = inventory && new Map(inventory.map(file => [file.path, file])), profiles = [], sources = new Map();
  const entries = Object.entries(INSTRUMENT_ARTIFACT_ROOTS).sort(([left], [right]) => left < right ? -1 : 1).filter(([, entry]) => !available || available.has(entry));
  if (!entries.length) return { profiles, files: [] };
  // One owned graph, then independent reachability for each engine. Shared source
  // modules are read/parsed once, without a cross-build cache or weaker hashes.
  const closure = await collectRuntimeSourceClosure({ rootDir, entries: entries.map(([, entry]) => entry), fsImpl, maxFiles: 8192, maxBytes: 256 * 1048576, maxFileBytes: 64 * 1048576, includeGraph: true });
  const files = new Map(closure.files.map(file => [file.path, file])), graph = new Map(closure.graph.map(row => [row.path, row]));
  for (const [engineId, entry] of entries) {
    const pending = [entry], visited = new Set(); let bytes = 0;
    while (pending.length) {
      const name = pending.pop(); if (visited.has(name)) continue;
      const file = files.get(name), edges = graph.get(name); if (!file || !edges) throw new Error('Instrument artifact graph is incomplete: ' + name);
      visited.add(name); bytes += file.bytes;
      if (visited.size > 1024 || bytes > 64 * 1048576) throw new Error('Instrument artifact exceeds its source budget: ' + engineId);
      if (edges.dependencies.length) throw new Error('Instrument artifact has unresolved package dependencies: ' + engineId);
      const expected = available?.get(file.path) || sources.get(file.path);
      if (expected && (expected.sha256 !== file.sha256 || expected.bytes !== file.bytes) || available && !expected)
        throw new Error('Instrument artifact source differs from its application inventory: ' + file.path);
      if (!/\.(?:[cm]?js|json|wasm)$/.test(file.path)) throw new Error('Instrument artifact requires an unsupported external resource: ' + file.path);
      sources.set(file.path, file);
      pending.push(...edges.imports);
    }
    profiles.push({ engineId, engineVersion: 1, entry, files: [...visited].sort() });
  }
  return { profiles, files: [...sources.values()].sort((left, right) => left.path < right.path ? -1 : 1) };
}
