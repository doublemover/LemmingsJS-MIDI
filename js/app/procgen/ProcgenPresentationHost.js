import { createProcgenPresentationSnapshot, readProcgenCanvasRect, sameProcgenRect, hitProcgenPresentation, procgenPresentationStats } from './ProcgenPresentationSnapshot.js';

const layoutKey = renderer => {
  const layout = renderer.workstationLayout;
  return layout ? [layout.mode, layout.firstLane, layout.count, layout.rowHeight, layout.stripHeight].join(':') : 'world';
};

class ProcgenPresentationHost {
  constructor(renderer) {
    this.renderer = renderer; this.current = null; this.retained = new Map(); this.leases = new Map(); this.listeners = new Set(); this.geometryListeners = new Set(); this.suspensions = new Map();
    this.revision = 0; this.projectionRevision = 0; this.demandRevision = 0; this.reason = 'Wait for the world display to present.'; this.disposed = false; this.maxLeases = 32;
  }
  domKey() { const rect = this.demanded && readProcgenCanvasRect(this.renderer.canvas, this.renderer.window); return rect ? [rect.left, rect.top, rect.width, rect.height].join(':') : 'hidden'; }
  get demanded() { return this.entitiesDemanded || this.geometryListeners.size > 0; }
  get entitiesDemanded() { return this.listeners.size > 0 || this.leases.size > 0; }
  subscribe(listener, { entities = true } = {}) {
    if (this.disposed) return () => {};
    const before = this.demanded, beforeEntities = this.entitiesDemanded, listeners = entities ? this.listeners : this.geometryListeners;
    listeners.add(listener); if (!before || beforeEntities !== this.entitiesDemanded) this.demandRevision++;
    if (!beforeEntities && this.entitiesDemanded && this.current) this.invalidate('World entity inspection is preparing.');
    let released = false;
    return () => { if (released) return; released = true; const beforeEntities = this.entitiesDemanded; listeners.delete(listener); if (beforeEntities !== this.entitiesDemanded) this.demandRevision++; if (!this.demanded) this.invalidate('World inspection is inactive.'); };
  }
  _notify() { for (const listeners of [this.listeners, this.geometryListeners]) for (const listener of listeners) { try { listener(this.current, this.reason); } catch { /* Inspector callbacks cannot break a paint. */ } } }
  _retire(snapshot) {
    if (!snapshot || snapshot === this.current || [...this.leases.values()].some(record => record.snapshot === snapshot)) return;
    const key = this.retained.get(snapshot); if (key) this.renderer.resources.release(key); this.retained.delete(snapshot);
  }
  suspend(owner, reason = 'World input is waiting for the display transition.') {
    if (this.disposed || !owner || this.suspensions.size >= 8) return null;
    const token = {}; this.suspensions.set(token, { owner, reason: String(reason).slice(0, 200) }); this.invalidate(String(reason).slice(0, 200));
    let released = false;
    return () => { if (released) return; released = true; this.suspensions.delete(token); if (!this.disposed && !this.suspensions.size) { this.demandRevision++; this.reason = 'World input is waiting for a coherent presented frame.'; this.renderer.lastFrameKey = null; this._notify(); } };
  }
  publish(entities, beforeNotify = null) {
    if (this.disposed || !this.demanded || this.suspensions.size) return null;
    const renderer = this.renderer, world = renderer.world, rect = readProcgenCanvasRect(renderer.canvas, renderer.window);
    if (!rect) { this.invalidate('The world display has no visible content area.'); return null; }
    const dpr = renderer.presentationDpr || Math.min(2, renderer.window.devicePixelRatio || 1), logicalSize = { width: renderer.canvas.width / dpr, height: renderer.canvas.height / dpr };
    const rows = renderer.workstationLayout ? renderer.workstationRows.map(row => ({ ...row })) : [];
    if (!renderer.workstationLayout) {
      const mainHeight = logicalSize.height - (renderer.overviewBandHeight || 0), first = Math.max(0, Math.floor(renderer.originY / renderer.laneHeight));
      const last = Math.min(world.laneCount - 1, Math.ceil((renderer.originY + renderer.viewHeight) / renderer.laneHeight) - 1);
      for (let lane = first; lane <= last; lane++) {
        const sourceY = Math.max(renderer.originY, lane * renderer.laneHeight), bottom = Math.min(renderer.originY + renderer.viewHeight, (lane + 1) * renderer.laneHeight);
        rows.push({ lane, sourceY, sourceHeight: bottom - sourceY, destinationY: (sourceY - renderer.originY) / renderer.viewHeight * mainHeight, destinationHeight: (bottom - sourceY) / renderer.viewHeight * mainHeight });
      }
    }
    const key = layoutKey(renderer), geometry = [key, renderer.originX, renderer.viewWidth, rect.left, rect.top, rect.width, rect.height, renderer.canvas.width, renderer.canvas.height,
      ...rows.flatMap(row => [row.lane, row.sourceY, row.sourceHeight, row.destinationY, row.destinationHeight])].join(':');
    if (geometry !== this.geometry || this.current?.generation !== world.generation) this.projectionRevision++;
    if (this.current && this.current.generation !== world.generation) this.invalidate('The world generation changed.');
    this.geometry = geometry;
    const snapshot = createProcgenPresentationSnapshot({ worldId: world.worldId, generation: world.generation, tick: world.tickIndex, terrainRevision: world.terrainRevision,
      revision: ++this.revision, projectionRevision: this.projectionRevision, rect, backingSize: { width: renderer.canvas.width, height: renderer.canvas.height }, logicalSize,
      originX: renderer.originX, viewWidth: renderer.viewWidth, laneHeight: renderer.laneHeight, layoutKey: key, rows, entities });
    if (!snapshot) { this.invalidate('The world projection is not ready.'); return null; }
    const previous = this.current; this.current = null; this._retire(previous);
    const reservation = {}, estimatedBytes = procgenPresentationStats(snapshot).estimatedBytes;
    try { renderer.resources.retain(reservation, estimatedBytes, 'presentation'); }
    catch { this.invalidate('World inspection is unavailable within the display resource budget.'); return null; }
    this.retained.set(snapshot, reservation); this.current = snapshot; this.reason = ''; beforeNotify?.(snapshot); this._notify(); return snapshot;
  }
  valid(snapshot = this.current, { edit = false, frozen = false } = {}) {
    const renderer = this.renderer;
    if (!snapshot || this.disposed || this.suspensions.size || renderer.lifecycleState !== 'ready' || !renderer.world || renderer.world.generation !== snapshot.generation || renderer.world.worldId !== snapshot.worldId ||
        layoutKey(renderer) !== snapshot.layoutKey || renderer.canvas.width !== snapshot.backingSize.width || renderer.canvas.height !== snapshot.backingSize.height ||
        !sameProcgenRect(snapshot.rect, readProcgenCanvasRect(renderer.canvas, renderer.window))) return false;
    if (edit) return snapshot === this.current && snapshot.capabilities.edit && renderer.world.tickIndex === snapshot.physicalTick && renderer.world.terrainRevision === snapshot.terrainRevision;
    return frozen || snapshot === this.current;
  }
  getSnapshot() {
    if (this.current && !this.valid()) this.invalidate('The world display is preparing a new projection.');
    return this.current;
  }
  acquire(owner, { purpose = 'inspect' } = {}) {
    const snapshot = this.getSnapshot();
    if (!owner || !snapshot || !this.entitiesDemanded || purpose !== 'inspect' || this.leases.size >= this.maxLeases) return null;
    const record = { owner, snapshot, active: true };
    const lease = Object.freeze({ owner, purpose, get active() { return record.active; }, get snapshot() { return record.active ? record.snapshot : null; },
      release: () => { if (!record.active) return; const beforeEntities = this.entitiesDemanded; record.active = false; this.leases.delete(lease); if (beforeEntities !== this.entitiesDemanded) this.demandRevision++; const prior = record.snapshot; record.snapshot = null; this._retire(prior);
        if (!this.demanded) this.invalidate('World inspection is inactive.'); } });
    this.leases.set(lease, record); return lease;
  }
  accepts(lease) { const record = this.leases.get(lease); return !!record?.active && this.valid(record.snapshot, { frozen: lease.purpose === 'inspect' }); }
  pick(clientX, clientY, lease = null) {
    const snapshot = lease ? this.accepts(lease) && lease.snapshot : this.getSnapshot();
    return snapshot ? hitProcgenPresentation(snapshot, clientX, clientY) : [];
  }
  invalidate(reason = 'The world display is preparing a new projection.') {
    this.demandRevision++;
    const previousReason = this.reason; this.reason = reason; const previous = this.current; this.current = null;
    for (const [lease, record] of this.leases) { record.active = false; record.snapshot = null; this.leases.delete(lease); }
    for (const key of this.retained.values()) this.renderer.resources.release(key);
    this.retained.clear(); if (previous || previousReason !== reason) this._notify();
  }
  getStatus() { return { available: !!this.current, reason: this.reason, revision: this.current?.revision ?? null, retainedSnapshots: this.retained.size, leases: this.leases.size, suspended: this.suspensions.size > 0 }; }
  dispose() { if (this.disposed) return; this.disposed = true; this.invalidate('World inspection has closed.'); this.listeners.clear(); this.geometryListeners.clear(); this.suspensions.clear(); this.renderer = null; }
}

export { ProcgenPresentationHost };
