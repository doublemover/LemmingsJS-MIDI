import { expect } from 'chai';
import { createOriginalShapeBodySource } from '../../js/midi/content/OriginalShapeMeshes.js';
import { solveShapeBody } from '../../js/app/resources/ShapeBodySolver.js';
import { createShapeBodyEdgeField } from '../../js/app/resources/ShapeBodyEdgeField.js';
import { prepareSympatheticNetworkProfile } from '../../js/midi/content/SympatheticNetworkProfile.js';
import { SympatheticNetworkKernel } from '../../js/app/midi-ui/worklet/SympatheticNetworkKernel.js';
import { renderShapeBodyCalibration } from '../../js/app/resources/ShapeBodyCalibration.js';
import { createShapeBodyRecipe } from '../../js/midi/content/ShapeBodyRecipe.js';
import { hashData } from '../../js/core/CanonicalData.js';

const options = { yieldControl: async () => {} }, copy = value => JSON.parse(JSON.stringify(value));
const parameters = model => model.graph.nodes.find(node => node.id === 'bodies').parameters;
const reject = async (promise, text) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error?.message).to.include(text); };
describe('signed solved bar-edge observation (runtime qualification deferred)', function() {
  this.timeout(30000); let asset, field;
  before(async () => { asset = await solveShapeBody({ source: createOriginalShapeBodySource(), solverBuildHash: 'a'.repeat(64) }, options); field = await createShapeBodyEdgeField(asset, options); });
  it('projects actual connected nodal displacements with one common pickup and strike reference', async () => {
    expect(field.state).to.equal('prepared'); expect(field.maps.map(model => model.siteId)).to.deep.equal(['end', 'shoulder', 'corner']);
    const receipt = field.receipt; expect(field.fieldHash).to.equal(await hashData(receipt)); expect(receipt.modeIndices).to.have.length(8); expect(receipt.algebraicEvidence.largestRelativeResidual).to.be.lessThan(1e-9);
    expect(receipt.field.yDomain).to.include('invariant'); expect(receipt.qualification.acousticAccuracy).to.equal(false);
    for (let node = 0; node < 4; node++) for (let mode = 0; mode < 8; mode++) {
      const expected = asset.modes[receipt.modeIndices[mode]].displacementPerRootKg[receipt.vertexIndices[node] * 3 + 2] / receipt.field.pickupReference;
      expect(receipt.field.weights[node * 8 + mode]).to.equal(expected); expect(receipt.field.weights[(node + 4) * 8 + mode]).to.equal(expected);
    }
    for (let site = 0; site < 3; site++) {
      const p = parameters(field.maps[site]), profile = prepareSympatheticNetworkProfile(p);
      expect(profile.pickupGrid.sourceFieldHash).to.equal(field.fieldHash); expect(profile.maximumLinearGain).to.equal(1);
      for (let mode = 0; mode < 8; mode++) expect(profile.modes[mode].excitation / profile.inputScale).to.be.closeTo(asset.modes[receipt.modeIndices[mode]].excitation[site] / receipt.excitationReference, 1e-14);
      expect(Math.hypot(...p.excitationWeights)).to.be.at.most(1); expect(p.excitationReferenceNorm).to.equal(1);
    }
    expect(field.maps.every(model => model.bodyIds.length === 1)).to.equal(true);
  });
  it('moves independent pickups without changing state, excitation, loss or the source onset count', () => {
    const p = parameters(field.maps[0]), a = new SympatheticNetworkKernel({ parameters: p }), b = new SympatheticNetworkKernel({ parameters: p });
    let difference = 0;
    for (let frame = 0; frame < 5000; frame++) {
      if (frame === 200) b.setPickupPosition('pickupLeftX01', 0.95);
      const input = frame < 40 ? Math.sin(frame * 0.2) * 0.2 : 0; a.sample(input, -input); b.sample(input, -input);
      expect(b.state).to.deep.equal(a.state); expect(b.rightSample).to.equal(a.rightSample); difference = Math.max(difference, Math.abs(a.leftSample - b.leftSample));
    }
    expect(difference).to.be.greaterThan(0); expect(field.receipt.semanticOnsetsAdded).to.equal(0);
    const silent = new SympatheticNetworkKernel({ parameters: p }); silent.setPickupPosition('pickupRightX01', 0.1); for (let frame = 0; frame < 1000; frame++) silent.sample(0, 0);
    expect(silent.leftSample).to.equal(0); expect(silent.rightSample).to.equal(0);
    const restored = new SympatheticNetworkKernel({ parameters: p }), cut = new Uint8Array(b.snapshotBytes); b.snapshotInto(cut); restored.restoreFrom(cut);
    for (let frame = 0; frame < 500; frame++) { b.sample(0, 0); restored.sample(0, 0); expect(restored.leftSample).to.equal(b.leftSample); expect(restored.state).to.deep.equal(b.state); }
  });
  it('keeps signed excitation and between-site level differences without automatic site renormalization', () => {
    const original = parameters(field.maps[0]), half = copy(original); half.excitationWeights = half.excitationWeights.map(value => value * 0.5);
    const a = new SympatheticNetworkKernel({ parameters: original }), b = new SympatheticNetworkKernel({ parameters: half });
    a.sample(0.5, 0.5); b.sample(0.5, 0.5); for (let index = 0; index < a.state.length; index++) expect(b.state[index]).to.equal(a.state[index] * 0.5);
    const inverted = copy(original); inverted.excitationWeights = inverted.excitationWeights.map(value => -value); const c = new SympatheticNetworkKernel({ parameters: inverted }); c.sample(0.5, 0.5);
    for (let index = 0; index < a.state.length; index++) expect(c.state[index] + a.state[index]).to.equal(0);
    const oversized = copy(original); oversized.excitationReferenceNorm = 1e-12; expect(() => prepareSympatheticNetworkProfile(oversized)).to.throw('common reference');
  });
  it('recomputes elastic residuals instead of trusting a newly hashed mode vector and honors cancellation', async () => {
    const forged = copy(asset); forged.modes[0].displacementPerRootKg[3] += 0.1; delete forged.assetHash; forged.assetHash = await hashData(forged, { maxBytes: 2 * 1048576, maxNodes: 131072 });
    await reject(createShapeBodyEdgeField(forged, options), 'Recomputed elastic eigenpair');
    let current = true; await reject(createShapeBodyEdgeField(asset, { current: () => current, yieldControl: async () => { current = false; } }), 'generation changed');
  });
  it('stores the exact generated field beside the original solved asset in the normal content closure', async () => {
    const calibration = await renderShapeBodyCalibration({ asset, modeCount: 8, sampleRate: 48000, seconds: 0.2 }, options), recipe = await createShapeBodyRecipe({ asset, calibration, edgeField: field });
    const generated = recipe.contents.find(file => file.path === 'shape/edge-field.json'); expect(generated.sha256).to.equal(field.fieldHash); expect(generated.parents).to.deep.equal([asset.assetHash, asset.meshHash]);
    expect(recipe.source.recipes[0].sampleRefs).to.have.length(3); expect(recipe.source.recipes[0].dependencies).to.include(field.fieldHash); expect(recipe.receipt.sharedEdgeFieldHash).to.equal(field.fieldHash);
    const wrong = copy(field); wrong.fieldHash = 'e'.repeat(64); await reject(createShapeBodyRecipe({ asset, calibration, edgeField: wrong }), 'exact solved body');
  });
});
