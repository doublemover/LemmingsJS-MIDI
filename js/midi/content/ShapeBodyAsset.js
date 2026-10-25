import { cloneData, freezeData, hashData } from '../../core/CanonicalData.js';

export const SHAPE_BODY_SOLVER_REVISION = 'original-tet4-lumped-mass-cyclic-jacobi-v1';
export const SHAPE_BODY_LIMITS = Object.freeze({ vertices: 64, tetrahedra: 192, sites: 4, modes: 32, sweeps: 80, workingBytes: 32 * 1048576 });
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(value);
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const validatedSources = new WeakSet();
export const shapeBodyFailure = message => { throw Object.assign(new Error('Shape foundry: ' + message), { code: 'invalid-shape-body', name: 'ShapeBodyError' }); };
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const tetrahedronDeterminant = points => dot(subtract(points[1], points[0]), cross(subtract(points[2], points[0]), subtract(points[3], points[0])));
const faces = Object.freeze([[0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 3, 1], [1, 2, 3, 0]]), edges = Object.freeze([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
function interiorsOverlap(a, b) {
  const separated = axis => {
    const length = Math.hypot(...axis); if (length < 1e-24) return false;
    const project = point => dot(point, axis) / length, pa = a.map(project), pb = b.map(project), tolerance = 1e-10 * Math.max(1e-6, ...a.flat().map(Math.abs), ...b.flat().map(Math.abs));
    return Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= tolerance;
  };
  for (const points of [a, b]) for (const [i, j, k] of faces) if (separated(cross(subtract(points[j], points[i]), subtract(points[k], points[i])))) return false;
  for (const [i, j] of edges) for (const [k, l] of edges) if (separated(cross(subtract(a[j], a[i]), subtract(b[l], b[k])))) return false;
  return true;
}
export function validateShapeBodySource(raw) {
  if (raw && validatedSources.has(raw)) return raw;
  const p = cloneData(raw, { maxBytes: 262144, maxNodes: 16384 }), mesh = p?.mesh, material = p?.material, boundary = p?.boundary;
  if (!keys(p, ['schema', 'id', 'revision', 'mesh', 'material', 'boundary', 'excitationSites', 'pickupSites', 'sourceTerrain', 'rights']) || p.schema !== 'lemmings-shape-body-source/v1' || !id(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 1 ||
      !keys(mesh, ['units', 'scaleMeters', 'vertices', 'tetrahedra']) || mesh.units !== 'authored-model-unit' || !finite(mesh.scaleMeters, 1e-4, 100) || !Array.isArray(mesh.vertices) || mesh.vertices.length < 4 || mesh.vertices.length > SHAPE_BODY_LIMITS.vertices || mesh.vertices.some(point => !Array.isArray(point) || point.length !== 3 || point.some(value => !finite(value, -100, 100))) || new Set(mesh.vertices.map(point => JSON.stringify(point))).size !== mesh.vertices.length ||
      !Array.isArray(mesh.tetrahedra) || !mesh.tetrahedra.length || mesh.tetrahedra.length > SHAPE_BODY_LIMITS.tetrahedra || mesh.tetrahedra.some(tet => !Array.isArray(tet) || tet.length !== 4 || new Set(tet).size !== 4 || tet.some(index => !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length)) ||
      !keys(material, ['model', 'youngModulusPa', 'densityKgPerM3', 'poissonRatio', 'rayleighAlphaPerSecond', 'rayleighBetaSeconds', 'interpretation']) || material.model !== 'isotropic-small-strain-elasticity' || !finite(material.youngModulusPa, 1e4, 2e12) || !finite(material.densityKgPerM3, 100, 20000) || !finite(material.poissonRatio, -0.5, 0.45) || !finite(material.rayleighAlphaPerSecond, 0.01, 1000) || !finite(material.rayleighBetaSeconds, 0, 0.01) || material.interpretation !== 'authored-musical-assumptions;not-terrain-material-measurements' ||
      !keys(boundary, ['kind', 'fixedVertices']) || !['free-solid', 'clamped-vertices'].includes(boundary.kind) || !Array.isArray(boundary.fixedVertices) || new Set(boundary.fixedVertices).size !== boundary.fixedVertices.length || boundary.fixedVertices.some(index => !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length) || (boundary.kind === 'free-solid' ? boundary.fixedVertices.length !== 0 : boundary.fixedVertices.length < 3) ||
      !keys(p.rights, ['creator', 'licenseId', 'source']) || typeof p.rights.creator !== 'string' || !p.rights.creator || p.rights.creator.length > 160 || p.rights.licenseId !== 'NOASSERTION' || p.rights.source !== 'original-authored-geometry') shapeBodyFailure('Invalid bounded original solid, material units or boundary assumptions.');
  const positions = mesh.vertices.map(point => point.map(value => value * mesh.scaleMeters)), used = new Set(), faceOwners = new Map(), adjacency = mesh.tetrahedra.map(() => []), seen = new Set(), pointTets = [];
  const extent = Math.max(...[0, 1, 2].map(axis => Math.max(...positions.map(point => point[axis])) - Math.min(...positions.map(point => point[axis]))));
  for (const [index, tet] of mesh.tetrahedra.entries()) {
    const key = [...tet].sort((a, b) => a - b).join(':'), points = tet.map(index => positions[index]);
    if (seen.has(key) || tetrahedronDeterminant(points) <= Math.max(1e-24, extent ** 3 * 1e-10)) shapeBodyFailure('Duplicate, inverted, degenerate or excessively thin tetrahedron.'); seen.add(key); pointTets.push(points); for (const vertex of tet) used.add(vertex);
    for (const [a, b, c] of faces) { const key = [tet[a], tet[b], tet[c]].sort((a, b) => a - b).join(':'), owners = faceOwners.get(key) || []; owners.push(index); if (owners.length > 2) shapeBodyFailure('Non-manifold solid face.'); faceOwners.set(key, owners); }
  }
  for (const owners of faceOwners.values()) if (owners.length === 2) { adjacency[owners[0]].push(owners[1]); adjacency[owners[1]].push(owners[0]); }
  const connected = new Set([0]), queue = [0]; for (let cursor = 0; cursor < queue.length; cursor++) for (const index of adjacency[queue[cursor]]) if (!connected.has(index)) { connected.add(index); queue.push(index); }
  if (connected.size !== mesh.tetrahedra.length || used.size !== positions.length) shapeBodyFailure('Disconnected solid or unused vertices.');
  const boundaryEdges = new Map();
  for (const [key, owners] of faceOwners) if (owners.length === 1) { const vertices = key.split(':').map(Number); for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) { const edge = [vertices[a], vertices[b]].sort((a, b) => a - b).join(':'); boundaryEdges.set(edge, (boundaryEdges.get(edge) || 0) + 1); } }
  if ([...boundaryEdges.values()].some(count => count !== 2)) shapeBodyFailure('The solid boundary is not a closed manifold.');
  for (let a = 0; a < pointTets.length; a++) for (let b = a + 1; b < pointTets.length; b++) if (interiorsOverlap(pointTets[a], pointTets[b])) shapeBodyFailure('Solid tetrahedra have overlapping interiors.');
  for (const [kind, sites] of [['excitation', p.excitationSites], ['pickup', p.pickupSites]]) {
    if (!Array.isArray(sites) || !sites.length || sites.length > SHAPE_BODY_LIMITS.sites || new Set(sites.map(site => site?.id)).size !== sites.length || sites.some(site => !keys(site, ['id', 'vertex', 'direction']) || !id(site.id) || !Number.isInteger(site.vertex) || site.vertex < 0 || site.vertex >= positions.length || boundary.fixedVertices.includes(site.vertex) || !Array.isArray(site.direction) || site.direction.length !== 3 || site.direction.some(value => !finite(value, -1, 1)) || Math.abs(Math.hypot(...site.direction) - 1) > 1e-9)) shapeBodyFailure('Invalid explicit ' + kind + ' vertex or unit direction.');
  }
  if (p.sourceTerrain !== null && (!keys(p.sourceTerrain, ['revision', 'pixelToMeterScale', 'extrusionThicknessMeters', 'interpretation']) || !Number.isSafeInteger(p.sourceTerrain.revision) || p.sourceTerrain.revision < 0 || !finite(p.sourceTerrain.pixelToMeterScale, 1e-6, 100) || !finite(p.sourceTerrain.extrusionThicknessMeters, 1e-6, 10) || p.sourceTerrain.interpretation !== 'chosen-extruded-solid;not-true-terrain-acoustics')) shapeBodyFailure('Terrain ancestry requires explicit chosen scale and extrusion thickness.');
  validatedSources.add(p); return p;
}

export const shapeBodySourceHash = source => hashData(validateShapeBodySource(source), { maxBytes: 262144, maxNodes: 16384 });
export function shapeAmplitudeT60(angularFrequency, dampingRatio) {
  if (!finite(angularFrequency, 1e-6, 1e9) || !finite(dampingRatio, 1e-12, 0.999999)) shapeBodyFailure('Amplitude T60 requires angular frequency in radians/second and an underdamped ratio.');
  return Math.log(1000) / (angularFrequency * dampingRatio);
}
export async function verifyShapeBodyAsset(raw) {
  const p = cloneData(raw, { maxBytes: 2 * 1048576, maxNodes: 131072 });
  if (!p || p.schema !== 'lemmings-shape-body-asset/v1' || !/^[a-f0-9]{64}$/.test(p.assetHash) || !/^[a-f0-9]{64}$/.test(p.sourceHash) || !/^[a-f0-9]{64}$/.test(p.meshHash) || p.solver?.revision !== SHAPE_BODY_SOLVER_REVISION || !/^[a-f0-9]{64}$/.test(p.solver.buildHash)) shapeBodyFailure('Missing immutable source, solver or asset identity.');
  const { assetHash, ...body } = p;
  if (await hashData(body, { maxBytes: 2 * 1048576, maxNodes: 131072 }) !== assetHash) shapeBodyFailure('Modal body differs from its exact artifact hash.');
  const source = validateShapeBodySource(p.source), validation = p.validation, dimension = (source.mesh.vertices.length - source.boundary.fixedVertices.length) * 3, rigidModes = source.boundary.kind === 'free-solid' ? 6 : 0;
  if (p.id !== source.id || p.revision !== source.revision || await shapeBodySourceHash(source) !== p.sourceHash || await hashData(source.mesh) !== p.meshHash || validation?.algebraicStatus !== 'converged' || validation.dimension !== dimension || validation.rigidModes !== rigidModes || !Number.isInteger(validation.sweeps) || validation.sweeps < 1 || validation.sweeps > SHAPE_BODY_LIMITS.sweeps || !finite(validation.relativeOffDiagonalNorm, 0, 1e-12) || !finite(validation.largestRelativeResidual, 0, 1e-9) || !finite(validation.largestOrthogonalityError, 0, 1e-9) || !finite(validation.totalMassKg, 1e-18, 1e20) || !finite(validation.totalVolumeM3, 1e-24, 1e18) || !Array.isArray(p.modes) || p.modes.length !== dimension - rigidModes) shapeBodyFailure('Modal body has an inconsistent algebraic validation receipt.');
  for (const [index, mode] of p.modes.entries()) {
    if (!keys(mode, ['index', 'angularFrequencyRadiansPerSecond', 'frequencyHz', 'dampingRatio', 't60Seconds', 'excitation', 'pickup', 'displacementPerRootKg', 'salience']) || mode.index !== index || !finite(mode.angularFrequencyRadiansPerSecond, 1e-6, 1e9) || !finite(mode.frequencyHz, 1e-6, 1e9) || !finite(mode.dampingRatio, 1e-12, 0.999999) || !finite(mode.t60Seconds, 1e-8, 2000) || !finite(mode.salience, 0, 1e30) || !Array.isArray(mode.displacementPerRootKg) || mode.displacementPerRootKg.length !== source.mesh.vertices.length * 3 || mode.displacementPerRootKg.some(value => !Number.isFinite(value)) || Math.abs(shapeAmplitudeT60(mode.angularFrequencyRadiansPerSecond, mode.dampingRatio) - mode.t60Seconds) > mode.t60Seconds * 1e-10 || Math.abs(mode.angularFrequencyRadiansPerSecond * Math.sqrt(1 - mode.dampingRatio ** 2) / (2 * Math.PI) - mode.frequencyHz) > mode.frequencyHz * 1e-10) shapeBodyFailure('Invalid signed modal data or amplitude-T60 units.');
    for (const [sites, weights] of [[source.excitationSites, mode.excitation], [source.pickupSites, mode.pickup]]) {
      if (!Array.isArray(weights) || weights.length !== sites.length || weights.some(value => !Number.isFinite(value))) shapeBodyFailure('A curated site has no complete signed modal gain vector.');
      for (let site = 0; site < sites.length; site++) { const value = sites[site].direction.reduce((sum, component, axis) => sum + component * mode.displacementPerRootKg[sites[site].vertex * 3 + axis], 0); if (Math.abs(value - weights[site]) > 1e-9 * Math.max(1, Math.abs(value))) shapeBodyFailure('Site gain does not match the retained signed mode shape.'); }
    }
  }
  return p;
}
export function selectShapeBodyTier(asset, { modeCount = 8, sampleRate = 48000 } = {}) {
  if (asset?.schema !== 'lemmings-shape-body-asset/v1' || asset.solver?.revision !== SHAPE_BODY_SOLVER_REVISION || asset.validation?.algebraicStatus !== 'converged' || ![8, 16, 32].includes(modeCount) || ![44100, 48000, 96000].includes(sampleRate)) shapeBodyFailure('Select an algebraically converged body and explicit supported mode count/sample rate.');
  const minimumSalience = Math.max(...asset.modes.map(mode => mode.salience)) * 1e-12;
  const audible = asset.modes.filter(mode => mode.salience > minimumSalience && mode.frequencyHz >= 20 && mode.frequencyHz <= sampleRate * 0.4 && mode.t60Seconds >= 0.02 && mode.t60Seconds <= 4).sort((a, b) => b.salience - a.salience || a.index - b.index);
  if (audible.length < modeCount || !audible.some(mode => mode.salience > 0)) shapeBodyFailure('This mesh/material does not supply enough supported audible modes for the requested tier.');
  const selected = audible.slice(0, modeCount).sort((a, b) => a.frequencyHz - b.frequencyHz || a.index - b.index), total = audible.reduce((sum, mode) => sum + mode.salience, 0);
  return freezeData({ modeCount, sampleRate, modeIndices: selected.map(mode => mode.index), modes: selected, selectionPolicy: 'largest-all-curated-site-to-pickup-impulse-residue-energy;frequency-tie-order', retainedSalience01: selected.reduce((sum, mode) => sum + mode.salience, 0) / total,
    lossClaim: 'numerical-residue-metric;not-perceptual-equivalence', qualification: 'awaiting-mesh-refinement-calibration-listening-and-device-evidence' });
}
