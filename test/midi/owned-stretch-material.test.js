import { expect } from 'chai';
import { createOwnedStretchMaterial } from '../../js/app/midi-ui/OwnedStretchMaterial.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { OWNED_STRETCH_CORE } from '../../js/midi/content/OwnedStretchCoreIdentity.js';

const build = { buildId: 'a'.repeat(64) }, root = new URL('https://application.invalid/immutable/'), refusal = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected refusal.'); };
const setup = options => { const budget = createResourceBudget(), owner = createOwnedStretchMaterial({ resourceBudget: budget, getBuild: () => build, getRoot: () => root, ...options }); return { owner, budget }; };

describe('application-bound immutable stretch material ownership (qualification deferred)', () => {
  it('refuses unbuilt sources without allocating a fetch workspace', async () => {
    let fetched = false; const f = setup({ getBuild: () => null, fetchImpl: async () => { fetched = true; } }); expect(await refusal(() => f.owner.borrow())).to.be.instanceOf(Error); expect(fetched).to.equal(false); expect(f.budget.diagnostics().accountedBytes).to.equal(0); await f.owner.dispose().completion;
  });
  it('reads only the immutable generation route and refuses foreign bytes with complete stream retirement', async () => {
    let url, canceled = 0, unlocked = 0, read = false; const f = setup({ fetchImpl: async target => { url = target; return { ok: true, headers: { get: () => String(OWNED_STRETCH_CORE.wasmBytes) }, body: { getReader: () => ({ async read() { if (read) return { done: true }; read = true; return { done: false, value: new Uint8Array(OWNED_STRETCH_CORE.wasmBytes) }; }, async cancel() { canceled++; }, releaseLock() { unlocked++; } }) } }; } });
    expect((await refusal(() => f.owner.borrow())).message).to.include('changed or was truncated'); expect(url).to.equal(new URL(build.buildId + '/' + OWNED_STRETCH_CORE.runtimePath, root).href); expect(unlocked).to.equal(1); expect(canceled).to.equal(0); expect(f.budget.diagnostics().accountedBytes).to.equal(0); await f.owner.dispose().completion;
  });
  it('keeps an oversized stream charged until cancellation acknowledgment arrives', async () => {
    let cancelEntered, releaseCancel; const entered = new Promise(resolve => { cancelEntered = resolve; }), gate = new Promise(resolve => { releaseCancel = resolve; }); const f = setup({ fetchImpl: async () => ({ ok: true, headers: { get: () => null }, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(OWNED_STRETCH_CORE.wasmBytes + 1) }), cancel: () => { cancelEntered(); return gate; }, releaseLock() {} }) } }) });
    const pending = refusal(() => f.owner.borrow()); await entered; expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(2 * 1048576); const receipt = f.owner.dispose(); expect(receipt.outcome).to.equal('pending'); releaseCancel(); expect((await pending).message).to.include('bounded inventory'); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('preserves unknown cancellation storage and refuses a second producer', async () => {
    const f = setup({ fetchImpl: async () => ({ ok: true, headers: { get: () => null }, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(OWNED_STRETCH_CORE.wasmBytes + 1) }), cancel: async () => { throw new Error('stream retirement unknown'); }, releaseLock() {} }) } }) });
    expect(await refusal(() => f.owner.borrow())).to.be.instanceOf(Error); expect(f.owner.state().unknownRetirement).to.equal(1); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(2 * 1048576); expect((await refusal(() => f.owner.borrow())).message).to.include('unresolved'); const receipt = f.owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('partial'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
  it('bounds canceled waiters while the cache-owned producer remains pending', async () => {
    let releaseFetch, fetchEntered, fetches = 0; const gate = new Promise(resolve => { releaseFetch = resolve; }), entered = new Promise(resolve => { fetchEntered = resolve; }); const f = setup({ fetchImpl: async () => { fetches++; fetchEntered(); await gate; return { ok: false, body: null }; } });
    const failures = []; for (let index = 0; index < 8; index++) { const controller = new AbortController(), pending = refusal(() => f.owner.borrow({ signal: controller.signal })); controller.abort(new Error('request canceled')); failures.push(pending); }
    await entered; expect(fetches).to.equal(1); expect(f.owner.state().waitingConsumers).to.equal(8); expect((await refusal(() => f.owner.borrow())).message).to.include('capacity'); await Promise.all(failures); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); const receipt = f.owner.dispose(); releaseFetch(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
});
