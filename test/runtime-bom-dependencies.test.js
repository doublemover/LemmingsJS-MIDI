import { expect } from 'chai';
import { normalizeBomDependencies } from '../scripts/RuntimeBomDependencies.js';

describe('CycloneDX dependency normalization', () => {
  it('merges repeated package references without losing distinct dependency edges', () => {
    const input = [
      { ref: 'root', dependsOn: ['b', 'a'] },
      { ref: 'a', dependsOn: ['c'] },
      { ref: 'root', dependsOn: ['a', 'd'] },
      { ref: 'a', dependsOn: ['b'] },
      { ref: 'a', dependsOn: ['c'] },
      { ref: 'b', dependsOn: [] }
    ];
    for (const entry of input) { Object.freeze(entry.dependsOn); Object.freeze(entry); }
    Object.freeze(input);
    const expected = [
      { ref: 'a', dependsOn: ['b', 'c'] },
      { ref: 'b', dependsOn: [] },
      { ref: 'root', dependsOn: ['a', 'b', 'd'] }
    ];
    expect(normalizeBomDependencies(input)).to.deep.equal(expected);
    expect(normalizeBomDependencies([...input].reverse())).to.deep.equal(expected);
  });

  it('preserves isolated components and rejects malformed graph edges', () => {
    expect(normalizeBomDependencies([{ ref: 'isolated' }])).to.deep.equal([{ ref: 'isolated', dependsOn: [] }]);
    expect(() => normalizeBomDependencies([{ ref: 'a', dependsOn: [null] }])).to.throw('Invalid CycloneDX');
  });
});
