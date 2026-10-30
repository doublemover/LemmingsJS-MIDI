import { readTerrainCell } from './TerrainAuthoringAdapter.js';
import { validateTopologyRegions, validateTopologyRegion, analyzeTopology, validateTopologyResult, topologyMaskDigest, topologyResultMatchesRegion } from './workstation/physical/TopologyInstrumentRegion.js';
const pendingJobs = new WeakMap();
const mapSize = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(Map.prototype, 'size').get);
const assertTopologyEvidenceBoundary = world => {
  const pending = pendingJobs.get(world);
  if (pending && mapSize(pending)) throw Object.assign(new Error('Survey evidence requires settled topology analysis.'), { name: 'SurveyStateProjectionError', code: 'pending-topology-evidence' });
};
const createTerrainTopologyState = () => ({ version: 1, epoch: 0, profiles: [], regions: new Map(), budgetTick: -1, postCells: 0, finalCells: 0, staleResults: 0 });
const prepareTerrainTopologyConfiguration = (world, profiles) => {
  const next = validateTopologyRegions(profiles), state = world.terrainTopology;
  if (JSON.stringify(next) === JSON.stringify(state.profiles)) { const epoch = state.epoch; return { commit() { if (world._disposed || world.terrainTopology !== state || state.epoch !== epoch) throw new Error('Topology configuration proposal is stale.'); return false; } }; }
  if (!Number.isSafeInteger(state.epoch + 1)) throw new RangeError('Topology analysis epoch exhausted.');
  for (const region of next) { const previous = state.profiles.find(r => r.id === region.id); if (previous && JSON.stringify(previous) !== JSON.stringify(region) && region.revision <= previous.revision) throw new Error('Changed topology regions need a newer revision.'); }
  const retained = new Map(); for (const region of next) if (state.profiles.some(r => JSON.stringify(r) === JSON.stringify(region)) && state.regions.has(region.id) && state.regions.get(region.id).status !== 'pending') retained.set(region.id, state.regions.get(region.id));
  const epoch = state.epoch, previousProfiles = state.profiles, previousRegions = state.regions; let committed = false;
  return { commit() { if (committed) return true; if (world._disposed || world.terrainTopology !== state || state.epoch !== epoch || state.profiles !== previousProfiles || state.regions !== previousRegions) throw new Error('Topology configuration proposal is stale.'); pendingJobs.delete(world); state.profiles = next; state.regions = retained; state.epoch++; committed = true; return true; } };
};
const configureTerrainTopology = (world, profiles) => prepareTerrainTopologyConfiguration(world, profiles).commit();
const prepareTopologyAnalysis = (world, region) => {
  region = validateTopologyRegion(region); const state = world.terrainTopology;
  if (world._disposed || !state.profiles.some(profile => profile.id === region.id && JSON.stringify(profile) === JSON.stringify(region))) throw new Error('Topology profile is not configured.');
  const b = region.bounds, mask = [], h = region.halo;
  for (let y = b.y1 - h; y < b.y2 + h; y++) for (let x = b.x1 - h; x < b.x2 + h; x++) {
    const cell = readTerrainCell(world, x, y); mask.push(cell.status === 'complete' ? Number(!!cell.color) : -1);
  }
  const previous = state.regions.get(region.id);
  const input = Object.freeze({ region, mask: Object.freeze(mask), maskDigest: topologyMaskDigest(mask), worldId: world.worldId, generation: world.generation, tick: world.tickIndex, sourceRevision: world.terrainRevision,
    epoch: state.epoch, nextSerial: previous?.nextSerial ?? 0 });
  let jobs = pendingJobs.get(world); if (!jobs) { jobs = new Map(); pendingJobs.set(world, jobs); }
  jobs.set(region.id, input);
  state.regions.set(region.id, { ...previous, regionId: region.id, regionRevision: region.revision, requestedRevision: world.terrainRevision, current: null, status: 'pending', history: previous?.history || [] });
  return input;
};
const publishTopologyAnalysis = (world, input, result) => {
  const state = world.terrainTopology, jobs = pendingJobs.get(world), registered = jobs?.get(input.region.id) === input; if (registered) jobs.delete(input.region.id);
  const refuse = () => { state.staleResults++; const previous = state.regions.get(input.region.id); if (registered && previous?.status === 'pending') state.regions.set(input.region.id, { ...previous, current: null, status: 'unknown', reason: 'rejected-analysis-result', nextSerial: previous.nextSerial || 0 }); return false; };
  if (!result || !['complete', 'unknown'].includes(result.status)) return refuse();
  const region = state.profiles.find(r => r.id === input.region.id);
  if (!registered || world._disposed || input.epoch !== state.epoch || input.worldId !== world.worldId || input.generation !== world.generation || input.sourceRevision !== world.terrainRevision ||
      !region || JSON.stringify(region) !== JSON.stringify(input.region) || result.worldId !== input.worldId || result.generation !== input.generation || result.sourceRevision !== input.sourceRevision || result.regionId !== region.id || result.regionRevision !== region.revision || result.status === 'complete' && (result.maskDigest !== input.maskDigest || result.mappingRevision !== region.mapping.revision || result.connectivity !== region.connectivity || result.space !== region.space || JSON.stringify(result.bounds) !== JSON.stringify(region.bounds))) return refuse();
  try { if (result.status === 'complete' && !topologyResultMatchesRegion(result, region)) return refuse(); } catch { return refuse(); }
  const previous = state.regions.get(region.id), history = previous?.history.filter(value => value.worldId === world.worldId && value.generation === world.generation && value.regionRevision === region.revision) || [];
  if (result.status === 'complete') { const at = history.findIndex(value => value.sourceRevision === result.sourceRevision); if (at >= 0) history.splice(at, 1); history.push(result); if (history.length > 4) history.shift(); }
  state.regions.set(region.id, { regionId: region.id, regionRevision: region.revision, requestedRevision: world.terrainRevision, current: result.status === 'complete' ? result : null,
    status: result.status, reason: result.reason ?? null, history, nextSerial: Math.max(previous?.nextSerial || 0, result.nextSerial || 0) }); return true;
};
const captureTerrainTopology = (world, phase = 'endOfTick') => {
  const state = world.terrainTopology;
  if (!state.profiles.length) return;
  if (state.budgetTick !== world.tickIndex) { state.budgetTick = world.tickIndex; state.postCells = 0; state.finalCells = 0; }
  for (const region of state.profiles) {
    if (phase === 'postTransaction' && region.bindingPolicy !== phase) continue;
    const previous = state.regions.get(region.id), current = previous?.current;
    if (current?.sourceRevision === world.terrainRevision && current.generation === world.generation && current.worldId === world.worldId && current.regionRevision === region.revision) continue;
    const area = (region.bounds.x2 - region.bounds.x1) * (region.bounds.y2 - region.bounds.y1), budget = phase === 'postTransaction' ? 'postCells' : 'finalCells';
    if (state[budget] + area > 262144) { state.regions.set(region.id, { ...previous, regionId: region.id, regionRevision: region.revision, requestedRevision: world.terrainRevision, current: null, history: previous?.history || [], nextSerial: previous?.nextSerial || 0, status: 'unknown', reason: 'analysis-budget' }); continue; }
    state[budget] += area;
    try { const input = prepareTopologyAnalysis(world, region); publishTopologyAnalysis(world, input, analyzeTopology(input, current ?? previous?.history.at(-1))); }
    catch (error) { pendingJobs.get(world)?.delete(region.id); state.regions.set(region.id, { ...previous, regionId: region.id, regionRevision: region.revision, requestedRevision: world.terrainRevision, current: null, history: previous?.history || [], nextSerial: previous?.nextSerial || 0, status: 'unknown', reason: 'analysis-failed' }); }
  }
};
const disposeTerrainTopology = world => { pendingJobs.delete(world); world.terrainTopology.regions.clear(); world.terrainTopology.profiles = []; };
const retireTerrainTopologyAnalysis = world => { pendingJobs.delete(world); };
const resetTerrainTopology = world => {
  const state = world.terrainTopology; if (!Number.isSafeInteger(state.epoch + 1)) throw new RangeError('Topology analysis epoch exhausted.');
  pendingJobs.delete(world); state.epoch++; state.regions.clear(); state.budgetTick = -1; state.postCells = state.finalCells = 0;
};
const validateTerrainTopologyState = world => {
  const state = world.terrainTopology;
  if (state?.version !== 1 || !Number.isSafeInteger(state.epoch) || state.epoch < 0 || !(state.regions instanceof Map) || state.regions.size > 8 || !Number.isSafeInteger(state.budgetTick) || state.budgetTick < -1 || state.budgetTick > world.tickIndex || !Number.isSafeInteger(state.staleResults) || state.staleResults < 0 || ['postCells', 'finalCells'].some(key => !Number.isSafeInteger(state[key]) || state[key] < 0 || state[key] > 262144)) throw new Error('Invalid checkpoint topology state.');
  const profiles = validateTopologyRegions(state.profiles);
  for (const [id, entry] of state.regions) {
    const region = profiles.find(value => value.id === id);
    if (!region || entry?.regionId !== id || entry.regionRevision !== region.revision || !['complete', 'unknown'].includes(entry.status) || !Number.isSafeInteger(entry.requestedRevision) || entry.requestedRevision < 0 || entry.requestedRevision > world.terrainRevision || !Array.isArray(entry.history) || entry.history.length > 4 || !Number.isSafeInteger(entry.nextSerial) || entry.nextSerial < 0 || entry.status === 'complete' && !entry.current || entry.status !== 'complete' && entry.current != null) throw new Error('Invalid checkpoint topology region.');
    let previous = -1;
    for (const result of entry.history) { validateTopologyResult(result); if (!topologyResultMatchesRegion(result, region) || result.worldId !== world.worldId || result.generation !== world.generation || result.tick > world.tickIndex || result.sourceRevision > world.terrainRevision || result.sourceRevision <= previous || result.nextSerial > entry.nextSerial) throw new Error('Invalid checkpoint topology history.'); previous = result.sourceRevision; }
    if (entry.current && (!topologyResultMatchesRegion(entry.current, region) || entry.current.worldId !== world.worldId || entry.current.generation !== world.generation || entry.current.sourceRevision !== entry.requestedRevision || entry.current.tick > world.tickIndex || !entry.history.some(result => JSON.stringify(result) === JSON.stringify(entry.current)))) throw new Error('Unbound checkpoint topology result.');
  }
  return state;
};
const terrainTopologySnapshot = world => {
  const state = world.terrainTopology; if (!state.profiles.length) return null;
  return Object.freeze({ version: 1, epoch: state.epoch, latencyPolicy: 'omit-unavailable-no-catch-up', regions: Object.freeze(state.profiles.map(region => {
    const value = state.regions.get(region.id);
    return Object.freeze({ regionId: region.id, regionRevision: region.revision, requiredRevision: world.terrainRevision, status: value?.status ?? 'pending', reason: value?.reason ?? null,
      current: value?.current ?? null, history: Object.freeze([...(value?.history || [])]) }); })) });
};
export { assertTopologyEvidenceBoundary, disposeTerrainTopology, retireTerrainTopologyAnalysis, resetTerrainTopology, validateTerrainTopologyState, createTerrainTopologyState, prepareTerrainTopologyConfiguration, configureTerrainTopology, prepareTopologyAnalysis, publishTopologyAnalysis, captureTerrainTopology, terrainTopologySnapshot };
