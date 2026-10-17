import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { MapObject } from '../js/level/MapObject.js';
import { Trigger } from '../js/level/Trigger.js';
import { Animation } from '../js/render/Animation.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { chainWorld } from './support/procgen-chain-fixtures.js';

const portable = value => JSON.parse(JSON.stringify(value));
const digest = world => portable({ tick: world.tickIndex, generation: world.generation,
  actors: world.actors.map(actor => Object.fromEntries(Object.entries(actor).filter(([key, value]) => !['log', 'runtime'].includes(key) && (value == null || typeof value !== 'object')).concat([['action', actor.action?.actionName], ['chain', actor._crewChainId]]))),
  stats: world.stats, frontiers: [...world.frontiers], spawned: world.spawnedTotal,
  edits: [...world.editChunks].sort((a, b) => a[0] - b[0]).map(([key, value]) => [key, [...value]]),
  growth: world.terrainGrowth?.exportState(), crews: world.lanePolicy.projects.lanes.map(lane => ({ ...lane, live: [...lane.live], projects: lane.projects.map(project => ({ ...project, members: [...project.members] })) })),
  hazardStats: world.hazards.stats, scenery: world.scenery?.snapshot() });

describe('Procgen checkpoint continuation regressions', function() {
  this.timeout(90000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const make = async (pack = 'lemmings', ground = 0, overrides = {}) => new ProcgenLaneWorld({ masks, terrain: await loadProcgenTerrain(pack, ground), laneCount: 3, seed: 42, cohorts: true, workstation: true, ...overrides });
  const compareContinuation = (original, restored, ticks = 120) => {
    for (const key of Object.keys(digest(original))) expect(digest(restored)[key], `restored ${key}`).to.deep.equal(digest(original)[key]);
    for (let tick = 0; tick < ticks; tick++) { original.step(); restored.step(); }
    for (const key of Object.keys(digest(original))) expect(digest(restored)[key], `continued ${key}`).to.deep.equal(digest(original)[key]);
  };
  for (const [pack, ground, ticks] of [['lemmings', 0, 1000], ['lemmings', 2, 1800], ['lemmings_ohNo', 2, 2600]]) {
    it(`continues ${pack}/${ground} at tick ${ticks} with live terrain growth and crew state`, async function() {
      const original = await make(pack, ground), restored = await make(pack, ground);
      try {
        for (let tick = 0; tick < ticks; tick++) original.step();
        restoreProcgenCheckpoint(restored, portable(captureProcgenCheckpoint(original)));
        compareContinuation(original, restored);
      } finally { original.dispose(); restored.dispose(); }
    });
  }

  it('continues mid-animation build, bash and mine actions with their mutable actor state', async function() {
    const original = await make(), restored = await make();
    try {
      const states = [State.BUILDING, State.BASHING, State.MINING];
      for (let lane = 0; lane < 3; lane++) {
        const actor = original.actors.find(item => item.laneIndex === lane) || original._spawn(lane);
        actor.x = 60; actor.y = original.surfaceAt(lane, actor.x); actor.lookRight = true;
        actor.setAction(original.actions[states[lane]]); actor.frameIndex = 3 + lane;
      }
      expect(original.actors.filter(actor => states.some(state => actor.action === original.actions[state]))).to.have.length(3);
      restoreProcgenCheckpoint(restored, portable(captureProcgenCheckpoint(original)));
      for (let lane = 0; lane < 3; lane++) expect(restored.actors.find(actor => actor.laneIndex === lane).action).to.equal(restored.actions[states[lane]]);
      compareContinuation(original, restored, 80);
    } finally { original.dispose(); restored.dispose(); }
  });

  it('restores a cooling hazard owner and its partially played object animation', async function() {
    const original = await make(), restored = await make();
    try {
      for (let tick = 0; tick < 40; tick++) original.step();
      const piece = original.terrain.objects.find(item => item.image.frames.length > 2);
      expect(piece).to.exist;
      const owner = new MapObject({ id: piece.id, x: 80, y: 32, drawProperties: 0 }, piece.image, new Animation(), TriggerTypes.TRAP, original.runtime);
      owner.animation.restart(original.tickIndex - 2); owner.animation.loop = false;
      owner.getFrame(original.tickIndex);
      const trigger = new Trigger(TriggerTypes.TRAP, 80, 32, 90, 42, 12, -1, owner);
      trigger.disabledUntilTick = original.tickIndex + 12;
      original.checkpointHazardFixture = { owner, trigger };
      restoreProcgenCheckpoint(restored, portable(captureProcgenCheckpoint(original)));
      const loaded = restored.checkpointHazardFixture;
      expect(loaded.trigger.owner).to.equal(loaded.owner);
      expect(loaded.trigger.disabledUntilTick).to.equal(52);
      expect(loaded.owner.animation.frames).to.have.length(owner.animation.frames.length);
      for (let tick = original.tickIndex; tick < original.tickIndex + 20; tick++) {
        expect(loaded.owner.getFrame(tick).getBuffer()).to.deep.equal(owner.getFrame(tick).getBuffer());
      }
      compareContinuation(original, restored, 30);
    } finally { original.dispose(); restored.dispose(); }
  });

  for (const mode of ['repeat', 'buildbash', 'bashbuild', 'minebuild']) {
    it(`continues a proven ${mode} crew chain from its active first stage`, function() {
      const { world: original, actor } = chainWorld(masks, mode), { world: restored } = chainWorld(masks, mode);
      try {
        original.admissionPaused = true;
        const chain = original.hazardPlanner.chains.prove(actor, [], 1024, { firstKind: mode === 'minebuild' ? 'miners' : undefined });
        expect(chain.safe).to.equal(true);
        const first = chain.stages[0];
        const proposal = { kind: first.kind, targetX: first.x + (first.kind === 'builders' ? 24 : 8), footprint: chain.footprint, chain };
        expect(original.assignWorker(actor, proposal.kind, proposal.targetX, proposal.footprint)).to.equal(true);
        original.lanePolicy.begin(actor, proposal); original.assists = true;
        for (let tick = 0; tick < 12; tick++) original.step();
        expect(original.lanePolicy.projects.lanes[0].projects.some(project => project.chain?.stages.length > 1)).to.equal(true);
        restoreProcgenCheckpoint(restored, portable(captureProcgenCheckpoint(original)));
        compareContinuation(original, restored, 450);
      } finally { original.dispose(); restored.dispose(); }
    });
  }
});
