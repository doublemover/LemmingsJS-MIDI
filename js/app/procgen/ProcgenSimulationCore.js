import { procgenSimulationExecutionPolicy } from './ProcgenSimulationExecutionPolicy.js';
import { cloneData } from '../../core/CanonicalData.js';
import { captureProcgenPausedProjection } from './ProcgenPausedProjection.js';
import { captureProcgenCheckpointCooperative } from './workstation/ProcgenCheckpoint.js';
import { simulationFailure, simulationInteger } from './ProcgenSimulationProtocol.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from './ProcgenRetirement.js';

export function createProcgenSimulationCore({ world, engine = null, clock = null, scoreTimeline = false, bpm = 120, playing = true,
  documentRevision = 0, nominalSpeed = world?.timer?.speedFactor > 0 ? world.timer.speedFactor : 1, requiredConsumer = () => {}, onState = () => {}, getPerformance = () => null, applyPerformance = null,
  resourceBudget = null, disposeWorld = null, observePhysicalFeedback = () => {}, getExecutionPolicy = () => procgenSimulationExecutionPolicy(), now = () => performance.now() } = {}) {
  if (!world?.soundEvents?.onBatch || typeof world.step !== 'function' || world._stepping || !simulationInteger(documentRevision) ||
      ![requiredConsumer, onState, getPerformance, observePhysicalFeedback, getExecutionPolicy, now].every(value => typeof value === 'function') || !Number.isFinite(bpm) || bpm <= 0 || bpm > 1000000 || !Number.isFinite(nominalSpeed) || nominalSpeed <= 0 || nominalSpeed > 1000000)
    throw new TypeError('A simulation host needs one authoritative completed world and required causal consumer.');
  world.timer.speedFactor = nominalSpeed;
  const scope = createProcgenRetirementScope(), producers = createProcgenRetirementScope(), storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'authoritative-simulation',
    kind: 'command-receipts-and-causal-admission', category: 'live', bytes: 8 * 1048576 });
  const commands = new Map(); let commandFrontier = 0, sequence = 0, paused = true, disposed = false, failed = null, pending = null, capturing = false,
    projecting = false, collecting = null, listenerError = null, latest = null, ticks = 0, deadlineMisses = 0, maximumStepMs = 0, maximumConsumerMs = 0, deliveryAgeMs = 0, remainingDeliveries = 0;
  const state = () => Object.freeze({ mode: 'authoritative', phase: disposed ? 'retiring' : failed ? 'failed-paused' : projecting ? 'projecting' : capturing ? 'checkpointing' : pending ? 'causal-backpressure' : paused ? 'paused' : 'running',
    paused, failure: failed ? Object.freeze({ code: failed.code || 'simulation-failed', message: failed.message }) : null,
    worldId: world.worldId, laneCount: world.laneCount, laneHeight: world.laneHeight, worldWidth: world.width, generation: world.generation, tick: world.tickIndex, sequence, documentRevision, commandFrontier, tickDurationMs: 60 / world.timer.speedFactor, nominalSpeed: world.timer.speedFactor, effectiveSpeed: paused ? 0 : world.timer.speedFactor,
    commandReceipts: commands.size, pendingCausalBatches: remainingDeliveries, ticks, deadlineMisses, maximumStepMs, maximumConsumerMs, deliveryAgeMs,
    evidence: 'completed-authoritative-ticks;output-consumer-acceptance-is-not-acoustic-evidence' });
  const publish = () => { try { onState(state()); } catch {} };
  const fail = error => { failed ||= error instanceof Error ? error : new Error(String(error)); paused = true; publish(); return failed; };
  const check = () => { if (disposed || failed || capturing || pending || collecting) throw failed || simulationFailure('host-unavailable', 'The simulation owner is paused for retirement, capture or required causal acknowledgment.'); };
  const listener = batch => {
    try {
      const transition = batch.terminalGenerationTransition, terminal = collecting?.length === 0 && transition?.from === batch.generation && transition.to === world.generation && batch.tick === world.tickIndex;
      if (!collecting || batch.worldId !== world.worldId || batch.generation !== world.generation && !terminal || collecting.length >= 2) throw simulationFailure('batch-boundary', 'The world published outside its host-owned completed step.');
      const scoreTime = scoreTimeline ? clock.observe(batch, { bpm }) : null;
      const intents = playing && engine ? engine.processBatch(batch) : [];
      const packet = Object.freeze({ sequence: ++sequence, documentRevision, batch, intents, scoreTime, tempoBpm: bpm,
        bodyCommands: playing && engine ? engine.bodyPreparations()?.commands || Object.freeze([]) : Object.freeze([]) });
      collecting.push(packet); latest = batch.snapshot; observePhysicalFeedback(batch, engine?.physicalAnalysis?.() || null);
    } catch (error) { listenerError = error; }
  };
  world.soundEvents.onBatch.on(listener);
  const step = (timestamp = now()) => {
    check(); if (!Number.isFinite(timestamp)) throw simulationFailure('clock-invalid', 'Simulation clock samples must be finite.');
    const started = now(); collecting = []; listenerError = null;
    try {
      world.step(timestamp);
      if (listenerError) throw listenerError;
      if (collecting.length < 1 || collecting.length > 2 || collecting.at(-1).batch.tick !== world.tickIndex || collecting.at(-1).batch.generation !== world.generation) throw simulationFailure('batch-boundary', 'One authoritative step must publish its complete ordered terminal/current-generation boundary.');
      const packets = collecting, elapsed = Math.max(0, now() - started), deadline = 60 / world.timer.speedFactor;
      ticks++; maximumStepMs = Math.max(maximumStepMs, elapsed); if (elapsed > deadline) deadlineMisses++;
      remainingDeliveries = packets.length;
      const deliver = index => {
        const packet = packets[index], delivering = now(), accepted = requiredConsumer(packet);
        const validate = receipt => {
          maximumConsumerMs = Math.max(maximumConsumerMs, Math.max(0, now() - delivering)); deliveryAgeMs = Math.max(0, now() - started);
          if (receipt === false || receipt?.accepted === false) throw simulationFailure('causal-consumer-refused', 'A required consumer refused the completed generation boundary. Resume requires explicit recovery.');
          remainingDeliveries--; return index + 1 < packets.length ? deliver(index + 1) : packet;
        };
        return accepted?.then ? Promise.resolve(accepted).then(validate) : validate(accepted);
      };
      const delivered = deliver(0);
      if (delivered?.then) {
        const task = Promise.resolve(delivered).catch(error => { throw fail(error); }).finally(() => { if (pending === task) { pending = null; publish(); } });
        pending = task; task.catch(() => {}); publish(); return task;
      }
      return delivered;
    } catch (error) { throw fail(error); }
    finally { collecting = null; }
  };
  const submit = request => {
    check();
    if (!request || !simulationInteger(request.sequence, 1) || request.documentRevision !== documentRevision || request.generation !== world.generation ||
        !simulationInteger(request.intendedTick, world.tickIndex + 1, world.tickIndex + 10000) || request.command?.applyAtTick !== request.intendedTick ||
        typeof request.command?.id !== 'string' || request.command.id.length > 256) throw simulationFailure('command-invalid', 'A world command must name its current document, generation, ID and future tick.');
    if (request.sequence <= commandFrontier) {
      const prior = commands.get(request.sequence);
      if (!prior || prior.commandId !== request.command.id) throw simulationFailure('command-sequence-retired', 'This command sequence is already consumed; it cannot execute again.');
      return prior;
    }
    if (request.sequence !== commandFrontier + 1) throw simulationFailure('command-out-of-order', 'Submit commands in their declared monotonic order.');
    const proposal = world.prepareIntervention(request.command);
    if (proposal.outcome.status === 'queued') proposal.commit();
    const receipt = Object.freeze({ sequence: request.sequence, commandId: request.command.id, intendedTick: request.intendedTick,
      generation: request.generation, documentRevision, ...proposal.outcome, evidence: 'world-command-admission;application-is-a-later-physical-fact' });
    commandFrontier = request.sequence; commands.set(request.sequence, receipt); if (commands.size > 256) commands.delete(commands.keys().next().value); publish(); return receipt;
  };
  return Object.freeze({ step, submit, state,
    async advance({ steps = 1, timestamp = now(), signal } = {}) {
      if (!simulationInteger(steps, 1, 64)) throw simulationFailure('step-capacity', 'Advance at most 64 complete ticks per request.');
      let packet = null; for (let index = 0; index < steps; index++) { signal?.throwIfAborted(); packet = await step(timestamp); } return packet;
    },
    resume() { check(); paused = false; publish(); return state(); }, pause() { paused = true; publish(); return state(); },
    setPerformance(value, revision) { check(); if (!paused || !applyPerformance || !simulationInteger(revision, documentRevision + 1)) throw simulationFailure('performance-boundary', 'Performance replacement requires a paused canonical revision.');
      applyPerformance(value); documentRevision = revision; publish(); return state(); },
    setTransport(value) { check(); if (!paused || !value || !Number.isFinite(value.bpm) || value.bpm <= 0 || value.bpm > 1000000 || typeof value.playing !== 'boolean') throw simulationFailure('transport-boundary', 'Change the host transport at a paused completed boundary.'); bpm = value.bpm; playing = value.playing; return state(); },
    latestSnapshot: () => latest,
    async project(viewport = {}, { signal, isCurrent = () => true, allowRunning = false, cellBuffer = null } = {}) {
      check(); if (!paused && !allowRunning) throw simulationFailure('projection-needs-pause', 'Pause at a completed tick before requesting its immutable collision/actor viewport.');
      projecting = true; capturing = true; publish();
      try { return await captureProcgenPausedProjection(world, { ...viewport, sourcePaused: paused, cellBuffer, ...(allowRunning ? { yieldControl: () => Promise.resolve() } : {}), resourceBudget, signal, isCurrent: () => !disposed && !failed && isCurrent() }); }
      finally { projecting = false; capturing = false; publish(); }
    },
    async checkpoint({ signal, isCurrent = () => true, onSlice, maxGraphBytes = 128 * 1048576, maxSemanticBytes = 32 * 1048576 } = {}) {
      check(); if (!paused) throw simulationFailure('checkpoint-needs-pause', 'Pause at a completed tick before capturing an authoritative continuation.');
      capturing = true; publish(); const tick = world.tickIndex, generation = world.generation;
      try {
        const checkpoint = await captureProcgenCheckpointCooperative(world, { signal, onSlice, maxGraphBytes, isCurrent: () => !disposed && !failed && isCurrent() && world.tickIndex === tick && world.generation === generation });
        signal?.throwIfAborted(); if (disposed || !isCurrent()) throw simulationFailure('checkpoint-stale', 'The simulation checkpoint owner changed.');
        const semantic = engine ? await engine.snapshotCooperative({ signal, onSlice, maxBytes: maxSemanticBytes, isCurrent: () => !disposed && !failed && isCurrent() && world.tickIndex === tick && world.generation === generation }) : null;
        return Object.freeze({ world: checkpoint, engine: semantic, timeline: clock?.snapshot() || null, performance: getPerformance(), executionPolicy: procgenSimulationExecutionPolicy(getExecutionPolicy()),
          authoring: cloneData({ graph: world.physicalAuthoring?.graph || null, instances: world.physicalAuthoring?.instances || [], junctions: world.physicalJunctions?.definitions || [] }, { maxBytes: 4 * 1048576, maxNodes: 262144 }),
          replay: Object.freeze({ version: 2, playing, bpm, scoreTimeline, nominalSpeed: world.timer.speedFactor }), boundary: state() });
      } finally { capturing = false; publish(); }
    },
    fail,
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; paused = true; publish();
      const acknowledgment = pending ? Promise.allSettled([pending]) : Promise.resolve();
      return scope.retire([{ name: 'simulation-producers', run: () => producers.retire([
        { name: 'completed-batch-listener', run: () => world.soundEvents.onBatch.off(listener) },
        { name: 'causal-engine', run: async () => { await acknowledgment; return engine?.dispose(); } },
        { name: 'authoritative-world', run: async () => { await acknowledgment; return disposeWorld?.(); } }
      ]) }, { name: 'simulation-metadata', run: async () => { const receipt = producers.getReceipt(); await receipt.completion;
        if (receipt.outcome !== 'complete') throw simulationFailure('retirement-unknown', 'Simulation producer ownership is unresolved.'); commands.clear(); latest = null; storage.release(); } }]); }
  });
}
