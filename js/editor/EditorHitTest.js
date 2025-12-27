const coerceNumber = (value, fallback = 0) => {
  return Number.isFinite(value) ? value : fallback;
};

const getEntryBounds = (entry, meta = {}, options = {}) => {
  const props = entry?.props || {};
  const safeMeta = meta || {};
  const x = coerceNumber(props.X, 0);
  const y = coerceNumber(props.Y, 0);
  const widthFallback = options.widthFallback ?? safeMeta.width ?? 8;
  const heightFallback = options.heightFallback ?? safeMeta.height ?? 8;
  const width = coerceNumber(props.WIDTH, widthFallback);
  const height = coerceNumber(props.HEIGHT, heightFallback);
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  return { x, y, width: w, height: h };
};

const hitTestBounds = (bounds, x, y) => {
  if (!bounds) return false;
  return x >= bounds.x
    && y >= bounds.y
    && x <= bounds.x + bounds.width
    && y <= bounds.y + bounds.height;
};

const hitTestEntry = (entry, meta, x, y, options) => {
  const bounds = getEntryBounds(entry, meta, options);
  return hitTestBounds(bounds, x, y);
};

const findEntryAt = (entries, metaById, x, y, options = {}) => {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const props = entry?.props || {};
    const meta = metaById?.get?.(props.PIECE) || null;
    if (hitTestEntry(entry, meta, x, y, options)) {
      return { index: i, entry, bounds: getEntryBounds(entry, meta, options) };
    }
  }
  return null;
};

export { getEntryBounds, hitTestBounds, hitTestEntry, findEntryAt };
