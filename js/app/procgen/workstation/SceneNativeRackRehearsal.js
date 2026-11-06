import { prepareSceneEffectRack } from './SceneEffectRack.js';
import { renderNativeOfflineGraph } from '../../midi-ui/NativeOfflineDriver.js';
import { OWNED_SOURCE_IDS } from '../../midi-ui/OwnedSourceProfiles.js';
import { createAudioResourceLeases } from '../../midi-ui/AudioResourceLeases.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { requireSynchronousResourceAcknowledgement } from '../../resources/ResourceRetirement.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { canonicalDataText, hashData } from '../../../core/CanonicalData.js';
import { effectGraphHash } from '../../../midi/content/EffectGraphRevision.js';

const fail = message => Object.assign(new Error(message), { code: 'scene-native-rack-unavailable' });
export function createSceneNativeRackRehearsal({ scene, rack, sourceHash, sceneHash, sampleRate, resourceBudget, jobs, signal, isCurrent = () => true, getMaterialProvider, OfflineAudioContext } = {}) {
  const effects = prepareSceneEffectRack(rack, sampleRate), reference = scene.patchRefs.find(row => OWNED_SOURCE_IDS.includes(row.reference.engineRequirement.engineId))?.reference;
  if (!effects.native || !reference || !resourceBudget) throw fail('The scene requires its exact native body graph and independently rendered source.');
  const resources = createAudioResourceLeases({ resourceBudget, ownerPrefix: 'scene-native-rack' }), scope = createProcgenRetirementScope();
  let preparation = null, workspace = null, native = null, input = null, unresolved = null, handed = false, retired = false;
  const check = () => { signal?.throwIfAborted(); if (retired || !isCurrent()) throw fail('The private native rack source changed.'); };
  const releaseInputs = () => {
    if (handed) return true;
    if (native) { requireSynchronousResourceAcknowledgement(native.release(), 'Native rack PCM reader release'); native = null; }
    input = null; handed = true; return true;
  };
  const retire = () => {
    retired = true;
    return scope.getReceipt() || scope.retire([{ name: 'native-rack-producer', run: async () => { try { await preparation; } catch { /* Preparation reports its own source failure. */ } if (unresolved) throw unresolved; } },
      { name: 'native-rack-storage', run: async () => { try { await preparation; } catch { /* Ownership is checked independently of successful rendering. */ } if (unresolved) throw unresolved; releaseInputs(); const receipt = resources.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('Native rack resource retirement remains unresolved.'); workspace?.release(); } }]);
  };
  return Object.freeze({
    prepare(source, workerReceipt) {
      if (preparation || retired) throw fail('A native rack source may be prepared exactly once.');
      preparation = (async () => {
        check(); const manifest = source?.manifest, count = source?.frames, bytes = count * 8;
        if (source?.schema !== 'lemmings-scene-rack-source-pcm/v1' || source.channels !== 2 || source.sampleRate !== sampleRate || !Number.isSafeInteger(count) || count < 1 || count > sampleRate * 11 ||
            !Array.isArray(source.planes) || source.planes.length !== 2 || source.planes.some(plane => !(plane instanceof Float32Array) || plane.length !== count) ||
            manifest?.schema !== 'lemmings-scene-rehearsal-render/v1' || manifest.sceneHash !== sceneHash || manifest.sourceHash !== sourceHash || manifest.applicationBuildId !== scene.sourceVersion.hash || manifest.frames !== count ||
            manifest.effects?.realization !== 'awaiting-native-offline-owner' || manifest.effects.graphHash !== await effectGraphHash(effects.plan) || manifest.effects.definitionHash !== await hashData(effects.rack.graph, { maxBytes: 65536, maxNodes: 8192 }) ||
            workerReceipt?.method !== 'dedicated-worker' || workerReceipt.kind !== 'render-scene-rehearsal' || workerReceipt.sourceRevision !== sourceHash || workerReceipt.executionIdentity?.activeExecution !== 'bound' || workerReceipt.executionIdentity.buildId !== scene.sourceVersion.hash)
          throw fail('Native rack input differs from the exact complete private-world source worker.');
        check(); workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'scene-native-rack:' + sceneHash, kind: 'mixed-source-native-rack-and-encoding-overlap', bytes: 32 * 1048576 + bytes * 6 + effects.plan.impulseDecodedBytes * 6 });
        native = await renderNativeOfflineGraph({ patch: reference.definition, events: [], frames: count, sampleRate, effectGraph: effects.rack.graph,
          sourcePcm: { frames: count, channels: 2, sampleRate, planes: source.planes, planeByteHashes: source.planeByteHashes, planeHashByteOrder: source.planeHashByteOrder, laneIds: [], sourceLaneIds: [] } },
        { resources, resourceBudget, signal, isCurrent, jobs, getMaterialProvider, OfflineAudioContext }); check();
        const sourcePcmProducer = { schema: 'lemmings-scene-rack-source-receipt/v1', frames: count, channels: 2, sampleRate, sourceHash, sceneHash, applicationBuildId: manifest.applicationBuildId,
          planeByteHashes: source.planeByteHashes.slice(), planeHashByteOrder: source.planeHashByteOrder,
          worker: { method: workerReceipt.method, kind: workerReceipt.kind, sourceRevision: workerReceipt.sourceRevision, executionIdentity: workerReceipt.executionIdentity } };
        input = { mode: 'scene-native-rack', manifest: { ...manifest, engineRequirement: reference.engineRequirement, sourcePcmProducer, nativeScheduling: native.receipt,
          effects: { ...manifest.effects, realization: 'native-offline-audio-context;worker-encoded-mixed-source', nativeLatencyMeasuredFrames: null, crossBrowserBitIdentity: false } },
        planes: Array.from({ length: 2 }, (_, channel) => native.buffer.getChannelData(channel)), firstFrame: 0, endFrame: count, stemLaneIds: [] };
        canonicalDataText(input.manifest, { maxBytes: 262144 }); source = null;
        return Object.freeze({ get input() { if (handed) throw fail('Native rack PCM has retired.'); return input; }, bytes, estimatedPeakBytes: 64 * 1048576 + bytes * 8 });
      })().catch(error => { if (error.retirement?.outcome && error.retirement.outcome !== 'complete') unresolved = error; throw error; });
      return preparation;
    }, releaseInputs, retire
  });
}
