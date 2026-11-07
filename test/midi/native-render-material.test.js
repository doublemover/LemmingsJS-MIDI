import { expect } from 'chai';
import { prepareNativeRenderMaterial } from '../../js/app/midi-ui/NativeRenderMaterial.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { DECODER_VERSION } from '../../js/app/midi-ui/AudioAssetRef.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const hash = 'a'.repeat(64), definition = { engineId: 'native-sample', sampleRefs: [{ sha256: hash, bytes: 128 }] };
describe('isolated native render decode material (ownership doubles)', () => {
  it('retires the one-frame decode context before lending the shared native buffer pin', async () => {
    const resources = createAudioResourceLeases(), events = []; let active = true;
    const pin = { isActive: () => active, ref: { contentHash: hash, bytes: 128, frames: 64, sourceSampleRate: 48000, channels: 1, kind: 'sample' }, variant: { decoderVersion: DECODER_VERSION, targetSampleRate: 48000 },
      buffer: { sampleRate: 48000, length: 64, numberOfChannels: 1 } };
    class OfflineDouble {
      constructor(options) { Object.assign(this, options); this.state = 'suspended'; }
      decodeAudioData() { throw new Error('The provider owns native decoding.'); }
      async startRendering() { events.push('native-retirement'); this.state = 'closed'; return { length: 1, sampleRate: 48000, numberOfChannels: 2 }; }
    }
    const scope = createProcgenRetirementScope(), provider = { async acquire(options) {
      expect(options).to.include({ decodeProfile: 'native-context', joinCancellation: true }); expect(options.decodeContext).to.be.instanceOf(OfflineDouble);
      events.push('decoded-pin'); return { assets: [pin], release: () => scope.retire([{ name: 'pin', run: () => { active = false; } }]) };
    } };
    const material = await prepareNativeRenderMaterial({ provider, resources, definition, reference: {}, owner: 'fixture', OfflineAudioContext: OfflineDouble });
    expect(events).to.deep.equal(['decoded-pin', 'native-retirement']); expect(resources.diagnostics().reservations).to.equal(0);
    expect(material.assets[0]).to.equal(pin); expect(material.descriptor.nativeContextRetired).to.equal(true); expect(material.descriptor.bytes).to.equal(256);
    await material.release().completion; expect(active).to.equal(false); expect(() => material.assets).to.throw('retired'); await resources.dispose().completion;
  });
  it('joins canceled decoding and native context retirement before releasing their declared storage', async () => {
    const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), decode = deferred(), rendering = deferred();
    let draining = false;
    class OfflineDouble {
      constructor(options) { Object.assign(this, options); this.state = 'suspended'; }
      decodeAudioData() {}
      async startRendering() { draining = true; await rendering.promise; this.state = 'closed'; return { length: 1, sampleRate: 48000, numberOfChannels: 2 }; }
    }
    const provider = { async acquire() { await decode.promise; throw new Error('canceled owned decode'); } }, controller = new AbortController();
    const work = prepareNativeRenderMaterial({ provider, resources, definition, reference: {}, owner: 'fixture', signal: controller.signal, OfflineAudioContext: OfflineDouble });
    let complete = false; work.then(() => { complete = true; }, () => { complete = true; }); controller.abort(); await turn();
    expect(complete).to.equal(false); expect(draining).to.equal(false); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    decode.resolve(); await turn(); expect(draining).to.equal(true); expect(complete).to.equal(false); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    rendering.resolve(); let error; try { await work; } catch (caught) { error = caught; }
    expect(error.message).to.equal('canceled owned decode'); expect(budget.diagnostics().accountedBytes).to.equal(0); await resources.dispose().completion;
  });
});
