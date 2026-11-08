import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { SOUND_REALIZATION_SCHEMA } from '../../midi/content/SoundRealizationProfiles.js';

const failure = (code, message) => Object.assign(new Error(message), { code });
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
let nextOwner = 0;
export function createSoundRealizationAdmission({ prepare, qualifyAutomatic = () => null, onReceipt = () => {}, resourceBudget = null,
  maxLanes = 1024, cooldownSeconds = 10, pressureSamples = 3, recoverySamples = 30 } = {}) {
  if (typeof prepare !== 'function' || typeof qualifyAutomatic !== 'function' || typeof onReceipt !== 'function' ||
      !Number.isSafeInteger(maxLanes) || maxLanes < 1 || maxLanes > 1024 || !Number.isFinite(cooldownSeconds) || cooldownSeconds < 1 || cooldownSeconds > 120 ||
      !Number.isInteger(pressureSamples) || pressureSamples < 1 || pressureSamples > 60 || !Number.isInteger(recoverySamples) || recoverySamples < pressureSamples || recoverySamples > 600)
    throw new TypeError('Invalid authored realization admission owner.');
  const lanes = new Map(), scope = createProcgenRetirementScope(), receipts = [];
  const metadata = createOwnedResourceReservation({ budget: resourceBudget, owner: 'sound-realizations-' + (++nextOwner), kind: 'requested-effective-sound-profiles', category: 'audio', bytes: 4096 });
  let disposed = false, sequence = 0, unknown = false, automaticLanes = 0, lastTelemetry = null, pressure = 0, recovery = 0, lastChangeFrame = null, lastAdaptedLane = '';
  const emit = row => {
    const receipt = Object.freeze({ schema: 'lemmings-sound-realization-decision/v1', sequence: ++sequence, ...row,
      appliedFrame: null, evidence: 'owned-preparation-and-API-admission;not-rendered-or-acoustic-proof' });
    if (receipts.length === 128) receipts.shift(); receipts.push(receipt);
    try { onReceipt(receipt); } catch {} return receipt;
  };
  const profileFor = (row, id) => row.group.profiles.find(profile => profile.id === id);
  const transitionFor = (row, id) => row.effective === null || row.effective === id ? null : row.group.transitions.find(transition => transition.from === row.effective && transition.to === id);
  const check = row => {
    if (disposed || unknown || lanes.get(row.laneId) !== row || row.controller.signal.aborted) throw failure('realization-owner-stale', 'The realization request no longer owns this lane.');
  };
  const retireCandidate = async candidate => {
    const retirement = candidate?.release?.();
    if (retirement?.completion) await retirement.completion;
    if (retirement?.outcome && retirement.outcome !== 'complete') { unknown = true; throw Object.assign(failure('retirement-unknown', 'A realization candidate remains charged.'), { retirement }); }
  };
  const choose = async (row, selectedId, reason, automatic = false, telemetry = null) => {
    check(row);
    if (row.pending) throw failure('realization-preparation-busy', 'This lane already has a realization preparation.');
    const profile = profileFor(row, selectedId), transition = transitionFor(row, selectedId);
    if (!profile) throw failure('realization-profile-unavailable', 'Choose a concrete authored profile.');
    if (row.effective !== null && row.effective !== selectedId && (!transition || transition.boundary !== 'next-onset-only' ||
        transition.overlapPolicy !== 'old-tail-plus-new-charged-separately')) throw failure('realization-needs-stop', 'This authored profile transition requires a stopped replacement.');
    let qualification = null;
    if (automatic) {
      qualification = qualifyAutomatic(Object.freeze({ group: row.group, profile, fromProfileId: row.effective, sampleRate: telemetry.sampleRate, contextEpoch: telemetry.contextEpoch }));
      if (!qualification || qualification.automaticAdmission !== true || qualification.definitionHash !== profile.definitionHash ||
          qualification.engineArtifactHash !== profile.engineRequirement.artifactHash || qualification.sampleRate !== telemetry.sampleRate || qualification.contextEpoch !== telemetry.contextEpoch ||
          !identity(qualification.measurementId)) throw failure('realization-unqualified', 'This exact profile has no runtime-owned qualification for automatic adaptation.');
    }
    const controller = new AbortController(), abort = () => controller.abort(row.controller.signal.reason);
    row.controller.signal.addEventListener('abort', abort, { once: true });
    const operation = { controller, candidate: null, completion: null }; row.pending = operation; row.prepared = null;
    operation.completion = (async () => {
      try {
        operation.candidate = await prepare(Object.freeze({ laneId: row.laneId, group: row.group, profile, requestedProfileId: row.requested,
          effectiveProfileId: selectedId, reason, automatic, qualification, signal: controller.signal }));
        check(row); controller.signal.throwIfAborted();
        if (row.pending !== operation) throw failure('realization-owner-stale', 'A newer quality request superseded this preparation.');
        row.prepared = selectedId; operation.candidate.validateCommit?.(); operation.candidate.commit();
        const outcome = operation.candidate.accept();
        row.effective = selectedId; row.effectiveDefinitionHash = profile.definitionHash; row.prepared = null;
        if (telemetry) lastChangeFrame = telemetry.audioFrame;
        return emit({ status: outcome?.status === 'degraded' ? 'degraded' : 'accepted', laneId: row.laneId, groupId: row.group.id, requestedProfileId: row.requested,
          preparedProfileId: selectedId, effectiveProfileId: selectedId, definitionHash: profile.definitionHash, engineRequirement: profile.engineRequirement,
          reason, automatic, targetFrame: outcome?.targetFrame ?? null, affectedHeldVoices: 0, heldPolicy: 'original-profile-through-terminal-release',
          changedAudibleProperties: profile.changedAudibleProperties, preservedInvariants: profile.preservedInvariants, measurementId: qualification?.measurementId || null });
      } catch (error) {
        emit({ status: 'rejected', laneId: row.laneId, groupId: row.group.id, requestedProfileId: row.requested, preparedProfileId: row.prepared,
          effectiveProfileId: row.effective, reason: error.code || 'realization-preparation-failed', message: error.message, automatic });
        throw error;
      } finally {
        row.controller.signal.removeEventListener('abort', abort);
        try { await retireCandidate(operation.candidate); } finally { if (row.pending === operation) { row.pending = null; row.prepared = null; } }
      }
    })();
    return operation.completion;
  };
  const cancel = async row => {
    row.controller.abort(failure('realization-request-canceled', 'The lane quality request changed.'));
    if (row.pending) await Promise.allSettled([row.pending.completion]);
  };
  const request = async (laneId, group, requestedProfileId, { automatic = false, effectiveProfileId = null } = {}) => {
    if (disposed || unknown || !identity(laneId) || group?.schema !== SOUND_REALIZATION_SCHEMA || !Array.isArray(group.profiles) || !group.profiles.length || group.profiles.length > 8 ||
        !group.profiles.some(profile => profile.id === requestedProfileId) || typeof automatic !== 'boolean' ||
        effectiveProfileId !== null && !group.profiles.some(profile => profile.id === effectiveProfileId)) throw failure('realization-request-invalid', 'Use the verified compiled realization group and an actual requested profile.');
    const old = lanes.get(laneId);
    if (!old && lanes.size >= maxLanes) throw failure('realization-lane-capacity', 'Realization lane capacity reached.');
    if (old) await cancel(old);
    if (disposed || unknown || old && lanes.get(laneId) !== old) throw failure('realization-owner-stale', 'The quality source changed while retiring its previous preparation.');
    metadata.resize(4096 + 128 * 16384 + (lanes.size + (old ? 0 : 1)) * 4096);
    const row = { laneId, group, requested: requestedProfileId, effective: effectiveProfileId ?? (old?.group === group ? old.effective : null),
      prepared: null, automatic, controller: new AbortController(), pending: null, effectiveDefinitionHash: null };
    lanes.set(laneId, row);
    automaticLanes += (automatic ? 1 : 0) - (old?.automatic ? 1 : 0);
    if (row.effective === requestedProfileId) {
      row.effectiveDefinitionHash = profileFor(row, requestedProfileId).definitionHash;
      return emit({ status: 'accepted', stage: 'already-admitted-profile-registered', laneId, groupId: group.id, requestedProfileId, effectiveProfileId: row.effective,
        reason: 'register-current-owned-assignment', automatic, heldPolicy: 'original-profile-through-terminal-release' });
    }
    return choose(row, requestedProfileId, 'explicit-requested-profile');
  };
  const observe = telemetry => {
    if (disposed || unknown) return Object.freeze({ status: 'unavailable', reason: 'realization-owner-retired' });
    if (!telemetry || !Number.isSafeInteger(telemetry.contextEpoch) || telemetry.contextEpoch < 0 || !Number.isSafeInteger(telemetry.audioFrame) || telemetry.audioFrame < 0 ||
        !Number.isSafeInteger(telemetry.sampleRate) || telemetry.sampleRate < 8000 || telemetry.sampleRate > 384000 ||
        !Number.isFinite(telemetry.underrunEvents) || telemetry.underrunEvents < 0 || !Number.isSafeInteger(telemetry.underrunEvents) ||
        telemetry.deadlineUtilization01 !== null && (!Number.isFinite(telemetry.deadlineUtilization01) || telemetry.deadlineUtilization01 < 0 || telemetry.deadlineUtilization01 > 4))
      return Object.freeze({ status: 'unavailable', reason: 'quality-telemetry-unavailable;no-automatic-upgrade' });
    const changedEpoch = !lastTelemetry || telemetry.contextEpoch !== lastTelemetry.contextEpoch || telemetry.sampleRate !== lastTelemetry.sampleRate ||
      telemetry.audioFrame < lastTelemetry.audioFrame || telemetry.underrunEvents < lastTelemetry.underrunEvents;
    if (changedEpoch) { lastTelemetry = { ...telemetry }; pressure = recovery = 0; lastChangeFrame = telemetry.audioFrame; return Object.freeze({ status: 'observing', reason: 'fresh-context-cooldown' }); }
    if (telemetry.audioFrame === lastTelemetry.audioFrame) return Object.freeze({ status: 'unchanged' });
    const underrun = telemetry.underrunEvents > lastTelemetry.underrunEvents, hot = underrun || telemetry.deadlineUtilization01 !== null && telemetry.deadlineUtilization01 >= 0.85;
    const cool = !underrun && telemetry.deadlineUtilization01 !== null && telemetry.deadlineUtilization01 <= 0.5;
    pressure = hot ? Math.min(pressureSamples, pressure + 1) : 0; recovery = cool ? Math.min(recoverySamples, recovery + 1) : 0; lastTelemetry = { ...telemetry };
    if (telemetry.audioFrame - lastChangeFrame < cooldownSeconds * telemetry.sampleRate) return Object.freeze({ status: 'observing', reason: 'deterministic-cooldown' });
    const candidates = [...lanes.values()].filter(value => value.automatic && !value.pending && value.effective &&
      (pressure >= pressureSamples ? profileFor(value, value.effective)?.fallbackProfileId : recovery >= recoverySamples && value.effective !== value.requested))
      .sort((a, b) => a.laneId < b.laneId ? -1 : a.laneId > b.laneId ? 1 : 0);
    const row = candidates.find(value => value.laneId > lastAdaptedLane) || candidates[0];
    if (!row) return Object.freeze({ status: 'observing', reason: 'no-admissible-profile-transition' });
    const selectedId = pressure >= pressureSamples ? profileFor(row, row.effective).fallbackProfileId : row.requested;
    pressure = recovery = 0; lastChangeFrame = telemetry.audioFrame; lastAdaptedLane = row.laneId;
    const completion = choose(row, selectedId, selectedId === row.requested ? 'measured-headroom-recovery' : 'measured-pressure-downgrade', true, telemetry);
    completion.catch(error => emit({ status: 'rejected', stage: 'automatic-profile-request-refused', laneId: row.laneId, groupId: row.group.id,
      requestedProfileId: row.requested, effectiveProfileId: row.effective, proposedEffectiveProfileId: selectedId, automatic: true, reason: error.code || 'realization-preparation-failed' }));
    return Object.freeze({ status: 'preparing', laneId: row.laneId, requestedProfileId: row.requested, proposedEffectiveProfileId: selectedId, completion });
  };
  return Object.freeze({ request, observe, needsObservation: () => automaticLanes > 0,
    state: laneId => { const row = lanes.get(laneId); return row ? Object.freeze({ groupId: row.group.id, requestedProfileId: row.requested, preparedProfileId: row.prepared,
      effectiveProfileId: row.effective, automatic: row.automatic, state: row.pending ? 'preparing' : 'active', effectiveDefinitionHash: row.effectiveDefinitionHash }) : null; },
    diagnostics: () => Object.freeze({ lanes: lanes.size, pending: [...lanes.values()].filter(row => row.pending).length, pressureSamples: pressure, recoverySamples: recovery,
      cooldownSeconds, disposed, unknownRetirement: unknown, receipts: Object.freeze([...receipts]), metadata: metadata.receipt() }),
    remove: async laneId => { const row = lanes.get(laneId); if (!row) return; await cancel(row); if (lanes.get(laneId) === row) { lanes.delete(laneId); if (row.automatic) automaticLanes--; } },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true;
      let pending;
      return scope.retire([{ name: 'realization-preparations', run: () => pending = createProcgenRetirementScope().retire([...lanes.values()].map(row => ({ name: row.laneId, run: () => cancel(row) }))) },
        { name: 'realization-metadata', run: async () => { await pending.completion; if (pending.outcome !== 'complete' || unknown) throw failure('retirement-unknown', 'Realization metadata retains unknown preparations.'); lanes.clear(); automaticLanes = 0; receipts.length = 0; metadata.release(); } }]); }
  });
}
