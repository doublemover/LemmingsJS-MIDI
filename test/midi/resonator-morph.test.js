import { expect } from 'chai';
import fs from 'node:fs/promises';
import { analyzeResonatorMorph, createResonatorMorphMap, prepareResonatorMorphMap, evaluateResonatorMorph, validateResonatorMorphEndpoint } from '../../js/midi/content/ResonatorMorph.js';
import { hashData } from '../../js/core/CanonicalData.js';
import { assignBoundedMinimumCosts } from '../../js/core/BoundedMinimumAssignment.js';
import { runBackgroundJobKernel } from '../../js/app/resources/BackgroundJobKernels.js';

const fixture = async () => JSON.parse(await fs.readFile(new URL('../../content/morphs/dry-bright-proof.json', import.meta.url), 'utf8'));
const options = { current: () => true, yieldControl: async () => {} }, rejected = async work => { try { await work(); } catch (error) { return error; } throw new Error('Expected rejection.'); };
const publish = async input => createResonatorMorphMap({ a: input.a, b: input.b, pairs: input.anchors, siteCorrespondence: input.siteCorrespondence, reviewed: true });
describe('reviewed named resonator correspondence (render/listening qualification deferred)', () => {
  it('retains the exact original four/six-mode sources, explicit anchors and two emerging modes', async () => {
    const proof = await fixture(), input = proof.input, before = JSON.stringify(input); expect(await hashData(proof.sources[0])).to.equal(input.a.sourceAssetHash); expect(await hashData(proof.sources[1])).to.equal(input.b.sourceAssetHash);
    const candidate = await analyzeResonatorMorph(input, options); expect(candidate.pairs.map(pair => ({ aId: pair.aId, bId: pair.bId }))).to.deep.equal(input.anchors); expect(candidate.unmatchedAIds).to.deep.equal([]); expect(candidate.unmatchedBIds).to.deep.equal(['bright.mode.5', 'bright.mode.6']); expect(candidate.qualified).to.equal(false); expect(candidate.pairs.every(pair => pair.method === 'authored-anchor')).to.equal(true); expect(JSON.stringify(input)).to.equal(before);
    const map = await publish(input), prepared = await prepareResonatorMorphMap(map, input.a, input.b); expect(prepared.maximumModes).to.equal(6); expect(prepared.continuousRendererQualified).to.equal(false);
    for (const [u, endpoint, sourceKey] of [[0, input.a, 'sourceAId'], [1, input.b, 'sourceBId']]) { const evaluated = evaluateResonatorMorph(prepared, u); for (const mode of endpoint.modes) { const realized = evaluated.modes.find(value => value[sourceKey] === mode.id); for (const key of ['frequencyHz', 't60Seconds', 'excitation', 'pickupLeft', 'pickupRight']) expect(realized[key]).to.equal(mode[key]); } }
  });
  it('preserves named identity and the common signed reference through a 101-point parameter sweep', async () => {
    const { input } = await fixture(), map = await publish(input), prepared = await prepareResonatorMorphMap(map, input.a, input.b), ids = prepared.slots.map(slot => slot.id);
    for (const rate of [44100, 48000, 96000]) for (let step = 0; step <= 100; step++) { const value = evaluateResonatorMorph(prepared, step / 100, rate); expect(value.modes.map(mode => mode.id)).to.deep.equal(ids); expect(value.semanticOnsetsAdded).to.equal(0); expect(value.physicalTimingChanged).to.equal(false); expect(value.modes.every(mode => Number.isFinite(mode.frequencyHz) && mode.frequencyHz > 0 && mode.frequencyHz < rate * 0.4 && mode.t60Seconds > 0)).to.equal(true); for (const role of ['excitation', 'pickupLeft', 'pickupRight']) expect(value.modes.reduce((sum, mode) => sum + Math.abs(mode[role]), 0)).to.be.at.most(1 + 1e-12); }
    expect(evaluateResonatorMorph(prepared, 0.5).modes[0].t60Seconds).to.be.closeTo(Math.sqrt(0.18 * 2.8), 1e-12);
  });
  it('flags close/crossing identities and requires actual review instead of a per-frame frequency sort', async () => {
    const { input } = await fixture(); input.a.modes = input.a.modes.slice(0, 2).map((mode, index) => ({ ...mode, id: 'a.' + index, frequencyHz: 1000 + index * 5 })); input.b.modes = input.b.modes.slice(0, 2).map((mode, index) => ({ ...mode, id: 'b.' + index, frequencyHz: 1005 - index * 5 })); input.anchors = [];
    const candidate = await analyzeResonatorMorph(input, options); expect(candidate.pairs.every(pair => pair.confidence.includes('ambiguous'))).to.equal(true); expect(candidate.pairs.every(pair => pair.alternatives.length === 2)).to.equal(true); expect((await rejected(() => createResonatorMorphMap({ ...input, pairs: [{ aId: 'a.0', bId: 'b.0' }], reviewed: false }))).message).to.include('Review');
    input.anchors = [{ aId: 'a.0', bId: 'b.0' }, { aId: 'a.1', bId: 'b.1' }]; const map = await publish(input), prepared = await prepareResonatorMorphMap(map, input.a, input.b); expect(evaluateResonatorMorph(prepared, 0).modes.map(mode => mode.sourceBId)).to.deep.equal(evaluateResonatorMorph(prepared, 1).modes.map(mode => mode.sourceBId));
  });
  it('reports missing signatures without inventing a playable coupling and labels dual-state blends separately', async () => {
    const { input } = await fixture(); input.anchors = []; input.a.modes[0].excitation = null; const candidate = await analyzeResonatorMorph({ ...input, siteCorrespondence: {} }, options); expect(candidate.pairs.some(pair => pair.metric.missing.length)).to.equal(true); const map = await createResonatorMorphMap({ ...input, pairs: candidate.pairs.map(({ aId, bId }) => ({ aId, bId })), reviewed: true }); expect((await rejected(() => prepareResonatorMorphMap(map, input.a, input.b))).message).to.include('Missing');
    const fresh = (await fixture()).input, blend = await createResonatorMorphMap({ ...fresh, pairs: fresh.anchors, reviewed: true, transitionPolicy: 'prepared-dual-body-blend' }), prepared = await prepareResonatorMorphMap(blend, fresh.a, fresh.b); expect(prepared.meaning).to.include('not-a-mode-morph'); expect(() => evaluateResonatorMorph(prepared, 0.5)).to.throw('blend');
  });
  it('rejects stale endpoints, duplicate anchors, changed maps, invalid bands/weights and fake prepared objects', async () => {
    const { input } = await fixture(), map = await publish(input), changed = structuredClone(input.b); changed.modes[0].frequencyHz++;
    expect((await rejected(() => prepareResonatorMorphMap(map, input.a, changed))).message).to.include('hash changed'); expect((await rejected(() => analyzeResonatorMorph({ ...input, anchors: [input.anchors[0], input.anchors[0]] }, options))).message).to.include('unique'); expect((await rejected(() => prepareResonatorMorphMap({ ...map, unmatchedAIds: ['invented'] }, input.a, input.b))).message).to.include('hash changed');
    for (const change of [body => { body.modes[0].t60Seconds = -1; }, body => { body.modes[0].frequencyHz = 20000; }, body => { body.modes[0].excitation = 1; }, body => { body.modelKind = 'distributed-membrane'; }]) { const body = structuredClone(input.a); change(body); expect(() => validateResonatorMorphEndpoint(body)).to.throw(); }
    const prepared = await prepareResonatorMorphMap(map, input.a, input.b); expect(() => evaluateResonatorMorph({ ...prepared }, 0.5)).to.throw(); expect(() => evaluateResonatorMorph(prepared, NaN)).to.throw(); expect(() => evaluateResonatorMorph(prepared, 0.5, 22050)).to.throw();
  });
  it('uses bounded deterministic global assignment with stable ties and independent unmatched choices', () => { expect([...assignBoundedMinimumCosts(new Float64Array([0.1, 0.2, 0.11, 1.5]), 2, 2)]).to.deep.equal([1, 0]); expect([...assignBoundedMinimumCosts(new Float64Array(6), 2, 3)]).to.deep.equal([0, 1]); expect(() => assignBoundedMinimumCosts(new Float64Array([NaN]), 1, 1)).to.throw(); });
  it('authors the bounded worker computation, cancellation and stale-source fixtures', async () => {
    const { input } = await fixture(), result = await runBackgroundJobKernel('analyze-resonator-morph', input, { current: () => true, estimatedPeakBytes: 16 * 1048576, yieldControl: async () => {} }); expect(result.value.schema).to.equal('lemmings-resonator-morph-candidate/v1'); expect(result.retainedBytes).to.be.greaterThan(0);
    const controller = new AbortController(); controller.abort(); expect((await rejected(() => analyzeResonatorMorph(input, { ...options, signal: controller.signal }))).name).to.equal('AbortError'); expect((await rejected(() => analyzeResonatorMorph(input, { ...options, current: () => false }))).message).to.include('changed');
    const fresh = { ...input, anchors: [] }; let rows = 0; expect((await rejected(() => analyzeResonatorMorph(fresh, { ...options, current: () => rows < 1, onProgress() { rows++; } }))).message).to.include('changed');
  });
});
