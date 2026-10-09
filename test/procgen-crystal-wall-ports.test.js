import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { SolidLayer } from '../js/render/SolidLayer.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { ActionWalkSystem } from '../js/actions/ActionWalkSystem.js';
import { ActionJumpSystem } from '../js/actions/ActionJumpSystem.js';
import { ActionFallSystem } from '../js/actions/ActionFallSystem.js';
import { ActionBuildSystem } from '../js/actions/ActionBuildSystem.js';
import { ActionShrugSystem } from '../js/actions/ActionShrugSystem.js';

// The native public-run receipt in temp/source-crystal-lower-poses-native.json
// observes actor 52 walking these lower lattice poses without manual arrival.
// This fixture replays those coordinates with whole source geometry. It proves
// a construction capability, not automatic policy admission or crew completion.
const LOWER_POSES = [[1632, 64], [1633, 63], [1634, 62], [1637, 59], [1638, 58], [1639, 57], [1642, 54], [1643, 53]];
const WIDTH = 2048, HEIGHT = 144;

describe('fixed Crystal wall source ports and causal ordinary construction', function() {
  this.timeout(30000); let source, steel, descriptions;
  before(async () => {
    const terrain = await loadProcgenTerrain('lemmings', 4), masks = await loadProcgenMasks(new URL('../lemmings/MAIN.DAT', import.meta.url));
    const world = new ProcgenLaneWorld({ terrain, masks, seed: 4274680063, laneCount: 16, laneHeight: HEIGHT, assists: false });
    expect(world.laneSeeds[9]).to.equal(8);
    descriptions = Array.from({ length: 16 }, (_, chunk) => terrain.describe(8, chunk));
    source = new Uint8Array(WIDTH * HEIGHT); steel = new Uint8Array(WIDTH * HEIGHT);
    for (let x = 0; x < WIDTH; x++) for (let y = 0; y < HEIGHT; y++) {
      const chunk = Math.floor(x / 128), at = x + y * WIDTH;
      source[at] = +terrain.solidSample(8, chunk, x % 128, y, descriptions[chunk]);
      steel[at] = +terrain.steelSample(8, chunk, x % 128, y, descriptions[chunk]);
    }
    world.dispose();
  });
  const fixture = () => {
    const mask = new SolidLayer(WIDTH, HEIGHT, source), writes = new Set(), runtime = { soundEvents: { emitSfx() {} } };
    const actions = { [State.WALKING]: new ActionWalkSystem(), [State.JUMPING]: new ActionJumpSystem(), [State.FALLING]: new ActionFallSystem(),
      [State.BUILDING]: new ActionBuildSystem(), [State.SHRUG]: new ActionShrugSystem() };
    for (const action of Object.values(actions)) action.setRuntime(runtime);
    const level = { width: WIDTH, height: HEIGHT, getGroundMaskLayer: () => mask, hasGroundAt: mask.hasGroundAt.bind(mask), isArrowAt: () => false,
      setGroundAt(x, y) { expect(steel[x + y * WIDTH], 'protected source edit').to.equal(0); mask.setGroundAt(x, y); writes.add(x + y * WIDTH); } };
    const actor = (x, y, id = 0) => { const result = new Lemming(x, y, id, runtime); result.setAction(actions[State.WALKING]); return result; };
    const step = lem => {
      const previous = lem.action, next = lem.process(level);
      if (next !== State.NO_STATE_TYPE && !(next === State.JUMPING && previous === actions[State.JUMPING])) {
        if (!actions[next]) return next;
        lem.setAction(actions[next]);
      }
      return null;
    };
    return { mask, actions, level, writes, actor, step };
  };
  it('retains the whole four-piece native assembly, complete external anchor and actual closing lower cavity', () => {
    const d = descriptions[13], a = d.assemblies[0];
    expect(a).to.include({ id: 'lemmings/4/3bca3bb7229f02db', memberCount: 4 });
    expect(a.bounds).to.deep.equal({ x1: 1672, x2: 1768, y1: 49, y2: 132 });
    expect(a.sourceSupport).to.deep.equal({ member: 2, anchor: { kind: 'terrain', id: 11, x: 48, y: 24, f: 0 },
      source: { level: 'lemmings/LEVEL008.DAT#1', kind: 'terrain', index: 3 } });
    expect(d.placements.filter(p => p.assembly === a).map(p => [p.piece.id, 1664 + p.x, p.y, !!p.flip, !!p.flipY])).to.deep.equal([
      [11, 1672, 49, false, false], [11, 1688, 57, false, false], [11, 1704, 65, false, false], [11, 1720, 73, false, false]
    ]);
    expect(a.foundationSupports).to.have.length(13); expect(a.foundationSupports).to.deep.include({ x: 1735, y: 132 });
    expect([12, 13].flatMap(chunk => descriptions[chunk].objects)).to.have.length(0);
    expect(source[1692 + 110 * WIDTH]).to.equal(0); expect(source[1692 + 111 * WIDTH]).to.equal(1);
    expect(Array.from({ length: 8 }, (_, i) => source[1693 + (111 - i) * WIDTH])).to.deep.equal(Array(8).fill(1));
  });
  it('reaches the real last supported pose and then splats passively; earlier lower BUILD poses hit the lattice roof', () => {
    const f = fixture(), lem = f.actor(1632, 64), poses = []; let terminal = null, tick = 0;
    for (; tick < 96 && !terminal; tick++) {
      if (lem.action === f.actions[State.WALKING] && f.level.hasGroundAt(lem.x, lem.y)) poses.push([lem.x, lem.y]);
      terminal = f.step(lem);
    }
    expect(poses).to.deep.include.members([[1649, 47], [1650, 46], [1651, 46]]);
    expect(poses.at(-1)).to.deep.equal([1651, 46]); expect(terminal).to.equal(State.SPLATTING); expect([lem.x, lem.y]).to.deep.equal([1652, 114]);
    expect(f.writes.size).to.equal(0);
    for (const [x, y] of [[1632, 64], [1642, 54], [1648, 48]]) {
      const trial = fixture(), builder = trial.actor(x, y); expect(trial.level.hasGroundAt(x, y)).to.equal(true);
      trial.actions[State.BUILDING].triggerLemAction(builder);
      for (let step = 0; step < 16; step++) expect(trial.step(builder)).to.equal(null);
      expect(builder.lookRight).to.equal(false); expect(builder.action).to.equal(trial.actions[State.WALKING]); expect(trial.writes.size).to.equal(6);
    }
  });
  for (const sectionCount of [1, 2]) it(`crosses the whole wall with ${sectionCount} full ${sectionCount === 1 ? 'section' : 'sections'} from the genuine last WALK pose, then eight ordinary followers`, () => {
    const f = fixture(), worker = f.actor(1651, 46), sections = [], transitions = []; let tick = 0, shrug = false, pending = false;
    expect(f.level.hasGroundAt(worker.x, worker.y)).to.equal(true); f.actions[State.BUILDING].triggerLemAction(worker);
    for (; tick < 512 && !(worker.x >= 1776 && worker.action === f.actions[State.WALKING]);) {
      tick++; const old = worker.action; expect(f.step(worker)).to.equal(null); expect(worker.lookRight).to.equal(true);
      if (sectionCount === 1 && tick === 217) expect([worker.x, worker.y, worker.action]).to.deep.equal([1683, 59, f.actions[State.WALKING]]);
      if (old !== worker.action) transitions.push([tick, worker.x, worker.y, worker.action.actionName]);
      shrug ||= worker.action === f.actions[State.SHRUG];
      if (shrug && old === f.actions[State.SHRUG] && worker.action === f.actions[State.WALKING]) {
        sections.push([tick, worker.x, worker.y]); shrug = false; pending = sections.length < sectionCount;
      } else if (pending && worker.action === f.actions[State.WALKING]) {
        expect(f.level.hasGroundAt(worker.x, worker.y)).to.equal(true);
        expect([tick, worker.x, worker.y]).to.deep.equal([201, 1676, 34]);
        f.actions[State.BUILDING].triggerLemAction(worker); pending = false;
      }
    }
    expect(sections).to.deep.equal(sectionCount === 1 ? [[200, 1675, 34]] : [[200, 1675, 34], [401, 1700, 22]]);
    expect(transitions).to.deep.include([192, 1675, 34, 'shrugging']); expect(f.writes.size).to.equal(sectionCount * 72);
    expect([worker.x, worker.y]).to.deep.equal([1776, 96]); expect(worker.action).to.equal(f.actions[State.WALKING]);
    expect(source.every((value, index) => !value || f.mask.mask[index])).to.equal(true);
    const completed = f.mask.mask.slice();
    for (const [id, [x, y]] of LOWER_POSES.entries()) {
      const follower = f.actor(x, y, id + 1); expect(f.level.hasGroundAt(x, y)).to.equal(true);
      for (let step = 0; step < 192 && follower.x < 1776; step++) { expect(f.step(follower)).to.equal(null); expect(follower.lookRight).to.equal(true); }
      expect([follower.x, follower.y]).to.deep.equal([1776, 96]); expect(follower.action).to.equal(f.actions[State.WALKING]);
      expect(follower.canClimb || follower.hasParachute || follower.removed).to.equal(false);
    }
    expect(f.mask.mask).to.deep.equal(completed);
  });
});
