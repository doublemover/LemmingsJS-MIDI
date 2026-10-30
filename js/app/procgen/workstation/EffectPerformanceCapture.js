import { validateEffectPerformance } from '../../../midi/content/EffectPerformance.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

export function createEffectPerformanceCapture({ owner, streamId, getContext, getExecutionEpoch, getAnchor, isEnabled, onReceipt, resourceBudget = null }) {
  const pending = []; let sequence = 0, storage = null, disposed = false;
  const gap = reason => { try { onReceipt({ status: 'rejected', stage: 'effect-performance-capture', reason, acousticReceipt: false }); } catch {} };
  const release = () => { if (storage) { storage.release(); storage = null; } };
  const emit = packet => { onReceipt(validateEffectPerformance(packet)); };
  const flush = () => {
    if (disposed || !pending.length) return;
    const anchor = getAnchor(), context = getContext(), epoch = getExecutionEpoch();
    if (!anchor || anchor.executionEpoch !== epoch) return;
    while (pending.length) {
      const entry = pending.shift();
      if (entry.context !== context || entry.packet.executionEpoch !== null && entry.packet.executionEpoch !== epoch) { gap('effect-capture-clock-owner-changed'); continue; }
      try { emit({ ...entry.packet, executionEpoch: epoch, clockAnchor: anchor }); } catch (error) { gap(error.message); }
    }
    release();
  };
  const capture = (operation, state, details = {}) => {
    if (disposed || !state) return;
    try {
      if (!isEnabled()) return; flush();
      if (sequence === Number.MAX_SAFE_INTEGER) throw new Error('Effect capture sequence exhausted.');
      const epoch = getExecutionEpoch(), anchor = getAnchor(), packet = validateEffectPerformance({ schema: 'lemmings-effect-performance/v1', status: 'accepted', stage: 'effect-performance-captured', operation,
        sequence: ++sequence, streamId, ownerRouteRevision: state.ownerRouteRevision, graphDefinitionHash: state.graphDefinitionHash, sampleRate: state.sampleRate, targetFrame: state.targetFrame, executionEpoch: epoch,
        clockAnchor: anchor?.executionEpoch === epoch ? anchor : null, sourceEventIds: [], acousticReceipt: false, ...details });
      if (packet.clockAnchor) { emit(packet); return; }
      if (pending.length >= 16 || !getContext()) throw new Error('Effect capture has no bounded source-intent clock anchor.');
      storage ||= createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'effect-capture-unanchored-metadata-estimate', category: 'audio', bytes: 4 * 1048576 });
      pending.push({ packet, context: getContext() });
    } catch (error) { gap(error.message); }
  };
  return Object.freeze({ capture, flush,
    invalidate(reason = 'effect-capture-clock-ended') { if (pending.length) gap(reason); pending.length = 0; release(); },
    state: () => ({ pendingUnanchored: pending.length, sequence, source: 'actual-first-intent-audio-frame-anchor;no-timing-invention' }),
    dispose() { if (disposed) return; this.invalidate('effect-capture-owner-retired-before-anchor'); disposed = true; } });
}
