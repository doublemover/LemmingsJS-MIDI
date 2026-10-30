import { baseScoredTerrainFixture } from './scored-terrain.js';

export async function createActualScoredWorldFactory({ masks, sprites = null, jobs, maxActors = null, sourceRoot = new URL('../../js/app/procgen/', import.meta.url) }) {
  const [{ ProcgenLaneWorld }, { ProcgenScoredTerrain }, { createResourceBudget }] = await Promise.all([
    import(new URL('ProcgenLaneWorld.js', sourceRoot)), import(new URL('ProcgenScoredTerrain.js', sourceRoot)), import(new URL('../resources/ResourceBudget.js', sourceRoot))]);
  return async layout => {
    const budget = createResourceBudget({ limitBytes: 96 * 1048576 });
    const terrain = new ProcgenScoredTerrain(baseScoredTerrainFixture([], layout.lanes.length), layout, { resourceBudget: budget, ...(jobs ? { jobs } : {}) }); let world = null, retired = false;
    const dispose = async () => { if (retired) return; retired = true; const receipt = world?.dispose(); if (receipt?.completion) await receipt.completion; await terrain.dispose().completion; if (budget.diagnostics().accountedBytes !== 0) throw new Error('Actual scored fixture leaked its admitted source budget.'); };
    try {
      await terrain.prepare(); world = new ProcgenLaneWorld({ masks, sprites, terrain, seed: 42, laneCount: layout.lanes.length, laneHeight: layout.laneHeight, assists: false, maxActors: maxActors ?? layout.lanes.length, stallPolicy: { secondsWithoutProgress: 1000 } });
      return { world, dispose };
    } catch (error) { await dispose(); throw error; }
  };
}
