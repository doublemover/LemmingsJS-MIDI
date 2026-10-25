import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

const MiB = 1048576;
// These are explicit JS/native-independent estimates above the observers' own
// entry/work/byte caps, not measurements of a browser's object representation.
export function causalObserverResourceProfile(graph, { maxVoices = 512, maxBeginsPerBatch = 512, traceLimit = 1024 } = {}) {
  if (![maxVoices, maxBeginsPerBatch, traceLimit].every(Number.isSafeInteger) || maxVoices < 0 || maxVoices > 4096 || maxBeginsPerBatch < 0 || maxBeginsPerBatch > 4096 || traceLimit < 0 || traceLimit > 8192) throw new Error('Invalid observer memory profile.');
  const features = {
    core: 8 * MiB + Math.max(4096, maxVoices) * 2048 + Math.min(8 * MiB, traceLimit * 32768),
    swarm: 16 * MiB,
    physical: graph?.pickups?.length || graph?.ensembles?.length || graph?.routes?.length ? 24 * MiB : 0,
    tonal: graph?.harmonicFields?.length || graph?.formations?.length ? 16 * MiB : 0,
    rhythmic: graph?.instruments?.some(value => value.response) ? 32 * MiB : 0,
    action: graph?.instruments?.some(value => value.actionVoicePolicy) ? 8 * MiB : 0,
    encounters: graph?.encounters?.length ? 32 * MiB : 0,
    motifs: graph?.motifs?.length ? 16 * MiB : 0,
    activity: graph?.activityWindows?.length ? 8 * MiB : 0,
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
  const admitGraph = graph => {
    check(); const next = causalObserverResourceProfile(graph, capacity), features = Object.fromEntries(Object.entries(next.features).map(([key, bytes]) => [key, Math.max(bytes, profile.features[key] || 0)]));
    const stateBytes = Object.values(features).reduce((a, b) => a + b, 0);
    owner.resize(stateBytes + next.scratchBytes);
    profile = Object.freeze({ ...next, stateBytes, features: Object.freeze(features) }); return profile;
  };
  const stage = (kind, operation) => {
    check(); if (activeOperation) throw new Error('Causal observer staging is already active.');
    const lease = createOwnedResourceReservation({ budget: resourceBudget, owner: 'causal-observer-staging', kind, category: 'candidate', bytes: profile.stateBytes + profile.scratchBytes });
    activeOperation = true;
    try { return operation(); } finally { activeOperation = false; try { lease.release(); } catch (error) { retirementError = error; throw error; } }
  };
  return Object.freeze({ check, admitGraph, stage,
    diagnostics: () => Object.freeze({ ...profile, reservation: owner.receipt(), activeOperation, disposed, retirementError: retirementError?.message || null, retentionPolicy: 'feature-high-water-until-owner-retirement' }),
    dispose() { if (retirementError) throw retirementError; if (disposed) return false; if (activeOperation) throw new Error('Causal observer operation is still active.'); owner.release(); disposed = true; return true; }
  });
}
