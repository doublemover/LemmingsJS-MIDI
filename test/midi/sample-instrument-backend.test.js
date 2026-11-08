import { DECODER_VERSION } from '../../js/app/midi-ui/AudioAssetRef.js';
import { WAVE_SOURCE_DECODER_VERSION } from '../../js/app/midi-ui/WaveSourceProfile.js';
import { expect } from 'chai';
import { BrowserNotePreview } from '../../js/app/midi-ui/browserNotePreview.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { withFakeClock } from '../support/timers.js';
import { singleSampleMap } from '../helpers/sampleMap.js';

class Param {
  constructor() { this.events = []; }
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); }
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
}
class Node {
  constructor() { this.connections = []; this.gain = new Param(); this.pan = new Param(); }
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected = true; this.connections.length = 0; }
}
class Source extends Node {
  constructor() { super(); this.playbackRate = new Param(); this.starts = []; this.stops = []; }
  start(...args) { if (this.starts.length) throw new Error('source-started-twice'); this.starts.push(args); }
  stop(at) { if (!this.starts.length) throw new Error('source-not-started'); this.stops.push(at); }
  finish() { this.onended?.(); }
}
const makeContext = () => ({ state: 'running', sampleRate: 48000, currentTime: 0, destination: {}, sources: [], gains: [],
  createGain() { const node = new Node(); this.gains.push(node); return node; }, createWaveShaper: () => new Node(),
  createStereoPanner: () => new Node(), createBufferSource() { const node = new Source(); this.sources.push(node); return node; },
  createOscillator() { const node = new Source(); node.frequency = new Param(); node.detune = new Param(); this.sources.push(node); return node; },
  resume: async () => {}, close: async () => {} });
const makePin = (hash = 'a'.repeat(64), rate = 48000) => {
  const shared = { pins: 0 }, buffer = { length: rate, numberOfChannels: 1, sampleRate: rate, duration: 1 };
  const ref = Object.freeze({ contentHash: hash, kind: 'sample', bytes: 96044, frames: 44100, sourceSampleRate: 44100, channels: 1 });
  const create = () => {
    shared.pins++; let active = true;
    return Object.freeze({ ref, variant: Object.freeze({ contentHash: hash, targetSampleRate: rate, decoderVersion: DECODER_VERSION }),
      get buffer() { if (!active) throw new Error('released'); return buffer; }, isActive: () => active,
      retain: () => { if (!active) throw new Error('released'); return create(); },
      release: () => { if (!active) return false; active = false; shared.pins--; return true; } });
  };
  return { pin: create(), shared, buffer };
};
const patch = (hash = 'a'.repeat(64), revision = 1, parameters = {}) => ({ status: 'ready',
  patch: { id: 'sample-fixture', revision, engineId: 'native-sample', engineVersion: 1, parameters,
    mix: { gain01: 0.8, pan01: 0 }, voicePolicy: { maxVoices: 16 }, sampleRefs: [{ sha256: hash, bytes: 96044, required: true }] },
  receipt: { patchId: 'sample-fixture', revision } });
const region = (extra = {}) => ({ domain: 'source-frames', assetHash: 'a'.repeat(64), rootCents: 6000,
  onsetFrame: 4410, endFrame: 35280, selectionSeed: 123, ...extra });
const intent = (voiceId = 'A', extra = {}) => ({ version: 1, kind: 'begin', voiceId, generation: 1, onsetId: 'onset:' + voiceId,
  actorId: voiceId, pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.8, expression: {}, ...extra });
const nativePatch = { status: 'ready', patch: { id: 'oscillator', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
  parameters: {}, sampleRefs: [], mix: { gain01: 1, pan01: 0 }, voicePolicy: { maxVoices: 16 } }, receipt: { patchId: 'oscillator', revision: 1 } };

describe('Owned native sample regions', () => {
  const cleanups = [];
  afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
  const setup = async (options = {}, selected = region(), backendOptions = {}) => {
    const context = makeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context, ...options }), session = preview.createSession('sample');
    cleanups.push(() => preview.dispose()); await session.enable();
    let selections = 0;
    const backend = await session.createSampleInstrumentBackend({ resolveRegion: () => { selections++; return selected; }, ...backendOptions }), asset = makePin();
    cleanups.push(() => asset.pin.release()); expect((await backend.prepare(patch(), [asset.pin])).status).to.equal('ready');
    expect(backend.renewExecutionLease(1, 'take', 480000).status).to.equal('accepted');
    return { preview, session, context, backend, asset, selections: () => selections };
  };
  it('uses one sampled control clock for all expression lanes even while currentTime advances', async () => {
    const { backend, context } = await setup(); expect(backend.begin(intent(), 0, 'take').status).to.equal('accepted');
    let clock = 0.01; Object.defineProperty(context, 'currentTime', { configurable: true, get: () => { const value = clock; clock += 0.000001; return value; } });
    const receipt = backend.update('A', { pressure01: 0.4, pan01: 0.3, pitchOffsetCents: 25 }, 481, 'take');
    expect(receipt.status).to.equal('accepted');
    const pressure = context.gains.flatMap(node => node.gain.events).filter(event => event.type === 'ramp' && event.value === 0.4);
    expect(pressure).not.to.have.length(0); Object.defineProperty(context, 'currentTime', { configurable: true, value: clock, writable: true });
  });
  it('forces lane-owner cleanup through an active release child without selecting or starting another release', async () => {
    const { backend, preview, context, selections } = await setup({}, region({ chokeGroup: 'hat', chokeScope: 'kit', releaseRegion: region() }));
    backend.begin(intent(), 4800, 'take'); backend.end('A', { seconds: 0.04 }, 9600, 'take');
    const voice = [...preview._voices][0], child = voice.child.source; expect(child.starts).to.have.length(1); context.currentTime = 0.25;
    expect(backend.end('A', { seconds: 0.005, force: true }, 12000, 'take').status).to.equal('accepted');
    expect(child.starts).to.have.length(1); expect(selections()).to.equal(1); expect(voice.stolen).to.equal(true); expect(voice.end).to.be.closeTo(0.255, 1e-12);
    expect(voice.terminationCause).to.equal('owned-cleanup');
  });
  it('prepares the immutable authored map directly and retains its actual region selection and one-shot duration', async () => {
    const fixture = await setup(), backend = await fixture.session.createSampleInstrumentBackend({ clockMode: 'offline' }), resolution = patch();
    resolution.patch.sampleMap = singleSampleMap(fixture.asset.pin.ref.contentHash, { frames: 44100 });
    resolution.patch.parameters = { attackSeconds: 0.1, decaySeconds: 0.1, sustain01: 0.5 };
    expect((await backend.prepare(resolution, [fixture.asset.pin])).status).to.equal('ready');
    expect(backend.renewExecutionLease(1, 'mapped', 480000).status).to.equal('accepted');
    const accepted = backend.begin(intent('mapped', { worldId: 'world', laneId: 1, sampleKitId: 'drum', sampleGesture: 'center' }), 48000, 'mapped');
    expect(accepted.status).to.equal('accepted'); expect(accepted.region.selection).to.include({ zoneId: 'center-0', alternateIndex: 0 });
    expect(accepted.articulation.oneShotTailSeconds).to.equal(1);
    expect(backend.end('mapped', { seconds: 0.1 }, 50400, 'mapped').status).to.equal('accepted');
    const source = fixture.context.sources.find(source => source.buffer === fixture.asset.buffer), envelope = source.connections[0].gain.events;
    expect(envelope.some(event => event.type === 'ramp' && event.time === 1.05 && event.value > 0)).to.equal(true);
    expect(backend.renderDiagnostics().clockMode).to.equal('offline');
  });
  it('admits an authored same-kit choke at a one-gate limit without exceeding the source budget', async () => {
    const fixture = await setup(), backend = await fixture.session.createSampleInstrumentBackend({ clockMode: 'offline' }), resolution = patch();
    resolution.patch.sampleMap = singleSampleMap(fixture.asset.pin.ref.contentHash, { frames: 44100 }); resolution.patch.voicePolicy.maxVoices = 1;
    expect((await backend.prepare(resolution, [fixture.asset.pin])).status).to.equal('ready'); backend.renewExecutionLease(1, 'mapped', 480000);
    const mapped = id => intent(id, { worldId: 'world', laneId: 0, sampleKitId: 'drum' });
    expect(backend.begin(mapped('A'), 48000, 'mapped').status).to.equal('accepted');
    expect(backend.begin(mapped('B'), 72000, 'mapped').status).to.equal('accepted');
    const voices = backend.renderDiagnostics({ includeVoices: true }).voices;
    expect(voices.find(voice => voice.voiceId === 'A').endFrame).to.equal(Math.ceil(1.505 * 48000));
    expect(voices.find(voice => voice.voiceId === 'B').region.chokeScope).to.equal(voices[0].region.chokeScope);
  });
  it('rejects every mapped source bound during preparation before creating native sample nodes', async () => {
    const fixture = await setup(), backend = await fixture.session.createSampleInstrumentBackend({ clockMode: 'offline' }), resolution = patch();
    resolution.patch.sampleMap = singleSampleMap(fixture.asset.pin.ref.contentHash, { frames: 44101 });
    const pins = fixture.asset.shared.pins, sources = fixture.context.sources.length, rejected = await backend.prepare(resolution, [fixture.asset.pin]);
    expect(rejected.status).to.equal('rejected'); expect(rejected.reason).to.include('actual pinned source');
    expect(fixture.asset.shared.pins).to.equal(pins); expect(fixture.context.sources.length).to.equal(sources);
  });
  it('refuses source-rate PCM cache buffers even when their rate matches the native audio context', async () => {
    const { backend, asset } = await setup();
    const incompatible = { ...asset.pin, variant: { ...asset.pin.variant, decoderVersion: WAVE_SOURCE_DECODER_VERSION } };
    expect((await backend.prepare(patch(), [incompatible])).reason).to.equal('invalid-prepared-sample-pin');
    expect(asset.shared.pins).to.equal(2);
  });
  it('releases every rollback pin once and preserves unknown preparation ownership', async () => {
    const context = makeContext(), preview = new BrowserNotePreview({ createAudioContext: () => context }), session = preview.createSession('pins');
    cleanups.push(() => preview.dispose()); await session.enable();
    const backend = await session.createSampleInstrumentBackend(), first = makePin('a'.repeat(64)), second = makePin('b'.repeat(64));
    const released = [];
    const supplied = [first, second].map((asset, index) => ({ ...asset.pin, retain(options) {
      const pin = asset.pin.retain(options);
      return { ...pin, release() { released.push(index); if (index === 0) throw new Error('pin release failed'); return pin.release(); } };
    } }));
    const invalid = patch('c'.repeat(64));
    const receipt = await backend.prepare(invalid, supplied);
    expect(receipt.status).to.equal('rejected'); expect(released).to.deep.equal([0, 1]);
    expect(receipt.retirement.outcome).to.equal('partial');
    expect((await backend.prepare(patch(), [first.pin])).reason).to.equal('sample-retirement-unknown');
    const disposed = backend.dispose(); expect(disposed.outcome).to.equal('partial'); expect(released).to.deep.equal([0, 1]);
    expect(second.shared.pins).to.equal(1); first.pin.release(); second.pin.release();
  });
  it('keeps the new prepared patch intact when retiring old prepared pins fails', async () => {
    const { backend, asset } = await setup();
    const failing = { ...asset.pin, retain(options) { const pin = asset.pin.retain(options); return { ...pin, release() { throw new Error('old pin cannot retire'); } }; } };
    expect((await backend.prepare(patch('a'.repeat(64), 2), [failing])).status).to.equal('ready');
    const replacement = await backend.prepare(patch('a'.repeat(64), 3), [asset.pin]);
    expect(replacement).to.include({ status: 'ready', patchId: 'sample-fixture', revision: 3 });
    expect(replacement.retirement.outcome).to.equal('partial');
    expect(backend.begin(intent('new-patch'), 480, 'take').status).to.equal('accepted');
    expect(backend.renderDiagnostics().patchRevision).to.equal(3);
    expect((await backend.prepare(patch('a'.repeat(64), 4), [asset.pin])).reason).to.equal('sample-retirement-unknown');
  });
  it('holds a failed native source pin until context closure while retiring its independent sibling', async () => {
    const budget = createResourceBudget(), { backend, preview, context, asset } = await setup({ resourceBudget: budget }, region({ releaseRegion: region() }));
    backend.begin(intent('source-fault'), 480, 'take');
    let attempts = 0; context.sources[0].disconnect = () => { attempts++; throw new Error('source disconnect failed'); };
    const receipt = backend.cancelGenerationWithReceipt(1, 'take');
    expect(receipt.retirement.outcome).to.equal('partial'); expect(receipt.count).to.equal(0); expect(attempts).to.equal(1);
    expect(context.sources[1].disconnected).to.equal(true); expect(asset.shared.pins).to.equal(3);
    expect(preview.getState().retiredVoices).to.equal(1); expect(budget.diagnostics().unreleasedEstimatedBytes).to.be.greaterThan(0);
    context.state = 'closed'; const closed = preview._replaceClosedContext(); await closed.completion;
    expect(attempts).to.equal(1); expect(asset.shared.pins).to.equal(2); expect(preview.getState().retiredVoices).to.equal(0);
    expect(budget.diagnostics().unreleasedEstimatedBytes).to.equal(0);
  });

  it('converts immutable source-frame offsets at the actual decoded rate and preserves fractional pitch', async () => {
    const selected = region({ loop: { mode: 'sustain', startFrame: 8820, endFrame: 26460, crossfadeFrames: 0 } }),
      { backend, preview, context, asset } = await setup({}, selected);
    expect(backend.begin(intent('A', { pitch: { cents: 6000.125, referenceHz: 440 } }), 480, 'take').status).to.equal('accepted');
    const voice = [...preview._voices][0], source = context.sources[0];
    expect(source.buffer).to.equal(asset.buffer); expect(source.starts[0]).to.deep.equal([0.01, 0.1]);
    expect(source.loopStart).to.equal(0.2); expect(source.loopEnd).to.equal(0.6);
    expect(source.playbackRate.events[0].value).to.be.closeTo(2 ** (0.125 / 1200), 1e-12);
    selected.loop.startFrame = 0; selected.onsetFrame = 0;
    expect(voice.region.onsetFrame).to.equal(4410); expect(voice.region.loop.startFrame).to.equal(8820);
    expect(Object.isFrozen(voice.region.loop)).to.equal(true);
    expect(backend.renderDiagnostics({ includeVoices: true }).voices[0]).to.include({ playheadFrame: null, rateEvidence: 'modeled-native-k-rate' });
  });

  for (const engine of ['sample', 'oscillator']) it(`reuses ${engine} execution capacity past 1024 cancellations and rejects retired handles`, async () => {
    const { backend: sample, session, context } = await setup();
    const backend = engine === 'sample' ? sample : session.createInstrumentBackend({ gateMode: 'owned' });
    if (engine === 'oscillator') await backend.prepare(nativePatch);
    let oldest;
    for (let index = 0; index < 1100; index++) {
      const { execution } = backend.registerExecution({ executionEpoch: 'take', generation: 1 }); oldest ??= execution;
      expect(backend.renewExecutionLease(1, execution, 480000).status).to.equal('accepted');
      expect(backend.begin(intent(), 480, execution).status).to.equal('accepted');
      backend.cancelGeneration(1, execution);
      expect(backend.renderDiagnostics().executions).to.include({ active: 0, retiring: 0 });
    }
    expect(backend.begin(intent(), 480, oldest).reason).to.equal('execution-retired');
    expect(backend.renderDiagnostics().executions).to.include({ retired: 1100, peak: 1 });
    expect(context.sources.every(source => source.disconnected)).to.equal(true);
  });

  it('changes pitch and pressure on the existing source without retriggering phase or changing ADSR', async () => {
    const { backend, preview, context, selections } = await setup();
    backend.begin(intent(), 480, 'take'); const voice = [...preview._voices][0], envelope = [...voice.gain.gain.events];
    expect(backend.update('A', { pitchOffsetCents: 1200, pressure01: 0.3 }, 4800, 'take').status).to.equal('accepted');
    expect(backend.update('A', { pitchOffsetCents: -1200, pan01: -0.5 }, 9600, 'take').status).to.equal('accepted');
    expect(context.sources).to.have.length(1); expect(context.sources[0].starts).to.have.length(1); expect(selections()).to.equal(1);
    expect(voice.gain.gain.events).to.deep.equal(envelope); expect(voice.rateAutomation.valueAt(0.25)).to.equal(0.5);
    expect(voice.pressureAutomation.valueAt(0.25)).to.equal(0.3);
  });

  it('keeps duplicate pitch voices and their controls independent across owners', async () => {
    const { backend, preview, session, asset } = await setup(), cue = preview.createSession('cue'); await cue.enable();
    const other = await cue.createSampleInstrumentBackend({ resolveRegion: () => region() });
    await other.prepare(patch(), [asset.pin]); other.renewExecutionLease(1, 'take', 480000);
    backend.begin(intent(), 480, 'take'); other.begin(intent(), 480, 'take');
    backend.update('A', { pressure01: 0.1 }, 4800, 'take'); other.update('A', { pressure01: 0.9 }, 4800, 'take');
    const [a, b] = [...preview._voices]; expect(a.pressureAutomation.valueAt(0.2)).to.equal(0.1); expect(b.pressureAutomation.valueAt(0.2)).to.equal(0.9);
    session.stop(); expect(preview._voices.has(a)).to.equal(false); expect(preview._voices.has(b)).to.equal(true);
    other.dispose(); expect(asset.shared.pins).to.equal(2);
  });

  it('preallocates and pins the release child, starts it once with release velocity, and keeps the logical parent until both end', async () => {
    const selected = region({ loop: { mode: 'forward', startFrame: 4410, endFrame: 17640 }, releaseRegion: region({ onsetFrame: 35280, endFrame: 44100, gain01: 0.5 }) }),
      { backend, preview, context, asset, selections } = await setup({}, selected);
    expect(backend.begin(intent(), 480, 'take')).to.include({ status: 'accepted', renderCost: 2 });
    expect(asset.shared.pins).to.equal(4); expect(context.sources).to.have.length(2); expect(context.sources[1].starts).to.have.length(0);
    const voice = [...preview._voices][0]; backend.update('A', { pitchOffsetCents: 1200 }, 4800, 'take');
    expect(backend.end('A', { seconds: 0.04, velocity01: 0.25 }, 9600, 'take').status).to.equal('accepted');
    expect(context.sources[1].starts[0]).to.deep.equal([0.2, 0.8, 0.2]);
    expect(context.sources[1].playbackRate.events.at(-1)).to.include({ value: 2, time: 0.2 });
    expect(voice.child.gain.gain.events.some(event => event.value === 0.25 * 0.5 * 0.7 * 0.8)).to.equal(true);
    backend.end('A', { seconds: 0.04 }, 10000, 'take'); expect(context.sources[1].starts).to.have.length(1); expect(selections()).to.equal(1);
    context.currentTime = 0.25; context.sources[0].finish(); expect(preview._voices.size).to.equal(1);
    context.currentTime = 0.3; context.sources[1].finish(); expect(preview._voices.size).to.equal(0); expect(asset.shared.pins).to.equal(2);
  });

  it('cancels a release before attack without triggering either source and blocks late generation admissions', async () => {
    const { backend, preview, context, asset } = await setup({}, region({ releaseRegion: region() }));
    backend.begin(intent(), 4800, 'take'); expect(backend.end('A', { seconds: 0.04 }, 2400, 'take').status).to.equal('accepted');
    expect(preview._voices.size).to.equal(0); expect(context.sources[1].starts).to.have.length(0); expect(asset.shared.pins).to.equal(2);
    backend.cancelGeneration(1, 'take'); expect(backend.begin(intent('late'), 4800, 'take').reason).to.equal('generation-cancelled');
    expect(backend.renewExecutionLease(1, 'take', 500000).reason).to.equal('generation-cancelled');
  });

  it('rebuilds a future release child after earlier pitch arrives without starting it again', async () => {
    const { backend, preview, context } = await setup({}, region({ releaseRegion: region({ onsetFrame: 35280, endFrame: 44100 }) }));
    backend.begin(intent(), 480, 'take'); backend.end('A', { seconds: 0.04, velocity01: 0.5 }, 9600, 'take');
    expect(backend.update('A', { pitchOffsetCents: 1200 }, 4800, 'take').status).to.equal('accepted');
    const voice = [...preview._voices][0]; expect(context.sources[1].starts).to.have.length(1);
    expect(context.sources[1].playbackRate.events.at(-1)).to.include({ value: 2, time: 0.2 });
    expect(voice.end).to.be.closeTo(0.3, 1e-12);
  });

  it('reschedules an earlier release child with the same selection and pins while stale source callbacks stay inert', async () => {
    const { backend, preview, context, asset, selections } = await setup({}, region({ releaseRegion: region({ onsetFrame: 35280, endFrame: 44100 }) }));
    backend.begin(intent(), 480, 'take'); backend.end('A', { seconds: 0.04, velocity01: 0.5 }, 9600, 'take');
    const voice = [...preview._voices][0], main = voice.main.source, oldChild = voice.child.source, staleEnd = oldChild.onended, pins = asset.shared.pins;
    expect(backend.end('A', { seconds: 0.04, velocity01: 0.5 }, 4800, 'take').status).to.equal('accepted');
    expect(voice.releaseAt).to.equal(0.1); expect(voice.end).to.be.closeTo(0.3, 1e-12);
    expect(voice.main.source).to.equal(main); expect(main.starts).to.have.length(1);
    expect(oldChild.disconnected).to.equal(true); expect(oldChild.buffer).to.equal(null); expect(voice.child.source).not.to.equal(oldChild);
    expect(voice.child.source.starts).to.have.length(1); expect(voice.child.source.starts[0][0]).to.equal(0.1);
    expect(asset.shared.pins).to.equal(pins); expect(selections()).to.equal(1);
    staleEnd(); expect(voice.child.ended).to.equal(false); expect(preview._voices.has(voice)).to.equal(true);
    expect(backend.end('A', { seconds: 1 }, 7200, 'take').reason).to.equal('already-releasing'); expect(asset.shared.pins).to.equal(pins);
  });

  it('does not extend a release child past its natural tail when forced cleanup arrives near the endpoint', async () => {
    const { backend, preview, context } = await setup({}, region({ releaseRegion: region({ onsetFrame: 35280, endFrame: 44100 }) }));
    backend.begin(intent(), 480, 'take'); backend.end('A', { seconds: 0.04 }, 9600, 'take');
    const voice = [...preview._voices][0], originalEnd = voice.end; context.currentTime = 0.3975;
    expect(backend.end('A', { seconds: 0.005, force: true }, 19080, 'take').status).to.equal('accepted');
    expect(voice.semanticRelease.at).to.equal(0.2); expect(voice.forcedRelease.at).to.equal(0.3975);
    expect(voice.end).to.equal(originalEnd); expect(voice.child.gain.gain.events.at(-1)).to.include({ type: 'ramp', value: 0, time: originalEnd });
  });

  it('replans a future release pitch through its primary end without moving a queued forced cleanup', async () => {
    const { backend, preview, context, selections } = await setup({}, region({ releaseRegion: region({ onsetFrame: 35280, endFrame: 44100 }) }));
    backend.begin(intent(), 480, 'take'); backend.end('A', { seconds: 0.04, velocity01: 0.5 }, 9600, 'take');
    backend.end('A', { seconds: 0.005, force: true }, 14400, 'take');
    const voice = [...preview._voices][0], child = voice.child.source;
    expect(backend.update('A', { pitchOffsetCents: 1200 }, 4800, 'take').status).to.equal('accepted');
    expect(voice.semanticRelease.at).to.equal(0.2); expect(voice.forcedRelease.at).to.equal(0.3);
    expect(voice.child.source).to.equal(child); expect(child.starts).to.have.length(1);
    expect(child.playbackRate.events.at(-1)).to.include({ value: 2, time: 0.2 }); expect(voice.end).to.be.closeTo(0.3, 1e-12);
    expect(context.sources).to.have.length(2); expect(selections()).to.equal(1);
  });

  it('uses the onset offset for an authored pitch range when the base pitch itself lies outside it', async () => {
    const selected = region({ pitchRange: { minCents: 5900, maxCents: 6100 }, releaseRegion: region({ rootCents: 5900 }) }),
      { backend, context } = await setup({}, selected);
    expect(backend.begin(intent('A', { pitch: { cents: 7000, referenceHz: 440 }, expression: { pitchOffsetCents: -1000 } }), 480, 'take').status).to.equal('accepted');
    backend.end('A', { seconds: 0.04 }, 9600, 'take');
    expect(context.sources[1].playbackRate.events.at(-1).value).to.be.closeTo(2 ** (100 / 1200), 1e-12);
  });

  it('cancels all children during a release tail and preserves another owner', async () => {
    const { backend, preview, context, asset } = await setup({}, region({ releaseRegion: region() })), other = preview.createSession('other'); await other.enable();
    const osc = other.createInstrumentBackend(); await osc.prepare(nativePatch); osc.begin(intent('unrelated'), 480);
    backend.begin(intent(), 480, 'take'); backend.end('A', { seconds: 0.2 }, 4800, 'take'); context.currentTime = 0.12;
    expect(backend.cancelGenerationWithReceipt(1, 'take').count).to.equal(1);
    expect(preview._voices.size).to.equal(1); expect(context.sources.slice(1).every(source => source.disconnected && source.buffer == null)).to.equal(true);
    expect(asset.shared.pins).to.equal(2);
  });

  it('pre-admits the release layer against the shared render budget before allocating or choking', async () => {
    const { backend, context, preview } = await setup({ maxVoices: 1 }, region({ chokeGroup: 'hat', releaseRegion: region() }));
    expect(backend.begin(intent(), 480, 'take').reason).to.equal('reserved-interval-capacity'); expect(context.sources).to.have.length(0);
    expect(preview._voices.size).to.equal(0);
  });

  it('retains a committed future sample interval when an earlier oscillator would exceed capacity', async () => {
    const { backend, preview, session } = await setup({ maxVoices: 2 }, region({ releaseRegion: region() }));
    backend.begin(intent(), 4800, 'take'); const oscillator = session.createInstrumentBackend(); await oscillator.prepare(nativePatch);
    expect(oscillator.begin(intent('quiet', { velocity01: 0.01 }), 480).reason).to.equal('reserved-interval-capacity');
    expect(preview._renderVoiceCount()).to.equal(2); expect(backend.renderDiagnostics().activeVoices).to.equal(1);
    expect(preview.getState().voiceSteals).to.equal(0);
  });

  it('fails memory admission before constructing any source and retains the prepared patch pins', async () => {
    const budget = createResourceBudget({ limitBytes: 160000 }), { backend, context, asset } = await setup({ resourceBudget: budget }, region({ releaseRegion: region() }));
    const token = {}; budget.reserve({ token, owner: 'renderer', bytes: Math.floor((160000 - budget.diagnostics().accountedBytes - 4096) / 1.25) });
    expect(backend.begin(intent(), 480, 'take').reason).to.equal('audio-resource-budget'); expect(context.sources).to.have.length(0); expect(asset.shared.pins).to.equal(2);
    budget.release({ token, owner: 'renderer' });
  });

  it('replaces patches transactionally while sounding voices retain the original decoded pins', async () => {
    const { backend, preview, asset } = await setup(); backend.begin(intent(), 480, 'take'); const voice = [...preview._voices][0];
    expect((await backend.prepare(patch('b'.repeat(64), 2), [asset.pin])).reason).to.equal('required-sample-unavailable');
    expect(backend.renderDiagnostics().patchRevision).to.equal(1); expect(asset.shared.pins).to.equal(3);
    expect((await backend.prepare(patch('a'.repeat(64), 2), [asset.pin])).status).to.equal('ready');
    expect(voice.patchRevision).to.equal(1); expect(voice.main.pin.buffer).to.equal(asset.buffer); expect(asset.shared.pins).to.equal(3);
    const pending = backend.prepare(patch('a'.repeat(64), 3), [asset.pin]); preview.stop();
    expect((await pending).reason).to.equal('preparation-cancelled'); expect(backend.renderDiagnostics().patchRevision).to.equal(2);
  });

  it('extends the owner lease without retriggering the source and expires the held loop at the exact scheduled cap', async () => {
    const { backend, preview, context } = await setup({}, region({ loop: { mode: 'sustain', startFrame: 8820, endFrame: 26460 } }));
    backend.begin(intent(), 480, 'take'); expect(backend.renewExecutionLease(1, 'take', 960000).status).to.equal('accepted');
    expect(context.sources[0].starts).to.have.length(1); expect(context.sources[0].stops.at(-1)).to.equal(20);
    context.currentTime = 20; context.sources[0].finish(); expect(preview._voices.size).to.equal(0);
  });

  it('retires an untriggered release child after its one-shot main source and owner lease expire', async () => withFakeClock(async clock => {
    const { backend, preview, context, asset } = await setup({}, region({ releaseRegion: region() }));
    backend.begin(intent(), 480, 'take'); context.currentTime = 0.8; context.sources[0].finish();
    expect(preview._voices.size).to.equal(1); expect(asset.shared.pins).to.equal(4);
    context.currentTime = 10.01; clock.tick(1001);
    expect(preview._voices.size).to.equal(0); expect(asset.shared.pins).to.equal(2); expect(context.sources[1].starts).to.have.length(0);
    await preview.dispose();
  }));

  it('releases every staged component after a source-construction failure', async () => {
    const { backend, preview, context, asset } = await setup({}, region({ releaseRegion: region() }));
    const before = preview.getState().resourceAccounting.reservations, create = context.createBufferSource.bind(context);
    context.createBufferSource = () => { if (context.sources.length) throw new Error('source-construction-failed'); return create(); };
    expect(backend.begin(intent(), 480, 'take').reason).to.equal('source-construction-failed');
    expect(context.sources[0].buffer).to.equal(null); expect(context.sources[0].disconnected).to.equal(true);
    expect(asset.shared.pins).to.equal(2); expect(preview.getState().resourceAccounting.reservations).to.equal(before);
  });

  it('scopes choke groups to the backend and suppresses release attacks on choke or panic', async () => {
    const selected = region({ chokeGroup: 'closed-hat', chokeScope: 'kit-1', releaseRegion: region() }),
      { backend, preview, context, asset } = await setup({}, selected), cue = preview.createSession('cue'); await cue.enable();
    const other = await cue.createSampleInstrumentBackend({ resolveRegion: () => selected }); await other.prepare(patch(), [asset.pin]); other.renewExecutionLease(1, 'take', 480000);
    backend.begin(intent(), 480, 'take'); other.begin(intent('cue'), 480, 'take'); backend.begin(intent('B'), 4800, 'take');
    const [a, b, c] = [...preview._voices]; expect(a.stolen).to.equal(true); expect(b.released).to.equal(false); expect(c.released).to.equal(false);
    expect(context.sources[1].starts).to.have.length(0); preview.panic(); expect(preview._voices.size).to.equal(0);
    expect(context.sources.filter((_, n) => n % 2 === 1).every(source => source.starts.length === 0)).to.equal(true);
  });

  it('replaces a future scheduled release with a choke without cutting the earlier held interval', async () => {
    const { backend, preview, context } = await setup({}, region({ chokeGroup: 'hat', releaseRegion: region() }));
    backend.begin(intent(), 480, 'take'); backend.end('A', { seconds: 0.04 }, 24000, 'take');
    const voice = [...preview._voices][0]; backend.begin(intent('B'), 14400, 'take');
    expect(preview._voices.has(voice)).to.equal(true); expect(voice.releaseAt).to.equal(0.3); expect(voice.end).to.equal(0.305);
    expect(context.sources[0].stops.at(-1)).to.equal(0.305); expect(context.sources[1].stops.at(-1)).to.equal(0.3);
    expect(context.sources[1].starts).to.have.length(1); expect(voice.child.ended).to.equal(true);
  });

  it('rebuilds a future choke chain after canceled strikes and restores the original release without retriggering', async () => {
    const { backend, preview, context } = await setup({}, region({ chokeGroup: 'hat', releaseRegion: region() }));
    for (const generation of [2, 3]) backend.renewExecutionLease(generation, 'take', 480000);
    backend.begin(intent(), 480, 'take'); backend.end('A', { seconds: 0.04 }, 24000, 'take'); const a = [...preview._voices][0];
    backend.begin(intent('B', { generation: 2 }), 14400, 'take'); backend.begin(intent('C', { generation: 3 }), 19200, 'take');
    expect(a.releaseAt).to.equal(0.3); context.currentTime = 0.1;
    backend.cancelGeneration(2, 'take'); expect(a.releaseAt).to.equal(0.4); expect(a.stolen).to.equal(true);
    backend.cancelGeneration(3, 'take'); expect(a.releaseAt).to.equal(0.5); expect(a.stolen).to.equal(false);
    expect(a.main.source.stops.at(-1)).to.equal(0.54); expect(a.child.source.starts).to.have.length(1);
    expect(a.child.source.stops.at(-1)).to.equal(1.2); expect(a.main.source.starts).to.have.length(1);
  });

  it('restores a held same-frame choke loser when its queued winner is canceled before onset', async () => {
    const { backend, preview, context } = await setup({}, region({ chokeGroup: 'hat', loop: { mode: 'forward', startFrame: 8820, endFrame: 17640 } }));
    backend.renewExecutionLease(2, 'take', 480000);
    backend.begin(intent('A'), 4800, 'take'); const a = [...preview._voices][0];
    backend.begin(intent('B', { generation: 2 }), 4800, 'take'); expect(a.end).to.equal(0.1); expect(a.releaseLevel).to.equal(0);
    backend.cancelGeneration(2, 'take'); expect(a.released).to.equal(false); expect(a.main.source.stops.at(-1)).to.equal(10);
    expect(a.main.source.starts).to.have.length(1); expect(context.sources).to.have.length(2);
  });

  it('restores an already running original release curve after a canceled future choke', async () => {
    const { backend, preview, context } = await setup({}, region({ chokeGroup: 'hat', releaseRegion: region() }));
    backend.renewExecutionLease(2, 'take', 480000);
    backend.begin(intent(), 480, 'take'); backend.end('A', { seconds: 0.2 }, 9600, 'take'); const a = [...preview._voices][0];
    context.currentTime = 0.25; backend.begin(intent('B', { generation: 2 }), 14400, 'take');
    context.currentTime = 0.26; backend.cancelGeneration(2, 'take');
    expect(a.releaseAt).to.equal(0.2); expect(a.mainReleaseEnd).to.equal(0.4); expect(a.main.source.stops.at(-1)).to.equal(0.4);
    expect(a.child.source.starts).to.have.length(1); expect(backend.update('A', { pressure01: 1 }, 13000, 'take').reason).to.equal('voice-not-active');
    expect(a.child.gain.gain.events.some(event => event.time === 0.26 && event.value === 0)).to.equal(false);
    expect(a.gain.gain.events.some(event => event.time === 0.26 && event.type === 'ramp' && event.value > 0 && event.value < a.releaseLevel)).to.equal(true);
  });

  it('rejects advanced loops, reverse/scrub, malformed regions and unsupported authored pitch ranges explicitly', async () => {
    for (const [selected, reason] of [[region({ loop: { mode: 'forward', startFrame: 100, endFrame: 1000, crossfadeFrames: 64 } }), 'invalid-sample-loop'],
      [region({ loop: { mode: 'forward', startFrame: 4410, endFrame: 17640, crossfadeFrames: 64 } }), 'crossfade-loop-unsupported'],
      [region({ playbackMode: 'reverse' }), 'unsupported-sample-playback-mode'], [region({ positionDriven: {} }), 'unsupported-sample-playback-mode'],
      [region({ onsetFrame: -1 }), 'invalid-resolved-sample-region'], [region({ pitchRange: { minCents: 6500, maxCents: 7000 } }), 'sample-pitch-out-of-range']]) {
      const { backend, context } = await setup({}, selected); expect(backend.begin(intent(), 480, 'take').reason).to.equal(reason); expect(context.sources).to.have.length(0);
    }
  });
});
