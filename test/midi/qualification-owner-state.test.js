import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { hashData } from '../../js/core/CanonicalData.js';
import { createSharedSoundQualificationRenderer } from '../../js/midi/qualification/SharedSoundQualificationRenderer.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { createSoundQualificationPlan } from '../../js/midi/qualification/SoundQualificationPlan.js';
const turn = () => new Promise(resolve => setImmediate(resolve));
const source = async () => { const value = {}, digest = await hashData(value); return { plan: { definition: value, definitionHash: digest, fixtures: [{ id: 'audit', revoice: value, durationSeconds: 1 }] }, selected: { id: 'case', fixtureId: 'audit', fixtureHash: digest, sampleRate: 48000 } }; };
const failure = promise => promise.then(() => null, error => error);
describe('exclusive qualification-render ownership (#1275)', () => {
  it('admits one simultaneous request and releases a refused owner before retry', async () => {
    let release, calls = 0; const gate = new Promise(resolve => { release = resolve; }), { plan, selected } = await source();
    const renderer = createSharedSoundQualificationRenderer({ getAssets: async () => { calls++; await gate; throw new Error('asset refused'); } });
    const first = failure(renderer.render(plan, selected)), second = failure(renderer.render(plan, selected));
    const refused = await second; expect(refused.message).to.include('busy');
    for (let count = 0; count < 100 && !calls; count++) await turn(); expect(calls).to.equal(1); expect(renderer.diagnostics().resources.reservations).to.equal(1);
    release(); expect((await first).message).to.equal('asset refused'); expect(renderer.diagnostics().active).to.equal(false); expect(renderer.diagnostics().resources.reservations).to.equal(0);
    expect((await failure(renderer.render(plan, selected))).message).to.equal('asset refused'); expect(calls).to.equal(2); renderer.dispose();
  });
  it('does not publish or reserve after disposal during asynchronous source validation', async () => {
    const { plan, selected } = await source(), renderer = createSharedSoundQualificationRenderer();
    const pending = failure(renderer.render(plan, selected)); expect(() => renderer.dispose()).to.throw('active');
    expect((await pending).message).to.include('retired'); expect(renderer.diagnostics()).to.include({ disposed: true, active: false }); expect(renderer.diagnostics().resources.reservations).to.equal(0);
    expect((await failure(renderer.render(plan, selected))).message).to.include('retired'); renderer.dispose();
  });
  it('refuses late asset completion after disposal and retires that asset lease', async () => {
    let release, entered, releases = 0; const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; }), { plan, selected } = await source();
    const renderer = createSharedSoundQualificationRenderer({ getAssets: async () => { entered(); await gate; return { release() { releases++; } }; } });
    const pending = failure(renderer.render(plan, selected)); await ready; expect(() => renderer.dispose()).to.throw('active');
    release(); expect((await pending).message).to.include('retired'); expect(releases).to.equal(1); expect(renderer.diagnostics().active).to.equal(false); expect(renderer.diagnostics().resources.reservations).to.equal(0); renderer.dispose();
  });
  it('recovers from source validation failure and holds actual rendered PCM exclusively until release', async () => {
    const content = JSON.parse(await readFile(new URL('../../content/sounds/plucked-garden.json', import.meta.url), 'utf8'));
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-pluck', engineVersion: 1, artifactHash: 'a'.repeat(64) }]);
    const compiled = await compileSoundContent(content, { targets: descriptors.map(descriptor => ({ descriptor })) }), patch = compiled.prepared.patches[0];
    const plan = await createSoundQualificationPlan({ definition: patch.archivedDefinition, descriptor: descriptors[0], applicationBuildId: 'b'.repeat(64), sampleRates: [48000], includeMacroGrid: false,
      source: { packId: compiled.prepared.pack.id, packVersion: compiled.prepared.pack.version, patchIdentity: patch.definition.id + '@' + patch.definition.revision, contentHash: compiled.prepared.contentHash, definitionHash: patch.definitionHash, attribution: compiled.prepared.pack.attribution } });
    const selected = plan.cases.find(value => value.role === 'baseline'), renderer = createSharedSoundQualificationRenderer(); let rendered;
    try {
      expect((await failure(renderer.render({ ...plan, definitionHash: '0'.repeat(64) }, selected))).message).to.equal('Qualification source changed.'); expect(renderer.diagnostics().active).to.equal(false);
      rendered = await renderer.render(plan, selected); expect(rendered.planes[0].some(value => value !== 0)).to.equal(true); expect(renderer.diagnostics().active).to.equal(true);
      expect((await failure(renderer.render(plan, selected))).message).to.include('busy'); expect(rendered.release()).to.equal(true); expect(rendered.release()).to.equal(false); expect(renderer.diagnostics().active).to.equal(false); expect(renderer.diagnostics().resources.reservations).to.equal(0);
    } finally { rendered?.release(); renderer.dispose(); }
  });
});
