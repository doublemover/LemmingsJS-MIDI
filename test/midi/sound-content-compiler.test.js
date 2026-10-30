import { expect } from 'chai';
import fs from 'node:fs/promises';
import { compileSoundContent, convertSoundQuantity, reviewSoundContentChanges } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { validateInstrumentPatchV2 } from '../../js/midi/content/InstrumentPatchV2.js';
import { singleSampleMap } from '../helpers/sampleMap.js';

const rejects = async (promise, field) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error?.name).to.equal('SoundContentCompileError'); expect(error.message).to.include(field); };
describe('typed declarative sound authoring', () => {
  let source, targets;
  before(async () => {
    source = JSON.parse(await fs.readFile(new URL('../../content/sounds/native.json', import.meta.url), 'utf8'));
    targets = (await describeNativeInstrumentEngines(['native-oscillator', 'native-sample', 'worklet-sine'].map(engineId =>
      ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })))).map(descriptor => ({ descriptor }));
  });
  const compile = input => compileSoundContent(input, { targets });
  it('pins authored sample selection while keeping gesture labels and evidence references outside its render key', async () => {
    const raw = structuredClone(source), hash = 'a'.repeat(64), rights = structuredClone(source.recipes.find(recipe => recipe.rights).rights);
    raw.files = [{ path: 'samples/fixture.wav', sha256: hash, bytes: 128, mediaType: 'audio/wav', kind: 'sample', parents: [], rights: { ...rights, kind: 'derived-data' } }];
    raw.recipes = [{ id: 'sample-map-fixture', revision: 1, name: 'Sample map fixture', author: 'Fixture', tags: ['test'], engine: { id: 'native-sample', version: 1 },
      components: [{ id: 'envelope', role: 'envelope', parameters: { attackSeconds: { value: 0.005, unit: 's' } } },
        { id: 'output', role: 'output', parameters: { gain01: { value: 0.7, unit: 'amplitude-linear' } } }],
      sampleRefs: [{ id: 'material', sha256: hash, bytes: 128, required: true }], sampleMap: singleSampleMap(hash), dependencies: [hash],
      voicePolicy: { maxVoices: 8, steal: 'reject' }, mix: { gain01: 0.5, pan01: 0 }, rights }];
    const first = await compile(raw); expect(first.prepared.patches[0].state).to.equal('definition-admitted');
    expect(first.artifacts[0].cost.sampleZones).to.equal(1); expect(first.artifacts[0].display.sampleMap).to.deep.equal({ articulations: first.prepared.patches[0].definition.sampleMap.articulations, normalizationRef: null });
    expect(first.prepared.patches[0].definition.sampleMap.zones).to.have.length(1);
    raw.recipes[0].sampleMap.articulations[0].name = 'New gesture label'; raw.recipes[0].sampleMap.normalizationRef = 'b'.repeat(64);
    expect(reviewSoundContentChanges(first, await compile(raw))[0]).to.include({ state: 'render-equivalent', metadataChanged: true });
    raw.recipes[0].sampleMap.zones[0].gain01 = 0.6;
    expect(reviewSoundContentChanges(first, await compile(raw))[0].state).to.equal('effective-render-change');
  });
  it('compiles actual inherited oscillator parameters and preserves visible overrides', async () => {
    const output = await compile(source), triangle = output.prepared.patches.find(patch => patch.identity === 'foundation.soft-triangle@3');
    expect(output.prepared.patches).to.have.length(4); expect(triangle.definition.parameters).to.include({ waveform: 1, attackSeconds: 0.04, gain01: 0.55 });
    expect(output.artifacts.find(artifact => artifact.id === triangle.definition.id).overrides).to.include('envelope.attackSeconds');
    expect(output.qualification).to.equal('compiled-data-not-render-qualified');
    expect(output.artifacts.every(artifact => artifact.audition.renderEvidence === 'not-produced')).to.equal(true);
  });
  it('preserves render identity for labels and traversal changes while distinguishing audible and rights changes', async () => {
    const before = await compile(source), label = structuredClone(source); label.recipes.reverse(); label.recipes.find(recipe => recipe.id === 'foundation.soft-triangle').name = 'A different display name';
    const renamed = await compile(label), change = reviewSoundContentChanges(before, renamed).find(entry => entry.id === 'foundation.soft-triangle');
    expect(change).to.include({ state: 'render-equivalent', metadataChanged: true, rightsChanged: false });
    label.recipes.find(recipe => recipe.id === 'foundation.soft-triangle').components[1].parameters.attackSeconds.value = 0.1;
    expect(reviewSoundContentChanges(before, await compile(label)).find(entry => entry.id === 'foundation.soft-triangle').state).to.equal('effective-render-change');
    const rights = structuredClone(source); rights.recipes[0].rights.attribution += ' amended';
    expect(reviewSoundContentChanges(before, await compile(rights)).every(entry => entry.state === 'render-equivalent' && entry.rightsChanged)).to.equal(true);
  });
  it('rejects swapped Hz/seconds, ambiguous ratios and unsupported conversions with exact authoring fields', async () => {
    const wrong = structuredClone(source); wrong.recipes[0].components[0].parameters.attackSeconds.unit = 'Hz';
    await rejects(compile(wrong), 'attackSeconds: explicit conversion required from Hz to s');
    expect(convertSoundQuantity({ value: 20, unit: 'ms', conversion: { kind: 'milliseconds-seconds', to: 's' } }, 's')).to.equal(0.02);
    expect(convertSoundQuantity({ value: -6, unit: 'dB', conversion: { kind: 'db-amplitude', to: 'amplitude-linear' } }, 'amplitude-linear')).to.be.closeTo(0.501187, 0.000001);
    expect(() => convertSoundQuantity({ value: 1, unit: 'ratio' }, 'Hz')).to.throw('explicit conversion');
  });
  it('rejects missing capabilities, unknown components, invalid domains and inheritance cycles before publication', async () => {
    const cycle = structuredClone(source); cycle.recipes[0].extends = 'foundation.soft-triangle'; await rejects(compile(cycle), 'inheritance cycle');
    const unknown = structuredClone(source); unknown.recipes[1].components[0].role = 'resonator'; await rejects(compile(unknown), 'component is not supplied');
    const excessive = structuredClone(source); excessive.recipes[1].components[0].parameters.waveform.value = 4; await rejects(compile(excessive), 'exceeds engine domain');
    const modulation = structuredClone(source); modulation.recipes[1].modulations = [{}]; await rejects(compile(modulation), 'does not realize');
    const missing = structuredClone(source); missing.recipes[1].dependencies = ['b'.repeat(64)]; await rejects(compile(missing), 'required immutable assets');
  });
  it('rejects voice policies and capacities that the actual renderer does not execute', async () => {
    for (const steal of ['oldest', 'quietest']) {
      const input = structuredClone(source); input.recipes[0].voicePolicy.steal = steal;
      await rejects(compile(input), 'voicePolicy');
    }
    const input = structuredClone(source); input.recipes[0].voicePolicy.maxVoices = 65;
    await rejects(compile(input), 'voicePolicy');
  });
  it('applies native capability boundaries to imported definitions as well as authored recipes', async () => {
    const output = await compile(source), entry = output.prepared.patches.find(patch => patch.identity === 'foundation.soft-triangle@3');
    const descriptor = targets.find(target => target.descriptor.engineId === 'native-oscillator').descriptor;
    expect(descriptor.maximumVoices).to.equal(64); expect(descriptor.voicePolicies).to.deep.equal(['reject']);
    for (const change of [patch => { patch.voicePolicy.steal = 'oldest'; }, patch => { patch.voicePolicy.maxVoices = 65; },
      patch => { patch.modulations = [{}]; }, patch => { patch.sampleRefs = [{}]; }]) {
      const patch = structuredClone(entry.definition); change(patch);
      expect(() => validateInstrumentPatchV2(patch, descriptor)).to.throw(/not realized/);
    }
    const invalid = structuredClone(entry.definition); invalid.macros = [{ id: 'ignored', name: 'Ignored', targets: ['gain01'] }];
    expect(() => validateInstrumentPatchV2(invalid, descriptor)).to.throw('typed curves');
    invalid.macros = []; invalid.causalBindings = [{}]; expect(() => validateInstrumentPatchV2(invalid, descriptor)).to.throw('typed completed-fact');
  });
});
