import { createCausalMusicEngine, validateCausalInstrumentGraph } from './CausalMusicEngine.js';
import { createProcgenPhysicalScoreClock } from './ProcgenPhysicalScoreClock.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from './ProcgenCheckpoint.js';
import { inspectProcgenCheckpoint, hashProcgenPhysicsCheckpoint, compareProcgenPhysicsCheckpoints } from './ProcgenCheckpointProvenance.js';
import { canonicalJournalText, cloneJournalData, hashJournalData, journalError } from './CausalJournalCanonical.js';
import { compareCausalRecords } from './CausalTake.js';
import { queryCausalCoverage } from './CausalCoverage.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const equal = (left, right) => canonicalJournalText(left, { maxBytes: 32 * 1048576, maxNodes: 4000000 }).text ===
  canonicalJournalText(right, { maxBytes: 32 * 1048576, maxNodes: 4000000 }).text;
const EXECUTION_IDENTITY = Object.freeze({ status: 'unbound', reason: 'active-module-graph-not-proven' });
const worldTick = checkpoint => checkpoint?.graph?.owners?.find(owner => owner.name === 'world')?.props?.tickIndex;

const createCausalReperformance = ({ journal, createWorld, sourceVersions, assetRefs = [], liveWorld = null,
  maxTicks = 10000, pageRecords = 256, maxQualifiedCheckpoints = 16, yieldEveryTicks = 64, resourceBudget = null,
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) => {
  if (!journal || ['openTake', 'verify', 'readCheckpoint', 'query'].some(key => typeof journal[key] !== 'function') ||
      typeof createWorld !== 'function' || !sourceVersions || !Array.isArray(assetRefs) || typeof yieldControl !== 'function' ||
      ![maxTicks, pageRecords, maxQualifiedCheckpoints, yieldEveryTicks].every(value => Number.isSafeInteger(value) && value > 0) ||
      maxTicks > 1000000 || pageRecords > 4096 || maxQualifiedCheckpoints > 256 || yieldEveryTicks > 4096) throw new Error('Invalid causal re-performance runtime.');
  const runtimeVersions = cloneJournalData(sourceVersions), runtimeAssets = cloneJournalData(assetRefs);
  const usedWorlds = new WeakSet(), checkpointQualifications = new Map(), sessions = new Set();
  const retirement = createProcgenRetirementScope(), pendingRuns = new Set();
  let disposed = false;
  const check = signal => { if (disposed || signal?.aborted) throw journalError('cancelled', 'Causal re-performance canceled.'); };
  const reserveWorkspace = manifest => {
    const checkpointBytes = Math.max(...[manifest.initialCheckpoint, ...manifest.checkpoints].map(ref => ref.bytes || 32 * 1048576));
    const token = {}, owner = 'causal-journal';
    resourceBudget?.reserve({ token, owner, generation: 0, kind: 'checkpoint', bytes: checkpointBytes * 8 + 32 * 1048576,
      pinned: true, reloadable: false });
    let released = false, releaseError = null;
    return () => {
      if (released) { if (releaseError) throw releaseError; return; } released = true;
      try { const ack = resourceBudget?.release({ token, owner });
        if (ack === false || ack && typeof ack.then === 'function') { if (ack?.then) Promise.resolve(ack).catch(() => {}); throw new Error('Re-performance workspace retirement is unresolved.'); }
      } catch (error) { releaseError = error; throw error; }
    };
  };
  const inspectTake = async ({ takeId, throughSequence = null, mode = 'compatibility', signal } = {}) => {
    if (!id(takeId) || !['compatibility', 'exact'].includes(mode)) throw new Error('Invalid re-performance request.');
    check(signal);
    const manifest = await journal.openTake(takeId), reasons = [];
    if (!equal(manifest.sourceVersions, runtimeVersions)) reasons.push('source-version-mismatch');
    if (!equal(manifest.assetRefs, runtimeAssets)) reasons.push('asset-identity-mismatch');
    const initial = await journal.readCheckpoint(manifest.initialCheckpoint);
    const target = throughSequence ?? manifest.durableSequence;
    if (!Number.isSafeInteger(target) || target < 0 || target > manifest.durableSequence) throw new Error('Re-performance target is outside the durable prefix.');
    const boundary = target ? await journal.query({ takeId, takeRevision: manifest.revision, firstSequence: target, lastSequence: target, limit: 1, signal }) : null;
    const throughTick = target ? boundary?.records[0]?.tick : worldTick(initial.world);
    if (!Number.isSafeInteger(throughTick)) reasons.push('missing-replay-boundary');
    if (target && Number.isSafeInteger(throughTick)) {
      const sourceStart = manifest.coverage?.sourceRange?.firstTick;
      const coverage = queryCausalCoverage({ coverage: manifest.coverage, kind: 'physical-facts',
        range: { firstTick: Math.min(throughTick, Number.isSafeInteger(sourceStart) ? sourceStart : worldTick(initial.world)), lastTick: throughTick } });
      if (coverage.status !== 'known-covered') reasons.push(coverage.status === 'unknown' ? 'unknown-physical-source-coverage' : 'incomplete-physical-source');
    }
    const checkpoint = inspectProcgenCheckpoint(initial.world, { assetRefs: runtimeAssets, generator: runtimeVersions.generator });
    if (checkpoint.continuation === 'unsupported') reasons.push(...checkpoint.reasons);
    if (initial.engine?.version !== 1) reasons.push('missing-semantic-engine-checkpoint');
    if (![1, 2].includes(initial.replay?.version) || initial.replay.version === 2 && typeof initial.replay.playing !== 'boolean' || typeof initial.replay.scoreTimeline !== 'boolean' ||
        !Number.isFinite(initial.replay.bpm) || initial.replay.bpm <= 0 || initial.replay.bpm > 1000000) reasons.push('missing-replay-clock-settings');
    if (mode === 'exact') reasons.push('active-execution-unbound');
    check(signal);
    return cloneJournalData({ schema: 'lemmings-reperformance-preflight', version: 1, takeId, takeRevision: manifest.revision,
      status: reasons.length ? 'unsupported' : 'compatible-current-runtime', reasons, mode, exactQualified: false,
      executionIdentity: EXECUTION_IDENTITY, sourceCanonicalHash: manifest.canonicalHash, checkpoint, targetSequence: target, throughTick,
      artifactIntegrity: 'checkpoint-hash-verified; chunk-chain-verification-required',
      sourceVersions: manifest.sourceVersions, assetRefs: manifest.assetRefs });
  };
  const preflight = async options => {
    const manifest = await journal.openTake(options?.takeId), release = reserveWorkspace(manifest);
    try { return await inspectTake(options); } finally { release(); }
  };
  const runReperformance = async ({ takeId, throughSequence = null, executionEpoch, mode = 'compatibility', signal,
    retainWorld = false, useValidatedCheckpoint = true, onProgress = () => {} } = {}, releaseWorkspace = () => {}, ownWorkspace = () => {}) => {
    if (!id(executionEpoch) || typeof onProgress !== 'function') throw new Error('Re-performance requires a separate execution epoch.');
    const qualification = await inspectTake({ takeId, throughSequence, mode, signal });
    if (qualification.status === 'unsupported') return { receipt: qualification, session: null };
    const manifest = await journal.openTake(takeId), verified = await journal.verify(takeId);
    const target = throughSequence ?? manifest.durableSequence;
    if (!Number.isSafeInteger(target) || target < 0 || target > manifest.durableSequence) throw new Error('Re-performance target is outside the durable prefix.');
    check(signal);
    const scope = `${takeId}:${manifest.canonicalHash}:`, qualified = useValidatedCheckpoint
      ? [...checkpointQualifications.values()].filter(item => item.scope === scope && item.ref.sequence <= target).sort((a, b) => b.ref.sequence - a.ref.sequence)[0] : null;
    const ref = qualified?.ref || manifest.initialCheckpoint, initial = await journal.readCheckpoint(ref);
    const current = { graph: qualified?.graph || validateCausalInstrumentGraph(manifest.mapping), bpm: initial.replay.bpm, playing: initial.replay.version === 2 ? initial.replay.playing : true };
    let world = null, engine = null, clock = null, listener = null, callbackError = null, released = false, worldOwned = false, disposeWorld = null;
    let worldProducer = null, worldProducerPending = false;
    let actualDisposal = null, synchronousDisposal = false, listenerFailure = null;
    let lastSequence = ref.sequence, ticks = 0, comparedBatches = 0, comparedIntents = 0, lastComparedTick = worldTick(initial.world),
      physicalHash = qualified?.physicalHash || null, checkpointComparisons = [], divergence = null, lastYieldTicks = 0;
    const generated = [], expectedIntents = new Map();
    const observedFacts = new Set(qualified?.inventory?.observedFactKinds || []), observedIntents = new Set(qualified?.inventory?.intentKinds || []),
      mappingRevisions = new Set(qualified?.inventory?.mappingRevisions || [current.graph.revision]);
    let firstSourceTick = qualified?.inventory?.sourceRange?.firstTick ?? null, sourceWorldId = qualified?.inventory?.sourceRange?.worldId ?? null;
    const inventory = () => ({ observedFactKinds: [...observedFacts].sort(), intentKinds: [...observedIntents].sort(),
      mappingRevisions: [...mappingRevisions], sourceRange: { firstTick: firstSourceTick, lastTick: lastComparedTick, worldId: sourceWorldId } });
    const ownedRetirement = createProcgenRetirementScope(), releaseRetirement = createProcgenRetirementScope();
    const awaitOwner = async value => { const receipt = await value;
      if (receipt != null && receipt !== true && receipt?.schema !== 'lemmings-retirement/v1') throw new Error('Isolated world retirement was not acknowledged.');
      if (receipt?.schema === 'lemmings-retirement/v1') { await receipt.completion;
        if (receipt.outcome !== 'complete') throw new Error('The isolated world owner has unresolved retirement.'); } return receipt; };
    const disposeOwnedWorld = () => {
      const value = worldOwned ? disposeWorld() : undefined;
      synchronousDisposal = value == null || value === true || value?.schema === 'lemmings-retirement/v1' && value.state === 'retired' && value.outcome === 'complete';
      actualDisposal = awaitOwner(value); actualDisposal.catch(() => {}); return value?.then ? actualDisposal : value;
    };
    const release = () => {
      released = true;
      const receipt = releaseRetirement.retire([
        { name: 'replay-world', run: () => ownedRetirement.retire([
          { name: 'physical-listener', run: () => { try { if (listener) world?.soundEvents?.onBatch?.off(listener); } catch (error) { listenerFailure = error; throw error; } } },
          { name: 'world-owner', run: () => {
            if (worldProducerPending) { actualDisposal = worldProducer.then(() => awaitOwner(worldOwned ? disposeWorld() : undefined), () => undefined); actualDisposal.catch(() => {}); return actualDisposal; }
            try { return disposeOwnedWorld(); } catch (error) { actualDisposal = Promise.reject(error); actualDisposal.catch(() => {}); throw error; }
          } }
        ]) },
        { name: 'replay-workspace', run: () => {
          const complete = () => { if (listenerFailure) throw listenerFailure; releaseWorkspace(); sessions.delete(release); };
          return synchronousDisposal ? complete() : actualDisposal.then(complete);
        } }
      ]); return receipt;
    };
    const compareCheckpoint = async checkpointRef => {
      const stored = await journal.readCheckpoint(checkpointRef), actualWorld = captureProcgenCheckpoint(world);
      const physical = await compareProcgenPhysicsCheckpoints(stored.world, actualWorld), actualHash = physical.actualHash, expectedHash = physical.expectedHash;
      const physicalMatch = physical.matched, semanticMatch = equal(stored.engine, engine.snapshot());
      const timelineMatch = equal(stored.timeline, initial.replay.scoreTimeline ? clock.snapshot() : null);
      const replaySettingsMatch = stored.replay?.version === initial.replay.version && stored.replay.bpm === current.bpm && stored.replay.scoreTimeline === initial.replay.scoreTimeline &&
        (initial.replay.version !== 2 || stored.replay.playing === current.playing);
      const matched = physicalMatch && semanticMatch && timelineMatch && replaySettingsMatch;
      const result = { sequence: checkpointRef.sequence, checkpointId: checkpointRef.id, tick: world.tickIndex,
        status: matched ? 'validated-by-current-runtime-reperformance' : 'mismatch', physicalMatch, semanticMatch, timelineMatch, replaySettingsMatch,
        expectedPhysicsHash: expectedHash, actualPhysicsHash: actualHash, firstStateDifference: physical.firstDifference, exactQualified: false };
      checkpointComparisons.push(result);
      if (!matched) return { sequence: checkpointRef.sequence, tick: world.tickIndex, causeId: null, kind: 'component-checkpoint', detail: result };
      const key = scope + checkpointRef.id;
      if (generated.length || expectedIntents.size) return null;
      checkpointQualifications.delete(key); checkpointQualifications.set(key, { scope, ref: checkpointRef, graph: current.graph, physicalHash: actualHash, inventory: inventory() });
      if (checkpointQualifications.size > maxQualifiedCheckpoints) checkpointQualifications.delete(checkpointQualifications.keys().next().value);
      return null;
    };
    ownWorkspace(); sessions.add(release);
    try {
      worldProducerPending = true;
      worldProducer = Promise.resolve().then(() => { check(signal); return createWorld({ checkpoint: initial.world, sourceVersions: runtimeVersions, assetRefs: runtimeAssets, signal, executionEpoch }); }).then(candidate => {
        world = candidate?.world || candidate;
        if (!world || world === liveWorld || usedWorlds.has(world) || world._disposed || typeof world.step !== 'function' || typeof world.dispose !== 'function') throw journalError('world-ownership', 'Re-performance requires a fresh isolated world.');
        disposeWorld = candidate?.world && typeof candidate.dispose === 'function' ? () => candidate.dispose() : () => world.dispose();
        usedWorlds.add(world); worldOwned = true;
      }).finally(() => { worldProducerPending = false; });
      await worldProducer; check(signal);
      restoreProcgenCheckpoint(world, initial.world);
      const restoredHash = await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(world));
      const initialHash = await hashProcgenPhysicsCheckpoint(initial.world);
      if (restoredHash !== initialHash) throw journalError('restore-divergence', 'Restored authoritative checkpoint state differs before the first replay tick.', { tick: world.tickIndex });
      physicalHash = restoredHash;
      clock = createProcgenPhysicalScoreClock();
      if (initial.timeline) clock.restore(initial.timeline);
      engine = createCausalMusicEngine({ getGraph: () => current.graph, scoreTimeline: initial.replay.scoreTimeline ? clock : null, traceLimit: 0 });
      engine.restore(initial.engine);
      listener = batch => {
        try {
          if (generated.length >= 8) throw journalError('replay-overflow', 'Unexpected source batch fanout during re-performance.');
          if (initial.replay.scoreTimeline) clock.observe(batch, { bpm: current.bpm });
          generated.push({ batch, intents: current.playing ? engine.processBatch(batch) : [] });
        } catch (error) { callbackError = error; }
      };
      world.soundEvents.onBatch.on(listener);
      const refsBySequence = new Map(manifest.checkpoints.filter(item => item.sequence > ref.sequence && item.sequence <= target).map(item => [item.sequence, item]));
      let next = ref.sequence + 1;
      while (next <= target) {
        check(signal);
        const page = await journal.query({ takeId, takeRevision: manifest.revision, firstSequence: next, lastSequence: target, limit: pageRecords, signal });
        if (!page.records.length) throw journalError('source-prefix-gap', 'No retained source record at the requested replay sequence.', { firstSequence: next });
        for (const record of page.records) {
          check(signal);
          if (record.sequence !== lastSequence + 1) throw journalError('source-prefix-gap', 'Replay source order has a gap.', { firstSequence: lastSequence + 1 });
          if (record.kind === 'physical-batch') {
            if (!generated.length) {
              if (record.tick !== world.tickIndex + 1) throw journalError('source-tick-gap', 'Recorded source cannot be reproduced by one physical tick.', { firstSequence: record.sequence, tick: record.tick });
              if (ticks >= maxTicks) throw journalError('replay-capacity', 'Re-performance tick budget reached.', { firstSequence: record.sequence, tick: record.tick });
              world.step(); ticks++;
            }
            if (callbackError) throw callbackError;
            const actual = generated.shift();
            if (!actual) throw journalError('missing-replay-batch', 'Physical stepping produced no committed batch.', { firstSequence: record.sequence, tick: record.tick });
            const comparison = compareCausalRecords([record], [{ ...record, payload: actual.batch }]);
            if (!comparison.equal) { divergence = { ...comparison.firstDivergence, kind: 'physical-batch' }; break; }
            comparedBatches++; lastComparedTick = record.tick; firstSourceTick ??= record.tick; sourceWorldId = actual.batch.worldId;
            for (const fact of actual.batch.facts) if (fact.kind) observedFacts.add(fact.kind);
            expectedIntents.set(actual.batch.batchId, actual.intents);
            if (expectedIntents.size > 8) throw journalError('replay-overflow', 'Musical intent companion records are missing.');
          } else if (record.kind === 'musical-intents') {
            const actual = expectedIntents.get(record.payload.batchId);
            if (!actual || !equal(record.payload.intents, actual)) {
              const index = (record.payload.intents || []).findIndex((intent, ordinal) => !equal(intent, actual?.[ordinal] ?? null));
              const original = record.payload.intents?.[Math.max(0, index)], replayed = actual?.[Math.max(0, index)];
              divergence = { sequence: record.sequence, tick: record.tick, causeId: original?.sourceEventIds?.[0] || replayed?.sourceEventIds?.[0] || null,
                intentId: original?.intentId || replayed?.intentId || null, kind: 'musical-intents' }; break;
            }
            comparedIntents += actual.length; for (const intent of actual) observedIntents.add(intent.kind); expectedIntents.delete(record.payload.batchId);
          } else if (record.kind === 'intervention') {
            if (record.tick !== world.tickIndex || record.generation !== world.generation) throw journalError('input-boundary-mismatch', 'Intervention was not captured at the current replay boundary.', { firstSequence: record.sequence, tick: record.tick });
            const outcome = world.enqueueIntervention(record.payload.command);
            if (!equal(outcome, record.payload.outcome)) { divergence = { sequence: record.sequence, tick: record.tick,
              causeId: record.payload.command?.id || null, kind: 'intervention-admission' }; break; }
          } else if (record.kind === 'mapping') {
            if (record.tick !== world.tickIndex || record.generation !== world.generation) throw journalError('input-boundary-mismatch', 'Mapping changed outside its recorded source boundary.', { firstSequence: record.sequence });
            current.graph = validateCausalInstrumentGraph(record.payload);
            mappingRevisions.add(current.graph.revision);
            if (mappingRevisions.size > 4096) throw journalError('replay-capacity', 'Mapping revision inventory reached its bound.', { firstSequence: record.sequence });
          }
          else if (record.kind === 'timeline') {
            if (record.tick !== world.tickIndex || record.generation !== world.generation) throw journalError('input-boundary-mismatch', 'Tempo changed outside its recorded source boundary.', { firstSequence: record.sequence });
            if (record.payload?.version !== 1 || record.payload.kind !== 'tempo' || !Number.isFinite(record.payload.bpm) || record.payload.bpm <= 0 || record.payload.bpm > 1000000) throw journalError('unsupported-recorded-input', 'Unknown timeline input cannot be substituted during replay.', { firstSequence: record.sequence });
            current.bpm = record.payload.bpm;
          } else if (record.kind === 'input-observation') {
            const input = record.payload;
            if (record.tick !== world.tickIndex || record.generation !== world.generation || input?.version !== 1) throw journalError('input-boundary-mismatch', 'External input was not captured at a qualified boundary.', { firstSequence: record.sequence });
            if (input.kind === 'world-speed' && Number.isFinite(input.speedFactor) && input.speedFactor > 0 && input.speedFactor <= 1000000) world.timer.speedFactor = input.speedFactor;
            else if (input.kind === 'transport-state' && typeof input.playing === 'boolean' && initial.replay.version === 2) current.playing = input.playing;
            else if (!(input.kind === 'transport-state' && typeof input.playing === 'boolean' ||
                input.kind === 'external-observation' && input.effect === 'observation-only' && id(input.sourceId))) throw journalError('unsupported-recorded-input', 'Unknown external input effect cannot be guessed during replay.', { firstSequence: record.sequence });
          }
          lastSequence = record.sequence;
          if (refsBySequence.has(record.sequence)) { divergence = await compareCheckpoint(refsBySequence.get(record.sequence)); if (divergence) break; }
          if (ticks - lastYieldTicks >= yieldEveryTicks) { lastYieldTicks = ticks; try { onProgress(Object.freeze({ takeId, sequence: lastSequence, targetSequence: target, ticks, tick: world.tickIndex })); } catch { /* Inspection does not change replay. */ } await yieldControl(); }
        }
        if (divergence || page.nextSequence == null) break;
        next = page.nextSequence;
      }
      check(signal);
      const finalCheckpoint = captureProcgenCheckpoint(world);
      physicalHash = await hashProcgenPhysicsCheckpoint(finalCheckpoint);
      const finalQualified = target === 0 || ref.sequence === target && !!qualified || checkpointComparisons.some(item => item.sequence === target && item.status === 'validated-by-current-runtime-reperformance');
      const boundaryComplete = !generated.length && !expectedIntents.size;
      if (retainWorld && !boundaryComplete) throw journalError('incomplete-branch-boundary', 'A retained physical branch requires every batch and intent companion at its boundary.');
      const receipt = cloneJournalData({ schema: 'lemmings-causal-reperformance', version: 1, takeId, takeRevision: manifest.revision,
        sourceCanonicalHash: manifest.canonicalHash, mode: 'physical-reperformance', executionEpoch, executionIdentity: EXECUTION_IDENTITY,
        exactQualified: false, compatibilityMatch: !divergence, status: divergence ? 'mismatch' : 'matched-current-runtime',
        firstDivergence: divergence, verifiedDurableSequence: verified.verifiedThroughSequence, fromCheckpointSequence: ref.sequence,
        throughSequence: lastSequence, targetSequence: target, tick: lastComparedTick, ticksExecuted: ticks, comparedBatches, comparedIntents,
        physicsStateSchema: 2, actualPhysicsHash: physicalHash, finalWorldParity: finalQualified && !divergence ? 'matched-at-captured-component-checkpoint' : 'unknown-no-validated-final-component-checkpoint',
        checkpointComparisons, boundaryComplete, captureInventory: inventory(), sourceVersions: runtimeVersions, assetRefs: runtimeAssets,
        artifactIntegrity: { status: 'verified-durable-chain', initialCheckpointHash: manifest.initialCheckpoint.hash, canonicalHash: verified.canonicalHash },
        inspection: { paused: true, recording: false, hardware: false, thru: false, physicalLayers: false } });
      if (!retainWorld || divergence) { const cleanup = release(); await cleanup.completion;
        if (cleanup.outcome !== 'complete') throw journalError('retirement-unknown', 'The compared world has unresolved resource retirement.');
        return { receipt, session: null }; }
      if (listener) world.soundEvents.onBatch.off(listener); listener = null;
      return { receipt, session: { world, engine, clock, executionEpoch, graph: () => current.graph,
        replayState: () => ({ version: initial.replay.version, bpm: current.bpm, scoreTimeline: initial.replay.scoreTimeline, ...(initial.replay.version === 2 ? { playing: current.playing } : {}) }),
        configurePlayback: playing => { if (initial.replay.version !== 2 || typeof playing !== 'boolean') throw new Error('This take does not expose versioned playback admission.'); current.playing = playing; },
        configureMapping: graph => {
          const nextGraph = validateCausalInstrumentGraph(graph);
          if (nextGraph.revision <= current.graph.revision) throw new Error('A physical branch mapping needs a new revision.');
          current.graph = nextGraph;
        },
        configureTempo: bpm => {
          if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 1000000) throw new Error('Invalid physical branch tempo.');
          current.bpm = bpm;
        },
        snapshot: () => {
          if (released) throw journalError('session-released', 'The re-performance world has been released.');
          return { world: captureProcgenCheckpoint(world), engine: engine.snapshot(), timeline: initial.replay.scoreTimeline ? clock.snapshot() : null,
            replay: { version: initial.replay.version, bpm: current.bpm, scoreTimeline: initial.replay.scoreTimeline, ...(initial.replay.version === 2 ? { playing: current.playing } : {}) } };
        }, dispose: release } };
    } catch (error) {
      const cleanup = release(); await cleanup.completion;
      if (cleanup.outcome !== 'complete') error.retirement = cleanup;
      if (error.code === 'cancelled') throw error;
      return { receipt: cloneJournalData({ schema: 'lemmings-causal-reperformance', version: 1, takeId, takeRevision: manifest.revision,
        sourceCanonicalHash: manifest.canonicalHash, mode: 'physical-reperformance', executionEpoch, exactQualified: false,
        executionIdentity: EXECUTION_IDENTITY, status: 'unsupported-or-incomplete', compatibilityMatch: false,
        retirement: { state: cleanup.state, outcome: cleanup.outcome },
        failure: { code: error.code || error.name || 'reperformance', message: error.message, sequence: error.firstSequence ?? lastSequence,
          tick: error.tick ?? world?.tickIndex ?? null }, throughSequence: lastSequence, targetSequence: target,
        inspection: { paused: true, hardware: false, recording: false, thru: false, physicalLayers: false } }), session: null };
    }
  };
  const reperform = async options => {
    if (disposed) throw journalError('cancelled', 'Causal re-performance owner retired.');
    const manifest = await journal.openTake(options?.takeId), release = reserveWorkspace(manifest);
    let owned = false;
    const work = runReperformance(options, release, () => { owned = true; }); pendingRuns.add(work);
    try { return await work; }
    finally { pendingRuns.delete(work); if (!owned) release(); }
  };
  return { preflight, reperform, qualifiedCheckpoints: () => cloneJournalData([...checkpointQualifications.values()].map(({ ref }) => ref)),
    dispose: () => {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; checkpointQualifications.clear();
      return retirement.retire([...[...sessions].map((release, index) => ({ name: 'session-' + index, run: release })),
        ...(pendingRuns.size ? [{ name: 'pending-reperformances', run: async () => {
          await Promise.allSettled([...pendingRuns]); const receipt = createProcgenRetirementScope().retire([...sessions].map((release, index) => ({ name: 'session-' + index, run: release })));
          await receipt.completion; return receipt;
        } }] : [])]);
    } };
};

export { createCausalReperformance };
