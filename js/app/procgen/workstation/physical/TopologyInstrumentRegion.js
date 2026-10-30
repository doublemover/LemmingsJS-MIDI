import { plain, identity, integer, finite, freeze, copy } from './PhysicalSchema.js';
const componentIdentity = value => typeof value === 'string' && value.length <= 512 && /^[a-z0-9][a-z0-9._:/-]*$/i.test(value);
const keys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const seal = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) seal(child); Object.freeze(value); } return value; };
const MAX_AREA = 65536, MAX_COMPONENTS = 256, admittedResults = new WeakSet();
const definitionSignatures = new WeakMap();
export function topologyDefinitionSignature(region) {
  let signature = definitionSignatures.get(region);
  if (!signature) { signature = JSON.stringify(validateTopologyRegion(region)); if (Object.isFrozen(region) && Object.isFrozen(region.mapping) && Object.isFrozen(region.bounds) && Object.isFrozen(region.anchors) && region.anchors.every(Object.isFrozen)) definitionSignatures.set(region, signature); }
  return signature;
}
export function validateTopologyRegion(value) {
  const b = value?.bounds, m = value?.mapping;
  if (!plain(value) || !identity(value.id) || value.id.length > 128 || !integer(value.revision) || !keys(b, ['x1', 'x2', 'y1', 'y2']) || ![b.x1, b.y1, b.x2, b.y2].every(value => Number.isSafeInteger(value) && Math.abs(value) <= 1e9) || b.x1 < 0 || b.y1 < 0 || b.x2 <= b.x1 || b.y2 <= b.y1 || (b.x2 - b.x1) * (b.y2 - b.y1) > MAX_AREA || ![4, 8].includes(value.connectivity ?? 4) || !['free', 'solid'].includes(value.space ?? 'free')) throw new Error('Invalid bounded topology region.');
  const halo = value.halo ?? 1;
  if (!integer(halo, 4) || !halo || !['endOfTick', 'postTransaction'].includes(value.bindingPolicy ?? 'endOfTick') || !['retain-onset', 'retune-stable', 'release-on-change'].includes(value.heldPolicy ?? 'release-on-change')) throw new Error('Invalid topology binding policy.');
  if (!plain(m) || !integer(m.revision) || !identity(m.bodyId) || m.bodyId.length > 128 || !finite(m.basePitchCents, 24000) || !finite(m.referenceAreaPixels2, MAX_AREA) || m.referenceAreaPixels2 <= 0 || !finite(m.areaCentsPerOctave ?? -600, 2400) || !finite(m.boundaryDampingScale ?? 0.1, 1) || (m.boundaryDampingScale ?? 0.1) < 0 || !finite(m.openDamping01 ?? 0.5, 1) || (m.openDamping01 ?? 0.5) < 0 || m.dampingMacroId != null && !identity(m.dampingMacroId)) throw new Error('Invalid authored topology mapping.');
  const anchors = value.anchors ?? [];
  if (!Array.isArray(anchors) || anchors.length > 32 || new Set(anchors.map(a => a.id)).size !== anchors.length || anchors.some(a => !keys(a, ['id', 'x', 'y']) || !identity(a.id) || !Number.isSafeInteger(a.x) || !Number.isSafeInteger(a.y) || a.x < b.x1 || a.x >= b.x2 || a.y < b.y1 || a.y >= b.y2)) throw new Error('Invalid topology anchors.');
  return freeze({ id: value.id, revision: value.revision, bounds: { ...b }, halo, connectivity: value.connectivity ?? 4, space: value.space ?? 'free', anchors: copy(anchors),
    bindingPolicy: value.bindingPolicy ?? 'endOfTick', heldPolicy: value.heldPolicy ?? 'release-on-change', allowOpen: value.allowOpen === true,
    mapping: { revision: m.revision, bodyId: m.bodyId, basePitchCents: m.basePitchCents, referenceAreaPixels2: m.referenceAreaPixels2,
      areaCentsPerOctave: m.areaCentsPerOctave ?? -600, boundaryDampingScale: m.boundaryDampingScale ?? 0.1, openDamping01: m.openDamping01 ?? 0.5, dampingMacroId: m.dampingMacroId ?? null } });
}
export function validateTopologyRegions(values = []) {
  if (!Array.isArray(values) || values.length > 8) throw new Error('Topology region capacity exceeded.');
  const regions = values.map(validateTopologyRegion);
  if (new Set(regions.map(r => r.id)).size !== regions.length || regions.reduce((sum, r) => sum + (r.bounds.x2 - r.bounds.x1) * (r.bounds.y2 - r.bounds.y1), 0) > 262144) throw new Error('Topology observation area exceeded.');
  return freeze(regions);
}
export function topologyLabels(result) {
  const count = (result.bounds.x2 - result.bounds.x1) * (result.bounds.y2 - result.bounds.y1), labels = new Int32Array(count); labels.fill(-1);
  for (let i = 0; i < result.runs.length; i += 3) labels.fill(result.runs[i + 2], result.runs[i], result.runs[i] + result.runs[i + 1]);
  return labels;
}
export const topologyMaskDigest = mask => { let hash = 2166136261; for (const value of mask) hash = Math.imul(hash ^ (value + 1), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); };
export function analyzeTopology(input, previous = null) {
  const region = validateTopologyRegion(input.region), b = region.bounds, width = b.x2 - b.x1, height = b.y2 - b.y1, halo = region.halo;
  const stride = width + halo * 2, area = width * height;
  if (!identity(input.worldId) || !integer(input.generation) || !integer(input.sourceRevision) || !integer(input.tick) || input.nextSerial != null && !integer(input.nextSerial) || !Array.isArray(input.mask) || input.mask.length !== stride * (height + halo * 2) || input.mask.some(value => ![-1, 0, 1].includes(value))) throw new Error('Invalid qualified topology mask.');
  const valueAt = (x, y) => input.mask[(y + halo) * stride + x + halo];
  const labels = new Int32Array(area); labels.fill(-1); const queue = new Int32Array(area), components = [];
  const steps = region.connectivity === 8 ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const target = region.space === 'free' ? 0 : 1; let work = 0;
  for (let start = 0; start < area; start++) {
    if (labels[start] !== -1 || valueAt(start % width, Math.floor(start / width)) !== target) continue;
    if (components.length >= MAX_COMPONENTS) return freeze({ status: 'unknown', reason: 'component-capacity', regionId: region.id, regionRevision: region.revision, sourceRevision: input.sourceRevision, worldId: input.worldId, generation: input.generation, nextSerial: Math.max(input.nextSerial || 0, previous?.nextSerial || 0) });
    const index = components.length, component = { index, areaPixels2: 0, boundaryLengthPixels: 0, centroid: { x: 0, y: 0 }, enclosure: 'closed', openings: [], anchors: [], adjacency: [], lineage: null };
    let head = 0, tail = 0; queue[tail++] = start; labels[start] = index;
    while (head < tail) {
      const cell = queue[head++], x = cell % width, y = Math.floor(cell / width); component.areaPixels2++; component.centroid.x += x + b.x1 + 0.5; component.centroid.y += y + b.y1 + 0.5;
      for (const [dx, dy] of steps) {
        work++; const nx = x + dx, ny = y + dy, value = valueAt(nx, ny), orthogonal = !dx || !dy;
        if (value < 0) component.enclosure = 'unknown';
        if (value !== target) { if (orthogonal) component.boundaryLengthPixels++; continue; }
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          if (component.enclosure !== 'unknown') component.enclosure = 'open';
          if (orthogonal && component.openings.length < 1024) component.openings.push({ x: x + b.x1, y: y + b.y1, dx, dy });
          else if (orthogonal) component.enclosure = 'unknown'; continue;
        }
        const next = ny * width + nx; if (labels[next] < 0) { labels[next] = index; queue[tail++] = next; }
      }
    }
    const openingSpans = [];
    component.openings.sort((a, c) => a.dx - c.dx || a.dy - c.dy || (a.dx ? a.x - c.x || a.y - c.y : a.y - c.y || a.x - c.x));
    for (const cell of component.openings) { const coordinate = cell.dx ? cell.x : cell.y, start = cell.dx ? cell.y : cell.x, prior = openingSpans.at(-1); if (prior && prior.dx === cell.dx && prior.dy === cell.dy && prior.coordinate === coordinate && prior.end === start) prior.end++; else openingSpans.push({ coordinate, start, end: start + 1, dx: cell.dx, dy: cell.dy }); }
    component.openings = openingSpans;
    component.centroid.x /= component.areaPixels2; component.centroid.y /= component.areaPixels2;
    component.anchors = region.anchors.filter(a => labels[(a.y - b.y1) * width + a.x - b.x1] === index).map(a => a.id);
    components.push(component);
  }
  if (previous?.status === 'complete') validateTopologyResult(previous);
  const signature = topologyDefinitionSignature(region);
  const compatible = previous?.status === 'complete' && previous.definitionSignature === signature && previous.sourceRevision <= input.sourceRevision && previous.tick <= input.tick && previous.worldId === input.worldId && previous.generation === input.generation && previous.regionRevision === region.revision && previous.connectivity === region.connectivity && previous.space === region.space && JSON.stringify(previous.bounds) === JSON.stringify(b);
  const oldLabels = compatible ? topologyLabels(previous) : null, overlaps = components.map(() => new Map()), children = new Map();
  if (oldLabels) for (let cell = 0; cell < area; cell++) if (labels[cell] >= 0 && oldLabels[cell] >= 0) {
    const next = labels[cell], prior = oldLabels[cell], counts = overlaps[next]; counts.set(prior, (counts.get(prior) || 0) + 1);
    const row = children.get(prior) || new Set(); row.add(next); children.set(prior, row);
  }
  let serial = Math.max(input.nextSerial || 0, previous?.nextSerial || 0);
  const claimed = new Set(), candidates = [];
  for (const component of components) for (const [prior, overlap] of overlaps[component.index]) candidates.push({ next: component.index, prior, overlap, anchored: component.anchors.some(a => previous.components[prior].anchors.includes(a)) });
  candidates.sort((a, c) => Number(c.anchored) - Number(a.anchored) || c.overlap - a.overlap || previous.components[a.prior].id.localeCompare(previous.components[c.prior].id) || a.next - c.next);
  for (const candidate of candidates) if (!components[candidate.next].id && !claimed.has(candidate.prior)) { components[candidate.next].id = previous.components[candidate.prior].id; claimed.add(candidate.prior); }
  for (const component of components) {
    if (!component.id) { if (!Number.isSafeInteger(++serial)) throw new RangeError('Topology component identity exhausted.'); component.id = `${region.id}:${input.generation}:${region.revision}:component:${serial}`; }
    const parents = [...overlaps[component.index].keys()], split = parents.some(parent => children.get(parent).size > 1);
    component.geometryChanged = parents.length !== 1 || overlaps[component.index].get(parents[0]) !== component.areaPixels2 || previous.components[parents[0]].areaPixels2 !== component.areaPixels2;
    component.lineage = { kind: component.enclosure === 'unknown' ? 'unknown' : parents.length > 1 ? split ? 'reconfigured' : 'merged' : split ? 'split' : parents.length ? 'unchanged' : 'new', parentIds: parents.map(index => previous.components[index].id).sort() };
    const m = region.mapping, cents = m.basePitchCents + m.areaCentsPerOctave * Math.log2(component.areaPixels2 / m.referenceAreaPixels2);
    component.musical = { status: Number.isFinite(cents) && Math.abs(cents) <= 24000 && component.enclosure !== 'unknown' && (region.allowOpen || component.enclosure === 'closed') ? 'complete' : 'unsupported', bodyId: m.bodyId, mappingRevision: m.revision,
      pitchCents: Number.isFinite(cents) && Math.abs(cents) <= 24000 ? cents : null,
      damping01: Math.min(1, m.boundaryDampingScale * component.boundaryLengthPixels / Math.sqrt(component.areaPixels2) + (component.enclosure === 'open' ? m.openDamping01 : 0)), dampingApplication: 'onset-only', dampingMacroId: m.dampingMacroId };
  }
  const adjacent = new Set();
  for (let cell = 0; cell < area; cell++) if (labels[cell] < 0 && valueAt(cell % width, Math.floor(cell / width)) >= 0) {
    const x = cell % width, y = Math.floor(cell / width), touching = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) { const label = labels[(y + dy) * width + x + dx]; if (label >= 0 && !touching.includes(label)) touching.push(label); }
    for (const a of touching) for (const c of touching) if (a < c) adjacent.add(`${a}:${c}`);
  }
  for (const pair of adjacent) { const [a, c] = pair.split(':').map(Number); components[a].adjacency.push(components[c].id); components[c].adjacency.push(components[a].id); }
  const runs = []; for (let start = 0; start < labels.length;) { const value = labels[start]; if (value < 0) { start++; continue; } let end = start + 1; while (end < labels.length && labels[end] === value) end++; runs.push(start, end - start, value); start = end; }
  const result = freeze({ version: 1, status: 'complete', worldId: input.worldId, generation: input.generation, tick: input.tick, sourceRevision: input.sourceRevision,
    regionId: region.id, regionRevision: region.revision, definitionSignature: signature, maskDigest: topologyMaskDigest(input.mask), mappingRevision: region.mapping.revision, bounds: { ...b }, connectivity: region.connectivity, space: region.space,
    coverage: input.mask.some(value => value < 0) ? 'partial' : 'complete', nextSerial: serial, components, runs,
    removedComponentIds: compatible ? previous.components.filter(c => !components.some(next => next.id === c.id)).map(c => c.id) : [],
    work: { cells: area, neighborVisits: work }, units: { area: 'square-world-pixel', boundary: 'world-pixel', adjacency: 'separated-by-one-cell', acoustics: 'authored-interpretation-not-measurement' } });
  admittedResults.add(result); return result;
}
export function validateTopologyResult(value) {
  if (admittedResults.has(value)) return value;
  const b = value?.bounds, components = value?.components;
  if (!keys(value, ['version', 'status', 'worldId', 'generation', 'tick', 'sourceRevision', 'regionId', 'regionRevision', 'definitionSignature', 'mappingRevision', 'maskDigest', 'bounds', 'connectivity', 'space', 'coverage', 'nextSerial', 'components', 'runs', 'removedComponentIds', 'work', 'units']) || value.version !== 1 || value.status !== 'complete' || !identity(value.worldId) || !identity(value.regionId) || !integer(value.regionRevision) || !integer(value.mappingRevision) || value.definitionSignature != null && (typeof value.definitionSignature !== 'string' || value.definitionSignature.length > 16384) || typeof value.maskDigest !== 'string' || !/^[0-9a-f]{8}$/.test(value.maskDigest) || !integer(value.generation) || !integer(value.sourceRevision) || !integer(value.tick) || !integer(value.nextSerial) || ![4, 8].includes(value.connectivity) || !['free', 'solid'].includes(value.space) || !keys(b, ['x1', 'x2', 'y1', 'y2']) || ![b.x1, b.x2, b.y1, b.y2].every(value => Number.isSafeInteger(value) && Math.abs(value) <= 1e9) || b.x2 <= b.x1 || b.y2 <= b.y1 || !Array.isArray(components) || components.length > MAX_COMPONENTS || !Array.isArray(value.runs) || value.runs.length % 3) throw new Error('Invalid topology descriptor.');
  const area = (b.x2 - b.x1) * (b.y2 - b.y1), counts = new Uint32Array(components.length);
  if (area > MAX_AREA || value.runs.length > area * 3 || new Set(components.map(c => c.id)).size !== components.length || !['complete', 'partial'].includes(value.coverage)) throw new Error('Topology descriptor capacity or coverage is invalid.');
  let end = 0;
  for (let i = 0; i < value.runs.length; i += 3) { const [start, length, index] = value.runs.slice(i, i + 3); if (!integer(start, area - 1) || !integer(length, area) || !length || !integer(index, components.length - 1) || start < end || start + length > area) throw new Error('Invalid topology cell ownership.'); end = start + length; counts[index] += length; }
  for (let index = 0; index < components.length; index++) { const c = components[index], m = c.musical;
    if (!keys(c, ['index', 'areaPixels2', 'boundaryLengthPixels', 'centroid', 'enclosure', 'openings', 'anchors', 'adjacency', 'lineage', 'id', 'geometryChanged', 'musical']) || !componentIdentity(c.id) || c.index !== index || c.areaPixels2 !== counts[index] || !counts[index] || !integer(c.boundaryLengthPixels, area * 4) || !keys(c.centroid, ['x', 'y']) || !finite(c.centroid?.x) || !finite(c.centroid?.y) || !['closed', 'open', 'unknown'].includes(c.enclosure) || !Array.isArray(c.anchors) || c.anchors.length > 32 || !Array.isArray(c.openings) || c.openings.length > 1024 || !Array.isArray(c.adjacency) || c.adjacency.length > MAX_COMPONENTS || !keys(c.lineage, ['kind', 'parentIds']) || !['new', 'unchanged', 'split', 'merged', 'reconfigured', 'unknown'].includes(c.lineage.kind) || !Array.isArray(c.lineage.parentIds) || c.lineage.parentIds.length > MAX_COMPONENTS || c.lineage.parentIds.some(id => !componentIdentity(id)) || c.anchors.some(id => !identity(id)) || c.adjacency.some(id => !componentIdentity(id)) || c.openings.some(span => !keys(span, ['coordinate', 'start', 'end', 'dx', 'dy']) || !Object.values(span).every(Number.isSafeInteger) || span.start >= span.end || Math.abs(span.dx) + Math.abs(span.dy) !== 1) || !keys(m, ['status', 'bodyId', 'mappingRevision', 'pitchCents', 'damping01', 'dampingApplication', 'dampingMacroId']) || !identity(m.bodyId) || m.mappingRevision !== value.mappingRevision || !['complete', 'unsupported'].includes(m.status) || m.pitchCents !== null && !finite(m.pitchCents, 24000) || m.status === 'complete' && m.pitchCents === null || m.dampingApplication !== 'onset-only' || typeof c.geometryChanged !== 'boolean' || !finite(m.damping01, 1) || m.damping01 < 0 || m.dampingMacroId != null && !identity(m.dampingMacroId)) throw new Error('Invalid topology component mapping.');
  }
  if (!Array.isArray(value.removedComponentIds) || value.removedComponentIds.length > MAX_COMPONENTS || value.removedComponentIds.some(id => !componentIdentity(id)) || !keys(value.work, ['cells', 'neighborVisits']) || value.work.cells !== area || !integer(value.work.neighborVisits, area * 8) || !keys(value.units, ['area', 'boundary', 'adjacency', 'acoustics']) || Object.values(value.units).some(unit => typeof unit !== 'string' || unit.length > 64)) throw new Error('Invalid topology descriptor metadata.');
  seal(value); admittedResults.add(value); return value;
}
export function topologyResultMatchesRegion(result, region) {
  if (result?.status !== 'complete' || !region || result.definitionSignature !== topologyDefinitionSignature(region)) return false;
  validateTopologyResult(result);
  return result.regionId === region.id && result.regionRevision === region.revision && result.mappingRevision === region.mapping.revision && result.connectivity === region.connectivity && result.space === region.space && ['x1', 'x2', 'y1', 'y2'].every(key => result.bounds[key] === region.bounds[key]);
}
export function topologyComponentAt(result, point, neighbor = true) {
  if (result?.status !== 'complete' || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  validateTopologyResult(result);
  const b = result.bounds, width = b.x2 - b.x1;
  const at = (x, y) => { x = Math.floor(x); y = Math.floor(y); if (x < b.x1 || x >= b.x2 || y < b.y1 || y >= b.y2) return null;
    const index = (y - b.y1) * width + x - b.x1; let low = 0, high = result.runs.length / 3 - 1;
    while (low <= high) { const mid = (low + high) >>> 1, start = result.runs[mid * 3], end = start + result.runs[mid * 3 + 1]; if (index < start) high = mid - 1; else if (index >= end) low = mid + 1; else return result.components[result.runs[mid * 3 + 2]]; } return null;
  };
  const direct = at(point.x, point.y); if (direct || !neighbor) return direct;
  const candidates = [[0, -1], [-1, 0], [1, 0], [0, 1]].map(([dx, dy]) => at(point.x + dx, point.y + dy)).filter(Boolean);
  return new Set(candidates.map(c => c.id)).size === 1 ? candidates[0] : null;
}
export function bindTopologyFact(region, batch, fact) {
  const entry = batch.snapshot?.topology?.regions?.find(value => value.regionId === region.id && value.regionRevision === region.revision);
  const sourceRevision = fact.physicalPayload?.sourceEditRevisionAfter ?? fact.surfaceRevision ?? fact.physicalPayload?.surfaceRevision ?? null;
  const result = region.bindingPolicy === 'endOfTick' ? entry?.current : entry?.history?.findLast(value => value.sourceRevision === sourceRevision);
  if (!topologyResultMatchesRegion(result, region) || result.worldId !== batch.worldId || result.generation !== batch.generation || result.tick > batch.tick || region.bindingPolicy === 'endOfTick' && result.sourceRevision !== batch.snapshot?.terrainRevision) return { status: 'unsupported', reason: 'qualified-topology-unavailable' };
  const payload = fact.physicalPayload, point = fact.anchor ?? (Number.isFinite(payload?.targetX) && Number.isFinite(payload?.targetY) ? { x: payload.targetX, y: payload.targetY } : fact.positionAfter ?? fact.positionBefore);
  let component = topologyComponentAt(result, point);
  if (!component && Array.isArray(payload?.terrainEdit?.spans) && payload.terrainEdit.spans.length <= 64) {
    const candidates = payload.terrainEdit.spans.map(span => topologyComponentAt(result, { x: Math.floor((span.x1 + span.x2 - 1) / 2), y: span.y })).filter(Boolean);
    if (new Set(candidates.map(value => value.id)).size === 1) component = candidates[0];
  }
  if (!component || component.musical.status !== 'complete') return { status: 'unsupported', reason: 'topology-component-unavailable' };
  return freeze({ status: 'complete', regionId: region.id, regionRevision: region.revision, componentId: component.id, sourceEditRevision: sourceRevision,
    boundTopologyRevision: result.sourceRevision, bindingPolicy: region.bindingPolicy, interpretation: region.bindingPolicy === 'endOfTick' ? 'completed-tick-musical-interpretation' : 'exact-local-revision',
    lineage: component.lineage, geometryChanged: component.geometryChanged, ...component.musical });
}
