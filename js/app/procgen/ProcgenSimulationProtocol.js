import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';

export const PROCGEN_SIMULATION_PROTOCOL = 'lemmings-authoritative-simulation/v1';
export const SIMULATION_PACKET_BYTES = 8 * 1048576;
export const SIMULATION_MAX_CONSUMERS = 4;
export const simulationFailure = (code, message) => Object.assign(new Error(message), { name: 'ProcgenSimulationError', code });
export const simulationInteger = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
export function validateSimulationManifest(value) {
  if (!value || value.schema !== PROCGEN_SIMULATION_PROTOCOL || typeof value.ownerId !== 'string' || !value.ownerId || value.ownerId.length > 128 ||
      !simulationInteger(value.ownerEpoch, 1) || !simulationInteger(value.documentRevision) || value.checkpoint?.version !== 2 ||
      !simulationInteger(value.checkpoint.laneCount, 1, 1024) || typeof value.rootPath !== 'string' || value.rootPath.length > 4096 ||
      !Number.isFinite(value.bpm) || value.bpm <= 0 || value.bpm > 1000000 || typeof value.playing !== 'boolean' ||
      typeof value.scoreTimeline !== 'boolean' || !value.graph || value.semantic?.version !== 1) throw simulationFailure('manifest-invalid', 'The simulation host requires one completed world and semantic continuation.');
  return value;
}
export function simulationEnvelope(manifest, type, fields = {}) {
  return { protocol: PROCGEN_SIMULATION_PROTOCOL, ownerId: manifest.ownerId, ownerEpoch: manifest.ownerEpoch, documentRevision: manifest.documentRevision, type, ...fields };
}
export const isSimulationEnvelope = (value, manifest) => value?.protocol === PROCGEN_SIMULATION_PROTOCOL && value.ownerId === manifest.ownerId &&
  value.ownerEpoch === manifest.ownerEpoch && value.documentRevision === manifest.documentRevision;
export function encodeSimulationPacket(value, buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== SIMULATION_PACKET_BYTES) throw simulationFailure('packet-ownership', 'A simulation packet needs its exclusively owned pool buffer.');
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || text.length > SIMULATION_PACKET_BYTES) throw simulationFailure('causal-capacity', 'The completed causal packet exceeds the admitted transfer capacity.');
  const encoded = new TextEncoder().encodeInto(text, new Uint8Array(buffer));
  if (encoded.read !== text.length) throw simulationFailure('causal-capacity', 'The completed causal packet exceeds the admitted transfer capacity.');
  return encoded.written;
}
export function decodeSimulationPacket(buffer, bytes) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== SIMULATION_PACKET_BYTES || !simulationInteger(bytes, 1, buffer.byteLength)) throw simulationFailure('packet-invalid', 'Invalid simulation transfer lease.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, 0, bytes)));
  canonicalDataText(value, { maxBytes: SIMULATION_PACKET_BYTES, maxNodes: 500000 });
  if (value?.batch?.version !== 1 || !Array.isArray(value.batch.facts) || !Array.isArray(value.intents) ||
      value.batch.snapshot?.tick !== value.batch.tick || value.batch.snapshot?.generation !== value.batch.generation ||
      !simulationInteger(value.sequence, 1)) throw simulationFailure('packet-invalid', 'A completed packet must carry the canonical PhysicalEventBatch and its matching snapshot.');
  return freezeData(value);
}
