import fs from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { LemmingsSprite } from '../js/lemmings/LemmingsSprite.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { loadProcgenMasks, loadProcgenTerrain } from './bench-procgen-lanes.js';
const args = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')));
const iterations = Math.max(20, Math.min(1000, Number(args.iterations) || 160));
const distribution = values => { values.sort((a, b) => a - b); return Object.fromEntries([['p50', .5], ['p95', .95], ['p99', .99]].map(([name, percentile]) => [name, values[Math.min(values.length - 1, Math.floor(values.length * percentile))]])); };
const main = await fs.readFile(new URL('../lemmings_ohNo/MAIN.DAT', import.meta.url)), container = new FileContainer(new BinaryReader(main));
const terrain = await loadProcgenTerrain(), masks = await loadProcgenMasks(), sprites = new LemmingsSprite(container.getPart(0), terrain.pieces[0].image.palette);
const sourceFiles = ['scripts/bench-procgen-actor-effects.mjs', 'js/app/procgen/ProcgenLaneRenderer.js', 'js/app/procgen/ProcgenActorEffectDisplay.js', 'js/app/procgen/ProcgenActorEffectPass.js', 'js/lemmings/Lemming.js'];
const receipt = { metadata: { name: args.name || 'unnamed', date: new Date().toISOString(), node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await fs.readFile(file)).digest('hex')]))), sourceArtSha256: createHash('sha256').update(main).digest('hex'),
  scope: 'Production renderer, real source Lemming art and analytic physical terrain, supplied synthetic effect samples, mocked canvas submissions. Not DSP, browser GPU, acoustics, heap-retention or a universal release gate.',
  fixture: 'Eight visible rows, sixteen actors per visible row, stationary physical state; off versus supplied bounded X/scale/inner/outer/trail evidence. Same visible density at 8 and 1024 total lanes.', isolation: 'Shared Windows development host with concurrent agent work.' }, rows: [] };
for (const laneCount of [8, 1024]) for (const enabled of [false, true]) {
  const world = new ProcgenLaneWorld({ laneCount, masks, sprites, seed: 42 });
  for (let lane = 0; lane < 8; lane++) for (let crowd = 1; crowd < 16; crowd++) world._spawn(lane, false);
  const visible = world.actors.filter(actor => actor.laneIndex < 8);
  for (let index = 0; index < visible.length; index++) { visible[index].x = 100 + index % 16 * 5; visible[index].y = visible[index].laneIndex * 96 + 70; }
  const physicalHash = () => createHash('sha256').update(JSON.stringify({ generation: world.generation, tick: world.tickIndex, terrainRevision: world.terrainRevision, actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.frameIndex, actor.action.actionName]), sequence: world.soundEvents._causalSequence })).digest('hex');
  const before = physicalHash(); let now = 0;
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {}, fillRect() {}, fillText() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const document = { createElement: () => ({ width: 0, height: 0, getContext: () => context, addEventListener() {}, removeEventListener() {} }) };
  const canvas = { width: 960, height: 608, clientWidth: 960, clientHeight: 608, ownerDocument: document, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 608 }), getContext: () => context, addEventListener() {}, removeEventListener() {} };
  const renderer = new ProcgenLaneRenderer({ canvas, world, assets: { groundPieces: [] }, windowRef: { devicePixelRatio: 1, performance: { now: () => now } } });
  renderer.follow = false; renderer.workstationLayout = { mode: 'strip', firstLane: 0, count: 8, rowHeight: 76, stripHeight: 18 };
  renderer.actorEffects.setEpoch({ worldId: world.worldId, generation: world.generation, executionEpoch: 'fixture', graphRevision: 1, routeRevision: 1 });
  renderer.actorEffects.setProfile({ version: 1, enabled, intensity: .75, smoothingMs: 0, bindings: [
    ['x', 'pitch-modulation'], ['scale', 'amplitude-envelope'], ['inner', 'drive-amount'], ['outer', 'filter-amount'], ['trail', 'delay-tap-envelope']
  ].map(([channel, quantity]) => ({ channel, quantity, effectId: 'fixture-effect' })) });
  const feed = iteration => { for (const actor of visible) for (const quantity of ['pitch-modulation', 'amplitude-envelope', 'drive-amount', 'filter-amount', 'delay-tap-envelope']) renderer.actorEffects.ingest({ version: 1,
    worldId: world.worldId, generation: world.generation, executionEpoch: 'fixture', graphRevision: 1, routeRevision: 1, actorId: actor.id, owner: { kind: 'actor', actorId: actor.id }, voiceId: `v${actor.id}`, onsetId: `o${actor.id}`, effectId: 'fixture-effect', effectRevision: 1,
    quantity, value: quantity === 'pitch-modulation' ? [0, .5, -.5, 1, -1][Math.floor(iteration / 3) % 5] : .75, units: quantity === 'pitch-modulation' ? 'normalized-signed' : 'normalized', evidenceClass: 'measured', coverage: 'complete', muted: false,
    appliedAudioFrame: Math.round(now * 48), window: { firstFrame: Math.round(now * 48), lastFrame: Math.round(now * 48) }, tapId: `tap${Math.floor(iteration / 15)}`, sourcePosition: { x: actor.x - 4, y: actor.y }
  }, { executionEpoch: 'fixture', audioFrame: Math.round(now * 48), presentationMs: now, sampleRate: 48000 }); };
  if (enabled) feed(0); renderer.render(); const terrainRebuilds = renderer.terrainRebuilds;
  const times = [], admissions = []; const allocationBefore = renderer.resources.allocations;
  for (let iteration = 0; iteration < iterations; iteration++) {
    now += 16; const startedAdmission = performance.now(); if (enabled && iteration % 3 === 0) feed(iteration); admissions.push(performance.now() - startedAdmission);
    const started = performance.now(); renderer.render(false); times.push(performance.now() - started); if (renderer.lifecycleState !== 'ready') throw new Error(renderer.displayError);
  }
  const after = physicalHash(); if (before !== after) throw new Error('Visual fixture changed physical state.');
  receipt.rows.push({ totalLanes: laneCount, visibleLanes: 8, visibleActors: visible.length, enabled, iterations, frameMs: distribution(times), admissionMs: distribution(admissions), terrainRebuilds: renderer.terrainRebuilds - terrainRebuilds,
    imageAllocations: renderer.resources.allocations - allocationBefore, effectDrawPasses: renderer.actorEffectPass.drawPasses, effects: renderer.actorEffects.getDiagnostics(), backing: renderer.resources.getStats(), physicalHash: after });
  renderer.dispose(); world.dispose();
}
const json = JSON.stringify(receipt, null, 2) + '\n'; if (args.output) await fs.writeFile(args.output, json); else process.stdout.write(json);
