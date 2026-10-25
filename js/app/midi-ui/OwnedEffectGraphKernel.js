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
export async function createOwnedEffectGraphKernel({ definition, sampleRate = 48000, returnNodeIds = [] } = {}) {
  const plan = prepareOwnedEffectGraphPlan(definition, sampleRate, returnNodeIds), hash = await effectGraphHash(plan);
  const indices = new Map(plan.order.map((id, i) => [id, i])), values = new Float32Array(plan.nodes.length * 2), presence = new Uint8Array(plan.nodes.length), controls = new Float64Array(plan.nodes.length * 4), gain = new Float64Array(plan.nodes.length * 3);
  const sidechainIndices = new Map(plan.sidechainInputs.map((id, index) => [id, index]));
  const records = plan.nodes.map((entry, index) => {
    const p = entry.parameters, at = index * 4; let kernel = null;
    if (entry.kind === 'feedback-delay') {
      controls.set([p.delaySeconds * sampleRate, p.feedback, p.wet01, p.feedbackLowpassHz], at);
      kernel = new BoundedDelayKernel({ sampleRate, maxDelayFrames: Math.ceil(p.maxDelaySeconds * sampleRate), delayFrames: p.delaySeconds * sampleRate, mode: p.mode,
        transitionFrames: Math.max(2, Math.round(p.transitionSeconds * sampleRate)), maximumSlew: p.maximumSlew, feedback: p.feedback, feedbackMaximum: p.feedbackMaximum,
        feedbackLowpassHz: p.feedbackLowpassHz, feedbackHighpassHz: p.feedbackHighpassHz, wet: p.wet01 });
    } else if (entry.kind === 'nonlinear-chain') { controls.set([p.driveDb, p.outputTrim01, 0, 0], at); kernel = new NonlinearChainKernel({ sampleRate, parameters: p }); }
    else if (entry.kind === 'ring-modulator') kernel = new RingModulatorKernel({ sampleRate, parameters: p });
    else if (entry.kind === 'multiband-vocoder') kernel = new VocoderBankKernel({ sampleRate, parameters: p });
    else if (entry.kind === 'envelope-detector') kernel = new EnvelopeFollowerKernel({ sampleRate, parameters: p });
    else if (entry.kind === 'envelope-mapping') kernel = new EnvelopeMappingKernel({ sampleRate, parameters: p });
    else if (entry.kind === 'gain') { gain[index * 3] = gain[index * 3 + 1] = p.gain01; controls[at] = p.gain01; }
    const incoming = plan.edges.filter(edge => edge.to.nodeId === entry.id).map(edge => ({ source: indices.get(edge.from.nodeId) * 2, gain01: edge.gain01, port: edge.to.port, audio: isAudioEffectPort(entry.ports.inputs[edge.to.port]), donor: edge.to.port === 'donorAudio',
      align: edge.alignmentFrames ? new FixedFractionalDelayKernel({ sampleRate, delayFrames: edge.alignmentFrames }) : null }));
    return { entry, index, kernel, incoming, at, sidechainOffset: (sidechainIndices.get(entry.id) ?? -1) * 2 };
  });
  const inputIndex = indices.get(plan.inputs[0]), outputIndex = indices.get(plan.outputs[0]) * 2, taps = returnNodeIds.map(id => indices.get(id) * 2), tapSamples = new Float32Array(taps.length * 2);
  let frame = 0, leftSample = 0, rightSample = 0, muted = false;
  const panic = () => { muted = true; for (const record of records) { record.kernel?.panic(); for (const edge of record.incoming) edge.align?.panic(); } values.fill(0); tapSamples.fill(0); leftSample = rightSample = 0; };
  const quarantine = (code, message) => { panic(); fail(code, message); };
  const update = (nodeId, next) => {
    if (muted) fail('effect-graph-retired', 'This graph was cleared; prepare a new graph for further controls.');
    const index = indices.get(nodeId), record = records[index];
    if (!record || !next || Object.getPrototypeOf(next) !== Object.prototype || !Object.keys(next).length || Object.keys(next).length > 4 || Object.values(next).some(value => !Number.isFinite(value))) fail('invalid-effect-control', 'Invalid owned effect control.');
    const { entry, at, kernel } = record, p = entry.parameters, keys = Object.keys(next), finite = (value, a, b) => Number.isFinite(value) && value >= a && value <= b;
    if (entry.kind === 'gain') {
      if (keys.some(key => key !== 'gain01') || !finite(next.gain01, 0, p.gainMaximum01)) fail('invalid-effect-control', 'Effect gain exceeds its declared bound.');
      controls[at] = next.gain01; gain[index * 3 + 1] = next.gain01; gain[index * 3 + 2] = Math.max(1, Math.round(sampleRate * 0.008));
    } else if (entry.kind === 'feedback-delay') {
      if (keys.some(key => !['delaySeconds', 'feedback', 'wet01', 'feedbackLowpassHz'].includes(key)) ||
          next.delaySeconds != null && !finite(next.delaySeconds, 1 / sampleRate, p.maxDelaySeconds) || next.feedback != null && !finite(next.feedback, -p.feedbackMaximum, p.feedbackMaximum) ||
          next.wet01 != null && !finite(next.wet01, 0, 1) || next.feedbackLowpassHz != null && !finite(next.feedbackLowpassHz, 200, sampleRate * 0.4)) fail('invalid-effect-control', 'Delay control exceeds its immutable profile.');
      if (next.delaySeconds != null) { const target = next.delaySeconds * sampleRate; if (!kernel.setDelay(target)) fail('effect-transition-busy', 'The two-tap delay transition is still active.'); controls[at] = target; }
      if (next.feedback != null) controls[at + 1] = next.feedback;
      if (next.wet01 != null) controls[at + 2] = next.wet01;
      if (next.feedbackLowpassHz != null) { kernel.setFeedbackLowpassHz(next.feedbackLowpassHz); controls[at + 3] = next.feedbackLowpassHz; }
    } else if (entry.kind === 'nonlinear-chain') {
      if (keys.some(key => !['driveDb', 'outputTrim01'].includes(key)) || next.driveDb != null && !finite(next.driveDb, 0, 24) || next.outputTrim01 != null && !finite(next.outputTrim01, 0, 1)) fail('invalid-effect-control', 'Nonlinear drive/trim exceeds its declared domain.');
      if (next.driveDb != null) controls[at] = next.driveDb;
      if (next.outputTrim01 != null) controls[at + 1] = next.outputTrim01;
    } else fail('effect-control-unavailable', 'This routing node has no live parameter adapter.');
    return Object.freeze({ status: 'applied-to-owned-render', nodeId, frame, graphDefinitionHash: hash, acousticReceipt: false });
  };
  const sample = (left, right, sidechainSamples = null, sidechainPresence = null) => {
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
      else if (entry.kind === 'mono-to-stereo') b = a;
      else if (entry.kind === 'stereo-to-mono') { a = (a + b) * 0.5; b = 0; }
      else if (entry.kind === 'gain') {
        const g = index * 3; a *= gain[g]; b *= gain[g];
        if (gain[g + 2] > 0) { gain[g] += (gain[g + 1] - gain[g]) / gain[g + 2]; gain[g + 2]--; }
      } else if (kernel) {
        if (entry.kind === 'feedback-delay') kernel.sample(a, b, controls[at + 1], controls[at + 2]); else kernel.sample(a, b, controls[at], controls[at + 1]);
        if (kernel.faults) quarantine('effect-state-containment', 'The ' + entry.kind + ' branch quarantined invalid state.'); a = kernel.leftSample; b = kernel.rightSample;
      }
      if (kernel?.faults) quarantine('effect-state-containment', 'The ' + entry.kind + ' branch quarantined invalid state.');
      if (!Number.isFinite(a) || !Number.isFinite(b)) quarantine('nonfinite-effect-output', 'The full owned effect graph produced nonfinite output.');
      presence[index] = audioPresent || entry.kind === 'feedback-delay' || entry.kind === 'nonlinear-chain' || entry.kind === 'multiband-vocoder' || entry.kind === 'ring-modulator' ? 1 : 0;
      values[index * 2] = Math.fround(a); values[index * 2 + 1] = Math.fround(b);
    }
    leftSample = values[outputIndex]; rightSample = values[outputIndex + 1];
    for (let i = 0; i < taps.length; i++) { tapSamples[i * 2] = values[taps[i]]; tapSamples[i * 2 + 1] = values[taps[i] + 1]; } frame++;
  };
  return Object.freeze({ plan, hash, sample, update, tapSamples, returnNodeIds: Object.freeze([...returnNodeIds]), get frame() { return frame; }, get leftSample() { return leftSample; }, get rightSample() { return rightSample; },
    stateBytes: plan.stateBytes + values.byteLength + controls.byteLength + gain.byteLength + tapSamples.byteLength,
    panic,
    diagnostics: () => Object.freeze({ hash, frame, muted, processingRevisions: plan.processingRevisions, processingCost: plan.processingCost, graphScope: 'one-full-shared-owner-sum', sidechainInputs: plan.sidechainInputs, stemScope: 'simultaneous-node-output-taps',
      summation: 'canonical-edge-order-float32-node-boundaries', restoration: 'deterministic-preroll', vocoderBanks: records.filter(record => record.entry.vocoder).map(record => ({ nodeId: record.entry.id, profile: record.kernel.profile, donorAvailable: record.kernel.donorAvailable, carrierAvailable: record.kernel.carrierAvailable, donorPeak: record.kernel.donorPeak, carrierPeak: record.kernel.carrierPeak, envelopePeak: record.kernel.envelopePeak })), outputProtection: 'external-excluded', qualification: 'implementation-awaiting-live-offline-pcm-equivalence' }) });
}
