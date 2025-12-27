const DEFAULT_TERRAIN_COUNT = 64;
const DEFAULT_GADGET_COUNT = 16;

const styles = new Map();
const styleOrder = [];

function normalizeStyleName(name) {
  if (name == null) return '';
  return String(name).trim().toLowerCase();
}

function normalizePieceName(name) {
  if (name == null) return '';
  return String(name).trim().toLowerCase();
}

function coercePieceId(piece) {
  if (typeof piece === 'number' && Number.isFinite(piece)) return piece | 0;
  if (typeof piece !== 'string') return null;
  const trimmed = piece.trim();
  if (!trimmed) return null;
  if (!/^-?\d+$/.test(trimmed)) return null;
  return parseInt(trimmed, 10);
}

function createGenericPieces(prefix, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: i, name: `${prefix}${i}` });
  }
  return out;
}

function buildIndex(pieces) {
  const byName = new Map();
  const byId = new Map();
  for (const piece of pieces) {
    if (!piece || piece.id == null || piece.name == null) continue;
    const id = coercePieceId(piece.id);
    if (id == null) continue;
    const key = normalizePieceName(piece.name);
    if (!key) continue;
    const entry = { id, name: piece.name };
    byName.set(key, entry);
    byId.set(id, entry);
  }
  return { byName, byId };
}

function registerStyle(name, definition = {}) {
  const key = normalizeStyleName(name);
  if (!key) throw new Error('Style name is required');
  const groundSet = Number.isFinite(definition.groundSet)
    ? definition.groundSet | 0
    : 0;
  const terrainPieces = definition.terrainPieces
    ? definition.terrainPieces.slice()
    : createGenericPieces('terrain_', DEFAULT_TERRAIN_COUNT);
  const gadgetPieces = definition.gadgetPieces
    ? definition.gadgetPieces.slice()
    : createGenericPieces('object_', DEFAULT_GADGET_COUNT);
  const terrainIndex = buildIndex(terrainPieces);
  const gadgetIndex = buildIndex(gadgetPieces);

  const style = {
    name: String(name).trim(),
    key,
    groundSet,
    terrainPieces,
    gadgetPieces,
    terrainByName: terrainIndex.byName,
    terrainById: terrainIndex.byId,
    gadgetByName: gadgetIndex.byName,
    gadgetById: gadgetIndex.byId
  };

  if (!styles.has(key)) styleOrder.push(key);
  styles.set(key, style);
  return style;
}

function getStyle(name) {
  const key = normalizeStyleName(name);
  if (!key) return null;
  return styles.get(key) || null;
}

function getStyleByGroundSet(groundSet) {
  if (!Number.isFinite(groundSet)) return null;
  for (const key of styleOrder) {
    const style = styles.get(key);
    if (style && style.groundSet === (groundSet | 0)) return style;
  }
  return null;
}

function getStyleNames() {
  return styleOrder.map(key => styles.get(key)?.name).filter(Boolean);
}

function getDefaultStyle() {
  const firstKey = styleOrder[0];
  return firstKey ? styles.get(firstKey) : null;
}

function resolveTerrainId(styleName, piece) {
  const numeric = coercePieceId(piece);
  if (numeric != null) return numeric;
  const style = getStyle(styleName);
  if (!style) return null;
  const key = normalizePieceName(piece);
  if (!key) return null;
  return style.terrainByName.get(key)?.id ?? null;
}

function resolveTerrainName(styleName, id) {
  const numeric = coercePieceId(id);
  if (numeric == null) return null;
  const style = getStyle(styleName);
  if (!style) return null;
  return style.terrainById.get(numeric)?.name ?? null;
}

function resolveGadgetId(styleName, piece) {
  const numeric = coercePieceId(piece);
  if (numeric != null) return numeric;
  const style = getStyle(styleName);
  if (!style) return null;
  const key = normalizePieceName(piece);
  if (!key) return null;
  return style.gadgetByName.get(key)?.id ?? null;
}

function resolveGadgetName(styleName, id) {
  const numeric = coercePieceId(id);
  if (numeric == null) return null;
  const style = getStyle(styleName);
  if (!style) return null;
  return style.gadgetById.get(numeric)?.name ?? null;
}

function resetStyleRegistry() {
  styles.clear();
  styleOrder.length = 0;
}

function registerClassicStyles() {
  const classic = [
    { name: 'dirt', groundSet: 0 },
    { name: 'fire', groundSet: 1 },
    { name: 'squasher', groundSet: 2 },
    { name: 'pillar', groundSet: 3 },
    { name: 'crystal', groundSet: 4 },
    { name: 'brick', groundSet: 5 },
    { name: 'rock', groundSet: 6 },
    { name: 'snow', groundSet: 7 },
    { name: 'bubble', groundSet: 8 }
  ];
  for (const entry of classic) {
    registerStyle(entry.name, { groundSet: entry.groundSet });
  }
}

registerClassicStyles();

export {
  DEFAULT_TERRAIN_COUNT,
  DEFAULT_GADGET_COUNT,
  registerStyle,
  getStyle,
  getStyleByGroundSet,
  getStyleNames,
  getDefaultStyle,
  resolveTerrainId,
  resolveTerrainName,
  resolveGadgetId,
  resolveGadgetName,
  resetStyleRegistry,
  registerClassicStyles
};
