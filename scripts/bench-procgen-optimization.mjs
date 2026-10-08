import fs from 'node:fs/promises';
import path from 'node:path';
import inspector from 'node:inspector';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const root = path.resolve(args.repo || '.'), out = path.resolve(args.output || '../lemmings_optimization_artifacts');
await fs.mkdir(out, { recursive: true });
const source = file => import(pathToFileURL(path.join(root, file)));
const [{ loadProcgenMasks, loadProcgenTerrain }, { ProcgenLaneWorld }, { ProcgenLaneRenderer }, { CharacterSpriteSet }, { PixelSpriteSkin }] = await Promise.all([
  source('scripts/bench-procgen-lanes.js'), source('js/app/procgen/ProcgenLaneWorld.js'), source('js/app/procgen/ProcgenLaneRenderer.js'), source('js/lemmings/CharacterSpriteSet.js'), source('js/lemmings/PixelSpriteSkin.js')
]);
const read = file => fs.readFile(path.join(root, file), 'utf8');
const base = new PixelSpriteSkin(JSON.parse(await read('assets/hydro/hydro-skin.json'))), catalog = JSON.parse(await read('assets/characters/catalog.json'));
const preference = { shape: 'mixed', seed: 42, bodyColor: 'random', propColor: 'random', eyewearColor: 'random', accessory: 'crown', eyewear: 'classic_sunglasses' };
const sprites = new CharacterSpriteSet(base, catalog, read, () => preference); await sprites.prepare();
const [masks, terrain] = await Promise.all([loadProcgenMasks(), loadProcgenTerrain()]);
const stats = values => { const s = [...values].sort((a, b) => a - b); return { mean: values.reduce((a, b) => a + b, 0) / values.length, p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], p99: s[Math.floor(s.length * 0.99)] }; };
const results = { metadata: { repository: root, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), diffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'], { cwd: root })).digest('hex'), node: process.version, date: new Date().toISOString(), scope: 'Node real actions, terrain, palettes and typed-array raster computation. Canvas calls mocked; not browser FPS, raster/compositor or native audio.' }, simulation: [], render: [], longRun: [] };
const save = async () => fs.writeFile(path.join(out, 'optimization-results.json'), JSON.stringify(results, null, 2));
const canvas = (width, height, counters) => ({ width, height, addEventListener() {}, removeEventListener() {}, ownerDocument: { createElement: () => canvas(1, 1, counters) }, getContext: () => ({ globalAlpha: 1,
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() { counters.uploads++; }, drawImage() { counters.draws++; }, fillRect() {}, clearRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }) });
const lanes = (args.lanes || '1,32,128,1024').split(',').map(Number), repetitions = Number(args.repetitions) || 3;
for (const laneCount of args.renderOnly ? [] : lanes) for (const cosmetics of [false, true]) {
  const runs = [];
  for (let run = 0; run < repetitions; run++) {
    const world = new ProcgenLaneWorld({ masks, terrain, sprites: cosmetics ? sprites : null, laneCount, seed: 42, cohorts: true, spawnSpreadTicks: 12 });
    for (let i = 0; i < 400; i++) world.step();
    global.gc?.(); const before = process.memoryUsage(), times = []; let actorSteps = 0;
    for (let i = 0; i < 1200; i++) { actorSteps += world.actors.length; const t = performance.now(); world.step(); times.push(performance.now() - t); }
    const debug = world.getDebugState(); delete debug.stall; delete debug.frontierMargins;
    runs.push({ tickMs: stats(times), elapsedMs: times.reduce((a, b) => a + b, 0), actorSteps, heapDeltaMiB: (process.memoryUsage().heapUsed - before.heapUsed) / 1048576, debug });
    world.dispose();
  }
  results.simulation.push({ laneCount, cosmetics, warmup: 400, ticks: 1200, runs }); await save(); console.log(JSON.stringify({ laneCount, cosmetics, means: runs.map(run => run.tickMs.mean), p95: runs.map(run => run.tickMs.p95) }));
}
for (const laneCount of [1, 32, 1024]) {
  const world = new ProcgenLaneWorld({ masks, terrain, sprites, laneCount, seed: 42, cohorts: true, spawnSpreadTicks: 12 });
  for (let i = 0; i < 600; i++) world.step();
  for (const scale of [3, 1, 0.125, 1 / 256]) {
    if (args.baseline && scale < 1) continue;
    const counters = { uploads: 0, draws: 0 }, renderer = new ProcgenLaneRenderer({ canvas: canvas(1280, 720, counters), world, assets: { groundPieces: terrain.pieces }, windowRef: { performance, devicePixelRatio: 1 } });
    renderer.scale = scale; renderer.follow = false; renderer.cameraX = 100;
    const coldStart = performance.now(); renderer.render(); const coldMs = performance.now() - coldStart;
    for (let i = 0; i < 20; i++) renderer.render();
    const times = []; for (let i = 0; i < 160; i++) { const t = performance.now(); renderer.render(); times.push(performance.now() - t); }
    const result = { laneCount, scale, canvas: [1280, 720], sourceRaster: [renderer.buffer.width, renderer.buffer.height], coldMs, staticMs: stats(times), counters };
    const moving = []; for (let i = 0; i < 40; i++) { renderer.cameraX++; const t = performance.now(); renderer.render(); moving.push(performance.now() - t); }
    result.movingMs = stats(moving); results.render.push(result); console.log(JSON.stringify(result)); await save(); renderer.dispose();
  }
  world.dispose();
}
if (!args.baseline && !args.skipLong) {
  for (const seed of [1, 42, 12345]) {
    const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 8, seed });
    for (let tick = 0; tick < 40000; tick++) world.step();
    const debug = world.getDebugState(); delete debug.stall;
    results.longRun.push(debug); world.dispose(); await save();
  }
  const session = new inspector.Session(); session.connect();
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 1000 }); await post('Profiler.start');
  const world = new ProcgenLaneWorld({ masks, terrain, laneCount: 1024, seed: 42, cohorts: true, spawnSpreadTicks: 12 });
  for (let tick = 0; tick < 1600; tick++) world.step();
  const profile = await post('Profiler.stop'); await fs.writeFile(path.join(out, 'optimized-simulation-1024.cpuprofile'), JSON.stringify(profile.profile)); world.dispose(); session.disconnect();
}
await save();
