import {
  ensureEntryUid,
  getEntryBounds
} from './e2eShared.js';

const getEditorContext = (view, editorUi) => {
  if (!editorUi) return null;
  const session = editorUi.session || view?.editorSession || null;
  const controller = editorUi.controller || null;
  const history = editorUi.history || null;
  if (!session || !session.level || !controller || !history) return null;
  return {
    session,
    controller,
    history,
    assets: editorUi.assets || null,
    editorUi
  };
};

const getListForKind = (level, kind) => {
  if (!level) return null;
  if (kind === 'gadget') return level.gadgets;
  if (kind === 'steel') return level.steel;
  if (kind === 'terrain') return level.terrains;
  return null;
};

const getPrefixForKind = (kind) => {
  if (kind === 'gadget') return 'g';
  if (kind === 'steel') return 's';
  return 't';
};

const resolveEntryRef = (level, ref) => {
  if (!ref || !level) return null;
  const kind = ref.kind || ref.type;
  const list = getListForKind(level, kind);
  if (!Array.isArray(list)) return null;
  let index = Number.isFinite(ref.index) ? Math.trunc(ref.index) : null;
  if (!Number.isFinite(index) && ref.uid) {
    index = list.findIndex(entry => entry?.uid === ref.uid);
  }
  if (!Number.isFinite(index) || index < 0 || index >= list.length) return null;
  return { kind, list, index, entry: list[index] };
};

const cloneEntryForApply = (entry, prefix) => {
  const props = entry?.props ? { ...entry.props } : {};
  const order = Array.isArray(entry?.order) ? entry.order.slice() : Object.keys(props);
  const unknownLines = Array.isArray(entry?.unknownLines) ? entry.unknownLines.slice() : [];
  const clone = { props, order, unknownLines };
  ensureEntryUid(clone, prefix);
  return clone;
};

const normalizeBounds = (x1, y1, x2, y2) => {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
};

const boundsIntersect = (a, b) => {
  if (!a || !b) return false;
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
};

const resolveSelectionFromRefs = (level, refs) => {
  if (!Array.isArray(refs)) return [];
  const next = [];
  for (const ref of refs) {
    const resolved = resolveEntryRef(level, ref);
    if (!resolved) continue;
    next.push({ type: resolved.kind, index: resolved.index });
  }
  return next;
};

const boxSelectEntries = ({ level, assets, bounds, baseSelection = [], mode = 'replace' }) => {
  const hits = [];
  const addHit = (type, index) => {
    if (hits.some(entry => entry.type === type && entry.index === index)) return;
    hits.push({ type, index });
  };
  const scan = (entries, metaById, type) => {
    if (!Array.isArray(entries)) return;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const meta = metaById?.get?.(entry?.props?.PIECE);
      const entryBounds = getEntryBounds(entry, meta);
      if (boundsIntersect(bounds, entryBounds)) addHit(type, i);
    }
  };
  scan(level?.terrains, assets?.terrainById, 'terrain');
  scan(level?.gadgets, assets?.gadgetById, 'gadget');
  scan(level?.steel, null, 'steel');
  if (mode === 'replace') {
    return hits;
  }
  const next = baseSelection.slice();
  for (const hit of hits) {
    const idx = next.findIndex(entry => entry.type === hit.type && entry.index === hit.index);
    if (mode === 'add') {
      if (idx < 0) next.push(hit);
    } else if (mode === 'toggle') {
      if (idx >= 0) {
        next.splice(idx, 1);
      } else {
        next.push(hit);
      }
    }
  }
  return next;
};

export {
  boxSelectEntries,
  boundsIntersect,
  cloneEntryForApply,
  getEditorContext,
  getListForKind,
  getPrefixForKind,
  normalizeBounds,
  resolveEntryRef,
  resolveSelectionFromRefs
};
