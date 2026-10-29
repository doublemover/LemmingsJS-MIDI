import { expect } from 'chai';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

import { turn, deferred, receipt, environment } from './helpers/performance-lease.js';

describe('cooperative browser performance ownership', () => {
  it('grants one concurrent page and never queues automatic playback after the owner releases', async () => {
    const f = environment(), a = f.make(), b = f.make(), first = f.source(a.lease), second = f.source(b.lease);
    const [one, two] = await Promise.all([first.acquire(), second.acquire()]); expect(one).not.to.equal(null); expect(two).to.equal(null);
    expect(first.isCurrent(one)).to.equal(true); expect(b.lease.state().status).to.equal('busy');
    expect(f.requests).to.have.length(2); for (const request of f.requests) expect(request.options).to.deep.equal({ mode: 'exclusive', ifAvailable: true });
    await first.release(); await turn(); expect(f.owned()).to.equal(false); expect(second.isCurrent(two)).to.equal(false); expect(f.requests).to.have.length(2);
    const next = await second.acquire(); expect(second.isCurrent(next)).to.equal(true); expect(first.isCurrent(one)).to.equal(false);
    await a.lease.dispose(); await b.lease.dispose();
  });
  it('revokes old admission before waiting for an acknowledged stop frontier and native lock release', async () => {
    const f = environment(), stopped = deferred(), a = f.make(), b = f.make(); let called = 0;
    const first = f.source(a.lease, () => { called++; return receipt(() => stopped.promise); }), second = f.source(b.lease), old = await first.acquire();
    const takeover = b.lease.takeOver(); await turn(); expect(called).to.equal(1); expect(first.isCurrent(old)).to.equal(false); expect(first.canRelease(old)).to.equal(true);
    expect(a.lease.state().status).to.equal('stopping'); expect(f.owned()).to.equal(true); expect(b.lease.state().exclusive).to.equal(false);
    stopped.resolve(); expect(await takeover).to.equal(true); const current = await second.acquire();
    expect(second.isCurrent(current)).to.equal(true); expect(first.canRelease(old)).to.equal(false); await a.lease.dispose(); await b.lease.dispose();
  });
  it('cancels a takeover without admitting notes after a late old-owner acknowledgment', async () => {
    const f = environment(), stopped = deferred(), a = f.make(), b = f.make(), controller = new AbortController();
    const first = f.source(a.lease, () => receipt(() => stopped.promise)), second = f.source(b.lease); await first.acquire();
    const takeover = b.lease.takeOver({ signal: controller.signal }); await turn(); controller.abort(); expect(await takeover).to.equal(false);
    stopped.resolve(); await turn(); await turn(); expect(b.lease.state().exclusive).to.equal(false); expect(b.lease.state().pendingRequests).to.equal(0);
    expect(second.isCurrent(await second.acquire())).to.equal(true); await a.lease.dispose(); await b.lease.dispose();
  });
  it('releases a canceled late grant rather than stranding an empty native lock', async () => {
    const f = environment(), grant = deferred(), controller = new AbortController();
    const a = f.make({ locks: { request: (_name, _options, callback) => grant.promise.then(() => callback({})) } }), source = f.source(a.lease);
    const pending = source.acquire({ signal: controller.signal }); controller.abort(); expect(await pending).to.equal(null);
    grant.resolve(); await turn(); expect(a.lease.state()).to.include({ exclusive: false, pendingRequests: 0, status: 'idle' }); await a.lease.dispose();
  });
  it('retains an unknown sink and refuses handoff while its native lock remains owned', async () => {
    const f = environment(), a = f.make(), b = f.make(); let stopped = 0;
    const first = f.source(a.lease, () => { stopped++; return receipt(() => { throw new Error('Sink did not stop'); }); }), old = await first.acquire();
    expect(await b.lease.takeOver()).to.equal(false); expect(stopped).to.equal(1); expect(a.lease.state().status).to.equal('blocked'); expect(first.isCurrent(old)).to.equal(false);
    expect(f.owned()).to.equal(true); expect(await f.source(b.lease).acquire()).to.equal(null); await a.lease.dispose(); await b.lease.dispose();
  });
  for (const mode of ['missing', 'throwing', 'rejected']) it('reports explicit uncoordinated activation for ' + mode + ' Web Locks', async () => {
    const f = environment(), locks = mode === 'missing' ? null : { request() { const error = Object.assign(new Error('Blocked'), { name: 'SecurityError' }); if (mode === 'throwing') throw error; return Promise.reject(error); } };
    const a = f.make({ locks }), source = f.source(a.lease), token = await source.acquire();
    expect(source.isCurrent(token)).to.equal(true); expect(a.lease.state()).to.include({ status: 'uncoordinated', exclusive: false, coordination: 'uncoordinated' }); await a.lease.dispose();
  });
  it('cannot take over without a broadcast stop frontier and does not infer release from a missing peer heartbeat', async () => {
    const f = environment(), a = f.make({ BroadcastChannel: null }), b = f.make({ BroadcastChannel: null }), first = f.source(a.lease); const token = await first.acquire();
    expect(await b.lease.takeOver()).to.equal(false); expect(first.isCurrent(token)).to.equal(true); expect(f.owned()).to.equal(true); await a.lease.dispose(); await b.lease.dispose();
  });
  it('keeps document identity local and broadcasts only bounded validated status', async () => {
    const f = environment(), a = f.make(), b = f.make(), source = f.source(a.lease); source.setDocumentIdentity('private-document-123'); source.setRoles(['live', 'capture']); await source.acquire(); await turn();
    expect(a.lease.state().activeDocumentIdentities).to.deep.equal(['private-document-123']); expect(a.lease.state().roles).to.deep.equal(['live', 'capture']);
    expect(f.messages.some(data => data.includes('private-document'))).to.equal(false); expect(f.messages.every(data => data.length <= 2048)).to.equal(true);
    const state = b.lease.state(); for (const channel of f.channels) if (channel.onmessage) { channel.onmessage({ data: 'x'.repeat(2049) }); channel.onmessage({ data: JSON.stringify({ protocol: 'lemmings-performance/v1', type: 'status', sender: 'bad' }) }); }
    expect(b.lease.state().otherOwner).to.deep.equal(state.otherOwner); await a.lease.dispose(); await b.lease.dispose();
  });
  for (const event of ['pagehide', 'freeze', 'pageshow']) it('retires lifecycle output and keeps ' + event + ' stopped until explicit activation', async () => {
    const f = environment(), a = f.make(), source = f.source(a.lease), token = await source.acquire();
    (event === 'freeze' ? a.document : a.window).emit(event, { persisted: true }); await turn();
    expect(source.isCurrent(token)).to.equal(false); expect(a.lease.state().exclusive).to.equal(false); expect(f.requests).to.have.length(1); await a.lease.dispose();
  });
  it('bounds registrations and metadata and prevents retired registrations from acquiring again', async () => {
    const f = environment(), budget = createResourceBudget({ limitBytes: 81920 }), a = f.make({ resourceBudget: budget }), source = f.source(a.lease);
    expect(budget.diagnostics().accountedBytes).to.equal(81920); await source.dispose(); expect(await source.acquire()).to.equal(null); expect(source.setRoles(['capture'])).to.equal(false);
    for (let index = 0; index < 32; index++) f.source(a.lease, () => receipt(), 'source-' + index);
    expect(() => f.source(a.lease, () => receipt(), 'overflow')).to.throw('invalid-resource-registration');
    const disposal = a.lease.dispose(); expect(a.lease.dispose()).to.equal(disposal); await disposal; expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('does not acknowledge disposal before an outstanding native request has actually retired', async () => {
    const f = environment(), grant = deferred(), budget = createResourceBudget({ limitBytes: 81920 });
    const a = f.make({ resourceBudget: budget, locks: { request: (_name, _options, callback) => grant.promise.then(() => callback({})) } }), source = f.source(a.lease);
    const pending = source.acquire(); expect((await a.lease.dispose()).complete).to.equal(false); expect(await pending).to.equal(null); expect(budget.diagnostics().accountedBytes).to.equal(81920);
    grant.resolve(); await turn(); expect(budget.diagnostics().accountedBytes).to.equal(0); expect(a.lease.state().status).to.equal('disposed');
  });
  it('reports refused metadata retirement rather than claiming a complete disposal', async () => {
    const f = environment(), a = f.make({ resourceBudget: { reserve() {}, release: () => false } });
    expect((await a.lease.dispose()).complete).to.equal(false); expect(a.lease.state()).to.include({ status: 'blocked', reason: 'metadata-retirement-unconfirmed' });
  });
});
