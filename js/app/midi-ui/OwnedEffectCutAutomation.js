import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { MEMBRANE_LIVE_CONTROLS } from '../../midi/content/RectangularMembraneProfile.js';
import { NETWORK_LOSS_CONTROLS, NETWORK_PICKUP_CONTROLS } from '../../midi/content/SympatheticNetworkProfile.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'effect-cut-automation' }); };
const nativeParameterNames = entry => entry.kind === 'feedback-delay' ? ['delayFrames', 'feedback', 'wet', 'feedbackLowpassHz'] : entry.kind === 'nonlinear-chain' ? ['driveDb', 'outputTrim01'] : entry.kind === 'rectangular-membrane' ? MEMBRANE_LIVE_CONTROLS : ['paired-modal-body', 'resonator-blend-body'].includes(entry.kind) ? ['morph'] : entry.kind === 'sympathetic-network' ? ['couple', 'damp', ...NETWORK_LOSS_CONTROLS, ...NETWORK_PICKUP_CONTROLS] : entry.kind === 'spectral-freeze' ? ['hold'] : entry.kind === 'allpass-notch' ? ['frequencyHz', 'feedback', 'wet'] : [];
const domain = (entry, name, rate) => {
  const p = entry.parameters;
  return { valueMinimum: name === 'feedback' ? -p.feedbackMaximum : name === 'delayFrames' ? p.interpolation === 'lagrange3' ? 2 : 1 : name === 'frequencyHz' ? 160 : name === 'feedbackLowpassHz' ? 200 : name.endsWith('Radius01') ? 0.08 : 0,
    valueMaximum: name === 'feedback' ? p.feedbackMaximum : name === 'delayFrames' ? p.maxDelaySeconds * rate : name === 'frequencyHz' ? 1600 : name === 'feedbackLowpassHz' ? rate * 0.4 : name === 'driveDb' ? 24 : name.endsWith('Radius01') ? 0.18 : 1,
    ...(name === 'hold' ? { allowedValues: [0, 1] } : {}) };
};
export function createOwnedEffectCutAutomation(plan, state, sampleRate, audioFrame) {
  if (state?.schema !== 'lemmings-native-effect-control-cut/v1' || state.sampleRate !== sampleRate || state.frame !== audioFrame || !Number.isSafeInteger(state.controlSequence) || state.controlSequence < 0 || !Array.isArray(state.curves) || !state.controls || Object.getPrototypeOf(state.controls) !== Object.prototype) fail('The complete control cut must share its graph output frame.');
  const expected = [];
  for (const entry of plan.nodes) {
    if (entry.kind === 'gain') expected.push({ key: 'gain:' + entry.id, entry, name: 'gain01', smoothingSeconds: 0.008, maxEvents: 128, valueMinimum: 0, valueMaximum: entry.parameters.gainMaximum01 });
    if (entry.kind === 'sidechain-in') expected.push({ key: 'sidechain:' + entry.id, entry, name: 'gate', smoothingSeconds: 0.02, maxEvents: 32, valueMinimum: 0, valueMaximum: 1 });
    for (const name of nativeParameterNames(entry)) expected.push({ key: 'parameter:' + JSON.stringify([entry.id, name]), entry, name, smoothingSeconds: 0, maxEvents: 128, ...domain(entry, name, sampleRate) });
  }
  expected.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  if (expected.length !== state.curves.length || Object.keys(state.controls).length !== plan.nodes.length || plan.nodes.some(entry => !Object.hasOwn(state.controls, entry.id))) fail('The control cut omitted a graph node or automation adapter.');
  const byNode = new Map(plan.nodes.map(entry => [entry.id, { names: nativeParameterNames(entry), values: new Float64Array(Math.max(1, nativeParameterNames(entry).length)), curves: [] }]));
  const curves = expected.map((spec, index) => {
    const row = state.curves[index], curve = row?.state;
    if (row?.key !== spec.key || curve?.sourceTimeSeconds !== audioFrame / sampleRate) fail('Control curves must be unique, sorted and bound to one frame.');
    const param = { setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} };
    const validator = createSmoothedAudioParameter({ ...spec, param, initialValue: spec.valueMinimum, startTime: 0 }); validator.validateSnapshot(curve);
    const node = byNode.get(spec.entry.id), offset = spec.name === 'gain01' || spec.name === 'gate' ? 0 : node.names.indexOf(spec.name);
    const events = curve.future.map(event => ({ frame: event.afterSeconds * sampleRate, value: event.value, duration: event.durationSeconds * sampleRate, sequence: event.sequence }));
    const record = { spec, node, offset, events, cursor: 0, at: 0, value: curve.value, target: curve.target, end: curve.remainingSeconds * sampleRate, sequence: curve.sequence, initial: curve };
    node.curves.push(record); return record;
  });
  let lastFrame = -1, additional = 0;
  const valueAt = (curve, frame) => curve.end <= curve.at || frame >= curve.end ? curve.target : curve.value + (curve.target - curve.value) * Math.max(0, frame - curve.at) / (curve.end - curve.at);
  const schedule = (nodeId, name, value, frame) => {
    const curve = byNode.get(nodeId)?.curves.find(curve => curve.spec.name === name);
    if (lastFrame >= 0 || !curve || !Number.isSafeInteger(frame) || frame < 0 || !Number.isFinite(value) || value < curve.spec.valueMinimum || value > curve.spec.valueMaximum || curve.spec.allowedValues && !curve.spec.allowedValues.includes(value) || additional >= 32768) fail('An original control exceeds the staged automation inventory or frame domain.');
    curve.events.push({ frame, value, duration: curve.spec.smoothingSeconds * sampleRate, sequence: ++curve.sequence }); additional++;
  };
  let sorted = false;
  const step = frame => {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame !== lastFrame + 1) fail('Owned control continuation requires contiguous output frames.');
    if (!sorted) { for (const curve of curves) curve.events.sort((a, b) => a.frame - b.frame || a.sequence - b.sequence); sorted = true; }
    for (const curve of curves) {
      while (curve.cursor < curve.events.length && curve.events[curve.cursor].frame <= frame) {
        const event = curve.events[curve.cursor++]; curve.value = valueAt(curve, event.frame); curve.at = event.frame; curve.target = event.value; curve.end = event.frame + event.duration;
      }
      curve.node.values[curve.offset] = Math.fround(valueAt(curve, frame));
    }
    lastFrame = frame;
  };
  const mapControl = (entry, name) => name === 'gain01' ? ['gain01', 1] : name === 'delaySeconds' ? ['delayFrames', sampleRate] : name === 'wet01' ? ['wet', 1] : name === 'baseFrequencyHz' ? ['frequencyHz', 1] : name === 'morph01' ? ['morph', 1] : name === 'hold01' ? ['hold', 1] : name === 'couple01' ? ['couple', 1] : name === 'damp01' && entry.kind === 'sympathetic-network' ? ['damp', 1] : [name, 1];
  return Object.freeze({ byNode, step, schedule,
    scheduleUpdate(nodeId, values, frame) { const entry = plan.nodes.find(entry => entry.id === nodeId); if (!entry || !values || Object.getPrototypeOf(values) !== Object.prototype || !Object.keys(values).length || Object.keys(values).length > 4) fail('An original control has no exact graph node.'); for (const [name, value] of Object.entries(values)) { const [parameter, scale] = mapControl(entry, name); schedule(nodeId, parameter, value * scale, frame); } },
    receipt: () => Object.freeze({ schema: 'lemmings-owned-effect-cut-automation/v1', sourceAudioFrame: audioFrame, sampleRate, adapters: curves.length, retainedFutureControls: curves.reduce((sum, curve) => sum + curve.initial.future.length, 0), additionalControls: additional, renderedFrames: lastFrame + 1, evidence: 'captured-owned-API-curves;not-native-rendered-readback' }) });
}
