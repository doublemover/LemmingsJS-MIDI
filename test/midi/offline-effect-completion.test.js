import { expect } from 'chai';
import { OfflineEffectCompletion, validateOfflineEffectCompletion } from '../../js/app/midi-ui/worklet/OfflineEffectCompletion.js';

describe('offline effect terminal frame and fault evidence', () => {
  const expected = { endFrame: 200, sampleRate: 48000, revision: 'fixture-v1', stateBytes: 128, configurationKey: 'fixture' };
  it('emits one terminal receipt for the actual final padded quantum and none for live processing', () => {
    const messages = [], completion = new OfflineEffectCompletion({ ...expected, port: { postMessage: value => messages.push(value) } });
    completion.observe(0, 128, 0, false); expect(messages).to.have.length(0);
    completion.observe(128, 128, 0, false); completion.observe(256, 128, 0, false);
    expect(messages).to.have.length(1); expect(validateOfflineEffectCompletion(messages[0], expected).processedThroughFrame).to.equal(256);
    const live = new OfflineEffectCompletion({ ...expected, endFrame: null, port: { postMessage() { throw new Error('Live processing must not fabricate offline completion.'); } } });
    live.observe(0, 128, 0, false); live.observe(128, 128, 0, false);
  });
  for (const input of [[128, 128, 0, false], [0, 256, 1, false], [0, 256, 0, true]]) {
    it('refuses missing initial history, a late internal fault or a panic even when PCM looks finite', () => {
      const messages = [], completion = new OfflineEffectCompletion({ ...expected, port: { postMessage: value => messages.push(value) } }); completion.observe(...input);
      expect(messages).to.have.length(1); expect(() => validateOfflineEffectCompletion(messages[0], expected)).to.throw('continuous frame range');
    });
  }
});
