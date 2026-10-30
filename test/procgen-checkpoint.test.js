import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';

describe('ProcGen world checkpoints', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const make = async () => new ProcgenLaneWorld({ masks, terrain: await loadProcgenTerrain('lemmings', 0), laneCount: 2, seed: 42, cohorts: true });
  const state = world => ({ tick: world.tickIndex, actors: world.actors.map(a => [a.id, a.x, a.y, a.action.actionName, a.frameIndex, a.state, a.failureReason]), stats: world.stats, frontiers: [...world.frontiers], spawned: world.spawnedTotal });
  it('round-trips actors, sparse terrain and live crew work and continues deterministically', async () => {
    const original = await make(), restored = await make();
    try {
      for (let tick = 0; tick < 600; tick++) original.step();
      const saved = JSON.parse(JSON.stringify(captureProcgenCheckpoint(original)));
      restoreProcgenCheckpoint(restored, saved);
      expect(state(restored)).to.deep.equal(state(original));
      expect(restored.simulationTimeMs).to.equal(original.simulationTimeMs);
      for (let tick = 0; tick < 120; tick++) { original.step(); restored.step(); }
      expect(state(restored)).to.deep.equal(state(original));
      expect(restored.simulationTimeMs).to.equal(original.simulationTimeMs);
    } finally { original.dispose(); restored.dispose(); }
  });
  it('rejects incompatible assets before restoring', async () => {
    const world = await make();
    try {
      const saved = captureProcgenCheckpoint(world), revision = saved.assets[0].revision;
      saved.assets[0].revision = 'different'; expect(() => restoreProcgenCheckpoint(world, saved)).to.throw('assets');
      saved.assets[0].revision = revision;
      saved.seed++; expect(() => restoreProcgenCheckpoint(world, saved)).to.throw('Incompatible world checkpoint');
    }
    finally { world.dispose(); }
  });

  it('refuses typed integer wrapping and fractional loss before mutating the live world', async () => {
    const world = await make();
    try {
      const saved = captureProcgenCheckpoint(world), originalTick = world.tickIndex;
      const integer = saved.graph.nodes.find(node => node.type === 'Uint8Array');
      integer.values[0] = 256;
      expect(() => restoreProcgenCheckpoint(world, saved)).to.throw('lose precision');
      expect(world.tickIndex).to.equal(originalTick);
      integer.values[0] = 1.25;
      expect(() => restoreProcgenCheckpoint(world, saved)).to.throw('lose precision');
    } finally { world.dispose(); }
  });

  it('restores physical event identities and completed source JSON across continued simulation', () => {
    const original = new ProcgenLaneWorld({ masks, seed: 42, assists: false });
    const restored = new ProcgenLaneWorld({ masks, seed: 42, assists: false });
    const first = [], second = [];
    original.soundEvents.onBatch.on(batch => first.push(batch));
    restored.soundEvents.onBatch.on(batch => second.push(batch));
    try {
      for (let tick = 0; tick < 40; tick++) original.step(200);
      const saved = JSON.parse(JSON.stringify(captureProcgenCheckpoint(original)));
      for (let tick = 0; tick < 7; tick++) restored.step(1000);
      restoreProcgenCheckpoint(restored, saved);
      expect(restored.soundEvents.snapshotIdentity()).to.deep.equal(saved.physicalIdentity);
      first.length = 0; second.length = 0;
      for (let tick = 0; tick < 1000; tick++) { original.step(400); restored.step(4000); }
      expect(JSON.stringify(second)).to.equal(JSON.stringify(first));
      expect(restored.soundEvents.snapshotIdentity()).to.deep.equal(original.soundEvents.snapshotIdentity());
    } finally { original.dispose(); restored.dispose(); }
  });

  it('refuses malformed event identity before mutation and labels legacy identity as unavailable', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    try {
      const saved = captureProcgenCheckpoint(world);
      expect(() => restoreProcgenCheckpoint(world, { ...saved, physicalIdentity: { ...saved.physicalIdentity, causalSequence: NaN } }))
        .to.throw('physical event identity');
      expect(world.soundEvents.identityCoverage).to.equal('complete');
      delete saved.physicalIdentity;
      restoreProcgenCheckpoint(world, saved);
      expect(world.soundEvents.identityCoverage).to.equal('legacy-unavailable');
      world._failedTick = true;
      expect(() => captureProcgenCheckpoint(world)).to.throw('incomplete physical boundary');
    } finally { world.dispose(); }
  });
  it('preserves floating sentinels through JSON and rejects ambiguous legacy numbers', async () => {
    const original = await make(), restored = await make();
    try {
      original._edgeWallRevisions[0] = -0;
      const saved = JSON.parse(JSON.stringify(captureProcgenCheckpoint(original)));
      expect(saved.version).to.equal(2);
      const props = saved.graph.owners.find(owner => owner.name === 'world').props;
      const activity = saved.graph.nodes[props.terrainActivityTicks.ref], signed = saved.graph.nodes[props._edgeWallRevisions.ref];
      expect(activity.values[0]).to.deep.equal({ special: '-Infinity' });
      expect(signed.values[0]).to.deep.equal({ special: '-0' });
      restoreProcgenCheckpoint(restored, saved);
      expect(restored.terrainActivityTicks[0]).to.equal(-Infinity);
      expect(Object.is(restored._edgeWallRevisions[0], -0)).to.equal(true);
      for (const special of ['Infinity', 'NaN']) {
        const invalid = structuredClone(saved);
        invalid.graph.nodes[props.terrainActivityTicks.ref].values[0] = { special };
        expect(() => restoreProcgenCheckpoint(restored, invalid)).to.throw('Invalid terrain activity tick');
      }
      const legacy = structuredClone(saved); legacy.version = 1;
      for (const node of legacy.graph.nodes) if (node.type === 'Float32Array' || node.type === 'Float64Array') node.values = node.values.map(value => {
        if (typeof value !== 'object') return value;
        return { '-0': -0, Infinity, '-Infinity': -Infinity, NaN }[value.special];
      });
      restoreProcgenCheckpoint(restored, legacy);
      expect(() => restoreProcgenCheckpoint(restored, JSON.parse(JSON.stringify(legacy)))).to.throw('lost numeric state');
    } finally { original.dispose(); restored.dispose(); }
  });
  it('continues the same automatic reset seeds and terrain after a saved real cascade', async () => {
    const makeResetWorld = async seed => new ProcgenLaneWorld({ masks, terrain: await loadProcgenTerrain('lemmings', 0),
      laneCount: 2, seed, cohorts: true, workstation: true, spawnSpreadTicks: 0,
      stallPolicy: { secondsWithoutProgress: 0, baseSpawnAllowance: 0, transitSafetyFactor: 0, workGraceSeconds: -1, pendingWorkGraceSeconds: -1 } });
    const original = await makeResetWorld(42), restored = await makeResetWorld(42);
    try {
      for (let tick = 0; tick < 60 && original.stall.phase !== 'cascade'; tick++) original.step();
      expect(original.stall.phase).to.equal('cascade');
      expect(original.actors.some(actor => actor.action.actionName === 'oh-no')).to.equal(true);
      const saved = JSON.parse(JSON.stringify(captureProcgenCheckpoint(original)));
      restoreProcgenCheckpoint(restored, saved);
      let lastGeneration = original.generation, lastSeed = original.seed, resets = 0;
      for (let tick = 0; tick < 180; tick++) {
        original.step(); restored.step();
        expect([restored.seed, restored.generation, ...restored.laneSeeds]).to.deep.equal([original.seed, original.generation, ...original.laneSeeds]);
        if (original.generation !== lastGeneration) {
          expect(original.seed).not.to.equal(lastSeed);
          lastGeneration = original.generation; lastSeed = original.seed; resets++;
        }
      }
      expect(resets).to.be.greaterThan(0);
      expect(state(restored)).to.deep.equal(state(original));
      expect(restored.terrainGrowth.exportState()).to.deep.equal(original.terrainGrowth.exportState());
      expect(restored.scenery.snapshot()).to.deep.equal(original.scenery.snapshot());
    } finally { original.dispose(); restored.dispose(); }
  });
  it('replays an automatic-reset seed with the same starting terrain, spawn phases and next seeds', async () => {
    const makeReplayWorld = async seed => new ProcgenLaneWorld({ masks,
      terrain: new ProcgenPackTerrain([
        { styleName: 'dirt', terrain: await loadProcgenTerrain('lemmings', 0) },
        { styleName: 'fire', terrain: await loadProcgenTerrain('lemmings', 1) }
      ]), laneCount: 8, seed, cohorts: true, workstation: true, spawnSpreadTicks: 12,
      stallPolicy: { secondsWithoutProgress: 0, baseSpawnAllowance: 0, transitSafetyFactor: 0, workGraceSeconds: -1, pendingWorkGraceSeconds: -1 } });
    const advanceReset = world => {
      const generation = world.generation;
      for (let tick = 0; tick < 180 && world.generation === generation; tick++) world.step();
      expect(world.generation).to.equal(generation + 1);
    };
    const original = await makeReplayWorld(42); let replay;
    try {
      advanceReset(original);
      replay = await makeReplayWorld(original.seed);
      expect(replay.generation).to.equal(1);
      expect(original.generation).to.equal(2);
      expect(replay.laneSeeds).to.deep.equal(original.laneSeeds);
      expect(replay._spawnPhaseRanks).to.deep.equal(original._spawnPhaseRanks);
      expect(replay._spawnPhases).to.deep.equal(original._spawnPhases);
      expect(replay.terrain.exportAssignments()).to.deep.equal(original.terrain.exportAssignments());
      expect([...replay.terrainGrowth.states]).to.deep.equal([...original.terrainGrowth.states]);
      for (const seed of original.laneSeeds) for (const chunk of [0, 1, 7]) {
        expect(replay.terrain.describe(seed, chunk)).to.deep.equal(original.terrain.describe(seed, chunk));
      }
      for (let reset = 0; reset < 2; reset++) {
        const previousSeed = original.seed;
        advanceReset(original); advanceReset(replay);
        expect(original.seed).not.to.equal(previousSeed);
        expect(replay.seed).to.equal(original.seed);
        expect(replay.laneSeeds).to.deep.equal(original.laneSeeds);
      }
    } finally { original.dispose(); replay?.dispose(); }
  });
});
