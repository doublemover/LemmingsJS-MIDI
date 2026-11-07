import { retainInstrumentCause } from './InstrumentPerformance.js';
import { queryCausalCoverage } from '../../app/procgen/workstation/CausalCoverage.js';
import { freezeData } from '../../core/CanonicalData.js';

export async function summarizeGestureTakeCoverage({ manifest, revoice }, { signal, current = () => true, yieldControl = () => Promise.resolve(), maximumVoices = 256 } = {}) {
  if (!manifest || manifest.canonicalHash !== revoice?.sourceCanonicalHash || manifest.revision !== revoice.takeRevision || !Array.isArray(revoice.intents) || revoice.intents.length > 32768 || !Number.isSafeInteger(maximumVoices) || maximumVoices < 1 || maximumVoices > 256) throw new Error('Inspect one exact bounded immutable take revision for gesture compatibility.');
  const voices = new Map(), sourceKinds = new Set(), evidence = new Set(); let omittedVoices = 0;
  const key = intent => JSON.stringify([intent.worldId, intent.generation, intent.voiceId]);
  for (const [index, intent] of revoice.intents.entries()) {
    signal?.throwIfAborted(); if (!current()) throw new Error('The selected take changed during control coverage inspection.');
    const id = key(intent);
    if (intent.kind === 'begin' && !voices.has(id)) { if (voices.size >= maximumVoices) omittedVoices++; else voices.set(id, { id, mappingId: intent.mappingId || null, onset: new Set(), continuous: new Set(), evidence: new Set() }); }
    const voice = voices.get(id);
    if (intent.performanceCause) {
      const cause = retainInstrumentCause(intent.performanceCause); sourceKinds.add(cause.sourceKind);
      if (voice && (intent.kind === 'begin' || intent.kind === 'update')) for (const field of Object.keys(cause.values)) voice[intent.kind === 'begin' ? 'onset' : 'continuous'].add(cause.sourceKind + '.' + field);
    }
    const observed = kind => { evidence.add(kind); voice?.evidence.add(kind); };
    if (intent.topologyBinding?.status === 'complete') observed('topology-binding');
    if (intent.articulationState?.contactCoordinate?.schema === 'lemmings-canonical-contact-coordinate/v1') observed('canonical-contact-coordinate');
    const travel = intent.articulationState?.travel;
    if (travel?.schema === 'lemmings-canonical-travel-observation/v1' && travel.metric === 'qualified-route-arc-pixels' && travel.routeId && travel.routeRevision != null && travel.precision === 'completed-route-endpoint-projection') observed('retained-route-travel');
    if (travel?.schema === 'lemmings-canonical-travel-observation/v1' && travel.precision === 'committed-coordinate-write' && Number.isInteger(travel.segmentCount) && travel.segmentCount > 0 && travel.timing === 'completed-tick-equal-segments-v1') observed('retained-motion-segments');
    if (index % 512 === 0) await yieldControl();
  }
  const coverage = manifest.coverage, factsCovered = coverage?.sourceRange ? queryCausalCoverage({ coverage, kind: 'physical-facts', range: coverage.sourceRange }).status === 'known-covered' : false;
  return freezeData({ takeId: manifest.takeId, revision: manifest.revision, canonicalHash: manifest.canonicalHash, coverage: revoice.coverage?.status === 'known-covered' ? 'known-covered' : 'unknown',
    initialVoices: Array.isArray(manifest.boundaryState?.voices) ? manifest.boundaryState.voices.length ? 'held' : 'empty' : 'unknown', retainedSourceKinds: [...sourceKinds].sort(),
    retainedEvidence: [...evidence].sort(), controlVoices: [...voices.values()].map(voice => ({ id: voice.id, mappingId: voice.mappingId, onset: [...voice.onset].sort(), continuous: [...voice.continuous].sort(), evidence: [...voice.evidence].sort() })),
    controlCoverage: { maximumVoices, observedVoices: voices.size, omittedVoices, complete: !omittedVoices && revoice.nextSequence == null }, availableFactKinds: [...(coverage?.available?.factKinds || [])].sort(), factsCovered });
}
