import { cloneData } from '../../core/CanonicalData.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
let serial = 0;
export async function captureProcgenPausedProjection(world, { x = null, firstLane = 0, laneCount = 1, width = 768, pixelWidth = 512, pixelHeight = 256, resourceBudget = null, signal, isCurrent = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), sourcePaused = true, cellBuffer = null } = {}) {
  if (!world || world._disposed || world._stepping || !Array.isArray(world.actors) || typeof world.peekGroundAt !== 'function' || typeof isCurrent !== 'function' || typeof yieldControl !== 'function' || typeof sourcePaused !== 'boolean' || cellBuffer !== null && (!(cellBuffer instanceof Uint8Array) || cellBuffer.byteOffset || cellBuffer.byteLength !== cellBuffer.buffer.byteLength || cellBuffer.length !== pixelWidth * pixelHeight) ||
      !Number.isSafeInteger(firstLane) || firstLane < 0 || firstLane >= world.laneCount || !Number.isSafeInteger(laneCount) || laneCount < 1 || laneCount > 4 || !Number.isSafeInteger(width) || width < 64 || width > 8192 ||
      !Number.isSafeInteger(pixelWidth) || pixelWidth < 64 || pixelWidth > 1024 || !Number.isSafeInteger(pixelHeight) || pixelHeight < 64 || pixelHeight > 512 || pixelWidth * pixelHeight > 262144 || x !== null && (!Number.isFinite(x) || x < 0 || x > 0x7fffffff)) throw new TypeError('A physical projection requires a bounded paused world viewport.');
  const tick = world.tickIndex, generation = world.generation, terrainRevision = world.terrainRevision, worldId = world.worldId;
  const check = () => { signal?.throwIfAborted(); if (world._disposed || world._stepping || world.tickIndex !== tick || world.generation !== generation || world.terrainRevision !== terrainRevision || !isCurrent()) throw new Error('The completed world changed during projection.'); };
  check(); const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'paused-world-projection:' + (++serial), kind: 'immutable-physical-viewport', category: 'checkpoint', bytes: 4 * 1048576 });
  let value = null, released = false;
  try {
    laneCount = Math.min(laneCount, world.laneCount - firstLane);
    const firstActor = world.actors.find(actor => !actor.removed && !actor.failureReason && actor.laneIndex >= firstLane && actor.laneIndex < firstLane + laneCount);
    const originX = Math.floor(x ?? Math.max(0, (firstActor?.x ?? world.leftEdgeX ?? 0) - width / 3)), originY = firstLane * world.laneHeight, height = laneCount * world.laneHeight;
    const cells = cellBuffer || new Uint8Array(pixelWidth * pixelHeight); let unknownCells = 0;
    for (let py = 0; py < pixelHeight; py++) {
      check(); const y = Math.floor(originY + (py + 0.5) * height / pixelHeight);
      for (let px = 0; px < pixelWidth; px++) { const x = Math.floor(originX + (px + 0.5) * width / pixelWidth), solid = world.peekGroundAt(x, y), steel = solid === true ? world.peekSteelAt?.(x, y) : false;
        const cell = solid === null ? 3 : solid ? steel === true ? 2 : 1 : 0; cells[py * pixelWidth + px] = cell; if (cell === 3) unknownCells++; }
      if ((py + 1) % 8 === 0) await yieldControl();
    }
    const actors = []; let visibleActors = 0;
    for (let index = 0; index < world.actors.length; index++) {
      const actor = world.actors[index]; if (actor.removed || actor.failureReason || actor.x < originX || actor.x >= originX + width || actor.y < originY || actor.y >= originY + height) continue;
      visibleActors++; if (actors.length < 4096) actors.push({ actorId: actor.id, laneId: actor.laneIndex, x: actor.x, y: actor.y, direction: actor.lookRight ? 'right' : 'left', frameIndex: actor.frameIndex,
        action: actor.action?.getActionName?.() || actor.action?.actionName || null, actionInstanceId: actor._physicalActionInstanceId ?? null, birthCohortId: actor.birthCohortId ?? null,
        abilities: { climb: !!actor.canClimb, parachute: !!actor.hasParachute } });
      if ((index + 1) % 256 === 0) { check(); await yieldControl(); }
    }
    check(); const metadata = cloneData({ schema: sourcePaused ? 'lemmings-paused-world-projection/v1' : 'lemmings-completed-world-projection/v1', worldId, generation, tick, terrainRevision, worldWidth: world.width, worldLaneCount: world.laneCount,
      viewport: { x: originX, y: originY, width, height, firstLane, laneCount, laneHeight: world.laneHeight, pixelWidth, pixelHeight }, actors, visibleActors, omittedActors: visibleActors - actors.length, unknownCells,
      terrain: 'read-only-collision-samples;unmaterialized-cells-explicitly-unknown', paused: sourcePaused, hardware: false, audio: false, recording: false }, { maxBytes: 2 * 1048576, maxNodes: 131072 });
    value = Object.freeze({ ...metadata, cells });
    return Object.freeze({ read: () => { if (released) throw new Error('The paused projection retired.'); return value; }, release() { if (released) return false; released = true; value = null; return reservation.release(); } });
  } catch (error) { reservation.release(); throw error; }
}

export function normalizeProcgenViewport(value = {}, lanes, live = false) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !['x', 'firstLane', 'laneCount', 'width', 'pixelWidth', 'pixelHeight'].includes(key)) || Object.values(value).some(value => !Number.isSafeInteger(value) || value < 0) || !Number.isSafeInteger(lanes) || lanes < 1) throw new Error('Choose a bounded immutable physical viewport.');
  const result = { firstLane: 0, laneCount: 1, width: 768, pixelWidth: live ? 256 : 512, pixelHeight: live ? 128 : 256, ...value };
  if (result.firstLane >= lanes || result.laneCount < 1 || result.laneCount > 4 || result.width < 64 || result.width > 8192 || result.pixelWidth < 64 || result.pixelWidth > (live ? 512 : 1024) || result.pixelHeight < 64 || result.pixelHeight > (live ? 256 : 512) || result.pixelWidth * result.pixelHeight > (live ? 131072 : 262144)) throw new Error('The requested physical viewport exceeds its bounded collision/actor profile.'); return result;
}
