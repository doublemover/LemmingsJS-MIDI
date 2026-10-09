import { expect } from 'chai';
import { ProcgenLanePolicy, MAX_LANE_KNOWLEDGE, PREFERENCE_DECAY_TICKS } from '../js/app/procgen/ProcgenLanePolicy.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
const model = () => {
  const actions = Object.fromEntries([State.BUILDING, State.BASHING, State.DIGGING, State.MINING, State.FALLING, State.WALKING, State.JUMPING, State.CLIMBING].map(state => [state, { state }]));
  const world = { laneSeeds: new Uint32Array([42, 123, 456, 789]), laneHeight: 144, laneCount: 4, terrain: { chunkWidth: 128 }, terrainTileRevisions: new Map(),
    tickIndex: 1, actions, accessTasks: [], actors: [], _constructionPassage: () => true };
  return { world, policy: new ProcgenLanePolicy(world) };
};
describe('bounded seeded lane route outcome and scout knowledge', () => {
  it('starts different lanes with deterministic small action biases and exploration, then resets learned outcomes', () => {
    const { world, policy } = model(), initial = policy.lanes.map(lane => ({ ...lane.initialBias }));
    expect(new Set(initial.map(value => JSON.stringify(value))).size).to.be.greaterThan(1);
    for (const lane of policy.lanes) for (const value of Object.values(lane.initialBias)) expect(value).to.be.within(-7, 5);
    const actor = { laneIndex: 0, x: 40, y: 120 };
    expect(policy.score(actor, { kind: 'builders' })).to.equal(new ProcgenLanePolicy(world).score(actor, { kind: 'builders' }));
    policy.lanes[0].learned.builders = 3; policy.lanes[0].attempts = 8; policy.reset(); expect(policy.lanes.map(lane => lane.initialBias)).to.deep.equal(initial); expect(policy.lanes[0].learned.builders).to.equal(0);
  });
  it('decays learned preferences toward seeded bias only on simulation ticks, including rewind/reset', () => {
    const { world, policy } = model(), actor = { laneIndex: 0, x: 40, y: 120 }, initial = { ...policy.lanes[0].initialBias };
    policy.lanes[0].learned.miners = 3; policy.lanes[0].learned.builders = -2;
    for (let sample = 0; sample < 20; sample++) policy.score(actor, { kind: 'miners' });
    expect(policy.lanes[0].learned.miners).to.equal(3);
    world.tickIndex += PREFERENCE_DECAY_TICKS; policy.score(actor, { kind: 'miners' });
    expect(policy.lanes[0].learned).to.include({ miners: 2, builders: -1 });
    world.tickIndex += PREFERENCE_DECAY_TICKS * 4;
    expect(Object.values(policy.signals(0).learned).every(value => value === 0)).to.equal(true);
    expect(policy.lanes[0].initialBias).to.deep.equal(initial);
    policy.lanes[0].learned.miners = 3; world.tickIndex = 0; policy.score(actor, { kind: 'miners' });
    expect(policy.lanes[0].learned.miners).to.equal(0);
  });
  it('shares only bounded local failed approaches, invalidated by their actual terrain tiles rather than distant edits', () => {
    const { world, policy } = model(), scout = { laneIndex: 0, x: 130, y: 120, scout: true };
    policy.remember(scout, 'failed-climb'); const record = policy.lanes[0].knowledge[0], baseline = policy.score(scout, { kind: 'builders' });
    world.terrainTileRevisions.set(3 * 0x800000 + 100, 1); expect(policy.score(scout, { kind: 'builders' })).to.equal(baseline);
    world.terrainTileRevisions.set(record.tiles[0][0], 2); expect(policy.score(scout, { kind: 'builders' })).to.equal(baseline - 4); expect(policy.lanes[0].knowledge).to.have.length(0);
    for (let index = 0; index < 100; index++) policy.remember({ ...scout, x: index * 32 }, 'failed-route'); expect(policy.lanes[0].knowledge).to.have.length(MAX_LANE_KNOWLEDGE);
    expect(policy.lanes[0].knowledge.every(entry => entry.tiles.length <= 4 && !('actor' in entry))).to.equal(true);
  });
  it('retains connected knowledge without rewarding worker-only completion and penalizes terminal failure', () => {
    const { world, policy } = model(), actor = { laneIndex: 0, x: 40, y: 120, action: world.actions[State.BUILDING] }, task = { owner: actor };
    world.accessTasks[0] = [task]; world.actors.push(actor);
    for (let repeat = 0; repeat < 8; repeat++) { actor.action = world.actions[State.BUILDING]; policy.begin(actor, { kind: 'builders' }); actor.action = world.actions[State.WALKING]; policy.observe(actor, world.actions[State.BUILDING], 40); }
    expect(policy.signals(0)).to.include({ successes: 8, attempts: 8 }); expect(policy.signals(0).learned.builders).to.equal(0);
    actor.action = world.actions[State.BUILDING]; policy.begin(actor, { kind: 'builders' }); actor.terminalReason = 'trapped'; policy.observe(actor, actor.action, 40);
    expect(policy.signals(0).failures).to.equal(1); expect(policy.signals(0).learned.builders).to.equal(-1); expect(actor._laneRouteAttempt).to.equal(null);
    actor.terminalReason = null; actor.action = world.actions[State.BUILDING]; policy.begin(actor, { kind: 'builders' }); policy.dispose(); expect(actor._laneRouteAttempt).to.equal(null);
  });
  it('requires a genuine natural fall before a descent can count as successful and counts actual ordinary forward crossings', () => {
    const { world, policy } = model(), actor = { laneIndex: 0, x: 40, y: 120, action: world.actions[State.DIGGING] }; world.accessTasks[0] = [{ owner: actor }];
    policy.begin(actor, { kind: 'diggers' }); actor.action = world.actions[State.WALKING]; actor.y = 140; policy.observe(actor, world.actions[State.DIGGING], 40); expect(policy.lanes[0].failures).to.equal(1);
    actor.y = 120; actor.action = world.actions[State.DIGGING]; policy.begin(actor, { kind: 'diggers' }); actor.action = world.actions[State.FALLING]; policy.observe(actor, world.actions[State.DIGGING], 40);
    actor.action = world.actions[State.WALKING]; actor.y = 140; policy.observe(actor, world.actions[State.FALLING], 40); expect(policy.lanes[0].successes).to.equal(1);
    policy.remember({ laneIndex: 0, x: 40, y: 140 }, 'failed-climb'); actor.x = 49; policy.observe(actor, actor.action, 48); expect(policy.lanes[0].ordinaryCrossings).to.equal(1);
  });
  it('records supplied scout failure transitions and terminal contact once without granting ordinary abilities', () => {
    const { world, policy } = model(), scout = { laneIndex: 0, x: 78, y: 120, scout: true, lookRight: false, action: world.actions[State.FALLING] };
    policy.observe(scout, world.actions[State.CLIMBING], 80); expect(policy.lanes[0].knowledge[0].kind).to.equal('failed-climb');
    scout.terminalReason = 'drowned'; for (let repeat = 0; repeat < 8; repeat++) policy.observe(scout, scout.action, 80);
    expect(policy.lanes[0].knowledge.filter(entry => entry.kind === 'hazard-contact')).to.have.length(1); expect(scout.canClimb).to.equal(undefined);
  });
  it('retires numeric builder outcomes on actual deadline, loss, disability, removal, turn, replacement or changed local evidence without late success', () => {
    // Controlled transition/owner negatives; full shared BUILD/SHRUG/FALL/WALK
    // is separately replayed against the sourced Crystal geometry.
    for (const mode of ['deadline', 'loss', 'disabled', 'removed', 'turn', 'replacement', 'revision', 'foreign', 'generation']) {
      const { world, policy } = model(), actor = { id: 7, laneIndex: 0, x: 40, y: 120, lookRight: true, action: world.actions[State.BUILDING] };
      const task = { owner: actor, footprint: { x1: 40, x2: 68, y1: 108, y2: 121 } }; world.accessTasks[0] = [task];
      policy.begin(actor, { kind: 'builders', routeEvidence: { kind: 'shared-full-build', exitX: 72, exitY: 120, observedBounds: { x1: 39, x2: 81, y1: 88, y2: 153 } } });
      const attempt = actor._laneRouteAttempt;
      world.terrainTileRevisions.set(0, 1); policy.edit(50, 119, actor.id); policy.observe(actor, actor.action, actor.x);
      expect(actor._laneRouteAttempt, 'own brick remains valid').to.equal(attempt);
      world.terrainTileRevisions.set(0, 2); policy.edit(100, 119, 99); policy.observe(actor, actor.action, actor.x);
      expect(actor._laneRouteAttempt, 'distant same-tile edit remains valid').to.equal(attempt);
      if (mode === 'deadline') { world.tickIndex = attempt.buildDeadlineTick + 1; actor.x = 72; actor.action = world.actions[State.WALKING]; }
      if (mode === 'loss') actor.failureReason = 'unsafe-fall';
      if (mode === 'disabled') { actor.disabled = true; actor.x = 72; actor.action = world.actions[State.WALKING]; }
      if (mode === 'removed') actor.removed = true;
      if (mode === 'turn') actor.lookRight = false;
      if (mode === 'replacement') actor.action = world.actions[State.MINING];
      if (mode === 'revision') world.terrainTileRevisions.set(0, 3);
      if (mode === 'foreign') { world.terrainTileRevisions.set(0, 3); policy.edit(55, 112, 99); }
      if (mode === 'generation') world.generation = 2;
      policy.observe(actor, world.actions[State.BUILDING], 40);
      expect(actor._laneRouteAttempt, mode).to.equal(null); expect(task.buildAttempt, mode).to.equal(null);
      expect(policy.lanes[0], mode).to.include({ successes: 0, failures: 1 });
    }
  });
});
