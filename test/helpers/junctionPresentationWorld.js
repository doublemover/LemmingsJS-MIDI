import { EventHandler } from '../../js/util/EventHandler.js';
import { validatePhysicalJunction } from '../../js/app/procgen/PhysicalJunctions.js';

export const junctionDefinition = () => validatePhysicalJunction({ id: 'switch', revision: 1, safetyVersion: 1,
  control: { x1: 100, x2: 104, y1: 60, y2: 62 }, influence: { x1: 88, x2: 116, y1: 40, y2: 90 },
  ports: [{ id: 'in', role: 'inlet', position: { x: 92, y: 71 }, direction: 'right' }, { id: 'out', role: 'outlet', position: { x: 110, y: 71 }, direction: 'right' }],
  configurations: [false, true].map(solid => ({ id: solid ? 'closed' : 'open', outletIds: ['out'], spans: [60, 61].map(y => ({ y, x1: 100, x2: 104, solid })) })) });

export const junctionPresentationWorld = () => {
  const definition = junctionDefinition(), resources = { held: new Map(), retain(key, bytes) { this.held.set(key, bytes); }, release(key) { this.held.delete(key); } };
  const state = { authoringRevision: 1, actual: { configurationId: 'open', commandId: 'apply:one', appliedTick: 0, status: 'observed-at-application' }, pending: [], receipts: [] };
  const world = { worldId: 'junction-world', generation: 1, tickIndex: 0, laneHeight: 96, physicalJunctions: { definitions: [definition] }, soundEvents: { onBatch: new EventHandler() },
    queryJunction: id => world.physicalJunctions.definitions.some(value => value.id === id) ? structuredClone(state) : null };
  let sequence = 0;
  const emit = (movements = [], { status = 'complete', tick = world.tickIndex + 1 } = {}) => {
    world.tickIndex = tick; const batchId = `junction-world:1:${tick}:${sequence++}`;
    const facts = movements.map((value, index) => ({ kind: 'MotionCommitted', actorId: value.actorId ?? 1, worldId: world.worldId, generation: world.generation, batchId,
      eventId: `${batchId}:${index}`, simTick: tick, positionBefore: { x: value.from, y: value.y ?? 70 }, positionAfter: { x: value.to, y: value.y ?? 70 },
      physicalPayload: { pathEvidence: value.precision ?? 'committed-coordinate-write' }, ...value.fact }));
    const batch = { worldId: world.worldId, generation: world.generation, tick, batchId, facts, completeness: { status } };
    world.soundEvents.onBatch.trigger(batch); return batch;
  };
  return { world, state, resources, definition, emit };
};
