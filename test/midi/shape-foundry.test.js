import { expect } from 'chai';
import { createOriginalShapeBodySource, ORIGINAL_SHAPE_BODY_IDS } from '../../js/midi/content/OriginalShapeMeshes.js';
import { validateShapeBodySource, shapeAmplitudeT60, verifyShapeBodyAsset, selectShapeBodyTier } from '../../js/midi/content/ShapeBodyAsset.js';
import { assembleShapeBodySystem, solveShapeBody } from '../../js/app/resources/ShapeBodySolver.js';
import { renderShapeBodyCalibration } from '../../js/app/resources/ShapeBodyCalibration.js';
import { createShapeBodyRecipe } from '../../js/midi/content/ShapeBodyRecipe.js';
import { hashData } from '../../js/core/CanonicalData.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { createShapeFoundryOwner } from '../../js/app/midi-ui/ShapeFoundryOwner.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { canonicalDataText } from '../../js/core/CanonicalData.js';

const copy = value => JSON.parse(JSON.stringify(value)), options = { yieldControl: async () => {} }, input = source => ({ source, solverBuildHash: 'a'.repeat(64) });
describe('original offline tetrahedral shape foundry', function() {
  this.timeout(30000);
  it('uses radians per second for analytic amplitude T60 rather than substituting Hz', () => {
    const correct = shapeAmplitudeT60(2 * Math.PI * 440, 0.01); expect(correct).to.be.closeTo(0.2498644087, 1e-10);
    expect(shapeAmplitudeT60(440, 0.01) / correct).to.be.closeTo(2 * Math.PI, 1e-12); expect(() => shapeAmplitudeT60(0, 0.01)).to.throw();
  });
  it('matches independent affine strain energy, total mass and rigid rotation in a positive solid', () => {
    const system = assembleShapeBodySystem(createOriginalShapeBodySource()), { points, stiffness: k, mass, totalVolume, source } = system, n = mass.length, epsilon = 0.001;
    const extension = points.flatMap(([x]) => [epsilon * x, 0, 0]), rotation = points.flatMap(([x, y]) => [-y, x, 0]);
    const energy = u => u.reduce((sum, x, row) => sum + x * u.reduce((product, y, col) => product + k[row * n + col] * y, 0), 0);
    const { youngModulusPa: e, poissonRatio: nu } = source.material, expected = e * (1 - nu) / ((1 + nu) * (1 - 2 * nu)) * epsilon * epsilon * totalVolume;
    expect(energy(extension)).to.be.closeTo(expected, expected * 1e-10); expect(Math.abs(energy(rotation))).to.be.lessThan(expected * 1e-7); expect(mass.reduce((sum, value) => sum + value, 0)).to.be.closeTo(system.totalMassKg * 3, 1e-10);
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) expect(k[row * n + col]).to.equal(k[col * n + row]);
  });
  for (const id of ORIGINAL_SHAPE_BODY_IDS) it('retains six rigid modes, converged eigenpairs and separate signed sites: ' + id, async () => {
    const asset = await solveShapeBody(input(createOriginalShapeBodySource(id)), options); expect(asset.validation).to.include({ algebraicStatus: 'converged', rigidModes: 6 }); expect(asset.validation.largestRelativeResidual).to.be.lessThan(1e-9);
    expect(asset.validation.meshConvergence).to.include('not-qualified'); expect((await verifyShapeBodyAsset(asset)).assetHash).to.equal(asset.assetHash);
    expect(asset.modes.every(mode => mode.excitation.length === 3 && mode.pickup.length === 2 && mode.t60Seconds > 0)).to.equal(true);
    const tier = selectShapeBodyTier(asset, { modeCount: 8 }); expect(tier.modeIndices).to.have.length(8); expect(tier.retainedSalience01).to.be.within(0, 1);
    expect(asset.modes.some(mode => mode.excitation.some(value => value < 0) || mode.pickup.some(value => value < 0))).to.equal(true);
  });
  it('scales undamped frequencies with the square root of Young modulus and retains explicit non-bitwise solver limits', async () => {
    const first = createOriginalShapeBodySource(), second = copy(first); second.material.youngModulusPa *= 4;
    const a = await solveShapeBody(input(first), options), b = await solveShapeBody(input(second), options);
    for (let i = 0; i < a.modes.length; i++) expect(b.modes[i].angularFrequencyRadiansPerSecond / a.modes[i].angularFrequencyRadiansPerSecond).to.be.closeTo(2, 1e-7);
    expect(a.solver.reproducibility).to.include('not-cross-platform-bitwise'); expect(a.sourceHash).not.to.equal(b.sourceHash);
  });
  it('rejects inverted, duplicated, detached, unused, over-budget and canceled inputs before a playable result', async () => {
    const source = createOriginalShapeBodySource();
    for (const mutate of [value => { const tet = value.mesh.tetrahedra[0]; [tet[0], tet[1]] = [tet[1], tet[0]]; }, value => value.mesh.tetrahedra.push(value.mesh.tetrahedra[0]), value => value.mesh.vertices.push([4, 4, 4]), value => { value.mesh.tetrahedra[0][0] = -1; }, value => { value.material.densityKgPerM3 = 0; }]) { const invalid = copy(source); mutate(invalid); expect(() => validateShapeBodySource(invalid)).to.throw(); }
    const controller = new AbortController(); controller.abort(new Error('canceled foundry')); let caught; try { await solveShapeBody(input(source), { ...options, signal: controller.signal }); } catch (error) { caught = error; } expect(caught.message).to.equal('canceled foundry');
    try { await solveShapeBody(input(source), { ...options, estimatedPeakBytes: 4096 }); } catch (error) { caught = error; } expect(caught.message).to.include('workspace');
  });
  it('declines forged T60 units and incomplete mode tiers even when the caller recomputes a content hash', async () => {
    const asset = await solveShapeBody(input(createOriginalShapeBodySource()), options), forged = copy(asset); forged.modes[0].t60Seconds *= 2;
    const { assetHash, ...body } = forged; forged.assetHash = await hashData(body, { maxBytes: 2 * 1048576, maxNodes: 131072 }); let caught; try { await verifyShapeBodyAsset(forged); } catch (error) { caught = error; } expect(caught.message).to.include('amplitude-T60');
    expect(() => selectShapeBodyTier(asset, { modeCount: 7 })).to.throw(); expect(() => selectShapeBodyTier(asset, { sampleRate: 32000 })).to.throw(); expect(assetHash).to.equal(asset.assetHash);
  });
  it('builds distinct same-onset site calibrations and an ordinary complete sampler/content pack', async () => {
    const asset = await solveShapeBody(input(createOriginalShapeBodySource('asymmetric-pebble')), options), calibration = await renderShapeBodyCalibration({ asset, modeCount: 8, sampleRate: 48000, seconds: 0.1 }, options);
    expect(new Set(calibration.files.map(file => file.manifest.pcmHash)).size).to.equal(3); expect(calibration.files.every(file => new DataView(file.bytes.buffer).getFloat32(56, true) === 0)).to.equal(true);
    const recipe = await createShapeBodyRecipe({ asset, calibration }), [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: 'b'.repeat(64) }]), content = await compileSoundContent(recipe.source, { targets: [{ descriptor }] });
    expect(content.prepared.pack.patches).to.have.length(1); expect(recipe.receipt.runtime).to.include('existing-owned-sampler'); expect(content.prepared.pack.files).to.have.length(6);
    expect(content.prepared.pack.patches[0].definition.sampleMap.zones.every(zone => zone.pitchTracking === 'fixed')).to.equal(true);
    expect(calibration.files.every(file => file.manifest.gain.applied === calibration.files[0].manifest.gain.applied)).to.equal(true);
  });
  it('retains the previous staged body after stale preparation and requires independent audition/install before Apply', async () => {
    const asset = await solveShapeBody(input(createOriginalShapeBodySource()), options), calibration = await renderShapeBodyCalibration({ asset, modeCount: 8, sampleRate: 48000, seconds: 0.2 }, options), recipe = await createShapeBodyRecipe({ asset, calibration }), [descriptor] = await describeNativeInstrumentEngines([{ engineId: 'worklet-sample', engineVersion: 1, artifactHash: 'b'.repeat(64) }]);
    const compiled = await compileSoundContent(recipe.source, { targets: [{ descriptor }] }), budget = createResourceBudget(); let applied = 0, releases = 0, resolveComparison, announceComparison;
    const comparisonStarted = new Promise(resolve => { announceComparison = resolve; }), comparisonCompletion = new Promise(resolve => { resolveComparison = resolve; });
    const jobs = { async compute(request) {
      const source = await request.prepareInput(); let value;
      if (request.kind === 'build-shape-body-content') value = { prepared: compiled.prepared, contents: recipe.contents, receipt: recipe.receipt, overview: { assetHash: asset.assetHash, solver: asset.solver } };
      else if (request.kind === 'qualify-original-shape-refinement') { expect(source.expectedCoarseAssetHash).to.equal(asset.assetHash); announceComparison(); await comparisonCompletion; value = {}; }
      else if (request.kind === 'parse-json') value = JSON.parse(source);
      else if (request.kind === 'encode-canonical-json') value = canonicalDataText(source).text;
      else if (request.kind === 'asset-hash') { value = [...new Uint8Array(await crypto.subtle.digest('SHA-256', source))].map(value => value.toString(16).padStart(2, '0')).join(''); expect(value).to.equal(request.expectedInputHash); }
      else throw new Error('Unexpected foundry fixture job ' + request.kind);
      let released = false; return { value, receipt: { method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound', buildId: 'a'.repeat(64) } }, release() { released = true; releases++; }, retirementState: () => ({ phase: released ? 'released' : 'retained' }) };
    } };
    const owner = createShapeFoundryOwner({ audio: { createSession() {}, getAudioContext() {} }, resourceBudget: budget, jobs, getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId: 'a'.repeat(64) }, descriptors: [descriptor] }), onApply: () => { applied++; } });
    await owner.prepare({ seconds: 0.2 }); expect(owner.state()).to.include({ compiledReady: true, auditionReady: false, durable: false }); const identity = owner.state().patchIdentity;
    let targetCurrent = true, comparisonError; const comparing = owner.compareRefinement({ isCurrent: () => targetCurrent }); await comparisonStarted; targetCurrent = false; resolveComparison();
    try { await comparing; } catch (error) { comparisonError = error; } expect(comparisonError.message).to.include('exact current'); expect(owner.state().refinement).to.equal(null); expect(owner.state().patchIdentity).to.equal(identity);
    let caught; try { await owner.prepare({ seconds: 0.2 }, { isCurrent: () => false }); } catch (error) { caught = error; } expect(caught.message).to.include('draft changed'); expect(owner.state().patchIdentity).to.equal(identity);
    try { await owner.apply(); } catch (error) { caught = error; } expect(caught.message).to.include('Commit this staged pack'); expect(applied).to.equal(0); expect(releases).to.be.greaterThan(0);
    const sourceReader = owner.borrowEndpointSource(), receipt = owner.dispose(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); expect(JSON.parse(await sourceReader.file.text()).schema).to.equal('lemmings-shape-body-asset/v1'); sourceReader.release(); expect(() => sourceReader.file.text()).to.throw('retired'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
});
