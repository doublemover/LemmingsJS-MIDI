import { expect } from 'chai';
import { ProcgenActorEffectDisplay } from '../js/app/procgen/ProcgenActorEffectDisplay.js';
import { normalizeActorEffectVisualProfile, createActorEffectVisualPreset } from '../js/app/procgen/ActorEffectVisualProfile.js';
import { connectProcgenActorEffectSource } from '../js/app/procgen/ProcgenActorEffectSource.js';
import { ProcgenActorEffectPass } from '../js/app/procgen/ProcgenActorEffectPass.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { ProcgenRenderResources } from '../js/app/procgen/ProcgenRenderResources.js';
import { Lemming } from '../js/lemmings/Lemming.js';

const epoch = { worldId: 'world', generation: 1, executionEpoch: 2, graphRevision: 3, routeRevision: 4 };
const correlation = { executionEpoch: 2, audioFrame: 48000, presentationMs: 100, sampleRate: 48000 };
const sample = (patch = {}) => ({ version: 1, ...epoch, actorId: 2, owner: { kind: 'actor', actorId: 2 }, voiceId: 'voice2', onsetId: 'onset2', effectId: 'fx1', effectRevision: 1,
  quantity: 'pitch-modulation', value: 1, units: 'normalized-signed', evidenceClass: 'measured', muted: false, coverage: 'complete', appliedAudioFrame: 48000, window: { firstFrame: 47900, lastFrame: 48000 }, ...patch });
const managerFixture = (options = {}) => { const display = new ProcgenActorEffectDisplay(options); display.setEpoch(epoch); display.setProfile({ ...createActorEffectVisualPreset('pitch-shimmer', 'fx1'), intensity: 1, smoothingMs: 0 }); return display; };

const drawFixture = () => {
  const calls = [], canvases = [], document = { createElement() {
    const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData(image) { this.upload = image.data.slice(); },
      drawImage(...args) { calls.push({ args, alpha: this.globalAlpha }); }, fillRect(...args) { calls.push({ anchor: args }); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
    const canvas = { width: 0, height: 0, getContext: () => context }; canvases.push(canvas); return canvas;
  } };
  const resources = new ProcgenRenderResources(document), renderer = Object.create(ProcgenLaneRenderer.prototype);
  Object.assign(renderer, { resources, window: { devicePixelRatio: 1 }, canvas: { width: 400, height: 200, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }) },
    rasterStep: 1, scale: 2, originX: 0, originY: 0, viewWidth: 200, viewHeight: 100, presentationDpr: 1, frames: new WeakMap(), buffer: { width: 200, height: 100 },
    bufferContext: document.createElement().getContext(), effectVisibleActors: new Set(), _effectActor: null, _effectPresentationMs: 100, actorEffects: managerFixture({ budget: resources }) });
  renderer.actorEffectPass = new ProcgenActorEffectPass(renderer);
  const frame = (width, height, offsetX, offsetY) => { const data = new Uint8ClampedArray(width * height * 4).fill(255), mask = new Uint8Array(width * height).fill(1); mask[Math.floor(height / 2) * width + Math.floor(width / 2)] = 0;
    return { width, height, offsetX, offsetY, getData: () => data, getMask: () => mask }; };
  const body = frame(10, 12, -5, -12), countdown = frame(4, 4, 0, -20), actor = new Lemming(50, 40, 2);
  actor.action = { draw: graphics => graphics.drawFrame(body, actor.x, actor.y) }; actor.countdownAction = { draw: graphics => graphics.drawFrame(countdown, actor.x, actor.y) };
  return { renderer, actor, body, countdown, calls, canvases, dispose() { renderer.actorEffects.dispose(); renderer.actorEffectPass.dispose(); resources.dispose(); } };
};

describe('actor effect evidence and profiles', () => {
  it('keeps equal sequence values from independent voices and names the bounded reduction', () => {
    const display = managerFixture();
    expect(display.ingest(sample({ voiceId: 'a', onsetId: 'a', sequence: 1, value: 0.25 }), correlation)).to.equal(true);
    expect(display.ingest(sample({ voiceId: 'b', onsetId: 'b', sequence: 1, value: 0.75 }), correlation)).to.equal(true);
    const result = display.evaluate(2, 100); expect(result.x).to.equal(2.25);
    expect(result.sources[0]).to.include({ voiceId: 'b', contributors: 2, reduction: 'maximum-magnitude-qualified-voice' }); display.dispose();
  });

  it('requires complete stable owner/epoch/source identity and correlated applied frame windows', () => {
    const display = managerFixture();
    for (const patch of [{ generation: 9 }, { executionEpoch: 1 }, { graphRevision: 9 }, { routeRevision: 9 }, { owner: { kind: 'actor', actorId: 8 } }, { voiceId: '' }, { appliedAudioFrame: null }, { window: { firstFrame: 49000, lastFrame: 48000 } }, { units: {} }]) expect(display.ingest(sample(patch), correlation)).to.equal(false);
    expect(display.ingest(sample(), null)).to.equal(false); expect(display.ingest(sample(), correlation)).to.equal(true); expect(display.evaluate(2, 100).x).to.equal(3);
    expect(display.evaluate(9, 100).x).to.equal(0); display.dispose();
  });
  it('consumes the proposed AudioDisplaySample quantities with exact session and context correlation', () => {
    const display = managerFixture(); display.setEpoch({ ...epoch, contextEpoch: 7, executionEpoch: 'live/2', owner: 'game#42' });
    const value = { ...epoch, contextEpoch: 7, executionEpoch: 'live/2', owner: 'game#42', scope: 'actorVoice', actorId: 2, onsetId: 'o2', voiceId: 'v2', nodeId: 'fx1', sequence: 1,
      appliedFrame: 48000, windowStartFrame: 47900, windowEndFrame: 48000, validUntilFrame: 52800,
      quantities: [{ name: 'pitch-modulation', unit: 'normalized-signed', value: 1, evidenceClass: 'kernel-state' }], coverage: 'complete', processingState: {}, routeState: { muted: false } };
    const clock = { ...correlation, contextEpoch: 7, executionEpoch: 'live/2', uncertaintyMs: 2 };
    expect(display.ingestAudioDisplaySample(value, clock)).to.equal(true); expect(display.evaluate(2, 100).x).to.equal(3);
    expect(display.ingestAudioDisplaySample(value, clock)).to.equal(false);
    for (const patch of [{ owner: 'game#43' }, { scope: 'bus' }, { executionEpoch: 'old' }, { worldId: 'old-world' }, { validUntilFrame: 1 }]) expect(display.ingestAudioDisplaySample({ ...value, ...patch }, clock)).to.equal(false);
    expect(display.ingestAudioDisplaySample({ ...value, sequence: 2 }, { ...clock, uncertaintyMs: 100 })).to.equal(false);
    expect(display.evaluate(2, 201).x).to.equal(0); display.dispose();
  });
  it('preserves unknown output mute and window-peak detector evidence without claiming audible motion', () => {
    const display = managerFixture(); display.setProfile({ version: 1, enabled: true, intensity: 1, smoothingMs: 0, bindings: [{ effectId: 'fx1', quantity: 'amplitude-envelope', channel: 'scale' }] });
    display.ingest(sample({ quantity: 'amplitude-envelope', value: 0.8, units: 'normalized', muted: null, tap: 'pre-owner-bus', detectorDelayFrames: 128 }), correlation);
    const value = display.evaluate(2, 100); expect(value).to.include({ scale: 1, state: 'route-unknown' }); expect(value.sources[0]).to.include({ routeMuted: null, tap: 'pre-owner-bus', detectorDelayFrames: 128, windowLastFrame: 48000 }); display.dispose();
  });
  it('does not copy shared bus energy into actors or animate requested/configured/rejected parameters', () => {
    const display = managerFixture(); expect(display.ingest(sample({ owner: { kind: 'bus', id: 'reverb' } }), correlation)).to.equal(false);
    expect(display.getDiagnostics().aggregateSamples).to.equal(1);
    for (const patch of [{ pending: true }, { rejected: true }, { muted: true }, { bypassed: true }, { coverage: 'partial' }, { evidenceClass: 'applied-parameter' }]) {
      display.ingest(sample(patch), correlation); expect(display.evaluate(2, 100).x).to.equal(0);
    }
    display.ingest(sample({ evidenceClass: 'configured-parameter', presentationMs: 100 }), null);
    expect(display.evaluate(2, 100)).to.include({ x: 0, scale: 1, state: 'configured' }); display.dispose();
  });
  it('keeps zero-energy, measured modulation, bypassed tails and admitted onsets distinct', () => {
    const display = managerFixture(); display.setProfile({ version: 1, enabled: true, intensity: 1, smoothingMs: 0, bindings: [{ effectId: 'fx1', quantity: 'amplitude-envelope', channel: 'scale' }] });
    display.ingest(sample({ quantity: 'amplitude-envelope', value: 0, units: 'normalized' }), correlation);
    expect(display.evaluate(2, 100)).to.include({ scale: 1, state: 'applied' });
    display.ingest(sample({ quantity: 'amplitude-envelope', value: 0.8, units: 'normalized', evidenceClass: 'admitted-onset' }), correlation);
    expect(display.evaluate(2, 100).scale).to.be.closeTo(1.064, 1e-12);
    display.ingest(sample({ quantity: 'amplitude-envelope', value: 1, units: 'normalized', bypassed: true, tail: true }), correlation);
    expect(display.evaluate(2, 100)).to.include({ scale: 1.08, state: 'tail' }); display.dispose();
  });
  it('coalesces late samples, bounds future windows and fades stale evidence without an oscillator', () => {
    const display = managerFixture(); display.ingest(sample(), correlation);
    expect(display.evaluate(2, 100).x).to.equal(3); expect(display.evaluate(2, 200).x).to.equal(3);
    expect(display.evaluate(2, 290).x).to.be.closeTo(1.5, 1e-12); expect(display.evaluate(2, 380).x).to.equal(0);
    expect(display.ingest(sample({ window: { firstFrame: 47000, lastFrame: 47001 }, appliedAudioFrame: 47000 }), correlation)).to.equal(false);
    expect(display.ingest(sample({ window: { firstFrame: 48000, lastFrame: 96000 } }), correlation)).to.equal(false);
    expect(display.frameKey(2000)).to.include('quiet'); expect(display.getDiagnostics().actors).to.equal(0); display.dispose();
  });
  it('caps combined channels and substitutes static accents for reduced motion and dense LOD', () => {
    const display = managerFixture(); display.setProfile({ version: 1, enabled: true, intensity: 1, smoothingMs: 0, bindings: [
      { channel: 'x', quantity: 'pitch-modulation', effectId: 'fx1', gain: 4 }, { channel: 'x', quantity: 'pitch-modulation', effectId: 'fx1', gain: 4 },
      { channel: 'inner', quantity: 'pitch-modulation', effectId: 'fx1' } ] });
    display.ingest(sample(), correlation); expect(display.evaluate(2, 100).x).to.equal(3);
    expect(display.evaluate(2, 100, { reducedMotion: true })).to.include({ x: 0, y: 0, scale: 1, inner: 0.5 });
    expect(display.evaluate(2, 100, { dense: true }).x).to.equal(0); display.dispose();
  });
  it('retains only evidenced tap positions and clears only the removed actor', () => {
    const display = managerFixture(); display.setProfile({ ...createActorEffectVisualPreset('dub-wake', 'fx1'), intensity: 1, smoothingMs: 0 });
    for (let tap = 0; tap < 6; tap++) display.ingest(sample({ quantity: 'delay-tap-envelope', units: 'normalized', tapId: `tap${tap}`, sourcePosition: { x: tap * 10, y: 40 }, window: { firstFrame: 48000, lastFrame: 48000 + tap * 480 } }), correlation);
    const value = display.evaluate(2, 150); expect(value.trails.length).to.equal(3); expect(value.trails.map(tap => tap.x)).to.deep.equal([30, 40, 50]);
    display.ingest(sample({ actorId: 9, owner: { kind: 'actor', actorId: 9 }, voiceId: 'voice9', onsetId: 'onset9' }), correlation);
    display.removeActor(2); expect(display.getDiagnostics().actors).to.equal(1); expect(display.evaluate(9, 150).trails.length).to.equal(0); display.dispose();
  });
  it('bounds mailboxes and source slots with accounted retirement and immutable profile persistence', () => {
    const reservations = new Map(), display = managerFixture({ maxActors: 2, budget: { retain: (key, bytes) => reservations.set(key, bytes), release: key => reservations.delete(key) } });
    for (let id = 1; id <= 3; id++) display.ingest(sample({ actorId: id, owner: { kind: 'actor', actorId: id }, voiceId: `v${id}`, onsetId: `o${id}` }), correlation);
    expect(display.getDiagnostics()).to.include({ actors: 2, estimatedHistoryBytes: 131072 }); expect(reservations.size).to.equal(3);
    for (let source = 0; source < 20; source++) display.ingest(sample({ effectId: `fx${source}` }), correlation);
    expect(display.mailboxes.get(2).sources.size).to.equal(12);
    display.setProfile({ version: 1, enabled: true, bindings: [] }, { actorId: 2 }); const config = display.getConfiguration(); expect(Object.isFrozen(config.actors[0])).to.equal(true);
    const restored = managerFixture(); restored.restoreConfiguration(JSON.parse(JSON.stringify(config))); expect(restored.getProfile(2).enabled).to.equal(true);
    restored.setEpoch({ ...epoch, generation: 2 }); restored.restoreConfiguration(JSON.parse(JSON.stringify(config))); expect(restored.actorProfiles.size).to.equal(0);
    display.dispose(); restored.dispose(); expect(reservations.size).to.equal(0);
  });
  it('revokes only its read-only source lease on hidden state and ignores late callbacks', () => {
    const display = managerFixture(), identity = { ...epoch, executionEpoch: 'live/2', contextEpoch: 7 }, renderer = { actorEffects: display, world: { worldId: 'world', generation: 1 } };
    let receive, releases = 0;
    const backend = { observeDisplaySamples(listener, options) { receive = listener; expect(options.maxVoices).to.equal(32); expect(options.rateHz).to.equal(30); return () => releases++; } };
    const release = connectProcgenActorEffectSource({ renderer, backend, owner: 'game#42', identity, getCorrelation: () => ({ ...correlation, executionEpoch: 'live/2', contextEpoch: 7, uncertaintyMs: 1 }), maxVoices: 999, rateHz: 999 });
    display.setVisible(false); expect(releases).to.equal(1); release(); release(); expect(releases).to.equal(1);
    receive({}); expect(display.getDiagnostics().actors).to.equal(0); display.dispose(); expect(releases).to.equal(1);
  });
  it('gives deliberate actor overrides precedence over patch and global authored profiles', () => {
    const display = managerFixture(); display.setProfile({ version: 1, name: 'Patch', bindings: [] }, { patchId: 'patch' });
    display.setProfile({ version: 1, name: 'Actor', bindings: [] }, { actorId: 2 });
    expect(display.getProfile(2, 'patch').name).to.equal('Actor'); expect(display.getProfile(9, 'patch').name).to.equal('Patch');
    const normalized = normalizeActorEffectVisualProfile({ version: 1, intensity: 99, bindings: [{ effectId: 'fx1', channel: 'x', quantity: 'drive-amount' }] });
    expect(normalized.intensity).to.equal(1); expect(normalized.bindings.length).to.equal(0); display.dispose();
  });
});

describe('actual Lemming action effect scope and picking', () => {
  it('displaces only the action art, preserves countdown coordinates, shared pixels and actual getClickDistance', () => {
    const f = drawFixture(), before = f.body.getData().slice(), distances = [45, 50, 55, 60].map(x => f.actor.getClickDistance(x, 35));
    f.renderer.actorEffects.ingest(sample(), correlation); f.actor.render(f.renderer);
    const draws = f.calls.filter(call => call.args);
    expect(draws[0].args.slice(1)).to.deep.equal([50, 20, 4, 4]);
    expect(draws.some(call => call.args[1] === 46.5 && call.args[2] === 28 && call.args[3] === 10)).to.equal(true);
    expect(f.calls.some(call => call.anchor)).to.equal(true); expect(f.renderer._effectActor).to.equal(null);
    expect([45, 50, 55, 60].map(x => f.actor.getClickDistance(x, 35))).to.deep.equal(distances);
    expect(f.actor.x).to.equal(50); expect(f.actor.y).to.equal(40); expect(f.body.getData()).to.deep.equal(before); expect(f.renderer.bufferContext.globalAlpha).to.equal(1); f.dispose();
  });
  it('restores scope after action failure and leaves an unsampled same-pitch actor at its true position', () => {
    const f = drawFixture(); f.renderer.actorEffects.ingest(sample(), correlation);
    const other = new Lemming(50, 40, 9); other.action = { draw: graphics => graphics.drawFrame(f.body, 50, 40) }; other.render(f.renderer);
    expect(f.calls.filter(call => call.args).at(-1).args.slice(1)).to.deep.equal([45, 28, 10, 12]);
    f.actor.action.draw = () => { throw new Error('Injected action draw failure'); }; expect(() => f.actor.render(f.renderer)).to.throw('Injected'); expect(f.renderer._effectActor).to.equal(null); f.dispose();
  });
  it('anchors recorded tap ghosts in world space while the camera pans', () => {
    const f = drawFixture(); f.renderer.actorEffects.setProfile({ ...createActorEffectVisualPreset('dub-wake', 'fx1'), intensity: 1, smoothingMs: 0 });
    f.renderer.actorEffects.ingest(sample({ quantity: 'delay-tap-envelope', units: 'normalized', tapId: 'tap1', sourcePosition: { x: 30, y: 40 } }), correlation);
    f.actor.render(f.renderer); const first = f.calls.find(call => call.args && call.alpha < 1).args[1];
    f.calls.length = 0; f.renderer.originX = 10; f.actor.render(f.renderer); const second = f.calls.find(call => call.args && call.alpha < 1).args[1];
    expect(first - second).to.equal(10); expect(f.renderer.actorEffects.mailboxes.get(2).trails[0].sourcePosition.x).to.equal(30); f.dispose();
  });
  it('builds silhouette edge caches without filling transparent holes or changing sprite pixels', () => {
    const f = drawFixture(); f.renderer.actorEffects.ingest(sample(), correlation); f.actor.render(f.renderer);
    const outline = f.renderer.actorEffectPass.outlines.get(f.body).get('inner'), upload = outline.getContext().upload;
    const hole = Math.floor(f.body.height / 2) * f.body.width + Math.floor(f.body.width / 2);
    expect(upload[hole * 4 + 3]).to.equal(0); expect(upload[(hole - 1) * 4 + 3]).to.equal(255);
    const pixels = f.renderer.actorEffectPass.maskPixels; f.actor.render(f.renderer); expect(f.renderer.actorEffectPass.maskPixels).to.equal(pixels); f.dispose();
  });
});
