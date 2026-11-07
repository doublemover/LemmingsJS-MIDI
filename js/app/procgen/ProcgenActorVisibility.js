import { ProcgenActorProjection } from './ProcgenActorProjection.js';
import { PROCGEN_ACTION_LABELS } from './ProcgenActorActions.js';

const registered = new WeakMap();
const registerProcgenActorVisibility = (world, visibility) => { registered.set(world, visibility); };
const getProcgenActorVisibility = world => registered.get(world) || null;
const publishProcgenActorVisibility = world => registered.get(world)?.publish();

// Reuse bounded physical-row buckets during camera-only redraws. Cosmetic
// origins are included, so trap presentations can cross their simulation row.
class ProcgenActorVisibility {
  constructor(world, options = {}) { this.projections = new ProcgenActorProjection(options); this.liveActors = new Map(); this.world = world; this.rows = []; this.physicalRows = []; this.semanticLanes = []; this.physicalLeaders = []; this.semanticLeaders = [];
    this.observationLeaders = []; this.actionMasks = new Uint16Array(0); this.actionOrders = new Float64Array(0); this.actionCounts = new Uint32Array(0);
    this.actorIds = new Map();
    this.wide = []; this.bounds = new Map(); this.seen = new Set(); this.candidates = []; this.tick = null; this.actorScans = 0; this.queryVisits = 0; this.retainedActorCount = 0; }
  publish(force = false) {
    const world = this.world, height = world.laneHeight || 96;
    if (world._stepping && world._musicCompletedTick !== world.tickIndex) { this.deferredPublications = (this.deferredPublications || 0) + 1; return false; }
    const appearance = world.sprites?.activePreference || world.sprites?.getPreference?.();
    if (!force && this.isCurrent()) return false;
    const frame = this.projections.publish(world); if (!frame) return false;
    for (const key of ['physicalRows', 'semanticLanes', 'physicalLeaders', 'semanticLeaders', 'observationLeaders', 'actionMasks', 'actionOrders', 'actionCounts']) this[key] = frame[key];
    this.actorIds.clear();
    for (const actor of frame.actors) this.actorIds.set(actor.id, actor);
    this.liveActors = this.projections.current.liveActors; this.actorScans += world.actors.length; this.retainedActorCount = frame.semanticActorCount;
    this.actionOwner = world.actions; this.projectionAppearance = appearance; this.projectionSprites = world.sprites;
    this.tick = world.tickIndex; this.generation = world.generation; this.actors = world.actors; this.actorCount = world.actors.length;
    this.height = height; this.laneCount = world.laneCount; this.revision = frame.revision;
    this.publications = (this.publications || 0) + 1; this.displayTick = null; return true;
  }
  update(force = false) {
    this.publish(force);
    const world = this.world;
    if (world._stepping && world._musicCompletedTick !== world.tickIndex || !this.isCurrent()) return false;
    const appearance = world.sprites?.activePreference || world.sprites?.getPreference?.();
    if (!force && this.displayTick === this.tick && this.displayGeneration === this.generation && this.sprites === world.sprites && this.appearance === appearance) return false;
    const frame = this.projections.current.frame; this.rows = frame.drawRows; this.wide = frame.wideDrawActors; this.bounds.clear();
    this.displayTick = this.tick; this.displayGeneration = this.generation; this.sprites = world.sprites; this.appearance = appearance;
    this.rebuilds = (this.rebuilds || 0) + 1; return true;
  }
  query(y, height, force = false) {
    this.update(force); this.seen.clear(); this.candidates.length = 0;
    if (!this.isCurrent()) return this.candidates;
    const add = record => {
      this.queryVisits++; const actor = this.liveActors.get(record.id); if (!actor || this.seen.has(actor)) return;
      this.seen.add(actor); this.bounds.set(actor, record.drawBounds); this.candidates.push(actor);
    };
    const first = Math.max(0, Math.floor(y / this.height)), last = Math.min(this.rows.length - 1, Math.floor((y + height) / this.height));
    for (let row = first; row <= last; row++) for (const actor of this.rows[row]) add(actor);
    for (const actor of this.wide) add(actor);
    return this.candidates;
  }
  isCurrent() {
    const world = this.world;
    return !!world && !(world._stepping && world._musicCompletedTick !== world.tickIndex) && this.tick === world.tickIndex && this.generation === world.generation && this.actors === world.actors && this.actorCount === world.actors.length && this.height === (world.laneHeight || 96) && this.laneCount === world.laneCount &&
      this.actionOwner === world.actions && this.projectionSprites === world.sprites && this.projectionAppearance === (world.sprites?.activePreference || world.sprites?.getPreference?.());
  }
  acquireSnapshot(options) { this.publish(); return this.isCurrent() ? this.projections.acquire(options) : null; }
  renderActor(id, revision = this.revision) { return this.isCurrent() && revision === this.revision ? this.liveActors.get(id) || null : null; }
  physicalLeader(first, last, force = false) {
    this.publish(force); if (!this.isCurrent()) return null; const lease = this.projections.acquire(); if (!lease) return null;
    try {
      let leader = null;
      for (let lane = Math.max(0, first); lane < Math.min(lease.frame.physicalLeaders.length, last); lane++) {
        const actor = lease.frame.physicalLeaders[lane]; this.queryVisits++;
        if (actor && (!leader || actor.x > leader.x || actor.x === leader.x && actor.id < leader.id)) leader = actor;
      }
      return leader;
    } finally { lease.release(); }
  }
  physicalActors(lane) { this.publish(); return this.isCurrent() ? this.physicalRows[lane] || [] : []; }
  semanticActors(lane) { this.publish(); return this.isCurrent() ? this.semanticLanes[lane] || [] : []; }
  semanticLeader(lane) { this.publish(); return this.isCurrent() ? this.semanticLeaders[lane] || null : null; }
  semanticObservationLeader(lane) { this.publish(); this.queryVisits++; return this.isCurrent() ? this.observationLeaders[lane] || null : null; }
  semanticActionMask(lane) { this.publish(); return this.isCurrent() ? this.actionMasks[lane] || 0 : 0; }
  semanticActionOrder(lane) { this.publish(); return this.isCurrent() ? this.actionOrders[lane] || 0 : 0; }
  semanticActionCount(lane, label) {
    this.publish(); const code = PROCGEN_ACTION_LABELS.indexOf(label);
    return !this.isCurrent() || code < 0 || lane < 0 || lane >= this.semanticLanes.length ? 0 : this.actionCounts[lane * PROCGEN_ACTION_LABELS.length + code];
  }
  actorById(id) { this.publish(); return this.isCurrent() ? this.actorIds.get(id) || null : null; }
  getStats() { return { revision: this.revision || null, publications: this.publications || 0, rebuilds: this.rebuilds || 0,
    actorScans: this.actorScans, drawScans: this.drawScans || 0, queryVisits: this.queryVisits, deferredPublications: this.deferredPublications || 0,
    actionIndexBytes: this.actionMasks.length * 2 + this.actionOrders.length * 8 + this.actionCounts.length * 4, projection: this.projections.stats(),
    retainedActors: this.retainedActorCount }; }
  dispose() { if (registered.get(this.world) === this) registered.delete(this.world);
    this.projections.dispose(); this.liveActors = new Map();
    this.rows = []; this.physicalRows = []; this.semanticLanes = []; this.physicalLeaders = []; this.semanticLeaders = []; this.retainedActorCount = 0;
    this.observationLeaders = []; this.actionMasks = []; this.actionOrders = []; this.actionCounts = []; this.actionOwner = null; this.actorIds.clear();
    this.wide = []; this.candidates.length = 0; this.bounds.clear(); this.seen.clear(); this.actors = this.world = this.sprites = this.appearance = null; }
}
export { ProcgenActorVisibility, registerProcgenActorVisibility, getProcgenActorVisibility, publishProcgenActorVisibility };
