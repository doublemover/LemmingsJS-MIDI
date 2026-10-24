import { createCausalTakeRecorder } from './CausalTake.js';
import { validateCausalInstrumentGraph } from './CausalMusicEngine.js';
import { cloneJournalData, journalError } from './CausalJournalCanonical.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const createCausalPhysicalBranch = async ({ journal, reperformance, parentTakeId, throughSequence, takeId, takeName,
  executionEpoch, mode = 'compatibility', signal, maxAdvanceTicks = 256, yieldEveryTicks = 32,
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) => {
  if (!journal || typeof journal.branch !== 'function' || !reperformance || typeof reperformance.reperform !== 'function' ||
      !Number.isSafeInteger(maxAdvanceTicks) || maxAdvanceTicks < 1 || maxAdvanceTicks > 4096 ||
      !Number.isSafeInteger(yieldEveryTicks) || yieldEveryTicks < 1 || yieldEveryTicks > maxAdvanceTicks || typeof yieldControl !== 'function') throw new Error('Invalid physical branch runtime.');
  const replay = await reperformance.reperform({ takeId: parentTakeId, throughSequence, executionEpoch, mode, signal,
    retainWorld: true, useValidatedCheckpoint: false });
  if (!replay.session || !replay.receipt.compatibilityMatch || !replay.receipt.boundaryComplete) return { receipt: replay.receipt, branch: null };
  const session = replay.session, world = session.world;
  const check = () => signal?.throwIfAborted();
  let writer = null, recorder = null;
  try {
    const parent = await journal.openTake(parentTakeId);
    check();
    if (parent.revision !== replay.receipt.takeRevision || parent.canonicalHash !== replay.receipt.sourceCanonicalHash) throw journalError('stale-revision', 'The parent changed after its branch boundary was compared.');
    const target = replay.receipt.targetSequence;
    const qualification = cloneJournalData({ schema: 'lemmings-physical-branch-boundary', version: 1, sourceTakeId: parentTakeId,
      sourceTakeRevision: parent.revision, sourceCanonicalHash: parent.canonicalHash, throughSequence: target,
      tick: world.tickIndex, generation: world.generation, actualPhysicsHash: replay.receipt.actualPhysicsHash,
      physicsStateSchema: replay.receipt.physicsStateSchema, executionIdentity: replay.receipt.executionIdentity,
      status: 'validated-by-current-runtime-reperformance', exactQualified: false });
    writer = await journal.branch({ parentTakeId, parentRevision: parent.revision, throughSequence: target, takeId, takeName,
      documentId: parent.documentId, boundaryQualification: qualification });
    check(); if (target > 0) await writer.checkpoint({ value: session.snapshot(), tick: world.tickIndex, generation: world.generation }); check();
    const inventory = replay.receipt.captureInventory;
    const gaps = (parent.coverage?.gaps || []).filter(gap => gap.firstSequence != null ? gap.firstSequence <= target
      : gap.firstTick <= world.tickIndex && gap.lastTick >= (inventory.sourceRange.firstTick ?? world.tickIndex + 1))
      .map(gap => gap.firstTick == null ? { ...gap } : ({ ...gap, firstTick: Math.max(gap.firstTick, inventory.sourceRange.firstTick ?? gap.firstTick), lastTick: Math.min(gap.lastTick, world.tickIndex) }));
    const boundary = () => {
      const snapshot = session.engine.snapshot();
      return { voices: snapshot.active, travel: snapshot.travel, contactSpans: snapshot.active.filter(voice => voice.lifetimeScope === 'contactSpan'),
        timeline: session.replayState().scoreTimeline ? session.clock.snapshot() : null };
    };
    recorder = await createCausalTakeRecorder({ journal, existingWriter: writer, takeId, documentId: parent.documentId,
      sourceVersions: parent.sourceVersions, assetRefs: parent.assetRefs, captureProfile: parent.captureProfile,
      mapping: session.graph(), boundaryState: boundary(), prefixCoverage: { ...inventory, gaps },
      sourceCursor: { journalSequence: target, worldId: world.worldId, tick: world.tickIndex, generation: world.generation,
        lastCausalSequence: world.soundEvents.snapshotIdentity().causalSequence } });
    check();
    const boundaryMarker = recorder.mark({ type: 'physical-branch-boundary', qualification }, { tick: world.tickIndex, generation: world.generation });
    if (boundaryMarker.status !== 'accepted') throw journalError('branch-admission', 'The branch boundary marker was not admitted.');
    let phase = 'paused', failure = null, disposed = false, stopPromise = null, disposePromise = null, completedBatches = 0, lastIntents = [];
    const sourceBoundary = () => ({ tick: world.tickIndex, generation: world.generation });
    const status = () => cloneJournalData({ schema: 'lemmings-physical-branch', version: 1, takeId, parentTakeId,
      executionEpoch, phase, tick: world.tickIndex, generation: world.generation, completedBatches, recording: recorder.status(),
      qualification, failure, interpretationPlaying: session.replayState().playing ?? true, playbackAdmission: session.replayState().version === 2,
      inspection: { paused: phase !== 'advancing', hardware: false, thru: false, physicalLayers: false } });
    const writable = () => {
      if (disposed || world._disposed || phase !== 'paused' || world._failedTick) throw journalError('branch-state', 'The physical branch is not at a writable paused boundary.');
    };
    const onBatch = batch => {
      if (disposed || world._disposed || phase !== 'advancing') return;
      try {
        const replayState = session.replayState();
        if (replayState.scoreTimeline) session.clock.observe(batch, { bpm: replayState.bpm });
        lastIntents = replayState.version === 2 && !replayState.playing ? [] : session.engine.processBatch(batch);
        const receipt = recorder.recordCommittedBatch({ batch, intents: lastIntents });
        completedBatches++;
        if (receipt.status === 'rejected') failure = { code: 'capture-admission', reason: receipt.reason, tick: batch.tick };
      } catch (error) {
        failure = { code: error.code || error.name || 'branch-capture', reason: error.message, tick: batch.tick };
        recorder.markGap({ kind: 'physical-facts', firstTick: batch.tick, lastTick: batch.tick, generation: batch.generation, reason: 'branch-batch-processing-failed' });
      }
    };
    world.soundEvents.onBatch.on(onBatch);
    const advance = async ({ ticks = 1, signal: advanceSignal } = {}) => {
      writable();
      if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > maxAdvanceTicks) throw new Error('Physical branch step request exceeds its bound.');
      phase = 'advancing'; lastIntents = [];
      try {
        for (let index = 0; index < ticks; index++) {
          if (disposed || world._disposed || phase !== 'advancing' || advanceSignal?.aborted || signal?.aborted) throw journalError('cancelled', 'Physical branch stepping canceled.');
          world.step();
          if (world._failedTick) throw journalError('physical-tick-failed', 'A physical branch tick did not commit.');
          if (failure) break;
          if ((index + 1) % yieldEveryTicks === 0 && index + 1 < ticks) await yieldControl();
        }
      } catch (error) {
        if (error.code !== 'cancelled') {
          failure = { code: error.code || error.name || 'physical-tick', reason: error.message, tick: world.tickIndex };
          recorder.markGap({ kind: 'physical-facts', firstTick: world.tickIndex, lastTick: world.tickIndex, generation: world.generation, reason: 'branch-physical-tick-failed' });
        }
        throw error;
      } finally { if (!disposed && phase === 'advancing') phase = world._failedTick ? 'failed' : 'paused'; }
      return cloneJournalData({ ...status(), lastIntents });
    };
    const enqueueIntervention = command => {
      writable(); const outcome = world.enqueueIntervention(command);
      return { outcome, recording: recorder.recordIntervention(command, outcome, sourceBoundary()) };
    };
    const setTempo = bpm => {
      writable(); if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 1000000) throw new Error('Invalid physical branch tempo.');
      const receipt = recorder.recordTimeline({ version: 1, kind: 'tempo', bpm }, sourceBoundary());
      if (receipt.status === 'accepted') session.configureTempo(bpm); return receipt;
    };
    const setSpeed = speedFactor => {
      writable(); if (!Number.isFinite(speedFactor) || speedFactor <= 0 || speedFactor > 1000000) throw new Error('Invalid physical branch speed.');
      const receipt = recorder.recordInput({ version: 1, kind: 'world-speed', speedFactor }, sourceBoundary());
      if (receipt.status === 'accepted') world.timer.speedFactor = speedFactor; return receipt;
    };
    const setPlayback = playing => {
      writable(); if (typeof playing !== 'boolean' || session.replayState().version !== 2) throw new Error('This branch has no versioned playback admission.');
      const receipt = recorder.recordInput({ version: 1, kind: 'transport-state', playing }, sourceBoundary());
      if (receipt.status === 'accepted') session.configurePlayback(playing); return receipt;
    };
    const setMapping = graph => {
      writable(); const next = validateCausalInstrumentGraph(graph), receipt = recorder.recordMapping(next, sourceBoundary());
      if (receipt.status === 'accepted') session.configureMapping(next); return receipt;
    };
    const stop = ({ reason = 'physical-branch-stop' } = {}) => {
      if (stopPromise) return stopPromise;
      if (phase === 'advancing') throw journalError('branch-state', 'Stop at a completed physical branch boundary.');
      phase = 'stopping'; world.soundEvents.onBatch.off(onBatch);
      let finalCheckpoint = null;
      if (!world._failedTick && !world._disposed) finalCheckpoint = session.snapshot();
      stopPromise = recorder.stop({ finalCheckpoint, boundaryState: boundary(), reason }).then(receipt => {
        phase = receipt.complete ? 'finalized' : 'partial'; return receipt;
      }).finally(() => { if (!recorder.canReplaceDocument()) stopPromise = null; });
      return stopPromise;
    };
    const dispose = ({ discardPendingReason = null } = {}) => {
      if (disposePromise) return disposePromise;
      disposePromise = (async () => {
        if (disposed) return;
        await stop({ reason: 'physical-branch-disposed' });
        if (!recorder.canReplaceDocument()) {
          if (!discardPendingReason) throw journalError('undurable-branch-tail', 'Keep the physical branch until its pending data is durable or explicitly discarded.');
          recorder.discardPending({ reason: discardPendingReason });
          await stop({ reason: 'physical-branch-discarded-tail' });
          if (!recorder.canReplaceDocument()) throw journalError('undurable-branch-finalization', 'The discarded branch prefix still needs a durable finalization receipt.');
        }
        phase = 'retiring';
        const retirement = createProcgenRetirementScope().retire([
          { name: 'branch-listener', run: () => world.soundEvents.onBatch.off(onBatch) },
          { name: 'reperformance-world', run: () => session.dispose() }
        ]); await retirement.completion;
        if (retirement.outcome !== 'complete') { phase = 'retirement-unknown'; throw Object.assign(journalError('retirement-unknown', 'Branch world retirement is unresolved.'), { retirement }); }
        disposed = true; phase = 'disposed';
      })().catch(error => { if (!recorder.canReplaceDocument()) disposePromise = null; throw error; }); return disposePromise;
    };
    return { receipt: qualification, branch: { status, advance, enqueueIntervention, setTempo, setSpeed, setPlayback, setMapping,
      mark: marker => { writable(); return recorder.mark(marker, sourceBoundary()); }, flush: recorder.flush,
      checkpoint: () => { writable(); return recorder.checkpoint({ value: session.snapshot(), ...sourceBoundary() }); },
      stop, dispose } };
  } catch (error) {
    const retirement = createProcgenRetirementScope().retire([{ name: 'provisional-branch', run: async () => { if (writer) {
      await writer.stop({ coverage: { status: 'partial', gaps: [{ kind: 'all', reason: 'branch-preparation-failed', firstTick: world.tickIndex, lastTick: world.tickIndex, generation: world.generation }] }, reason: 'branch-preparation-failed' }).catch(() => {});
      if (!writer.canReplaceDocument()) {
        writer.discardPending({ reason: 'preparation-failed-before-branch-activation' });
        await writer.stop().catch(() => {});
      }
      error.provisionalTakeId = takeId;
      if (!writer.canReplaceDocument()) throw journalError('undurable-branch-finalization', 'Provisional branch finalization is unresolved.');
    } } }, { name: 'reperformance-session', run: () => session.dispose() }]);
    await retirement.completion; if (retirement.outcome !== 'complete') error.retirement = retirement; throw error;
  }
};

export { createCausalPhysicalBranch };
