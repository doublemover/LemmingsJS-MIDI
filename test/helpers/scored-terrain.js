import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
export const baseScoredTerrainFixture = (events = [], laneCount = 1) => {
  const theme = { recipe: { id: 'fixture-rock', family: 'rock', assetSha256: 'a'.repeat(64) }, pieces: [], objects: [], height: 96, workstation: true, hazardSpacing: 1024, sharedSpanBudget: 1 }, retirement = createProcgenRetirementScope();
  const base = { themes: [{ family: 'rock', familyId: 'rock', styleName: 'rock', terrain: theme }], chunkWidth: 128, height: 96, memoryMB: 0, laneAssignments: Array(laneCount).fill('rock'), laneThemes: [], assignments: new Map(), collision: new Map(), objects: [], pieces: [],
    configure(_lanes, _actors, options) { base.height = theme.height = options.laneHeight; theme.workstation = !!options.workstation; theme.hazardSpacing = options.hazardSpacing ?? 0; },
    registerLanes(seeds) { base.assignments = new Map(Array.from(seeds, seed => [seed, 0])); base.laneThemes = Array(seeds.length).fill('rock'); }, forSeed() { return theme; },
    setLaneAssignments(values) { base.laneAssignments = [...values]; }, exportAssignments() { return { assignments: [...base.assignments], laneAssignments: [...base.laneAssignments], laneThemes: [...base.laneThemes] }; },
    restoreAssignments(value) { base.assignments = new Map(value.assignments); base.laneAssignments = [...value.laneAssignments]; base.laneThemes = [...value.laneThemes]; },
    getChunk(_seed, chunk) { if (!base.collision.has(chunk)) base.collision.set(chunk, { origin: chunk * 128, solid: new Uint32Array(384), steel: new Uint32Array(384), pixels: new Uint32Array(12288), topProfile: new Int16Array(128).fill(-1), placements: [], objects: [] }); return base.collision.get(chunk); },
    describe(seed, chunk) { return base.getChunk(seed, chunk); }, objectsAt() { return []; }, growthPlan() { return null; }, solidSample() { return false; }, steelSample() { return false; }, rasterSample() { return 0; }, surface() { return -1; }, collisionAt() { return false; }, retainDescriptors() {},
    getDebugState() { return { fixture: true }; }, reset() { base.collision.clear(); base.assignments.clear(); }, dispose() { return retirement.retire([{ name: 'fixture-source', run: () => { events.push('base-assets'); base.reset(); } }]); }
  }; return base;
};
