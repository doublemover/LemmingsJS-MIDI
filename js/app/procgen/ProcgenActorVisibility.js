// Reuse bounded physical-row buckets during camera-only redraws. Cosmetic
// origins are included, so trap presentations can cross their simulation row.
class ProcgenActorVisibility {
  constructor(world) { this.world = world; this.rows = []; this.wide = []; this.bounds = new Map(); this.seen = new Set(); this.candidates = []; this.tick = null; }
  update(force = false) {
    const world = this.world, height = world.laneHeight || 96, count = world.laneCount;
    const appearance = world.sprites?.activePreference || world.sprites?.getPreference?.();
    if (!force && this.tick === world.tickIndex && this.generation === world.generation && this.actors === world.actors && this.actorCount === world.actors.length && this.sprites === world.sprites && this.appearance === appearance && this.height === height) return false;
    if (this.rows.length !== count) this.rows = Array.from({ length: count }, () => []);
    for (const row of this.rows) row.length = 0;
    this.wide.length = 0; this.bounds.clear();
    for (const actor of world.actors) {
      if (actor.failureReason || actor.removed) continue;
      const bounds = actor.action?.spriteProvider?.getActorDrawBounds?.(actor) || null;
      this.bounds.set(actor, bounds);
      let top = actor.y - 32, bottom = actor.y + 32;
      if (bounds && Number.isFinite(bounds.y) && Number.isFinite(bounds.height)) { top = Math.min(top, bounds.y); bottom = Math.max(bottom, bounds.y + bounds.height); }
      const first = Math.max(0, Math.floor(top / height)), last = Math.min(count - 1, Math.floor(bottom / height));
      // Unusual supplied presentations retain exact culling with O(live) storage.
      if (last - first >= 8) this.wide.push(actor);
      else for (let row = first; row <= last; row++) this.rows[row].push(actor);
    }
    this.tick = world.tickIndex; this.generation = world.generation; this.actors = world.actors; this.actorCount = world.actors.length;
    this.sprites = world.sprites; this.appearance = appearance; this.height = height; this.rebuilds = (this.rebuilds || 0) + 1; return true;
  }
  query(y, height, force = false) {
    this.update(force); this.seen.clear(); this.candidates.length = 0;
    const add = actor => { if (!this.seen.has(actor)) { this.seen.add(actor); this.candidates.push(actor); } };
    const first = Math.max(0, Math.floor(y / this.height)), last = Math.min(this.rows.length - 1, Math.floor((y + height) / this.height));
    for (let row = first; row <= last; row++) for (const actor of this.rows[row]) add(actor);
    for (const actor of this.wide) add(actor);
    return this.candidates;
  }
  dispose() { this.rows.length = 0; this.wide.length = 0; this.candidates.length = 0; this.bounds.clear(); this.seen.clear(); this.actors = this.world = this.sprites = this.appearance = null; }
}
export { ProcgenActorVisibility };
