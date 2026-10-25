import { validateShapeBodySource, shapeBodySourceHash, shapeBodyFailure, SHAPE_BODY_LIMITS, SHAPE_BODY_SOLVER_REVISION, shapeAmplitudeT60 } from '../../midi/content/ShapeBodyAsset.js';
import { freezeData, hashData } from '../../core/CanonicalData.js';

const subtract = (a, b) => a.map((value, index) => value - b[index]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
export function assembleShapeBodySystem(raw) {
  const source = validateShapeBodySource(raw), points = source.mesh.vertices.map(point => point.map(value => value * source.mesh.scaleMeters)), dofs = points.length * 3, stiffness = new Float64Array(dofs * dofs), mass = new Float64Array(dofs);
  const { youngModulusPa: e, poissonRatio: nu, densityKgPerM3: density } = source.material, lambda = e * nu / ((1 + nu) * (1 - 2 * nu)), mu = e / (2 * (1 + nu)); let totalVolume = 0;
  for (const tet of source.mesh.tetrahedra) {
    const a = subtract(points[tet[1]], points[tet[0]]), b = subtract(points[tet[2]], points[tet[0]]), c = subtract(points[tet[3]], points[tet[0]]), determinant = dot(a, cross(b, c)), volume = determinant / 6;
    const gradients = [null, cross(b, c).map(value => value / determinant), cross(c, a).map(value => value / determinant), cross(a, b).map(value => value / determinant)]; gradients[0] = [0, 1, 2].map(axis => -gradients[1][axis] - gradients[2][axis] - gradients[3][axis]);
    const columns = [], elastic = [];
    for (const [x, y, z] of gradients) columns.push([x, 0, 0, 0, z, y], [0, y, 0, z, 0, x], [0, 0, z, y, x, 0]);
    for (const column of columns) { const trace = column[0] + column[1] + column[2]; elastic.push(column.map((value, index) => index < 3 ? 2 * mu * value + lambda * trace : mu * value)); }
    for (let i = 0; i < 12; i++) {
      const row = tet[Math.floor(i / 3)] * 3 + i % 3; mass[row] += density * volume / 4;
      for (let j = i; j < 12; j++) { const col = tet[Math.floor(j / 3)] * 3 + j % 3, value = volume * dot(columns[i], elastic[j]); stiffness[row * dofs + col] += value; if (row !== col) stiffness[col * dofs + row] += value; }
    }
    totalVolume += volume;
  }
  const fixed = new Set(source.boundary.fixedVertices), free = Array.from({ length: dofs }, (_, index) => index).filter(index => !fixed.has(Math.floor(index / 3))), n = free.length, matrix = new Float64Array(n * n);
  if (n < 8 || mass.some(value => !(value > 0) || !Number.isFinite(value))) shapeBodyFailure('The solid has an unsupported unconstrained dimension or invalid lumped mass.');
  let scale = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const value = stiffness[free[i] * dofs + free[j]] / Math.sqrt(mass[free[i]] * mass[free[j]]); if (!Number.isFinite(value)) shapeBodyFailure('Nonfinite elastic assembly.'); matrix[i * n + j] = value; if (i === j) scale = Math.max(scale, value); }
  if (!(scale > 0)) shapeBodyFailure('Degenerate elastic normalization.'); for (let i = 0; i < matrix.length; i++) matrix[i] /= scale;
  return { source, points, stiffness, mass, free, matrix, scale, dimension: n, totalVolume, totalMassKg: totalVolume * density };
}

export async function solveShapeBody(input, { estimatedPeakBytes = SHAPE_BODY_LIMITS.workingBytes, signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const started = Date.now(), check = () => { signal?.throwIfAborted(); if (!current()) shapeBodyFailure('The geometry owner changed.'); if (Date.now() - started > 30000) shapeBodyFailure('The bounded offline eigensolve exceeded its time allowance.'); };
  check(); if (!input || Object.keys(input).some(key => !['source', 'solverBuildHash'].includes(key)) || !/^[a-f0-9]{64}$/.test(input.solverBuildHash) || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < SHAPE_BODY_LIMITS.workingBytes || estimatedPeakBytes > 512 * 1048576) shapeBodyFailure('The offline solver needs an exact build/source identity and admitted workspace.');
  const system = assembleShapeBodySystem(input.source), { dimension: n, matrix: original, scale, source, free, mass } = system, a = original.slice(), vectors = new Float64Array(n * n);
  for (let i = 0; i < n; i++) vectors[i * n + i] = 1;
  const norm = Math.sqrt(original.reduce((sum, value) => sum + value * value, 0)); let sweeps = 0, offDiagonalNorm = Infinity;
  for (; sweeps < SHAPE_BODY_LIMITS.sweeps; sweeps++) {
    check();
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const pq = a[p * n + q]; if (Math.abs(pq) <= 1e-16 * norm) continue;
      const tau = (a[q * n + q] - a[p * n + p]) / (2 * pq), t = (tau < 0 ? -1 : 1) / (Math.abs(tau) + Math.hypot(1, tau)), c = 1 / Math.hypot(1, t), s = t * c;
      a[p * n + p] -= t * pq; a[q * n + q] += t * pq; a[p * n + q] = a[q * n + p] = 0;
      for (let r = 0; r < n; r++) {
        if (r !== p && r !== q) { const rp = a[r * n + p], rq = a[r * n + q]; a[r * n + p] = a[p * n + r] = c * rp - s * rq; a[r * n + q] = a[q * n + r] = s * rp + c * rq; }
        const vp = vectors[r * n + p], vq = vectors[r * n + q]; vectors[r * n + p] = c * vp - s * vq; vectors[r * n + q] = s * vp + c * vq;
      }
    }
    let offSquared = 0; for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) offSquared += 2 * a[p * n + q] ** 2;
    offDiagonalNorm = Math.sqrt(offSquared); onProgress({ phase: 'diagonalizing-authored-solid', completedUnits: sweeps + 1, totalUnits: SHAPE_BODY_LIMITS.sweeps }); await yieldControl();
    if (offDiagonalNorm <= norm * 1e-12) { sweeps++; break; }
  }
  check(); if (offDiagonalNorm > norm * 1e-12) shapeBodyFailure('The bounded eigensolve did not converge; no playable artifact was produced.');
  let largestResidual = 0, largestOrthogonalityError = 0;
  for (let column = 0; column < n; column++) {
    const eigenvalue = a[column * n + column]; let squares = 0;
    for (let row = 0; row < n; row++) { let product = 0; for (let k = 0; k < n; k++) product += original[row * n + k] * vectors[k * n + column]; squares += (product - eigenvalue * vectors[row * n + column]) ** 2; }
    largestResidual = Math.max(largestResidual, Math.sqrt(squares) / (norm + Math.abs(eigenvalue)));
    for (let other = 0; other <= column; other++) { let product = 0; for (let row = 0; row < n; row++) product += vectors[row * n + column] * vectors[row * n + other]; largestOrthogonalityError = Math.max(largestOrthogonalityError, Math.abs(product - Number(other === column))); }
    if (column % 8 === 7) { check(); await yieldControl(); }
  }
  if (largestResidual > 1e-9 || largestOrthogonalityError > 1e-9) shapeBodyFailure('Eigenpair residual or modal orthogonality did not qualify.');
  const eigenvalues = Array.from({ length: n }, (_, index) => ({ index, value: a[index * n + index] })).sort((a, b) => a.value - b.value || a.index - b.index), largest = eigenvalues.at(-1).value, tolerance = largest * 1e-10;
  if (eigenvalues.some(mode => mode.value < -tolerance)) shapeBodyFailure('The elastic system contains negative energy modes.');
  const rigidModes = eigenvalues.filter(mode => Math.abs(mode.value) <= tolerance).length, expectedRigid = source.boundary.kind === 'free-solid' ? 6 : 0;
  if (rigidModes !== expectedRigid) shapeBodyFailure('Unexpected zero modes: disconnected, insufficiently constrained or underresolved geometry.');
  const modes = [];
  for (const eigen of eigenvalues.filter(mode => mode.value > tolerance)) {
    check(); const omega = Math.sqrt(eigen.value * scale), sigma = (source.material.rayleighAlphaPerSecond + source.material.rayleighBetaSeconds * omega * omega) / 2, ratio = sigma / omega;
    if (!(ratio > 0 && ratio < 1)) shapeBodyFailure('Authored damping makes a mode non-oscillatory; choose an explicit underdamped material.');
    const displacement = new Array(mass.length).fill(0); let sign = 1, largestComponent = 0;
    for (let row = 0; row < n; row++) { const value = vectors[row * n + eigen.index]; if (Math.abs(value) > largestComponent) { largestComponent = Math.abs(value); sign = value < 0 ? -1 : 1; } }
    for (let row = 0; row < n; row++) displacement[free[row]] = sign * vectors[row * n + eigen.index] / Math.sqrt(mass[free[row]]);
    const weights = sites => sites.map(site => dot(displacement.slice(site.vertex * 3, site.vertex * 3 + 3), site.direction)), excitation = weights(source.excitationSites), pickup = weights(source.pickupSites);
    const frequencyHz = Math.sqrt(omega * omega - sigma * sigma) / (2 * Math.PI), salience = excitation.reduce((sum, x) => sum + pickup.reduce((s, y) => s + (x * y) ** 2 / (4 * sigma * omega * omega), 0), 0);
    modes.push({ index: modes.length, angularFrequencyRadiansPerSecond: omega, frequencyHz, dampingRatio: ratio, t60Seconds: shapeAmplitudeT60(omega, ratio), excitation, pickup, displacementPerRootKg: displacement, salience });
  }
  if (!modes.length || modes.some(mode => !Number.isFinite(mode.salience)) || !modes.some(mode => mode.salience > 0)) shapeBodyFailure('The chosen sites have no nondegenerate modal response.');
  const body = { schema: 'lemmings-shape-body-asset/v1', id: source.id, revision: source.revision, source, sourceHash: await shapeBodySourceHash(source), meshHash: await hashData(source.mesh),
    solver: { revision: SHAPE_BODY_SOLVER_REVISION, buildHash: input.solverBuildHash, method: 'constant-strain-tetrahedra;lumped-mass;mass-whitened-symmetric-cyclic-Jacobi', reproducibility: 'pinned-source-and-solver;floating-eigenpair-tolerance;degenerate-subspace-basis-not-cross-platform-bitwise' },
    units: { position: 'meters-after-explicit-scale', density: 'kg/m3', youngModulus: 'Pa', frequency: 'Hz', angularFrequency: 'radians/second', decay: 'amplitude-T60-seconds', modalDisplacement: '1/sqrt(kg)', excitation: 'signed-unit-site-direction', pickup: 'independent-signed-unit-site-direction' },
    validation: { algebraicStatus: 'converged', dimension: n, sweeps, relativeOffDiagonalNorm: offDiagonalNorm / norm, largestRelativeResidual: largestResidual, largestOrthogonalityError, rigidModes, totalVolumeM3: system.totalVolume, totalMassKg: system.totalMassKg,
      geometry: 'positive-tet-volumes;single-face-connected-solid;closed-manifold-boundary;nonoverlapping-interiors', meshConvergence: 'not-qualified;refinement-comparison-required', acousticAccuracy: 'authored-linear-elastic-model;not-measured-material', renderListeningAndCost: 'not-qualified' }, modes };
  check(); const assetHash = await hashData(body, { maxBytes: 2 * 1048576, maxNodes: 131072 }); check(); return freezeData({ ...body, assetHash });
}
