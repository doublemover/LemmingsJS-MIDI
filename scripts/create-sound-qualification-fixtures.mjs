import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadProcgenMasks } from './bench-procgen-lanes.js';
import { collectRuntimeSourceClosure } from './RuntimeSourceClosure.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createDefaultPhysicalGraph } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { causalRuntimeSourceVersions } from '../js/app/procgen/workstation/CausalRuntimeIdentity.js';
import { hashData, canonicalDataText } from '../js/core/CanonicalData.js';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 3 || !process.argv[2].startsWith('--out-dir=')) throw new Error('Explicit new --out-dir=temp/... required; this command runs deferred real-world fixture capture, not acoustic validation.');
const out = path.resolve(root, process.argv[2].slice(10)); if (!out.startsWith(path.join(root, 'temp') + path.sep)) throw new Error('Fixture corpus must be a new temp subdirectory.');
await fs.mkdir(path.dirname(out), { recursive: true }); const realParent = await fs.realpath(path.dirname(out)); if (!(realParent + path.sep).startsWith(path.join(await fs.realpath(root), 'temp') + path.sep)) throw new Error('Fixture output ancestor escapes temp.'); await fs.mkdir(out);
const source = await collectRuntimeSourceClosure({ rootDir: root, entries: ['js/app/procgen/ProcgenLaneWorld.js', 'js/app/procgen/workstation/CausalMusicEngine.js'], maxBytes: 32 * 1048576 });
const masks = await loadProcgenMasks(), fixtures = [], sourceHash = await hashData(source);
for (const [density, count] of [['sparse', 1], ['medium', 4], ['dense', 12]]) {
  const chunks = new Map(), terrain = { chunkWidth: 256, surface: () => 72, configure() {}, reset() { chunks.clear(); }, getChunk(_seed, index) {
    if (!chunks.has(index)) { const solid = new Uint32Array(768), steel = new Uint32Array(768);
      for (let y = 0; y < 96; y++) for (let x = 0; x < 256; x++) { const wx = index * 256 + x, bit = y * 256 + x; if (y >= 72 || (wx === 20 || wx === 81) && y >= 48) solid[bit >>> 5] |= 1 << (bit & 31); }
      chunks.set(index, { solid, steel, topProfile: new Uint8Array(256).fill(72), gapWidth: 0, barrierWidth: 0 }); }
    return chunks.get(index);
  } };
  const world = new ProcgenLaneWorld({ masks, terrain, worldId: 'sound-qualification-' + density, seed: 701, assists: false, cohorts: true, laneCount: 1, maxActors: count }), graph = createDefaultPhysicalGraph(701), clock = createProcgenPhysicalScoreClock();
  const engine = createCausalMusicEngine({ getGraph: () => graph, scoreTimeline: clock }), batches = [], intents = []; let captureError = null;
  try {
    for (let i = 0; i < count; i++) { const actor = world._spawn(0, false); if (!actor) throw new Error('Real actor admission rejected the fixture population.'); Object.assign(actor, { x: 39 - i, y: 72, lookRight: true, furthestX: 39 - i, scout: false }); actor.setAction(world.actions[State.WALKING]); }
    const initial = captureProcgenCheckpoint(world), checkpointHash = await hashData(initial);
    world.soundEvents.onBatch.on(batch => { try { if (batch.completeness.status !== 'complete' || batch.completeness.dropped) throw new Error('Fixture has censored physical facts.'); clock.observe(batch, { bpm: 120 }); batches.push(batch); intents.push(...engine.processBatch(batch)); } catch (error) { captureError ||= error; } });
    for (let tick = 0; tick < 240; tick++) { world.step(); if (captureError) throw captureError; }
    if (!intents.some(intent => intent.kind === 'begin') || intents.length > 8192 || world.actors.some(actor => actor.failureReason || actor.terminalReason)) throw new Error('The real-world fixture did not retain complete surviving semantic activity.');
    const final = captureProcgenCheckpoint(world), factHash = await hashData(batches), durationSeconds = batches.at(-1).sourceTimeMs / 1000;
    const sourceCanonicalHash = await hashData({ sourceHash, initial, graph, batches, intents, final });
    const revoice = { version: 1, operation: 'sound-only-revoice', takeId: 'fixture:' + density + ':' + sourceCanonicalHash, takeRevision: 1, sourceCanonicalHash,
      sourceState: 'finalized', nextSequence: null, sourceVersions: causalRuntimeSourceVersions(world, graph.revision), coverage: { status: 'known-covered' },
      boundary: { status: 'captured-initial-state', state: { voices: [], sourceTimeMs: 0 } }, finalBoundaryState: { sourceTimeMs: durationSeconds * 1000, timeline: clock.snapshot() }, intents };
    fixtures.push({ id: 'real-circuit-' + density, density, evidence: 'recorded-committed-world', physicalTakeEvidence: true, sourceHash, checkpointHash, factHash, revoice, fixtureHash: await hashData(revoice), durationSeconds,
      observed: { actors: world.actors.length, begins: intents.filter(intent => intent.kind === 'begin').length, batches: batches.length }, originalCorpus: true, acousticEvidence: false });
    const bytes = canonicalDataText({ initial, graph, batches, final, sourceHash }, { maxBytes: 32 * 1048576, maxNodes: 2000000 }).bytes;
    await fs.writeFile(path.join(out, density + '-world-capture.json'), bytes, { flag: 'wx' });
  } finally { world.dispose(); }
}
const bytes = canonicalDataText({ schema: 'lemmings-real-sound-fixture-corpus/v1', source, fixtures }, { maxBytes: 12 * 1048576, maxNodes: 1048576 }).bytes;
await fs.writeFile(path.join(out, 'fixtures.json'), bytes, { flag: 'wx' });
console.log(JSON.stringify({ path: path.relative(root, path.join(out, 'fixtures.json')), sha256: createHash('sha256').update(bytes).digest('hex'), densities: fixtures.map(value => ({ density: value.density, ...value.observed })), acousticQualification: 'not-performed' }, null, 2));
