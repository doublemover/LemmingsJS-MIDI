import { captureRevoiceLaneRouting, createCausalRenderLaneResolver } from '../../js/app/procgen/workstation/CausalLaneRouting.js';
import { createCrossExcitationRecipe } from '../../js/midi/content/CrossExcitationRecipes.js';
import { expect } from 'chai';
import { createLiveLaneSourceBuses } from '../../js/app/midi-ui/LiveLaneSourceBuses.js';
import { createAudioResourceLeases } from '../../js/app/midi-ui/AudioResourceLeases.js';
import { validateEffectVoiceSelection } from '../../js/midi/content/EffectVoiceSelection.js';
import { createQuarryEcho, scopeQuarryThrowToVoices } from '../../js/midi/content/DubQuarryRack.js';
import { prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';
import { prepareEffectSourceBindings, validateEffectSourceBindings, createEffectSourceSampler, effectVoiceStemMask } from '../../js/app/midi-ui/EffectSourceBindings.js';
import { OwnedSineKernel, OwnedSineProcessor, BEGIN, ENDED, WIDTH, RECEIPT_WIDTH } from '../../js/app/midi-ui/worklet/OwnedSineProcessor.js';

const member = (voiceId, generation = 1) => ({ voiceId, generation });
const node = () => ({ connections: new Set(), gain: { setValueAtTime() {} }, connect(value) { this.connections.add(value); }, disconnect(value) { if (value) this.connections.delete(value); else this.connections.clear(); } });
const reaches = (source, destination, seen = new Set()) => source === destination || !seen.has(source) && (seen.add(source), [...(source.connections || [])].some(next => reaches(next, destination, seen)));
const setup = () => { const context = { createGain: node, state: 'running', sampleRate: 48000, currentTime: 0 }, resources = createAudioResourceLeases(), registry = createLiveLaneSourceBuses({ context, resources, owner: 'selected-owner', generation: 1, isCurrent: () => true }); registry.declare(['same-lane']);
  return { registry, resources, pin: voices => registry.pin({ sourceBusId: 'voices:selected', voiceSelection: voices, inputLayout: 'audioStereo', tap: 'pre-fader' }) }; };

describe('immutable selected-voice source buses', () => {
  it('shares set identity across order, overlaps a lane tap and excludes same-lane unrelated voices', async () => {
    const f = setup(), a = node(), b = node(), unrelated = node(), post = node();
    const releaseA = f.registry.registerVoice({ laneId: 'same-lane', voiceId: 'a', sourceGeneration: 1, pre: a, post }), releaseB = f.registry.registerVoice({ laneId: 'same-lane', voiceId: 'b', sourceGeneration: 1, pre: b, post: node() });
    const releaseOther = f.registry.registerVoice({ laneId: 'same-lane', voiceId: 'other', sourceGeneration: 1, pre: unrelated, post: node() });
    const lane = f.registry.pin({ sourceBusId: 'lane:same-lane', tap: 'pre-fader', inputLayout: 'audioStereo' }), selection = f.pin([member('b'), member('a')]), shared = f.pin([member('a'), member('b')]);
    expect(shared.node).to.equal(selection.node); expect(reaches(a, lane.node)).to.equal(true); expect(reaches(a, selection.node)).to.equal(true); expect(reaches(b, selection.node)).to.equal(true); expect(reaches(unrelated, selection.node)).to.equal(false);
    releaseA(); expect(selection.isActive()).to.equal(true); releaseB(); expect(selection.isActive()).to.equal(false); expect(lane.isActive()).to.equal(true); expect(f.pin([member('a', 2)])).to.equal(null);
    releaseOther(); shared.release(); selection.release(); lane.release(); await f.registry.dispose().completion; expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });
  it('waits for routing acknowledgement and retires a selection when its last admitted producer ends', async () => {
    const f = setup(); let resolve; const known = new Set(['a']), ready = new Promise(yes => { resolve = yes; });
    const release = f.registry.registerRenderer({ hasVoice: value => known.has(value.voiceId), attach: () => ready, detach() {} });
    const pin = f.pin([member('a')]); let settled = false; const confirmation = pin.confirmReady().then(() => { settled = true; }); await Promise.resolve(); expect(settled).to.equal(false);
    resolve(); await confirmation; expect(settled).to.equal(true); known.clear(); f.registry.refreshSources(); expect(pin.isActive()).to.equal(false);
    pin.release(); release(); await f.registry.dispose().completion; expect(f.resources.diagnostics().reservations).to.equal(0); await f.resources.dispose().completion;
  });
  it('rejects duplicate members, pitch aliases and missing generations before source allocation', () => {
    expect(() => validateEffectVoiceSelection([member('a'), member('a')])).to.throw(); expect(() => validateEffectVoiceSelection([{ note: 60, generation: 1 }])).to.throw(); expect(() => validateEffectVoiceSelection([{ voiceId: 'a' }])).to.throw();
  });
  it('keeps owner dry while scoping only the throw send and samples the actual selected stem', () => {
    const graph = scopeQuarryThrowToVoices(createQuarryEcho({ send01: 0.3 }), [member('a')]), plan = prepareEffectGraphRevision(graph), bindings = prepareEffectSourceBindings(plan, ['0'], [member('a'), member('b')]);
    expect(graph.edges.some(edge => edge.from.nodeId === 'source' && edge.to.nodeId === 'dry')).to.equal(true); expect(graph.edges.some(edge => edge.from.nodeId === 'throw-source' && edge.to.nodeId === 'send')).to.equal(true); expect(graph.edges.some(edge => edge.from.nodeId === 'source' && edge.to.nodeId === 'send')).to.equal(false);
    const capture = ['0', bindings.voiceSelections[0].stemId], channels = [[new Float32Array([0.8]), new Float32Array([0.8])], [new Float32Array([0.2]), new Float32Array([-0.2])]], sampler = createEffectSourceSampler(bindings, capture, channels);
    expect(effectVoiceStemMask(bindings, { laneId: '0', begin: member('a') }, capture)).to.equal(3); expect(effectVoiceStemMask(bindings, { laneId: '0', begin: member('b') }, capture)).to.equal(1);
    expect(sampler.fill(0.8, 0.8, 0)[0]).to.be.closeTo(0.2, 1e-7); expect(validateEffectSourceBindings(plan, bindings)).to.deep.equal(bindings);
    const missing = prepareEffectSourceBindings(plan, ['0'], [member('a', 2)]); expect(missing.routes[0].available).to.equal(false);
  });
});

describe('overlapping token-fenced source masks in the production kernel', () => {
  for (const rate of [44100, 48000, 96000]) it('renders once while supplying overlapping pre/post selections at ' + rate, () => {
    const kernel = new OwnedSineKernel(rate, 2), reference = new OwnedSineKernel(rate, 2), packet = new Float64Array(WIDTH * 2);
    packet.set([1, 0, 1, BEGIN, 0, 9, 440, 0.5, 1, 0, 1, 0, 1, 100, 1.25, 0, rate, 1]); packet.set([1, 0, 2, BEGIN, 1, 10, 660, 0.25, 1, 0, 1, 0, 1, 100, 2, 0, rate, 1], WIDTH);
    kernel.accept(packet, 2, 1); reference.accept(packet, 2, 1);
    const channels = Array.from({ length: 3 }, () => [new Float32Array(128), new Float32Array(128)]), preChannels = channels.map(() => [new Float32Array(128), new Float32Array(128)]), left = new Float32Array(128), right = new Float32Array(128), dryLeft = new Float32Array(128), dryRight = new Float32Array(128);
    kernel.render(left, right, 0, { routeMode: 'mask', routes: new Uint16Array([3, 4]), tokens: new Uint32Array([9, 10]), channels, preChannels }); reference.render(dryLeft, dryRight, 0);
    let error = 0; for (let frame = 0; frame < 128; frame++) error = Math.max(error, Math.abs(channels[0][0][frame] - channels[1][0][frame]), Math.abs(channels[0][0][frame] + channels[2][0][frame] - left[frame]), Math.abs(preChannels[0][0][frame] * 0.25 - channels[0][0][frame]));
    expect(error).to.be.lessThan(1e-6); expect(left).to.deep.equal(dryLeft); expect(right).to.deep.equal(dryRight); expect(kernel.counters).to.deep.equal(reference.counters);
  });
  it('clears ended voice routes without disabling a bus or clearing the next slot token', () => {
    const processor = Object.create(OwnedSineProcessor.prototype); processor.kernel = new OwnedSineKernel(48000, 1); processor.laneTaps = { routes: new Uint16Array([3]), tokens: new Uint32Array([10]) }; processor.laneRouteCount = 1;
    processor.message = { count: 0, data: new Float64Array(64 * RECEIPT_WIDTH) }; processor.port = { postMessage() {} };
    processor.kernel.receipt(ENDED, 1, 0, 9, 100); processor.flushReceipts(); expect(processor.laneRouteCount).to.equal(1);
    processor.kernel.receipt(ENDED, 2, 0, 10, 101); processor.flushReceipts(); expect(processor.laneRouteCount).to.equal(1); expect(processor.laneTaps.routes[0]).to.equal(0);
  });
});


describe('captured lane identity across live and offline sources', () => {
  const lane = (id, sourceIndex) => ({ id, sourceIndex, controls: {}, physicalSourceKinds: [] });
  it('uses recorded routing changes at onset without guessing stable IDs from lane numbers', () => {
    const intents = [{ laneId: 0 }, { laneId: 1 }, { laneId: 0 }], initial = { version: 1, lanes: [lane('donor', 0), lane('carrier', 1)] };
    const records = [{ kind: 'musical-intents', payload: { intents: intents.slice(0, 2) } }, { kind: 'input-observation', payload: { kind: 'instrument-performance', change: { version: 1, removed: [], upserts: [lane('carrier', 0), lane('donor', 1)] } } }, { kind: 'musical-intents', payload: { intents: intents.slice(2) } }];
    const routing = captureRevoiceLaneRouting(records, initial, true), revoice = { intents, laneRouting: routing }, resolve = createCausalRenderLaneResolver(revoice);
    const ids = intents.map((intent, index) => resolve(intent, index)); expect(ids).to.deep.equal(['donor', 'carrier', 'carrier']); expect(intents).to.deep.equal([{ laneId: 0 }, { laneId: 1 }, { laneId: 0 }]);
    const plan = prepareEffectGraphRevision(createCrossExcitationRecipe({ recipe: 'rust-bloom', donorLaneId: 'donor', carrierLaneId: 'carrier' }).graph);
    expect(prepareEffectSourceBindings(plan, [...new Set(ids)]).routes.every(route => route.available)).to.equal(true);
    expect(prepareEffectSourceBindings(plan, ['0', '1']).routes.every(route => !route.available)).to.equal(true);
  });
  it('rejects incomplete routing, duplicate source indices and unbound onsets while preserving legacy numeric takes', () => {
    const intents = [{ laneId: 0 }], routing = captureRevoiceLaneRouting([], { version: 1, lanes: [lane('actual', 0)] }, true);
    expect(() => createCausalRenderLaneResolver({ intents, laneRouting: { ...routing, covered: false } })).to.throw();
    expect(() => createCausalRenderLaneResolver({ intents, laneRouting: { ...routing, initial: [{ id: 'a', sourceIndex: 0 }, { id: 'b', sourceIndex: 0 }] } })).to.throw();
    expect(() => createCausalRenderLaneResolver({ intents, laneRouting: routing })({ laneId: 1 }, 0)).to.throw();
    expect(createCausalRenderLaneResolver({ intents })(intents[0], 0)).to.equal('0');
  });
});
