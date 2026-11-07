import { travelColorationValue } from '../../../midi/content/TravelColorationRecipes.js';
import { cloneData, freezeData } from '../../../core/CanonicalData.js';
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
    snapshot({ audioFrame, sampleRate, graphDefinitionHash = null, ownerRouteRevision = null }) {
      if (disposed || blocked || !Number.isSafeInteger(audioFrame) || audioFrame < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Capture travel controls only at a settled common audio frontier.');
      if (!current || current.expected.graphDefinitionHash !== graphDefinitionHash || current.expected.ownerRouteRevision !== ownerRouteRevision) return null;
      if (current.lastFrame > audioFrame) throw new Error('The common audio frontier precedes its last travel control.');
      return freezeData(cloneData({ schema: 'lemmings-travel-effect-binding/v1', audioFrame, sampleRate, binding: current }, { maxBytes: 8192, maxNodes: 256 }));
    },
    restore(raw, { audioFrame, sourceAudioFrame, sampleRate, graphDefinitionHash, ownerRouteRevision, sourceOwnerRouteRevision, voices }) {
      if (raw === null) return null;
      const value = cloneData(raw, { maxBytes: 8192, maxNodes: 256 }), binding = value?.binding;
      if (disposed || blocked || current || value?.schema !== 'lemmings-travel-effect-binding/v1' || value.audioFrame !== sourceAudioFrame || value.sampleRate !== sampleRate || !Number.isSafeInteger(audioFrame) || audioFrame < 0 ||
          binding?.expected?.graphDefinitionHash !== graphDefinitionHash || binding.expected.ownerRouteRevision !== sourceOwnerRouteRevision || !Number.isSafeInteger(ownerRouteRevision) ||
          !Number.isSafeInteger(binding.lastFrame) || binding.lastFrame < -1 || binding.lastFrame > sourceAudioFrame || binding.lastValue !== null && (!Number.isFinite(binding.lastValue) || binding.lastValue < binding.control?.minimum || binding.lastValue > binding.control?.maximum) ||
          !voices?.some(voice => voice.voiceId === binding.voiceId && voice.generation === binding.generation && voice.instrumentId === binding.instrumentId)) throw new Error('The travel binding requires its exact restored graph, clock and active semantic voice.');
      travelColorationValue(binding.control, 0);
      if (typeof binding.control.nodeId !== 'string' || !binding.control.nodeId || typeof binding.control.parameter !== 'string' || !binding.control.parameter) throw new Error('The travel control destination is missing.');
      reservation = createOwnedResourceReservation({ budget: resourceBudget, owner, kind: 'travel-effect-control', category: 'audio', bytes: 8192 });
      current = { ...binding, control: freezeData(binding.control), expected: Object.freeze({ graphDefinitionHash, ownerRouteRevision }),
        lastFrame: binding.lastFrame === -1 ? -1 : Math.max(0, audioFrame - (sourceAudioFrame - binding.lastFrame)) };
      return Object.freeze({ restored: true, voiceId: current.voiceId, controlsRetransmitted: false });
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
