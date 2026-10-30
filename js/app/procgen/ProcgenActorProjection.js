import { PROCGEN_ACTION_LABELS, createProcgenActionCodes } from './ProcgenActorActions.js';

const leading = (a, b) => !a || b.x > a.x || b.x === a.x && b.id < a.id;
const freezeRows = rows => Object.freeze(rows.map(row => Object.freeze(row)));

// Immutable, structured-cloneable completed facts. Leases own retired versions;
// no pooled storage or live action/actor object escapes this publication boundary.
export class ProcgenActorProjection {
  constructor({ budgetAdapter = null, maxBytes = 16 * 1048576, maxVersions = 4, maxLeases = 16 } = {}) {
    this.budget = budgetAdapter; this.maxBytes = maxBytes; this.maxVersions = maxVersions; this.maxLeases = maxLeases;
    this.versions = new Set(); this.current = null; this.bytes = 0; this.peakBytes = 0; this.leases = 0; this.serial = 0; this.dropped = 0; this.allocations = 0; this.disposed = false;
  }
  publish(world) {
    if (this.disposed) return null;
    const bytes = 1024 + world.actors.length * (1536 + 8 * 8) + world.laneCount * (320 + PROCGEN_ACTION_LABELS.length * 8), token = {};
    if (this.versions.size >= this.maxVersions || this.bytes + bytes > this.maxBytes) { this.dropped++; return null; }
    try { this.budget?.reserve({ token, owner: 'actor-projection', generation: world.generation, category: 'live', bytes, pinned: true, reloadable: false }); }
    catch { this.dropped++; return null; }
    try {
      const count = world.laneCount, physicalRows = Array.from({ length: count }, () => []), semanticLanes = Array.from({ length: count }, () => []), drawRows = Array.from({ length: count }, () => []), wideDrawActors = [];
      const physicalLeaders = new Array(count).fill(null), semanticLeaders = new Array(count).fill(null), observationLeaders = new Array(count).fill(null);
      const actionMasks = new Array(count).fill(0), actionOrders = new Array(count).fill(0), actionCounts = new Array(count * PROCGEN_ACTION_LABELS.length).fill(0);
      const actors = [], liveActors = new Map(), codes = createProcgenActionCodes(world.actions), height = world.laneHeight || 96; let semanticActorCount = 0;
      for (const source of world.actors) {
        if (source.failureReason || source.removed) continue;
        liveActors.set(source.id, source);
        const code = codes.get(source.action), raw = source.action?.spriteProvider?.getActorDrawBounds?.(source);
        const bounds = raw && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(raw[key])) ? Object.freeze({ x: raw.x, y: raw.y, width: raw.width, height: raw.height }) : null;
        const actor = Object.freeze({ id: source.id, generation: world.generation, x: source.x, y: source.y, laneIndex: source.laneIndex,
          birthCohortId: source.birthCohortId ?? null, spawnLaneIndex: source.spawnLaneIndex ?? null,
          crewOriginIds: Object.freeze([...(source.crewOriginIds || [])]), crewOriginComplete: source.crewOriginComplete !== false,
          abilities: Object.freeze({ climb: !!source.canClimb, parachute: !!source.hasParachute }),
          lookRight: source.lookRight !== false, frameIndex: source.frameIndex ?? 0, actionCode: code ?? -1,
          actionName: String(PROCGEN_ACTION_LABELS[code] || source.action?.actionName || '').slice(0, 64), hasAction: !!source.action, drawBounds: bounds });
        actors.push(actor);
        let top = actor.y - 32, bottom = actor.y + 32;
        if (bounds) { top = Math.min(top, bounds.y); bottom = Math.max(bottom, bounds.y + bounds.height); }
        const first = Math.max(0, Math.floor(top / height)), last = Math.min(count - 1, Math.floor(bottom / height));
        if (last - first >= 8) wideDrawActors.push(actor);
        else for (let row = first; row <= last; row++) drawRows[row].push(actor);
        if (!Number.isFinite(actor.x) || !Number.isFinite(actor.y)) continue;
        const physical = Math.floor(actor.y / height), lane = actor.laneIndex;
        if (physical >= 0 && physical < count) { physicalRows[physical].push(actor); if (leading(physicalLeaders[physical], actor)) physicalLeaders[physical] = actor; }
        if (!Number.isInteger(lane) || lane < 0 || lane >= count) continue;
        semanticLanes[lane].push(actor); semanticActorCount++; if (leading(semanticLeaders[lane], actor)) semanticLeaders[lane] = actor;
        if (actor.hasAction && leading(observationLeaders[lane], actor)) observationLeaders[lane] = actor;
        if (code != null) {
          const bit = 1 << code;
          if (!(actionMasks[lane] & bit)) actionOrders[lane] = actionOrders[lane] * 16 + code + 1;
          actionMasks[lane] |= bit; actionCounts[lane * PROCGEN_ACTION_LABELS.length + code]++;
        }
      }
      const frame = Object.freeze({ version: 1, worldId: world.worldId ?? null, generation: world.generation, tick: world.tickIndex,
        revision: `${world.generation}:${world.tickIndex}:${++this.serial}`, batchId: world.soundEvents?.pendingBatchIdentity?.() ?? world._completedPhysicalBatchId ?? null,
        physicalSnapshotRevision: world._completedPhysicalSnapshot?.revision ?? null,
        drawBoundsRevision: world.sprites?.activePreference || world.sprites?.getPreference?.() || 'default',
        actors: Object.freeze(actors), physicalRows: freezeRows(physicalRows), semanticLanes: freezeRows(semanticLanes), drawRows: freezeRows(drawRows), wideDrawActors: Object.freeze(wideDrawActors), semanticActorCount,
        physicalLeaders: Object.freeze(physicalLeaders), semanticLeaders: Object.freeze(semanticLeaders), observationLeaders: Object.freeze(observationLeaders),
        actionMasks: Object.freeze(actionMasks), actionOrders: Object.freeze(actionOrders), actionCounts: Object.freeze(actionCounts) });
      const previous = this.current, entry = { frame, liveActors, token, bytes, readers: 0 };
      this.versions.add(entry); this.current = entry; this.bytes += bytes; this.peakBytes = Math.max(this.peakBytes, this.bytes); this.allocations++;
      this.retire(previous); return frame;
    } catch (error) {
      this.dropped++; this.lastError = String(error?.message || error);
      const failed = { frame: null, liveActors: new Map(), token, bytes, readers: 0 };
      this.versions.add(failed); this.bytes += bytes; this.retire(failed); return null;
    }
  }
  retire(entry) {
    if (!entry || entry === this.current || entry.readers || !this.versions.has(entry)) return;
    try { const receipt = this.budget?.release({ token: entry.token, owner: 'actor-projection' }); if (receipt === false || receipt?.then) throw new Error('Actor projection retirement was not acknowledged.'); } catch { this.retirementFailures = (this.retirementFailures || 0) + 1; return; }
    this.versions.delete(entry); this.bytes -= entry.bytes; entry.frame = null; entry.liveActors.clear();
  }
  acquire({ batchId = null } = {}) {
    const entry = this.current;
    if (this.disposed || !entry || batchId != null && entry.frame.batchId !== batchId || this.leases >= this.maxLeases) return null;
    entry.readers++; this.leases++; let released = false;
    const owner = this;
    return Object.freeze({ get frame() { if (released) throw new Error('Actor projection lease released.'); return entry.frame; },
      release() { if (released) return; released = true; entry.readers--; owner.leases--; owner.retire(entry); } });
  }
  stats() { return { estimatedBytes: this.bytes, peakBytes: this.peakBytes, versions: this.versions.size, leases: this.leases, allocations: this.allocations, dropped: this.dropped, retirementFailures: this.retirementFailures || 0 }; }
  dispose() { this.disposed = true; this.current = null; for (const entry of this.versions) this.retire(entry); }
}
