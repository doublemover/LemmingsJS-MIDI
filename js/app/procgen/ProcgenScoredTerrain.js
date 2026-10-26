import { retireBackgroundResult } from '../resources/ResourceRetirement.js';
import { validateSceneTerrainLayout, verifyCompiledSceneTerrain, SCENE_TERRAIN_REVISION } from './SceneTerrainLayout.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createProcgenRetirementScope, afterProcgenRetirement } from './ProcgenRetirement.js';

const empty = Object.freeze([]), integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
export class ProcgenScoredTerrain {
  constructor(base, layout, { resourceBudget, jobs = backgroundJobService, ownerEpoch = 1, isCurrent = () => true } = {}) {
    if (!base || ['getChunk', 'registerLanes', 'exportAssignments', 'restoreAssignments', 'forSeed', 'configure', 'reset', 'dispose', 'getDebugState', 'describe', 'objectsAt', 'growthPlan', 'solidSample', 'steelSample', 'rasterSample', 'surface', 'collisionAt', 'retainDescriptors', 'setLaneAssignments'].some(key => typeof base[key] !== 'function') || typeof base.collision?.values !== 'function' || !Array.isArray(base.themes) || !base.themes.length || base.chunkWidth !== 128 || typeof resourceBudget?.reserve !== 'function' || typeof resourceBudget?.release !== 'function' || typeof jobs?.compute !== 'function' || !integer(ownerEpoch, 1, Number.MAX_SAFE_INTEGER) || typeof isCurrent !== 'function') throw new TypeError('Authored terrain needs its independently owned base source and admitted worker result.');
    this.base = base; this.sceneTerrainLayout = validateSceneTerrainLayout(layout); this.jobs = jobs; this.resourceBudget = resourceBudget; this.ownerEpoch = ownerEpoch; this.isCurrent = isCurrent;
    if (!Array.isArray(base.exportAssignments().laneAssignments) || base.exportAssignments().laneAssignments.length !== this.sceneTerrainLayout.lanes.length) throw new TypeError('Select explicit installed theme assignments for every authored lane.');
    this.chunkWidth = 128; this.height = this.sceneTerrainLayout.laneHeight; this.supportsFineGrowth = false; this.seedToLane = new Map(); this.records = []; this.views = null; this.job = null; this.pending = null; this.failure = null; this.disposed = false;
    this.controller = new AbortController(); this.retirement = createProcgenRetirementScope(); this.sceneTerrainLayoutHash = null; this.sourceDescriptor = null;
    this.recipe = Object.freeze({ ...base.recipe, id: 'scene:' + this.sceneTerrainLayout.id, revision: this.sceneTerrainLayout.revision, algorithmRevision: SCENE_TERRAIN_REVISION, sourceKind: 'original-scene-score' });
    const owner = this; this.collision = { *values() { yield* owner.base.collision.values(); if (owner.views) yield* owner.views.chunks; } };
  }
  prepare({ signal } = {}) {
    if (this.disposed || this.failure) return Promise.reject(this.failure || new Error('The authored source is retired.'));
    if (this.views) return Promise.resolve(this); if (this.pending) return this.pending;
    const abort = () => this.controller.abort(signal.reason), check = () => { signal?.throwIfAborted(); this.controller.signal.throwIfAborted(); if (this.disposed || !this.isCurrent()) throw new Error('Authored scene source preparation is stale.'); };
    signal?.addEventListener('abort', abort, { once: true });
    this.pending = (async () => {
      check(); const metadata = canonicalDataText(this.sceneTerrainLayout, { maxBytes: 131072, maxNodes: 16384 }), expectedHash = await hashData(this.sceneTerrainLayout); check();
      this.job = await this.jobs.compute({ kind: 'compile-scene-terrain', ownerId: 'physical-scene-terrain', ownerEpoch: this.ownerEpoch, sourceRevision: expectedHash, inputBytes: metadata.bytes.length, maxBytes: 131072, maxNodes: 16384, estimatedPeakBytes: 16 * 1048576, deadlineMs: 30000,
        signal: this.controller.signal, budgetAdapter: this.resourceBudget, isCurrent: () => !this.disposed && this.isCurrent(), prepareInput: () => this.sceneTerrainLayout }); check();
      if (this.job.receipt.method !== 'dedicated-worker' || this.job.receipt.executionIdentity?.activeExecution !== 'bound') throw new Error('Authored terrain requires the exact bound application worker; no main-thread terrain fallback is available.');
      const views = await verifyCompiledSceneTerrain(this.job.value, { signal: this.controller.signal, current: () => !this.disposed && this.isCurrent() }); check();
      if (views.layoutHash !== expectedHash) throw new Error('The compiled source differs from the selected initial geometry.');
      this.views = views; this.sceneTerrainLayout = views.layout; this.sceneTerrainLayoutHash = views.layoutHash;
      this.sourceDescriptor = freezeData({ kind: 'original-scene-terrain', sourceRevision: views.layoutHash, algorithmRevision: SCENE_TERRAIN_REVISION, storageHash: views.storageHash, geometry: 'explicit-initial-source;not-a-player-intervention' }); return this;
    })().catch(error => { this.failure = error; throw error; }).finally(() => signal?.removeEventListener('abort', abort));
    return this.pending;
  }
  get themes() { return this.base.themes; }
  get laneThemes() { return this.base.laneThemes; }
  get objects() { return this.base.objects; }
  get pieces() { return this.base.pieces; }
  get unavailableThemes() { return this.base.unavailableThemes; }
  get unpreparedThemes() { return this.base.unpreparedThemes; }
  get memoryMB() { return this.base.memoryMB + (this.views?.storage.byteLength || 0) / 1048576; }
  forSeed(seed) { return this.base.forSeed(seed); }
  configure(lanes, maxActors, options = {}) {
    if (!this.views || this.disposed || lanes !== this.sceneTerrainLayout.lanes.length || options.laneHeight !== this.sceneTerrainLayout.laneHeight) throw new Error('The authored terrain must be fully prepared for these exact physical dimensions.');
    this.base.configure(lanes, maxActors, options); this.height = this.base.height;
    if (this.height !== this.sceneTerrainLayout.laneHeight) throw new Error('The installed terrain source normalized a different lane height.');
  }
  registerLanes(seeds, runSeed, generation) {
    if (seeds.length !== this.sceneTerrainLayout.lanes.length) throw new Error('Authored source lane count changed.');
    this.base.registerLanes(seeds, runSeed, generation); this.seedToLane = new Map(Array.from(seeds, (seed, lane) => [seed, lane])); this.bindRecords();
  }
  bindRecords() {
    const seeds = new Array(this.sceneTerrainLayout.lanes.length); for (const [seed, lane] of this.seedToLane) seeds[lane] = seed;
    this.records = this.views.chunks.map(chunk => Object.freeze({ ...chunk, placements: empty, objects: empty, sourceRevision: this.sceneTerrainLayoutHash, themeId: this.base.forSeed(seeds[chunk.laneId]).recipe.id }));
  }
  setLaneAssignments(values) { this.base.setLaneAssignments(values); }
  exportAssignments() { return { ...this.base.exportAssignments(), sceneTerrain: { schema: 'lemmings-scored-terrain-assignment/v1', id: this.sceneTerrainLayout.id, revision: this.sceneTerrainLayout.revision, layoutHash: this.sceneTerrainLayoutHash, layout: this.sceneTerrainLayout, seedLanes: [...this.seedToLane] } }; }
  validateScoredAssignments(data, seeds = null, settings = null) {
    const saved = data?.sceneTerrain, n = this.sceneTerrainLayout.lanes.length;
    if (!this.views || !saved || Object.keys(saved).some(key => !['schema', 'id', 'revision', 'layoutHash', 'layout', 'seedLanes'].includes(key)) || saved.schema !== 'lemmings-scored-terrain-assignment/v1' || saved.id !== this.sceneTerrainLayout.id || saved.revision !== this.sceneTerrainLayout.revision || saved.layoutHash !== this.sceneTerrainLayoutHash || canonicalDataText(saved.layout ?? null).text !== canonicalDataText(this.sceneTerrainLayout).text || !Array.isArray(saved.seedLanes) || saved.seedLanes.length !== n || !Array.isArray(data.assignments) || data.assignments.length !== n || !Array.isArray(data.laneThemes) || data.laneThemes.length !== n || !Array.isArray(data.laneAssignments) || !data.laneAssignments.length || data.laneAssignments.length > 32 || data.laneAssignments.some(id => !this.base.themes.some(theme => (theme.familyId || theme.styleName) === id))) throw new Error('The checkpoint requires its exact authored source and bounded lane/theme assignments.');
    if (settings !== null) { const expected = this.base.themes.map(({ terrain }) => ({ workstation: terrain.workstation, hazardSpacing: terrain.hazardSpacing, laneHeight: terrain.height, sharedSpanBudget: terrain.sharedSpanBudget })); if (canonicalDataText(settings, { maxBytes: 16384, maxNodes: 1024 }).text !== canonicalDataText(expected).text) throw new Error('The authored checkpoint requires its exact original terrain source settings.'); }
    const unique = new Set();
    for (let lane = 0; lane < n; lane++) {
      const pair = saved.seedLanes[lane], assignment = data.assignments[lane];
      if (!Array.isArray(pair) || pair.length !== 2 || !integer(pair[0], 0, 0xffffffff) || pair[1] !== lane || unique.has(pair[0]) || seeds && (seeds.length !== n || seeds[lane] !== pair[0]) || !Array.isArray(assignment) || assignment.length !== 2 || assignment[0] !== pair[0] || !integer(assignment[1], 0, this.base.themes.length - 1) || data.laneThemes[lane] !== this.base.themes[assignment[1]].styleName) throw new Error('The authored checkpoint source does not bind the actual world lane seeds.');
      unique.add(pair[0]);
    }
  }
  restoreAssignments(data) { this.validateScoredAssignments(data); this.base.restoreAssignments(data); this.seedToLane = new Map(data.sceneTerrain.seedLanes); this.bindRecords(); }
  reset() { this.base.reset(); this.seedToLane.clear(); this.records = []; }
  authored(seed, chunk) {
    if (this.disposed || !this.views) throw new Error('The authored terrain source is unavailable.');
    if (!integer(chunk, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) throw new TypeError('Terrain chunk coordinates must be exact bounded integers.');
    if (chunk < 0 || chunk >= this.views.shape.chunksPerLane) return null;
    const lane = this.seedToLane.get(seed); if (lane == null) throw new Error('An authored chunk requires its actual registered physical lane.');
    return this.records[lane * this.views.shape.chunksPerLane + chunk];
  }
  describe(seed, chunk) { return this.authored(seed, chunk) || this.base.describe(seed, chunk); }
  objectsAt(seed, chunk) { return this.authored(seed, chunk) ? empty : this.base.objectsAt(seed, chunk); }
  getChunk(seed, chunk, raster = false) { return this.authored(seed, chunk) || this.base.getChunk(seed, chunk, raster); }
  growthPlan(seed, chunk, options) { return this.authored(seed, chunk) ? null : this.base.growthPlan(seed, chunk, options); }
  solidSample(seed, chunk, x, y, descriptor, state) { const source = this.authored(seed, chunk); return source ? this.readMask(source.solid, x, y) : this.base.solidSample(seed, chunk, x, y, descriptor, state); }
  steelSample(seed, chunk, x, y, descriptor, state) { const source = this.authored(seed, chunk); return source ? this.readMask(source.steel, x, y) : this.base.steelSample(seed, chunk, x, y, descriptor, state); }
  rasterSample(seed, chunk, x, y, descriptor, state) { const source = this.authored(seed, chunk); return source ? !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= 128 || y < 0 || y >= this.height ? 0 : source.pixels[Math.floor(y) * 128 + Math.floor(x)] : this.base.rasterSample(seed, chunk, x, y, descriptor, state); }
  readMask(mask, x, y) { if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= 128 || y < 0 || y >= this.height) return false; const index = Math.floor(y) * 128 + Math.floor(x); return !!(mask[index >>> 5] >>> (index & 31) & 1); }
  collisionAt(seed, x, y, steel = false) { const chunk = Math.floor(x / 128), source = this.authored(seed, chunk); return source ? this.readMask(steel ? source.steel : source.solid, x - source.origin, y) : this.base.collisionAt(seed, x, y, steel); }
  surface(seed, x) { const source = this.authored(seed, Math.floor(x / 128)); return source ? source.topProfile[Math.floor(x) - source.origin] : this.base.surface(seed, x); }
  isFlat(seed, x) { const y = this.surface(seed, x); return y >= 0 && this.surface(seed, x + 8) === y; }
  sample(seed, x, y) { return this.rasterSample(seed, Math.floor(x / 128), x % 128, y); }
  retainDescriptors(interests) { const filtered = new Map(); for (const [seed, chunks] of interests) filtered.set(seed, new Set([...chunks].filter(chunk => chunk < 0 || chunk >= (this.views?.shape.chunksPerLane || 0)))); this.base.retainDescriptors(filtered); }
  sourceReceipt() { return freezeData({ status: this.views && !this.disposed ? 'prepared' : 'unavailable', profile: SCENE_TERRAIN_REVISION, method: this.job?.receipt.method ?? null, activeExecution: this.job?.receipt.executionIdentity?.activeExecution ?? null, layoutHash: this.sceneTerrainLayoutHash, storageHash: this.views?.storageHash ?? null, typedBytes: this.views?.storage.byteLength ?? 0, fineGrowth: false, objectPolicy: 'no-procedural-objects-inside-initial-score', qualification: 'original-authored-source;runtime-and-playability-validation-pending' }); }
  getDebugState() { return { ...this.base.getDebugState(), authoredSceneTerrain: this.sourceReceipt(), memoryMB: this.memoryMB }; }
  dispose() {
    if (this.retirement.getReceipt()) return this.retirement.getReceipt(); this.disposed = true; this.controller.abort(new Error('Authored scene terrain retired.'));
    const producer = (async () => {
      await this.pending?.catch(() => {});
      const ended = this.failure?.backgroundRetirementCompletion ? await this.failure.backgroundRetirementCompletion : this.failure?.backgroundRetirement;
      if (ended && !['released', 'canceled'].includes(ended.phase)) throw Object.assign(new Error('Authored source producer retirement is unresolved.'), { sourceOwner: this });
      this.records = []; this.views = null; this.seedToLane.clear();
      if (this.job) { try { retireBackgroundResult(this.job); } catch (error) { throw Object.assign(error, { sourceOwner: this }); } this.job = null; }
    })();
    return this.retirement.retire([{ name: 'authored-terrain-result', run: () => producer }, { name: 'base-terrain-source', run: () => afterProcgenRetirement([producer], () => this.base.dispose()) }]);
  }
}
