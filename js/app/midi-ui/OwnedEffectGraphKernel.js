import { OWNED_STATE_BUNDLE_HEADER, writeOwnedStateBundle, readOwnedStateBundle, ownedStateTransferBytes } from './worklet/OwnedStateBundle.js';
import { verifyResonatorBlendKernelProfile } from '../../midi/content/ResonatorBlendProfile.js';
import { PairedModalBodyKernel } from './worklet/PairedModalBodyKernel.js';
import { verifyPairedModalBodyProfile } from '../../midi/content/PairedModalBodyProfile.js';
import { validateSpectralCaptureReceipt } from '../../midi/content/SpectralCaptureReceipt.js';
import { RectangularMembraneKernel } from './worklet/RectangularMembraneKernel.js';
import { SympatheticNetworkKernel } from './worklet/SympatheticNetworkKernel.js';
import { NETWORK_LOSS_CONTROLS, NETWORK_PICKUP_CONTROLS } from '../../midi/content/SympatheticNetworkProfile.js';
import { SpectralFreezeKernel } from './worklet/SpectralFreezeKernel.js';
import { AllpassNotchKernel } from './worklet/AllpassNotchProcessor.js';
import { RingModulatorKernel } from './worklet/RingModulatorKernel.js';
import { VocoderBankKernel } from './worklet/VocoderBankKernel.js';
import { EnvelopeFollowerKernel } from './worklet/EnvelopeFollowerKernel.js';
import { EnvelopeMappingKernel } from './worklet/EnvelopeMappingKernel.js';
import { isAudioEffectPort } from '../../midi/content/EffectPorts.js';
import { prepareEffectRenderPlan } from './EffectRenderPlan.js';
import { effectGraphHash } from '../../midi/content/EffectGraphRevision.js';
import { BoundedDelayKernel } from './worklet/BoundedDelayProcessor.js';
import { NonlinearChainKernel } from './worklet/NonlinearChainKernel.js';
import { FixedFractionalDelayKernel } from './worklet/FixedFractionalDelayProcessor.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code }); };
export function prepareOwnedEffectGraphPlan(definition, sampleRate = 48000, returnNodeIds = []) {
  return prepareEffectRenderPlan(definition, sampleRate, returnNodeIds);
}
export async function createOwnedEffectGraphKernel({ definition, sampleRate = 48000, returnNodeIds = [], frameOrigin = 0 } = {}) {
  if (!Number.isSafeInteger(frameOrigin) || frameOrigin < 0) throw new TypeError('Effect rendering requires a nonnegative analysis frame origin.');
  const plan = prepareOwnedEffectGraphPlan(definition, sampleRate, returnNodeIds), hash = await effectGraphHash(plan);
  for (const node of plan.nodes) { if (node.pairedBody) await verifyPairedModalBodyProfile(node.pairedBody); if (node.blendBody) await verifyResonatorBlendKernelProfile(node.blendBody.body); }
  const indices = new Map(plan.order.map((id, i) => [id, i])), values = new Float32Array(plan.nodes.length * 2), presence = new Uint8Array(plan.nodes.length), controls = new Float64Array(plan.nodes.length * 4), gain = new Float64Array(plan.nodes.length * 3);
  const sidechainIndices = new Map(plan.sidechainInputs.map((id, index) => [id, index]));
  const records = plan.nodes.map((entry, index) => {
    const p = entry.parameters, at = index * 4; let kernel = null;
    if (entry.kind === 'feedback-delay') {
      controls.set([p.delaySeconds * sampleRate, p.feedback, p.wet01, p.feedbackLowpassHz], at);
      kernel = new BoundedDelayKernel({ sampleRate, maxDelayFrames: Math.ceil(p.maxDelaySeconds * sampleRate), delayFrames: p.delaySeconds * sampleRate, mode: p.mode, interpolation: p.interpolation, jumpPolicy: p.jumpPolicy,
        transitionFrames: Math.max(2, Math.round(p.transitionSeconds * sampleRate)), maximumSlew: p.maximumSlew, feedback: p.feedback, feedbackMaximum: p.feedbackMaximum,
        feedbackLowpassHz: p.feedbackLowpassHz, feedbackHighpassHz: p.feedbackHighpassHz, wet: p.wet01 });
    } else if (entry.kind === 'nonlinear-chain') { controls.set([p.driveDb, p.outputTrim01, 0, 0], at); kernel = new NonlinearChainKernel({ sampleRate, parameters: p }); }
    else if (entry.kind === 'rectangular-membrane') kernel = new RectangularMembraneKernel({ sampleRate, parameters: p });
    else if (['paired-modal-body', 'resonator-blend-body'].includes(entry.kind)) { controls[at] = p.morph01; kernel = new PairedModalBodyKernel({ sampleRate, parameters: p, strategy: entry.blendBody ? 'blend' : 'paired' }); }
    else if (entry.kind === 'sympathetic-network') { controls.set([p.couple01, p.damp01, 0, 0], at); kernel = new SympatheticNetworkKernel({ sampleRate, parameters: p }); }
    else if (entry.kind === 'spectral-freeze') { controls[at] = 0; kernel = new SpectralFreezeKernel({ sampleRate, parameters: p, startFrame: frameOrigin }); }
    else if (entry.kind === 'allpass-notch') { controls.set([p.baseFrequencyHz, p.feedback, p.wet01, 0], at); kernel = new AllpassNotchKernel({ sampleRate, parameters: p }); }
    else if (entry.kind === 'ring-modulator') kernel = new RingModulatorKernel({ sampleRate, parameters: p });
    else if (entry.kind === 'multiband-vocoder') kernel = new VocoderBankKernel({ sampleRate, parameters: p });
    else if (entry.kind === 'envelope-detector') kernel = new EnvelopeFollowerKernel({ sampleRate, parameters: p });
    else if (entry.kind === 'envelope-mapping') kernel = new EnvelopeMappingKernel({ sampleRate, parameters: p });
    else if (entry.kind === 'gain') { gain[index * 3] = gain[index * 3 + 1] = p.gain01; controls[at] = p.gain01; }
    const incoming = plan.edges.filter(edge => edge.to.nodeId === entry.id).map(edge => ({ source: indices.get(edge.from.nodeId) * 2, edgeIndex: plan.edges.indexOf(edge), gain01: edge.gain01, port: edge.to.port, audio: isAudioEffectPort(entry.ports.inputs[edge.to.port]), donor: edge.to.port === 'donorAudio',
      align: edge.alignmentFrames ? new FixedFractionalDelayKernel({ sampleRate, delayFrames: edge.alignmentFrames }) : null }));
    return { entry, index, kernel, incoming, at, sidechainOffset: (sidechainIndices.get(entry.id) ?? -1) * 2 };
  });
  const inputIndex = indices.get(plan.inputs[0]), outputIndex = indices.get(plan.outputs[0]) * 2, taps = returnNodeIds.map(id => indices.get(id) * 2), tapSamples = new Float32Array(taps.length * 2);
  let validationOnly = false;
  let frame = 0, leftSample = 0, rightSample = 0, muted = false;
  const panic = () => { muted = true; for (const record of records) { record.kernel?.panic(); for (const edge of record.incoming) edge.align?.panic(); } values.fill(0); tapSamples.fill(0); leftSample = rightSample = 0; };
  const quarantine = (code, message) => { panic(); fail(code, message); };
  const update = (nodeId, next, apply = true) => {
    if (validationOnly) fail('effect-validation-owner-only', 'Detached validation graphs cannot publish live controls.');
    if (muted) fail('effect-graph-retired', 'This graph was cleared; prepare a new graph for further controls.');
    const index = indices.get(nodeId), record = records[index];
    if (!record || !next || Object.getPrototypeOf(next) !== Object.prototype || !Object.keys(next).length || Object.keys(next).length > 4 || Object.values(next).some(value => !Number.isFinite(value))) fail('invalid-effect-control', 'Invalid owned effect control.');
    const { entry, at, kernel } = record, p = entry.parameters, keys = Object.keys(next), finite = (value, a, b) => Number.isFinite(value) && value >= a && value <= b;
    if (entry.kind === 'gain') {
      if (keys.some(key => key !== 'gain01') || !finite(next.gain01, 0, p.gainMaximum01)) fail('invalid-effect-control', 'Effect gain exceeds its declared bound.');
      if (apply) { controls[at] = next.gain01; gain[index * 3 + 1] = next.gain01; gain[index * 3 + 2] = Math.max(1, Math.round(sampleRate * 0.008)); }
    } else if (entry.kind === 'rectangular-membrane') {
      kernel.setControls(next, apply);
    } else if (['paired-modal-body', 'resonator-blend-body'].includes(entry.kind)) {
      if (keys.some(key => key !== 'morph01') || !finite(next.morph01, 0, 1) || kernel.muted) fail('invalid-effect-control', 'MORPH requires its active reviewed held body and normalized position.');
      if (apply) controls[at] = next.morph01;
    } else if (entry.kind === 'sympathetic-network') {
      if (kernel.muted) fail('effect-body-quarantined', 'Prepare a new shared body after its state was quarantined.');
      if (keys.some(key => !['couple01', 'damp01'].includes(key) && (!NETWORK_LOSS_CONTROLS.slice(0, entry.network.lossMasks.length).includes(key) && !(entry.network.pickupGrid && NETWORK_PICKUP_CONTROLS.includes(key)) || !finite(next[key], 0, 1))) || next.couple01 != null && !finite(next.couple01, 0, 1) || next.damp01 != null && !finite(next.damp01, 0, 1)) fail('invalid-effect-control', 'Shared-body control exceeds its prepared loss or observation domain.');
      if (apply) { if (next.couple01 != null) controls[at] = next.couple01; if (next.damp01 != null) controls[at + 1] = next.damp01; for (let index = 0; index < entry.network.lossMasks.length; index++) if (next[NETWORK_LOSS_CONTROLS[index]] != null) record.kernel.setLossMask(index, next[NETWORK_LOSS_CONTROLS[index]]); for (const name of NETWORK_PICKUP_CONTROLS) if (next[name] != null) kernel.setPickupPosition(name, next[name]); }
    } else if (entry.kind === 'spectral-freeze') {
      if (keys.length !== 1 || keys[0] !== 'hold01' || (next.hold01 !== 0 && next.hold01 !== 1)) fail('invalid-effect-control', 'Spectral capture requires a discrete hold or thaw command.'); if (apply) controls[at] = next.hold01;
    } else if (entry.kind === 'allpass-notch') {
      if (keys.some(key => !['baseFrequencyHz', 'feedback', 'wet01'].includes(key)) || next.baseFrequencyHz != null && !finite(next.baseFrequencyHz, 160, 1600) || next.feedback != null && !finite(next.feedback, -p.feedbackMaximum, p.feedbackMaximum) || next.wet01 != null && !finite(next.wet01, 0, 1)) fail('invalid-effect-control', 'Allpass control exceeds its frequency, feedback or mix domain.');
      if (apply && next.baseFrequencyHz != null) controls[at] = next.baseFrequencyHz; if (apply && next.feedback != null) controls[at + 1] = next.feedback; if (apply && next.wet01 != null) controls[at + 2] = next.wet01;
    } else if (entry.kind === 'feedback-delay') {
      if (keys.some(key => !['delaySeconds', 'feedback', 'wet01', 'feedbackLowpassHz'].includes(key)) ||
          next.delaySeconds != null && !finite(next.delaySeconds, (p.interpolation === 'lagrange3' ? 2 : 1) / sampleRate, p.maxDelaySeconds) || next.feedback != null && !finite(next.feedback, -p.feedbackMaximum, p.feedbackMaximum) ||
          next.wet01 != null && !finite(next.wet01, 0, 1) || next.feedbackLowpassHz != null && !finite(next.feedbackLowpassHz, 200, sampleRate * 0.4)) fail('invalid-effect-control', 'Delay control exceeds its immutable profile.');
      if (apply && next.delaySeconds != null) { const target = next.delaySeconds * sampleRate; if (!kernel.setDelay(target)) fail('effect-transition-busy', 'The two-tap delay transition is still active.'); controls[at] = target; }
      if (apply && next.feedback != null) controls[at + 1] = next.feedback;
      if (apply && next.wet01 != null) controls[at + 2] = next.wet01;
      if (apply && next.feedbackLowpassHz != null) { kernel.setFeedbackLowpassHz(next.feedbackLowpassHz); controls[at + 3] = next.feedbackLowpassHz; }
    } else if (entry.kind === 'nonlinear-chain') {
      if (keys.some(key => !['driveDb', 'outputTrim01'].includes(key)) || next.driveDb != null && !finite(next.driveDb, 0, 24) || next.outputTrim01 != null && !finite(next.outputTrim01, 0, 1)) fail('invalid-effect-control', 'Nonlinear drive/trim exceeds its declared domain.');
      if (apply && next.driveDb != null) controls[at] = next.driveDb;
      if (apply && next.outputTrim01 != null) controls[at + 1] = next.outputTrim01;
    } else fail('effect-control-unavailable', 'This routing node has no live parameter adapter.');
    return !apply || Object.freeze({ status: 'applied-to-owned-render', nodeId, frame, graphDefinitionHash: hash, acousticReceipt: false });
  };
  const sample = (left, right, sidechainSamples = null, sidechainPresence = null) => {
    if (validationOnly) fail('effect-validation-owner-only', 'Detached validation graphs cannot render audio.');
    if (sidechainPresence !== null && (!(sidechainPresence instanceof Uint8Array) || sidechainPresence.length !== plan.sidechainInputs.length)) quarantine('sidechain-input-presence', 'Source presence must match the exact prepared bus inventory.');
    if (sidechainPresence) for (let i = 0; i < sidechainPresence.length; i++) if (sidechainPresence[i] > 1) quarantine('sidechain-input-presence', 'Invalid source presence bit.');
    if (sidechainSamples !== null && (!(sidechainSamples instanceof Float32Array) || sidechainSamples.length !== plan.sidechainInputs.length * 2)) quarantine('sidechain-input-layout', 'Sidechain input must match its prepared stereo slot inventory.');
    if (muted) { leftSample = rightSample = 0; tapSamples.fill(0); frame++; return; }
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > 32 || Math.abs(right) > 32) quarantine('effect-input-headroom', 'Owned effect input is nonfinite or exceeds its declared absolute-32 bus profile.');
    for (const record of records) {
      let a = record.index === inputIndex ? Math.fround(left) : 0, b = record.index === inputIndex ? Math.fround(right) : 0, modulation = 0, donorLeft = 0, donorRight = 0, audioPresent = record.index === inputIndex, donorPresent = false;
      for (const edge of record.incoming) {
        let x = Math.fround(values[edge.source] * edge.gain01), y = Math.fround(values[edge.source + 1] * edge.gain01);
        if (edge.align) { edge.align.sample(x, y); if (edge.align.faults) quarantine('effect-state-containment', 'The alignment branch quarantined invalid state.'); x = Math.fround(edge.align.leftSample); y = Math.fround(edge.align.rightSample); }
        if (edge.donor) { donorPresent ||= Boolean(presence[edge.source / 2]); donorLeft = Math.fround(donorLeft + x); donorRight = Math.fround(donorRight + y); }
        else if (edge.audio) { audioPresent ||= Boolean(presence[edge.source / 2]); a = Math.fround(a + x); b = Math.fround(b + y); }
        else modulation = Math.fround(modulation + x);
      }
      const { entry, index, kernel, at } = record;
      if (entry.kind === 'sidechain-in') {
        const input = record.sidechainOffset; audioPresent = sidechainPresence ? Boolean(sidechainPresence[input / 2]) : sidechainSamples !== null; a = sidechainSamples?.[input] ?? 0; b = entry.parameters.inputLayout === 'audioMono' ? 0 : sidechainSamples?.[input + 1] ?? 0;
        if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 32 || Math.abs(b) > 32) quarantine('sidechain-input-headroom', 'Sidechain input is nonfinite or exceeds its admitted audio domain.');
      } else if (entry.kind === 'multiband-vocoder' || entry.kind === 'ring-modulator') { kernel.sample(donorLeft, donorRight, a, b, donorPresent, audioPresent); a = kernel.leftSample; b = kernel.rightSample; }
      else if (entry.kind === 'envelope-detector') { kernel.sample(a, b, audioPresent); a = kernel.output; b = 0; }
      else if (entry.kind === 'envelope-mapping') { kernel.sample(modulation); a = kernel.output; b = 0; }
      else if (entry.kind === 'modulated-gain') { a *= modulation; b *= modulation; }
      else if (entry.kind === 'polarity-invert') { a = -a; b = -b; }
      else if (entry.kind === 'mono-to-stereo') b = a;
      else if (entry.kind === 'stereo-to-mono') { a = (a + b) * 0.5; b = 0; }
      else if (entry.kind === 'gain') {
        const g = index * 3; a *= gain[g]; b *= gain[g];
        if (gain[g + 2] > 0) { gain[g] += (gain[g + 1] - gain[g]) / gain[g + 2]; gain[g + 2]--; }
      } else if (kernel) {
        if (entry.kind === 'paired-modal-body' || entry.kind === 'resonator-blend-body') kernel.sample(a, b, controls[at]); else if (entry.kind === 'rectangular-membrane') kernel.sample(a, b); else if (entry.kind === 'spectral-freeze') kernel.sample(a, b, controls[at], audioPresent); else if (entry.kind === 'allpass-notch') kernel.sample(a, b, controls[at], controls[at + 1], controls[at + 2]); else if (entry.kind === 'feedback-delay') kernel.sample(a, b, controls[at + 1], controls[at + 2]); else kernel.sample(a, b, controls[at], controls[at + 1]);
        if (entry.membrane) kernel.strikes.discardReceipts();
        if (kernel.faults && !entry.membrane && !entry.network && !entry.pairedBody && !entry.blendBody) quarantine('effect-state-containment', 'The ' + entry.kind + ' branch quarantined invalid state.'); a = kernel.leftSample; b = kernel.rightSample;
      }
      if (kernel?.faults && !entry.membrane && !entry.network && !entry.pairedBody && !entry.blendBody) quarantine('effect-state-containment', 'The ' + entry.kind + ' branch quarantined invalid state.');
      if (!Number.isFinite(a) || !Number.isFinite(b)) quarantine('nonfinite-effect-output', 'The full owned effect graph produced nonfinite output.');
      presence[index] = audioPresent || entry.kind === 'feedback-delay' || entry.kind === 'nonlinear-chain' || entry.kind === 'multiband-vocoder' || entry.kind === 'ring-modulator' || entry.kind === 'allpass-notch' || entry.kind === 'spectral-freeze' || entry.kind === 'sympathetic-network' || entry.kind === 'paired-modal-body' || entry.kind === 'resonator-blend-body' || entry.kind === 'rectangular-membrane' ? 1 : 0;
      values[index * 2] = Math.fround(a); values[index * 2 + 1] = Math.fround(b);
    }
    leftSample = values[outputIndex]; rightSample = values[outputIndex + 1];
    for (let i = 0; i < taps.length; i++) { tapSamples[i * 2] = values[taps[i]]; tapSamples[i * 2 + 1] = values[taps[i] + 1]; } frame++;
  };
  const stateIdentity = { abi: 'owned-effect-graph-cut-v1', hash, sampleRate, frameOrigin, returnNodeIds: [...returnNodeIds] };
  const stateEntries = [];
  for (const record of records) {
    if (record.kernel) stateEntries.push({ key: 'node:' + record.index, nodeId: record.entry.id, kind: record.entry.kind, kernel: record.kernel, bytes: ownedStateTransferBytes(record.kernel) });
    for (let index = 0; index < record.incoming.length; index++) if (record.incoming[index].align) { const kernel = record.incoming[index].align; stateEntries.push({ key: 'alignment:' + record.index + ':' + index, nodeId: '@alignment:' + record.incoming[index].edgeIndex, kind: 'fixed-fractional-delay', kernel, bytes: ownedStateTransferBytes(kernel) }); }
  }
  const stateByteLength = () => OWNED_STATE_BUNDLE_HEADER + stateEntries.reduce((sum, entry) => sum + entry.bytes, 0);
  const snapshotInto = bytes => {
    if (validationOnly) fail('effect-validation-owner-only', 'Detached components do not establish a render-graph frame.');
    const components = stateEntries.map(entry => { const bytes = new Uint8Array(entry.bytes); entry.kernel.snapshotInto(bytes); return { key: entry.key, bytes }; });
    return writeOwnedStateBundle(bytes, { identity: stateIdentity, frontier: { frame, leftSample, rightSample, muted, values: Array.from(values), presence: Array.from(presence), controls: Array.from(controls), gain: Array.from(gain), taps: Array.from(tapSamples) }, components });
  };
  const restoreFrom = bytes => {
    if (frame !== 0 || muted || validationOnly) fail('effect-restore-staged-owner-required', 'Restore into a fresh unpublished graph, then replace the prior owner.');
    const { frontier, components } = readOwnedStateBundle(bytes, stateIdentity, stateEntries.map(entry => entry.key));
    if (!Number.isSafeInteger(frontier.frame) || frontier.frame < 0 || typeof frontier.muted !== 'boolean' || !Number.isFinite(frontier.leftSample) || !Number.isFinite(frontier.rightSample)) fail('effect-restore-frontier', 'Invalid graph output frontier.');
    for (const [key, target] of [['values', values], ['presence', presence], ['controls', controls], ['gain', gain], ['taps', tapSamples]]) if (!Array.isArray(frontier[key]) || frontier[key].length !== target.length || frontier[key].some(value => !Number.isFinite(value) || key === 'presence' && value !== 0 && value !== 1)) fail('effect-restore-frontier', 'Invalid graph control, routing or interpolation state.');
    for (const record of records) {
      const at = record.at, p = record.entry.parameters, c = frontier.controls, kind = record.entry.kind;
      const next = kind === 'gain' ? { gain01: c[at] } : kind === 'feedback-delay' ? { delaySeconds: c[at] / sampleRate, feedback: c[at + 1], wet01: c[at + 2], feedbackLowpassHz: c[at + 3] } : kind === 'nonlinear-chain' ? { driveDb: c[at], outputTrim01: c[at + 1] } : ['paired-modal-body', 'resonator-blend-body'].includes(kind) ? { morph01: c[at] } : kind === 'sympathetic-network' ? { couple01: c[at], damp01: c[at + 1] } : kind === 'spectral-freeze' ? { hold01: c[at] } : kind === 'allpass-notch' ? { baseFrequencyHz: c[at], feedback: c[at + 1], wet01: c[at + 2] } : null;
      if (next) update(record.entry.id, next, false);
      const offset = record.index * 3;
      if (kind === 'gain') { if (frontier.gain[offset] < 0 || frontier.gain[offset] > p.gainMaximum01 || frontier.gain[offset + 1] !== c[at] || !Number.isSafeInteger(frontier.gain[offset + 2]) || frontier.gain[offset + 2] < 0 || frontier.gain[offset + 2] > Math.max(1, Math.round(sampleRate * 0.008))) fail('effect-restore-gain-ramp', 'Invalid in-flight gain interpolation.'); }
      else if (frontier.gain.slice(offset, offset + 3).some(value => value !== 0)) fail('effect-restore-gain-ramp', 'A routing node contains an invented gain ramp.');
    }
    try {
      for (let index = 0; index < stateEntries.length; index++) stateEntries[index].kernel.restoreFrom(components[index].bytes);
      for (const entry of stateEntries) if (!frontier.muted && Number.isSafeInteger(entry.kernel.frame)) {
        const spectral = records.some(record => record.kernel === entry.kernel && record.entry.kind === 'spectral-freeze');
        if (entry.kernel.frame !== frontier.frame + (spectral ? frameOrigin : 0)) fail('effect-restore-component-frontier', 'The graph contains states from different output frames.');
      }
      values.set(frontier.values); presence.set(frontier.presence); controls.set(frontier.controls); gain.set(frontier.gain); tapSamples.set(frontier.taps);
      frame = frontier.frame; leftSample = frontier.leftSample; rightSample = frontier.rightSample; muted = frontier.muted;
      return Object.freeze({ status: 'restored-unpublished-graph', frame, hash, components: components.length, bytes: bytes.length, mutableState: 'independent', qualification: 'implementation-awaiting-pcm-equivalence' });
    } catch (error) { panic(); throw error; }
  };
  return Object.freeze({ plan, hash, sample, update, stateByteLength, snapshotInto, restoreFrom, validateUpdate: (id, values) => update(id, values, false), tapSamples, returnNodeIds: Object.freeze([...returnNodeIds]), get frame() { return frame; }, get leftSample() { return leftSample; }, get rightSample() { return rightSample; },
    componentStateInventory: () => Object.freeze(stateEntries.map(entry => Object.freeze({ nodeId: entry.nodeId, kind: entry.kind, bytes: entry.bytes }))),
    validateDetachedComponentStates(components) {
      if (frame || validationOnly || !Array.isArray(components) || components.length !== stateEntries.length || new Set(components.map(row => row?.nodeId)).size !== components.length) fail('effect-detached-component-inventory', 'Use a fresh validation graph and every exact detached component.');
      validationOnly = true; const indexed = new Map(components.map(row => [row.nodeId, row])), validated = [];
      for (const entry of stateEntries) {
        const row = indexed.get(entry.nodeId);
        if (!row || row.kind !== entry.kind || !(row.bytes instanceof Uint8Array) || row.bytes.length !== entry.bytes || !Number.isSafeInteger(row.sourceFrame) || row.sourceFrame < 0) fail('effect-detached-component-inventory', 'A detached component differs from its pinned graph inventory.');
        entry.kernel.restoreFrom(row.bytes);
        if (entry.kernel.frame !== row.sourceFrame || entry.kernel.faults) fail('effect-detached-component-frontier', 'Detached processor frame or containment state differs.');
        const host = row.hostState, keys = entry.kind === 'feedback-delay' ? ['lastRequestedDelay'] : entry.kind === 'spectral-freeze' ? ['reportedCapture', 'started'] : entry.kind === 'envelope-detector' ? ['sourceOverride'] : ['multiband-vocoder', 'ring-modulator'].includes(entry.kind) ? ['carrierOverride', 'donorOverride'] : [];
        if (!host || Object.getPrototypeOf(host) !== Object.prototype || Object.keys(host).length !== keys.length || keys.some(key => !Object.hasOwn(host, key)) || Object.keys(host).some(key => !keys.includes(key))) fail('effect-detached-host-state', 'Processor host state differs from its exact wrapper inventory.');
        if ('lastRequestedDelay' in host && (!Number.isFinite(host.lastRequestedDelay) || host.lastRequestedDelay < entry.kernel.minimumDelayFrames || host.lastRequestedDelay > entry.kernel.maxDelayFrames) || 'reportedCapture' in host && (host.reportedCapture !== entry.kernel.captureSerial || typeof host.started !== 'boolean') || ['sourceOverride', 'donorOverride', 'carrierOverride'].some(key => key in host && host[key] !== null && typeof host[key] !== 'boolean')) fail('effect-detached-host-state', 'Invalid processor input, analysis or requested-delay frontier.');
        const bytes = new Uint8Array(entry.bytes); entry.kernel.snapshotInto(bytes); validated.push({ nodeId: entry.nodeId, kind: entry.kind, sourceFrame: row.sourceFrame, bytes });
      }
      return validated;
    },
    stateBytes: plan.stateBytes + values.byteLength + controls.byteLength + gain.byteLength + tapSamples.byteLength,
    panic,
    enqueueBodyStrike(nodeId, command) {
      const record = records[indices.get(nodeId)];
      if (muted || !record?.entry.membrane || !record.kernel.enqueueStrike(command)) fail('body-strike-admission', 'The exact owned body declined its finite strike queue or payload.');
      return Object.freeze({ status: 'accepted', stage: 'owned-body-strike-queued', nodeId, token: command.token, targetFrame: command.frame, graphDefinitionHash: hash, appliedFrame: null, acousticReceipt: false });
    },
    validateSpectralCapture(nodeId, capture) { const record = records[indices.get(nodeId)]; if (!record?.entry.spectral) fail('effect-spectral-window-node', 'The captured window requires its exact spectral node.'); validateSpectralCaptureReceipt(capture, record.entry.spectral); return true; },
    assertSpectralCapture(nodeId, capture) {
      const record = records[indices.get(nodeId)], kernel = record?.entry.spectral && record.kernel;
      if (!kernel || kernel.faults || kernel.captureSerial !== capture.serial || kernel.captureStartFrame !== capture.startFrame || kernel.captureEndFrame !== capture.endFrame) quarantine('effect-spectral-window-unavailable', 'The new realization could not analyze the complete original window at its exact acknowledged frontier.');
      return true;
    },
    assertHealthy() {
      if (records.some(record => record.kernel?.faults || record.entry.membrane && record.kernel.strikes.frontier[6])) fail('effect-render-incomplete', 'An owned effect branch faulted or rejected an admitted finite strike.'); return true;
    },
    diagnostics: () => Object.freeze({ hash, frame, muted, processingRevisions: plan.processingRevisions, processingCost: plan.processingCost, graphScope: 'one-full-shared-owner-sum', sidechainInputs: plan.sidechainInputs, stemScope: 'simultaneous-node-output-taps',
      blendBodyStates: records.filter(record => record.entry.blendBody).map(record => ({ nodeId: record.entry.id, ...record.kernel.diagnostics() })), pairedBodyStates: records.filter(record => record.entry.pairedBody).map(record => ({ nodeId: record.entry.id, ...record.kernel.diagnostics() })), membraneStates: records.filter(record => record.entry.membrane).map(record => ({ nodeId: record.entry.id, ...record.kernel.diagnostics() })), sympatheticStates: records.filter(record => record.entry.network).map(record => ({ nodeId: record.entry.id, ...record.kernel.diagnostics() })), spectralStates: records.filter(record => record.entry.spectral).map(record => ({ nodeId: record.entry.id, ...record.kernel.diagnostics() })), summation: 'canonical-edge-order-float32-node-boundaries', restoration: 'owned-graph-state-cut-and-deterministic-preroll;not-live-node-transfer', vocoderBanks: records.filter(record => record.entry.vocoder).map(record => ({ nodeId: record.entry.id, profile: record.kernel.profile, donorAvailable: record.kernel.donorAvailable, carrierAvailable: record.kernel.carrierAvailable, donorPeak: record.kernel.donorPeak, carrierPeak: record.kernel.carrierPeak, envelopePeak: record.kernel.envelopePeak })), outputProtection: 'external-excluded', qualification: 'implementation-awaiting-live-offline-pcm-equivalence' }) });
}
