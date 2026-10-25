import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { hashData } from '../../js/core/CanonicalData.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { planCausalSourceRender, renderCausalOwnedTake } from '../../js/app/midi-ui/CausalOwnedRender.js';
import { createSoundQualificationPlan, createAuthoredNoteQualificationFixture } from '../../js/midi/qualification/SoundQualificationPlan.js';
import { measureSoundRender, compareSoundFeatures, matchSoundLevels } from '../../js/midi/qualification/SoundRenderAnalysis.js';
import { runSoundQualification } from '../../js/midi/qualification/SoundQualificationRunner.js';
import { decodeQualificationFloatWav } from '../../js/midi/qualification/SharedSoundQualificationRenderer.js';
import { findNearDuplicateSounds, recordSoundListeningReview } from '../../js/midi/qualification/SoundListeningReview.js';
const sine = (gain = 0.1, phase = 0) => Float32Array.from({ length: 4800 }, (_, i) => gain * Math.sin(2 * Math.PI * 440 * i / 48000 + phase));
const fixture = async () => {
  const source = JSON.parse(await readFile(new URL('../../content/sounds/plucked-garden.json', import.meta.url), 'utf8'));
  const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-pluck', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
  const compiled = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) }), patch = compiled.prepared.patches[0];
  return createSoundQualificationPlan({ definition: patch.archivedDefinition, descriptor: descriptors[0], applicationBuildId: 'b'.repeat(64), sampleRates: [48000], includeMacroGrid: true,
    source: { packId: compiled.prepared.pack.id, packVersion: compiled.prepared.pack.version, patchIdentity: patch.definition.id + '@' + patch.definition.revision,
      contentHash: compiled.prepared.contentHash, definitionHash: patch.definitionHash, attribution: compiled.prepared.pack.attribution } });
};
const reportWith = async (metrics, source = 'first') => {
  const value = { schema: 'lemmings-sound-qualification-report/v1', source, results: [{ case: { id: 'case:0', role: 'baseline', fixtureHash: 'c'.repeat(64), sampleRate: 48000 },
    state: 'listening-pending', artifact: { path: 'case-0.wav', sha256: 'd'.repeat(64), bytes: 100 }, digitalReceipt: { state: 'technically-valid', metrics } }] };
  return { ...value, reportHash: await hashData(value) };
};
describe('source-bound sound qualification tooling (runtime qualification deferred)', () => {
  it('measures finite PCM and flags identical/gain-only sounds without interpreting similarity as quality', async () => {
    const a = measureSoundRender([sine(), sine()], 48000, { fundamentalHz: 440 }), b = measureSoundRender([sine(0.4), sine(0.4)], 48000, { fundamentalHz: 440 });
    expect(a.nonfiniteSamples).to.equal(0); expect(a.rms).to.be.closeTo(0.1 / Math.sqrt(2), 1e-6); expect(a.spectralCentroidHz).to.be.closeTo(440, 30);
    expect(compareSoundFeatures(a, b).nearDuplicate).to.equal(true); expect(compareSoundFeatures(a, b).levelDifferenceDb).to.be.closeTo(-12.0412, 1e-3);
    const matched = matchSoundLevels(a, b); expect(matched.gainA * a.rms).to.equal(matched.gainB * b.rms);
    const swapped = await findNearDuplicateSounds([await reportWith(a), await reportWith(a, 'identical-copy')]); expect(swapped.pairs).to.have.length(1); expect(swapped.automaticRejection).to.equal(false);
  });
  it('does not erase anti-phase stereo or admit silence/nonfinite samples as a passing duplicate', () => {
    const wave = sine(), anti = Float32Array.from(wave, value => -value), measured = measureSoundRender([wave, anti], 48000, { fundamentalHz: 440 });
    expect(measured.spectralCentroidHz).to.be.closeTo(440, 30);
    const silence = measureSoundRender([new Float32Array(4800), new Float32Array(4800)], 48000); expect(compareSoundFeatures(silence, measured).status).to.equal('unsupported');
    wave[5] = NaN; anti[7] = Infinity; const failed = measureSoundRender([wave, anti], 48000); expect(failed.nonfiniteSamples).to.equal(2); expect(Number.isFinite(failed.peak)).to.equal(true);
  });
  it('enumerates all note/velocity/release combinations, actual macro endpoints, finite paired grids and negative/Panic/repeat cases', async () => {
    const plan = await fixture(), baseline = plan.cases.filter(value => value.role === 'baseline'); expect(baseline).to.have.length(18);
    expect(plan.coverage.missingPhysicalDensities).to.deep.equal(['sparse', 'medium', 'dense']);
    expect(plan.cases.filter(value => value.role === 'macro-endpoint')).to.have.length(plan.definition.macros.length * 3);
    expect(plan.cases.filter(value => value.role === 'paired-macro-grid')).to.have.length(plan.definition.macros.length * (plan.definition.macros.length - 1) / 2 * 25);
    expect(plan.cases.some(value => value.role === 'negative-voice-budget')).to.equal(true); expect(plan.cases.some(value => value.role === 'negative-unsupported-control')).to.equal(true); expect(plan.cases.some(value => value.role === 'panic')).to.equal(true);
    expect(plan.fixtures.every(value => value.physicalTakeEvidence === false)).to.equal(true);
  });
  it('passes explicit target controls into actual shared source planning/rendering without editing immutable patch defaults', async () => {
    const plan = await fixture(), macro = plan.definition.macros.find(value => value.targets.some(target => target.parameter === 'excitationBrightness01')) || plan.definition.macros[0], source = await createAuthoredNoteQualificationFixture({ note: 60, velocity: 64, gateSeconds: 0.2 });
    const base = { definition: plan.definition, descriptor: plan.descriptor, revoice: source.revoice, sampleRate: 48000, endSeconds: source.durationSeconds }, before = await hashData(plan.definition);
    const low = await planCausalSourceRender({ ...base, targetControls: { macros: { [macro.id]: 0 }, variationAmount01: 0 } }), high = await planCausalSourceRender({ ...base, targetControls: { macros: { [macro.id]: 1 }, variationAmount01: 0 } });
    expect(macro.targets.some(target => [...low.voices.values()][0].parameters[target.parameter] !== [...high.voices.values()][0].parameters[target.parameter])).to.equal(true);
    const a = await renderCausalOwnedTake({ ...base, targetControls: { macros: { [macro.id]: 0 }, variationAmount01: 0 } }, { yieldControl: async () => {} });
    const b = await renderCausalOwnedTake({ ...base, targetControls: { macros: { [macro.id]: 1 }, variationAmount01: 0 } }, { yieldControl: async () => {} });
    const left = decodeQualificationFloatWav(a.files[0].bytes).planes[0], right = decodeQualificationFloatWav(b.files[0].bytes).planes[0]; expect(left.some((value, index) => value !== right[index])).to.equal(true);
    expect(await hashData(plan.definition)).to.equal(before);
  });
  it('uses the actual owned Panic opcode and measures its bounded final silence separately from semantic intents', async () => {
    const plan = await fixture(), source = await createAuthoredNoteQualificationFixture({ note: 60, velocity: 64, gateSeconds: 1.2 }), panicFrame = 14592;
    const result = await renderCausalOwnedTake({ definition: plan.definition, descriptor: plan.descriptor, revoice: source.revoice, sampleRate: 48000, endSeconds: source.durationSeconds, panicFrame }, { yieldControl: async () => {} });
    expect(result.manifest.panic.frame).to.equal(panicFrame); const pcm = decodeQualificationFloatWav(result.files[0].bytes);
    expect(pcm.planes.every(plane => plane.subarray(panicFrame + 256).every(value => value === 0))).to.equal(true);
    expect(result.manifest.commands.capturedBegins).to.equal(1); expect(result.manifest.commands.submitted).to.equal(2);
  });
  it('retains failed exact inputs and partial coverage when a backend is missing instead of accepting a silent fallback', async () => {
    const plan = await fixture(), saved = [];
    const report = await runSoundQualification(plan, { renderer: { render: async () => { throw new Error('OfflineAudioContext unavailable'); } }, maximumCases: 2,
      writeArtifact: async () => { throw new Error('Must not publish missing output'); }, writeCase: async value => saved.push(value) });
    expect(saved).to.have.length(2); expect(report.results.every(value => value.state === 'degraded-backend' && value.case.fixtureHash)).to.equal(true);
    expect(report.coverage.complete).to.equal(false); expect(report.coverage.omittedCaseIds.length).to.equal(plan.cases.length - 2); expect(report.acceptance.accepted).to.equal(false);
  });
  it('keeps skipped or incomplete hearing observations pending and binds reviewer history to exact package hashes', async () => {
    const value = { schema: 'lemmings-blind-sound-listening/v1', trials: [{ id: 'trial', conditions: ['headphones', 'small-speakers'], contexts: ['quiet', 'dense-ensemble'], verdicts: ['heard', 'not-heard', 'objection', 'skipped'] }] };
    const packageManifest = { ...value, packageHash: await hashData(value) }, input = { reviewer: 'reviewer-alias', timestamp: '2026-10-25T00:00:00Z', verdicts: [{ trialId: 'trial', condition: 'headphones', context: 'quiet', verdict: 'heard', notes: 'More attack detail.' }] };
    const first = await recordSoundListeningReview({ packageManifest, input }); expect(first.state).to.equal('listening-pending');
    input.verdicts = value.trials[0].conditions.flatMap(condition => value.trials[0].contexts.map(context => ({ trialId: 'trial', condition, context, verdict: 'heard', notes: '' })));
    const second = await recordSoundListeningReview({ packageManifest, previous: first, input }); expect(second.state).to.equal('listening-accepted'); expect(second.previousReviewHash).to.equal(first.reviewHash); expect(second.technicalQualificationIsSeparate).to.equal(true);
    let failure; try { await recordSoundListeningReview({ packageManifest, previous: { ...first, reviewer: 'tampered' }, input }); } catch (error) { failure = error; } expect(failure.message).to.include('not intact');
  });
});
