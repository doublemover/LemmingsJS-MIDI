import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenSoundEventBus } from '../js/app/procgen/ProcgenSoundEventBus.js';
import { LAST_PROCGEN_IDENTITY } from '../js/app/procgen/ProcgenIdentityCapacity.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const tick = { worldId: 'capacity', generation: 1, tick: 1, terrainRevisionBefore: 0 };
describe('live ProcGen identity frontier admission', () => {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });

  it('advances the last restorable tick once and refuses exhausted successors before any mutation', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    try {
      world.tickIndex = LAST_PROCGEN_IDENTITY - 1; world.step();
      expect(world.tickIndex).to.equal(LAST_PROCGEN_IDENTITY);
      const saved = captureProcgenCheckpoint(world); restoreProcgenCheckpoint(world, saved);
      for (const value of [LAST_PROCGEN_IDENTITY, Number.MAX_SAFE_INTEGER]) {
        world.tickIndex = value; const before = captureProcgenCheckpoint(world);
        expect(() => world.step()).to.throw(RangeError, 'Physical tick identity exhausted');
        expect(captureProcgenCheckpoint(world)).to.deep.equal(before); expect(world._failedTick).not.to.equal(true); expect(world._stepping).not.to.equal(true);
      }
    } finally { world.dispose(); }
  });

  it('allocates the last restorable actor frontier and refuses the next birth before changing the bus or world', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false });
    try {
      world.nextActorId = LAST_PROCGEN_IDENTITY - 1; world._spawn(0, false);
      expect(world.actors.at(-1).id).to.equal(LAST_PROCGEN_IDENTITY - 1); expect(world.nextActorId).to.equal(LAST_PROCGEN_IDENTITY);
      const saved = captureProcgenCheckpoint(world); restoreProcgenCheckpoint(world, saved);
      for (const value of [LAST_PROCGEN_IDENTITY, Number.MAX_SAFE_INTEGER]) {
        world.nextActorId = value; world.soundEvents.laneIndex = 7; const before = captureProcgenCheckpoint(world);
        expect(() => world._spawn(0)).to.throw(RangeError, 'Actor identity exhausted');
        expect(captureProcgenCheckpoint(world)).to.deep.equal(before); expect(world.soundEvents.laneIndex).to.equal(7);
      }
    } finally { world.dispose(); }
  });

  it('reserves all possible cohort births before advancing a physical tick or population schedule', () => {
    const world = new ProcgenLaneWorld({ masks, laneCount: 2, cohorts: true, assists: false });
    try {
      world.nextActorId = LAST_PROCGEN_IDENTITY - 1; const before = captureProcgenCheckpoint(world), population = world.population.snapshot();
      expect(() => world.step()).to.throw(RangeError, 'Actor identity exhausted');
      expect(captureProcgenCheckpoint(world)).to.deep.equal(before); expect(world.population.snapshot()).to.deep.equal(population);
      expect(world.soundEvents.pendingBatchIdentity()).to.equal(null); expect(world._failedTick).not.to.equal(true);
    } finally { world.dispose(); }
  });

  it('reserves both bounded batches and does not spend identities on malformed or over-capacity facts', () => {
    const bus = new ProcgenSoundEventBus(null, 1); bus.onBatch.on(() => {}); bus._maxFacts = 1; bus._maxTerminalFacts = 0;
    bus._causalSequence = bus._sequence = LAST_PROCGEN_IDENTITY - 2;
    try {
      bus.beginTick(tick); bus.emit({ type: 'builder-step' });
      const first = bus._causalSequence; bus.emitPhysicalFact({ kind: 'extra' }); bus.emitPhysicalFact({ kind: 'invalid', value: NaN });
      expect(bus._causalSequence).to.equal(first);
      bus.sealGeneration({ revision: 'old' }, 0, 2); bus.emit({ type: 'lemming-spawn' });
      const batches = bus.commitTick({ revision: 'new' }, 0);
      expect(batches[0].completeness).to.deep.equal({ status: 'incomplete', dropped: 2 });
      expect(batches.flatMap(batch => batch.facts.map(fact => fact.causalSequence))).to.deep.equal([LAST_PROCGEN_IDENTITY - 1, LAST_PROCGEN_IDENTITY]);
      expect(bus.snapshotIdentity()).to.include({ causalSequence: LAST_PROCGEN_IDENTITY, legacySequence: LAST_PROCGEN_IDENTITY });
      for (const value of [LAST_PROCGEN_IDENTITY, Number.MAX_SAFE_INTEGER]) {
        bus._causalSequence = value; const before = bus.snapshotIdentity();
        expect(() => bus.beginTick(tick)).to.throw(RangeError); expect(bus.snapshotIdentity()).to.deep.equal(before); expect(bus.pendingBatchIdentity()).to.equal(null);
      }
    } finally { bus.dispose(); }
  });

  it('refuses an exhausted causal or legacy inventory before the world tick mutates', () => {
    for (const key of ['_causalSequence', '_sequence']) {
      const world = new ProcgenLaneWorld({ masks, assists: false });
      try {
        world.soundEvents[key] = LAST_PROCGEN_IDENTITY; const before = captureProcgenCheckpoint(world);
        expect(() => world.step()).to.throw(RangeError); expect(captureProcgenCheckpoint(world)).to.deep.equal(before);
        expect(world._failedTick).not.to.equal(true); expect(world.soundEvents.pendingBatchIdentity()).to.equal(null);
      } finally { world.dispose(); }
    }
  });

  it('bounds generation segments and guards legacy emission outside a physical transaction', () => {
    const bus = new ProcgenSoundEventBus(null, 1);
    try {
      bus.onBatch.on(() => {}); bus.beginTick(tick); bus.sealGeneration({ revision: 1 }, 0, 2);
      expect(() => bus.sealGeneration({ revision: 2 }, 0, 3)).to.throw('at most one generation transition');
      bus.commitTick({ revision: 2 }, 0); bus._sequence = LAST_PROCGEN_IDENTITY;
      expect(() => bus.emit({ type: 'builder-step' })).to.throw(RangeError); expect(bus._sequence).to.equal(LAST_PROCGEN_IDENTITY); expect(bus.flush()).to.deep.equal([]);
    } finally { bus.dispose(); }
  });
});
