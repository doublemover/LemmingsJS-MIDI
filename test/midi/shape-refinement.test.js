import { expect } from 'chai';
import { createOriginalShapeBodySource } from '../../js/midi/content/OriginalShapeMeshes.js';
import { solveShapeBody } from '../../js/app/resources/ShapeBodySolver.js';
import { shapeAmplitudeT60, verifyShapeBodyAsset } from '../../js/midi/content/ShapeBodyAsset.js';
import { massWeightedModeCorrelation, assignMinimumModalCosts, compareShapeBodyRefinement, solveOriginalShapeRefinement, SHAPE_REFINEMENT_PROFILE } from '../../js/app/resources/ShapeBodyRefinement.js';
import { hashData } from '../../js/core/CanonicalData.js';

const build = 'a'.repeat(64), compareBuild = 'b'.repeat(64), options = { yieldControl: async () => {} }, copy = value => JSON.parse(JSON.stringify(value));
const rejects = async (work, text) => { let error; try { await work; } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error); expect(error.message).to.include(text); };
describe('explicit mass-weighted shape-refinement comparison', function() {
  this.timeout(120000); let coarse, fine;
  before(async () => { coarse = await solveShapeBody({ source: createOriginalShapeBodySource(), solverBuildHash: build }, options); fine = await solveShapeBody({ source: createOriginalShapeBodySource('pocket-bar', { refined: true }), solverBuildHash: build }, options); });
  it('keeps direction, sign and scale separate from actual coarse mass weighting', () => {
    expect(massWeightedModeCorrelation([1, -2, 3], [-2, 4, -6], [0.3, 9, 1])).to.be.closeTo(1, 1e-14);
    expect(massWeightedModeCorrelation([1, 1], [1, 0], [1, 9])).to.be.closeTo(0.1, 1e-14); expect(massWeightedModeCorrelation([1, 0], [0, 1], [1, 9])).to.equal(0);
    expect(() => massWeightedModeCorrelation([0, 0], [1, 0], [1, 1])).to.throw('norm'); expect(() => massWeightedModeCorrelation([1, 0], [1, 0], [0, 1])).to.throw('mass');
  });
  it('finds a complete one-to-one correspondence where greedy per-mode matching is wrong', () => {
    expect([...assignMinimumModalCosts(new Float64Array([0.1, 0.2, 0.11, 1.5]), 2, 2)]).to.deep.equal([1, 0]);
    expect([...assignMinimumModalCosts(new Float64Array(6), 2, 3)]).to.deep.equal([0, 1]); expect(() => assignMinimumModalCosts(new Float64Array([NaN]), 1, 1)).to.throw();
  });
  it('compares all declared low modes on a complete nested domain without promoting an acoustic or runtime tier', async () => {
    const oldCoarse = coarse.assetHash, oldFine = fine.assetHash, result = await compareShapeBodyRefinement({ coarse, fine, comparisonBuildHash: compareBuild, profileId: SHAPE_REFINEMENT_PROFILE.id }, options);
    expect(result.geometricEvidence).to.include({ nestedParents: true, matchedVertices: 16 }); expect(result.geometricEvidence.maximumParentVolumeRelativeError).to.be.at.most(1e-8);
    expect(result.pairs).to.have.length(8); expect(new Set(result.pairs.map(pair => pair.fineModeIndex)).size).to.equal(8); expect(result.pairs.every(pair => pair.mac >= 0 && pair.mac <= 1 && Number.isFinite(pair.relativeFrequencyError))).to.equal(true);
    expect(result.algebraicEvidence.fine.largestRelativeResidual).to.be.at.most(1e-9); expect(result.algebraicEvidence.fine.method).to.include('not-trusted');
    expect(['within-profile-tolerances', 'outside-profile-tolerances', 'inconclusive-degenerate-subspace']).to.include(result.status); expect(result).to.include({ acousticQualification: false, listeningQualification: false, deviceCostQualification: false, automaticTierAdmission: false });
    const { receiptHash, ...receipt } = result; expect(await hashData(receipt, { maxBytes: 262144, maxNodes: 16384 })).to.equal(receiptHash); expect(coarse.assetHash).to.equal(oldCoarse); expect(fine.assetHash).to.equal(oldFine);
    for (const kind of ['excitationSites', 'pickupSites']) expect(result.geometricEvidence[kind].map(site => site.positionMeters)).to.deep.equal(coarse.source[kind].map(site => coarse.source.mesh.vertices[site.vertex].map(value => value * coarse.source.mesh.scaleMeters)));
  });
  it('recomputes elastic residuals rather than trusting forged converged metadata and a recomputed content hash', async () => {
    const forged = copy(coarse), mode = forged.modes[0], material = forged.source.material; mode.angularFrequencyRadiansPerSecond *= 2; mode.dampingRatio = (material.rayleighAlphaPerSecond + material.rayleighBetaSeconds * mode.angularFrequencyRadiansPerSecond ** 2) / (2 * mode.angularFrequencyRadiansPerSecond);
    mode.frequencyHz = mode.angularFrequencyRadiansPerSecond * Math.sqrt(1 - mode.dampingRatio ** 2) / (2 * Math.PI); mode.t60Seconds = shapeAmplitudeT60(mode.angularFrequencyRadiansPerSecond, mode.dampingRatio);
    const { assetHash, ...body } = forged; forged.assetHash = await hashData(body, { maxBytes: 2 * 1048576, maxNodes: 131072 }); await verifyShapeBodyAsset(forged);
    await rejects(compareShapeBodyRefinement({ coarse: forged, fine, comparisonBuildHash: compareBuild, profileId: SHAPE_REFINEMENT_PROFILE.id }, options), 'eigenpair'); expect(assetHash).to.equal(coarse.assetHash);
  });
  it('declines same-mesh substitutions, tampered artifacts, unknown profiles and cancellation', async () => {
    await rejects(compareShapeBodyRefinement({ coarse, fine: coarse, comparisonBuildHash: compareBuild, profileId: SHAPE_REFINEMENT_PROFILE.id }, options), 'genuine finer');
    const changed = copy(fine); changed.modes[0].displacementPerRootKg[0] += 1; await rejects(compareShapeBodyRefinement({ coarse, fine: changed, comparisonBuildHash: compareBuild, profileId: SHAPE_REFINEMENT_PROFILE.id }, options), 'artifact hash');
    await rejects(solveOriginalShapeRefinement({ shapeId: 'slotted-plate', solverBuildHash: build, comparisonBuildHash: compareBuild }, options), 'Only the original pocket bar');
    const controller = new AbortController(); controller.abort(new Error('refinement canceled')); await rejects(compareShapeBodyRefinement({ coarse, fine, comparisonBuildHash: compareBuild, profileId: SHAPE_REFINEMENT_PROFILE.id }, { ...options, signal: controller.signal }), 'refinement canceled');
  });
});
