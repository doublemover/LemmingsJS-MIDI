import { ProcgenLaneWorld } from '../../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../../js/lemmings/LemmingStateType.js';
import { validatePickupGate, sweptPickupCrossings } from '../../js/app/procgen/workstation/physical/PickupGates.js';
export function replayPhysicalFragmentCircuit(masks, { translation = 0, reflection = false, scale = 1, ticks = 740 } = {}) {
  if (![1, 2].includes(scale) || !Number.isSafeInteger(translation) || !Number.isSafeInteger(ticks) || ticks < 1 || ticks > 10000 || reflection && scale !== 1) throw new Error('Unsupported circuit fixture.');
  const left = 20 * scale + translation, right = 81 * scale + translation, start = (reflection ? 62 : 39) * scale + translation, gateX = (reflection ? 61 : 40) * scale + translation;
  const chunks = new Map(), terrain = { chunkWidth: 256, surface: () => 72, configure() {}, reset() { chunks.clear(); }, getChunk(_seed, index) {
    if (!chunks.has(index)) { const solid = new Uint32Array(768), steel = new Uint32Array(768);
      for (let y = 0; y < 96; y++) for (let x = 0; x < 256; x++) { const worldX = index * 256 + x, bit = y * 256 + x; if (y >= 72 || (worldX === left || worldX === right) && y >= 48) solid[bit >>> 5] |= 1 << (bit & 31); }
      chunks.set(index, { solid, steel, topProfile: new Uint8Array(256).fill(72), gapWidth: 0, barrierWidth: 0 }); }
    return chunks.get(index);
  } };
  const world = new ProcgenLaneWorld({ masks, terrain, assists: false, cohorts: true, laneCount: 1, maxActors: 16 }), actor = world._spawn(0, false);
  Object.assign(actor, { x: start, y: 72, lookRight: !reflection, furthestX: start, scout: false }); actor.setAction(world.actions[State.WALKING]);
  const gate = validatePickupGate({ id: 'fixture-pickup', geometry: { kind: 'segment', points: [{ x: gateX, y: 48 }, { x: gateX, y: 73 }] } }), crossings = [];
  world.soundEvents.onBatch.on(batch => { for (const fact of batch.facts) if (fact.kind === 'MotionCommitted' && fact.actorId === actor.id && (fact.positionAfter.x > fact.positionBefore.x) === !reflection) {
    for (const crossing of sweptPickupCrossings(gate, fact.positionBefore, fact.positionAfter)) crossings.push({ tick: batch.tick, fraction: crossing.fraction, sourceEventId: fact.eventId });
  } });
  try { for (let tick = 0; tick < ticks; tick++) world.step();
    return { schema: 'physical-fragment-circuit-replay/v1', engine: 'real-shared-actions', translation, reflection, scale, ticks,
      actor: { id: actor.id, action: actor.action?.actionName, failureReason: actor.failureReason ?? null, terminalReason: actor.terminalReason ?? null }, crossings,
      periodsTicks: crossings.slice(1).map((crossing, index) => crossing.tick - crossings[index].tick), geometryScaleImpliesTimeScale: false };
  } finally { world.dispose(); }
}
