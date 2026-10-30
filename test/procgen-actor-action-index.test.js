import { expect } from 'chai';
import { ProcgenActorVisibility } from '../js/app/procgen/ProcgenActorVisibility.js';
import { PROCGEN_ACTION_LABELS, formatProcgenActionMask } from '../js/app/procgen/ProcgenActorActions.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const names = ['WALKING', 'FALLING', 'JUMPING', 'DIGGING', 'CLIMBING', 'BUILDING', 'BLOCKING', 'BASHING', 'FLOATING', 'MINING', 'SHRUG'];
const leading = (previous, actor) => !previous || actor.x > previous.x || actor.x === previous.x && actor.id < previous.id;

describe('completed numeric actor action indexes', () => {
  for (const laneCount of [8, 128, 1024]) it(`matches reference leaders, action order and counts across ${laneCount} lanes`, () => {
    const actions = Object.fromEntries(names.map(name => [State[name], {}])), labels = new Map(names.map((name, code) => [actions[State[name]], PROCGEN_ACTION_LABELS[code]]));
    const actors = Array.from({ length: laneCount * 4 }, (_, id) => ({ id, laneIndex: Math.floor(id / 4), x: id % 7, y: Math.floor(id / 4) * 96 + 64, action: actions[State[names[id % names.length]]] }));
    const world = { actors, actions, laneCount, laneHeight: 96, tickIndex: 0, generation: 0 }, index = new ProcgenActorVisibility(world);
    index.publish(); const masks = index.actionMasks, orders = index.actionOrders, counts = index.actionCounts;
    const visits = index.getStats().actorScans;
    for (let tick = 1; tick <= 64; tick++) {
      world.tickIndex = tick;
      for (const actor of actors) {
        actor.x = (actor.id * 13 + tick) % 7;
        actor.laneIndex = (Math.floor(actor.id / 4) + (actor.id % 3 ? 0 : tick)) % laneCount;
        actor.removed = (actor.id + tick) % 31 === 0;
        actor.failureReason = (actor.id + tick) % 47 === 0 ? 'lost' : null;
        actor.action = actor.id % 19 ? actions[State[names[(actor.id + tick) % names.length]]] : null;
      }
      index.publish();
      for (let lane = 0; lane < 8; lane++) {
        const expectedActions = new Set(), expectedCounts = new Map(); let leader = null;
        for (const actor of actors) if (actor.laneIndex === lane && !actor.removed && !actor.failureReason && actor.action) {
          if (leading(leader, actor)) leader = actor;
          const label = labels.get(actor.action); expectedActions.add(label); expectedCounts.set(label, (expectedCounts.get(label) || 0) + 1);
        }
        expect(index.semanticObservationLeader(lane)?.id ?? null).to.equal(leader?.id ?? null);
        expect(formatProcgenActionMask(index.semanticActionMask(lane), index.semanticActionOrder(lane))).to.equal([...expectedActions].join(' '));
        for (const label of PROCGEN_ACTION_LABELS) expect(index.semanticActionCount(lane, label)).to.equal(expectedCounts.get(label) || 0);
      }
    }
    expect(index.getStats().actorScans - visits).to.equal(64 * actors.length);
    expect(index.actionMasks).not.to.equal(masks); expect(index.actionOrders).not.to.equal(orders); expect(index.actionCounts).not.to.equal(counts);
    expect(Object.isFrozen(masks)).to.equal(true);
    expect(index.getStats().actionIndexBytes).to.equal(laneCount * (2 + 8 + 4 * PROCGEN_ACTION_LABELS.length));
    world.generation++; world.actors = []; index.publish();
    expect(index.semanticActionMask(0)).to.equal(0); expect(index.semanticObservationLeader(0)).to.equal(null);
    index.dispose(); expect(index.getStats().actionIndexBytes).to.equal(0);
  });

  it('combines climb/hoist counts and refreshes changed action ownership within one tick', () => {
    const climbing = {}, hoisting = {}, walking = {};
    const world = { laneCount: 1, laneHeight: 96, generation: 0, tickIndex: 4,
      actions: { [State.CLIMBING]: climbing, [State.HOISTING]: hoisting },
      actors: [{ id: 2, laneIndex: 0, x: 50, y: 50, action: climbing }, { id: 1, laneIndex: 0, x: 50, y: 50, action: hoisting }] };
    const index = new ProcgenActorVisibility(world); index.publish();
    expect(index.semanticActionCount(0, 'climb')).to.equal(2); expect(index.semanticObservationLeader(0).id).to.equal(1);
    expect(formatProcgenActionMask(index.semanticActionMask(0), index.semanticActionOrder(0))).to.equal('climb');
    world.actions = { [State.WALKING]: walking }; world.actors[0].action = walking; index.publish();
    expect(index.semanticActionCount(0, 'climb')).to.equal(0); expect(index.semanticActionCount(0, 'walk')).to.equal(1); index.dispose();
  });
});
