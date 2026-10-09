import { expect } from 'chai';
import { ProcgenLanePolicy, MAX_LANE_KNOWLEDGE } from '../js/app/procgen/ProcgenLanePolicy.js';
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
  it('shares only bounded local failed approaches, invalidated by their actual terrain tiles rather than distant edits', () => {
    const { world, policy } = model(), scout = { laneIndex: 0, x: 130, y: 120, scout: true };
    policy.remember(scout, 'failed-climb'); const record = policy.lanes[0].knowledge[0], baseline = policy.score(scout, { kind: 'builders' });
    world.terrainTileRevisions.set(3 * 0x800000 + 100, 1); expect(policy.score(scout, { kind: 'builders' })).to.equal(baseline);
    world.terrainTileRevisions.set(record.tiles[0][0], 2); expect(policy.score(scout, { kind: 'builders' })).to.equal(baseline - 4); expect(policy.lanes[0].knowledge).to.have.length(0);
    for (let index = 0; index < 100; index++) policy.remember({ ...scout, x: index * 32 }, 'failed-route'); expect(policy.lanes[0].knowledge).to.have.length(MAX_LANE_KNOWLEDGE);
    expect(policy.lanes[0].knowledge.every(entry => entry.tiles.length <= 4 && !('actor' in entry))).to.equal(true);
  });
  it('learns bounded connected and failed outcomes, including a terminal worker whose action did not change', () => {
    const { world, policy } = model(), actor = { laneIndex: 0, x: 40, y: 120, action: world.actions[State.BUILDING] }, task = { owner: actor };
    world.accessTasks[0] = [task]; world.actors.push(actor);
    for (let repeat = 0; repeat < 8; repeat++) { actor.action = world.actions[State.BUILDING]; policy.begin(actor, { kind: 'builders' }); actor.action = world.actions[State.WALKING]; policy.observe(actor, world.actions[State.BUILDING], 40); }
    expect(policy.signals(0)).to.include({ successes: 8, attempts: 8 }); expect(policy.signals(0).learned.builders).to.equal(3);
    actor.action = world.actions[State.BUILDING]; policy.begin(actor, { kind: 'builders' }); actor.terminalReason = 'trapped'; policy.observe(actor, actor.action, 40);
    expect(policy.signals(0).failures).to.equal(1); expect(policy.signals(0).learned.builders).to.equal(2); expect(actor._laneRouteAttempt).to.equal(null);
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
});
