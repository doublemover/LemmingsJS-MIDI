import { prepareResonatorControlProfile, createResonatorControlKernel } from '../midi-ui/worklet/ResonatorControlStrategy.js';
import { encodeOwnedAudioWav } from '../midi-ui/OwnedAudioWav.js';
import { freezeData } from '../../core/CanonicalData.js';
const hashAssetBytes = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');

const fail = message => { throw Object.assign(new Error('Morph control reference: ' + message), { code: 'invalid-morph-control-reference' }); };
export async function renderResonatorMorphReference(input, { signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {}, estimatedPeakBytes = 64 * 1048576 } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('The reviewed map source changed.'); };
  check(); if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(key => !['map', 'a', 'b', 'sampleRate', 'program', 'applicationBuildId'].includes(key)) || ![undefined, 'held-out-and-back-v1', 'endpoint-a-v1', 'endpoint-b-v1'].includes(input.program)) fail('Choose the explicit authored comparison program.');
  if (input.applicationBuildId != null && !/^[a-f0-9]{64}$/.test(input.applicationBuildId)) fail('The requested source build identity is invalid.');
  const sampleRate = input.sampleRate ?? 48000, profile = await prepareResonatorControlProfile(input.map, input.a, input.b, sampleRate), program = input.program ?? 'held-out-and-back-v1', frames = sampleRate * 6, pcmBytes = frames * 8;
  if (program === 'held-out-and-back-v1' && !['paired-synthetic-held', 'prepared-dual-body-blend'].includes(profile.transitionPolicy)) fail('The reference cannot upgrade an onset-only map into held motion. Review an explicit paired-held or prepared-blend map.');
  if (!Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < pcmBytes * 4 + 1048576 || estimatedPeakBytes > 512 * 1048576) fail('The full body/PCM/WAV/encoding overlap is not admitted.');
  check(); const kernel = createResonatorControlKernel(profile), pcm = new Uint8Array(pcmBytes), view = new DataView(pcm.buffer), strikes = [{ frame: 0, frames: Math.round(sampleRate * 0.004), amplitude01: 0.25 }, { frame: Math.round(sampleRate * 2.5), frames: Math.round(sampleRate * 0.004), amplitude01: 0.25 }]; let peak = 0, squares = 0;
  for (let frame = 0; frame < frames; frame++) {
    let excitation = 0; for (const strike of strikes) if (frame >= strike.frame && frame < strike.frame + strike.frames) { const phase = (frame - strike.frame) / (strike.frames - 1); excitation += strike.amplitude01 * 0.5 * (1 - Math.cos(2 * Math.PI * phase)); }
    const u = program === 'endpoint-a-v1' ? 0 : program === 'endpoint-b-v1' ? 1 : frame < sampleRate ? 0 : frame < sampleRate * 3 ? (frame / sampleRate - 1) / 2 : frame < sampleRate * 5 ? 1 - (frame / sampleRate - 3) / 2 : 0;
    kernel.sample(excitation, frame, u); const a = kernel.leftSample, b = kernel.rightSample; view.setFloat32(frame * 8, a, true); view.setFloat32(frame * 8 + 4, b, true); peak = Math.max(peak, Math.abs(a), Math.abs(b)); squares += a * a + b * b;
    if (kernel.state[7]) fail('The selected body strategy contained invalid or excessive state.');
    if ((frame + 1) % 4096 === 0) { check(); onProgress({ stage: 'paired-body-control-render', completed: frame + 1, total: frames }); await yieldControl(); }
  }
  check(); const manifest = freezeData({ schema: 'lemmings-resonator-morph-control-render/v1', rendererRevision: profile.revision, applicationBuildId: input.applicationBuildId ?? null, buildEvidence: 'requested-source-build;bound-worker-receipt-verified-by-reference-owner', profileHash: profile.identity, mapHash: profile.mapHash, endpointAHash: profile.endpointAHash, endpointBHash: profile.endpointBHash, sampleRate, frames, channels: 2, sampleFormat: 'ieee-float32-le', pcmHash: await hashAssetBytes(pcm),
    bodyCount: profile.bodyCount ?? 1, program, excitation: { source: 'explicit-authored-control-fixture', unit: 'normalized-finite-four-ms-Hann-force', forceScale: profile.forceScale, admittedBodies: profile.bodyCount ?? 1, delivery: 'same-finite-control-source-to-each-independently-owned-body', strikes }, physicalTakeEvidence: false, acousticQualification: false, semanticIntentReplay: false,
    statePolicy: profile.statePolicy, unmatchedPolicy: profile.unmatchedPolicy, statistics: { peak, rms: Math.sqrt(squares / (frames * 2)) }, body: kernel.diagnostics(), remaining: [...(profile.bodyCount === 2 ? ['live-prepared-blend-graph-integration'] : []), 'moving-morph-worklet-cost', 'state-cut-PCM', 'spectrum-alias-and-decay', 'matched-level-listening'] });
  const bytes = encodeOwnedAudioWav(pcm, frames, sampleRate, manifest, { maxMetadataBytes: 262144, maxMetadataNodes: 32768 }); check(); return { bytes, manifest };
}
