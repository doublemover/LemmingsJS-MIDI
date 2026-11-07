import { createSceneSpatialObservation } from './SceneSpatialObservation.js';
import { createSceneSpatialRehearsal } from './SceneSpatialRehearsal.js';
import { sceneSympatheticBodyModel } from './SceneSympatheticBody.js';
import { scenePreparedSurfaceRehearsalProfile, prepareScenePreparedSurfaceRehearsal } from './ScenePreparedSurfaceRehearsal.js';
import { sceneCavityRehearsalProfile, createSceneCavityRehearsalObservation, prepareSceneCavityRehearsal } from './SceneCavityRehearsal.js';
import { prepareSceneOwnedRehearsalMaterial } from './SceneOwnedRehearsalMaterial.js';
import { sceneStationRehearsalReceipt } from './SceneStationPolicy.js';
import { requireSynchronousResourceAcknowledgement } from '../../resources/ResourceRetirement.js';
import { createSceneStationRehearsal } from './SceneStationRehearsal.js';
import { prepareSceneNativeRehearsal } from './SceneNativeRehearsal.js';
import { prepareSceneEffectRack, sceneEffectSourceBindings } from './SceneEffectRack.js';
import { createSceneNativeRackRehearsal } from './SceneNativeRackRehearsal.js';
import { validateNativeEffectRenderReceipt } from '../../midi-ui/EffectRenderPlan.js';
import { prepareEffectGraphRevision, effectGraphHash } from '../../../midi/content/EffectGraphRevision.js';
import { createSceneMorphActorMotion } from './SceneMorphActorMotion.js';
import { sceneMorphMechanismCost } from './SceneMorphMechanism.js';
import { hashData, freezeData, canonicalDataText } from '../../../core/CanonicalData.js';
import { restoreProcgenCheckpoint } from './ProcgenCheckpoint.js';
import { createCausalMusicEngine } from './CausalMusicEngine.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'PerformanceSceneError', code });
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const retire = async (owner, method) => { if (!owner) return; const receipt = await owner[method](); await receipt?.completion; if (receipt?.outcome !== 'complete') throw failure('scene-rehearsal-retirement-unknown', 'Rehearsal ownership has not confirmed retirement.'); };

export function createPerformanceSceneRehearsal({ audio, prepareInspectionWorld, jobs, resourceBudget } = {}) {
  if (!audio?.acquireAudition || !audio?.createSession || typeof prepareInspectionWorld !== 'function' || !jobs?.compute || !resourceBudget) throw new TypeError('Scene rehearsal requires independent inspection, worker, cue and resource owners.');
  return async ({ candidate, scene, preflight, signal, isCurrent, authoredStations = false }) => {
    if (typeof authoredStations !== 'boolean') throw failure('scene-station-policy-unavailable', 'Choose an explicit private station policy.');
    const cavityProfile = candidate?.rehearsalRecipe?.initialCavityBody ? sceneCavityRehearsalProfile(candidate.rehearsalRecipe.initialCavityBody, scene) : null;
    const surfaceProfile = candidate?.rehearsalRecipe?.initialPreparedSurface ? scenePreparedSurfaceRehearsalProfile(candidate.rehearsalRecipe.initialPreparedSurface, scene) : null;
    const networkProfile = candidate?.rehearsalRecipe?.initialSympatheticBody ? sceneSympatheticBodyModel(candidate.rehearsalRecipe.initialSympatheticBody) : null;
    const bodyCost = networkProfile || surfaceProfile || cavityProfile || (candidate?.rehearsalRecipe?.initialMorphMechanism ? sceneMorphMechanismCost(candidate.rehearsalRecipe.initialMorphMechanism) : null);
    if (!candidate?.borrowRehearsalCheckpoint || scene.cost.lanes > 8 || (scene.cost.sharedBodies !== 0 && (!bodyCost || scene.cost.sharedBodies !== (cavityProfile ? cavityProfile.retainedBodies : bodyCost.bodyCount))) || scene.causalMappings.instruments.some(value => value.route !== (surfaceProfile?.finite ? 'prepared-body' : 'local'))) throw failure('scene-rehearsal-profile-unavailable', 'Rehearsal needs up to eight exact local lanes and its complete authored shared-body profile.');
    const context = audio.getAudioContext(), monitor = audio.getMonitorRouteState();
    if (!audio.getState().enabled || context?.state !== 'running' || !['rehearsal', 'separate-device'].includes(monitor.mode) || !['ready', 'playing-route'].includes(monitor.state)) throw failure('scene-rehearsal-cue-unavailable', 'Enable browser audio and choose an explicit Prelisten route before preparing a rehearsal.');
    const controller = new AbortController(), scope = createProcgenRetirementScope(); let loan = null, clone = null, engine = null, listener = null, job = null, cue = null, session = null, audition = null, workspace = null, workerFault = null, ready = false, fenceTimer = null, nativeSources = null, nativeInputHanded = false, ownedSources = null, ownedInputHanded = false, upstreamRetirement = null, stationController = null, worldCleanup = null, cavityWorkspace = null, nativeRack = null, nativeRackPreparation = null;
    const abort = () => controller.abort(signal.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const check = () => { controller.signal.throwIfAborted(); if (!isCurrent() || audio.getAudioContext() !== context || context.state !== 'running' || audio.getMonitorRouteState().revision !== monitor.revision || audition && !audition.isCurrent()) throw failure('stale-scene-rehearsal', 'The scene, private monitor route or audio clock changed.'); };
    const releaseJob = async () => {
      if (nativeRackPreparation) { try { await nativeRackPreparation; } catch { /* The native owner retains any unresolved preparation custody. */ } }
      if (workerFault) throw workerFault; if (!job) return; job.release(); const state = job.retirementState();
      if (!['released', 'canceled'].includes(state.phase)) throw failure('scene-rehearsal-worker-unknown', 'The rehearsal worker still owns its admitted result.'); job = null;
    };
    const cleanupWorld = async () => {
      if (!worldCleanup) {
        const ownedListener = listener, ownedClone = clone, ownedEngine = engine, ownedStations = stationController, ownedLoan = loan;
        const detached = Promise.resolve().then(() => { if (ownedListener && ownedClone) ownedClone.world.soundEvents.onBatch.off(ownedListener); listener = null; });
        const stationStopped = detached.then(async () => { if (ownedStations) { const receipt = ownedStations.retire(); await receipt.completion; if (receipt.outcome !== 'complete') throw failure('scene-station-retirement-unknown', 'The private work stations retain unresolved ownership.'); } stationController = null; });
        const engineStopped = detached.then(() => { ownedEngine?.dispose(); engine = null; });
        worldCleanup = createProcgenRetirementScope().retire([{ name: 'private-world-listener', run: () => detached }, { name: 'private-station-controller', run: () => stationStopped }, { name: 'private-interpretation', run: () => engineStopped },
          { name: 'private-world', run: async () => { await Promise.all([stationStopped, engineStopped]); if (ownedClone) await retire(ownedClone, 'dispose'); clone = null; } },
          { name: 'private-checkpoint-reader', run: () => { if (ownedLoan) requireSynchronousResourceAcknowledgement(ownedLoan.release(), 'Private checkpoint reader release'); loan = null; } }]);
      }
      await worldCleanup.completion; if (worldCleanup.outcome !== 'complete') throw failure('scene-private-world-retirement-unknown', 'Private source owners retain unresolved ownership.');
    };
    const close = () => {
      if (scope.getReceipt()) return scope.getReceipt(); ready = false; clearInterval(fenceTimer); fenceTimer = null; controller.abort(failure('scene-rehearsal-stopped', 'The rehearsal stopped.'));
      const dependencies = createProcgenRetirementScope().retire([
        { name: 'private-physical-world', run: cleanupWorld }, { name: 'native-private-sources', run: async () => { if (!nativeInputHanded) await releaseJob(); if (nativeSources) { const receipt = nativeSources.retire(); await receipt.completion; if (receipt.outcome !== 'complete') throw failure('scene-native-retirement-unknown', 'Native private sources retain unresolved ownership.'); nativeSources = null; } } }, { name: 'owned-private-material', run: async () => { if (!ownedInputHanded) await releaseJob(); if (ownedSources) { const receipt = ownedSources.retire(); await receipt.completion; if (receipt.outcome !== 'complete') throw failure('scene-owned-material-retirement-unknown', 'Owned private material retains unresolved ownership.'); } } }, { name: 'rehearsal-render-worker', run: releaseJob }, { name: 'native-scene-rack', run: async () => { await releaseJob(); if (nativeRack) { const receipt = nativeRack.retire(); await receipt.completion; if (receipt.outcome !== 'complete') throw failure('scene-native-rack-retirement-unknown', 'The private convolution rack retains unresolved producer ownership.'); } } },
        { name: 'upstream-retirement', run: () => { if (upstreamRetirement) throw failure('scene-rehearsal-retirement-unknown', 'A preparation source retains unresolved producer ownership.'); } }, { name: 'owned-pcm-cue', run: () => cue?.dispose() }, { name: 'cue-session', run: () => session?.dispose() }
      ]);
      const receipt = scope.retire([{ name: 'rehearsal-producers', run: () => dependencies }, { name: 'rehearsal-storage', run: async () => { await dependencies.completion; if (dependencies.outcome !== 'complete') throw failure('scene-rehearsal-retirement-unknown', 'Rehearsal producers have unresolved ownership.'); workspace?.release(); cavityWorkspace?.release(); } }]);
      receipt.completion.then(value => { signal?.removeEventListener('abort', abort); audition?.close(value); }); return receipt;
    };
    controller.signal.addEventListener('abort', () => { if (ready) close(); }, { once: true });
    try {
      check(); workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'scene-rehearsal:' + preflight.sceneHash, kind: 'bounded-physical-intents-and-worker-result', bytes: 16 * 1048576 });
      if (cavityProfile) cavityWorkspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'scene-cavity-rehearsal:' + preflight.sceneHash, kind: 'bounded-observed-geometry-and-compile-staging', bytes: 16 * 1048576 });
      audition = await audio.acquireAudition({ source: { name: scene.title, kind: 'isolated-scene-rehearsal', revision: preflight.sceneHash, sourceRef: preflight.sceneHash }, routeRevision: monitor.revision, signal: controller.signal,
        onStop: reason => controller.abort(failure('scene-rehearsal-stopped', reason)) }); check();
      session = audio.createSession('performance-scene-rehearsal', { workloadClass: 'cue' });
      if (!session || !await session.enable()) throw failure('scene-rehearsal-cue-unavailable', 'The selected cue route or reserved playback quota is unavailable.'); check();
      loan = await candidate.borrowRehearsalCheckpoint({ signal: controller.signal, isCurrent }); check();
      clone = await prepareInspectionWorld({ checkpoint: loan.checkpoint, signal: controller.signal }); check();
      if (!clone?.world || clone.world.tickIndex !== 0) throw failure('scene-rehearsal-world-unavailable', 'Rehearsal requires an independently owned unadvanced inspection world.');
      restoreProcgenCheckpoint(clone.world, loan.checkpoint); check(); requireSynchronousResourceAcknowledgement(loan.release(), 'Private checkpoint reader release'); loan = null;
      const bodyMotionOwner = candidate.rehearsalRecipe?.initialMorphMechanism?.controlSource ? createSceneMorphActorMotion({ instrumentId: candidate.rehearsalRecipe.initialMorphMechanism.instrumentId }) : null, bodyMotionControls = [];
      const world = clone.world, origin = world.simulationTimeMs, spatialObservation = scene.causalMappings.acousticMap ? await createSceneSpatialObservation({ scene, world, signal: controller.signal }) : null, intents = [], preparedCommands = [], cavityObservation = cavityProfile ? createSceneCavityRehearsalObservation(cavityProfile) : null; let callbackError = null, batches = 0, last = null, admittedBytes = 0;
      engine = createCausalMusicEngine({ world, resourceBudget, getGraph: () => scene.causalMappings, traceLimit: 0, maxVoices: scene.cost.maximumVoices, maxBeginsPerBatch: Math.min(512, scene.cost.maximumVoices), deliver: surfaceProfile ? (_intents, _batch, commands) => { if (preparedCommands.length + commands.length > 8192) throw failure('scene-surface-command-capacity', 'The private prefix exceeds its complete preparation bound.'); admittedBytes += canonicalDataText(commands, { maxBytes: 1048576, maxNodes: 65536 }).bytes.length; if (admittedBytes > 4 * 1048576) throw failure('scene-surface-command-capacity', 'The private mapped stream exceeds its admitted source storage.'); preparedCommands.push(...commands); } : undefined });
      if (authoredStations) stationController = await createSceneStationRehearsal({ scene, sceneHash: preflight.sceneHash, world, resourceBudget }); check();
      listener = batch => { try { check(); if (++batches > 512 || batch.completeness.status !== 'complete' || batch.completeness.dropped || batch.worldId !== world.worldId || batch.generation !== world.generation) throw failure('scene-rehearsal-source-incomplete', 'The private source could not retain complete bounded physical facts.');
        if (surfaceProfile && (batch.terrainRevisionAfter ?? batch.snapshot?.terrainRevision) !== surfaceProfile.surface.surfaceMap.boundTopologyRevision) throw failure('scene-surface-map-unavailable', 'The private prefix requires the unchanged authored map topology.');
        cavityObservation?.observe(batch); const values = engine.processBatch(batch); spatialObservation?.observe(batch, values); if (bodyMotionOwner) { const controls = bodyMotionOwner.consume(batch, values); if (bodyMotionControls.length + controls.length > 8192) throw failure('scene-body-control-capacity', 'The complete private body control stream exceeds its bound.'); admittedBytes += canonicalDataText(controls).bytes.length; bodyMotionControls.push(...controls); } if (intents.length + values.length > 8192) throw failure('scene-rehearsal-source-capacity', 'The rehearsal exceeds its bounded intent history.');
        admittedBytes += canonicalDataText(values, { maxBytes: 1048576, maxNodes: 65536 }).bytes.length; if (admittedBytes > 4 * 1048576) throw failure('scene-rehearsal-source-capacity', 'The rehearsal exceeds its admitted source representation.');
        intents.push(...values); last = batch; stationController?.observe(batch, engine.physicalAnalysis());
      } catch (error) { callbackError ||= error; } };
      world.soundEvents.onBatch.on(listener);
      for (let tick = 0; tick < 512 && world.simulationTimeMs - origin < 6000; tick++) { check(); const before = batches; world.step(); if (callbackError) throw callbackError;
        if (batches !== before + 1 || !last || world._failedTick) throw failure('scene-rehearsal-source-incomplete', 'Every rehearsal tick must produce one complete observed batch.'); if (tick % 4 === 3) await yieldTask(); }
      check(); const health = engine.diagnostics(); if (!last || health.recoveryRequired || health.deliveryErrors || health.rejectedBegins) throw failure('scene-rehearsal-source-incomplete', 'The private interpretation did not cover every source onset.');
      const source = freezeData({ schema: 'lemmings-scene-rehearsal-source/v1', sceneHash: preflight.sceneHash, initialTick: 0, ticks: batches, sourceTimeMs: origin,
        durationSeconds: (last.sourceTimeMs + last.tickDurationMs - origin) / 1000, worldId: world.worldId, generation: world.generation, seed: world.seed, intents, ...(bodyMotionOwner ? { bodyMotion: { schema: 'lemmings-private-scene-body-motion/v1', controls: bodyMotionControls, owner: bodyMotionOwner.snapshot(), historicalPerformanceEvidence: false } } : {}), ...(spatialObservation ? { spatial: spatialObservation.snapshot() } : {}), ...(surfaceProfile ? { preparedSurface: { schema: 'lemmings-private-prepared-surface/v1', policy: 'complete-invariant-map;actual-mapped-commands', commands: preparedCommands } } : {}), ...(cavityObservation ? { cavity: cavityObservation.snapshot() } : {}), ...(stationController ? { stations: stationController.metadata() } : {}) });
      const expectedNetwork = networkProfile ? sceneSympatheticBodyModel(networkProfile.mechanism, context.sampleRate) : null;
      const expectedSurface = surfaceProfile ? await prepareScenePreparedSurfaceRehearsal({ scene, mechanism: surfaceProfile.mechanism, source, sampleRate: context.sampleRate, signal: controller.signal, yieldControl: yieldTask }) : null; check();
      const expectedCavity = cavityProfile ? await prepareSceneCavityRehearsal({ scene, mechanism: cavityProfile.mechanism, source, sampleRate: context.sampleRate }) : null; check();
      const sourceHash = await hashData(source, { maxBytes: 8 * 1048576, maxNodes: 524288 }); check(); await cleanupWorld(); check();
      const rack = candidate.rehearsalRecipe?.initialEffectRack, effectPlan = rack ? prepareSceneEffectRack(rack, context.sampleRate) : null;
      let result = null, ownedReceipts = null;
      if (spatialObservation) {
        if (scene.cost.sharedBodies || candidate.rehearsalRecipe?.initialEffectRack) throw failure('scene-spatial-profile-unavailable', 'Private acoustic rehearsal owns its exact shared zone returns; separate body/rack compositions need their complete combined profile.');
        nativeRack = createSceneSpatialRehearsal({ scene, sceneHash: preflight.sceneHash, sourceHash, sampleRate: context.sampleRate, resourceBudget, jobs, signal: controller.signal, isCurrent, getMaterialProvider: typeof audio.getSoundMaterialProvider === 'function' ? () => audio.getSoundMaterialProvider() : null });
        nativeRackPreparation = nativeRack.prepare(source); const rendered = await nativeRackPreparation; check(); const payload = rendered.input, inputBytes = rendered.bytes + canonicalDataText(payload.manifest, { maxBytes: 262144, maxNodes: 32768 }).bytes.length;
        job = await jobs.compute({ kind: 'encode-native-render', ownerId: 'performance-scene-native-spatial', ownerEpoch: 0, sourceRevision: sourceHash, signal: controller.signal, isCurrent, inputBytes, maxBytes: Math.max(inputBytes, 16 * 1048576), estimatedPeakBytes: rendered.estimatedPeakBytes, deadlineMs: 120000, budgetAdapter: resourceBudget, prepareInput: () => payload, releasePreparedInput: () => { nativeRack.releaseInputs(); payload.planes = null; return true; } }); check(); result = job.value;
      } else {

        ownedSources = await prepareSceneOwnedRehearsalMaterial({ scene, resourceBudget, signal: controller.signal, isCurrent, getMaterialProvider: typeof audio.getSoundMaterialProvider === 'function' ? () => audio.getSoundMaterialProvider() : null }); check();
        nativeSources = await prepareSceneNativeRehearsal({ scene, source, sourceHash, sampleRate: context.sampleRate, resourceBudget, jobs, signal: controller.signal, isCurrent }); check();
        ownedReceipts = ownedSources?.receipts();
        const nativeLanes = nativeSources?.inputs(), ownedLanes = ownedSources?.inputs(), input = { scene, sceneHash: preflight.sceneHash, source, sampleRate: context.sampleRate, ...(scene.cost.sharedBodies || rack ? { recipe: candidate.rehearsalRecipe } : {}), ...(nativeLanes ? { nativeLanes } : {}), ...(ownedLanes ? { ownedLanes } : {}) };
        const metadata = { ...input, ...(nativeLanes ? { nativeLanes: nativeLanes.map(row => ({ sourceIndex: row.sourceIndex, input: { ...row.input, planes: null } })) } : {}), ...(ownedLanes ? { ownedLanes: ownedSources.metadata() } : {}) }, inputBytes = canonicalDataText(metadata, { maxBytes: 8 * 1048576, maxNodes: 524288 }).bytes.length + (nativeSources?.bytes || 0) + (ownedSources?.bytes || 0);

        job = await jobs.compute({ kind: 'render-scene-rehearsal', ownerId: 'performance-scene-rehearsal', ownerEpoch: 0, sourceRevision: sourceHash, signal: controller.signal, isCurrent,
          inputBytes, maxBytes: Math.max(inputBytes, 16 * 1048576), estimatedPeakBytes: 128 * 1048576 + (nativeSources?.bytes || 0) * 3 + (ownedSources?.bytes || 0) * 6, deadlineMs: 120000, budgetAdapter: resourceBudget, prepareInput: () => input, releasePreparedInput: () => { if (nativeSources) { nativeSources.releaseInputs(); nativeInputHanded = true; input.nativeLanes = null; for (const row of nativeLanes) row.input = null; } if (ownedSources) { ownedSources.releaseInputs(); ownedInputHanded = true; input.ownedLanes = null; for (const row of ownedLanes) row.pcm = null; } return true; } }); check();
        result = job.value;
        if (effectPlan?.native) {
          nativeRack = createSceneNativeRackRehearsal({ scene, rack, sourceHash, sceneHash: preflight.sceneHash, sampleRate: context.sampleRate, resourceBudget, jobs, signal: controller.signal, isCurrent,
            getMaterialProvider: typeof audio.getSoundMaterialProvider === 'function' ? () => audio.getSoundMaterialProvider() : null });
          nativeRackPreparation = nativeRack.prepare(result, job.receipt);
          const rendered = await nativeRackPreparation; check(); await releaseJob(); check(); result = null;
          const payload = rendered.input, inputBytes = rendered.bytes + canonicalDataText(payload.manifest, { maxBytes: 262144 }).bytes.length;
          job = await jobs.compute({ kind: 'encode-native-render', ownerId: 'performance-scene-native-rack', ownerEpoch: 0, sourceRevision: sourceHash, signal: controller.signal, isCurrent,
            inputBytes, maxBytes: Math.max(inputBytes, 16 * 1048576), estimatedPeakBytes: rendered.estimatedPeakBytes, deadlineMs: 120000, budgetAdapter: resourceBudget,
            prepareInput: () => payload, releasePreparedInput: () => { nativeRack.releaseInputs(); payload.planes = null; return true; } }); check(); result = job.value;
        }
      }
      if (!(result?.bytes instanceof Uint8Array) || result.bytes.byteLength > 16 * 1048576 || result.manifest?.sourceHash !== sourceHash || result.manifest.sceneHash !== preflight.sceneHash || result.manifest.applicationBuildId !== scene.sourceVersion.hash || result.manifest.currentWorldAdvanced !== false || result.manifest.nextWorldAdvanced !== false || result.manifest.externalOutput !== false || scene.cost.sharedBodies && !cavityProfile && !surfaceProfile && !networkProfile && (result.manifest.recipeHash !== scene.worldRecipeRef.hash || result.manifest.body?.mapHash !== candidate.rehearsalRecipe.initialMorphMechanism.map.hash || result.manifest.body?.semanticOnsetsAdded !== 0 || result.manifest.body?.faults !== 0 || result.manifest.body?.bodyCount !== scene.cost.sharedBodies || result.manifest.body?.strategy !== bodyCost.strategy || result.manifest.body?.modeCount !== bodyCost.modeCount)) throw failure('scene-rehearsal-render-unbound', 'The worker rehearsal differs from its admitted scene and physical source.');
      if (spatialObservation && (result.manifest.spatial?.sourceHash !== result.manifest.sourceRealization?.privateSpatial?.sourceHash || result.manifest.spatial?.mapHash !== source.spatial.mapHash || result.manifest.spatial?.sourceOnsets !== source.intents.filter(intent => intent.kind === 'begin').length || result.manifest.spatial?.semanticIntentHash !== await hashData(source.intents, { maxBytes: 8 * 1048576, maxNodes: 1000000 }) || result.manifest.spatial?.semanticOnsetsAdded !== 0 || result.manifest.spatial?.historicalPerformanceEvidence !== false || result.manifest.nativeScheduling?.spatial?.mapHash !== source.spatial.mapHash)) throw failure('scene-spatial-rehearsal-unbound', 'Private acoustic output differs from its actual physical source, exact map or whole shared native graph.');
      if (bodyMotionOwner && (result.manifest.body?.controlSource !== candidate.rehearsalRecipe.initialMorphMechanism.controlSource || result.manifest.body?.bodyMotionHash !== await hashData(source.bodyMotion, { maxBytes: 4 * 1048576, maxNodes: 262144 }) || result.manifest.body?.sourceActorId !== source.bodyMotion.owner.source?.actorId)) throw failure('scene-body-motion-render-unbound', 'The private output omitted its exact observed actor-control stream.');
      if (expectedNetwork) {
        const body = result.manifest.body, graphHash = await effectGraphHash(expectedNetwork.plan), mapHash = await hashData(expectedNetwork.mechanism); check();
        if (result.manifest.recipeHash !== scene.worldRecipeRef.hash || body?.kind !== 'anchored-sympathetic-network' || body.strategy !== expectedNetwork.strategy || body.bodyCount !== expectedNetwork.bodyCount || body.modeCount !== expectedNetwork.modeCount || body.graphHash !== graphHash || body.mapHash !== mapHash || body.rootBody !== expectedNetwork.mechanism.rootBody || body.sourceOnsets !== source.intents.filter(intent => intent.kind === 'begin').length || body.semanticOnsetsAdded !== 0 || body.faults !== 0 || body.tailFrames !== expectedNetwork.plan.maximumTailFrames || canonicalDataText(body.anchors).text !== canonicalDataText(expectedNetwork.mechanism.anchors).text || canonicalDataText(body.sourceInstrumentIds ?? null).text !== canonicalDataText(expectedNetwork.mechanism.sourceInstrumentIds ?? null).text || canonicalDataText(body.bodySourceRoutes ?? null).text !== canonicalDataText(expectedNetwork.mechanism.bodySourceRoutes ?? null).text || canonicalDataText(body.sourceBindings).text !== canonicalDataText(sceneEffectSourceBindings(expectedNetwork, scene.patchRefs.map(row => row.laneId))).text) throw failure('scene-network-rehearsal-unbound', 'The private network differs from its exact physical root exciters, anchors or processing graph.');
      }
      if (expectedSurface) {
        const body = result.manifest.body;
        if (result.manifest.recipeHash !== scene.worldRecipeRef.hash || body?.kind !== 'observed-prepared-surface' || body.strategy !== surfaceProfile.strategy || body.bodyCount !== 1 || body.modeCount !== surfaceProfile.modeCount || body.graphHash !== expectedSurface.graphHash || body.bodyInstanceId !== expectedSurface.body.bodyInstanceId || body.scheduleHash !== expectedSurface.scheduleHash || body.sourceOnsets !== expectedSurface.sourceOnsets || body.preparationCommands !== preparedCommands.length || body.finiteStrikes !== (surfaceProfile.finite ? expectedSurface.sourceOnsets : 0) || body.semanticOnsetsAdded !== 0 || body.faults !== 0 || body.tailFrames !== expectedSurface.plan.maximumTailFrames || body.applicationEvidence !== 'exact-frame-owned-offline-kernel;not-live-processor-acknowledgement') throw failure('scene-surface-rehearsal-unbound', 'The private shared surface differs from its exact contact/control trace, map or body.');
      }
      if (expectedCavity) {
        const body = result.manifest.body, model = expectedCavity.model, graphHash = await effectGraphHash(prepareEffectGraphRevision(model.graph, { sampleRate: context.sampleRate })); check();
        if (result.manifest.recipeHash !== scene.worldRecipeRef.hash || body?.kind !== 'authored-cavity' || body.strategy !== cavityProfile.strategy || body.bodyCount !== cavityProfile.bodyCount || body.retainedBodiesDeclared !== cavityProfile.retainedBodies || body.modeCount !== cavityProfile.modeCount || body.bodyIdentityHash !== model.bodyIdentityHash || body.geometryHash !== expectedCavity.geometryHash || body.graphHash !== graphHash || body.sourceOnsets !== expectedCavity.sourceOnsets || body.semanticOnsetsAdded !== 0 || body.faults !== 0 || body.tailFrames !== model.cost.maximumTailFrames) throw failure('scene-cavity-rehearsal-unbound', 'The private cavity render differs from its actual geometry, complete source causes or authored modal body.');
      }
      if (effectPlan && (result.manifest.effects?.latencyFrames !== effectPlan.plan.latencyFrames || result.manifest.effects?.latencyPolicy !== effectPlan.rack.graph.latencyPolicy || result.manifest.recipeHash !== scene.worldRecipeRef.hash || result.manifest.effects?.definitionHash !== await hashData(effectPlan.rack.graph, { maxBytes: 65536, maxNodes: 8192 }) || result.manifest.effects.graphHash !== await effectGraphHash(effectPlan.plan) || result.manifest.effects.semanticOnsetsAdded !== 0 || result.manifest.effects.controls !== 'authored-static-defaults;no-replayed-throw-gestures' || result.manifest.effects.tailFrames !== effectPlan.previewTailFrames || result.manifest.effects.declaredMaximumTailFrames !== effectPlan.plan.maximumTailFrames || result.manifest.effects.tailTruncatedByPreviewBound !== (effectPlan.previewTailFrames < effectPlan.plan.maximumTailFrames))) throw failure('scene-rack-rehearsal-unbound', 'The private rack render differs from its authored graph, processing identity or explicitly bounded preview tail.');
      if (effectPlan?.cross && (canonicalDataText(result.manifest.effects?.sourceBindings).text !== canonicalDataText(sceneEffectSourceBindings(effectPlan, scene.patchRefs.map(row => row.laneId))).text || result.manifest.effects?.realization?.graphScope !== 'one-full-shared-owner-sum' || result.manifest.effects.realization.hash !== result.manifest.effects.graphHash)) throw failure('scene-cross-source-unbound', 'The private interaction omitted its exact donor/carrier lane taps or shared executing graph.');
      if (effectPlan?.native) { if (result.manifest.effects?.realization !== 'native-offline-audio-context;worker-encoded-mixed-source' || result.manifest.sourcePcmProducer?.sourceHash !== sourceHash) throw failure('scene-native-rack-render-unbound', 'The native rack omitted its exact private source identity.'); validateNativeEffectRenderReceipt(effectPlan.plan, result.manifest.nativeScheduling, result.manifest.effects.graphHash, []); }
      if (canonicalDataText(result.manifest.privateStations ?? null).text !== canonicalDataText(sceneStationRehearsalReceipt(source.stations)).text) throw failure('scene-station-rehearsal-unbound', 'The private station source/result counts differ from their explicit rehearsal ledger.');
      if (canonicalDataText(result.manifest.ownedMaterial ?? null).text !== canonicalDataText(ownedReceipts ?? null).text) throw failure('scene-owned-material-render-unbound', 'The private render omitted or replaced its exact prepared source/ancestry receipts.');
      const manifest = freezeData(result.manifest); cue = await session.preparePcmCue({ bytes: result.bytes, manifest, signal: controller.signal, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check(); await releaseJob(); check();
      audition.markReady(); const playback = cue.play(); check(); audition.markPlaying(); ready = true;
      cue.completion.then(() => close()); fenceTimer = setInterval(() => { try { check(); } catch (error) { controller.abort(error); } }, 50);
      return Object.freeze({ routing: 'isolated-local', externalOutput: false, manifest, playback, monitorRoute: monitor, completion: cue.completion.then(() => close().completion), state: () => Object.freeze({ playing: ready && !scope.getReceipt(), retirement: scope.getReceipt()?.outcome || null }), retire: close });
    } catch (error) {
      if (error.retirement && error.retirement.outcome !== 'complete') upstreamRetirement = error.retirement;
      if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
      if (error.backgroundRetirement && !['released', 'canceled'].includes(error.backgroundRetirement.phase)) workerFault = error;
      const receipt = close(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error;
    }
  };
}
