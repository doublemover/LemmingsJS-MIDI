import { expect } from 'chai';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { searchProcgenGoal } from '../js/solver/ProcgenGoalSearch.js';
import { replayProcgenGoal } from '../js/solver/ProcgenSolverAdapter.js';
import { challengeWorld, challengeAdapter } from './support/procgen-challenge-fixtures.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

describe('physical builder and basher decision windows', function() {
  this.timeout(15000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('discovers a bridge launch between stride samples and replays the real supported landing', () => {
    const factory = challengeAdapter(masks, (x, y) => y >= 72 && (x < 78 || x >= 94));
    const control = replayProcgenGoal(factory, [{ tick: 13, target: 0, skillType: 'builder' }], { maxTicks: 300 });
    expect(control.resultType).to.equal('solved');
    const result = searchProcgenGoal(factory, { decisionStride: 16, maxNodes: 8, maxActions: 1, maxTicks: 300 });
    expect(result.resultType).to.equal('solved'); expect(result.replaySummary.verified).to.equal(true);
    expect(result.actions[0]).to.include({ tick: 13, skillType: 'builder' }); expect(result.budgetUsage.nodes).to.be.at.most(8);
  });
  it('rejects head contact missed by the old short-tunnel scalar envelope without touching terrain or MIDI', () => {
    const world = challengeWorld(masks, (x, y) => y >= 72 || x >= 76 && x < 90 && y >= 44, { x: 68 });
    try {
      const planner = world.hazardPlanner, events = []; world.soundEvents.onEvent.on(event => events.push(event));
      planner.probes = 0; planner.through = world.generatedThrough[0]; planner.observations = [{ x1: 85, x2: 87, y1: 61, y2: 63 }];
      const revision = world.terrainRevision;
      expect(planner._basher(world.actors[0], { x: 76, y: 48 })).to.equal(null);
      expect(world.terrainRevision).to.equal(revision); expect(world.stats.removedPixels).to.equal(0); expect(events).to.have.length(0);
      expect(planner.probes).to.be.at.most(1024);
    } finally { world.dispose(); }
  });
  it('qualifies the complete real short bash and rejects hidden, protected, exhausted and changed observations', () => {
    for (const mode of ['normal', 'hidden', 'steel', 'arrows', 'budget', 'changed', 'construction']) {
      const world = challengeWorld(masks, (x, y) => y >= 72 || x >= 76 && x < 90 && y >= 44, { x: 68,
        steel: (x, y) => mode === 'steel' && x === 78 && y === 66 });
      try {
        if (mode === 'hidden') world.generatedThrough[0] = 80;
        if (mode === 'arrows') world.hasArrowUnderMask = () => true;
        if (mode === 'construction') {
          const owner = world._spawn(0, false); owner.setAction(world.actions[State.BUILDING]);
          world.accessTasks[0] = [{ owner, action: owner.action, footprint: { x1: 76, x2: 82, y1: 61, y2: 63 } }];
        }
        const ground = world.hasGroundAt.bind(world), revision = world.terrainRevision;
        const result = world.hazardPlanner.localTunnels.prove(world.actors[0], (x, y) => {
          if (mode === 'changed') world.terrainRevision++;
          return ground(x, y);
        }, [], mode === 'budget' ? 2 : 1024, 98);
        expect(result.safe, mode).to.equal(mode === 'normal'); expect(result.actionSteps + result.probes).to.be.at.most(mode === 'budget' ? 2 : 1024);
        expect(world.stats.removedPixels).to.equal(0);
        if (mode !== 'changed') expect(world.terrainRevision).to.equal(revision);
        if (mode === 'normal') {
          expect(world.assignWorker(world.actors[0], 'bashers')).to.equal(true);
          for (let at = 0; at < result.actionSteps; at++) world.step();
          expect(world.actors[0]).to.include({ x: result.x, y: result.y, lookRight: true, failureReason: null });
          expect(world.actors[0].action).to.equal(world.actions[State.WALKING]);
          expect(world.stats.removedPixels).to.equal(result.excavated);
        }
      } finally { world.dispose(); }
    }
  });
});
