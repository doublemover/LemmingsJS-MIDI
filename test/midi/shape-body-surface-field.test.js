import { expect } from 'chai';
import { createOriginalShapeBodySource } from '../../js/midi/content/OriginalShapeMeshes.js';
import { solveShapeBody } from '../../js/app/resources/ShapeBodySolver.js';
import { createShapeBodyEdgeField } from '../../js/app/resources/ShapeBodyEdgeField.js';
import { renderShapeBodyCalibration } from '../../js/app/resources/ShapeBodyCalibration.js';
import { createShapeBodyRecipe } from '../../js/midi/content/ShapeBodyRecipe.js';
import { prepareSympatheticNetworkProfile } from '../../js/midi/content/SympatheticNetworkProfile.js';
import { SympatheticNetworkKernel } from '../../js/app/midi-ui/worklet/SympatheticNetworkKernel.js';
import { hashData } from '../../js/core/CanonicalData.js';

const options = { fieldKind: 'surface', yieldControl: async () => {} }, copy = value => JSON.parse(JSON.stringify(value)), parameters = model => model.graph.nodes.find(node => node.id === 'bodies').parameters;
describe('solved top-face pickup field (runtime and listening qualification deferred)', function() {
  this.timeout(30000); let asset, field;
  before(async () => { asset = await solveShapeBody({ source: createOriginalShapeBodySource(), solverBuildHash: 'a'.repeat(64) }, options); field = await createShapeBodyEdgeField(asset, options); });
  it('retains the exact exposed triangles, two distinct coordinate rows and common signed nodal reference', async () => {
    expect(field.state).to.equal('prepared'); const receipt = field.receipt; expect(receipt.schema).to.equal('lemmings-shape-body-surface-field/v1'); expect(receipt.triangleVertexIndices).to.have.length(6); expect(receipt.vertexIndices).to.have.length(8); expect(field.fieldHash).to.equal(await hashData(receipt)); expect(receipt.field.yDomain).to.include('across-solved'); expect(receipt.qualification.acousticAccuracy).to.equal(false);
    for (const triangle of receipt.triangleVertexIndices) expect(asset.source.mesh.tetrahedra.filter(tet => triangle.every(vertex => tet.includes(vertex)))).to.have.length(1);
    for (let node = 0; node < 8; node++) for (let mode = 0; mode < 8; mode++) expect(receipt.field.weights[node * 8 + mode]).to.equal(asset.modes[receipt.modeIndices[mode]].displacementPerRootKg[receipt.vertexIndices[node] * 3 + 2] / receipt.field.pickupReference);
    expect(receipt.field.weights.slice(0, 32)).not.to.deep.equal(receipt.field.weights.slice(32));
    for (const model of field.maps) { const profile = prepareSympatheticNetworkProfile(parameters(model)); expect(model.recipe).to.equal('foundry-surface'); expect(profile.pickupGrid.interpolation).to.include('Tet4-boundary-triangles'); expect(profile.pickupPreparation.kind).to.include('solved-surface'); expect(profile.maximumLinearGain).to.equal(1); }
  });
  it('uses the triangle diagonal with affine barycentric weights instead of a fictitious bilinear face', () => {
    const p = copy(parameters(field.maps[0])); p.pickupGrid.weights.fill(0); for (const [node, value] of [[0, 0.1], [1, 0.2], [4, 0.3], [5, 0.8]]) p.pickupGrid.weights[node * 8] = value;
    const kernel = new SympatheticNetworkKernel({ parameters: p });
    for (const [y, expected] of [[0.25, 0.1 * 0.5 + 0.2 * 0.25 + 0.8 * 0.25], [0.75, 0.1 * 0.25 + 0.3 * 0.25 + 0.8 * 0.5]]) {
      kernel.pickupPositions.set([1 / 6, y, 1 / 6, y, 1 / 6, y, 1 / 6, y]); kernel.updatePickups(); expect(kernel.pickupWeights[0]).to.be.closeTo(expected, 1e-14); expect(kernel.pickupWeights[8]).to.equal(kernel.pickupWeights[0]); expect(Math.hypot(...kernel.pickupWeights.subarray(0, 8))).to.be.at.most(1);
    }
  });
  it('changes only the selected pickup output and preserves state, excitation, loss and source cardinality', () => {
    const p = parameters(field.maps[0]), a = new SympatheticNetworkKernel({ parameters: p }), b = new SympatheticNetworkKernel({ parameters: p }); let difference = 0;
    for (let frame = 0; frame < 2500; frame++) {
      if (frame === 120) b.setPickupPosition('pickupLeftY01', 0.95); const input = frame < 25 ? Math.sin(frame * 0.31) * 0.2 : 0; a.sample(input, input); b.sample(input, input);
      expect(b.state).to.deep.equal(a.state); expect(b.rightSample).to.equal(a.rightSample); expect(b.lossMasks).to.deep.equal(a.lossMasks); difference = Math.max(difference, Math.abs(b.leftSample - a.leftSample));
    }
    expect(difference).to.be.greaterThan(0); expect(field.receipt.semanticOnsetsAdded).to.equal(0); const silent = new SympatheticNetworkKernel({ parameters: p }); silent.setPickupPosition('pickupLeftY01', 1); for (let index = 0; index < 400; index++) silent.sample(0, 0); expect(silent.state.every(value => value === 0)).to.equal(true);
    const restored = new SympatheticNetworkKernel({ parameters: p }), bytes = new Uint8Array(b.snapshotBytes); b.snapshotInto(bytes); restored.restoreFrom(bytes); for (let index = 0; index < 100; index++) { b.sample(0, 0); restored.sample(0, 0); expect(restored.leftSample).to.equal(b.leftSample); expect(restored.state).to.deep.equal(b.state); }
  });
  it('packages the surface receipt with the exact solved ancestry and leaves edge defaults explicit', async () => {
    const calibration = await renderShapeBodyCalibration({ asset, modeCount: 8, sampleRate: 48000, seconds: 0.2 }, options), recipe = await createShapeBodyRecipe({ asset, calibration, edgeField: field });
    const generated = recipe.contents.find(file => file.path === 'shape/surface-field.json'); expect(generated.sha256).to.equal(field.fieldHash); expect(generated.parents).to.deep.equal([asset.assetHash, asset.meshHash]); expect(recipe.receipt.sharedSurfaceFieldHash).to.equal(field.fieldHash); expect(recipe.receipt).not.to.have.property('sharedEdgeFieldHash'); expect(recipe.source.recipes[0].dependencies).to.include(field.fieldHash);
    const edge = await createShapeBodyEdgeField(asset, { ...options, fieldKind: 'edge' }); expect(edge.receipt.field.yDomain).to.include('invariant'); expect(edge.maps[0].recipe).to.equal('foundry-edge');
  });
  it('declines unsupported domains and catches a stale source before publishing a surface field', async () => {
    let error; try { await createShapeBodyEdgeField(asset, { ...options, fieldKind: 'nearest-site' }); } catch (caught) { error = caught; } expect(error.message).to.include('exact solved');
    let current = true; error = null; try { await createShapeBodyEdgeField(asset, { ...options, current: () => current, yieldControl: async () => { current = false; } }); } catch (caught) { error = caught; } expect(error.message).to.include('generation changed');
    const p = copy(parameters(field.maps[0])); p.pickupGrid.fieldRevision = 'invented-surface'; expect(() => prepareSympatheticNetworkProfile(p)).to.throw('exact source');
  });
});
