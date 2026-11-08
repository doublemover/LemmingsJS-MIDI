import { expect } from 'chai';
import { createOrganRotaryPart } from '../../js/midi/native/OrganRotaryPart.js';
const failure = promise => promise.then(() => null, error => error);
function fixture() {
  let baseline = { '64:48': { value: 0, bits: 32, completedHostMs: 0 } }, resolve, calls = [];
  const completion = new Promise(done => { resolve = done; }), routes = { input: { subscribe: () => () => {} }, profileControllerBaseline: () => baseline };
  const part = createOrganRotaryPart({ routes, route: { grant: 1, group: 0, channel: 0, protocol: 'midi2', organ: { policy: {}, organ: { peerMuid: 1 } } }, laneId: 'a', now: () => 1,
    submit: (...args) => { calls.push(args); return { status: 'accepted', completion }; }, getLane: () => ({}) });
  return { part, calls, resolve, async submitted() { part.track({ values: { '64:48': 0xffffffff } }, Promise.resolve({ kind: 'driver-submitted' })); await Promise.resolve(); baseline = { '64:48': { value: 0xffffffff, bits: 32, completedHostMs: 2 } }; } };
}
describe('organ registration restoration ownership (#1277)', () => {
  for (const outcome of ['driver-submitted', 'partial', 'rejected']) it('fences new performance before a held ' + outcome + ' restore result', async () => {
    const f = fixture(); await f.submitted(); const restoring = failure(f.part.restore());
    expect(f.calls).to.have.length(1); expect(f.part.state()).to.include({ pending: 1, suspended: true }); expect(f.part.canPerform()).to.equal(false);
    expect((await failure(f.part.restore())).message).to.include('Stop this part'); expect(f.calls).to.have.length(1);
    f.resolve({ kind: outcome, reason: 'controlled native receipt' }); const error = await restoring;
    if (outcome === 'driver-submitted') expect(error).to.equal(null); else expect(error.message).to.equal('controlled native receipt');
    expect(f.part.canPerform()).to.equal(false); expect(f.part.state().pending).to.equal(0); f.part.dispose();
  });
  it('leaves an unknown no-op restore usable and reports no receiver confirmation', async () => {
    const f = fixture(); const result = await f.part.restore(); expect(result.status).to.equal('unknown'); expect(f.calls).to.have.length(0); expect(f.part.canPerform()).to.equal(true); f.part.dispose();
  });
});
