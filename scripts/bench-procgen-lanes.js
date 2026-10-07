import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { MaskProvider } from '../js/render/MaskProvider.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { GroundReader, loadSteelSprites } from '../js/level/GroundReader.js';
import { loadTerrainRecipeBook, selectThemeRecipe } from '../js/app/procgen/ProcgenTerrainRecipes.js';
import { ProcgenRecipeTerrain } from '../js/app/procgen/ProcgenRecipeTerrain.js';
import { ProcgenLaneWorld, normalizeLaneCount } from '../js/app/procgen/ProcgenLaneWorld.js';

const loadProcgenMasks = async (path = new URL('../lemmings_ohNo/MAIN.DAT', import.meta.url)) =>
  new MaskProvider(new FileContainer(new BinaryReader(await fs.readFile(path))).getPart(1));
const loadProcgenTerrain = async (packPath = 'lemmings_ohNo', groundSet = 0) => {
  const provider = new NodeFileProvider(fileURLToPath(new URL('../', import.meta.url)));
  await loadSteelSprites();
  const ground = await provider.loadBinary(packPath, `GROUND${groundSet}O.DAT`);
  const vga = new FileContainer(await provider.loadBinary(packPath, `VGAGR${groundSet}.DAT`));
  const terrainPieces = new GroundReader(ground, vga.getPart(0), vga.getPart(1)).getTerrainImages().map((image, id) => ({
    id, image, width: image.width, height: image.height, frame: image.frames[0], isSteel: !!image.isSteel,
    solidRatio: image.frames[0].filter(ci => !(ci & 128)).length / (image.width * image.height)
  }));
  const recipe = selectThemeRecipe(await loadTerrainRecipeBook(provider), { packPath, groundSet });
  return new ProcgenRecipeTerrain({ recipe, terrainPieces });
};
const runLaneBenchmark = ({ masks, lanes = 32, ticks = 3000, seed = 42, assists = true, terrain = null, cohorts = false, spawnSpreadTicks = 0 } = {}) => {
  const world = new ProcgenLaneWorld({ masks, laneCount: lanes, seed, assists, terrain, cohorts, spawnSpreadTicks });
  const before = process.memoryUsage(), start = performance.now();
  let actorSteps = 0;
  for (let tick = 0; tick < ticks; tick++) { actorSteps += world.actors.length; world.step(); }
  const elapsedMs = performance.now() - start, after = process.memoryUsage();
  const result = { ...world.getDebugState(), rendered: false, elapsedMs, ticksPerSecond: ticks * 1000 / elapsedMs,
    actorStepsPerSecond: actorSteps * 1000 / elapsedMs,
    heapDeltaMB: (after.heapUsed - before.heapUsed) / 1048576, rssMB: after.rss / 1048576 };
  world.dispose();
  return result;
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
  const lanes = normalizeLaneCount(args.lanes || 32);
  const ticks = Math.max(1, Math.min(100000, Math.trunc(Number(args.ticks)) || 3000));
  const masks = await loadProcgenMasks();
  const terrain = args.analytic === 'true' ? null : await loadProcgenTerrain(args.pack || 'lemmings_ohNo', Number(args.groundSet) || 0);
  console.log(JSON.stringify(runLaneBenchmark({ masks, lanes, ticks, terrain, cohorts: args.cohorts !== 'false', spawnSpreadTicks: 12, seed: args.seed || 42, assists: args.assists !== 'false' }), null, 2));
}
export { loadProcgenMasks, loadProcgenTerrain, runLaneBenchmark };
