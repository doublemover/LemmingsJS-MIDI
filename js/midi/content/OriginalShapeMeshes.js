import { tetrahedronDeterminant, validateShapeBodySource } from './ShapeBodyAsset.js';
import { freezeData } from '../../core/CanonicalData.js';

const cubeTets = Object.freeze([[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]]);
function solidGrid(nx, ny, nz, transform, omit = () => false) {
  const vertices = [], tetrahedra = [], index = (x, y, z) => (z * ny + y) * nx + x;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) vertices.push(transform(x / (nx - 1), y / (ny - 1), z / (nz - 1)));
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    if (omit(x, y, z)) continue;
    const cube = [index(x, y, z), index(x + 1, y, z), index(x, y + 1, z), index(x + 1, y + 1, z), index(x, y, z + 1), index(x + 1, y, z + 1), index(x, y + 1, z + 1), index(x + 1, y + 1, z + 1)];
    for (const order of cubeTets) { const tet = order.map(i => cube[i]); if (tetrahedronDeterminant(tet.map(i => vertices[i])) < 0) [tet[1], tet[2]] = [tet[2], tet[1]]; tetrahedra.push(tet); }
  }
  return { units: 'authored-model-unit', scaleMeters: 0.6, vertices, tetrahedra };
}
export function createOriginalShapeBodySource(id = 'pocket-bar', { refined = false, validate = true } = {}) {
  let mesh, sites, pickups, young;
  if (id === 'pocket-bar') {
    const nx = refined ? 7 : 4, ny = refined ? 3 : 2, nz = refined ? 3 : 2;
    mesh = solidGrid(nx, ny, nz, (x, y, z) => [x, y * 0.3, z * 0.2]); sites = [0, refined ? 4 : 2, nx * ny - 1]; pickups = [nx * ny * (nz - 1), nx * ny * nz - 1]; young = 9e8;
  } else if (id === 'slotted-plate') {
    if (refined) throw new TypeError('The slotted plate has no qualified refinement mesh in the bounded source profile.');
    mesh = solidGrid(5, 3, 2, (x, y, z) => [x, y * 0.7, z * 0.12], (x, y) => x === 1 && y === 1); sites = [0, 4, 14]; pickups = [15, 29]; young = 4e8;
  } else if (id === 'asymmetric-pebble') {
    if (refined) throw new TypeError('The pebble has no qualified refinement mesh in the bounded source profile.');
    mesh = solidGrid(3, 3, 2, (x, y, z) => { const a = x - 0.5, b = y - 0.5, c = z - 0.5; return [a * (0.9 + 0.12 * b + 0.06 * c), b * (0.7 - 0.08 * a), c * (0.6 + 0.1 * a + 0.08 * b)]; }); sites = [0, 5, 8]; pickups = [9, 17]; young = 1.8e8;
  } else throw new TypeError('Unknown original shape mesh.');
  return (validate ? validateShapeBodySource : freezeData)({ schema: 'lemmings-shape-body-source/v1', id, revision: refined ? 3 : 1, mesh,
    material: { model: 'isotropic-small-strain-elasticity', youngModulusPa: young, densityKgPerM3: 1800, poissonRatio: 0.27, rayleighAlphaPerSecond: 10, rayleighBetaSeconds: 1e-8, interpretation: 'authored-musical-assumptions;not-terrain-material-measurements' },
    boundary: { kind: 'free-solid', fixedVertices: [] }, excitationSites: sites.map((vertex, index) => ({ id: ['end', 'shoulder', 'corner'][index], vertex, direction: [0, 0, 1] })),
    pickupSites: pickups.map((vertex, index) => ({ id: index ? 'right' : 'left', vertex, direction: [0, 0, 1] })), sourceTerrain: null, rights: { creator: 'Original Lemmings shape foundry', licenseId: 'NOASSERTION', source: 'original-authored-geometry' } });
}
export const ORIGINAL_SHAPE_BODY_IDS = freezeData(['pocket-bar', 'slotted-plate', 'asymmetric-pebble']);
