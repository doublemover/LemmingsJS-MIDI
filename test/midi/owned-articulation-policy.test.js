import { expect } from 'chai';
import { resolveOwnedArticulationPolicy } from '../../js/app/midi-ui/OwnedArticulationPolicy.js';
import { createLaneInstrumentPreparation } from '../../js/app/midi-ui/LaneInstrumentPreparation.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { nativeSoundCandidates } from '../helpers/native-sound-candidates.js';

describe('shared owned articulation and large lane preparation', () => {
  it('normalizes native numeric cancellation codes before blocking a lane', async () => {
    const { candidates } = await nativeSoundCandidates(), blocked = [], owner = createLaneInstrumentPreparation({
      session: { createInstrumentBackend() {} }, routed: { canAssign: () => true, retain: () => null, assign() {}, block(_lane, code) { expect(code).to.be.a('string'); expect(code.length).to.be.at.most(128); blocked.push(code); } },
      getCatalog: async () => { throw new globalThis.DOMException('Canceled native preparation', 'AbortError'); }
    });
    expect((await owner.synchronize([{ id: 'lane-1', instrumentRef: { ...candidates[0].reference, definition: candidates[0].definition } }]))[0].code).to.equal('preparation-canceled');
    expect(blocked).to.deep.equal(['instrument-preparing', 'preparation-canceled']); await owner.dispose().completion;
  });
  it('does not let a canceled same-hash source block or report over its replacement', async () => {
    const { candidates } = await nativeSoundCandidates(), reference = { ...candidates[0].reference, definition: candidates[0].definition }, blocked = [], reports = []; let resolve, entered, catalogs = 0;
    const gate = new Promise(done => { resolve = done; }), started = new Promise(done => { entered = done; });
    const owner = createLaneInstrumentPreparation({ session: { createInstrumentBackend() {} },
      routed: { canAssign: () => true, retain: () => null, assign() {}, block(_lane, code) { blocked.push(code); } }, onState: event => reports.push(event),
      getCatalog: async () => { if (!catalogs++) { entered(); await gate; } throw Object.assign(new Error('New source unavailable'), { code: 'current-source-unavailable' }); }
    });
    const pending = owner.synchronize([{ id: 'lane-1', instrumentRef: reference }]); await started;
    const current = owner.synchronize([{ id: 'lane-1', instrumentRef: Object.freeze({ ...reference }) }]); resolve(); await pending; await current;
    expect(blocked).to.deep.equal(['instrument-preparing', 'instrument-preparing', 'current-source-unavailable']);
    expect(reports.filter(event => event.state === 'unavailable').map(event => event.code)).to.deep.equal(['current-source-unavailable']); await owner.dispose().completion;
  });
  it('distinguishes the authored one-shot hold from the ownership release envelope', () => {
    expect(resolveOwnedArticulationPolicy({ parameters: { attackSeconds: 0.008, decaySeconds: 0.05, releaseSeconds: 0.2 } })).to.include({
      policy: 'owned-local-envelope-hold-v1', releaseSeconds: 0.2, oneShotTailSeconds: 0.058, semanticEndsRewritten: false });
    expect(resolveOwnedArticulationPolicy({ parameters: { attackSeconds: 2, decaySeconds: 4 } }).oneShotTailSeconds).to.equal(4);
    expect(() => resolveOwnedArticulationPolicy({ parameters: { releaseSeconds: NaN } })).to.throw('profile');
  });
  it('synchronizes 1024 unpinned lanes without allocating renderers and retires bookkeeping', async () => {
    const budget = createResourceBudget(), unassigned = [], owner = createLaneInstrumentPreparation({ resourceBudget: budget,
      session: { createInstrumentBackend() { throw new Error('No renderer should be created.'); } }, routed: { assign() {}, unassign: lane => unassigned.push(lane) } });
    const lanes = Array.from({ length: 1024 }, (_, index) => ({ id: 'lane-' + index, instrumentRef: null }));
    expect(await owner.synchronize(lanes)).to.deep.equal([]); expect(owner.diagnostics()).to.include({ maxLanes: 1024, pending: 0, queued: 0 });
    expect(owner.diagnostics().metadata.enabled).to.equal(true); await owner.synchronize(lanes.slice(0, 8));
    expect(unassigned).to.have.length.at.least(1016); await owner.dispose().completion; expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
