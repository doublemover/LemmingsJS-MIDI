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
  return async ({ candidate, scene, preflight, signal, isCurrent }) => {
    if (!candidate?.borrowRehearsalCheckpoint || scene.cost.lanes > 8 || (scene.cost.sharedBodies !== 0 && (!candidate.rehearsalRecipe?.initialMorphMechanism || scene.cost.sharedBodies !== sceneMorphMechanismCost(candidate.rehearsalRecipe.initialMorphMechanism).bodyCount)) || scene.patchRefs.some(row => row.reference.assetHashes.length) || scene.causalMappings.instruments.some(value => value.route !== 'local')) throw failure('scene-rehearsal-profile-unavailable', 'Rehearsal supports up to eight local assetless lanes and the exact authored paired or two-endpoint body route profile.');
    const bodyCost = scene.cost.sharedBodies ? sceneMorphMechanismCost(candidate.rehearsalRecipe.initialMorphMechanism) : null;
    const context = audio.getAudioContext(), monitor = audio.getMonitorRouteState();
    if (!audio.getState().enabled || context?.state !== 'running' || !['rehearsal', 'separate-device'].includes(monitor.mode) || !['ready', 'playing-route'].includes(monitor.state)) throw failure('scene-rehearsal-cue-unavailable', 'Enable browser audio and choose an explicit Prelisten route before preparing a rehearsal.');
    const controller = new AbortController(), scope = createProcgenRetirementScope(); let loan = null, clone = null, engine = null, listener = null, job = null, cue = null, session = null, audition = null, workspace = null, workerFault = null, ready = false, fenceTimer = null;
    const abort = () => controller.abort(signal.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const check = () => { controller.signal.throwIfAborted(); if (!isCurrent() || audio.getAudioContext() !== context || context.state !== 'running' || audio.getMonitorRouteState().revision !== monitor.revision || audition && !audition.isCurrent()) throw failure('stale-scene-rehearsal', 'The scene, private monitor route or audio clock changed.'); };
    const releaseJob = async () => {
      if (workerFault) throw workerFault; if (!job) return; job.release(); const state = job.retirementState();
      if (!['released', 'canceled'].includes(state.phase)) throw failure('scene-rehearsal-worker-unknown', 'The rehearsal worker still owns its admitted result.'); job = null;
    };
    const cleanupWorld = async () => {
      if (listener && clone) { clone.world.soundEvents.onBatch.off(listener); listener = null; }
      if (engine) { engine.dispose(); engine = null; }
      if (clone) { await retire(clone, 'dispose'); clone = null; }
      if (loan) { loan.release(); loan = null; }
    };
    const close = () => {
      if (scope.getReceipt()) return scope.getReceipt(); ready = false; clearInterval(fenceTimer); fenceTimer = null; controller.abort(failure('scene-rehearsal-stopped', 'The rehearsal stopped.'));
      const dependencies = createProcgenRetirementScope().retire([
        { name: 'private-physical-world', run: cleanupWorld }, { name: 'rehearsal-render-worker', run: releaseJob },
        { name: 'owned-pcm-cue', run: () => cue?.dispose() }, { name: 'cue-session', run: () => session?.dispose() }
      ]);
      const receipt = scope.retire([{ name: 'rehearsal-producers', run: () => dependencies }, { name: 'rehearsal-storage', run: async () => { await dependencies.completion; if (dependencies.outcome !== 'complete') throw failure('scene-rehearsal-retirement-unknown', 'Rehearsal producers have unresolved ownership.'); workspace?.release(); } }]);
      receipt.completion.then(value => { signal?.removeEventListener('abort', abort); audition?.close(value); }); return receipt;
    };
    controller.signal.addEventListener('abort', () => { if (ready) close(); }, { once: true });
    try {
      check(); workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'scene-rehearsal:' + preflight.sceneHash, kind: 'bounded-physical-intents-and-worker-result', bytes: 16 * 1048576 });
      audition = await audio.acquireAudition({ source: { name: scene.title, kind: 'isolated-scene-rehearsal', revision: preflight.sceneHash, sourceRef: preflight.sceneHash }, routeRevision: monitor.revision, signal: controller.signal,
        onStop: reason => controller.abort(failure('scene-rehearsal-stopped', reason)) }); check();
      session = audio.createSession('performance-scene-rehearsal', { workloadClass: 'cue' });
      if (!session || !await session.enable()) throw failure('scene-rehearsal-cue-unavailable', 'The selected cue route or reserved playback quota is unavailable.'); check();
      loan = await candidate.borrowRehearsalCheckpoint({ signal: controller.signal, isCurrent }); check();
      clone = await prepareInspectionWorld({ checkpoint: loan.checkpoint, signal: controller.signal }); check();
      if (!clone?.world || clone.world.tickIndex !== 0) throw failure('scene-rehearsal-world-unavailable', 'Rehearsal requires an independently owned unadvanced inspection world.');
      restoreProcgenCheckpoint(clone.world, loan.checkpoint); check(); loan.release(); loan = null;
      const world = clone.world, origin = world.simulationTimeMs, intents = []; let callbackError = null, batches = 0, last = null, admittedBytes = 0;
      engine = createCausalMusicEngine({ world, resourceBudget, getGraph: () => scene.causalMappings, traceLimit: 0, maxVoices: scene.cost.maximumVoices, maxBeginsPerBatch: Math.min(512, scene.cost.maximumVoices) });
      listener = batch => { try { check(); if (++batches > 512 || batch.completeness.status !== 'complete' || batch.completeness.dropped || batch.worldId !== world.worldId || batch.generation !== world.generation) throw failure('scene-rehearsal-source-incomplete', 'The private source could not retain complete bounded physical facts.');
        const values = engine.processBatch(batch); if (intents.length + values.length > 8192) throw failure('scene-rehearsal-source-capacity', 'The rehearsal exceeds its bounded intent history.');
        admittedBytes += canonicalDataText(values, { maxBytes: 1048576, maxNodes: 65536 }).bytes.length; if (admittedBytes > 4 * 1048576) throw failure('scene-rehearsal-source-capacity', 'The rehearsal exceeds its admitted source representation.');
        intents.push(...values); last = batch;
      } catch (error) { callbackError ||= error; } };
      world.soundEvents.onBatch.on(listener);
      for (let tick = 0; tick < 512 && world.simulationTimeMs - origin < 6000; tick++) { check(); const before = batches; world.step(); if (callbackError) throw callbackError;
        if (batches !== before + 1 || !last || world._failedTick) throw failure('scene-rehearsal-source-incomplete', 'Every rehearsal tick must produce one complete observed batch.'); if (tick % 4 === 3) await yieldTask(); }
      check(); const health = engine.diagnostics(); if (!last || health.recoveryRequired || health.deliveryErrors || health.rejectedBegins) throw failure('scene-rehearsal-source-incomplete', 'The private interpretation did not cover every source onset.');
      const source = freezeData({ schema: 'lemmings-scene-rehearsal-source/v1', sceneHash: preflight.sceneHash, initialTick: 0, ticks: batches, sourceTimeMs: origin,
        durationSeconds: (last.sourceTimeMs + last.tickDurationMs - origin) / 1000, worldId: world.worldId, generation: world.generation, seed: world.seed, intents });
      const sourceHash = await hashData(source, { maxBytes: 8 * 1048576, maxNodes: 524288 }); check(); await cleanupWorld(); check();
      const input = { scene, sceneHash: preflight.sceneHash, source, sampleRate: context.sampleRate, ...(scene.cost.sharedBodies ? { recipe: candidate.rehearsalRecipe } : {}) }, inputBytes = canonicalDataText(input, { maxBytes: 8 * 1048576, maxNodes: 524288 }).bytes.length;
      job = await jobs.compute({ kind: 'render-scene-rehearsal', ownerId: 'performance-scene-rehearsal', ownerEpoch: 0, sourceRevision: sourceHash, signal: controller.signal, isCurrent,
        inputBytes, maxBytes: inputBytes, estimatedPeakBytes: 128 * 1048576, deadlineMs: 120000, budgetAdapter: resourceBudget, prepareInput: () => input }); check();
      const result = job.value;
      if (!(result?.bytes instanceof Uint8Array) || result.bytes.byteLength > 16 * 1048576 || result.manifest?.sourceHash !== sourceHash || result.manifest.sceneHash !== preflight.sceneHash || result.manifest.applicationBuildId !== scene.sourceVersion.hash || result.manifest.currentWorldAdvanced !== false || result.manifest.nextWorldAdvanced !== false || result.manifest.externalOutput !== false || scene.cost.sharedBodies && (result.manifest.recipeHash !== scene.worldRecipeRef.hash || result.manifest.body?.mapHash !== candidate.rehearsalRecipe.initialMorphMechanism.map.hash || result.manifest.body?.semanticOnsetsAdded !== 0 || result.manifest.body?.faults !== 0 || result.manifest.body?.bodyCount !== scene.cost.sharedBodies || result.manifest.body?.strategy !== bodyCost.strategy || result.manifest.body?.modeCount !== bodyCost.modeCount)) throw failure('scene-rehearsal-render-unbound', 'The worker rehearsal differs from its admitted scene and physical source.');
      const manifest = freezeData(result.manifest); cue = await session.preparePcmCue({ bytes: result.bytes, manifest, signal: controller.signal, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check(); await releaseJob(); check();
      audition.markReady(); const playback = cue.play(); check(); audition.markPlaying(); ready = true;
      cue.completion.then(() => close()); fenceTimer = setInterval(() => { try { check(); } catch (error) { controller.abort(error); } }, 50);
      return Object.freeze({ routing: 'isolated-local', externalOutput: false, manifest, playback, monitorRoute: monitor, completion: cue.completion.then(() => close().completion), state: () => Object.freeze({ playing: ready && !scope.getReceipt(), retirement: scope.getReceipt()?.outcome || null }), retire: close });
    } catch (error) {
      if (error.backgroundRetirementCompletion) error.backgroundRetirement = await error.backgroundRetirementCompletion;
      if (error.backgroundRetirement && !['released', 'canceled'].includes(error.backgroundRetirement.phase)) workerFault = error;
      const receipt = close(); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error;
    }
  };
}
