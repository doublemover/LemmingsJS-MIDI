import { expect } from 'chai';
import { requireSynchronousResourceAcknowledgement, retireBackgroundResult, awaitBackgroundFailureRetirement } from '../js/app/resources/ResourceRetirement.js';
describe('resource retirement acknowledgement', () => {
  it('awaits actual producer completion even when a frozen failure has already rejected computation', async () => {
    let finish, ready = false; const completion = new Promise(resolve => { finish = resolve; });
    const failure = Object.freeze(Object.assign(new Error('Canceled'), { backgroundRetirement: { phase: 'canceling' }, backgroundRetirementCompletion: completion }));
    const pending = awaitBackgroundFailureRetirement(failure).then(() => { ready = true; }); await Promise.resolve();
    expect(ready).to.equal(false); finish({ phase: 'canceled' }); await pending; expect(ready).to.equal(true);
    await awaitBackgroundFailureRetirement(new Error('No admitted producer')); await awaitBackgroundFailureRetirement({ backgroundRetirement: { phase: 'released' } });
  });
  for (const phase of ['missing', 'unknown', 'rejected']) it('refuses unconfirmed producer retirement: ' + phase, async () => {
    const completion = phase === 'missing' ? Promise.resolve(null) : phase === 'unknown' ? Promise.resolve({ phase: 'failed-or-unknown' }) : Promise.reject(new Error('Retirement rejected'));
    let error; try { await awaitBackgroundFailureRetirement({ backgroundRetirementCompletion: completion }); } catch (failure) { error = failure; }
    expect(error.name).to.equal('ResourceOwnershipError');
  });
  it('does not confuse an async result or false with synchronous release', () => {
    for (const value of [false, Promise.resolve(true)]) expect(() => requireSynchronousResourceAcknowledgement(value)).to.throw('synchronously');
    for (const value of [undefined, true, { released: true }]) expect(() => requireSynchronousResourceAcknowledgement(value)).not.to.throw();
  });
  it('requires the worker owner terminal receipt after release', () => {
    for (const phase of ['computed', 'running', 'failed-or-unknown']) expect(() => retireBackgroundResult({ release() {}, retirementState: () => ({ phase }) })).to.throw('unresolved');
    expect(() => retireBackgroundResult({ release() {} })).to.throw('unresolved');
    expect(() => retireBackgroundResult({ release() {}, retirementState: () => ({ phase: 'released' }) })).not.to.throw();
  });
});
