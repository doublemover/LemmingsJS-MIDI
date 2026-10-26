import { validateEffectSourceBindings } from '../midi-ui/EffectSourceBindings.js';
import { prepareEffectRenderPlan, validateNativeEffectRenderReceipt, validateOwnedConvolutionSourceReceipt } from '../midi-ui/EffectRenderPlan.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { createOwnedEffectGraphKernel } from '../midi-ui/OwnedEffectGraphKernel.js';
import { effectGraphHash } from '../../midi/content/EffectGraphRevision.js';

const failure = message => Object.assign(new Error(message), { name: 'NativeOfflineEncodingError' });
const ascii = (view, at, text) => { for (let index = 0; index < text.length; index++) view.setUint8(at + index, text.charCodeAt(index)); };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const encode = (pcm, manifest) => {
  const metadata = canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes;
  const length = 64 + pcm.byteLength + metadata.length + metadata.length % 2;
  if (!Number.isSafeInteger(length) || length > 64 * 1048576 || length - 8 > 0xffffffff) throw failure('Native WAV exceeds its admitted RIFF bound.');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  ascii(view, 0, 'RIFF'); view.setUint32(4, length - 8, true); ascii(view, 8, 'WAVE'); ascii(view, 12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, manifest.sampleRate, true); view.setUint32(28, manifest.sampleRate * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  ascii(view, 36, 'fact'); view.setUint32(40, 4, true); view.setUint32(44, manifest.frames, true); ascii(view, 48, 'data'); view.setUint32(52, pcm.byteLength, true); bytes.set(pcm, 56);
  const at = 56 + pcm.byteLength; ascii(view, at, 'lmjs'); view.setUint32(at + 4, metadata.length, true); bytes.set(metadata, at + 8); return bytes;
};

export async function encodeNativeOfflineRender({ mode, manifest, planes, firstFrame = 0, endFrame, stemLaneIds = [] } = {},
  { signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {}, maxWorkingBytes = 512 * 1048576 } = {}) {
  const requested = manifest?.effectGraph; let effectPlan = null, returns = [];
  if (requested != null) {
    if (!requested || Object.getPrototypeOf(requested) !== Object.prototype || !requested.definition || !requested.processingRevisions || !Array.isArray(manifest.stems?.sharedReturns)) throw failure('Native effect manifest omitted its graph and simultaneous return inventory.');
    returns = [...manifest.stems.sharedReturns]; effectPlan = prepareEffectRenderPlan(requested.definition, manifest.sampleRate, returns, { nativeConvolution: true, nativeOwnedProcessors: true });
    if (requested.hash !== await effectGraphHash(effectPlan) || canonicalDataText(requested.processingRevisions).text !== canonicalDataText(effectPlan.processingRevisions).text ||
        requested.latencyFrames !== effectPlan.latencyFrames || requested.maximumTailFrames !== effectPlan.maximumTailFrames || requested.controls !== 'explicit-authored-defaults-not-replayed-live-gestures' || requested.scope !== 'one-full-shared-owner-sum')
      throw failure('Native effect manifest differs from the exact executing graph.');
  }
  const nativeEffects = !!effectPlan && (!!effectPlan.impulseCount || !!manifest.nativeScheduling?.effectGraph);
  if (nativeEffects) validateNativeEffectRenderReceipt(effectPlan, manifest.nativeScheduling, requested.hash, returns);
  if (['worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-seed-layers'].includes(manifest?.engineRequirement?.engineId)) {
    if (!nativeEffects) throw failure('Owned-source native encoding requires its exact convolution execution.');
    validateOwnedConvolutionSourceReceipt(manifest);
  }
  if (effectPlan?.sidechainInputs.length) {
    const bindings = validateEffectSourceBindings(effectPlan, requested.sourceBindings);
    if (!nativeEffects) throw failure('External donor rendering requires the actual simultaneous native graph, not missing donor planes.');
    if (canonicalDataText(bindings).text !== canonicalDataText(manifest.nativeScheduling.effectGraph.sourceBindings).text) throw failure('Native sidechain realization differs from its declared donor routes.');
  }
  const nativeFrames = planes?.[0]?.length, frames = endFrame - firstFrame;
  if (!['controls', 'causal-take'].includes(mode) || !Array.isArray(stemLaneIds) || !Array.isArray(planes) || planes.length !== 2 + (stemLaneIds.length + (nativeEffects ? returns.length : 0)) * 2 || planes.length > 32 ||
      stemLaneIds.length > 15 || new Set(stemLaneIds).size !== stemLaneIds.length || stemLaneIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
      !Number.isSafeInteger(nativeFrames) || nativeFrames < 1 || planes.some(plane => !(plane instanceof Float32Array) || plane.length !== nativeFrames) ||
      !Number.isSafeInteger(firstFrame) || firstFrame < 0 || !Number.isSafeInteger(endFrame) || endFrame <= firstFrame || endFrame > nativeFrames ||
      nativeFrames * planes.length * 4 > 64 * 1048576 || ![44100, 48000, 96000].includes(manifest?.sampleRate) || manifest.frames !== frames || manifest.channels !== 2 ||
      manifest.sampleFormat !== 'ieee-float32-le' || manifest.schema !== (mode === 'controls' ? 'lemmings-rendered-audition/v1' : 'lemmings-causal-audio-render/v1') ||
      mode === 'controls' && (firstFrame !== 0 || endFrame !== nativeFrames || stemLaneIds.length || manifest.effectGraph != null)) throw failure('Native PCM, frame interval or stereo tap inventory differs from its admitted manifest.');
  if (nativeEffects && manifest.nativeScheduling.frames !== nativeFrames) throw failure('Native effect completion covers a different complete PCM history.');
  canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 32768 });
  const tapCount = stemLaneIds.length + returns.length + 1, outputBytes = frames * 8 * tapCount;
  const workingBytes = nativeFrames * planes.length * 16 + outputBytes * 4 + 16 * 1048576 + (effectPlan ? effectPlan.stateBytes + 4 * 1048576 : 0);
  if (!Number.isSafeInteger(outputBytes) || outputBytes + 262208 * tapCount > 64 * 1048576 || !Number.isSafeInteger(maxWorkingBytes) || workingBytes > maxWorkingBytes)
    throw failure('Native PCM, shared effects, simultaneous taps and encoding overlap exceed the admitted workspace.');
  for (let first = 0; first < nativeFrames; first += 16384) {
    signal?.throwIfAborted(); const end = Math.min(nativeFrames, first + 16384);
    for (const plane of planes) for (let index = first; index < end; index++) if (!Number.isFinite(plane[index])) throw failure('The native producer returned a nonfinite PCM sample.');
    await yieldControl();
  }
  const effects = effectPlan && !nativeEffects ? await createOwnedEffectGraphKernel({ definition: effectPlan.definition, sampleRate: manifest.sampleRate, returnNodeIds: returns }) : null;
  const processed = effects ? Array.from({ length: returns.length + 1 }, () => new Uint8Array(frames * 8)) : null;
  if (effects) {
    const views = processed.map(bytes => new DataView(bytes.buffer));
    for (let first = 0; first < endFrame; first += 4096) {
      signal?.throwIfAborted(); const end = Math.min(endFrame, first + 4096);
      for (let frame = first; frame < end; frame++) {
        effects.sample(planes[0][frame], planes[1][frame]); if (frame < firstFrame) continue;
        const at = (frame - firstFrame) * 8; views[0].setFloat32(at, effects.leftSample, true); views[0].setFloat32(at + 4, effects.rightSample, true);
        for (let tap = 0; tap < returns.length; tap++) { views[tap + 1].setFloat32(at, effects.tapSamples[tap * 2], true); views[tap + 1].setFloat32(at + 4, effects.tapSamples[tap * 2 + 1], true); }
      }
      onProgress({ phase: 'rendering-native-shared-effects', completedUnits: end, totalUnits: endFrame }); await yieldControl();
    }
  }
  const renderedManifest = effects || nativeEffects ? { ...manifest, effectGraph: { ...requested, realization: nativeEffects ? manifest.nativeScheduling.effectGraph.realization : effects.diagnostics() } } : manifest;
  const files = []; let totalBytes = 0;
  for (let tap = 0; tap < tapCount; tap++) {
    const lane = tap > 0 && tap <= stemLaneIds.length, returnNodeId = tap > stemLaneIds.length ? returns[tap - 1 - stemLaneIds.length] ?? null : null;
    const prepared = Boolean(processed && (tap === 0 || returnNodeId)), pcm = prepared ? processed[tap === 0 ? 0 : tap - stemLaneIds.length] : new Uint8Array(frames * 8), view = new DataView(pcm.buffer);
    let peak = 0, squares = 0, overFullScaleSamples = 0;
    for (let first = 0; first < frames; first += 16384) {
      signal?.throwIfAborted(); const end = Math.min(frames, first + 16384);
      for (let frame = first; frame < end; frame++) for (let channel = 0; channel < 2; channel++) {
        const at = (frame * 2 + channel) * 4, value = prepared ? view.getFloat32(at, true) : planes[tap * 2 + channel][frame + firstFrame];
        if (!Number.isFinite(value)) throw failure('The complete native/effect output contains nonfinite PCM.');
        peak = Math.max(peak, Math.abs(value)); squares += value * value; if (Math.abs(value) > 1) overFullScaleSamples++;
        if (!prepared) view.setFloat32(at, value, true);
      }
      onProgress({ phase: 'encoding-native-pcm', completedUnits: tap * frames + end, totalUnits: frames * tapCount }); await yieldControl();
    }
    const result = { ...renderedManifest, ...(mode === 'causal-take' ? { tap: lane ? 'captured-lane-dry' : returnNodeId ? 'shared-effect-node-output' : effects || nativeEffects ? 'complete-owned-effect-graph-pre-master' : 'complete-native-source-graph-pre-master', laneId: lane ? stemLaneIds[tap - 1] : null, returnNodeId } : {}),
      pcmHash: await digest(pcm), statistics: { peak, rms: Math.sqrt(squares / (frames * 2)), overFullScaleSamples } };
    signal?.throwIfAborted(); const bytes = encode(pcm, result); totalBytes += bytes.byteLength;
    if (totalBytes > 64 * 1048576) throw failure('Native encoded files exceed their combined admitted bound.');
    files.push({ name: lane ? 'lane-' + tap : returnNodeId ? 'effect-' + returnNodeId : 'master', bytes, manifest: result });
  }
  return mode === 'controls' ? { bytes: files[0].bytes, manifest: files[0].manifest } : { manifest: renderedManifest, files };
}
