import { createCausalReperformance } from './CausalReperformance.js';
import { createCausalPhysicalBranch } from './CausalPhysicalBranch.js';
import { cloneJournalData } from './CausalJournalCanonical.js';

export function createCausalTakeWorkbench({ journal, createWorld, getRuntimeIdentity, resourceBudget, onState = () => {} } = {}) {
  if (!journal?.openTake || typeof createWorld !== 'function' || typeof getRuntimeIdentity !== 'function' || typeof onState !== 'function') throw new TypeError('Invalid take workbench owner.');
  const unknown = new Set(); let active = null, pending = null, last = null, disposed = false, closing = false, ordinal = 0, phase = 'idle';
  const state = () => Object.freeze({ phase, busy: !!pending || closing && !disposed, active: active?.branch.status() || null, receipt: last,
    canStep: !!active && !pending && !closing && !unknown.size && active.branch.status().phase === 'paused', unknownRetirement: unknown.size,
    paused: true, hardware: false, audio: false, thru: false });
  const retireRuntime = async runtime => {
    const receipt = runtime.dispose(); await receipt?.completion;
    if (receipt && receipt.outcome !== 'complete') { unknown.add(runtime); throw Object.assign(new Error('Take workbench retirement is unresolved.'), { retirement: receipt }); }
  };
  const report = () => { try { onState(state()); } catch { /* UI state cannot publish a physical branch. */ } };
  const run = (nextPhase, work) => {
    if (disposed || closing || pending || unknown.size) return Promise.reject(new Error('The take workbench already owns an operation or unresolved retirement.'));
    const operation = { controller: new AbortController() }; pending = operation; phase = nextPhase; report();
    operation.promise = Promise.resolve().then(() => work(operation)).catch(error => { phase = active ? operation.controller.signal.aborted ? 'branch-paused' : 'recovery-required' : 'failed'; throw error; })
      .finally(() => { if (pending === operation) pending = null; report(); }); return operation.promise;
  };
  const open = ({ takeId, throughSequence = null, branchTakeId = null, takeName = null } = {}) => run(branchTakeId ? 'preparing-branch' : 'comparing', async operation => {
    if (active) throw new Error('Finish and save the current branch first.');
    const manifest = await journal.openTake(takeId); operation.controller.signal.throwIfAborted(); const identity = getRuntimeIdentity(manifest);
    const runtime = createCausalReperformance({ journal, createWorld, sourceVersions: identity.sourceVersions, assetRefs: identity.assetRefs,
      liveWorld: identity.liveWorld, resourceBudget, maxTicks: 10000, yieldEveryTicks: 32 });
    try {
      const options = { takeId, throughSequence, mode: 'compatibility', executionEpoch: 'take-workbench:' + (++ordinal), signal: operation.controller.signal };
      if (branchTakeId) {
        const result = await createCausalPhysicalBranch({ journal, reperformance: runtime, parentTakeId: takeId, throughSequence,
          takeId: branchTakeId, takeName: takeName || manifest.takeName.slice(0, 90) + ' branch', executionEpoch: options.executionEpoch, signal: options.signal });
        last = cloneJournalData(result.receipt);
        if (result.branch) {
          active = { branch: result.branch, runtime };
          if (options.signal.aborted) { await result.branch.dispose(); await retireRuntime(runtime); active = null; options.signal.throwIfAborted(); }
          phase = 'branch-paused';
        } else { await retireRuntime(runtime); options.signal.throwIfAborted(); phase = 'unsupported'; }
      } else {
        const result = await runtime.reperform(options); last = cloneJournalData(result.receipt); await retireRuntime(runtime); options.signal.throwIfAborted(); phase = result.receipt.compatibilityMatch ? 'compared' : 'unsupported';
      }
      return state();
    } catch (error) { if (!active) { try { await retireRuntime(runtime); } catch (cleanup) { error.retirement = cleanup.retirement; } } throw error; }
  });
  const advance = ({ ticks = 32 } = {}) => run('stepping', async operation => {
    if (!active) throw new Error('Prepare a physical branch before stepping.');
    const result = await active.branch.advance({ ticks, signal: operation.controller.signal }); phase = 'branch-paused'; return result;
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
    await owned.branch.stop();
    await owned.branch.dispose({ discardPendingReason }); const result = await owned.branch.stop();
    await retireRuntime(owned.runtime); active = null; phase = 'saved'; last = cloneJournalData(result); return last;
  };
  const finish = options => run('saving-branch', () => finishOwned(options));
  return Object.freeze({ state, open, advance, enqueueIntervention, setPlayback, finish,
    cancel() { if (!pending) return false; phase = 'canceling'; pending.controller.abort(new Error('Take workbench canceled.')); report(); return true; },
    async dispose() {
      if (disposed) return; closing = true; phase = 'closing'; pending?.controller.abort(new Error('Take workbench retired.')); report();
      try { await pending?.promise.catch(() => {}); if (active) await finishOwned(); if (unknown.size) throw new Error('Take workbench retirement remains unresolved.'); disposed = true; phase = 'disposed'; }
      catch (error) { closing = false; phase = 'recovery-required'; throw error; } finally { report(); }
    }
  });
}
