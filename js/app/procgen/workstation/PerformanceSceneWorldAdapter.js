import { verifySceneMorphMechanism } from './SceneMorphMechanism.js';
import { sameActorBirthAbilities } from '../ActorBirthAbilities.js';
import { createMidiProject } from '../../../midi/project/MidiProject.js';
import { createProcgenWorkstationProject } from './ProcgenWorkstationProject.js';
import { verifyPerformanceSceneOrigin } from './PerformanceSceneRecipe.js';
import { resolveSoundContentReference } from '../../../midi/content/SoundContentReference.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { freezeData, canonicalDataText, hashData } from '../../../core/CanonicalData.js';
import { captureProcgenCheckpointCooperative } from './ProcgenCheckpoint.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'PerformanceSceneError', code });
export function createPerformanceSceneWorldAdapter({ getCatalog, getOrigin, prepareWorld, resourceBudget } = {}) {
  if (typeof getCatalog !== 'function' || typeof getOrigin !== 'function' || typeof prepareWorld !== 'function' || !resourceBudget) throw new TypeError('Scene world preparation needs the installed score, catalog and existing world budget owners.');
  return async ({ scene, preflight, baseIdentity, signal, isCurrent, onPhase = () => {} }) => {
    let world = null, workspace = null; const retirement = createProcgenRetirementScope(), rehearsalReads = new Set(), rehearsalLoans = new Set();
    const check = () => { signal?.throwIfAborted(); if (!isCurrent()) throw failure('stale-scene-operation', 'The scene candidate or document changed.'); };
    const retire = () => {
      if (retirement.getReceipt()) return retirement.getReceipt();
      const reads = [...rehearsalReads]; for (const read of reads) read.controller.abort(failure('scene-retired', 'The prepared scene retired during rehearsal capture.'));
      const worldRetirement = Promise.allSettled(reads.map(read => read.promise)).then(async () => { const receipt = world?.retire(); if (receipt?.completion) await receipt.completion; if (receipt && receipt.outcome !== 'complete') throw failure('scene-retirement-unknown', 'Prepared world retirement is unresolved.'); });
      return retirement.retire([{ name: 'prepared-world', run: () => worldRetirement },
        { name: 'scene-plan', run: async () => { await worldRetirement; if (rehearsalLoans.size) throw failure('scene-checkpoint-reader-unknown', 'A rehearsal checkpoint reader still owns its admitted snapshot.'); workspace?.release(); } }]);
    };
    try {
      check(); workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'performance-scene:' + preflight.sceneHash, kind: 'scene-plan', bytes: 2 * 1048576 });
      onPhase('world-source'); const catalog = await getCatalog(); check();
      if (catalog.state !== 'bound-application-engines' || catalog.executionIdentity?.buildId !== scene.sourceVersion.hash) throw failure('scene-source-unavailable', 'This scene requires its exact installed world and audio build.');
      const origin = await verifyPerformanceSceneOrigin(await getOrigin(scene, preflight.variants), { sourceHash: catalog.executionIdentity.buildId }); check();
      if (origin.sceneHash !== preflight.sceneHash || origin.variants.length || preflight.variants.length) throw failure('scene-variant-adapter-unavailable', 'This world adapter supports the authored original variant. A named replacement needs its own score materializer.');
      if (scene.causalMappings.instruments.some(instrument => instrument.route !== 'local' || instrument.sourceLanes?.some(lane => lane >= scene.cost.lanes))) throw failure('scene-routing-unavailable', 'This scene profile requires explicit local mappings into its declared physical lanes.');
      const source = origin.recipe, assets = preflight.dependencies.filter(entry => entry.status === 'available' && entry.dependency.kind === 'asset').map(entry => entry.dependency.hash), pools = new Map();
      onPhase('sound-compile');
      if (source.initialMorphMechanism) { if (scene.cost.sharedBodies !== 1) throw failure('scene-body-cost-unbound', 'The score must count its one shared paired body.'); await verifySceneMorphMechanism(source.initialMorphMechanism, scene.causalMappings.instruments); check(); }
      for (const patch of scene.patchRefs) {
        if (patch.reference.assetHashes.length) throw failure('scene-asset-adapter-unavailable', 'Sample-based scene loading needs an asset-pin preparation adapter; metadata availability alone is insufficient.');
        const resolved = await resolveSoundContentReference(patch.reference, { engineDescriptors: catalog.descriptors, availableHashes: assets, signal }); check();
        if (resolved.status !== 'ready') throw failure('scene-patch-unavailable', 'A required pinned scene patch cannot be realized by this build: ' + resolved.status);
        const key = patch.reference.engineRequirement.engineId, count = patch.reference.definition.voicePolicy.maxVoices; pools.set(key, (pools.get(key) || 0) + count);
      }
      if ([...pools.values()].reduce((sum, count) => sum + count, 0) > scene.cost.maximumVoices) throw failure('scene-source-capacity', 'The complete source set exceeds the declared scene voice bound.');
      for (const [engine, voices] of pools) if (voices > catalog.descriptors.find(value => value.engineId === engine).maximumVoices || voices > scene.cost.maximumVoices) throw failure('scene-source-capacity', 'The scene exceeds its shared source-pool or declared voice capacity.');
      const mix = new Map(scene.mix.map(value => [value.laneId, value]));
      const project = createProcgenWorkstationProject(createMidiProject(), { seed: scene.seed, ...(source.initialReleaseGesture ? { releaseGesture: source.initialReleaseGesture } : {}), ...(source.initialJunctions ? { junctions: source.initialJunctions } : {}), physicalGraph: scene.causalMappings, sceneOrigin: origin,
        lanes: scene.patchRefs.map((patch, index) => ({ id: patch.laneId, name: 'Corridor ' + (index + 1), mode: 'physical', family: source.terrainFamilies[index], worldThemeId: source.terrainFamilies[index], instrumentPatchId: patch.reference.patchId, instrumentRef: patch.reference, linkedThemePresetId: null,
          gain: mix.get(patch.laneId).gain, pan: mix.get(patch.laneId).pan, mute: mix.get(patch.laneId).mute, solo: mix.get(patch.laneId).solo })) });
      const recipe = freezeData({ project, settings: { ...source.settings, seed: scene.seed }, transport: scene.initialTransport, name: scene.title, origin, ...(source.actorBirthAbilities ? { actorBirthAbilities: source.actorBirthAbilities } : {}), ...(source.assistPolicy ? { assistPolicy: source.assistPolicy } : {}), ...(source.initialReleaseGesture ? { initialReleaseGesture: source.initialReleaseGesture } : {}), ...(source.initialTerrainLayout ? { initialTerrainLayout: source.initialTerrainLayout } : {}) });
      onPhase('world-assets'); world = await prepareWorld({ sceneRecipe: recipe, lease: { id: 'performance-scene:' + preflight.sceneHash, signal } }); check();
      if (!world || !world.isCurrent() || world.world.tickIndex !== 0 || world.world.seed !== scene.seed || world.world.laneCount !== scene.cost.lanes) throw failure('scene-world-unbound', 'The prepared score must be an unadvanced world with the exact seed and lane count.');
      if (source.assistPolicy && world.world.assists !== (source.assistPolicy === 'standard')) throw failure('scene-assist-policy-unbound', 'The initial world must own its declared manual or assisted physical policy.');
      if (source.initialJunctions && canonicalDataText(world.world.physicalJunctions?.definitions ?? null).text !== canonicalDataText(source.initialJunctions).text) throw failure('scene-junctions-unbound', 'Initial junction definitions must be present before the recovery anchor.');
      if (!sameActorBirthAbilities(source.actorBirthAbilities, world.world.actorBirthAbilities, scene.cost.lanes)) throw failure('scene-birth-abilities-unbound', 'The prepared world must own the exact authored birth abilities before its first actor.');
      if (source.initialReleaseGesture && (canonicalDataText(world.world.population.releaseGesture).text !== canonicalDataText(source.initialReleaseGesture).text || world.world.population.pendingReleaseGesture || world.world.population.gestureRun?.admitted !== 0 || world.world.population.gestureRun?.missed !== 0 || world.world.activeCount !== 0 || world.world.population.gestureRun?.remaining !== source.initialReleaseGesture.finiteBurstCount)) throw failure('scene-release-unbound', 'The prepared world must own the exact unspent initial release policy before rehearsal or publication.');
      if (source.initialTerrainLayout) { const receipt = world.world.terrain?.sourceReceipt?.(); if (canonicalDataText(world.world.terrain?.sceneTerrainLayout ?? null).text !== canonicalDataText(source.initialTerrainLayout).text || receipt?.status !== 'prepared' || receipt.method !== 'dedicated-worker' || receipt.activeExecution !== 'bound' || receipt.layoutHash !== await hashData(source.initialTerrainLayout)) throw failure('scene-source-geometry-unbound', 'The initial terrain requires its exact owned worker result before the first actor or recovery anchor.'); check(); }
      onPhase('world-geometry'); if (canonicalDataText(world.world.physicalAuthoring?.graph).text !== canonicalDataText(scene.causalMappings).text) throw failure('scene-mapping-unbound', 'The candidate recovery anchor must already own the exact prepared physical mapping.'); check(); onPhase('resource-admission');
      return Object.freeze({ sceneHash: preflight.sceneHash, variants: preflight.variants, baseIdentity, rehearsalRecipe: source,
        admission: freezeData({ status: 'admitted', world: true, sound: true, mapping: true, sourcePools: Object.fromEntries(pools), soundPreparation: 'pinned-definition-and-pool-preflight;audio-context-enable-remains-explicit' }),
        async borrowRehearsalCheckpoint({ signal: readSignal, isCurrent: readCurrent = () => true } = {}) {
          check(); readSignal?.throwIfAborted(); if (!world.isCurrent() || world.world.tickIndex !== 0 || rehearsalReads.size || rehearsalLoans.size || retirement.getReceipt()) throw failure('scene-preview-capacity', 'One unadvanced scene checkpoint reader may be owned at a time.');
          const read = { controller: new AbortController(), promise: null }, reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'scene-rehearsal:' + preflight.sceneHash, kind: 'cooperative-scene-checkpoint-copy-and-encoding-estimate', bytes: 64 * 1048576 });
          const abort = () => read.controller.abort(readSignal.reason); readSignal?.addEventListener('abort', abort, { once: true }); if (readSignal?.aborted) abort(); rehearsalReads.add(read);
          let released = false, checkpoint = null;
          const lease = Object.freeze({ sceneHash: preflight.sceneHash, sourceTick: 0, get checkpoint() { if (released || !checkpoint) throw failure('scene-preview-source-retired', 'The rehearsal checkpoint loan has retired.'); return checkpoint; },
            release() { if (released) return false; reservation.release(); released = true; checkpoint = null; rehearsalLoans.delete(lease); return true; } });
          read.promise = (async () => {
            try { checkpoint = await captureProcgenCheckpointCooperative(world.world, { signal: read.controller.signal, maxGraphBytes: 16 * 1048576, isCurrent: () => !retirement.getReceipt() && world.isCurrent() && world.world.tickIndex === 0 && readCurrent() });
              check(); read.controller.signal.throwIfAborted(); if (!readCurrent()) throw failure('stale-scene-preview', 'The rehearsal target changed during snapshot capture.'); rehearsalLoans.add(lease); return lease;
            } catch (error) { try { reservation.release(); released = true; checkpoint = null; } catch (releaseError) { rehearsalLoans.add({ reservation, checkpoint, error: releaseError }); error.retirementError = releaseError; } throw error; }
            finally { readSignal?.removeEventListener('abort', abort); rehearsalReads.delete(read); }
          })(); return read.promise;
        },
        commit({ isCurrent: fence, policy }) {
          check(); if (policy !== 'stopped-replacement' || !world.isCurrent() || rehearsalReads.size || rehearsalLoans.size) throw failure('scene-transition-unavailable', 'Prepare a current stopped-replacement candidate and retire its rehearsal readers.');
          world.commit({ isCurrent: () => { check(); return fence(); } });
          return freezeData({ schema: 'lemmings-performance-scene-transition/v1', status: 'committed', sceneHash: preflight.sceneHash, baseIdentity, policy,
            transportPlaying: false, externalOutputEnabledByScene: false, recordingArmedByScene: false, localAudioEnabledByScene: false, sourcePools: Object.fromEntries(pools) });
        }, retire });
    } catch (error) { const receipt = retire(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
  };
}
