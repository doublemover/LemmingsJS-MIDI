import { canonicalDataText, hashData, freezeData } from '../../../core/CanonicalData.js';
import { validateAcousticMap } from '../../../midi/content/AcousticMap.js';
import { encodeCausalRenderWave } from '../../midi-ui/CausalOwnedRender.js';
import { spatialReadoutGraphCost } from '../../midi-ui/SpatialReadoutPlan.js';

const fail = () => { throw new Error('Private spatial PCM differs from its complete authored map, native realization or source prefix.'); };
export async function encodeSceneSpatial({ manifest, planes, firstFrame, endFrame, stemLaneIds }, { signal, yieldControl, maxWorkingBytes }) {
  signal?.throwIfAborted(); const rate = manifest?.sampleRate, frames = manifest?.frames, spatial = manifest?.spatial, source = manifest?.sourceRealization, native = manifest?.nativeScheduling;
  if (manifest?.schema !== 'lemmings-scene-rehearsal-render/v1' || ![44100, 48000, 96000].includes(rate) || !Number.isSafeInteger(frames) || frames < 1 || frames > rate * 16 || firstFrame !== 0 || endFrame !== frames || !Array.isArray(stemLaneIds) || stemLaneIds.length || !Array.isArray(planes) || planes.length !== 2 || planes.some(plane => !(plane instanceof Float32Array) || plane.length !== frames) || frames * 64 + 32 * 1048576 > maxWorkingBytes || manifest.currentWorldAdvanced !== false || manifest.nextWorldAdvanced !== false || manifest.externalOutput !== false || manifest.acousticReceipt !== false || spatial?.schema !== 'lemmings-private-spatial-readout/v1' || spatial.historicalPerformanceEvidence !== false || spatial.semanticOnsetsAdded !== 0 || spatial.nativePreparation !== 'completed-by-native-offline-owner;not-live-admission' || source?.sourceCanonicalHash !== manifest.sourceHash || source.applicationBuildId !== manifest.applicationBuildId || source.intentHash !== spatial.semanticIntentHash || source.frames !== frames || source.privateSpatial?.sourceHash !== spatial.sourceHash || source.commands.capturedBegins !== spatial.sourceOnsets || source.tail.truncated !== false || native?.method !== 'native-offline-audio-context' || native.frames !== frames || native.spatial?.ready !== true || native.spatial.mapHash !== spatial.mapHash || native.spatial.fault || canonicalDataText(native).text !== canonicalDataText(source.nativeScheduling).text) fail();
  const map = validateAcousticMap(spatial.definition), cost = spatialReadoutGraphCost([map], rate);
  if (await hashData(map, { maxBytes: 131072, maxNodes: 16384 }) !== spatial.mapHash || spatial.tailFrames !== cost.maximumTailFrames || source.tail.spatialTailBoundFrames !== cost.maximumTailFrames || native.spatial.groups.length !== 1 || native.spatial.groups[0].hash !== spatial.mapHash || native.spatial.groups[0].retirement !== null) fail();
  const pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer); let peak = 0, squares = 0, overFullScaleSamples = 0;
  for (let first = 0; first < frames; first += 16384) { signal?.throwIfAborted(); const end = Math.min(frames, first + 16384);
    for (let frame = first; frame < end; frame++) for (let channel = 0; channel < 2; channel++) { const value = planes[channel][frame]; if (!Number.isFinite(value)) fail(); view.setFloat32(frame * 8 + channel * 4, value, true); peak = Math.max(peak, Math.abs(value)); squares += value * value; if (Math.abs(value) > 1) overFullScaleSamples++; }
    await yieldControl();
  }
  const pcmHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pcm))].map(byte => byte.toString(16).padStart(2, '0')).join(''), completed = freezeData({ ...manifest, pcmHash, statistics: { peak, rms: Math.sqrt(squares / (frames * 2)), overFullScaleSamples } });
  signal?.throwIfAborted(); return { bytes: encodeCausalRenderWave(pcm, frames, rate, completed), manifest: completed };
}
