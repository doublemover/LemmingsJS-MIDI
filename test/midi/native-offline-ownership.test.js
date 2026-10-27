import { expect } from 'chai';
import { renderNativeOfflineGraph } from '../../js/app/midi-ui/NativeOfflineDriver.js';
import { CAUSAL_RENDER_SOURCES } from '../../js/app/midi-ui/CausalTakeAudioRender.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { singleSampleMap } from '../helpers/sampleMap.js';
import { DECODER_VERSION } from '../../js/app/midi-ui/AudioAssetRef.js';

const patch = CAUSAL_RENDER_SOURCES.find(source => source.id === 'native-oscillator').definition;
const request = { patch, events: [], frames: 128, sampleRate: 48000 };
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
describe('native offline producer ownership (API doubles, no PCM qualification)', () => {
  it('rejects malformed explicit end requests before allocating an offline context or PCM', async () => {
    const resources = createAudioResourceLeases(), admission = createBackgroundWorkerAdmission(); let contexts = 0;
    class OfflineDouble { constructor() { contexts++; throw new Error('Unadmitted context allocation'); } }
    for (const end of [{ releaseSeconds: -1 }, { releaseSeconds: NaN }, { releaseSeconds: 4.1 }, { releaseSeconds: 0.01, force: 'yes' }, {}]) {
      let error;
      try { await renderNativeOfflineGraph({ ...request, events: [{ kind: 'end', frame: 0, voiceId: 'unknown', ...end }] }, { resources, admission, OfflineAudioContext: OfflineDouble }); }
      catch (failure) { error = failure; }
      expect(error?.code).to.equal('native-event-preflight');
    }
    expect(contexts).to.equal(0); expect(resources.diagnostics().exactBytes).to.equal(0);
    await resources.dispose().completion; admission.dispose();
  });
  it('uses the mapped sample backend and releases its retained pins while keeping returned PCM owned', async () => {
    const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), admission = createBackgroundWorkerAdmission({ maxWorkers: 1 });
    const hash = 'a'.repeat(64), ref = { contentHash: hash, kind: 'sample', bytes: 64044, frames: 32000, sourceSampleRate: 32000, channels: 1 };
    let retained = 0, starts = 0;
    const makePin = () => { retained++; let active = true; return { ref, variant: { contentHash: hash, decoderVersion: DECODER_VERSION, targetSampleRate: 48000 },
      buffer: { length: 48000, sampleRate: 48000, numberOfChannels: 1 }, isActive: () => active, retain: makePin,
      release() { if (active) { active = false; retained--; } } }; };
    const pin = makePin(), param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
    const node = () => ({ connect() {}, disconnect() {}, gain: param(), pan: param() });
    class OfflineDouble {
      constructor(options) { Object.assign(this, options); this.state = 'suspended'; this.currentTime = 0; this.destination = node(); }
      createGain() { return node(); } createStereoPanner() { return node(); }
      createChannelMerger() { return node(); } createChannelSplitter() { return node(); }
      createBufferSource() { return { ...node(), playbackRate: param(), start() { starts++; }, stop() {} }; }
      suspend() { throw new Error('Only one quantum is needed.'); } resume() { return Promise.resolve(); }
      async startRendering() { this.currentTime = this.length / this.sampleRate; this.state = 'closed'; return { length: this.length, numberOfChannels: this.numberOfChannels, sampleRate: this.sampleRate }; }
    }
    const samplePatch = { id: 'fixture', revision: 1, engineId: 'native-sample', engineVersion: 1, parameters: { releaseSeconds: 0.002 }, mix: { gain01: 0.5, pan01: 0 },
      voicePolicy: { maxVoices: 1, steal: 'reject' }, sampleRefs: [{ sha256: hash, bytes: ref.bytes, required: true }], sampleMap: singleSampleMap(hash, { frames: 32000 }) };
    const begin = { version: 1, kind: 'begin', voiceId: 'sample', onsetId: 'onset', intentId: 'sample-onset', generation: 1, actorId: null, sourceEventIds: [], pitch: { cents: 6000 }, velocity01: 0.6, expression: {} };
    const rendered = await renderNativeOfflineGraph({ patch: samplePatch, assets: [pin], events: [{ kind: 'begin', frame: 0, voiceId: 'sample', intent: begin, releaseFrame: 64, releaseSeconds: 0.002 }], frames: 128, sampleRate: 48000 },
      { resources, admission, resourceBudget: budget, OfflineAudioContext: OfflineDouble });
    expect(starts).to.equal(1); expect(retained).to.equal(1);
    expect(rendered.receipt.sourceSelections[0]).to.include({ zoneId: 'center-0', assetHash: hash, evidenceClass: 'native-source-selection-api', acousticReceipt: false });
    expect(rendered.receipt.sourceSelectionCoverage).to.include({ selectedOnsets: 1, retained: 1, omitted: 0 });
    expect(resources.diagnostics().exactBytes).to.equal(128 * 8); rendered.release(); pin.release();
    expect(retained).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0); await resources.dispose().completion; admission.dispose();
  });
  it('routes a carried mapped sample through scheduled native lanes without retriggering its onset', async () => {
    const resources = createAudioResourceLeases(), admission = createBackgroundWorkerAdmission({ maxWorkers: 1 }), hash = 'a'.repeat(64);
    const ref = { contentHash: hash, kind: 'sample', bytes: 64044, frames: 32000, sourceSampleRate: 32000, channels: 1 }; let retained = 0, starts = 0;
    const makePin = () => { retained++; let active = true; return { ref, variant: { contentHash: hash, decoderVersion: DECODER_VERSION, targetSampleRate: 48000 },
      buffer: { length: 48000, sampleRate: 48000, numberOfChannels: 1 }, isActive: () => active, retain: makePin, release() { if (active) { active = false; retained--; } } }; };
    const pin = makePin(), automation = [], param = () => ({ setValueAtTime() {}, linearRampToValueAtTime(value, time) { automation.push([value, time]); }, cancelScheduledValues() {} });
    const node = () => ({ connect() {}, disconnect() {}, gain: param(), pan: param() });
    class OfflineDouble {
      constructor(options) { Object.assign(this, options); this.state = 'suspended'; this.currentTime = 0; this.destination = node(); }
      createGain() { return node(); } createStereoPanner() { return node(); } createChannelMerger() { return node(); } createChannelSplitter() { return node(); }
      createBufferSource() { return { ...node(), playbackRate: param(), start() { starts++; }, stop() {} }; }
      suspend() { throw new Error('One final batch is sufficient.'); } resume() { return Promise.resolve(); }
      async startRendering() { this.currentTime = this.length / this.sampleRate; this.state = 'closed'; return { length: this.length, numberOfChannels: this.numberOfChannels, sampleRate: this.sampleRate }; }
    }
    const samplePatch = { id: 'fixture', revision: 1, engineId: 'native-sample', engineVersion: 1, parameters: { releaseSeconds: 0.002 }, mix: { gain01: 0.5, pan01: 0 },
      voicePolicy: { maxVoices: 1, steal: 'reject' }, sampleRefs: [{ sha256: hash, bytes: ref.bytes, required: true }], sampleMap: singleSampleMap(hash, { frames: 32000 }) };
    const begin = { version: 1, kind: 'begin', voiceId: 'sample', onsetId: 'onset', intentId: 'sample-onset', generation: 1, actorId: null, sourceEventIds: [], pitch: { cents: 6000 }, velocity01: 0.6, expression: {} };
    const result = await renderNativeOfflineGraph({ patch: samplePatch, assets: [pin], frames: 2048, sampleRate: 48000, stemLaneIds: ['a', 'b'], events: [
      { kind: 'begin', frame: 0, voiceId: 'sample', laneId: 'a', intent: begin, releaseFrame: 1600, releaseSeconds: 0.002 },
      { kind: 'lane', frame: 512, voiceId: 'sample', laneId: 'b' }
    ] }, { resources, admission, OfflineAudioContext: OfflineDouble });
    expect(starts).to.equal(1); expect(result.receipt.submitted).to.equal(3); expect(result.channels).to.equal(6);
    expect(automation.some(([value, time]) => value === 1 && Math.abs(time - (512 / 48000 + 0.008)) < 1e-12)).to.equal(true);
    expect(automation.some(([value, time]) => value === 0 && Math.abs(time - (512 / 48000 + 0.008)) < 1e-12)).to.equal(true);
    expect(retained).to.equal(1); result.release(); pin.release(); expect(resources.diagnostics().reservations).to.equal(0);
    await resources.dispose().completion; admission.dispose();
  });
  it('cancels a queued render before constructing a native context or allocating output PCM', async () => {
    const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), admission = createBackgroundWorkerAdmission({ maxWorkers: 1 });
    const blocker = await admission.acquire({ kind: 'parse-json', ownerId: 'blocker', ownerEpoch: 0, sourceRevision: 1, estimatedPeakBytes: 4096 });
    let opened = 0; const controller = new AbortController(), pending = renderNativeOfflineGraph(request,
      { resources, admission, resourceBudget: budget, signal: controller.signal, OfflineAudioContext: class { constructor() { opened++; } } });
    expect(admission.diagnostics().queuedJobs).to.equal(1); expect(resources.diagnostics().exactBytes).to.equal(0);
    controller.abort(new Error('queued cancellation')); let error; try { await pending; } catch (value) { error = value; }
    expect(error.message).to.equal('queued cancellation'); expect(opened).to.equal(0); expect(admission.diagnostics().queuedJobs).to.equal(0);
    blocker.release(); expect(budget.diagnostics().accountedBytes).to.equal(0); await resources.dispose().completion; admission.dispose();
  });
  it('keeps the running slot and PCM charged until an unabortable native render settles', async () => {
    const budget = createResourceBudget(), resources = createAudioResourceLeases({ resourceBudget: budget }), admission = createBackgroundWorkerAdmission({ maxWorkers: 1 });
    let native;
    const node = () => ({ connect() {}, disconnect() {} });
    class OfflineDouble {
      constructor(options) { Object.assign(this, options); this.state = 'suspended'; this.currentTime = 0; this.destination = node(); native = this; }
      createGain() { return node(); } createStereoPanner() { return node(); }
      createChannelMerger() { return node(); } createChannelSplitter() { return node(); }
      suspend() { throw new Error('This fixture has only one quantum.'); } resume() { this.state = 'running'; return Promise.resolve(); }
      startRendering() { this.state = 'running'; return new Promise(resolve => { this.complete = () => { this.state = 'closed'; resolve({ length: this.length, numberOfChannels: this.numberOfChannels, sampleRate: this.sampleRate }); }; }); }
    }
    const controller = new AbortController(), pending = renderNativeOfflineGraph(request, { resources, admission, resourceBudget: budget, signal: controller.signal, OfflineAudioContext: OfflineDouble });
    let settled = false; pending.then(() => { settled = true; }, () => { settled = true; }); await turn();
    controller.abort(new Error('running cancellation')); await turn();
    expect(settled).to.equal(false); expect(admission.diagnostics().activeWorkers).to.equal(1); expect(resources.diagnostics().exactBytes).to.be.greaterThan(0);
    native.complete(); let error; try { await pending; } catch (value) { error = value; }
    expect(error.message).to.equal('running cancellation'); expect(admission.diagnostics().activeWorkers).to.equal(0);
    expect(budget.diagnostics().accountedBytes).to.equal(0); await resources.dispose().completion; admission.dispose();
  });
});
