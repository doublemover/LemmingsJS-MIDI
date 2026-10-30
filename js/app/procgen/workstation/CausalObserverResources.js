import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { estimateJournalFootprint } from './CausalJournalCanonical.js';

const MiB = 1048576;
// Declared JS/native-independent estimates accompany local entry/work/byte caps;
// they are not measurements of a browser's object representation.
export function causalObserverResourceProfile(graph, { maxVoices = 512, maxBeginsPerBatch = 512, traceLimit = 1024 } = {}) {
  if (![maxVoices, maxBeginsPerBatch, traceLimit].every(Number.isSafeInteger) || maxVoices < 0 || maxVoices > 4096 || maxBeginsPerBatch < 0 || maxBeginsPerBatch > 4096 || traceLimit < 0 || traceLimit > 8192) throw new Error('Invalid observer memory profile.');
  const features = {
    core: 8 * MiB + Math.max(4096, maxVoices) * 2048 + Math.min(8 * MiB, traceLimit * 32768),
    swarm: 16 * MiB,
    physical: graph?.pickups?.length || graph?.ensembles?.length || graph?.routes?.length ? 32 * MiB : 0,
    tonal: graph?.harmonicFields?.length || graph?.formations?.length ? 16 * MiB : 0,
    rhythmic: graph?.instruments?.some(value => value.response) ? 32 * MiB : 0,
    action: graph?.instruments?.some(value => value.actionVoicePolicy) ? 8 * MiB : 0,
    encounters: graph?.encounters?.length ? 32 * MiB : 0,
    motifs: graph?.motifs?.length ? 16 * MiB : 0,
    activity: graph?.activityWindows?.length ? 8 * MiB : 0,
    preparedSurfaces: graph?.preparedSurfaces?.length ? 8 * MiB : 0,
    cargo: graph?.cargoStations?.length ? 8 * MiB : 0
  };
  const scratchBytes = 8 * MiB + Math.max(512, maxBeginsPerBatch) * 8192;
  return Object.freeze({ schema: 'causal-observer-memory/v1', estimated: true, features: Object.freeze(features),
    stateBytes: Object.values(features).reduce((a, b) => a + b, 0), scratchBytes });
}

export function createCausalObserverResources({ resourceBudget, ...capacity } = {}) {
  let profile = causalObserverResourceProfile(null, capacity), disposed = false, activeOperation = false, retirementError = null;
  const owner = createOwnedResourceReservation({ budget: resourceBudget, owner: 'causal-observers', kind: 'physical-interpreter-estimated-state-and-scratch', category: 'candidate', bytes: profile.stateBytes + profile.scratchBytes });
  const check = () => { if (retirementError) throw retirementError; if (disposed) throw new Error('Causal observer storage is disposed.'); if (!owner.isActive()) throw new Error('Causal observer storage retirement is unresolved.'); };
  let committedFeatures = profile.features; const pending = new Map();
  const union = values => Object.fromEntries(Object.keys(committedFeatures).map(key => [key, Math.max(committedFeatures[key], ...values.map(value => value[key] || 0))]));
  const publishProfile = features => { const stateBytes = Object.values(features).reduce((a, b) => a + b, 0); owner.resize(stateBytes + profile.scratchBytes); profile = Object.freeze({ ...profile, stateBytes, features: Object.freeze(features) }); };
  const prepareGraph = graph => {
    check(); if (pending.size >= 16) throw new Error('Causal graph resource proposal capacity exceeded.');
    const next = causalObserverResourceProfile(graph, capacity), token = {}; let committed = false, canceled = false;
    publishProfile(union([...pending.values(), next.features])); pending.set(token, next.features);
    return Object.freeze({
      commit() { check(); if (canceled) throw new Error('Causal resource proposal was canceled.'); if (committed) return profile;
        committedFeatures = Object.freeze(union([next.features])); pending.delete(token); committed = true; return profile; },
      cancel() { if (committed || canceled) return false; check(); const features = union([...pending].filter(([id]) => id !== token).map(([, value]) => value)); publishProfile(features); pending.delete(token); canceled = true; return true; }
    });
  };
  const admitGraph = graph => prepareGraph(graph).commit();
  const admitStage = (kind, operation, bytes) => {
    check(); if (activeOperation) throw new Error('Causal observer staging is already active.');
    const lease = createOwnedResourceReservation({ budget: resourceBudget, owner: 'causal-observer-staging', kind, category: 'candidate', bytes });
    activeOperation = true;
    try { return operation(); } finally { activeOperation = false; try { lease.release(); } catch (error) { retirementError = error; throw error; } }
  };
  const stage = (kind, operation) => admitStage(kind, operation, profile.stateBytes + profile.scratchBytes);
  const stageInput = (kind, input, operation) => {
    check(); const inventory = estimateJournalFootprint(input, { maxBytes: 128 * MiB, maxNodes: 2097152 });
    const bytes = Math.min(profile.stateBytes + profile.scratchBytes, Math.max(MiB, inventory.bytes * 12 + inventory.nodes * 192 + 65536));
    return admitStage(kind, operation, bytes);
  };
  return Object.freeze({ check, admitGraph, prepareGraph, stage, stageInput,
    diagnostics: () => Object.freeze({ ...profile, reservation: owner.receipt(), activeOperation, disposed, pendingGraphProposals: pending.size, retirementError: retirementError?.message || null, retentionPolicy: 'feature-high-water-until-owner-retirement' }),
    dispose() { if (retirementError) throw retirementError; if (disposed) return false; if (activeOperation) throw new Error('Causal observer operation is still active.'); owner.release(); pending.clear(); disposed = true; return true; }
  });
}
