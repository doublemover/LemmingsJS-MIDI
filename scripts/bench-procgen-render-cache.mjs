import fs from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from './bench-procgen-lanes.js';
import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';

const distribution = samples => {
  const sorted = samples.slice().sort((a, b) => a - b);
  return Object.fromEntries([['p50', 0.5], ['p95', 0.95], ['p99', 0.99]].map(([name, percentile]) => [name, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))]]));
};
const canvasFixture = (width, height) => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, drawImage() {}, fillRect() {}, clearRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => context, addEventListener() {}, removeEventListener() {} }) };
  return { width, height, clientWidth: width, clientHeight: height, ownerDocument: document, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};

const runRenderCacheBenchmark = async ({ lanes = [8, 128, 1024], iterations = 100, name = 'unnamed' } = {}) => {
  const masks = await loadProcgenMasks(), terrain = await loadProcgenTerrain('lemmings_ohNo', 0);
  const sourceFiles = ['scripts/bench-procgen-render-cache.mjs', 'js/app/procgen/ProcgenLaneRenderer.js', 'js/app/procgen/ProcgenObjectPlacementCache.js', 'js/app/procgen/ProcgenRenderResources.js'];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
  const objectHash = createHash('sha256');
  for (const piece of terrain.objects) {
    objectHash.update(JSON.stringify({ id: piece.id, width: piece.image.width, height: piece.image.height,
      palette: Array.from({ length: 128 }, (_, index) => piece.image.palette.getColor(index)) }));
    for (const frame of piece.image.frames) objectHash.update(frame);
  }
  const receipt = { metadata: { name, date: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch,
    cpu: os.cpus()[0]?.model || null, logicalCpus: os.cpus().length, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceHashes, assets: { terrain: terrain.recipe.assetSha256 || terrain.sourceDescriptor?.sourceRevision || null, objectFramesSha256: objectHash.digest('hex'), recipe: terrain.recipe.id },
    isolation: 'Shared development host; concurrent agent work is not controlled. Short local distributions are not release gates.',
    scope: 'Node production renderer, real source terrain/object art and typed-array pixels; canvas calls mocked. Not browser, GPU, interaction-to-paint, heap-retention or audio performance.',
    fixture: 'Eight visible rows, fixed actor density, fully revealed source tiles, stationary camera. A controlled dense fixture places real animated source-object images over canonical terrain with terrain clipping. Workload changes are explicit fixture edits or animation ticks; the benchmark does not advance physical simulation.' }, rows: [] };
  for (const laneCount of lanes) for (const scenario of ['distant-terrain-edit', 'animated-objects', 'visible-terrain-edit']) for (const cacheMode of ['retained', 'uncached-reference']) {
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount, seed: 42 });
    world.generatedThrough.fill(4096); world.frontiers.fill(4000);
    for (let lane = 0; lane < laneCount; lane++) world.terrainGrowth.completed[lane] = [[0, 4096]];
    for (const actor of world.actors) actor.x = 640;
    const describe = terrain.describe, descriptors = new Map(), visibleSeeds = new Set(Array.from(world.laneSeeds).slice(0, 8));
    const piece = terrain.objects.find(candidate => candidate.image.width <= 64 && candidate.image.height <= 64 && candidate.image.frames.length > 1) || terrain.objects[0];
    terrain.describe = function(seed, chunk) {
      const descriptor = describe.call(this, seed, chunk);
      if (!piece || !visibleSeeds.has(seed) || chunk < 4 || chunk > 6) return descriptor;
      const key = `${seed}:${chunk}`;
      if (!descriptors.has(key)) descriptors.set(key, { ...descriptor, objects: [...descriptor.objects, {
        piece, x: chunk * this.chunkWidth + 16, y: Math.max(0, world.laneHeight - piece.image.height), phase: chunk, animation: 'loop', role: 'terrain-overlay', clipToTerrain: true, supportY: null
      }] });
      return descriptors.get(key);
    };
    const renderer = new ProcgenLaneRenderer({ canvas: canvasFixture(MIN_DESKTOP_VIEWPORT.width, MIN_DESKTOP_VIEWPORT.height), world, assets: { groundPieces: terrain.pieces }, windowRef: { devicePixelRatio: 1, performance } });
    renderer.workstationLayout = { firstLane: 0, count: 8, rowHeight: 76, stripHeight: 18, mode: 'strips' };
    renderer.follow = false; renderer.cameraX = 512;
    try {
      renderer.render();
      for (let warmup = 0; warmup < 5; warmup++) renderer.render(false);
      const before = renderer.objectTileCache.getStats(), beforeResources = renderer.resources.getStats(), beforeActors = renderer.actorVisibility.getStats();
      global.gc?.(); const beforeHeap = process.memoryUsage().heapUsed, elapsed = [];
      for (let iteration = 0; iteration < iterations; iteration++) {
        if (scenario === 'animated-objects') world.tickIndex += 4;
        else world._setPixel(scenario === 'distant-terrain-edit' ? 8192 : 640, 80, iteration % 2 ? 0 : 3);
        if (cacheMode === 'uncached-reference') { renderer.objectTileCache.clear(); renderer.lastPlacementKey = renderer.lastObjectKey = ''; }
        const started = performance.now(); renderer.render(false); elapsed.push(performance.now() - started);
        if (renderer.lifecycleState !== 'ready') throw new Error('Benchmark display failed: ' + renderer.displayError);
      }
      const after = renderer.objectTileCache.getStats(), afterResources = renderer.resources.getStats(), actors = renderer.actorVisibility.getStats();
      receipt.rows.push({ totalLanes: laneCount, visibleLanes: 8, scenario, cacheMode, iterations, frameMs: distribution(elapsed),
        placementRebuilds: after.placementRebuilds - before.placementRebuilds, clipPixelsSampled: after.clipPixelsSampled - before.clipPixelsSampled,
        cacheHits: after.hits - before.hits, cacheMisses: after.misses - before.misses, imageAllocations: afterResources.allocations - beforeResources.allocations,
        actorPublicationScans: actors.actorScans - beforeActors.actorScans, actorDrawScans: actors.drawScans - beforeActors.drawScans,
        actorQueryVisits: actors.queryVisits - beforeActors.queryVisits, retainedClipBytes: after.clipBytes, peakClipBytes: after.peakClipBytes,
        maskAllocations: after.maskAllocations - before.maskAllocations, cachedBitmapBytes: afterResources.cachedBitmapBytes,
        estimatedBackingBytes: afterResources.estimatedBytes, heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap });
    } finally { renderer.dispose(); terrain.describe = describe; world.dispose(); }
  }
  return receipt;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')));
  const lanes = (args.lanes || '8,128,1024').split(',').map(Number).filter(value => Number.isInteger(value) && value >= 8 && value <= 1024);
  const receipt = await runRenderCacheBenchmark({ lanes, iterations: Math.max(1, Math.min(10000, Math.trunc(Number(args.iterations)) || 100)), name: args.name || 'unnamed' });
  const json = JSON.stringify(receipt, null, 2) + '\n';
  if (args.output) await fs.writeFile(args.output, json);
  else process.stdout.write(json);
}

export { runRenderCacheBenchmark };
