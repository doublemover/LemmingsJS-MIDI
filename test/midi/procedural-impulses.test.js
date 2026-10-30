import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { PROCEDURAL_IMPULSE_IDENTITIES } from '../../js/midi/content/ProceduralImpulseIdentities.js';
import { generateProceduralSoundSource } from '../../js/midi/content/ProceduralSoundSources.js';
import { getProceduralSoundMaterial } from '../../js/midi/content/ProceduralSoundMaterial.js';
import { ORIGINAL_IMPULSE_PRESETS, createOriginalImpulseDescriptor } from '../../js/midi/content/ProceduralImpulseMaterial.js';
import { createQuarryBody } from '../../js/midi/content/DubQuarryRack.js';
import { inspectWaveContainer } from '../../js/app/midi-ui/AudioAssetRef.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';

describe('original shared reflection bodies (deferred qualification)', () => {
  it('reproduces complete source identities and refuses using an IR as a sample source', () => {
    for (const identity of PROCEDURAL_IMPULSE_IDENTITIES) {
      const bytes = generateProceduralSoundSource(identity), format = inspectWaveContainer(bytes, { maxChannels: 4 });
      expect(createHash('sha256').update(bytes).digest('hex')).to.equal(identity.sha256); expect(bytes.byteLength).to.equal(identity.bytes);
      expect(format).to.include({ channels: identity.channels, sampleRate: identity.sampleRate, frames: identity.frames });
      const file = { ...identity, mediaType: 'audio/wav' }; expect(getProceduralSoundMaterial(file)).to.equal(identity);
      expect(getProceduralSoundMaterial({ ...file, kind: 'sample' })).to.equal(null);
      if (identity.channels === 4) {
        const view = new DataView(bytes.buffer); let distinct = 0;
        for (let i = 256; i < 1024; i++) if (view.getInt16(44 + i * 8, true) !== view.getInt16(44 + i * 8 + 4, true)) distinct++;
        expect(distinct).to.be.greaterThan(100);
      }
    }
  });
  it('keeps body routing bounds explicit and source sends separate from tails', () => {
    for (const preset of ORIGINAL_IMPULSE_PRESETS) {
      const identity = PROCEDURAL_IMPULSE_IDENTITIES.find(value => value.id === preset.id), descriptor = createOriginalImpulseDescriptor(preset.id);
      expect(descriptor.asset.contentHash).to.equal(identity.sha256); expect(descriptor.normalizationMode).to.equal('native-rms');
      expect(descriptor.maximumLinearGain).to.equal(8); expect(descriptor.latency).to.equal('unknown-native-implementation');
      for (const rate of [44100, 48000, 96000]) {
        const graph = createQuarryBody({ bodyId: preset.id }), plan = prepareEffectGraphRevision(graph, { sampleRate: rate });
        expect(plan.impulseCount).to.equal(1); expect(plan.latencyFrames).to.equal(null); expect(plan.maximumGraphGainBound).to.be.at.most(0.65 * descriptor.maximumLinearGain); expect(plan.maximumOutputGainBound).to.be.lessThan(3);
        expect(graph.nodes.find(value => value.id === 'send').parameters.gain01).to.equal(0);
        expect(plan.maximumTailFrames).to.be.lessThan(3 * rate);
      }
    }
  });
});
