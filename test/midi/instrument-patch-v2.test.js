import { expect } from 'chai';
import { createInstrumentPatchRegistry, migrateInstrumentPatchParameters, validateEngineDescriptor, validateInstrumentPatchV2 } from '../../js/midi/content/InstrumentPatchV2.js';

const engine = () => ({ engineId: 'native-oscillator', engineVersion: 1, artifactHash: 'a'.repeat(64),
  parameterSchemaHash: 'b'.repeat(64), capabilities: { independentSamePitch: true, filter: true },
  parameters: [
    { id: 'frequency', unit: 'Hz', min: 20, max: 20000, default: 440, interpolation: 'logarithmic', liveSafe: true },
    { id: 'brightness', unit: 'normalized', min: 0, max: 1, default: 0.5, interpolation: 'linear', liveSafe: true, capability: 'filter' },
    { id: 'layers', unit: 'count', min: 1, max: 8, default: 2, interpolation: 'linear', discrete: true, liveSafe: false }
  ] });
const patch = () => ({ schemaVersion: 2, id: 'crystal-lead', revision: 7, name: 'Crystal Lead', author: 'Lemmings', tags: ['crystal', 'lead'],
  engineId: 'native-oscillator', engineVersion: 1, parameters: { frequency: 660, brightness: 0.72, layers: 3 },
  modulations: [{ id: 'motion-brightness', source: 'physical:displacementPixels', target: 'brightness', amount: 0.25, smoothingMs: 15, curve: 'linear' }],
  sampleRefs: [{ id: 'air', sha256: 'c'.repeat(64), bytes: 32000, required: false }],
  voicePolicy: { maxVoices: 16, steal: 'oldest' }, mix: { gain01: 0.8, pan01: -0.2 },
  macros: [{ id: 'shimmer', name: 'Shimmer', mode: 'onset-only', default01: 0.5, smoothingMs: 0, perceptualDirection: 'Increase spectral brightness.',
    targets: [{ parameter: 'brightness', unit: 'normalized', minimum: 0, maximum: 1, curve: 'linear', composition: 'replace', clamp: true }] }],
  causalBindings: [{ id: 'impact', sourceKind: 'TerrainWorkCommitted', payloadField: 'changedSolidCells', target: 'brightness',
    unit: 'cells', curve: 'linear', inputMin: 0, inputMax: 6, smoothingMs: 5 }],
  midiFallback: { bankMSB: 0, bankLSB: 0, program: 10, percussionMap: { 36: 38 } } });

describe('versioned causal instrument patches', () => {
  it('commits a complete bounded batch atomically, deduplicates identical definitions and rejects conflicts', () => {
    const registry = createInstrumentPatchRegistry({ maxDefinitions: 2 }), first = patch(), second = { ...patch(), id: 'second' };
    const invalid = { ...second, parameters: { frequency: Infinity } };
    expect(() => registry.registerBatch([{ patch: first, descriptor: engine() }, { patch: invalid, descriptor: engine() }])).to.throw();
    expect(registry.inspect(first.id, first.revision)).to.equal(null);
    const registered = registry.registerBatch([{ patch: first, descriptor: engine() }, { patch: second, descriptor: engine() }]);
    expect(registry.registerBatch([{ patch: first, descriptor: engine() }])[0]).to.equal(registered[0]);
    expect(() => registry.registerBatch([{ patch: { ...first, name: 'changed' }, descriptor: engine() }])).to.throw('immutable identity');
    expect(() => registry.registerBatch([{ patch: { ...first, id: 'third' }, descriptor: engine() }])).to.throw('capacity');
    expect(registry.diagnostics().definitions).to.equal(2);
  });
  it('pins the engine artifact at registration and preserves conflicting unsupported archives', () => {
    const registry = createInstrumentPatchRegistry(); registry.register(patch(), engine());
    const changed = engine(); changed.artifactHash = 'f'.repeat(64);
    expect(registry.resolve('crystal-lead', 7, { engineDescriptors: [changed] }).status).to.equal('engine-revision-mismatch');
    const original = registry.retainUnsupportedJson('{"id":"future","revision":1,"source":{"value":2}}');
    expect(registry.retainUnsupportedJson('{"revision":1,"source":{"value":2},"id":"future"}')).to.equal(original);
    expect(() => registry.retainUnsupportedJson('{"id":"future","revision":1,"source":{"value":3}}')).to.throw('conflicting immutable bytes');
    expect(registry.inspect('future', 1)).to.equal(original);
  });
  it('resolves an immutable local patch and keeps its MIDI fallback separate', () => {
    const registry = createInstrumentPatchRegistry(), descriptor = engine();
    const definition = registry.register(patch(), descriptor);
    const ready = registry.resolve('crystal-lead', 7, { engineDescriptors: [descriptor], assetHashes: ['c'.repeat(64)], mappingRevision: 3 });
    expect(ready.status).to.equal('ready');
    expect(ready.patch).to.equal(definition);
    expect(ready.receipt).to.include({ patchId: 'crystal-lead', revision: 7, mappingRevision: 3,
      engineArtifactHash: 'a'.repeat(64), parameterSchemaHash: 'b'.repeat(64) });
    expect(ready.patch.engineId).to.equal('native-oscillator');
    expect(ready.patch.midiFallback.program).to.equal(10);
    expect(Object.isFrozen(ready.patch.parameters)).to.equal(true);
    expect(registry.resolve('crystal-lead', 8).status).to.equal('unknown-patch-revision');
    expect(() => registry.register(patch(), descriptor)).to.throw('already registered');
    const lanes = Array.from({ length: 1000 }, () => registry.inspect('crystal-lead', 7));
    expect(new Set(lanes).size).to.equal(1);
    expect(() => registry.resolve('crystal-lead', 7, { assetHashes: ['not-a-hash'] })).to.throw('resolution context');
  });

  it('explains unavailable engines, required assets and optional degradation', () => {
    const registry = createInstrumentPatchRegistry(), descriptor = engine();
    registry.register(patch(), descriptor);
    expect(registry.resolve('crystal-lead', 7).status).to.equal('engine-unavailable');
    const degraded = registry.resolve('crystal-lead', 7, { engineDescriptors: [descriptor] });
    expect(degraded.status).to.equal('degraded');
    expect(degraded.receipt.capabilityDecision).to.equal('degraded-optional-assets');
    const required = patch(); required.sampleRefs[0].required = true; required.revision = 8;
    registry.register(required, descriptor);
    expect(registry.resolve('crystal-lead', 8, { engineDescriptors: [descriptor] }).status).to.equal('asset-missing');
    const rejected = engine(); rejected.capabilities.filter = false;
    expect(registry.resolve('crystal-lead', 7, { engineDescriptors: [rejected] }).status).to.equal('engine-rejected');
  });

  it('rejects unavailable parameters, nonfinite values and cyclic modulation before registration', () => {
    const invalid = patch(); invalid.parameters.frequency = Infinity;
    expect(() => validateInstrumentPatchV2(invalid, engine())).to.throw('Unsupported patch parameter');
    const wrong = patch(); wrong.parameters.unknown = 3;
    expect(() => validateInstrumentPatchV2(wrong, engine())).to.throw('Unsupported patch parameter');
    const cycle = patch(); cycle.modulations = [
      { id: 'a', source: 'parameter:frequency', target: 'brightness', amount: 1, smoothingMs: 0, curve: 'linear' },
      { id: 'b', source: 'parameter:brightness', target: 'frequency', amount: 1, smoothingMs: 0, curve: 'linear' }
    ];
    expect(() => validateInstrumentPatchV2(cycle, engine())).to.throw('Cyclic patch modulation');
    const unsupported = engine(); unsupported.capabilities.filter = false;
    expect(() => validateInstrumentPatchV2(patch(), unsupported)).to.throw('Unsupported patch parameter');
    const badDescriptor = engine(); badDescriptor.parameters[0].min = 0;
    expect(() => validateEngineDescriptor(badDescriptor)).to.throw('Invalid instrument parameter descriptor');
  });

  it('retains unknown future revisions for read-only inspection without making them playable', () => {
    const registry = createInstrumentPatchRegistry();
    const archived = registry.retainUnsupportedJson(JSON.stringify({ id: 'future-body', revision: 99, engineId: 'unknown',
      source: { notes: [1, 2, 3] } }));
    expect(Object.isFrozen(archived.source.notes)).to.equal(true);
    expect(registry.inspect('future-body', 99)).to.equal(archived);
    expect(registry.resolve('future-body', 99)).to.include({ status: 'unknown-patch-revision', archivedDefinition: archived });
    expect(() => registry.retainUnsupportedJson('{"id":"bad","revision":1,"__proto__":{"polluted":true}}')).to.throw('Invalid archived patch key');
  });

  it('performs an explicit parameter rename with a reviewable report and no source mutation', () => {
    const old = patch(), updatedEngine = engine();
    updatedEngine.parameters[1].id = 'tone';
    const result = migrateInstrumentPatchParameters(old, updatedEngine, { brightness: 'tone' }, 8);
    expect(result.patch).to.include({ id: old.id, revision: 8 });
    expect(result.patch.parameters).to.have.property('tone', 0.72);
    expect(result.patch.modulations[0].target).to.equal('tone');
    expect(result.patch.macros[0].targets[0].parameter).to.equal('tone');
    expect(result.patch.causalBindings[0].target).to.equal('tone');
    expect(result.report.renamed).to.deep.equal([{ from: 'brightness', to: 'tone' }]);
    expect(old.parameters).to.have.property('brightness', 0.72);
    expect(() => migrateInstrumentPatchParameters(old, updatedEngine, { brightness: 'frequency' }, 8)).to.throw('conflicts');
  });
});
