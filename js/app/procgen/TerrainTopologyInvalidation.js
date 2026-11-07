const topologyAnalysisJobs = new WeakMap();
const invalidateTerrainTopology = (world, bounds, revisionBefore = world.terrainRevision, { collisionChanged = true, coverageOnly = false } = {}) => {
  const state = world.terrainTopology; if (!state) return;
  const missed = state.invalidationRevision !== revisionBefore;
  for (const region of state.profiles) {
    const entry = state.regions.get(region.id); if (!entry) continue;
    const b = region.bounds, h = region.halo, intersects = !bounds || bounds.x1 < b.x2 + h && bounds.x2 > b.x1 - h && bounds.y1 < b.y2 + h && bounds.y2 > b.y1 - h;
    // Previously qualified complete geometry survives source-buffer eviction.
    if (!missed && (!collisionChanged || !intersects || coverageOnly && entry.current?.coverage === 'complete')) continue;
    entry.dirty = true;
    if (topologyAnalysisJobs.get(world)?.delete(region.id)) { entry.status = 'unknown'; entry.reason = 'source-invalidated'; entry.current = null; }
  }
  state.invalidationRevision = world.terrainRevision;
};
export { topologyAnalysisJobs, invalidateTerrainTopology };
