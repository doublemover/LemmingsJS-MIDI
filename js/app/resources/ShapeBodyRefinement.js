import { assignBoundedMinimumCosts } from '../../core/BoundedMinimumAssignment.js';
import { verifyShapeBodyAsset, tetrahedronDeterminant, shapeBodyFailure } from '../../midi/content/ShapeBodyAsset.js';
import { canonicalDataText, hashData, freezeData } from '../../core/CanonicalData.js';
import { createOriginalShapeBodySource } from '../../midi/content/OriginalShapeMeshes.js';
import { solveShapeBody, assembleShapeBodySystem } from './ShapeBodySolver.js';

export const SHAPE_REFINEMENT_REVISION = 'nested-tet4-coarse-mass-MAC-global-assignment-v1';
export const SHAPE_REFINEMENT_PROFILE = freezeData({ id: 'low-eight-v1', modeCount: 8, selection: 'lowest-eight-elastic-frequency', minimumMac: 0.9, maximumRelativeFrequencyError: 0.05, degenerateRelativeGap: 0.01,
  geometryRelativeTolerance: 1e-9, parentVolumeRelativeTolerance: 1e-8, scope: 'two-mesh-agreement-of-requested-low-modes;not-asymptotic-convergence-or-acoustic-qualification' });
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const same = (a, b) => canonicalDataText(a).text === canonicalDataText(b).text;

export async function recheckElasticModes(asset, check, yieldControl) {
  check(); const system = assembleShapeBodySystem(asset.source), n = system.dimension, norm = Math.sqrt(system.matrix.reduce((sum, value) => sum + value * value, 0));
  const vectors = asset.modes.map(mode => Float64Array.from(system.free, index => mode.displacementPerRootKg[index] * Math.sqrt(system.mass[index]))); let largestRelativeResidual = 0, largestOrthogonalityError = 0;
  for (let index = 0; index < vectors.length; index++) {
    const vector = vectors[index], mode = asset.modes[index], eigenvalue = mode.angularFrequencyRadiansPerSecond ** 2 / system.scale; let residual = 0;
    for (let row = 0; row < n; row++) { let product = 0; for (let col = 0; col < n; col++) product += system.matrix[row * n + col] * vector[col]; residual += (product - eigenvalue * vector[row]) ** 2; }
    largestRelativeResidual = Math.max(largestRelativeResidual, Math.sqrt(residual) / (norm + Math.abs(eigenvalue)));
    for (let other = 0; other <= index; other++) { let product = 0; for (let row = 0; row < n; row++) product += vector[row] * vectors[other][row]; largestOrthogonalityError = Math.max(largestOrthogonalityError, Math.abs(product - Number(index === other))); }
    const material = asset.source.material, expectedDamping = (material.rayleighAlphaPerSecond + material.rayleighBetaSeconds * mode.angularFrequencyRadiansPerSecond ** 2) / (2 * mode.angularFrequencyRadiansPerSecond);
    if (Math.abs(expectedDamping - mode.dampingRatio) > expectedDamping * 1e-10 || asset.source.boundary.fixedVertices.some(vertex => mode.displacementPerRootKg.slice(vertex * 3, vertex * 3 + 3).some(value => value !== 0))) shapeBodyFailure('Refinement modes violate the authored damping or displacement constraints.');
    if (index % 8 === 7) { check(); await yieldControl(); }
  }
  check(); if (largestRelativeResidual > 1e-9 || largestOrthogonalityError > 1e-9) shapeBodyFailure('Recomputed elastic eigenpair residuals or mass orthogonality do not qualify.');
  return { elasticModes: vectors.length, largestRelativeResidual, largestOrthogonalityError, method: 'reassembled-mass-whitened-elastic-system;all-retained-full-vector-eigenpairs;not-trusted-receipt-fields' };
}

export function massWeightedModeCorrelation(a, b, mass) {
  if (!a || !b || !mass || a.length !== b.length || a.length !== mass.length || a.length < 1 || a.length > 192) shapeBodyFailure('Mode correlation requires a common bounded physical coordinate and mass inventory.');
  let product = 0, aa = 0, bb = 0;
  for (let index = 0; index < a.length; index++) { if (!Number.isFinite(a[index]) || !Number.isFinite(b[index]) || !Number.isFinite(mass[index]) || mass[index] <= 0) shapeBodyFailure('Invalid mode displacement or coarse lumped mass.');
    product += a[index] * mass[index] * b[index]; aa += a[index] * mass[index] * a[index]; bb += b[index] * mass[index] * b[index]; }
  const value = product * product / aa / bb;
  if (!(aa > 0) || !(bb > 0) || !Number.isFinite(value) || value < 0 || value > 1 + 1e-10) shapeBodyFailure('Mode correlation has a degenerate or nonfinite norm.'); return Math.min(1, value);
}

export function assignMinimumModalCosts(costs, rows, columns) { return assignBoundedMinimumCosts(costs, rows, columns, shapeBodyFailure); }

export async function compareShapeBodyRefinement(input, { signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), estimatedPeakBytes = 32 * 1048576 } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) shapeBodyFailure('The refinement comparison owner changed.'); };
  check(); if (!input || Object.keys(input).some(key => !['coarse', 'fine', 'comparisonBuildHash', 'profileId'].includes(key)) || !/^[a-f0-9]{64}$/.test(input.comparisonBuildHash) || input.profileId !== SHAPE_REFINEMENT_PROFILE.id || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 32 * 1048576 || estimatedPeakBytes > 512 * 1048576) shapeBodyFailure('Refinement comparison needs its exact build, fixed declared profile and admitted workspace.');
  const coarse = await verifyShapeBodyAsset(input.coarse); check(); const fine = await verifyShapeBodyAsset(input.fine); check(); const c = coarse.source, f = fine.source, profile = SHAPE_REFINEMENT_PROFILE;
  if (c.id !== f.id || f.revision <= c.revision || c.mesh.units !== f.mesh.units || c.mesh.scaleMeters !== f.mesh.scaleMeters || !same(c.material, f.material) || c.boundary.kind !== f.boundary.kind || !same(c.sourceTerrain, f.sourceTerrain) ||
      coarse.solver.buildHash !== fine.solver.buildHash || f.mesh.vertices.length <= c.mesh.vertices.length || f.mesh.tetrahedra.length <= c.mesh.tetrahedra.length) shapeBodyFailure('Compare a genuine finer mesh of the same model, scale, material, constraints and solver.');
  const points = source => source.mesh.vertices.map(point => point.map(value => value * source.mesh.scaleMeters)), cp = points(c), fp = points(f), extent = Math.max(...[0, 1, 2].map(axis => Math.max(...cp.map(point => point[axis])) - Math.min(...cp.map(point => point[axis]))), 1e-12), tolerance = extent * profile.geometryRelativeTolerance;
  const vertexMap = cp.map(point => { const matches = fp.flatMap((candidate, index) => Math.hypot(...subtract(candidate, point)) <= tolerance ? [index] : []); if (matches.length !== 1) shapeBodyFailure('Nested comparison requires each coarse vertex at one unambiguous fine-mesh coordinate.'); return matches[0]; });
  if (!same(c.boundary.fixedVertices.map(index => vertexMap[index]).sort((a, b) => a - b), [...f.boundary.fixedVertices].sort((a, b) => a - b))) shapeBodyFailure('Refinement changed the actual constrained points.');
  const sites = name => { if (c[name].length !== f[name].length) shapeBodyFailure('Refinement changed its curated source or pickup inventory.'); return c[name].map((site, index) => { const next = f[name][index]; if (site.id !== next.id || vertexMap[site.vertex] !== next.vertex || !same(site.direction, next.direction)) shapeBodyFailure('Refinement must compare the same physical excitation and pickup points.'); return { id: site.id, positionMeters: cp[site.vertex], direction: site.direction }; }); };
  const excitationSites = sites('excitationSites'), pickupSites = sites('pickupSites'), mass = new Float64Array(cp.length * 3);
  const parents = c.mesh.tetrahedra.map(tet => { const origin = cp[tet[0]], a = subtract(cp[tet[1]], origin), b = subtract(cp[tet[2]], origin), d = subtract(cp[tet[3]], origin), determinant = dot(a, cross(b, d)), volume = determinant / 6;
    for (const vertex of tet) for (let axis = 0; axis < 3; axis++) mass[vertex * 3 + axis] += c.material.densityKgPerM3 * volume / 4;
    return { origin, x: cross(b, d).map(value => value / determinant), y: cross(d, a).map(value => value / determinant), z: cross(a, b).map(value => value / determinant), volume, refinedVolume: 0 }; });
  let maximumParentVolumeError = 0;
  for (let index = 0; index < f.mesh.tetrahedra.length; index++) {
    check(); const tet = f.mesh.tetrahedra[index], vertices = tet.map(vertex => fp[vertex]), candidates = parents.filter(parent => vertices.every(point => { const q = subtract(point, parent.origin), x = dot(parent.x, q), y = dot(parent.y, q), z = dot(parent.z, q), epsilon = profile.geometryRelativeTolerance; return x >= -epsilon && y >= -epsilon && z >= -epsilon && x + y + z <= 1 + epsilon; }));
    if (candidates.length !== 1) shapeBodyFailure('Every fine tetrahedron must belong to exactly one coarse parent; this is not a nested refinement.'); candidates[0].refinedVolume += tetrahedronDeterminant(vertices) / 6;
    if (index % 16 === 15) await yieldControl();
  }
  for (const parent of parents) { const error = Math.abs(parent.volume - parent.refinedVolume) / parent.volume; maximumParentVolumeError = Math.max(maximumParentVolumeError, error); if (error > profile.parentVolumeRelativeTolerance) shapeBodyFailure('Fine tetrahedra do not cover each complete coarse volume.'); }
  const massKg = mass.reduce((sum, value) => sum + value, 0) / 3;
  if (Math.abs(coarse.validation.totalMassKg - massKg) / massKg > profile.parentVolumeRelativeTolerance || Math.abs(fine.validation.totalMassKg - massKg) / massKg > profile.parentVolumeRelativeTolerance) shapeBodyFailure('The source mass receipts differ from the common nested domain.');
  const algebraicEvidence = { coarse: await recheckElasticModes(coarse, check, yieldControl), fine: await recheckElasticModes(fine, check, yieldControl) };
  const selected = [...coarse.modes].sort((a, b) => a.frequencyHz - b.frequencyHz || a.index - b.index).slice(0, profile.modeCount);
  if (selected.length !== profile.modeCount) shapeBodyFailure('The source cannot cover the complete declared low-mode comparison profile.');
  const sampled = fine.modes.map(mode => { const vector = vertexMap.flatMap(vertex => mode.displacementPerRootKg.slice(vertex * 3, vertex * 3 + 3)); return { mode, vector, norm: vector.reduce((sum, value, index) => sum + value * value * mass[index], 0) }; }), largestNorm = Math.max(...sampled.map(value => value.norm));
  const visible = sampled.filter(value => value.norm > largestNorm * 1e-12), unobservedFineModes = sampled.filter(value => value.norm <= largestNorm * 1e-12).map(value => value.mode.index), columns = visible.length;
  if (!(largestNorm > 0) || columns < selected.length) shapeBodyFailure('The common coarse coordinates do not observe enough independent fine modes.');
  const correlations = new Float64Array(selected.length * columns), frequencyErrors = new Float64Array(correlations.length), costs = new Float64Array(correlations.length);
  for (let row = 0; row < selected.length; row++) { check(); for (let col = 0; col < columns; col++) { const at = row * columns + col, mac = massWeightedModeCorrelation(selected[row].displacementPerRootKg, visible[col].vector, mass), error = Math.abs(selected[row].frequencyHz - visible[col].mode.frequencyHz) / visible[col].mode.frequencyHz;
    correlations[at] = mac; frequencyErrors[at] = error; costs[at] = 1 - mac + Math.min(1, error); } await yieldControl(); }
  const assignments = assignMinimumModalCosts(costs, selected.length, columns), nearDegenerate = (mode, modes) => modes.some(other => other.index !== mode.index && Math.abs(other.frequencyHz - mode.frequencyHz) / Math.max(other.frequencyHz, mode.frequencyHz) < profile.degenerateRelativeGap);
  const pairs = selected.map((mode, row) => { const target = visible[assignments[row]].mode, at = row * columns + assignments[row], ambiguousSubspace = nearDegenerate(mode, coarse.modes) || nearDegenerate(target, fine.modes);
    return { coarseModeIndex: mode.index, fineModeIndex: target.index, coarseFrequencyHz: mode.frequencyHz, fineFrequencyHz: target.frequencyHz, relativeFrequencyError: frequencyErrors[at], mac: correlations[at], ambiguousSubspace,
      withinIndividualTolerances: frequencyErrors[at] <= profile.maximumRelativeFrequencyError && correlations[at] >= profile.minimumMac }; });
  const outside = pairs.filter(pair => !pair.ambiguousSubspace && !pair.withinIndividualTolerances).length, ambiguous = pairs.filter(pair => pair.ambiguousSubspace).length;
  const receipt = { schema: 'lemmings-shape-refinement-comparison/v1', revision: SHAPE_REFINEMENT_REVISION, comparisonBuildHash: input.comparisonBuildHash, profile,
    coarse: { assetHash: coarse.assetHash, sourceHash: coarse.sourceHash, meshHash: coarse.meshHash, vertices: cp.length, tetrahedra: parents.length }, fine: { assetHash: fine.assetHash, sourceHash: fine.sourceHash, meshHash: fine.meshHash, vertices: fp.length, tetrahedra: f.mesh.tetrahedra.length },
    solverBuildHash: coarse.solver.buildHash, status: outside ? 'outside-profile-tolerances' : ambiguous ? 'inconclusive-degenerate-subspace' : 'within-profile-tolerances', algebraicEvidence, geometricEvidence: { nestedParents: true, matchedVertices: vertexMap.length, maximumParentVolumeRelativeError: maximumParentVolumeError, commonMassKg: massKg, excitationSites, pickupSites },
    correlation: 'squared-coarse-lumped-mass-inner-product-at-exact-matched-vertices;sign-and-scale-invariant', unobservedFineModes, fineVisibilityRelativeSquaredNorm: 1e-12, assignment: 'global-minimum-one-to-one-cost=(1-MAC)+min(1,fine-reference-relative-frequency-error)', pairs,
    summary: { comparedModes: pairs.length, outsideIndividualTolerances: pairs.filter(pair => !pair.withinIndividualTolerances).length, ambiguousSubspaces: ambiguous, minimumMac: Math.min(...pairs.map(pair => pair.mac)), maximumRelativeFrequencyError: Math.max(...pairs.map(pair => pair.relativeFrequencyError)) },
    acousticQualification: false, listeningQualification: false, deviceCostQualification: false, automaticTierAdmission: false, degeneratePolicy: 'inconclusive;requires-subspace-comparison-not-a-favorable-individual-vector-pick' };
  check(); const receiptHash = await hashData(receipt, { maxBytes: 262144, maxNodes: 16384 }); check(); return freezeData({ ...receipt, receiptHash });
}

export async function solveOriginalShapeRefinement({ shapeId = 'pocket-bar', solverBuildHash, comparisonBuildHash, profileId = SHAPE_REFINEMENT_PROFILE.id, expectedCoarseAssetHash = null } = {}, options = {}) {
  if (shapeId !== 'pocket-bar' || profileId !== SHAPE_REFINEMENT_PROFILE.id || !/^[a-f0-9]{64}$/.test(solverBuildHash) || !/^[a-f0-9]{64}$/.test(comparisonBuildHash) || expectedCoarseAssetHash !== null && !/^[a-f0-9]{64}$/.test(expectedCoarseAssetHash)) shapeBodyFailure('Only the original pocket bar currently supplies this exact nested refinement profile and pinned build.');
  const progress = mesh => value => options.onProgress?.({ ...value, phase: mesh + '-' + value.phase });
  options.signal?.throwIfAborted(); const coarse = await solveShapeBody({ source: createOriginalShapeBodySource(shapeId, { validate: false }), solverBuildHash }, { ...options, onProgress: progress('coarse') });
  if (expectedCoarseAssetHash !== null && coarse.assetHash !== expectedCoarseAssetHash) shapeBodyFailure('The rebuilt coarse body differs from the selected exact foundry body. Prepare the current source again.');
  const fine = await solveShapeBody({ source: createOriginalShapeBodySource(shapeId, { refined: true, validate: false }), solverBuildHash }, { ...options, onProgress: progress('fine') });
  const receipt = await compareShapeBodyRefinement({ coarse, fine, comparisonBuildHash, profileId }, options); return { coarse, fine, receipt };
}
