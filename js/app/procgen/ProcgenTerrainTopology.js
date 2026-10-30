import { readTerrainCell } from './TerrainAuthoringAdapter.js';
import { topologyAnalysisJobs as pendingJobs, invalidateTerrainTopology } from './TerrainTopologyInvalidation.js';
import { validateTopologyRegions, validateTopologyRegion, topologyDefinitionSignature, analyzeTopology, reuseTopologyResult, validateTopologyResult, topologyMaskDigest, topologyResultMatchesRegion } from './workstation/physical/TopologyInstrumentRegion.js';
const analysisFailures = new WeakMap();
const terrainTopologyDiagnostics = world => Object.freeze([...(analysisFailures.get(world)?.values() || [])]);
const mapSize = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(Map.prototype, 'size').get);
const assertTopologyEvidenceBoundary = world => {
  const pending = pendingJobs.get(world);
  if (pending && mapSize(pending)) throw Object.assign(new Error('Survey evidence requires settled topology analysis.'), { name: 'SurveyStateProjectionError', code: 'pending-topology-evidence' });
};
const createTerrainTopologyState = () => ({ version: 1, epoch: 0, profiles: [], regions: new Map(), invalidationRevision: -1, budgetTick: -1, postCells: 0, finalCells: 0, staleResults: 0 });
const prepareTerrainTopologyConfiguration = (world, profiles) => {
  const next = validateTopologyRegions(profiles), state = world.terrainTopology;
  if (next.length === state.profiles.length && next.every((region, index) => topologyDefinitionSignature(region) === topologyDefinitionSignature(state.profiles[index]))) { const epoch = state.epoch; return { commit() { if (world._disposed || world.terrainTopology !== state || state.epoch !== epoch) throw new Error('Topology configuration proposal is stale.'); return false; } }; }
  if (!Number.isSafeInteger(state.epoch + 1)) throw new RangeError('Topology analysis epoch exhausted.');
  for (const region of next) { const previous = state.profiles.find(r => r.id === region.id); if (previous && topologyDefinitionSignature(previous) !== topologyDefinitionSignature(region) && region.revision <= previous.revision) throw new Error('Changed topology regions need a newer revision.'); }
  const retained = new Map(); for (const region of next) if (state.profiles.some(r => topologyDefinitionSignature(r) === topologyDefinitionSignature(region)) && state.regions.has(region.id) && state.regions.get(region.id).status !== 'pending') retained.set(region.id, state.regions.get(region.id));
  const epoch = state.epoch, previousProfiles = state.profiles, previousRegions = state.regions; let committed = false;
  return { commit() { if (committed) return true; if (world._disposed || world.terrainTopology !== state || state.epoch !== epoch || state.profiles !== previousProfiles || state.regions !== previousRegions) throw new Error('Topology configuration proposal is stale.'); analysisFailures.delete(world); pendingJobs.delete(world); state.profiles = next; state.regions = retained; state.epoch++; committed = true; return true; } };
};
const configureTerrainTopology = (world, profiles) => prepareTerrainTopologyConfiguration(world, profiles).commit();
const prepareTopologyAnalysis = (world, region) => {
  region = validateTopologyRegion(region); const state = world.terrainTopology;
  if (world._disposed || !state.profiles.some(profile => profile.id === region.id && topologyDefinitionSignature(profile) === topologyDefinitionSignature(region))) throw new Error('Topology profile is not configured.');
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
      !region || topologyDefinitionSignature(region) !== topologyDefinitionSignature(input.region) || result.worldId !== input.worldId || result.generation !== input.generation || result.sourceRevision !== input.sourceRevision || result.regionId !== region.id || result.regionRevision !== region.revision || result.status === 'complete' && (result.maskDigest !== input.maskDigest || result.mappingRevision !== region.mapping.revision || result.connectivity !== region.connectivity || result.space !== region.space || ['x1', 'x2', 'y1', 'y2'].some(key => result.bounds?.[key] !== region.bounds[key]))) return refuse();
  try { if (result.status === 'complete' && !topologyResultMatchesRegion(result, region)) return refuse(); } catch { return refuse(); }
  const previous = state.regions.get(region.id), history = previous?.history.filter(value => value.worldId === world.worldId && value.generation === world.generation && value.regionRevision === region.revision) || [];
  if (result.status === 'complete') { const at = history.findIndex(value => value.sourceRevision === result.sourceRevision); if (at >= 0) history.splice(at, 1); history.push(result); if (history.length > 4) history.shift(); }
  analysisFailures.get(world)?.delete(region.id);
  state.regions.set(region.id, { regionId: region.id, regionRevision: region.revision, requestedRevision: world.terrainRevision, current: result.status === 'complete' ? result : null,
    status: result.status, reason: result.reason ?? null, history, dirty: result.status !== 'complete', nextSerial: Math.max(previous?.nextSerial || 0, result.nextSerial || 0) }); return true;
};
const captureTerrainTopology = (world, phase = 'endOfTick') => {
  const state = world.terrainTopology;
  if (!state.profiles.length) return;
  if (state.invalidationRevision !== world.terrainRevision) invalidateTerrainTopology(world, null);
  if (state.budgetTick !== world.tickIndex) { state.budgetTick = world.tickIndex; state.postCells = 0; state.finalCells = 0; }
  for (const region of state.profiles) {
    if (phase === 'postTransaction' && region.bindingPolicy !== phase) continue;
    const previous = state.regions.get(region.id), current = previous?.current;
    const compatible = current && current.generation === world.generation && current.worldId === world.worldId && topologyResultMatchesRegion(current, region);
    if (compatible && previous.dirty === false) {
      if (current.sourceRevision === world.terrainRevision) continue;
      const result = reuseTopologyResult(current, { tick: world.tickIndex, sourceRevision: world.terrainRevision }), history = [...previous.history, result].slice(-4);
      state.regions.set(region.id, { ...previous, requestedRevision: world.terrainRevision, current: result, history }); continue;
    }
    const area = (region.bounds.x2 - region.bounds.x1) * (region.bounds.y2 - region.bounds.y1), budget = phase === 'postTransaction' ? 'postCells' : 'finalCells';
    if (state[budget] + area > 262144) { state.regions.set(region.id, { ...previous, regionId: region.id, regionRevision: region.revision, requestedRevision: world.terrainRevision, current: null, history: previous?.history || [], nextSerial: previous?.nextSerial || 0, status: 'unknown', reason: 'analysis-budget' }); continue; }
    state[budget] += area;
    try { const input = prepareTopologyAnalysis(world, region); publishTopologyAnalysis(world, input, analyzeTopology(input, current ?? previous?.history.at(-1))); }
    catch (error) { let failures = analysisFailures.get(world); if (!failures) { failures = new Map(); analysisFailures.set(world, failures); } failures.set(region.id, Object.freeze({ regionId: region.id, tick: world.tickIndex, message: String(error?.message || 'Topology analysis failed.').slice(0, 160) })); pendingJobs.get(world)?.delete(region.id); state.regions.set(region.id, { ...previous, regionId: region.id, regionRevision: region.revision, requestedRevision: world.terrainRevision, current: null, history: previous?.history || [], nextSerial: previous?.nextSerial || 0, status: 'unknown', reason: 'analysis-failed' }); }
  }
};
const disposeTerrainTopology = world => { analysisFailures.delete(world); pendingJobs.delete(world); world.terrainTopology.regions.clear(); world.terrainTopology.profiles = []; };
const retireTerrainTopologyAnalysis = world => { pendingJobs.delete(world); };
const resetTerrainTopology = world => {
  const state = world.terrainTopology; if (!Number.isSafeInteger(state.epoch + 1)) throw new RangeError('Topology analysis epoch exhausted.');
  analysisFailures.delete(world); pendingJobs.delete(world); state.epoch++; state.regions.clear(); state.invalidationRevision = -1; state.budgetTick = -1; state.postCells = state.finalCells = 0;
};
const validateTerrainTopologyState = world => {
  const state = world.terrainTopology;
  if (state?.version !== 1 || !Number.isSafeInteger(state.epoch) || state.epoch < 0 || !(state.regions instanceof Map) || state.regions.size > 8 || !Number.isSafeInteger(state.budgetTick) || state.budgetTick < -1 || state.budgetTick > world.tickIndex || !Number.isSafeInteger(state.staleResults) || state.staleResults < 0 || ['postCells', 'finalCells'].some(key => !Number.isSafeInteger(state[key]) || state[key] < 0 || state[key] > 262144)) throw new Error('Invalid checkpoint topology state.');
  const profiles = validateTopologyRegions(state.profiles);
  if (state.invalidationRevision != null && (!Number.isSafeInteger(state.invalidationRevision) || state.invalidationRevision < -1 || state.invalidationRevision > world.terrainRevision)) throw new Error('Invalid checkpoint topology invalidation revision.');
  for (const [id, entry] of state.regions) {
    const region = profiles.find(value => value.id === id);
    if (entry?.dirty != null && typeof entry.dirty !== 'boolean') throw new Error('Invalid checkpoint topology invalidation state.');
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
export { terrainTopologyDiagnostics, assertTopologyEvidenceBoundary, disposeTerrainTopology, retireTerrainTopologyAnalysis, resetTerrainTopology, invalidateTerrainTopology, validateTerrainTopologyState, createTerrainTopologyState, prepareTerrainTopologyConfiguration, configureTerrainTopology, prepareTopologyAnalysis, publishTopologyAnalysis, captureTerrainTopology, terrainTopologySnapshot };
