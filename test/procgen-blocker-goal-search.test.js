import { expect } from 'chai';
import { searchProcgenGoal } from '../js/solver/ProcgenGoalSearch.js';
import { replayProcgenGoal, MAX_ENVIRONMENT_BLOCKERS } from '../js/solver/ProcgenSolverAdapter.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { blockerFactoryFor } from './support/procgen-blocker-scene.js';

const searchOptions = { maxNodes: 8, maxTicks: 600, maxActions: 1, maxSimulatedTicks: 4800, maxWallTimeMs: 3000 };
describe('independent real environmental blocker bypass search', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  for (const [crewCount, height, reverse = false] of [[8, 96], [16, 96], [8, 144], [16, 144], [8, 96, true], [16, 96, true], [8, 144, true]]) it('finds and freshly replays all ' + crewCount + ' ordinary arrivals with a separate stationary blocker at height ' + height + (reverse ? ' moving left' : ' moving right'), () => {
    const observations = [], records = new WeakMap();
    const factory = blockerFactoryFor(masks, { crewCount, height, reverse,
        initialize(world) {
          const record = { world, fell: new Set(), shrugged: false, builderLanded: false, turns: 0, tick0: world.tickIndex }; observations.push(record); records.set(world, record);
          world.soundEvents.onEvent.on(event => { if (event.type === 'blocker-turn' && event.blockerId === 0) record.turns++; });
        },
        onTick(world) {
          const record = records.get(world);
          for (const actor of world.actors) if (actor.id !== 0 && actor.action === world.actions[State.FALLING]) record.fell.add(actor.id);
          record.shrugged ||= world.actors[1].action === world.actions[State.SHRUG];
          record.builderLanded ||= record.fell.has(1) && world.actors[1].action === world.actions[State.WALKING] && world.actors[1].y === height - 24;
        }
      }), result = searchProcgenGoal(factory, searchOptions);
    expect(result.resultType, JSON.stringify(result)).to.equal('solved'); expect(result.search.intendedRouteHint).to.equal(false);
    expect(result.actions).to.have.length(1); expect(result.actions[0]).to.include({ tick: 0, skillType: 'builder', target: 1 });
    expect(result.replaySummary).to.include({ verified: true, goalReachedCount: crewCount, needCount: crewCount, deadCount: 0, hazardContacts: 0,
      environmentalBlockerCount: 1, environmentalBlockersChanged: false, totalActorCount: crewCount + 1, protectedTerrainUnchanged: true, routeBoundsExceeded: false });
    expect(result.replaySummary.lemmings).to.have.length(crewCount); expect(result.replaySummary.lemmings.every(actor => actor.id !== 0 && actor.saved && !actor.dead)).to.equal(true);
    expect(result.replaySummary.environmentalBlockers[0]).to.include({ id: 0, kind: 'stationary-blocker', x: reverse ? 70 : 50, y: height - 24, lane: 0, blocking: true, dead: false });
    expect(result.budgetUsage.nodes).to.be.at.most(searchOptions.maxNodes); expect(result.budgetUsage.ticks).to.be.at.most(searchOptions.maxSimulatedTicks);
    const replay = replayProcgenGoal(factory, result.actions, { maxTicks: 600, maxNodes: 600, maxActions: 1 });
    expect(replay.replaySummary.stateHash).to.equal(result.replaySummary.stateHash);
    for (const record of observations.filter(record => record.world.stats.builds)) {
      expect(record.tick0).to.equal(0); expect(record.world.stats.builds).to.equal(1); expect(record.world.stats.bashes + record.world.stats.digs + record.world.stats.mines).to.equal(0);
      expect(record.shrugged && record.builderLanded).to.equal(true); expect(record.fell.size).to.equal(crewCount); expect(record.turns).to.be.greaterThan(0);
      expect(record.world.triggerManager.byOwner.size).to.equal(0); expect(record.world.actors.every(actor => !actor.canClimb && !actor.hasParachute)).to.equal(true);
    }
  });
  it('registers the actual shared directional owner at tick0 without excluding an undeclared actor or spending crew resources', () => {
    const adapter = blockerFactoryFor(masks)(), blocker = adapter.world.actors[0], rects = adapter.getEnvironmentalBlockerRects();
    expect(adapter.tick).to.equal(0); expect(blocker.state).to.equal(1); expect(adapter.crewCount).to.equal(8); expect(adapter.world.spawnedTotal).to.equal(9);
    expect(rects).to.have.length(2); expect(adapter.world.triggerManager.byOwner.get(blocker)).to.have.length(2);
    expect(adapter.getSkillCount('builder')).to.equal(1); expect(adapter.selectLemming(0)).to.equal(null); expect(adapter.snapshot().environmentalBlockers).to.have.length(1);
    adapter.dispose(); expect(adapter.world.triggerManager.byOwner.size).to.equal(0);
    expect(() => blockerFactoryFor(masks, { environmentalBlockers: [] })()).to.throw('ordinary actors');
    expect(() => blockerFactoryFor(masks, { initialize(world, blocker) { world.clearGroundAt(blocker.x, blocker.y + 1); } })()).to.throw('supported');
    expect(() => blockerFactoryFor(masks, { initialize(world, blocker) { blocker.state = 1; } })()).to.throw('directional triggers');
    expect(() => blockerFactoryFor(masks, { initialize(world) { world.actors[1].failureReason = 'fixture-loss'; } })()).to.throw('omit initial goal actors');
    for (const environmentalBlockers of [[1], [0, 0], [-1], Array.from({ length: MAX_ENVIRONMENT_BLOCKERS + 1 }, (_, index) => index)]) expect(() => blockerFactoryFor(masks, { environmentalBlockers })()).to.throw();
  });
  it('keeps moving, removed, action-replaced and trigger-changed owners unqualified with sticky observed failure', () => {
    for (const mutate of [(_world, blocker) => blocker.x++, (_world, blocker) => blocker.removed = true,
      (world, blocker) => blocker.setAction(world.actions[State.WALKING]),
      (world, blocker) => world.triggerManager.byOwner.get(blocker)[0].x1++,
      (world, blocker) => world.triggerManager.removeByOwner(blocker),
      (_world, blocker) => blocker.id++,
      (world) => world.terrain = { ...world.terrain },
      (world, blocker) => world.triggerManager.byOwner.get(blocker)[0].disableTicksCount = 4,
      (world, blocker) => world.triggerManager.byLane[0].push(world.triggerManager.byOwner.get(blocker)[0]),
      world => world._spawn(0, false),
      world => world.actors.splice(1, 1),
      world => world.actors[1] = Object.assign(Object.create(Object.getPrototypeOf(world.actors[1])), world.actors[1])]) {
      const factory = blockerFactoryFor(masks, { onTick(world, blocker, tick) { if (tick === 2) mutate(world, blocker); } });
      const result = replayProcgenGoal(factory, [{ tick: 0, target: 1, skillType: 'builder' }], { maxTicks: 600, maxNodes: 600 });
      expect(result.resultType).to.equal('failed'); expect(result.replaySummary).to.include({ verified: false, environmentalBlockersChanged: true, goalReachedCount: 0 });
    }
    const adapter = blockerFactoryFor(masks)(), blocker = adapter.world.actors[0]; blocker.x++; adapter.step(); blocker.x--;
    expect(adapter.isTerminal()).to.equal(true); expect(adapter.getFinalStateSummary().environmentalBlockersChanged).to.equal(true); adapter.dispose();
  });
  it('does not qualify low ceiling, missing return support, protected construction or unsupported landing', () => {
    for (const options of [{ blockedRoof: true }, { rear: false }, { steelWall: true }, { gap: true }]) {
      const result = searchProcgenGoal(blockerFactoryFor(masks, options), searchOptions);
      expect(result.resultType, JSON.stringify(options)).not.to.equal('solved'); expect(result.replaySummary.verified).to.equal(false);
    }
  });
  it('distinguishes conservative runtime proof rejection from independently observed shared-action routes', () => {
    for (const options of [{ ceiling: true }, { steel: true }]) {
      const adapter = blockerFactoryFor(masks, options)();
      expect(adapter.world.hazardPlanner.bypasses.prove(adapter.initialActors[0]).proposal).to.equal(null); adapter.dispose();
      const result = searchProcgenGoal(blockerFactoryFor(masks, options), searchOptions);
      expect(result.resultType).to.equal('solved'); expect(result.replaySummary).to.include({ verified: true, deadCount: 0, protectedTerrainUnchanged: true, goalReachedCount: 8 });
      expect(result.actions[0].tick).to.equal(options.ceiling ? 56 : 0);
    }
  });
  it('fingerprints blocker geometry and rejects changed factories or externally reset ticks', () => {
    let calls = 0;
    expect(() => searchProcgenGoal(() => blockerFactoryFor(masks, { blockerX: ++calls === 1 ? 50 : 51 })(), searchOptions)).to.throw('changed its initial state');
    const adapter = blockerFactoryFor(masks)(); adapter.step(); adapter.world.tickIndex = 0;
    expect(() => adapter.step()).to.throw('restart'); adapter.dispose();
  });
});
