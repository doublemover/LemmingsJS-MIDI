import { expect } from 'chai';
import { createOwnedMasterCapture, createPcmCaptureWavLayout } from '../../js/app/midi-ui/OwnedMasterCapture.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

function fixture({ addModule = async () => {}, provenance = false } = {}) {
  const listeners = new Set(), nodes = [], budget = createResourceBudget(); let tapRetired = 0;
  const context = { sampleRate: 48000, currentTime: 0, state: 'running', audioWorklet: { addModule }, destination: {},
    addEventListener(type, callback) { listeners.add(callback); }, removeEventListener(type, callback) { listeners.delete(callback); },
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }) };
  const preview = { getAudioContext: () => context, getState: () => ({ enabled: context.state === 'running', contextEpoch: 4 }),
    acquireMasterCaptureTap: () => ({ release() { tapRetired++; return true; } }) };
  const provenanceListeners = new Set(); let routeRevision = 0;
  if (provenance) {
    preview.getCaptureProvenance = () => ({ contextEpoch: 4, sampleRate: context.sampleRate,
      observedFrame: Math.ceil(context.currentTime * context.sampleRate), routeRevision, owners: [] });
    preview.subscribeCaptureProvenance = listener => { provenanceListeners.add(listener); return () => provenanceListeners.delete(listener); };
  }
  class Node {
    constructor(ctx, name, options) {
      this.options = options; this.messages = []; this.port = { postMessage: message => this.messages.push(message), close() {} }; nodes.push(this);
    }
    connect() {} disconnect() {}
    emit(message) { this.port.onmessage({ data: { protocol: 1, epoch: this.options.processorOptions.epoch, ...message } }); }
    ready() { this.emit({ type: 'ready', sampleRate: 48000, channels: 2, chunkFrames: 4096, pool: 2, targetStartFrame: 0 }); }
    pcm(firstFrame = 0, frameCount = 4) {
      const buffer = new ArrayBuffer(4096 * 8), pcm = new Float32Array(buffer);
      for (let index = 0; index < frameCount; index++) { pcm[index * 2] = 1.25; pcm[index * 2 + 1] = -0.5; }
      this.emit({ type: 'pcm', sourceStartFrame: 0, firstFrame, frameCount, sequence: 1, index: 0, token: 1, buffer });
    }
    end({ lastFrame = 4, capturedFrames = 4, droppedFrames = 0, gaps = [], reason = 'user-stop', clockDiscontinuity = null } = {}) {
      const index = new Float64Array(256 * 3); index.set(gaps.flat());
      this.emit({ type: 'stopped', sourceStartFrame: 0, firstCapturedFrame: 0, lastFrame, capturedFrames, droppedFrames, lastSequence: 1,
        gapCount: gaps.length, gaps: index, zeroChannelFrames: 0, monoFrames: 0, reason, overflowFirstFrame: null, overflowLastFrame: null, clockDiscontinuity });
    }
  }
  const owner = createOwnedMasterCapture({ preview, resourceBudget: budget, AudioWorkletNodeType: Node });
  return { owner, context, budget, nodes, listeners, provenanceListeners,
    changeRoute(revision) { routeRevision = revision; for (const listener of provenanceListeners) listener(preview.getCaptureProvenance()); },
    get tapRetired() { return tapRetired; } };
}

describe('owned browser master PCM capture', () => {
  for (const actualFrame of [0, 128]) it(`retains a verified prefix and bounded clock discontinuity at ${actualFrame} in its partial manifest`, async () => {
    const f = fixture(); await f.owner.start({ seconds: 1 }); const node = f.nodes[0]; node.ready(); node.pcm();
    node.end({ reason: 'noncontiguous-render-clock', clockDiscontinuity: { expectedFrame: 4, actualFrame, frames: 128 } });
    const result = f.owner.state(); expect(result.state).to.equal('partial');
    expect(result.manifest).to.include({ terminalAcknowledged: true, timelineFrames: 4, capturedFrames: 4 });
    expect(result.manifest.clockDiscontinuity).to.deep.equal({ expectedFrame: 4, actualFrame, frames: 128 });
    result.artifact.discard(); await f.owner.dispose().completion; expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains route observations and exact PCM segment bounds through finalization', async () => {
    const f = fixture({ provenance: true }); await f.owner.start({ seconds: 1 });
    const node = f.nodes[0]; node.ready(); node.pcm(); f.context.currentTime = 2 / 48000; f.changeRoute(1); node.end();
    const result = f.owner.state(); expect(result.state).to.equal('ready');
    expect(result.manifest.provenance.graphRevisionHistory.map(row => row.routeRevision)).to.deep.equal([0, 1]);
    expect(result.manifest.segments[0]).to.include({ sourceStartFrame: 0, frameCount: 4, contextEpoch: 4, sampleRate: 48000 });
    expect(f.provenanceListeners.size).to.equal(0); result.artifact.discard();
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('stops explicitly when route provenance fills and keeps admitted PCM available', async () => {
    const f = fixture({ provenance: true }); await f.owner.start({ seconds: 1 });
    const node = f.nodes[0]; node.ready(); node.pcm();
    for (let index = 1; index < 100; index++) f.changeRoute(index);
    expect(f.owner.state().state).to.equal('stopping');
    expect(node.messages.some(message => message.type === 'stop' && message.reason === 'provenance-unavailable')).to.equal(true);
    node.end({ reason: 'provenance-unavailable' }); const result = f.owner.state();
    expect(result.state).to.equal('partial'); expect(result.manifest.provenance.complete).to.equal(false);
    expect(f.provenanceListeners.size).to.equal(0); result.artifact.discard();
  });
  it('never labels new-rate samples with the original WAV clock', async () => {
    const f = fixture({ provenance: true }); await f.owner.start({ seconds: 1 });
    const node = f.nodes[0]; node.ready(); node.pcm(); f.context.sampleRate = 44100; f.changeRoute(1); node.end();
    const result = f.owner.state(); expect(result.state).to.equal('partial');
    expect(result.manifest).to.include({ sampleRate: 48000, stopReason: 'context-interrupted', terminalAcknowledged: false });
    expect(result.manifest.segments).to.have.length(1);
    f.context.state = 'closed'; for (const listener of [...f.listeners]) listener(); result.artifact.discard();
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('writes a float WAV with exact frame and annotation lengths', () => {
    const layout = createPcmCaptureWavLayout({ sampleRate: 48000, timelineFrames: 33, schema: 'fixture' }), header = new DataView(layout.header.buffer);
    expect(header.getUint16(20, true)).to.equal(3); expect(header.getUint32(44, true)).to.equal(33);
    expect(header.getUint32(52, true)).to.equal(264); expect(header.getUint32(4, true) + 8).to.equal(layout.byteLength);
    expect(layout.suffix.length % 2).to.equal(0);
  });
  it('preserves stereo headroom and owns storage until discarded readers settle', async () => {
    const f = fixture(); await f.owner.start({ seconds: 1 }); const node = f.nodes[0]; node.ready(); node.pcm(); node.end();
    expect(f.owner.state()).to.include({ state: 'ready', frames: 4, capturedFrames: 4, nativeRetirement: 'complete' });
    expect(f.tapRetired).to.equal(1); const artifact = f.owner.state().artifact, lease = artifact.borrow(), stream = lease.openChunks();
    await stream.next(); const pcm = await stream.next(), view = new DataView(pcm.value.buffer);
    expect(view.getFloat32(0, true)).to.equal(1.25); expect(view.getFloat32(4, true)).to.equal(-0.5);
    expect(() => artifact.borrow()).to.throw('already owns');
    artifact.discard(); expect(artifact.metadata().pcmOwnership).to.equal('waiting-for-readers');
    lease.release(); await lease.settlement; await Promise.resolve(); expect(artifact.metadata().pcmOwnership).to.equal('released');
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains actual source time and names gap placeholders as partial evidence', async () => {
    const f = fixture(); await f.owner.start({ seconds: 1 }); const node = f.nodes[0]; node.ready(); node.pcm(2, 4);
    node.end({ lastFrame: 8, capturedFrames: 4, droppedFrames: 4, gaps: [[0, 2, 1], [6, 8, 2]] });
    const result = f.owner.state(); expect(result.state).to.equal('partial'); expect(result.manifest.timelineFrames).to.equal(8);
    expect(result.manifest.gaps.map(gap => gap.reason)).to.deep.equal(['transfer-buffer-pressure', 'missing-input']);
    expect(result.manifest.missingFramePolicy).to.equal('explicit-zero-placeholders-preserve-source-time'); result.artifact.discard();
  });
  it('keeps accepted module loading owned across cancellation without allocating a late graph', async () => {
    let settle; const f = fixture({ addModule: () => new Promise(resolve => { settle = resolve; }) });
    const starting = f.owner.start({ seconds: 1 }), stopping = f.owner.stop();
    expect(f.owner.state().state).to.equal('preparing'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    settle(); await starting; await stopping; expect(f.nodes).to.have.length(0); expect(f.owner.state().state).to.equal('failed');
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('fails admission before any worklet load and never silently reduces the sample rate', async () => {
    const f = fixture(); f.context.sampleRate = 384000;
    try { await f.owner.start(); expect.fail('unsupported capture must reject'); } catch (error) { expect(error.message).to.include('Enable browser audio'); }
    expect(f.nodes).to.have.length(0); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('fences a foreign packet and retains unknown processor storage until context closure', async () => {
    const f = fixture(); await f.owner.start({ seconds: 1 }); const node = f.nodes[0]; node.ready(); node.pcm();
    node.emit({ type: 'stopped', epoch: 'foreign' }); expect(f.owner.state().state).to.equal('partial');
    expect(f.owner.state().unresolvedOwnership).to.equal(true); expect(f.owner.state().manifest.terminalAcknowledged).to.equal(false);
    expect(f.owner.state().resourceAccounting.unreconciledReservations).to.equal(1);
    f.context.state = 'closed'; for (const listener of [...f.listeners]) listener();
    expect(f.owner.state().resourceAccounting.unreconciledReservations).to.equal(0); f.owner.state().artifact.discard();
    expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
});
