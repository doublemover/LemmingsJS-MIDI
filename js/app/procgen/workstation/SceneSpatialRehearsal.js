import { hashData, canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { preparePrivateSpatialReadout } from '../../midi-ui/PrivateSpatialReadout.js';
import { prepareCausalNativeRenderInput } from '../../midi-ui/CausalNativeRender.js';
import { getNativeInstrumentCatalog } from '../../midi-ui/NativeInstrumentSchema.js';
import { createAudioResourceLeases } from '../../midi-ui/AudioResourceLeases.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { requireSynchronousResourceAcknowledgement } from '../../resources/ResourceRetirement.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { sceneStationRehearsalReceipt } from './SceneStationPolicy.js';

const fail = message => Object.assign(new Error('Private acoustic rehearsal: ' + message), { code: 'scene-spatial-rehearsal-unavailable' });
export function createSceneSpatialRehearsal({ scene, sceneHash, sourceHash, sampleRate, resourceBudget, jobs, signal, isCurrent = () => true, getMaterialProvider, OfflineAudioContext, getCatalog = getNativeInstrumentCatalog, prepareNative = prepareCausalNativeRenderInput } = {}) {
  const scope = createProcgenRetirementScope(), resources = createAudioResourceLeases({ resourceBudget, ownerPrefix: 'scene-spatial-rehearsal' });
  let preparation = null, native = null, workspace = null, input = null, retired = false, handed = false, unresolved = null;
  const check = () => { signal?.throwIfAborted(); if (retired || !isCurrent()) throw fail('The scene or private source changed.'); };
  const releaseInputs = () => { if (handed) return true; if (native) { requireSynchronousResourceAcknowledgement(native.release(), 'Private spatial PCM reader release'); native = null; } input = null; handed = true; return true; };
  const retire = () => { retired = true; return scope.getReceipt() || scope.retire([{ name: 'private-spatial-producer', run: async () => { try { await preparation; } catch {} if (unresolved) throw unresolved; } }, { name: 'private-spatial-resources', run: async () => { try { await preparation; } catch {} if (unresolved) throw unresolved; releaseInputs(); const receipt = resources.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('Native spatial resources retain unresolved ownership.'); workspace?.release(); } }]); };
  return Object.freeze({
    prepare(source) {
      if (preparation || retired) throw fail('A private spatial source may be prepared once.');
      preparation = (async () => {
        check(); if (!scene.causalMappings.acousticMap || scene.cost.sharedBodies || scene.cost.lanes > 4 || scene.patchRefs.some(row => row.reference.definition.engineId !== 'native-modal' || row.reference.definitionHash !== scene.patchRefs[0].reference.definitionHash) || scene.causalMappings.instruments.some(mapping => mapping.route !== 'local' || !mapping.spatialAttachment) || source.sceneHash !== sceneHash || source.initialTick !== 0 || source.durationSeconds <= 0 || source.durationSeconds > 6.1 || source.intents.length > 8192 || await hashData(scene, { maxBytes: 1048576, maxNodes: 65536 }) !== sceneHash || await hashData(source, { maxBytes: 8 * 1048576, maxNodes: 524288 }) !== sourceHash) throw fail('Use the complete bounded authored modal scene and actual independently observed prefix.');
        const catalog = await getCatalog(); check(); const reference = scene.patchRefs[0].reference, descriptor = catalog.descriptors.find(descriptor => descriptor.engineId === 'native-modal');
        if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity.buildId !== scene.sourceVersion.hash || !descriptor || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => descriptor[key] === reference.engineRequirement[key]) || descriptor.capabilities.worldSpatialControl !== true || descriptor.capabilities.sharedAcousticZoneSends !== true) throw fail('The exact spatial modal engine and source build must be installed.');
        workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'scene-spatial-rehearsal:' + sceneHash, kind: 'complete-private-world-spatial-and-material-plan', bytes: 48 * 1048576 });
        const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'scene-spatial:' + sceneHash, takeRevision: 1, sourceCanonicalHash: sourceHash, sourceState: 'finalized', coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { sourceTimeMs: source.sourceTimeMs, voices: [] } }, finalBoundaryState: { sourceTimeMs: source.sourceTimeMs + source.durationSeconds * 1000 }, sourceVersions: { applicationBuildId: scene.sourceVersion.hash, sceneHash, rehearsalSourceHash: sourceHash }, intents: source.intents },
          readout = await preparePrivateSpatialReadout({ revoice, spatial: source.spatial, scene, sampleRate, signal }); check();
        native = await prepareNative({ revoice: readout.source, definition: reference.definition, descriptor, applicationBuildId: scene.sourceVersion.hash, sampleRate, startSeconds: 0, endSeconds: source.durationSeconds, tail: { mode: 'boundary-release', maxSeconds: 8 }, stemLaneIds: [] }, { privateSpatialReadout: readout, resources, resourceBudget, jobs, signal, isCurrent, OfflineAudioContext, getMaterialProvider, maxWorkingBytes: 512 * 1048576 }); check();
        const payload = native.input, realization = payload?.manifest;
        if (!payload || payload.planes.length !== 2 || payload.firstFrame !== 0 || realization.tail.truncated || realization.privateSpatial.sourceHash !== readout.receipt.sourceHash || realization.intentHash !== readout.receipt.semanticIntentHash || realization.nativeScheduling.spatial?.mapHash !== source.spatial.mapHash) throw fail('The native producer omitted the complete original source, map or owned tail.');
        const frames = payload.endFrame, manifest = freezeData({ schema: 'lemmings-scene-rehearsal-render/v1', sceneHash, sourceHash, applicationBuildId: scene.sourceVersion.hash, recipeHash: scene.worldRecipeRef.hash, sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', frames, currentWorldAdvanced: false, nextWorldAdvanced: false, externalOutput: false, acousticReceipt: false,
          privateStations: sceneStationRehearsalReceipt(source.stations), ownedMaterial: null, spatial: { ...readout.receipt, mapHash: source.spatial.mapHash, definition: source.spatial.definition, sourceOnsets: source.intents.filter(intent => intent.kind === 'begin').length, sourcePrefixSeconds: source.durationSeconds, nativePreparation: 'completed-by-native-offline-owner;not-live-admission', tailFrames: realization.tail.spatialTailBoundFrames }, sourceRealization: realization, nativeScheduling: realization.nativeScheduling });
        canonicalDataText(manifest, { maxBytes: 262144, maxNodes: 32768 }); input = { mode: 'scene-native-spatial', manifest, planes: payload.planes, firstFrame: 0, endFrame: frames, stemLaneIds: [] };
        return Object.freeze({ get input() { if (handed) throw fail('Private spatial PCM retired.'); return input; }, bytes: frames * 8, estimatedPeakBytes: 64 * 1048576 + frames * 64 });
      })().catch(error => { if (error.retirement?.outcome && error.retirement.outcome !== 'complete') unresolved = error; throw error; });
      return preparation;
    }, releaseInputs, retire
  });
}
