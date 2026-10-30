import { expect } from 'chai';
import { createPhysicalAuthoringHistory } from '../js/app/procgen/workstation/PhysicalAuthoringHistory.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
const world = () => ({ laneCount: 1, _stepping: false, _disposed: false });
describe('physical authoring checkpoint history ownership', () => {
  it('reserves before capture and pins a real capsule until its history key retires', async () => {
    const budget = createResourceBudget({ limitBytes: 64 * 1048576 }), history = createPhysicalAuthoringHistory({ resourceBudget: budget, captureCheckpoint: async () => ({ checkpoint: true }) }), project = {};
    const capsule = await history.capture(world(), project, (checkpoint, project) => ({ world: checkpoint, project }), { isCurrent: () => true });
    expect(history.diagnostics().reservedBytes).to.be.greaterThan(0); capsule.promote(project); expect(history.get(project).world.checkpoint).to.equal(true); expect(capsule.discard()).to.equal(false);
    history.prune(new Set()); expect(history.diagnostics().reservedBytes).to.equal(0); await history.dispose();
  });
  it('does not release a pending producer reservation before cancellation acknowledgement', async () => {
    let finish, options; const producer = new Promise(resolve => { finish = resolve; }), history = createPhysicalAuthoringHistory({ captureCheckpoint: async (_world, input) => { options = input; await producer; return {}; } });
    const pending = history.capture(world(), {}, checkpoint => ({ world: checkpoint }), { isCurrent: () => true }).then(() => null, error => error);
    const before = history.diagnostics().reservedBytes, disposal = history.dispose(); expect(options.signal.aborted).to.equal(true); expect(history.diagnostics().reservedBytes).to.equal(before);
    finish(); expect(await pending).to.be.instanceOf(Error); await disposal; expect(history.diagnostics().reservedBytes).to.equal(0);
  });
  it('rejects replacement during cooperative capture and preserves unknown retirement accounting', async () => {
    let current = true; const history = createPhysicalAuthoringHistory({ captureCheckpoint: async () => { current = false; return {}; } });
    try { await history.capture(world(), {}, checkpoint => ({ world: checkpoint }), { isCurrent: () => current }); expect.fail('source replacement admitted'); } catch (error) { expect(error.message).to.include('replaced'); }
    expect(history.diagnostics().reservedBytes).to.equal(0); await history.dispose();
    let denied = true; const leaking = createPhysicalAuthoringHistory({ resourceBudget: { reserve() {}, release() { if (denied) throw new Error('release unacknowledged'); } }, captureCheckpoint: async () => ({}) }), key = {};
    const capsule = await leaking.capture(world(), key, checkpoint => ({ world: checkpoint }), { isCurrent: () => true }); capsule.promote(key); leaking.prune(new Set()); expect(leaking.diagnostics().retirementUnknown).to.equal(1); expect(leaking.get(key)).not.to.equal(null);
    denied = false; await leaking.dispose(); expect(leaking.diagnostics().reservedBytes).to.equal(0);
  });
  it('restores collision, actors, pending inputs and causal identity together instead of inverse pixels', async () => {
    const masks = await loadProcgenMasks(), a = new ProcgenLaneWorld({ masks, assists: false }), b = new ProcgenLaneWorld({ masks, assists: false }), project = { procgen: { revision: 1 } };
    const history = createPhysicalAuthoringHistory(), capsule = await history.capture(a, project, (world, project) => ({ world, project }), { isCurrent: () => true }); capsule.promote(project);
    const expected = captureProcgenCheckpoint(a); a.setGroundAt(100, 10); a.step(); restoreProcgenCheckpoint(b, history.get(project).world); expect(captureProcgenCheckpoint(b)).to.deep.equal(expected);
    expect(a.tickIndex).not.to.equal(b.tickIndex); expect(b.hasGroundAt(100, 10)).to.equal(false); await history.dispose(); a.dispose(); b.dispose();
  });
});

describe('physical history synchronous retirement receipts', () => {
  for (const response of [false, Promise.resolve(true)]) it(`retains a capsule when release returns ${response === false ? 'false' : 'a promise'}`, async () => {
    const history = createPhysicalAuthoringHistory({ resourceBudget: { reserve() {}, release: () => response }, captureCheckpoint: async () => ({}) }), key = {};
    const capsule = await history.capture(world(), key, checkpoint => ({ world: checkpoint }), { isCurrent: () => true }); capsule.promote(key); history.prune(new Set());
    expect(history.get(key)).not.to.equal(null); expect(history.diagnostics().retirementUnknown).to.equal(1);
    try { await history.dispose(); expect.fail('unacknowledged release accepted'); } catch (error) { expect(error.message).to.include('unknown'); }
  });
});
