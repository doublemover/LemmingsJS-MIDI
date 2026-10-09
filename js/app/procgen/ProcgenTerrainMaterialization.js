const MAX_MATERIALIZATION_JOBS = 32;

// Foundation sections cover complete source motif spans. Edge clipping is at
// the existing chunk seam; the scheduler never invents a pixel-strip quantum.
const createTerrainGrowthPlan = ({ descriptor, pattern, route, pieces, assemblies, sourceRevision }) => {
  const width = 128, height = 96, jobs = [], foundationSections = [], foundationByColumn = new Uint8Array(width);
  const placementJobs = new Uint8Array(descriptor.placements.length), objectJobs = new Uint8Array(descriptor.objects.length);
  const add = (kind, bounds, dependencies, sourceIds, extra = {}) => {
    const index = jobs.length;
    if (index >= MAX_MATERIALIZATION_JOBS) throw new RangeError('Source materialization exceeds its bounded job budget');
    const clipped = { x1: Math.max(0, bounds.x1), x2: Math.min(width, bounds.x2), y1: Math.max(0, bounds.y1), y2: Math.min(height, bounds.y2) };
    jobs.push(Object.freeze({ id: `${descriptor.origin}:${kind}:${index}`, index, kind, ...clipped,
      dependencies: Object.freeze([...new Set(dependencies)]), sourceIds: Object.freeze([...new Set(sourceIds)]), sourceRevision, ...extra }));
    return index;
  };
  const extent = Math.max(route.period, ...route.placements.map(p => p.x + pieces.get(p.id).width)) - Math.min(0, ...route.placements.map(p => p.x));
  const span = Math.min(width, Math.max(1, extent)), intervals = [];
  for (let left = -descriptor.origin % span; left < width; left += span) intervals.push({ x1: Math.max(0, left), x2: Math.min(width, left + span) });
  const terrainJobs = new Set(descriptor.placements.map(p => p.assembly || (p.letter ? descriptor.word : p))).size;
  const maximumSections = Math.max(1, Math.min(16, MAX_MATERIALIZATION_JOBS - terrainJobs - descriptor.objects.length));
  const batch = Math.max(1, Math.ceil(intervals.length / maximumSections)), sourceIds = route.placements.map(p => p.id);
  for (let at = 0; at < intervals.length; at += batch) {
    const x1 = intervals[at].x1, x2 = intervals[Math.min(intervals.length - 1, at + batch - 1)].x2;
    const index = add('foundation', { x1, x2, y1: 0, y2: height }, foundationSections.length ? [foundationSections.at(-1).index] : [], sourceIds,
      { sourceMotif: route.id, sourceSpan: span, sourcePeriod: route.period });
    const section = Object.freeze({ index, x1, x2 }); foundationSections.push(section); foundationByColumn.fill(index, x1, x2);
  }
  const foundationDeps = (x1, x2) => foundationSections.filter(section => section.x2 > x1 && section.x1 < x2).map(section => section.index);
  const terrainGroups = new Map(), assemblyTerrain = new Map();
  for (let at = 0; at < descriptor.placements.length; at++) {
    const p = descriptor.placements[at], key = p.assembly || (p.letter ? descriptor.word : p);
    let group = terrainGroups.get(key); if (!group) { group = []; terrainGroups.set(key, group); }
    group.push(at);
  }
  let priorCanonicalJob = null;
  for (const [key, members] of terrainGroups) {
    const placements = members.map(at => descriptor.placements[at]), x1 = Math.min(...placements.map(p => p.x)), x2 = Math.max(...placements.map(p => p.x + p.piece.width));
    const y1 = Math.min(...placements.map(p => p.y)), y2 = Math.max(...placements.map(p => p.y + p.piece.height));
    const ids = placements.flatMap(p => p.canonicalGroup ? p.canonicalGroup.placements.map(p => p.id) : [p.piece.id]);
    const dependencies = foundationDeps(x1, x2), canonical = placements[0].canonicalGroup;
    if (canonical && priorCanonicalJob != null) dependencies.push(priorCanonicalJob);
    const index = add('terrain', { x1, x2, y1, y2 }, dependencies, ids, { placementIndices: Object.freeze(members), ...(canonical ? { sourceGroup: canonical, orderedSource: true } : {}) });
    if (canonical) priorCanonicalJob = index;
    for (const at of members) placementJobs[at] = index;
    if (placements[0].assembly) assemblyTerrain.set(key, index);
  }
  const objectGroups = new Map();
  for (let at = 0; at < descriptor.objects.length; at++) {
    const object = descriptor.objects[at], key = object.assembly || object;
    let group = objectGroups.get(key); if (!group) { group = []; objectGroups.set(key, group); } group.push(at);
  }
  for (const [key, members] of objectGroups) {
    const objects = members.map(at => descriptor.objects[at]), assembly = objects[0].assembly, compiled = assembly && assemblies?.get(assembly.id);
    let order = null;
    if (compiled && Number.isInteger(assembly.supportMember)) {
      const depths = new Int16Array(compiled.members.length); depths.fill(-1); depths[assembly.supportMember] = 0;
      for (let pass = 0; pass < compiled.members.length; pass++) for (const edge of compiled.entry.relations) {
        if (depths[edge.a] >= 0 && depths[edge.b] < 0) depths[edge.b] = depths[edge.a] + 1;
        if (depths[edge.b] >= 0 && depths[edge.a] < 0) depths[edge.a] = depths[edge.b] + 1;
      }
      const objectMembers = compiled.objects.map(member => compiled.members.indexOf(member));
      if (objects.length === objectMembers.length && objectMembers.every(member => depths[member] >= 0))
        order = members.map((at, index) => ({ at, member: objectMembers[index], depth: depths[objectMembers[index]] })).sort((a, b) => a.depth - b.depth || a.member - b.member);
    }
    if (order) {
      const emitted = new Map();
      for (const { at, member, depth } of order) {
        const object = descriptor.objects[at], x1 = assembly.bounds.x1 - descriptor.origin, x2 = assembly.bounds.x2 - descriptor.origin;
        const dependencies = foundationDeps(x1, x2); if (assemblyTerrain.has(key)) dependencies.push(assemblyTerrain.get(key));
        for (const edge of compiled.entry.relations) {
          const neighbor = edge.a === member ? edge.b : edge.b === member ? edge.a : -1;
          if (emitted.has(neighbor)) dependencies.push(emitted.get(neighbor));
        }
        const index = add('object', { x1, x2, y1: object.y, y2: object.y + object.piece.image.height }, dependencies, [object.piece.id],
          { objectIndices: Object.freeze([at]), attachmentDepth: depth, assemblyMember: member });
        objectJobs[at] = index; emitted.set(member, index);
      }
    } else {
      const x1 = assembly ? assembly.bounds.x1 - descriptor.origin : Math.min(...objects.map(o => o.x - descriptor.origin - (o.role === 'liquid' ? 1 : 0)));
      const x2 = assembly ? assembly.bounds.x2 - descriptor.origin : Math.max(...objects.map(o => o.x - descriptor.origin + o.piece.image.width + (o.role === 'liquid' ? 1 : 0)));
      const y1 = Math.min(...objects.map(o => o.y)), y2 = Math.max(...objects.map(o => o.y + o.piece.image.height));
      const dependencies = foundationDeps(x1, x2); if (assemblyTerrain.has(key)) dependencies.push(assemblyTerrain.get(key));
      const index = add('object', { x1, x2, y1, y2 }, dependencies, objects.map(o => o.piece.id),
        { objectIndices: Object.freeze(members), attachmentFallback: !!assembly });
      for (const at of members) objectJobs[at] = index;
    }
  }
  return Object.freeze({ descriptor, jobs: Object.freeze(jobs), foundationSections: Object.freeze(foundationSections),
    foundationByColumn, placementJobs, objectJobs, sourceMotif: route.id, sourceRevision, patternWidth: pattern.width });
};
export { createTerrainGrowthPlan, MAX_MATERIALIZATION_JOBS };
