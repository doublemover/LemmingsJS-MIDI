import { expect } from 'chai';
import { renderNativeOfflineGraph } from '../../js/app/midi-ui/NativeOfflineDriver.js';
import { CAUSAL_RENDER_SOURCES } from '../../js/app/midi-ui/CausalTakeAudioRender.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';

const patch = CAUSAL_RENDER_SOURCES.find(source => source.id === 'native-oscillator').definition;
const request = { patch, events: [], frames: 128, sampleRate: 48000 };
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
describe('native offline producer ownership (API doubles, no PCM qualification)', () => {
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
