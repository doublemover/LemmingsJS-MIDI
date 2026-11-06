import { createResourceBudget } from '../resources/ResourceBudget.js';
import { createBackgroundSnapshotReceiver, encodeBackgroundSnapshotPages, backgroundSnapshotTransfers } from '../resources/BackgroundSnapshotPages.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { prepareProcgenSimulationRealm } from './ProcgenSimulationRealm.js';
import { PROCGEN_SIMULATION_PROTOCOL, SIMULATION_MAX_CONSUMERS, SIMULATION_PACKET_BYTES, encodeSimulationPacket, isSimulationEnvelope,
  simulationEnvelope, simulationFailure, simulationInteger, validateSimulationManifest } from './ProcgenSimulationProtocol.js';

export function createProcgenSimulationWorkerEndpoint({ postMessage, close, timers = globalThis, now = () => performance.now(),
  prepare = prepareProcgenSimulationRealm, identity = getActiveExecutionIdentity, compareIdentity = required => compareActiveExecutionIdentity(required).matched } = {}) {
  const controller = new AbortController(), budget = createResourceBudget({ limitBytes: 512 * 1048576 });
  let manifest = null, receiver = null, inputSequence = 0, host = null, phase = 'new', timer = null, pumping = null, lastTime = null, elapsed = 0,
    transferStorage = null, inputStorage = null, inputLimit = null, consumers = [], outputAck = null, closing = null, activeRequest = false,
    preparingWork = null, activeWork = null;
  const send = (type, fields = {}, transfers = []) => postMessage(simulationEnvelope(manifest, type, fields), transfers);
  const pauseTimer = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; lastTime = null; elapsed = 0; };
  const failure = error => {
    if (phase === 'closed' || phase === 'retiring') return;
    pauseTimer(); phase = 'failed-paused'; host?.fail(error);
    for (const consumer of consumers) if (consumer.pending) { const pending = consumer.pending; consumer.pending = null; timers.clearTimeout(pending.timer); pending.reject(error); }
    outputAck?.reject(error); outputAck = null;
    try { send('failed', { state: host?.state() || null, error: { code: error.code || 'worker-failed', message: String(error.message || error).slice(0, 512) } }); } catch {}
  };
  const deliver = async packet => {
    if (phase === 'retiring' || phase === 'closed') throw simulationFailure('worker-retired', 'The simulation generation retired before causal delivery.');
    await Promise.all(consumers.map(consumer => new Promise((resolve, reject) => {
      if (consumer.pending || !consumer.buffer) { reject(simulationFailure('consumer-backpressure', 'The previous causal buffer is still leased.')); return; }
      const buffer = consumer.buffer;
      try {
        const bytes = encodeSimulationPacket(packet, buffer);
        const pending = { sequence: packet.sequence, generation: packet.batch.generation, tick: packet.batch.tick, worldId: packet.batch.worldId, resolve, reject, timer: null };
        consumer.pending = pending; pending.timer = timers.setTimeout(() => { if (consumer.pending === pending) { consumer.pending = null; reject(simulationFailure('consumer-timeout', 'A required consumer did not acknowledge its causal lease; the authoritative world is paused.')); } }, 3000);
        consumer.port.postMessage(simulationEnvelope(manifest, 'causal-batch', { sequence: packet.sequence, generation: packet.batch.generation,
          tick: packet.batch.tick, worldId: packet.batch.worldId, bytes, buffer }), [buffer]); consumer.buffer = null;
      } catch (error) { if (consumer.pending) timers.clearTimeout(consumer.pending.timer); consumer.pending = null; reject(error); }
    })));
  };
  const connect = ports => {
    if (!Array.isArray(ports) || !ports.length || ports.length > SIMULATION_MAX_CONSUMERS || new Set(ports).size !== ports.length) throw simulationFailure('consumer-inventory', 'Declare one to four independently owned required consumers.');
    transferStorage = createOwnedResourceReservation({ budget, owner: 'simulation-causal-transfers', kind: 'exclusive-pool-and-encoding-workspace', category: 'live', bytes: (ports.length + 4) * SIMULATION_PACKET_BYTES });
    consumers = ports.map(port => {
      const consumer = { port, buffer: new ArrayBuffer(SIMULATION_PACKET_BYTES), pending: null, receive: null, error: null };
      consumer.receive = event => {
        const message = event.data, pending = consumer.pending;
        if (!isSimulationEnvelope(message, manifest)) return;
        if (!pending || message.type !== 'causal-ack' || ['sequence', 'generation', 'tick', 'worldId'].some(key => message[key] !== pending[key]) ||
            !(message.buffer instanceof ArrayBuffer) || message.buffer.byteLength !== SIMULATION_PACKET_BYTES) { failure(simulationFailure('causal-ack-invalid', 'A returned causal buffer does not match its outstanding completed-tick lease.')); return; }
        consumer.pending = null; timers.clearTimeout(pending.timer); consumer.buffer = message.buffer;
        if (message.accepted === true) pending.resolve(); else pending.reject(simulationFailure('consumer-refused', message.reason || 'A required causal consumer refused its batch.'));
      };
      consumer.error = () => failure(simulationFailure('consumer-message', 'A required consumer port could not decode its message.'));
      port.addEventListener('message', consumer.receive); port.addEventListener('messageerror', consumer.error); port.start?.(); return consumer;
    });
  };
  const schedule = () => { if (phase === 'ready' && !host.state().paused && !pumping && timer === null) timer = timers.setTimeout(pump, 4); };
  const pump = () => {
    timer = null; if (phase !== 'ready' || host.state().paused || pumping) return;
    const time = now();
    if (lastTime !== null && time - lastTime > 250) { pauseTimer(); host.pause(); send('suspended', { reason: 'The simulation owner was suspended; explicitly resume from its completed boundary.' }); return; }
    elapsed += lastTime === null ? 0 : Math.max(0, time - lastTime); lastTime = time;
    pumping = (async () => {
      const started = now(); let count = 0;
      while (phase === 'ready' && !host.state().paused && elapsed >= host.state().tickDurationMs && count < 8) {
        elapsed -= host.state().tickDurationMs; await host.advance({ steps: 1, timestamp: time, signal: controller.signal }); count++;
        if (now() - started >= 8) break;
      }
      if (elapsed > 1000) throw simulationFailure('simulation-backlog', 'Authoritative ticks cannot meet the admitted backlog bound; pause rather than skip physical work.');
    })().catch(failure).finally(() => { pumping = null; schedule(); });
  };
  const retire = () => {
    if (closing) return closing; phase = 'retiring'; controller.abort(); pauseTimer();
    outputAck?.reject(simulationFailure('checkpoint-retired', 'The checkpoint stream retired.')); outputAck = null;
    closing = (async () => {
      if (preparingWork) await Promise.allSettled([preparingWork]);
      if (pumping) await pumping; if (activeWork) await Promise.allSettled([activeWork]);
      const receipt = host?.dispose(); if (receipt) { await receipt.completion; if (receipt.outcome !== 'complete') throw simulationFailure('retirement-unknown', 'The authoritative world retained unresolved ownership.'); }
      receiver?.dispose(); receiver = null;
      const unresolved = consumers.some(consumer => !consumer.buffer || consumer.pending);
      for (const consumer of consumers) { consumer.port.removeEventListener('message', consumer.receive); consumer.port.removeEventListener('messageerror', consumer.error); consumer.port.close(); consumer.buffer = null; }
      consumers = []; if (unresolved) throw simulationFailure('consumer-retirement-unknown', 'A transferred causal buffer has no returned lease acknowledgment.');
      transferStorage?.release(); inputStorage?.release(); phase = 'closed'; send('retired', { outcome: 'complete' }); close();
    })().catch(error => { try { send('retired', { outcome: 'unknown', error: String(error.message).slice(0, 512) }); } finally { phase = 'closed'; close(); } }); return closing;
  };
  const sendCheckpoint = async requestId => {
    const value = await host.checkpoint({ signal: controller.signal });
    const transmit = (type, fields, transfers = []) => new Promise((resolve, reject) => {
      if (outputAck) throw simulationFailure('checkpoint-backpressure', 'A checkpoint packet remains leased.');
      const timer = timers.setTimeout(() => { if (outputAck?.sequence === fields.sequence) { outputAck = null; reject(simulationFailure('checkpoint-timeout', 'The checkpoint receiver stopped acknowledging its pages.')); } }, 5000);
      outputAck = { sequence: fields.sequence, resolve: () => { timers.clearTimeout(timer); resolve(); }, reject: error => { timers.clearTimeout(timer); reject(error); } }; send(type, { requestId, ...fields }, transfers);
    });
    await transmit('checkpoint-start', { sequence: 0 }); let sequence = 0;
    for await (const packet of encodeBackgroundSnapshotPages(value, { maxBytes: 128 * 1048576, maxNodes: 4000000, estimatedPeakBytes: 384 * 1048576, signal: controller.signal })) {
      sequence = packet.sequence; await transmit('checkpoint-page', { sequence, packet }, backgroundSnapshotTransfers(packet));
    }
    send('checkpoint-end', { requestId, sequence });
  };
  return Object.freeze({ fail: failure, receive: async request => {
    try {
      if (phase === 'closed' || phase === 'retiring') return;
      if (phase === 'new') {
        if (request?.protocol !== PROCGEN_SIMULATION_PROTOCOL || request.type !== 'initialize' || !simulationInteger(request.ownerEpoch, 1) || !simulationInteger(request.documentRevision) ||
            typeof request.ownerId !== 'string' || !request.ownerId || request.ownerId.length > 128 || request.requiredIdentity?.activeExecution !== 'bound' || !compareIdentity(request.requiredIdentity))
          throw simulationFailure('worker-build-mismatch', 'The authoritative worker requires its executing immutable application generation.');
        manifest = { ownerId: request.ownerId, ownerEpoch: request.ownerEpoch, documentRevision: request.documentRevision };
        inputLimit = { maxBytes: 128 * 1048576, maxNodes: 4000000, estimatedPeakBytes: 384 * 1048576 };
        inputStorage = createOwnedResourceReservation({ budget, owner: 'simulation-source-continuation', kind: 'initial-manifest-and-restore-overlap', category: 'candidate', bytes: 192 * 1048576 });
        receiver = createBackgroundSnapshotReceiver(inputLimit); connect(request.ports); phase = 'receiving'; send('input-ack', { sequence: 0 }); return;
      }
      if (!isSimulationEnvelope(request, manifest)) throw simulationFailure('host-envelope-stale', 'A simulation request belongs to a different document or generation.');
      if (request.type === 'dispose') return retire();
      if (request.type === 'checkpoint-ack') { if (!outputAck || request.sequence !== outputAck.sequence) throw simulationFailure('checkpoint-ack-invalid', 'A checkpoint acknowledgment does not match its packet.'); const pending = outputAck; outputAck = null; pending.resolve(); return; }
      if (phase === 'receiving') {
        if (request.type === 'input-page') { const receipt = receiver.push(request.packet); inputSequence = receipt.sequence; send('input-ack', { sequence: inputSequence }); return; }
        if (request.type !== 'input-end' || request.sequence !== inputSequence) throw simulationFailure('manifest-incomplete', 'Complete all owned initialization pages before world preparation.');
        const input = receiver.finish(request.sequence); receiver = null; validateSimulationManifest(input);
        if (!isSimulationEnvelope(simulationEnvelope(input, 'identity'), manifest)) throw simulationFailure('manifest-stale', 'The initialization manifest changed its admitted owner.');
        manifest = input; phase = 'preparing';
        preparingWork = Promise.resolve().then(() => prepare({ manifest, resourceBudget: budget, signal: controller.signal, requiredConsumer: deliver,
          onState: state => { if (phase !== 'closed' && phase !== 'retiring') send('state', { state }); } })).then(prepared => { host = prepared.host; return prepared; });
        const prepared = await preparingWork; controller.signal.throwIfAborted(); inputStorage.release(); inputStorage = null;
        manifest = { ...manifest, checkpoint: { clock: { speedFactor: manifest.checkpoint.clock.speedFactor } }, semantic: null, graph: null, performance: null, timeline: null };
        phase = 'ready'; send('ready', { state: host.state(), restoredContinuationHash: prepared.restoredContinuationHash, executionIdentity: identity() }); return;
      }
      if (phase !== 'ready' && phase !== 'failed-paused') throw simulationFailure('host-not-ready', 'The authoritative simulation is still preparing.');
      if (request.type === 'pause') { pauseTimer(); const state = host.pause(); send('response', { requestId: request.requestId, value: state }); return; }
      if (activeRequest || phase !== 'ready') throw simulationFailure('host-command-busy', 'Finish the active host operation before another mutation.');
      activeRequest = true;
      activeWork = (async () => {
        let value;
        if (request.type === 'resume') { value = host.resume(); lastTime = null; elapsed = 0; schedule(); }
        else if (request.type === 'advance') { if (!host.state().paused) throw simulationFailure('step-needs-pause', 'Manual stepping requires a paused host.'); const packet = await host.advance({ steps: request.steps, timestamp: now(), signal: controller.signal }); value = { state: host.state(), sequence: packet.sequence }; }
        else if (request.type === 'command') value = host.submit(request.command);
        else if (request.type === 'project') {
          if (pumping) await pumping;
          const projection = await host.project(request.viewport, { signal: controller.signal });
          try { const value = projection.read(); send('projection', { requestId: request.requestId, value }, [value.cells.buffer]); } finally { projection.release(); }
          return;
        }
        else if (request.type === 'checkpoint') { if (pumping) await pumping; await sendCheckpoint(request.requestId); return; }
        else throw simulationFailure('host-command-unsupported', 'Unsupported authoritative simulation command.');
        send('response', { requestId: request.requestId, value });
      })(); try { await activeWork; } finally { activeRequest = false; activeWork = null; }
    } catch (error) { failure(error); }
  }, dispose: retire });
}
