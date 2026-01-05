const coerceNumber = (value, fallback = 0) => {
  return Number.isFinite(value) ? value : fallback;
};

const getEntryBounds = (entry, meta = {}, options = {}) => {
  const props = entry?.props || {};
  const safeMeta = meta || {};
  const x = coerceNumber(props.X, 0);
  const y = coerceNumber(props.Y, 0);
  const metaWidth = Number.isFinite(safeMeta?.width) ? safeMeta.width : null;
  const metaHeight = Number.isFinite(safeMeta?.height) ? safeMeta.height : null;
  const steelWidth = safeMeta?.isSteel && Number.isFinite(safeMeta?.steelWidth)
    ? safeMeta.steelWidth
    : null;
  const steelHeight = safeMeta?.isSteel && Number.isFinite(safeMeta?.steelHeight)
    ? safeMeta.steelHeight
    : null;
  const hasMetaSize = Number.isFinite(metaWidth) && metaWidth > 0
    && Number.isFinite(metaHeight) && metaHeight > 0;
  const useEntrySize = options.allowEntrySize === true || !hasMetaSize;
  const widthFallback = options.widthFallback
    ?? (steelWidth && steelWidth > 0 ? steelWidth : (metaWidth && metaWidth > 0 ? metaWidth : null))
    ?? 8;
  const heightFallback = options.heightFallback
    ?? (steelHeight && steelHeight > 0 ? steelHeight : (metaHeight && metaHeight > 0 ? metaHeight : null))
    ?? 8;
  const width = coerceNumber(useEntrySize ? props.WIDTH : null, widthFallback);
  const height = coerceNumber(useEntrySize ? props.HEIGHT : null, heightFallback);
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
