import { expect } from 'chai';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
import { canonicalDataText } from '../js/core/CanonicalData.js';

describe('exact JSON source byte admission (runtime fixtures deferred)', () => {
  for (const value of [null, [], {}, [1], { one: 1 }, { one: [], two: { three: [true, null, 'line\nquote"'] } }, { unicode: 'é😀\ud800', minusZero: -0, exponent: 1e30 }]) {
    it('accepts precisely the canonical source bytes including separators for ' + JSON.stringify(value), async () => {
      const encoded = canonicalDataText(value), result = await runBackgroundJobKernel('encode-canonical-json', value, { maxBytes: encoded.bytes.length, maxNodes: 4096, estimatedPeakBytes: 1048576, yieldControl: async () => {} });
      expect(result.inputBytes).to.equal(encoded.bytes.length); expect(result.value).to.equal(encoded.text);
    });
  }
});
