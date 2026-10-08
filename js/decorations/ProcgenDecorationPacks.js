import { createNeonCabaretPack } from './NeonCabaretPack.js';
import { createOldVegasPack } from './OldVegasPack.js';

const DECORATION_CHOICES = [{ id: 'none', label: 'Original scenery' }, { id: 'old-vegas', label: 'Old Vegas · Grand Revue' }, { id: 'neon-cabaret', label: 'Neon Cabaret Power Station' }];
let neonPack;
const getDecorationPack = id => id === 'old-vegas' ? createOldVegasPack() : id === 'neon-cabaret' ? (neonPack ||= createNeonCabaretPack()) : null;

const placementGroups = new WeakMap();
const getPlacementGroups = pack => {
  let groups = placementGroups.get(pack);
  if (!groups || groups.pieces !== pack.pieces || groups.count !== pack.pieces.length) {
    groups = { pieces: pack.pieces, count: pack.pieces.length, ceiling: [], stages: [], trims: [], rope: null };
    for (const piece of pack.pieces) {
      if (piece.placement === 'ceiling') groups.ceiling.push(piece);
      else if (piece.placement === 'stage') groups.stages.push(piece);
      else if (piece.placement === 'trim') groups.trims.push(piece);
      if (piece.id === 'casino-bulb-rope' && !groups.rope) groups.rope = piece;
    }
    placementGroups.set(pack, groups);
  }
  return groups;
};

// A presentation-only catalog. It never adds terrain, steel or trigger masks.
function decorationPlacements(pack, lane, chunk, chunkWidth = 128) {
  if (!pack) return [];
  const { ceiling, stages, trims, rope } = getPlacementGroups(pack);
  const origin = chunk * chunkWidth, phase = (lane * 3 + chunk * 5) % 16, result = [];
  const add = (piece, x, y) => { if (piece) result.push({ piece, x, y, phase, scale: piece.placement === 'stage' ? Math.min(1, 68 / piece.image.height) : piece.placement === 'trim' ? Math.min(1, 16 / piece.image.height) : 1, interactive: false }); };
  if (rope && chunk % 2 === 0) add(rope, origin, 0);
  if (chunk % 4 === 0 && stages.length) add(stages[(Math.floor(chunk / 4) + lane) % stages.length], origin + 16, 4);
  else add(ceiling[(chunk + lane * 7) % ceiling.length], origin + 8, 1);
  add(trims[(chunk + lane) % trims.length], origin, 80);
  return result;
}
export { DECORATION_CHOICES, getDecorationPack, decorationPlacements };
