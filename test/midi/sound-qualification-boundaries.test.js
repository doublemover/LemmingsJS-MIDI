import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { hashData } from '../../js/core/CanonicalData.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { createSoundQualificationPlan } from '../../js/midi/qualification/SoundQualificationPlan.js';
import { measureSoundRender, compareSoundFeatures, matchSoundLevels } from '../../js/midi/qualification/SoundRenderAnalysis.js';
import { runSoundQualification } from '../../js/midi/qualification/SoundQualificationRunner.js';
const wave = () => Float32Array.from({ length: 4800 }, (_, frame) => 0.1 * Math.sin(2 * Math.PI * 440 * frame / 48000));
const measurement = () => measureSoundRender([wave(), wave()], 48000);
let plan;
const run = async mutate => {
  let released = 0;
  const report = await runSoundQualification(plan, { renderer: { render: async (_, selected) => {
    const output = { planes: [wave(), wave()], frames: 4800, semanticReceipt: { begins: 1 }, admissionReceipt: {}, bytes: new Uint8Array([1, 2, 3, 4]), release: () => released++ };
    if (selected.role === 'panic') { output.planes.forEach(plane => plane.fill(0, 384)); output.admissionReceipt.panic = { frame: 128 }; }
    mutate?.(output, selected); return output;
  } }, writeArtifact: async ({ name, bytes, sha256 }) => ({ path: name, bytes: bytes.length, sha256 }), writeCase: async () => {} });
  expect(released).to.equal(3); return report;
};

describe('sound qualification numerical boundaries', () => {
  before(async () => {
    const source = JSON.parse(await readFile(new URL('../../content/sounds/ensemble-identities.json', import.meta.url), 'utf8'));
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-pluck', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const compiled = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) }), patch = compiled.prepared.patches[0];
    const full = await createSoundQualificationPlan({ definition: patch.archivedDefinition, descriptor: descriptors[0], applicationBuildId: 'b'.repeat(64), sampleRates: [48000], includeMacroGrid: false,
      source: { packId: compiled.prepared.pack.id, packVersion: compiled.prepared.pack.version, patchIdentity: patch.definition.id + '@' + patch.definition.revision,
        contentHash: compiled.prepared.contentHash, definitionHash: patch.definitionHash, attribution: compiled.prepared.pack.attribution } });
    const repeat = full.cases.find(row => row.role === 'repeat'), baseline = full.cases.find(row => row.role === 'baseline' && row.fixtureHash === repeat.fixtureHash);
    const { planHash, ...rest } = full; const narrowed = { ...rest, cases: [baseline, repeat, full.cases.find(row => row.role === 'panic')], macroIntents: [] };
    plan = { ...narrowed, planHash: await hashData(narrowed) };
  });
  it('qualifies finite mono and stereo repeats and finite post-Panic silence', async () => {
    for (const mono of [false, true]) {
      const report = await run(output => { if (mono) output.planes.pop(); });
      expect(report.acceptance.technicalFailures).to.equal(0); expect(report.results[1].digitalReceipt.repeat.maximumAbsoluteError).to.equal(0);
      expect(report.results[2].digitalReceipt.panic).to.include({ postPanicPeak: 0, nonfiniteSamples: 0 });
    }
  });
  for (const bad of [NaN, Infinity, -Infinity]) for (const channel of [0, 1]) for (const frame of [0, 4799])
    it('rejects repeat ' + bad + ' at channel ' + channel + ' frame ' + frame + ', retaining finite diagnostic evidence', async () => {
      const report = await run((output, selected) => { if (selected.role === 'repeat') output.planes[channel][frame] = bad; });
      const row = report.results[1]; expect(row.state).to.equal('technical-review-required');
      expect(row.digitalReceipt.metrics.nonfiniteSamples).to.equal(1); expect(row.digitalReceipt.findings).to.include('repeat-pcm-not-comparable');
      expect(row.digitalReceipt.repeat).to.include({ maximumAbsoluteError: null, state: 'invalid-pcm-comparison' });
    });
  it('rejects poisoned references, channel mismatches and empty rendered buffers without retaining owners', async () => {
    for (const mutate of [
      (output, selected) => { if (selected.role === 'baseline') output.planes[1][4799] = NaN; },
      (output, selected) => { if (selected.role === 'repeat') output.planes.pop(); },
      (output, selected) => { if (selected.role === 'repeat') output.planes = [new Float32Array(0)]; }
    ]) {
      const report = await run(mutate); expect(report.acceptance.technicalFailures).to.be.greaterThan(0);
      expect(report.results[1].state).not.to.equal('listening-pending');
    }
  });
  it('keeps a nonfinite final Panic sample as a failed silence gate with a serializable report', async () => {
    const report = await run((output, selected) => { if (selected.role === 'panic') output.planes[1][4799] = NaN; });
    expect(report.results[2].digitalReceipt.panic).to.include({ postPanicPeak: 0, nonfiniteSamples: 1 });
    expect(report.results[2].digitalReceipt.findings).to.include('panic-silence-not-established');
  });
  it('rejects absent, nonfinite, fractional, negative and out-of-range Panic frames', async () => {
    for (const frame of [undefined, NaN, Infinity, -1, 0.5, 4800]) {
      const report = await run((output, selected) => { if (selected.role === 'panic') output.admissionReceipt.panic = frame === undefined ? null : { frame }; });
      expect(report.results[2].state).not.to.equal('listening-pending');
      expect(report.acceptance.technicalFailures).to.be.greaterThan(0);
    }
  });
  it('refuses malformed scalar, shape and vector metrics before similarity or level matching', () => {
    const valid = measurement(), changes = [
      value => { value.schema = 'other'; }, value => { value.sampleRate = 0; }, value => { value.channels = 3; }, value => { value.frames = 0; }, value => { value.samples--; },
      value => { value.nonfiniteSamples = -1; }, value => { value.nonfiniteSamples = 0.5; }, value => { value.nonfiniteSamples = value.samples + 1; },
      value => { value.dc = Infinity; }, value => { value.rms = -1; }, value => { value.peak = -1; }, value => { value.rms = value.peak * 2; },
      value => { value.spectralCentroidHz = undefined; }, value => { value.normalizedFeatures.spectrum = []; }, value => { value.normalizedFeatures.envelope.pop(); },
      value => { delete value.normalizedFeatures.spectrum[0]; }, value => { value.normalizedFeatures.spectrum[0] = -0.1; }, value => { value.normalizedFeatures.envelope[0] = 1e300; }
    ];
    for (const bad of [NaN, Infinity, -Infinity]) for (const field of ['rms', 'peak', 'spectralCentroidHz']) changes.push(value => { value[field] = bad; });
    for (const bad of [NaN, Infinity, -Infinity]) for (const field of ['spectrum', 'envelope']) changes.push(value => { value.normalizedFeatures[field][0] = bad; });
    for (const change of changes) {
      const invalid = structuredClone(valid); change(invalid);
      expect(() => compareSoundFeatures(valid, invalid)).to.throw('Sound measurement');
      expect(() => matchSoundLevels(invalid, valid)).to.throw('Sound measurement');
    }
    const zero = structuredClone(valid); zero.normalizedFeatures.spectrum.fill(0);
    expect(compareSoundFeatures(zero, valid)).to.include({ status: 'unsupported', reason: 'degenerate-feature-vector', nearDuplicate: false });
  });
});
