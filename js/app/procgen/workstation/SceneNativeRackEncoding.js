import { prepareSceneEffectRack } from './SceneEffectRack.js';
import { validateNativeEffectRenderReceipt } from '../../midi-ui/EffectRenderPlan.js';
import { effectGraphHash } from '../../../midi/content/EffectGraphRevision.js';
import { canonicalDataText, hashData, freezeData } from '../../../core/CanonicalData.js';
import { encodeCausalRenderWave } from '../../midi-ui/CausalOwnedRender.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'scene-native-rack-encoding-unbound' }); };
const same = (a, b) => canonicalDataText(a).text === canonicalDataText(b).text;
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
export async function encodeSceneNativeRack({ manifest, planes, firstFrame, endFrame, stemLaneIds }, { signal, yieldControl, maxWorkingBytes }) {
  signal?.throwIfAborted(); const effects = manifest?.effects, rate = manifest?.sampleRate, frames = manifest?.frames, source = manifest?.sourcePcmProducer, native = manifest?.nativeScheduling;
  if (manifest?.schema !== 'lemmings-scene-rehearsal-render/v1' || !effects?.definition || ![44100, 48000, 96000].includes(rate) || !Number.isSafeInteger(frames) || frames < 1 || frames > rate * 11 ||
      firstFrame !== 0 || endFrame !== frames || !Array.isArray(stemLaneIds) || stemLaneIds.length || !Array.isArray(planes) || planes.length !== 2 || planes.some(plane => !(plane instanceof Float32Array) || plane.length !== frames) ||
      manifest.channels !== 2 || manifest.sampleFormat !== 'ieee-float32-le' || manifest.currentWorldAdvanced !== false || manifest.nextWorldAdvanced !== false || manifest.externalOutput !== false || manifest.acousticReceipt !== false ||
      effects.realization !== 'native-offline-audio-context;worker-encoded-mixed-source' || effects.nativeLatencyMeasuredFrames !== null || effects.crossBrowserBitIdentity !== false || effects.controls !== 'authored-static-defaults;no-replayed-throw-gestures' || effects.semanticOnsetsAdded !== 0 ||
      source?.schema !== 'lemmings-scene-rack-source-receipt/v1' || source.frames !== frames || source.channels !== 2 || source.sampleRate !== rate || source.sourceHash !== manifest.sourceHash || source.sceneHash !== manifest.sceneHash || source.applicationBuildId !== manifest.applicationBuildId ||
      source.worker?.method !== 'dedicated-worker' || source.worker.kind !== 'render-scene-rehearsal' || source.worker.sourceRevision !== manifest.sourceHash || source.worker.executionIdentity?.activeExecution !== 'bound' || source.worker.executionIdentity.buildId !== manifest.applicationBuildId ||
      native?.frames !== frames || native.nativeSourceBackend !== manifest.engineRequirement?.engineId || native.crossBrowserBitIdentity !== false || native.sourcePcm?.scope !== 'whole-dry-source-history-before-crop' || native.sourcePcm.frames !== frames || native.sourcePcm.channels !== 2 || native.sourcePcm.bytes !== frames * 8 ||
      !Array.isArray(source.planeByteHashes) || source.planeByteHashes.length !== 2 || source.planeByteHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)) || !['little-endian', 'big-endian'].includes(source.planeHashByteOrder) ||
      !same(source.planeByteHashes, native.sourcePcm.planeByteHashes) || source.planeHashByteOrder !== native.sourcePcm.planeHashByteOrder || !same(native.sourcePcm.laneIds, []) || !same(native.sourcePcm.sourceLaneIds, []) ||
      !Number.isSafeInteger(maxWorkingBytes) || frames * 64 + 32 * 1048576 > maxWorkingBytes)
    fail('Native scene PCM differs from its admitted complete source, graph producer or bounded encoding interval.');
  const prepared = prepareSceneEffectRack({ schema: 'lemmings-owner-effect-rack/v1', graph: effects.definition, bypass: 'active' }, rate), plan = prepared.plan, graphHash = await effectGraphHash(plan);
  if (!prepared.native || effects.graphHash !== graphHash || effects.definitionHash !== await hashData(effects.definition, { maxBytes: 65536, maxNodes: 8192 }) || effects.latencyFrames !== plan.latencyFrames || effects.latencyPolicy !== prepared.rack.graph.latencyPolicy ||
      !same(effects.processingRevisions, plan.processingRevisions) || effects.tailFrames !== prepared.previewTailFrames || effects.declaredMaximumTailFrames !== plan.maximumTailFrames || effects.tailTruncatedByPreviewBound !== (prepared.previewTailFrames < plan.maximumTailFrames) ||
      !Number.isSafeInteger(effects.sourceFrames) || effects.sourceFrames < 1 || effects.sourceFrames + effects.tailFrames !== frames || native.effectGraph?.realization?.runtime?.activeExecution !== 'bound' || native.effectGraph.realization.runtime.applicationBuildId !== manifest.applicationBuildId)
    fail('Native scene graph, processing revisions or stopped-source tail differ from the saved rack.');
  validateNativeEffectRenderReceipt(plan, native, graphHash, []);
  const pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer); let peak = 0, squares = 0, overFullScaleSamples = 0;
  for (let first = 0; first < frames; first += 16384) { signal?.throwIfAborted(); const end = Math.min(frames, first + 16384);
    for (let frame = first; frame < end; frame++) for (let channel = 0; channel < 2; channel++) { const value = planes[channel][frame]; if (!Number.isFinite(value)) fail('Native scene output contains nonfinite PCM.'); view.setFloat32(frame * 8 + channel * 4, value, true); peak = Math.max(peak, Math.abs(value)); squares += value * value; if (Math.abs(value) > 1) overFullScaleSamples++; }
    await yieldControl();
  }
  const completed = freezeData({ ...manifest, pcmHash: await digest(pcm), statistics: { peak, rms: Math.sqrt(squares / (frames * 2)), overFullScaleSamples } }); signal?.throwIfAborted();
  canonicalDataText(completed, { maxBytes: 262144 }); return { bytes: encodeCausalRenderWave(pcm, frames, rate, completed), manifest: completed };
}
