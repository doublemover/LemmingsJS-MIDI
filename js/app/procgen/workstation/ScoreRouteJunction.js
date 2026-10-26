import { validateProjectJunctions } from './PhysicalJunctionProject.js';

export function createScoreStepJunction({ id, layoutHash, floorY, firstX = 208 } = {}) {
  const lastX = firstX + 48;
  return validateProjectJunctions([{ id, revision: 1, safetyVersion: 1,
    control: { x1: firstX, x2: lastX, y1: floorY, y2: floorY + 16 }, influence: { x1: firstX - 16, x2: lastX + 16, y1: floorY - 24, y2: floorY + 24 },
    ports: [{ id: 'in', role: 'inlet', position: { x: firstX - 14, y: floorY }, direction: 'right', support: [{ dx: 0, dy: 1, solid: true }] }, { id: 'out', role: 'outlet', position: { x: lastX + 14, y: floorY }, direction: 'right', support: [{ dx: 0, dy: 1, solid: true }] }],
    configurations: [{ id: 'direct', outletIds: ['out'], spans: Array.from({ length: 16 }, (_, row) => ({ y: floorY + row, x1: firstX, x2: lastX, solid: true })) },
      { id: 'stepped', outletIds: ['out'], spans: Array.from({ length: 16 }, (_, row) => { const x = firstX + 16 + (Math.ceil((16 - row) / 2) - 1) * 4; return [{ y: floorY + row, x1: firstX, x2: x, solid: false }, { y: floorY + row, x1: x, x2: lastX, solid: true }]; }).flat() }], requiredAssets: [layoutHash] }]);
}
