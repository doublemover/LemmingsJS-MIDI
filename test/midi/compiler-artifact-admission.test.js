import { expect } from 'chai';
import fs from 'node:fs/promises';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { prepareSoundContentPack } from '../../js/midi/content/SoundContentPack.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';

describe('compiler/pack artifact admission closure (#1131, deferred)', () => {
  let native, sample, descriptors;
  before(async () => {
    const ids = ['native-oscillator', 'native-fm', 'native-modal', 'native-sample', 'worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-texture', 'worklet-friction', 'worklet-wind'];
    descriptors = await describeNativeInstrumentEngines(ids.map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })));
    const targets = descriptors.map(descriptor => ({ descriptor }));
    native = await compileSoundContent(JSON.parse(await fs.readFile(new URL('../../content/sounds/native.json', import.meta.url), 'utf8')), { targets });
    sample = await compileSoundContent(JSON.parse(await fs.readFile(new URL('../../content/sounds/tactile-contacts.json', import.meta.url), 'utf8')), { targets });
  });
  const admit = pack => prepareSoundContentPack(pack, { engineDescriptors: descriptors });
  const reject = async (pack, field) => { let error; try { await admit(pack); } catch (caught) { error = caught; } expect(error?.code).to.equal('invalid-content'); expect(error?.message).to.include(field); };
  it('admits every emitted artifact from every shipped recipe family through the same published pack schema', async () => {
    const root = new URL('../../content/sounds/', import.meta.url), files = (await fs.readdir(root)).filter(file => file.endsWith('.json')).sort();
    for (const file of files) {
      const compiled = await compileSoundContent(JSON.parse(await fs.readFile(new URL(file, root), 'utf8')), { targets: descriptors.map(descriptor => ({ descriptor })) });
      const repeated = await admit(compiled.prepared.pack); expect(repeated.contentHash, file).to.equal(compiled.prepared.contentHash);
      for (const artifact of repeated.pack.compilation.artifacts) {
        const patch = repeated.patches.find(patch => patch.identity === artifact.id + '@' + artifact.revision), map = patch.definition.sampleMap;
        expect(artifact.cost.sampleZones, file).to.equal(map?.zones.length || 0);
        if (map) expect(artifact.display.sampleMap).to.deep.equal({ articulations: map.articulations, normalizationRef: map.normalizationRef });
        else expect(Object.hasOwn(artifact.display, 'sampleMap')).to.equal(false);
      }
    }
  });
  it('preserves earlier supported artifact bytes with an implicit zero sample-zone count', async () => {
    for (let version = 1; version <= 10; version++) {
      const pack = structuredClone(native.prepared.pack); pack.compilation.compilerRevision = 'typed-recipes-v' + version;
      for (const artifact of pack.compilation.artifacts) delete artifact.cost.sampleZones;
      const result = await admit(pack); expect(result.pack.compilation).to.deep.equal(pack.compilation);
      expect(result.pack.compilation.artifacts.every(artifact => !Object.hasOwn(artifact.cost, 'sampleZones'))).to.equal(true);
    }
    const oldMap = structuredClone(sample.prepared.pack); oldMap.compilation.compilerRevision = 'typed-recipes-v10';
    for (const artifact of oldMap.compilation.artifacts) { delete artifact.display.sampleMap; delete artifact.cost.sampleZones; }
    await reject(oldMap, 'require typed-recipes-v11');
  });
  it('rejects malformed, excessive and contradictory v11 counts without weakening unknown-field rejection', async () => {
    for (const count of [-1, 0.5, 129, '24', null, 0, 23]) {
      const pack = structuredClone(sample.prepared.pack); pack.compilation.artifacts[0].cost.sampleZones = count; await reject(pack, 'sampleZones');
    }
    for (const change of [artifact => { delete artifact.cost.sampleZones; }, artifact => { artifact.cost.future = true; }, artifact => { artifact.cost.sampleZones = 1; }]) {
      const pack = structuredClone(native.prepared.pack); change(pack.compilation.artifacts[0]); await reject(pack, 'cost');
    }
  });
  it('rejects malformed nested display fields and display metadata unrelated to the actual archived map', async () => {
    const changes = [artifact => { delete artifact.display.sampleMap; }, artifact => { artifact.display.sampleMap.extra = true; }, artifact => { artifact.display.sampleMap.articulations = []; },
      artifact => { artifact.display.sampleMap.articulations.push(artifact.display.sampleMap.articulations[0]); }, artifact => { artifact.display.sampleMap.articulations[0].name = 'x'.repeat(81); },
      artifact => { artifact.display.sampleMap.articulations[0].extra = true; }, artifact => { artifact.display.sampleMap.articulations[0].id = 'unknown-gesture'; },
      artifact => { artifact.display.sampleMap.normalizationRef = 'invalid'; }, artifact => { artifact.display.sampleMap.normalizationRef = 'b'.repeat(64); }, artifact => { delete artifact.display.sampleMap.normalizationRef; }];
    for (const change of changes) { const pack = structuredClone(sample.prepared.pack); change(pack.compilation.artifacts[0]); await reject(pack, 'sampleMap'); }
    const nonMap = structuredClone(native.prepared.pack); nonMap.compilation.artifacts[0].display.sampleMap = sample.artifacts[0].display.sampleMap; await reject(nonMap, 'non-sample-map');
  });
});
