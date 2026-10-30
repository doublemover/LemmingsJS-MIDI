import assert from 'node:assert/strict';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { loadProcgenMixedTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { loadTerrainRecipeBook } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';

const configs = ['lemmings', 'lemmings_ohNo', 'holiday94'].map(path => ({ path }));
class CountedProvider extends NodeFileProvider {
  constructor() { super(process.cwd()); this.reads = []; }
  async loadBinary(root, filename, options) { this.reads.push(`${root}/${filename}`); return super.loadBinary(root, filename, options); }
}

describe('required ProcGen family preparation', function() {
  this.timeout(15000);
  let book;
  before(async () => { book = await loadTerrainRecipeBook(new NodeFileProvider(process.cwd())); });

  it('decodes only explicitly assigned families and reports deferred collections honestly', async () => {
    const provider = new CountedProvider(), progress = [];
    const terrain = await loadProcgenMixedTerrain({ configs, fileProvider: provider, book, laneAssignments: ['crystal'],
      onProgress: state => progress.push(state), operationId: 'required-crystal', maxConcurrentCollections: 1 });
    assert.deepEqual(terrain.themes.map(theme => theme.familyId), ['crystal']);
    assert.deepEqual(provider.reads.sort(), ['lemmings/GROUND4O.DAT', 'lemmings/VGAGR4.DAT']);
    assert.equal(terrain.unpreparedThemes.length, 9); assert.deepEqual(terrain.unavailableThemes, []);
    assert.equal(progress.at(-1).completed, 1); assert.equal(progress.at(-1).total, 1);
    assert.equal(progress.at(-1).operationId, 'required-crystal');
    assert.equal(terrain.themes[0].provenance.resourceSources.ground.filename, 'GROUND4O.DAT');
    assert.equal(Object.isFrozen(terrain.themes[0].provenance.resourceSources), true);
    terrain.reset();
  });

  it('preserves a saved ordered family closure even when some families have no active lane', async () => {
    const provider = new CountedProvider();
    const terrain = await loadProcgenMixedTerrain({ configs, fileProvider: provider, book,
      laneAssignments: ['crystal'], requiredFamilies: ['fire', 'crystal'] });
    assert.deepEqual(terrain.themes.map(theme => theme.familyId), ['fire', 'crystal']);
    assert.equal(provider.reads.length, 4);
    terrain.configure(1); terrain.registerLanes(Uint32Array.of(42), 42);
    assert.equal(terrain.forSeed(42), terrain.themes[1].terrain);
    terrain.reset();
  });

  it('rejects unknown or incomplete imported closures before reading asset bytes', async () => {
    const provider = new CountedProvider();
    for (const requiredFamilies of [['crystal'], ['crystal', 'invented'], ['bubble', 'bubble']]) {
      await assert.rejects(loadProcgenMixedTerrain({ configs, fileProvider: provider, book,
        laneAssignments: ['bubble'], requiredFamilies }), /required terrain families/);
    }
    assert.equal(provider.reads.length, 0);
  });

  it('fails a required family precisely while optional catalog failures preserve supported work', async () => {
    const provider = new CountedProvider();
    await assert.rejects(loadProcgenMixedTerrain({ configs: [{ path: 'lemmings' }], fileProvider: provider, book,
      laneAssignments: ['bubble'] }), error => error.kind === 'not-found' && error.collection === 'bubble');
    const terrain = await loadProcgenMixedTerrain({ configs: [{ path: 'lemmings' }], fileProvider: provider, book,
      laneAssignments: ['crystal'], prepareAll: true });
    assert.equal(terrain.themes.some(theme => theme.familyId === 'crystal'), true);
    assert.equal(terrain.unavailableThemes.includes('bubble'), true);
    terrain.reset();
  });

  it('cancels a pending family without late readiness after its transport returns', async () => {
    const controller = new AbortController(), provider = new CountedProvider(), progress = [];
    let finishRead;
    const read = provider.loadBinary.bind(provider);
    provider.loadBinary = async (...args) => {
      if (args[1].startsWith('VGAGR')) await new Promise(resolve => { finishRead = resolve; });
      return read(...args);
    };
    const pending = loadProcgenMixedTerrain({ configs, fileProvider: provider, book, laneAssignments: ['crystal'],
      signal: controller.signal, onProgress: state => progress.push(state) });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(pending, error => error.kind === 'cancelled');
    finishRead(); await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(progress.some(state => state.state === 'ready'), false);
  });

  it('replays a selected-family checkpoint into an independently decoded candidate', async () => {
    const masks = await loadProcgenMasks(), requiredFamilies = ['fire', 'crystal'];
    const prepare = () => loadProcgenMixedTerrain({ configs, fileProvider: new CountedProvider(), book,
      laneAssignments: ['crystal'], requiredFamilies });
    const first = new ProcgenLaneWorld({ terrain: await prepare(), masks, seed: 42, laneCount: 1, workstation: true });
    const next = new ProcgenLaneWorld({ terrain: await prepare(), masks, seed: 42, laneCount: 1, workstation: true });
    try {
      for (let tick = 0; tick < 60; tick++) first.step();
      restoreProcgenCheckpoint(next, JSON.parse(JSON.stringify(captureProcgenCheckpoint(first))));
      for (let tick = 0; tick < 30; tick++) { first.step(); next.step(); }
      const state = world => ({ tick: world.tickIndex, frontiers: [...world.frontiers], actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.frameIndex]) });
      assert.deepEqual(state(first), state(next));
      assert.notEqual(first.terrain.themes[0].terrain.pieces[0].frame, next.terrain.themes[0].terrain.pieces[0].frame);
    } finally { first.dispose(); next.dispose(); }
  });
});
