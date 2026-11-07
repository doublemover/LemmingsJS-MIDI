import { decodeSimulationPacket, isSimulationEnvelope, simulationEnvelope, simulationFailure, SIMULATION_PACKET_BYTES } from './ProcgenSimulationProtocol.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';

export function attachProcgenSimulationConsumer({ port, manifest, consume, resourceBudget = null, onFailure = () => {}, now = () => performance.now() }) {
  if (!port?.postMessage || typeof consume !== 'function') throw new TypeError('A required simulation consumer needs its independent MessagePort and admission callback.');
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'simulation-consumer:' + manifest.ownerId,
    kind: 'decoded-canonical-batch-and-transfer-lease', category: 'live', bytes: 4 * SIMULATION_PACKET_BYTES });
  let disposed = false, failed = null, frontier = 0, pending = null, bytesReceived = 0, maximumConsumeMs = 0;
  const fail = error => { failed ||= error; try { onFailure(error); } catch {} };
  const receive = event => {
    const message = event.data;
    if (disposed || !isSimulationEnvelope(message, manifest)) return;
    if (message.type !== 'causal-batch' || pending || message.sequence !== frontier + 1) { fail(simulationFailure('consumer-order', 'A required consumer received overlapping or out-of-order causal delivery.')); return; }
    const buffer = message.buffer, started = now();
    pending = Promise.resolve().then(async () => {
      const packet = decodeSimulationPacket(buffer, message.bytes);
      if (packet.sequence !== message.sequence || packet.documentRevision !== manifest.documentRevision || packet.batch.generation !== message.generation ||
          packet.batch.tick !== message.tick || packet.batch.worldId !== message.worldId) throw simulationFailure('consumer-boundary', 'The transferred causal packet differs from its completed boundary.');
      const receipt = await consume(packet);
      if (receipt === false || receipt?.accepted === false || disposed) throw simulationFailure('consumer-refused', 'The required consumer did not accept this exact completed batch.');
      frontier = packet.sequence; bytesReceived += message.bytes; maximumConsumeMs = Math.max(maximumConsumeMs, Math.max(0, now() - started));
      port.postMessage(simulationEnvelope(manifest, 'causal-ack', { sequence: frontier, generation: message.generation, tick: message.tick, worldId: message.worldId, accepted: true, buffer }), [buffer]);
    }).catch(error => {
      fail(error);
      try { if (buffer instanceof ArrayBuffer && buffer.byteLength === SIMULATION_PACKET_BYTES) port.postMessage(simulationEnvelope(manifest, 'causal-ack', {
        sequence: message.sequence, generation: message.generation, tick: message.tick, worldId: message.worldId, accepted: false, reason: String(error.message).slice(0, 256), buffer }), [buffer]); } catch {}
    }).finally(() => { pending = null; });
  };
  port.addEventListener('message', receive); port.addEventListener('messageerror', fail); port.start?.();
  return Object.freeze({ state: () => Object.freeze({ frontier, pending: !!pending, failed: failed?.message || null, bytesReceived, maximumConsumeMs,
    evidence: 'required-consumer-admission;not-render-or-acoustic-confirmation' }),
  async dispose() { if (disposed) return; disposed = true; port.removeEventListener('message', receive); port.removeEventListener('messageerror', fail);
    if (pending) await pending; port.close(); storage.release(); } });
}
