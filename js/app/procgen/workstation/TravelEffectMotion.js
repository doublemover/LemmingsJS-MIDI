import { travelColorationValue } from '../../../midi/content/TravelColorationRecipes.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

let nextOwner = 0;
export function createTravelEffectMotion({ update, bypass, toFrame, onReceipt = () => {}, resourceBudget = null }) {
  const owner = 'travel-effect-' + (++nextOwner); let current = null, reservation = null, disposed = false, blocked = false, updates = 0, failures = 0;
  const report = receipt => { try { onReceipt(Object.freeze({ ...receipt, acousticReceipt: false })); } catch {} };
  const clear = (reason = 'source-ended', tail = false) => {
    const previous = current; current = null; if (!previous) return;
    if (tail) { try { bypass('tail', previous.expected); } catch (error) { report({ status: 'rejected', stage: 'effect-source-retirement', reason: error.code || error.message }); } }
    try { reservation?.release(); reservation = null; } catch (error) { blocked = true; throw error; }
    report({ status: 'accepted', stage: 'effect-source-retired', reason, voiceId: previous.voiceId, generation: previous.generation });
  };
  const stopSafely = reason => { try { clear(reason); } catch (error) { failures++; blocked = true; report({ status: 'rejected', stage: 'effect-motion-retirement', reason: error.message }); } };
  return Object.freeze({
    bind({ voiceId, generation, instrumentId, control, expected }) {
      if (disposed || blocked || typeof voiceId !== 'string' || !voiceId || voiceId.length > 512 || !Number.isSafeInteger(generation) || generation < 0 ||
          typeof instrumentId !== 'string' || !instrumentId || !expected?.graphDefinitionHash || !Number.isSafeInteger(expected.ownerRouteRevision)) throw new Error('A travel effect requires one current voice and an exact prepared effect route.');
      travelColorationValue(control, 0); clear('explicit-rebind', false);
      reservation = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'travel-effect-control', category: 'audio', bytes: 8192 });
      current = { voiceId, generation, instrumentId, control: Object.freeze({ ...control }), expected: Object.freeze({ ...expected }), lastValue: null, lastFrame: -1 };
    },
    consume(intents, executionEpoch) {
      if (!current || disposed) return;
      for (const intent of intents) {
        const binding = current; if (!binding) break;
        if (intent.voiceId !== binding.voiceId || intent.generation !== binding.generation || intent.mappingId !== binding.instrumentId) continue;
        if (intent.kind === 'end') { stopSafely(intent.terminationReason || 'source-ended'); continue; }
        const distance = intent.articulationState?.signedDistancePixels; if (!Number.isFinite(distance)) continue;
        const value = travelColorationValue(binding.control, distance); if (value === binding.lastValue) continue;
        try {
          const frame = toFrame(intent.scoreTime, executionEpoch);
          if (!Number.isSafeInteger(frame) || frame < 0 || frame < binding.lastFrame) throw new Error('Travel effect audio clock is unavailable or out of order.');
          const receipt = update(binding.control.nodeId, { [binding.control.parameter]: value }, frame, binding.expected, { sourceEventIds: intent.sourceEventIds });
          binding.lastValue = value; binding.lastFrame = frame; updates++;
          report({ status: 'accepted', stage: 'effect-control-native-api-scheduled', executionEpoch, generation: intent.generation, voiceId: intent.voiceId,
            intentId: intent.intentId, sourceEventIds: intent.sourceEventIds, signedDistancePixels: distance, targetFrame: frame,
            graphDefinitionHash: receipt.graphDefinitionHash, nodeId: binding.control.nodeId, parameter: binding.control.parameter, value });
        } catch (error) { failures++; report({ status: 'rejected', stage: 'effect-control', voiceId: intent.voiceId, intentId: intent.intentId, reason: error.code || error.message }); stopSafely('control-unavailable'); }
      }
    }, clear,
    state: () => Object.freeze({ active: current ? { voiceId: current.voiceId, generation: current.generation, instrumentId: current.instrumentId,
      control: current.control, lastValue: current.lastValue, lastFrame: current.lastFrame } : null, updates, failures, blocked, disposed }),
    dispose() { if (disposed) { if (blocked) reservation?.release(); return; } disposed = true; clear('owner-retired', true); if (blocked) reservation?.release(); }
  });
}
