import { captureProcgenPausedProjection } from '../ProcgenPausedProjection.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
import { createCausalReperformance } from './CausalReperformance.js';
import { createCausalPhysicalBranch } from './CausalPhysicalBranch.js';
import { cloneJournalData, canonicalJournalText } from './CausalJournalCanonical.js';

export function createCausalTakeWorkbench({ journal, createWorld, getRuntimeIdentity, resourceBudget, onState = () => {} } = {}) {
  if (!journal?.openTake || typeof createWorld !== 'function' || typeof getRuntimeIdentity !== 'function' || typeof onState !== 'function') throw new TypeError('Invalid take workbench owner.');
  const unknown = new Set(); let active = null, inspection = null, pending = null, last = null, failure = null, progress = null, retainedRuntime = null, disposed = false, closing = false, ordinal = 0, phase = 'idle';
  const state = () => Object.freeze({ phase, busy: !!pending || closing && !disposed, active: active?.branch.status() || null, receipt: last,
    canStep: !!active && !pending && !closing && !unknown.size && active.branch.status().phase === 'paused', unknownRetirement: unknown.size,
    inspection: inspection ? { takeId: inspection.receipt.takeId, takeRevision: inspection.receipt.takeRevision, throughSequence: inspection.receipt.targetSequence, tick: inspection.session.world.tickIndex, generation: inspection.session.world.generation } : null,
    checkpointCache: retainedRuntime?.runtime.cacheState() || null, failure, progress, paused: true, hardware: false, audio: false, thru: false });
  const retireRuntime = async runtime => {
    if (retainedRuntime?.runtime === runtime) retainedRuntime = null;
    const receipt = runtime.dispose(); await receipt?.completion;
    if (receipt && receipt.outcome !== 'complete') { unknown.add(runtime); throw Object.assign(new Error('Take workbench retirement is unresolved.'), { retirement: receipt }); }
  };
  const retireInspection = async owned => {
    if (!owned) return;
    const receipt = createProcgenRetirementScope().retire([{ name: 'history-projection', run: () => owned.projection?.release() }, { name: 'history-world', run: () => owned.session.dispose() }]);
    await receipt.completion;
    if (receipt.outcome !== 'complete') { unknown.add(owned); throw Object.assign(new Error('Physical history inspection retirement is unresolved.'), { retirement: receipt }); }
  };
  const replayRuntime = async (manifest, identity) => {
    let key = null;
    try { key = canonicalJournalText({ takeId: manifest.takeId, canonicalHash: manifest.canonicalHash, revision: manifest.revision, finalizationHash: manifest.finalizationHash || null,
      sourceVersions: identity.sourceVersions, assetRefs: identity.assetRefs },
    { maxBytes: 131072, maxNodes: 16384 }).text; } catch { /* Oversized identity metadata uses a fresh, uncached service. */ }
    if (identity.liveWorld && typeof WeakRef !== 'function') key = null;
    const sameWorld = identity.liveWorld == null ? retainedRuntime?.world == null : retainedRuntime?.world?.deref() === identity.liveWorld;
    if (key && retainedRuntime?.key === key && sameWorld) return retainedRuntime.runtime;
    if (inspection && inspection.runtime === retainedRuntime?.runtime) throw new Error('Return from the current physical history before opening a different source identity.');
    if (retainedRuntime) await retireRuntime(retainedRuntime.runtime);
    const runtime = createCausalReperformance({ journal, createWorld, sourceVersions: identity.sourceVersions, assetRefs: identity.assetRefs,
      liveWorld: identity.liveWorld, resourceBudget, maxTicks: 10000, yieldEveryTicks: 32 });
    if (key) retainedRuntime = { key, world: identity.liveWorld ? new WeakRef(identity.liveWorld) : null, runtime };
    return runtime;
  };
  const report = () => { try { onState(state()); } catch { /* UI state cannot publish a physical branch. */ } };
  const run = (nextPhase, work) => {
    if (disposed || closing || pending || unknown.size) return Promise.reject(new Error('The take workbench already owns an operation or unresolved retirement.'));
    const operation = { controller: new AbortController() }; pending = operation; phase = nextPhase; failure = null; progress = null; report();
    operation.promise = Promise.resolve().then(() => work(operation)).catch(error => {
      failure = Object.freeze({ code: String(error.code || error.name || 'take-operation').slice(0, 64), message: String(error.message || error).slice(0, 512),
        ...(typeof error.sourceId === 'string' ? { sourceId: error.sourceId.slice(0, 256) } : {}),
        ...(Number.isSafeInteger(error.firstSequence) && error.firstSequence >= 0 ? { firstSequence: error.firstSequence } : {}) });
      phase = active ? operation.controller.signal.aborted ? 'branch-paused' : 'recovery-required' : inspection ? 'history-paused' : 'failed'; throw error;
    })
      .finally(() => { if (pending === operation) pending = null; report(); }); return operation.promise;
  };
  const open = ({ takeId, throughSequence = null, branchTakeId = null, takeName = null } = {}) => run(branchTakeId ? 'preparing-branch' : 'comparing', async operation => {
    if (active) throw new Error('Finish and save the current branch first.');
    if (inspection && inspection.receipt.takeId !== takeId) throw new Error('Return from the current physical history before preparing another take.');
    if (branchTakeId && throughSequence === null && inspection) throughSequence = inspection.receipt.targetSequence;
    const manifest = await journal.openTake(takeId); operation.controller.signal.throwIfAborted(); const identity = getRuntimeIdentity(manifest);
    const runtime = await replayRuntime(manifest, identity);
    try {
      operation.controller.signal.throwIfAborted();
      const options = { takeId, throughSequence, mode: 'compatibility', executionEpoch: 'take-workbench:' + (++ordinal), signal: operation.controller.signal,
        onProgress(value) { if (pending !== operation || operation.controller.signal.aborted || closing || disposed) return; progress = cloneJournalData(value, { maxBytes: 4096, maxNodes: 128 }); report(); } };
      if (branchTakeId) {
        const result = await createCausalPhysicalBranch({ journal, reperformance: runtime, parentTakeId: takeId, throughSequence,
          resourceBudget, takeId: branchTakeId, takeName: takeName || manifest.takeName.slice(0, 90) + ' branch', executionEpoch: options.executionEpoch, signal: options.signal, onProgress: options.onProgress });
        last = cloneJournalData(result.receipt);
        if (result.branch) {
          active = { branch: result.branch, runtime, projection: null };
          active.projection = await result.branch.project({ ...(inspection?.projection?.read().viewport || {}), signal: options.signal });
          const previous = inspection; inspection = null; await retireInspection(previous);
          if (options.signal.aborted) { active.projection?.release(); await result.branch.dispose(); await retireRuntime(runtime); active = null; options.signal.throwIfAborted(); }
          phase = 'branch-paused';
        } else { if (inspection?.runtime !== runtime) await retireRuntime(runtime); options.signal.throwIfAborted(); phase = 'unsupported'; }
      } else {
        const result = await runtime.reperform(options); last = cloneJournalData(result.receipt); if (retainedRuntime?.runtime !== runtime) await retireRuntime(runtime); options.signal.throwIfAborted(); phase = result.receipt.compatibilityMatch ? 'compared' : 'unsupported';
      }
      return state();
    } catch (error) { if (!active && !inspection) { try { await retireRuntime(runtime); } catch (cleanup) { error.retirement = cleanup.retirement; } } throw error; }
  });
  const seek = ({ takeId, throughSequence = null, viewport = {} } = {}) => run('seeking-history', async operation => {
    if (active) throw new Error('Save the active branch before seeking immutable take history.');
    if (inspection && inspection.receipt.takeId !== takeId) throw new Error('Return from the current physical history before seeking another take.');
    const manifest = await journal.openTake(takeId); operation.controller.signal.throwIfAborted();
    const runtime = await replayRuntime(manifest, getRuntimeIdentity(manifest)); let candidate = null, projection = null;
    try {
      const result = await runtime.reperform({ takeId, throughSequence, mode: 'compatibility', retainWorld: true, useValidatedCheckpoint: true, executionEpoch: 'history-inspection:' + (++ordinal), signal: operation.controller.signal,
        onProgress(value) { if (pending !== operation || operation.controller.signal.aborted || closing || disposed) return; progress = cloneJournalData(value, { maxBytes: 4096, maxNodes: 128 }); report(); } });
      last = cloneJournalData(result.receipt); candidate = result.session;
      operation.controller.signal.throwIfAborted();
      if (!candidate || !result.receipt.compatibilityMatch || !result.receipt.boundaryComplete) { phase = inspection ? 'history-paused' : 'unsupported'; return state(); }
      projection = await captureProcgenPausedProjection(candidate.world, { ...viewport, resourceBudget, signal: operation.controller.signal }); operation.controller.signal.throwIfAborted();
      const previous = inspection; inspection = { session: candidate, runtime, receipt: result.receipt, projection }; candidate = null; projection = null;
      await retireInspection(previous); phase = 'history-paused'; return state();
    } finally {
      if (candidate) await retireInspection({ session: candidate, projection });
      if (!inspection && retainedRuntime?.runtime !== runtime) await retireRuntime(runtime);
    }
  });
  const closeInspection = () => run('closing-history', async () => { const previous = inspection; inspection = null; await retireInspection(previous); phase = 'idle'; return state(); });
  const projectViewport = (viewport = {}) => run('projecting-history', async operation => {
    if (!active && !inspection) throw new Error('Seek a stored take or prepare a physical branch before choosing a viewport.');
    const owned = active || inspection, prepared = active ? await active.branch.project({ ...viewport, signal: operation.controller.signal }) : await captureProcgenPausedProjection(inspection.session.world, { ...viewport, resourceBudget, signal: operation.controller.signal });
    try { operation.controller.signal.throwIfAborted(); owned.projection?.release(); owned.projection = prepared; }
    catch (error) { prepared.release(); throw error; }
    phase = active ? 'branch-paused' : 'history-paused'; return state();
  });
  const publishBranch = publish => run('publishing-branch', async operation => {
    if (!active || typeof publish !== 'function') throw new Error('A paused physical branch and explicit project publisher are required.');
    const snapshot = await active.branch.captureContinuation({ signal: operation.controller.signal, isCurrent: () => !disposed && !closing && pending === operation });
    try { const result = await publish(snapshot.read(), { signal: operation.controller.signal }); phase = 'branch-paused'; return result; }
    finally { snapshot.release(); }
  });
  const advance = ({ ticks = 32 } = {}) => run('stepping', async operation => {
    if (!active) throw new Error('Prepare a physical branch before stepping.');
    const result = await active.branch.advance({ ticks, signal: operation.controller.signal });
    const projection = await active.branch.project({ ...(active.projection?.read().viewport || {}), signal: operation.controller.signal }); active.projection?.release(); active.projection = projection; phase = 'branch-paused'; return result;
  });
  const enqueueIntervention = command => {
    if (disposed || closing || pending || !active) throw new Error('A paused physical branch is required for an intervention.');
    const result = active.branch.enqueueIntervention(command); report(); return result;
  };
  const setPlayback = playing => {
    if (disposed || closing || pending || !active) throw new Error('A paused physical branch is required to change interpretation.');
    const result = active.branch.setPlayback(playing); report(); return result;
  };
  const finishOwned = async ({ discardPendingReason = null } = {}) => {
    if (!active) throw new Error('No physical branch is open.'); const owned = active;
    owned.projection?.release(); owned.projection = null;
    await owned.branch.stop();
    await owned.branch.dispose({ discardPendingReason }); const result = await owned.branch.stop();
    await retireRuntime(owned.runtime); active = null; phase = 'saved'; last = cloneJournalData(result); return last;
  };
  const finish = options => run('saving-branch', () => finishOwned(options));
  const armFeedback = () => { if (!active || pending || closing) throw new Error('Prepare a writable physical branch before regeneration.'); const result = active.branch.armFeedback(); report(); return result; };
  const disarmFeedback = () => { if (!active || pending || closing) throw new Error('No writable physical branch.'); const result = active.branch.disarmFeedback(); report(); return result; };
  const releaseComparisonCache = () => {
    if (active || inspection || !retainedRuntime) return Promise.resolve(false);
    return run('releasing-comparison-cache', async () => { await retireRuntime(retainedRuntime.runtime); phase = last?.compatibilityMatch ? 'compared' : last ? 'unsupported' : 'idle'; return true; });
  };
  return Object.freeze({ state, open, seek, closeInspection, projectViewport, publishBranch, projection: () => (active?.projection || inspection?.projection)?.read() || null, armFeedback, disarmFeedback, advance, enqueueIntervention, setPlayback, finish, releaseComparisonCache,
    cancel() { if (!pending) return false; phase = 'canceling'; pending.controller.abort(new Error('Take workbench canceled.')); report(); return true; },
    async dispose() {
      if (disposed) return; closing = true; phase = 'closing'; pending?.controller.abort(new Error('Take workbench retired.')); report();
      try { await pending?.promise.catch(() => {}); if (active) await finishOwned(); const previous = inspection; inspection = null; await retireInspection(previous); if (retainedRuntime) await retireRuntime(retainedRuntime.runtime); if (unknown.size) throw new Error('Take workbench retirement remains unresolved.'); disposed = true; phase = 'disposed'; }
      catch (error) { closing = false; phase = 'recovery-required'; throw error; } finally { report(); }
    }
  });
}
