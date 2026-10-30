import { expect } from 'chai';
import { getOwnedSourceProfile, OWNED_SOURCE_IDS } from '../../js/app/midi-ui/OwnedSourceProfiles.js';
import { pluckSourceBytes, choirSourceBytes, spectrumSourceBytes, granularSourceBytes } from '../../js/app/midi-ui/OwnedSourceLayout.js';
import { createOwnedControlKernel } from '../../js/app/resources/OwnedControlKernel.js';
import { fixedSourceBank } from './fixed-source-bank-fixture.js';

const typedBytes = (value, objects = new Set(), buffers = new Set()) => {
  if (!value || typeof value !== 'object' || objects.has(value)) return 0; objects.add(value);
  if (ArrayBuffer.isView(value)) { if (buffers.has(value.buffer)) return 0; buffers.add(value.buffer); return value.buffer.byteLength; }
  return Object.values(value).reduce((sum, entry) => sum + typedBytes(entry, objects, buffers), 0);
};
describe('named owned source footprint interface (#1258, deferred)', () => {
  it('keeps absent/undefined/null non-PCM separate from strict voice capacity and retained storage', async () => {
    for (const sampleRate of [44100, 48000, 96000]) for (const id of OWNED_SOURCE_IDS.filter(id => !getOwnedSourceProfile(id).requiresPCM)) {
      const profile = getOwnedSourceProfile(id), maximum = profile.sourceBytes({ sampleRate });
      expect(profile.sourceBytes({ sampleRate, pcm: undefined })).to.equal(maximum); expect(profile.sourceBytes({ sampleRate, pcm: null })).to.equal(maximum);
      for (const voices of [1, profile.voices]) {
        const kernel = await createOwnedControlKernel(profile, sampleRate, voices, { sourceBank: profile.bankId ? fixedSourceBank(profile.bankId) : undefined });
        expect(profile.sourceBytes({ sampleRate, pcm: null, voices })).to.equal(typedBytes(kernel.source));
      }
      expect(() => profile.sourceBytes({ sampleRate, voices: null })).to.throw(); expect(() => profile.sourceBytes({ sampleRate, pcm: { bytes: 4 } })).to.throw();
      expect(() => profile.sourceBytes(sampleRate, null)).to.throw(); expect(() => profile.sourceBytes({ sampleRate, voices: profile.voices + 1 })).to.throw();
    }
    for (const storage of [pluckSourceBytes, choirSourceBytes, spectrumSourceBytes, granularSourceBytes]) expect(() => storage(48000, null)).to.throw('storage profile');
  });
  it('includes exact verified PCM descriptor bytes and granular state at both supported voice capacities', () => {
    const profile = getOwnedSourceProfile('worklet-granular');
    for (const sampleRate of [44100, 48000, 96000]) for (const voices of [1, profile.voices]) {
      const pcm = { schema: 'lemmings-owned-pcm-bank/v1', sampleRate: 32000, channels: 2, frames: 4000, bytes: 32000 };
      expect(profile.sourceBytes({ sampleRate, voices, pcm })).to.equal(granularSourceBytes(sampleRate, voices) + pcm.bytes);
      expect(() => profile.sourceBytes({ sampleRate, voices, pcm: null })).to.throw('PCM');
      expect(() => profile.sourceBytes({ sampleRate, voices, pcm: { ...pcm, bytes: 31996 } })).to.throw('PCM');
    }
  });
});
