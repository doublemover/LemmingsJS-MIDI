import { prepareProcgenRecoveryJournal } from '../js/app/procgen/workstation/ProcgenRecoveryCapture.js';
import { getProcgenRecoveryJournal } from '../js/app/procgen/workstation/ProcgenRecoveryJournal.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint, captureProcgenCheckpointCooperative, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { createProcgenRecoveryJournal, replayProcgenRecoveryJournal } from '../js/app/procgen/workstation/ProcgenRecoveryJournal.js';
import { encodeProcgenRecoveryPage, decodeProcgenRecoveryPage } from '../js/app/procgen/workstation/ProcgenRecoveryPageCodec.js';

const digest = world => ({ tick: world.tickIndex, seed: world.seed, generation: world.generation, simulationTimeMs: world.simulationTimeMs,
  actors: world.actors.map(actor => [actor.id, actor.x, actor.y, actor.state, actor.frameIndex, actor.action?.actionName]),
  edits: [...world.editChunks].map(([key, bytes]) => [key, [...bytes]]), causal: world.soundEvents.snapshotIdentity().causalSequence });
describe('incremental recovery boundaries', function() {
  this.timeout(30000); let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  const make = () => new ProcgenLaneWorld({ masks, seed: 42, laneCount: 2, assists: false, cohorts: true });
  it('does not free a newly published recovery base when old-base retirement fails', async () => {
    const world = make(), actual = createResourceBudget(), releases = []; let reject = false;
    const budget = { reserve: actual.reserve, release(request) { releases.push(request); return reject ? false : actual.release(request); } };
    const first = await prepareProcgenRecoveryJournal(world, { resourceBudget: budget, isCurrent: () => true }); reject = true;
    let failure; try { await prepareProcgenRecoveryJournal(world, { resourceBudget: budget, isCurrent: () => true }); } catch (error) { failure = error; }
    const current = getProcgenRecoveryJournal(world); expect(failure.publishedRecovery).to.equal(current); expect(current).not.to.equal(first); expect(current.checkpoint()).not.to.equal(null);
    expect(actual.diagnostics().categories.candidate.entries).to.equal(2); expect(releases).to.have.length(1);
    reject = false; current.dispose(); world.dispose(); expect(actual.diagnostics().categories.candidate.entries).to.equal(1);
  });
  it('finishes independent world teardown and preserves the failed retirement outcome', () => {
    const world = make(), base = captureProcgenCheckpoint(world), journal = createProcgenRecoveryJournal(world, base, { resourceBudget: { reserve() {}, release: () => false } });
    journal.step(0, 1); expect(() => world.dispose()).to.throw('acknowledge'); expect(world.soundEvents.onBatch.handlers.size).to.equal(0); expect(world._disposed).to.equal(true);
    expect(() => world.dispose()).to.throw('acknowledge');
  });
  it('replays clock changes and admitted/canceled inputs, then matches 1000 continued physics ticks', async () => {
    const original = make(), restored = make(), events = [], replayed = [];
    original.soundEvents.onBatch.on(batch => events.push(batch)); restored.soundEvents.onBatch.on(batch => replayed.push(batch));
    try {
      const base = captureProcgenCheckpoint(original), journal = createProcgenRecoveryJournal(original, base);
      for (let tick = 0; tick < 160; tick++) {
        if (tick === 20) original.timer.speedFactor = 2;
        if (tick === 40) original.prepareIntervention({ id: 'release', kind: 'set-release-policy', target: { generation: original.generation }, parameters: { spawnBeatTicks: 10, spawnSpreadTicks: 2 } }).commit();
        if (tick === 60) { original.enqueueIntervention({ id: 'cancel', kind: 'nuke-all', target: { generation: original.generation }, applyAtTick: original.tickIndex + 10 }); original.cancelIntervention('cancel'); }
        original.step(tick * 23);
      }
      const saved = journal.snapshot(); restoreProcgenCheckpoint(restored, base);
      await replayProcgenRecoveryJournal(restored, saved, { yieldTask: async () => {} });
      expect(digest(restored)).to.deep.equal(digest(original)); expect(replayed).to.deep.equal(events);
      for (let tick = 0; tick < 1000; tick++) { original.step(); restored.step(); }
      expect(digest(restored)).to.deep.equal(digest(original));
    } finally { original.dispose(); restored.dispose(); }
  });
  it('captures the same graph cooperatively and refuses a mutated quiescent lease', async () => {
    const world = make();
    try {
      const expected = captureProcgenCheckpoint(world); let clock = 0, yields = 0;
      const actual = await captureProcgenCheckpointCooperative(world, { isCurrent: () => true, now: () => clock++, yieldTask: async () => { yields++; } });
      expect(actual).to.deep.equal(expected); expect(yields).to.be.greaterThan(0);
      let error;
      try { await captureProcgenCheckpointCooperative(world, { isCurrent: () => true, now: () => clock++, yieldTask: async () => { world.timer.speedFactor++; } }); } catch (value) { error = value; }
      expect(error.message).to.include('source changed');
    } finally { world.dispose(); }
  });
  it('pins old immutable journal pages and reports capacity refusal without altering physics', () => {
    const world = make(); world.soundEvents.onBatch.on(() => {});
    try {
      const journal = createProcgenRecoveryJournal(world, captureProcgenCheckpoint(world), { maxBytes: 16384 });
      world.step(); const old = journal.snapshot(); const count = old.sequence;
      for (let tick = 0; tick < 200; tick++) world.step();
      expect(old.sequence).to.equal(count); expect(old.pages[0]).to.have.length(1);
      expect(journal.stats().complete).to.equal(false); expect(world.tickIndex).to.equal(201);
      expect(() => journal.snapshot()).to.throw('capacity');
    } finally { world.dispose(); }
  });
  it('encodes binary pages and rejects checksum or decompression-bound corruption', async () => {
    const value = { entries: Array.from({ length: 256 }, (_, tick) => ({ tick, speed: 1 })) };
    const encoded = await encodeProcgenRecoveryPage(value); expect(encoded.bytes).to.be.instanceOf(Uint8Array);
    expect(await decodeProcgenRecoveryPage(encoded)).to.deep.equal(value);
    const corrupted = { ...encoded, bytes: encoded.bytes.slice() }; corrupted.bytes[0] ^= 1;
    let error; try { await decodeProcgenRecoveryPage(corrupted); } catch (value) { error = value; } expect(error.message).to.include('checksum');
    try { await decodeProcgenRecoveryPage({ ...encoded, rawBytes: 1 }); } catch (value) { error = value; } expect(error.message).to.match(/bound|length/);
  });
});
