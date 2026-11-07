import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = code => Object.assign(new Error('Renderer publication: ' + code), { code });
export function createRendererPublicationOwner({ context, resources, owner, generation = 0, initiallyMuted = false, maxGates = 64 } = {}) {
  if (!context?.createGain || !resources?.reserve || typeof initiallyMuted !== 'boolean' || !Number.isSafeInteger(maxGates) || maxGates < 1 || maxGates > 128) throw new TypeError('Renderer publication needs its current native context and bounded resource owner.');
  const lease = resources.reserve({ kind: 'renderer-publication-gates', owner, generation, estimateBytes: 262144, consumerOwned: true }), gates = new Set(), scope = createProcgenRetirementScope();
  let retired = false, fault = null, floorTime = context.currentTime;
  const fanout = {};
  for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'cancelScheduledValues']) fanout[method] = (...args) => { for (const gate of gates) gate.gain[method](...args); };
  if (typeof context.createGain !== 'function') throw new TypeError('Native gain routing is required.');
  const options = param => ({ param, initialValue: initiallyMuted ? 0 : 1, startTime: context.currentTime, smoothingSeconds: 0, maxEvents: 64, valueMinimum: 0, valueMaximum: 1 });
  const curve = createSmoothedAudioParameter(options(fanout));
  const guard = () => { if (retired || fault || context.state === 'closed') throw fault || failure('owner-retired'); };
  const silence = error => {
    fault ||= error || failure('publication-interrupted');
    for (const gate of gates) { try { gate.gain.cancelScheduledValues(context.currentTime); gate.gain.setValueAtTime(0, context.currentTime); } catch {} }
  };
  const addGate = () => {
    guard(); if (gates.size >= maxGates) throw failure('gate-capacity');
    const gate = context.createGain();
    try {
      gate.gain.setValueAtTime(0, context.currentTime);
      const adapter = createSmoothedAudioParameter({ ...options(gate.gain), initialValue: 0 }), time = Math.max(context.currentTime, floorTime);
      adapter.restore(curve.snapshot(time), time); gates.add(gate); return gate;
    } catch (error) { gate.disconnect(); throw error; }
  };
  const removeGate = gate => { if (!gates.has(gate)) return false; gate.disconnect(); gates.delete(gate); return true; };
  const schedule = (gain01, frame, seconds = 0) => {
    guard();
    if (![0, 1].includes(gain01) || !Number.isSafeInteger(frame) || frame < Math.ceil(context.currentTime * context.sampleRate) || frame > Math.ceil((context.currentTime + 5) * context.sampleRate) || !Number.isFinite(seconds) || seconds < 0 || seconds > 0.2) throw failure('invalid-publication-frontier');
    try { if (!curve.insert(gain01, frame / context.sampleRate, context.currentTime, seconds)) throw failure('publication-queue-capacity'); }
    catch (error) { silence(error); throw error; }
    return Object.freeze({ status: 'accepted', stage: 'renderer-publication-submitted', targetFrame: frame, gain01, evidence: 'owned-API-automation;not-rendered-or-acoustic-proof' });
  };
  const snapshot = frame => {
    guard(); if (!Number.isSafeInteger(frame) || frame < 0) throw failure('invalid-cut-frame');
    return Object.freeze({ schema: 'lemmings-renderer-publication-cut/v1', sampleRate: context.sampleRate, audioFrame: frame, curve: curve.snapshot(frame / context.sampleRate) });
  };
  const restore = (state, frame) => {
    guard();
    if (state?.schema !== 'lemmings-renderer-publication-cut/v1' || state.sampleRate !== context.sampleRate || !Number.isSafeInteger(state.audioFrame) || state.audioFrame < 0 ||
        state.curve?.sourceTimeSeconds !== state.audioFrame / context.sampleRate || !Number.isSafeInteger(frame) || frame < Math.ceil(context.currentTime * context.sampleRate)) throw failure('publication-cut-identity');
    try {
      curve.validateSnapshot(state.curve);
      for (const gate of gates) { gate.gain.cancelScheduledValues(context.currentTime); gate.gain.setValueAtTime(0, context.currentTime); }
      curve.restore(state.curve, frame / context.sampleRate); floorTime = frame / context.sampleRate;
    } catch (error) { silence(error); throw error; }
  };
  return Object.freeze({ context, addGate, removeGate, schedule, snapshot, restore, silence,
    router(source, outputCount) {
      guard(); if (!source?.connect || !Number.isInteger(outputCount) || outputCount < 1 || outputCount > maxGates) throw failure('invalid-renderer-output-inventory');
      const outputs = Array.from({ length: outputCount }, () => addGate());
      try { for (let index = 0; index < outputs.length; index++) source.connect(outputs[index], index, 0); }
      catch (error) { silence(error); throw error; }
      return Object.freeze({ context, connect(destination, output = 0, input = 0) { if (!Number.isInteger(output) || !outputs[output]) throw failure('invalid-renderer-output'); return outputs[output].connect(destination, 0, input); },
        disconnect(destination, output = null, input = 0) { if (output !== null) { if (!Number.isInteger(output) || !outputs[output]) throw failure('invalid-renderer-output'); outputs[output].disconnect(destination, 0, input); } else for (const node of outputs) if (destination === undefined) node.disconnect(); else node.disconnect(destination); } });
    },
    diagnostics: () => Object.freeze({ gates: gates.size, retired, fault: fault?.code || null, gain01: fault ? 0 : curve.valueAt(context.currentTime), scope: 'all-owned-source-outputs-before-owner-effects' }),
    dispose({ producerRetired } = {}) {
      return scope.retire([{ name: 'publication-node-retirement', run: () => {
        retired = true; silence(failure('owner-retired'));
        if (producerRetired !== true) { const error = failure('producer-retirement-unconfirmed'); lease.retainUnknown(error); throw error; }
        for (const gate of [...gates]) removeGate(gate); lease.release();
      } }]);
    } });
}
