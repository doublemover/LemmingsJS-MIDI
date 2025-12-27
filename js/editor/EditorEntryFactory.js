const normalizeKey = (key) => {
  if (key == null) return '';
  return String(key).trim().toUpperCase();
};

const createEntry = (props = {}, order = null) => {
  const filtered = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === '') continue;
    filtered[normalizeKey(key)] = value;
  }
  return {
    props: filtered,
    order: Array.isArray(order) && order.length ? order.slice() : Object.keys(filtered),
    unknownLines: []
  };
};

const setEntryProp = (entry, key, value, options = {}) => {
  if (!entry || !entry.props) return;
  const normalized = normalizeKey(key);
  if (!normalized) return;
  const removeIfFalse = options.removeIfFalse === true;
  const removeIfEmpty = options.removeIfEmpty !== false;

  const shouldRemove =
    (removeIfFalse && value === false)
    || (removeIfEmpty && (value === undefined || value === null || value === ''));

  if (shouldRemove) {
    if (Object.prototype.hasOwnProperty.call(entry.props, normalized)) {
      delete entry.props[normalized];
      const idx = entry.order.indexOf(normalized);
      if (idx >= 0) entry.order.splice(idx, 1);
    }
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(entry.props, normalized)) {
    entry.order.push(normalized);
  }
  entry.props[normalized] = value;
};

const createTerrainEntry = (params = {}) => {
  return createEntry({
    STYLE: params.styleName,
    PIECE: params.piece,
    X: params.x,
    Y: params.y,
    FLIP_HORIZONTAL: params.flipH ? true : undefined,
    FLIP_VERTICAL: params.flipV ? true : undefined,
    NO_OVERWRITE: params.noOverwrite ? true : undefined,
    ERASE: params.erase ? true : undefined,
    ONE_WAY: params.oneWay ? true : undefined,
    WIDTH: params.width,
    HEIGHT: params.height
  });
};

const createGadgetEntry = (params = {}) => {
  return createEntry({
    STYLE: params.styleName,
    PIECE: params.piece,
    X: params.x,
    Y: params.y,
    FLIP_HORIZONTAL: params.flipH ? true : undefined,
    FLIP_VERTICAL: params.flipV ? true : undefined,
    ROTATE: params.rotate,
    WIDTH: params.width,
    HEIGHT: params.height,
    SKILL: params.skill,
    LEMMINGS: params.lemmings,
    PAIRING: params.pairing
  });
};

const createSteelEntry = (params = {}) => {
  return createEntry({
    X: params.x,
    Y: params.y,
    WIDTH: params.width,
    HEIGHT: params.height
  });
};

const removeEntryAt = (level, type, index) => {
  if (!level || typeof index !== 'number') return null;
  const list = type === 'gadget'
    ? level.gadgets
    : type === 'steel'
      ? level.steel
      : level.terrains;
  if (!Array.isArray(list) || index < 0 || index >= list.length) return null;
  return list.splice(index, 1)[0] || null;
};

export {
  createEntry,
  createTerrainEntry,
  createGadgetEntry,
  createSteelEntry,
  setEntryProp,
  removeEntryAt
};
