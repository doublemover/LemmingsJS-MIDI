import {
  BinaryReader,
  EditorTools,
  LevelReader,
  LevelWriter,
  createClassicLevelData,
  createEditorLevelFromClassic,
  createGadgetEntry,
  createSteelEntry,
  createTerrainEntry,
  ensureLevelEntryUids,
  findEntryAt,
  loadSavedLevel,
  removeEntryAt,
  saveLevel,
  setEntryProp,
  validateLevel
} from './e2eShared.js';
import {
  encodeBase64,
  getEditorHistoryEntry,
  serializeIssues
} from './E2EStateSerialization.js';
import {
  boxSelectEntries,
  boundsIntersect,
  cloneEntryForApply,
  getEditorContext,
  getListForKind,
  getPrefixForKind,
  normalizeBounds,
  resolveEntryRef,
  resolveSelectionFromRefs
} from './E2EEditorApplyHelpers.js';
import {
  buildApplyError,
  buildEditorApplyState
} from './E2EEditorApplyResult.js';
const applyEditorOps = async (view, editorUi, ops = [], options = {}) => {
  const ctx = getEditorContext(view, editorUi);
  if (!ctx) {
    return {
      ok: false,
      error: {
        code: editorUi ? 'no_editor_session' : 'not_in_editor_mode',
        message: 'Editor session is not available.'
      }
    };
  }

  ensureLevelEntryUids(ctx.session.level);

  const atomic = options?.atomic === true;
  const dryRun = options?.dryRun === true;
  const historyOptions = options?.history || {};
  const previewOptions = options?.preview || {};
  const validateOptions = options?.validate || {};
  const returnState = options?.returnState || 'editor';
  const historyLabel = historyOptions.label || 'Editor Apply';
  const previewLabel = previewOptions.label || historyLabel;

  const results = [];
  const resources = [];
  let changed = false;
  let usedHistoryOp = false;
  const rollbackText = atomic && typeof view?.getEditorLevelText === 'function'
    ? view.getEditorLevelText()
    : null;

  const registerResource = (resource) => {
    if (!resource) return;
    resources.push(resource);
  };

  const getLevel = () => ctx.session.level;

  const applySnap = (x, y, snapMode) => {
    if (!snapMode || snapMode === 'useCurrent') {
      return ctx.controller._snap ? ctx.controller._snap(x, y) : { x, y };
    }
    if (snapMode === 'none') return { x, y };
    const gridSize = Number(snapMode.gridSize);
    if (!Number.isFinite(gridSize) || gridSize <= 1) {
      return { x: Math.round(x), y: Math.round(y) };
    }
    return {
      x: Math.round(x / gridSize) * gridSize,
      y: Math.round(y / gridSize) * gridSize
    };
  };

  const validateAndFix = () => {
    if (validateOptions.run === false) return null;
    const issues = validateLevel(getLevel(), ctx.assets);
    if (validateOptions.autoFix && validateOptions.autoFix !== 'none') {
      let fixed = false;
      for (const issue of issues) {
        if (typeof issue.fix === 'function') {
          issue.fix();
          fixed = true;
        }
      }
      if (fixed) {
        changed = true;
      }
    }
    return serializeIssues(issues);
  };

  for (const op of ops || []) {
    const opId = op?.opId ?? null;
    const type = String(op?.type || '');
    const args = op?.args || {};
    let value = null;
    let ok = true;
    let errorCode = 'invalid_op';
    let errorMessage = 'Invalid op';
    try {
      switch (type) {
      case 'editor.ensure': {
        if (args?.enter && view?.enterEditorMode) {
          view.enterEditorMode();
        }
        value = { inEditor: !!view?.editorMode };
        break;
      }
      case 'level.new': {
        if (dryRun) break;
        view?.createBlankEditorLevel?.({ render: false });
        ctx.session = view?.editorSession || ctx.session;
        ctx.controller.session = ctx.session;
        ensureLevelEntryUids(ctx.session.level);
        if (args?.header && ctx.session.level) {
          for (const [key, val] of Object.entries(args.header)) {
            ctx.session.level.setHeader(key, val);
          }
        }
        if (args?.skillset && ctx.session.level?.skillset) {
          for (const [key, val] of Object.entries(args.skillset)) {
            ctx.session.level.setSkill(key, val);
          }
        }
        if (args?.resetHistory) {
          ctx.controller.resetHistory('New');
        }
        changed = true;
        value = { created: true };
        break;
      }
      case 'level.loadText': {
        if (dryRun) break;
        const text = String(args?.text || '');
        const level = view?.loadEditorLevelFromText?.(text, { render: false });
        if (!level) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Failed to load level text.';
          break;
        }
        ctx.session = view?.editorSession || ctx.session;
        ctx.controller.session = ctx.session;
        ensureLevelEntryUids(ctx.session.level);
        if (args?.resetHistory) {
          ctx.controller.resetHistory(args?.sourceLabel || 'Import');
        }
        changed = true;
        break;
      }
      case 'level.loadSaved': {
        if (dryRun) break;
        const text = loadSavedLevel(undefined, args?.savedId);
        if (!text) {
          ok = false;
          errorCode = 'invalid_ref';
          errorMessage = 'Saved level not found.';
          break;
        }
        const level = view?.loadEditorLevelFromText?.(text, { render: false });
        if (!level) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Failed to load saved level.';
          break;
        }
        ctx.session = view?.editorSession || ctx.session;
        ctx.controller.session = ctx.session;
        ensureLevelEntryUids(ctx.session.level);
        if (args?.resetHistory) {
          ctx.controller.resetHistory('Load Saved');
        }
        changed = true;
        break;
      }
      case 'level.save': {
        const name = String(args?.name || '');
        const text = view?.getEditorLevelText?.();
        if (!text) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Unable to serialize level.';
          break;
        }
        const savedId = saveLevel(undefined, {
          id: args?.overwriteId || undefined,
          name,
          text
        });
        if (!savedId) {
          ok = false;
          errorCode = 'internal_error';
          errorMessage = 'Failed to save level.';
          break;
        }
        value = { savedId, name };
        break;
      }
      case 'level.export': {
        const format = args?.format === 'classicLvl' ? 'classicLvl' : 'nxlv';
        if (format === 'nxlv') {
          const text = view?.getEditorLevelText?.() || '';
          const filename = String(args?.filename || 'level.nxlv');
          registerResource({
            name: filename,
            mimeType: 'text/plain',
            encoding: 'text',
            data: text,
            meta: { kind: 'export', format: 'nxlv', label: filename }
          });
          value = { filename };
        } else {
          const classic = createClassicLevelData(getLevel());
          if (!classic?.levelReader) {
            ok = false;
            errorCode = 'internal_error';
            errorMessage = 'Failed to export classic level.';
            break;
          }
          const writer = new LevelWriter();
          const payload = {
            levelProperties: classic.levelReader.levelProperties,
            screenPositionX: classic.levelReader.screenPositionX,
            graphicSet1: classic.levelReader.graphicSet1,
            graphicSet2: classic.levelReader.graphicSet2,
            isSuperLemming: classic.levelReader.isSuperLemming,
            objects: classic.levelReader.objects,
            terrains: classic.levelReader.terrains,
            steel: classic.levelReader.steel
          };
          const bytes = writer.write(payload);
          const filename = String(args?.filename || 'level.lvl');
          registerResource({
            name: filename,
            mimeType: 'application/octet-stream',
            encoding: 'base64',
            data: encodeBase64(bytes),
            meta: { kind: 'export', format: 'classicLvl', label: filename }
          });
          value = { filename };
        }
        break;
      }
      case 'level.importClassicLvl': {
        if (dryRun) break;
        const raw = String(args?.bytesBase64 || '');
        if (!raw) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Missing classic level bytes.';
          break;
        }
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        const reader = new BinaryReader(bytes);
        const levelReader = new LevelReader(reader);
        const editorLevel = createEditorLevelFromClassic(levelReader);
        if (!editorLevel) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Failed to parse classic level.';
          break;
        }
        ctx.session.level = editorLevel;
        ensureLevelEntryUids(ctx.session.level);
        if (args?.resetHistory) {
          ctx.controller.resetHistory(args?.sourceLabel || 'Import LVL');
        }
        changed = true;
        break;
      }
      case 'level.patchHeader': {
        if (dryRun) break;
        const level = getLevel();
        if (!level) break;
        const set = args?.set || {};
        for (const [key, val] of Object.entries(set)) {
          level.setHeader(key, val);
        }
        if (Array.isArray(args?.unset)) {
          for (const key of args.unset) {
            level.removeHeader(key);
          }
        }
        changed = true;
        break;
      }
      case 'level.patchSkillset': {
        if (dryRun) break;
        const level = getLevel();
        if (!level) break;
        const set = args?.set || {};
        for (const [key, val] of Object.entries(set)) {
          level.setSkill(key, val);
        }
        if (Array.isArray(args?.unset)) {
          for (const key of args.unset) {
            level.skillset?.delete?.(String(key).trim().toUpperCase());
          }
        }
        changed = true;
        break;
      }
      case 'editor.setTool': {
        const tool = args?.tool;
        if (!tool) break;
        const validTools = new Set(Object.values(EditorTools));
        if (validTools.has(tool)) {
          ctx.controller.setTool(tool);
        }
        value = { tool: ctx.controller.tool };
        break;
      }
      case 'editor.setBrushSettings': {
        if (Number.isFinite(args?.gridSize)) ctx.controller.gridSize = Math.max(1, Math.trunc(args.gridSize));
        if (args?.snapEnabled !== undefined) ctx.controller.setSnapEnabled(!!args.snapEnabled);
        if (Number.isFinite(args?.brushSize)) ctx.controller.setBrushSize(Math.max(1, Math.trunc(args.brushSize)));
        if (args?.eraseGadgets !== undefined) ctx.controller.setEraseGadgets(!!args.eraseGadgets);
        if (Number.isFinite(args?.handleSize)) ctx.controller.handleSize = Math.max(1, Math.trunc(args.handleSize));
        value = {
          gridSize: ctx.controller.gridSize,
          snapEnabled: ctx.controller.snapEnabled,
          brushSize: ctx.controller.brushSize,
          eraseGadgets: ctx.controller.eraseGadgets,
          handleSize: ctx.controller.handleSize
        };
        break;
      }
      case 'editor.setPaletteSelection': {
        if (Number.isFinite(args?.selectedTerrainId)) ctx.controller.setSelectedTerrain(args.selectedTerrainId);
        if (Number.isFinite(args?.selectedGadgetId)) ctx.controller.setSelectedGadget(args.selectedGadgetId);
        if (Number.isFinite(args?.selectedTriggerId)) ctx.controller.setSelectedTrigger(args.selectedTriggerId);
        value = {
          selectedTerrainId: ctx.controller.selectedTerrainId,
          selectedGadgetId: ctx.controller.selectedGadgetId,
          selectedTriggerId: ctx.controller.selectedTriggerId
        };
        break;
      }
      case 'selection.clear': {
        ctx.controller.clearSelection();
        value = { cleared: true };
        break;
      }
      case 'selection.set': {
        const refs = resolveSelectionFromRefs(getLevel(), args?.selection);
        ctx.controller._setSelection(refs);
        value = { count: refs.length };
        break;
      }
      case 'selection.hitTest': {
        const x = Number(args?.x);
        const y = Number(args?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          value = { hit: null };
          break;
        }
        const kinds = Array.isArray(args?.kinds) ? args.kinds : ['terrain', 'gadget', 'steel'];
        const level = getLevel();
        let hit = null;
        if (kinds.includes('gadget')) {
          const gadgetHit = findEntryAt(level?.gadgets, ctx.assets?.gadgetById, x, y);
          if (gadgetHit) hit = { kind: 'gadget', ...gadgetHit };
        }
        if (!hit && kinds.includes('steel')) {
          const steelHit = findEntryAt(level?.steel, null, x, y);
          if (steelHit) hit = { kind: 'steel', ...steelHit };
        }
        if (!hit && kinds.includes('terrain')) {
          const terrainHit = findEntryAt(level?.terrains, ctx.assets?.terrainById, x, y);
          if (terrainHit) hit = { kind: 'terrain', ...terrainHit };
        }
        if (hit && hit.entry) {
          value = { hit: { kind: hit.kind, index: hit.index, uid: hit.entry.uid || null } };
        } else {
          value = { hit: null };
        }
        break;
      }
      case 'selection.boxSelect': {
        const bounds = args?.bounds;
        if (!bounds) {
          value = { count: 0 };
          break;
        }
        const next = boxSelectEntries({
          level: getLevel(),
          assets: ctx.assets,
          bounds,
          baseSelection: ctx.controller.selection,
          mode: args?.mode || 'replace'
        });
        ctx.controller._setSelection(next);
        value = { count: ctx.controller.selection.length };
        break;
      }
      case 'entry.add': {
        if (dryRun) break;
        const kind = args?.kind;
        const list = getListForKind(getLevel(), kind);
        if (!Array.isArray(list)) {
          ok = false;
          errorCode = 'invalid_ref';
          errorMessage = 'Invalid entry kind.';
          break;
        }
        let entry = null;
        if (kind === 'terrain') {
          entry = createTerrainEntry({
            styleName: getLevel()?.getHeader?.('STYLE'),
            piece: args?.props?.PIECE ?? args?.props?.piece ?? args?.piece,
            x: args?.props?.X ?? args?.props?.x ?? args?.x,
            y: args?.props?.Y ?? args?.props?.y ?? args?.y
          });
        } else if (kind === 'gadget') {
          entry = createGadgetEntry({
            styleName: getLevel()?.getHeader?.('STYLE'),
            piece: args?.props?.PIECE ?? args?.props?.piece ?? args?.piece,
            x: args?.props?.X ?? args?.props?.x ?? args?.x,
            y: args?.props?.Y ?? args?.props?.y ?? args?.y
          });
        } else if (kind === 'steel') {
          entry = createSteelEntry({
            x: args?.props?.X ?? args?.x,
            y: args?.props?.Y ?? args?.y,
            width: args?.props?.WIDTH ?? args?.width,
            height: args?.props?.HEIGHT ?? args?.height
          });
        }
        if (!entry) {
          ok = false;
          errorCode = 'invalid_op';
          errorMessage = 'Failed to create entry.';
          break;
        }
        const insert = args?.insert;
        if (insert && Number.isFinite(insert.index)) {
          const idx = Math.max(0, Math.min(list.length, Math.trunc(insert.index)));
          list.splice(idx, 0, entry);
          value = { ref: { kind, index: idx, uid: entry.uid || null } };
        } else {
          list.push(entry);
          value = { ref: { kind, index: list.length - 1, uid: entry.uid || null } };
        }
        changed = true;
        break;
      }
      case 'entry.update': {
        if (dryRun) break;
        const resolved = resolveEntryRef(getLevel(), args?.ref);
        if (!resolved) {
          ok = false;
          errorCode = 'invalid_ref';
          errorMessage = 'Entry not found.';
          break;
        }
        const set = args?.set || {};
        for (const [key, val] of Object.entries(set)) {
          const removeIfFalse = typeof val === 'boolean';
          setEntryProp(resolved.entry, key, val, { removeIfFalse });
        }
        if (Array.isArray(args?.unset)) {
          for (const key of args.unset) {
            setEntryProp(resolved.entry, key, undefined, { removeIfEmpty: true });
          }
        }
        changed = true;
        break;
      }
      case 'entry.remove': {
        if (dryRun) break;
        const refs = Array.isArray(args?.refs) ? args.refs : [];
        const groups = { terrain: [], gadget: [], steel: [] };
        for (const ref of refs) {
          const resolved = resolveEntryRef(getLevel(), ref);
          if (!resolved) continue;
          groups[resolved.kind]?.push(resolved.index);
        }
        for (const [kind, indices] of Object.entries(groups)) {
          indices.sort((a, b) => b - a);
          for (const index of indices) {
            removeEntryAt(getLevel(), kind, index);
          }
        }
        changed = refs.length > 0;
        break;
      }
      case 'entry.duplicate': {
        if (dryRun) break;
        const refs = Array.isArray(args?.refs) ? args.refs : [];
        const dx = Number.isFinite(args?.offset?.dx) ? args.offset.dx : 0;
        const dy = Number.isFinite(args?.offset?.dy) ? args.offset.dy : 0;
        const nextRefs = [];
        for (const ref of refs) {
          const resolved = resolveEntryRef(getLevel(), ref);
          if (!resolved) continue;
          const prefix = getPrefixForKind(resolved.kind);
          const clone = cloneEntryForApply(resolved.entry, prefix);
          clone.props.X = (Number.isFinite(clone.props.X) ? clone.props.X : 0) + dx;
          clone.props.Y = (Number.isFinite(clone.props.Y) ? clone.props.Y : 0) + dy;
          resolved.list.push(clone);
          nextRefs.push({ kind: resolved.kind, index: resolved.list.length - 1, uid: clone.uid || null });
        }
        if (args?.selectNew) {
          ctx.controller._setSelection(nextRefs.map(ref => ({ type: ref.kind, index: ref.index })));
        }
        value = { refs: nextRefs };
        changed = nextRefs.length > 0;
        break;
      }
      case 'entry.reorder': {
        if (dryRun) break;
        const action = args?.action;
        const selection = ctx.controller.selection.slice();
        const groups = { terrain: [], gadget: [], steel: [] };
        for (const selected of selection) {
          if (groups[selected.type]) groups[selected.type].push(selected.index);
        }
        const reorderList = (list, indices, dir) => {
          if (!Array.isArray(list) || indices.length === 0) return null;
          const unique = Array.from(new Set(indices)).filter(idx => idx >= 0 && idx < list.length);
          if (!unique.length) return null;
          const selectedSet = new Set(unique);
          if (dir === 'front' || dir === 'back') {
            const ordered = unique.slice().sort((a, b) => a - b).map(idx => list[idx]);
            const remaining = list.filter((_, idx) => !selectedSet.has(idx));
            list.length = 0;
            if (dir === 'front') {
              list.push(...remaining, ...ordered);
            } else {
              list.push(...ordered, ...remaining);
            }
            const next = new Map();
            list.forEach((entry, idx) => next.set(entry, idx));
            return ordered.map(entry => next.get(entry)).filter(idx => idx != null);
          }
          if (dir === 'forward') {
            const sorted = unique.slice().sort((a, b) => b - a);
            for (const idx of sorted) {
              if (idx >= list.length - 1) continue;
              if (selectedSet.has(idx + 1)) continue;
              const tmp = list[idx + 1];
              list[idx + 1] = list[idx];
              list[idx] = tmp;
              selectedSet.delete(idx);
              selectedSet.add(idx + 1);
            }
            return Array.from(selectedSet);
          }
          if (dir === 'backward') {
            const sorted = unique.slice().sort((a, b) => a - b);
            for (const idx of sorted) {
              if (idx <= 0) continue;
              if (selectedSet.has(idx - 1)) continue;
              const tmp = list[idx - 1];
              list[idx - 1] = list[idx];
              list[idx] = tmp;
              selectedSet.delete(idx);
              selectedSet.add(idx - 1);
            }
            return Array.from(selectedSet);
          }
          return null;
        };
        const nextSelection = [];
        for (const [kind, indices] of Object.entries(groups)) {
          const list = getListForKind(getLevel(), kind);
          const nextIndices = reorderList(list, indices, action === 'bringToFront' ? 'front'
            : action === 'sendToBack' ? 'back'
              : action === 'moveForward' ? 'forward'
                : action === 'moveBackward' ? 'backward'
                  : null);
          if (!nextIndices) continue;
          for (const idx of nextIndices) {
            nextSelection.push({ type: kind, index: idx });
          }
        }
        if (nextSelection.length) {
          ctx.controller._setSelection(nextSelection);
        }
        changed = nextSelection.length > 0;
        break;
      }
      case 'tool.place': {
        if (dryRun) break;
        const tool = String(args?.tool || '');
        const pos = applySnap(Number(args?.x || 0), Number(args?.y || 0), args?.snap);
        let entry = null;
        if (tool === EditorTools.TERRAIN) {
          if (Number.isFinite(args?.pieceId)) ctx.controller.setSelectedTerrain(args.pieceId);
          entry = ctx.controller._placeTerrainAt(pos.x, pos.y);
        } else if (tool === EditorTools.GADGET) {
          if (Number.isFinite(args?.pieceId)) ctx.controller.setSelectedGadget(args.pieceId);
          entry = ctx.controller._placeGadgetAt(pos.x, pos.y, ctx.controller.selectedGadgetId);
        } else if (tool === EditorTools.TRIGGER) {
          if (Number.isFinite(args?.pieceId)) ctx.controller.setSelectedTrigger(args.pieceId);
          const id = ctx.controller.selectedTriggerId ?? ctx.controller.selectedGadgetId;
          entry = ctx.controller._placeGadgetAt(pos.x, pos.y, id);
        } else if (tool === EditorTools.ENTRANCE) {
          const id = ctx.assets?.entranceId ?? ctx.controller.selectedGadgetId;
          entry = ctx.controller._placeGadgetAt(pos.x, pos.y, id);
        } else if (tool === EditorTools.EXIT) {
          const id = ctx.assets?.exitId ?? ctx.controller.selectedGadgetId;
          entry = ctx.controller._placeGadgetAt(pos.x, pos.y, id);
        } else if (tool === EditorTools.STEEL) {
          const size = Number.isFinite(ctx.controller.gridSize) ? ctx.controller.gridSize : 1;
          entry = ctx.controller._placeSteelAt(pos.x, pos.y, size, size);
        }
        if (entry) {
          const kind = tool === EditorTools.STEEL ? 'steel'
            : tool === EditorTools.GADGET || tool === EditorTools.TRIGGER || tool === EditorTools.ENTRANCE || tool === EditorTools.EXIT
              ? 'gadget'
              : 'terrain';
          const list = getListForKind(getLevel(), kind);
          const index = Array.isArray(list) ? list.indexOf(entry) : -1;
          if (index >= 0) {
            ctx.controller._setSelection([{ type: kind, index }]);
            value = { ref: { kind, index, uid: entry.uid || null } };
          }
          changed = true;
        }
        break;
      }
      case 'tool.stroke':
      case 'tool.erase': {
        if (dryRun) break;
        const tool = type === 'tool.erase' ? EditorTools.ERASER : String(args?.tool || '');
        const points = Array.isArray(args?.points) ? args.points : [];
        if (!points.length) break;
        const prevErase = ctx.controller.eraseGadgets;
        if (typeof args?.eraseGadgets === 'boolean') {
          ctx.controller.setEraseGadgets(args.eraseGadgets);
        }
        ctx.controller._beginStroke();
        let last = null;
        for (const point of points) {
          const pos = applySnap(Number(point.x || 0), Number(point.y || 0), args?.snap);
          if (tool === EditorTools.BRUSH) {
            if (last) ctx.controller._brushLine(last, pos);
            else ctx.controller._brushAt(pos.x, pos.y);
          } else if (tool === EditorTools.ERASER) {
            if (last) ctx.controller._eraseLine(last, pos);
            else ctx.controller._eraseAt(pos.x, pos.y);
          }
          last = pos;
        }
        ctx.controller._lastBrushPos = null;
        ctx.controller.setEraseGadgets(prevErase);
        changed = true;
        break;
      }
      case 'tool.steelRect': {
        if (dryRun) break;
        const rects = Array.isArray(args?.rects) ? args.rects : [];
        for (const rect of rects) {
          const bounds = normalizeBounds(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
          ctx.controller._placeSteelAt(bounds.x, bounds.y, bounds.width, bounds.height);
        }
        changed = rects.length > 0;
        break;
      }
      case 'history.undo': {
        usedHistoryOp = true;
        const count = Number.isFinite(args?.count) ? Math.max(1, Math.trunc(args.count)) : 1;
        for (let i = 0; i < count; i++) {
          ctx.controller.undo();
        }
        value = { count };
        break;
      }
      case 'history.redo': {
        usedHistoryOp = true;
        const count = Number.isFinite(args?.count) ? Math.max(1, Math.trunc(args.count)) : 1;
        for (let i = 0; i < count; i++) {
          ctx.controller.redo();
        }
        value = { count };
        break;
      }
      case 'history.getEntry': {
        const entry = getEditorHistoryEntry(ctx.history, Number(args?.index));
        value = entry || null;
        break;
      }
      case 'validate.run': {
        value = validateAndFix();
        break;
      }
      default:
        ok = false;
        errorCode = 'invalid_op';
        errorMessage = `Unknown op: ${type}`;
        break;
      }
    } catch (err) {
      ok = false;
      errorCode = 'internal_error';
      errorMessage = err ? String(err) : 'Unknown error';
    }

    if (ok) {
      results.push({ opId, type, ok: true, value });
    } else {
      results.push({ opId, type, ok: false, error: errorMessage });
      if (atomic) {
        if (rollbackText && typeof view?.loadEditorLevelFromText === 'function') {
          view.loadEditorLevelFromText(rollbackText, { render: false });
          ctx.session = view?.editorSession || ctx.session;
          ctx.controller.session = ctx.session;
          ensureLevelEntryUids(ctx.session.level);
        }
        return buildApplyError(errorCode, errorMessage, undefined, results);
      }
    }
  }

  const validation = validateAndFix();
  if (validation) {
    results.push({ opId: null, type: 'validate.run', ok: true, value: validation });
  }

  if (historyOptions.record !== false && changed && !usedHistoryOp) {
    ctx.controller.history.pushSnapshot(getLevel(), historyLabel);
  }

  if (previewOptions.refresh !== false && ctx.editorUi?._refreshPreview) {
    await ctx.editorUi._refreshPreview(previewLabel, {
      preserveView: previewOptions.preserveViewport !== false
    });
  }

  const state = buildEditorApplyState(view, editorUi, returnState);

  return {
    ok: true,
    results,
    resources,
    state
  };
};
export {
  getEditorContext,
  getListForKind,
  getPrefixForKind,
  resolveEntryRef,
  cloneEntryForApply,
  normalizeBounds,
  boundsIntersect,
  applyEditorOps
};
