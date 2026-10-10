import { expect } from 'chai';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenPackTerrain } from '../js/app/procgen/ProcgenPackTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenSupportedRelief } from '../js/app/procgen/ProcgenSupportedRelief.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

const OFFSET = 9 * 144;
let masks, themes;
const make = (guardX = null) => {
  const world = new ProcgenLaneWorld({ terrain: new ProcgenPackTerrain(themes), masks, seed: 4274680063, laneCount: 16, laneHeight: 144,
    cohorts: true, assists: false, populationPolicy: { scoutsEvery: 0 } });
  world.cohorts = false;
  // Controlled launch on the intact public Crystal lattice. This fixture does
  // not qualify natural arrival, generation incidence or whole-session play.
  const actor = world._spawn(9, false); Object.assign(actor, { x: 1612, y: OFFSET + 84 }); actor.setAction(world.actions[State.WALKING]); world._prepareActorTerrain(actor);
  let guard = null;
  if (guardX != null) {
    guard = world._spawn(9, false); Object.assign(guard, { x: guardX, y: OFFSET + 107 }); guard.setAction(world.actions[State.BLOCKING]); guard.process(world);
  }
  return { world, actor, guard, helper: new ProcgenSupportedRelief(world) };
};
const pixels = world => {
  const values = []; for (let x = 1575; x <= 1659; x++) for (let y = 40; y < 144; y++) values.push(world.groundPixelAt(x, OFFSET + y)); return values;
};

describe('minimal actual basher relief qualification', function() {
  this.timeout(15000);
  before(async () => {
    masks = await loadProcgenMasks(); themes = [];
    for (const [ground, styleName] of ['dirt', 'fire', 'squasher', 'pillar', 'crystal'].entries()) themes.push({ styleName, terrain: await loadProcgenTerrain('lemmings', ground) });
  });
  it('requires a genuine fatal unchanged walk, then a real short basher, falling, ordinary entry and recovery-qualified rear port', () => {
    const { world, actor, helper } = make();
    try {
      const events = []; world.soundEvents.onEvent.on(event => events.push(event));
      const before = { pixels: pixels(world), actor: [actor.x, actor.y, actor.action, actor.state, actor.frameIndex], revision: world.terrainRevision, removed: world.stats.removedPixels, triggers: world.triggerManager.byOwner.size };
      const result = helper.prove(actor, 1024);
      expect(result).to.include({ proposal: null, forwardSafe: true, failure: null });
      expect(result.guardCandidate).to.include({ guardX: 1580, guardY: OFFSET + 107, removedPixels: 35, fallingTick: 13, naturalWalkingTick: 14,
        exitX: 1652, exitY: OFFSET + 114, passiveTerminal: State.SPLATTING, passiveFallDistance: 63, independentQualification: false });
      expect(result.probes).to.be.at.most(1024); expect(result.actionSteps).to.be.at.most(384);
      expect(events).to.have.length(0); expect(pixels(world)).to.deep.equal(before.pixels); expect([actor.x, actor.y, actor.action, actor.state, actor.frameIndex]).to.deep.equal(before.actor);
      expect(world.terrainRevision).to.equal(before.revision); expect(world.stats.removedPixels).to.equal(before.removed); expect(world.triggerManager.byOwner.size).to.equal(before.triggers);
    } finally { world.dispose(); }
  });
  it('accepts only a live supported contact owner whose full empty recovery masks are observed', () => {
    for (const mode of ['valid', 'removed', 'disabled', 'moved', 'stale-rectangle', 'unsupported', 'blocked-recovery']) {
      const { world, actor, guard, helper } = make(mode === 'blocked-recovery' ? 1584 : 1580);
      try {
        if (mode === 'removed') guard.removed = true;
        if (mode === 'disabled') guard.disabled = true;
        if (mode === 'moved') { world.triggerManager.removeByOwner(guard); guard.x = 1550; guard.state = 0; guard.process(world); }
        if (mode === 'stale-rectangle') guard.x++;
        if (mode === 'unsupported') world.clearGroundAt(guard.x, guard.y + 1);
        const triggers = [...world.triggerManager.byOwner.values()].map(entries => entries.map(t => [t.x1, t.x2, t.y1, t.y2, t.lastTriggerTick]));
        const result = helper.prove(actor, 1024, guard);
        if (mode === 'valid') {
          expect(result.proposal?.routeEvidence).to.include({ rearBlockerId: guard.id, removedPixels: 35, exitX: 1652, exitY: OFFSET + 114 });
          expect(world._emptyBashMasks(guard)).to.equal(true); expect(result.probes).to.be.at.most(1024); expect(result.actionSteps).to.be.at.most(384);
        } else expect(result.proposal, mode).to.equal(null);
        expect([...world.triggerManager.byOwner.values()].map(entries => entries.map(t => [t.x1, t.x2, t.y1, t.y2, t.lastTriggerTick]))).to.deep.equal(triggers);
      } finally { world.dispose(); }
    }
  });
  it('refuses hidden, protected, hazardous, conflicting, changed and insufficiently budgeted observations', () => {
    for (const mode of ['hidden', 'steel', 'arrow', 'hazard', 'hazard-limit', 'blocker-limit', 'busy', 'changed', 'budget']) {
      const { world, actor, guard, helper } = make(1580);
      try {
        if (mode === 'hidden') world.generatedThrough[9] = 1650;
        if (mode === 'steel') world.hasSteelAt = (x, y) => x >= 1612 && x < 1625 && y >= OFFSET + 72 && y < OFFSET + 84;
        if (mode === 'arrow') world.hasArrowUnderMask = () => true;
        if (mode === 'hazard' || mode === 'hazard-limit') world.hazards.nearby = (_lane, _x, _range, out) => { out.length = 0; for (let i = 0; i < (mode === 'hazard-limit' ? 8 : 1); i++) out.push({ x1: 1630, x2: 1634, y1: OFFSET + 60, y2: OFFSET + 90 }); return out; };
        if (mode === 'blocker-limit') world.triggerManager.byLane[9] = new Array(65).fill(world.triggerManager.byLane[9][0]);
        if (mode === 'busy') { const owner = world._spawn(9, false); owner.setAction(world.actions[State.BUILDING]); world.accessTasks[9] = [{ owner, action: owner.action, footprint: { x1: 1630, x2: 1640, y1: OFFSET + 60, y2: OFFSET + 110 } }]; }
        if (mode === 'changed') { const ground = world.hasGroundAt.bind(world); world.hasGroundAt = (x, y) => { world.terrainRevision++; return ground(x, y); }; }
        const removed = world.stats.removedPixels, result = helper.prove(actor, mode === 'budget' ? 128 : 1024, guard);
        expect(result.proposal, mode).to.equal(null); expect(result.guardCandidate, mode).to.equal(null); expect(result.failure, mode).to.be.a('string');
        expect(result.probes, mode).to.be.at.most(mode === 'budget' ? 128 : 1024); expect(world.stats.removedPixels).to.equal(removed);
      } finally { world.dispose(); }
    }
  });
  it('does not recut an already safe route or infer usefulness from an unresolved passive bound', () => {
    const { world, actor, helper } = make();
    try {
      expect(world.assignWorker(actor, 'bashers', actor.x)).to.equal(true); for (let i = 0; i < 14; i++) world.step();
      Object.assign(actor, { x: 1612, y: OFFSET + 84 }); actor.setAction(world.actions[State.WALKING]);
      expect(helper.prove(actor, 1024)).to.include({ proposal: null, guardCandidate: null, failure: 'passive-safe' });
      Object.assign(actor, { x: 1592, y: OFFSET + 104 }); world._prepareActorTerrain(actor);
      const result = helper.prove(actor, 1024); expect(result.proposal).to.equal(null); expect(result.guardCandidate).to.equal(null);
    } finally { world.dispose(); }
  });
  it('matches actual 8 and 16 ordinary crews crossing the fatal ledge with exactly one 35-pixel basher and empty guard recovery', () => {
    for (const count of [8, 16]) {
      const { world, actor, guard, helper } = make(1580);
      try {
        const crew = [actor];
        for (let i = 1; i < count; i++) { const member = world._spawn(9, false); Object.assign(member, { x: 1588, y: OFFSET + 107, lookRight: i % 2 === 0 }); member.setAction(world.actions[State.WALKING]); crew.push(member); }
        expect(helper.prove(actor, 1024, guard).proposal).not.to.equal(null); expect(world.assignWorker(actor, 'bashers', actor.x)).to.equal(true);
        for (let i = 0; i < 300 && !crew.every(member => member.x >= 1652 && member.action === world.actions[State.WALKING]); i++) world.step();
        expect(crew.every(member => member.x >= 1652 && !member.failureReason && !member.canClimb && !member.hasParachute), `${count} ordinary crossings`).to.equal(true);
        expect(world.stats).to.include({ bashes: 1, builds: 0, digs: 0, mines: 0, failures: 0, removedPixels: 35, laneTransfers: 0 });
        expect(world._emptyBashMasks(guard)).to.equal(true); expect(world.assignWorker(guard, 'bashers')).to.equal(true);
        for (let i = 0; i < 6 && guard.action !== world.actions[State.WALKING]; i++) world.step();
        expect(guard.action).to.equal(world.actions[State.WALKING]); expect(world.triggerManager.byOwner.has(guard)).to.equal(false); expect(world.stats.removedPixels).to.equal(35);
      } finally { world.dispose(); }
    }
  });
});


