import { expect } from 'chai';
import { requireSynchronousResourceAcknowledgement, retireBackgroundResult } from '../js/app/resources/ResourceRetirement.js';
describe('resource retirement acknowledgement', () => {
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
