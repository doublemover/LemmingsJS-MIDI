const STORAGE_KEYS = Object.freeze({
  index: 'lemmings.editor.levels',
  levelPrefix: 'lemmings.editor.level.'
});

let idCounter = 0;

const getDefaultStorage = () => globalThis.localStorage || null;

const safeGetItem = (storage, key) => {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch (e) {
    return null;
  }
};

const safeSetItem = (storage, key, value) => {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch (e) {
    return false;
  }
};

const safeRemoveItem = (storage, key) => {
  try {
    storage?.removeItem?.(key);
    return true;
  } catch (e) {
    return false;
  }
};

const normalizeName = (name) => {
  const trimmed = String(name || '').trim();
  return trimmed ? trimmed : 'Untitled';
};

const parseIndex = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

const sanitizeIndex = (entries) => entries
  .filter(entry => entry && typeof entry.id === 'string' && entry.id.trim())
  .map(entry => ({
    id: entry.id.trim(),
    name: normalizeName(entry.name),
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0
  }));

const writeIndex = (storage, entries) => {
  const payload = JSON.stringify(entries);
  safeSetItem(storage, STORAGE_KEYS.index, payload);
};

const createLevelId = (now = () => Date.now()) => {
  idCounter = (idCounter + 1) % 100000;
  return `level-${now()}-${idCounter}`;
};

const compareSavedLevels = (a, b) => {
  const nameA = String(a?.name || '').toLowerCase();
  const nameB = String(b?.name || '').toLowerCase();
  if (nameA < nameB) return -1;
  if (nameA > nameB) return 1;
  return (b?.updatedAt || 0) - (a?.updatedAt || 0);
};

const listSavedLevels = (storage = getDefaultStorage()) => {
  const raw = safeGetItem(storage, STORAGE_KEYS.index);
  const entries = sanitizeIndex(parseIndex(raw));
  entries.sort(compareSavedLevels);
  return entries;
};

const loadSavedLevel = (storage = getDefaultStorage(), id) => {
  if (!id) return null;
  const raw = safeGetItem(storage, STORAGE_KEYS.levelPrefix + id);
  return typeof raw === 'string' ? raw : null;
};

const saveLevel = (storage = getDefaultStorage(), payload = {}) => {
  if (!storage) return null;
  const now = Number.isFinite(payload.updatedAt) ? payload.updatedAt : Date.now();
  const id = payload.id || createLevelId(payload.now || (() => now));
  const name = normalizeName(payload.name);
  const text = typeof payload.text === 'string' ? payload.text : '';
  const index = sanitizeIndex(parseIndex(safeGetItem(storage, STORAGE_KEYS.index)));
  const existing = index.find(entry => entry.id === id);
  if (existing) {
    existing.name = name;
    existing.updatedAt = now;
  } else {
    index.push({ id, name, updatedAt: now });
  }
  safeSetItem(storage, STORAGE_KEYS.levelPrefix + id, text);
  writeIndex(storage, index);
  return id;
};

const deleteLevel = (storage = getDefaultStorage(), id) => {
  if (!storage || !id) return false;
  safeRemoveItem(storage, STORAGE_KEYS.levelPrefix + id);
  const index = sanitizeIndex(parseIndex(safeGetItem(storage, STORAGE_KEYS.index)));
  const next = index.filter(entry => entry.id !== id);
  writeIndex(storage, next);
  return true;
};

export {
  STORAGE_KEYS,
  createLevelId,
  listSavedLevels,
  loadSavedLevel,
  saveLevel,
  deleteLevel
};
