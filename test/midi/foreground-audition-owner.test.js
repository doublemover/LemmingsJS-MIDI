import { expect } from 'chai';
import { createForegroundAuditionOwner } from '../../js/app/midi-ui/ForegroundAuditionOwner.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';

const source = name => ({ name, kind: 'fixed-take', revision: 'revision-2', sourceRef: 'immutable-' + name });
const complete = () => createProcgenRetirementScope().retire();

describe('single foreground prelisten ownership', () => {
  it('waits for the previous native source to retire before admitting its successor', async () => {
    const owner = createForegroundAuditionOwner(); let stopped = 0;
    const first = await owner.acquire({ source: source('A'), routeRevision: 3, onStop() { stopped++; } }); first.markReady(); first.markPlaying();
    let ready = false; const preparing = owner.acquire({ source: source('B'), routeRevision: 3, onStop() {} }).then(value => { ready = true; return value; });
    await Promise.resolve(); expect(stopped).to.equal(1); expect(first.signal.aborted).to.equal(true); expect(first.isCurrent()).to.equal(false);
    expect(ready).to.equal(false); expect(owner.state()).to.include({ active: true, acceptedSources: 2 });
    await first.close(complete()); const second = await preparing; expect(second.snapshot().source.name).to.equal('B');
    second.markReady(); second.markPlaying(); expect(() => first.markPlaying()).to.throw(); await second.close(complete());
    expect(owner.state()).to.include({ active: false, acceptedSources: 0 }); expect(owner.state().foreground.source.name).to.equal('B');
  });
  it('cancels a pending selection without letting late readiness regain foreground', async () => {
    const owner = createForegroundAuditionOwner(), first = await owner.acquire({ source: source('A'), routeRevision: 1, onStop() {} });
    const controller = new AbortController(), pending = owner.acquire({ source: source('B'), routeRevision: 1, signal: controller.signal, onStop() {} });
    pending.catch(() => {}); controller.abort(new Error('choice changed'));
    try { await pending; expect.fail('pending selection must reject'); } catch (error) { expect(error.message).to.include('source-operation-canceled'); }
    expect(owner.state().acceptedSources).to.equal(1); await first.close(complete()); expect(owner.state().acceptedSources).to.equal(0);
  });
  it('keeps an unknown retirement charged and blocks another source', async () => {
    const owner = createForegroundAuditionOwner(), lease = await owner.acquire({ source: source('A'), routeRevision: 1, onStop() {} });
    const failed = createProcgenRetirementScope().retire([{ name: 'native-source', run() { throw new Error('stop refused'); } }]);
    await lease.close(failed); expect(owner.state()).to.include({ acceptedSources: 1, unresolvedOwnership: true });
    try { await owner.acquire({ source: source('B'), routeRevision: 1, onStop() {} }); expect.fail('unknown source must remain unavailable'); } catch (error) { expect(error.name).to.equal('AuditionOwnershipError'); }
    const retired = owner.dispose(); await retired.completion; expect(retired.outcome).to.equal('partial');
  });
  it('does not treat a failed cancellation callback as acknowledged retirement', async () => {
    const owner = createForegroundAuditionOwner(), lease = await owner.acquire({ source: source('A'), routeRevision: 1, onStop() { throw new Error('request failed'); } });
    const stopped = owner.stop(); await lease.close(complete()); await stopped;
    expect(owner.state().unresolvedOwnership).to.equal(true); const receipt = owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('partial');
  });
});
