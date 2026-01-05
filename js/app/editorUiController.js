import { EditorController } from '../editor/EditorController.js';
import { EditorHistory } from '../editor/EditorHistory.js';
import { EditorAssetCache } from '../editor/EditorAssetCache.js';
import { BinaryReader } from '../data/BinaryReader.js';
import { LevelReader } from '../level/LevelReader.js';
import { LevelWriter } from '../level/LevelWriter.js';
import { createEditorLevelFromClassic } from '../editor/ClassicLevelConverter.js';
import { createClassicLevelData } from '../editor/EditorLevelLoader.js';
import { validateLevel } from '../editor/EditorValidator.js';
import { getEntryBounds } from '../editor/EditorHitTest.js';
import { ensureLevelEntryUids } from '../editor/EditorEntryFactory.js';
import { getStyle, getStyleNames } from '../editor/StyleRegistry.js';
import { EditorPreviewCache } from './editorPreviewCache.js';
import { EditorKeybindings } from '../input/EditorKeybindings.js';
import { ShortcutOverlay } from './shortcutOverlay.js';
import {
  formatRotation,
  formatValue,
  normalizeRotation,
  normalizeText,
  parseNumber,
  sanitizeFileName
} from './editor-ui/editorUiFormat.js';
import {
  downloadBinaryFile,
  downloadTextFile,
  readArrayBufferFile,
  readTextFile
} from './editor-ui/editorUiFiles.js';
import {
  listSavedLevels,
  loadSavedLevel,
  saveLevel
} from '../editor/EditorStorage.js';

const MAX_HISTORY = 200;
const MAX_BRUSH_SIZE = 64;
const EDITOR_SHORTCUT_SECTIONS = [
  {
    title: 'General',
    entries: [
      { action: 'editorToggleShortcutOverlay', label: 'Shortcut overlay' },
      { action: 'editorTogglePlaytest', label: 'Toggle playtest' }
    ]
  },
  {
    title: 'Tools',
    entries: [
      { action: 'editorToolSelect', label: 'Select' },
      { action: 'editorToolTerrain', label: 'Terrain' },
      { action: 'editorToolGadget', label: 'Object' },
      { action: 'editorToolTrigger', label: 'Trigger' },
      { action: 'editorToolEntrance', label: 'Entrance' },
      { action: 'editorToolExit', label: 'Exit' },
      { action: 'editorToolSteel', label: 'Steel' },
      { action: 'editorToolBrush', label: 'Brush' },
      { action: 'editorToolEraser', label: 'Eraser' }
    ]
  },
  {
    title: 'Edit',
    entries: [
      { action: 'editorCopy', label: 'Copy' },
      { action: 'editorPaste', label: 'Paste' },
      { action: 'editorDuplicate', label: 'Duplicate' },
      { action: 'editorUndo', label: 'Undo' },
      { action: 'editorRedo', label: 'Redo' },
      { action: 'editorDelete', label: 'Delete selection' },
      { action: 'editorSnapSelection', label: 'Snap to grid' },
      { action: 'editorBringToFront', label: 'Bring to front' },
      { action: 'editorMoveForward', label: 'Move forward' },
      { action: 'editorMoveBackward', label: 'Move backward' },
      { action: 'editorSendToBack', label: 'Send to back' }
    ]
  },
  {
    title: 'Nudge',
    entries: [
      { action: 'editorNudgeLeft', label: 'Nudge left' },
      { action: 'editorNudgeRight', label: 'Nudge right' },
      { action: 'editorNudgeUp', label: 'Nudge up' },
      { action: 'editorNudgeDown', label: 'Nudge down' },
      { action: 'editorNudgeLeftFast', label: 'Nudge left (grid)' },
      { action: 'editorNudgeRightFast', label: 'Nudge right (grid)' },
      { action: 'editorNudgeUpFast', label: 'Nudge up (grid)' },
      { action: 'editorNudgeDownFast', label: 'Nudge down (grid)' }
    ]
  }
];

class EditorUiController {
  constructor(options = {}) {
    this.view = options.view || null;
    this.document = options.document || globalThis.document;
    this.window = options.window || globalThis.window;
    this.session = options.session || this.view?.ensureEditorSession?.() || null;
    this.history = options.history || new EditorHistory({ maxEntries: MAX_HISTORY });
    this.controller = options.controller || new EditorController({
      session: this.session,
      history: this.history
    });
    this.assetCache = options.assetCache || new EditorAssetCache();
    this.previewCache = options.previewCache || new EditorPreviewCache({
      document: this.document,
      window: this.window
    });
    this.assets = null;
    this._selection = [];
    this._activeTab = 'terrain';
    this._currentSavedId = '';
    this._playtest = false;
    this._previewInFlight = false;
    this._previewQueued = false;
    this._previewQueuedLabel = null;
    this._previewQueuedOptions = null;
    this._cursorPos = null;
    this._paletteViewMode = 'list';
    this._paletteGridColumns = 4;
    this._styleAvailability = new Map();
    this._suppressHeader = false;
    this._suppressInspector = false;
    this._pointerDown = false;
    this._shiftKey = false;
    this._altKey = false;
    this._antsOffset = 0;
    this._needsDefaultEntrances = false;
    this.shortcutOverlay = null;
    this._dirty = false;
    this._baseTitle = this.document?.title || 'Lemmings Editor';

    this._bindElements();
    this._bindController();
  }

  async init() {
    if (!this.session?.level) {
      this.view?.createBlankEditorLevel({ render: false });
      this.session = this.view?.editorSession || this.session;
      this.controller.session = this.session;
      this._needsDefaultEntrances = true;
    }
    ensureLevelEntryUids(this.session?.level);
    await this._reloadAssets();
    this.controller.resetHistory('Init');
    this._setDirty(false);
    this._refreshUndoRedo();
    this._refreshHeaderFields();
    this._refreshSelection(null);
    this._refreshValidation();
    this._refreshSavedList();
    this._bindEvents();
    await this._refreshPreview('Init', { preserveView: false });
  }

  _bindElements() {
    const get = id => this.document.getElementById(id);
    this.el = {
      gameType: get('editorGameTypeSelect'),
      levelGroup: get('editorLevelGroupSelect'),
      levelIndex: get('editorLevelIndexSelect'),
      savedSelect: get('editorSavedSelect'),
      newLevel: get('editorNewLevel'),
      savedSave: get('editorSavedSave'),
      undo: get('editorUndo'),
      redo: get('editorRedo'),
      dirtyStatus: get('editorDirtyStatus'),
      savedExport: get('editorSavedExport'),
      savedExportClassic: get('editorSavedExportClassic'),
      savedImport: get('editorSavedImport'),
      savedImportClassic: get('editorSavedImportClassic'),
      savedImportInput: get('editorSavedImportInput'),
      savedImportClassicInput: get('editorSavedImportClassicInput'),
      playtestToggle: get('editorPlaytestToggle'),
      toolList: get('editorToolList'),
      snapToggle: get('editorSnapToggle'),
      gridSize: get('editorGridSize'),
      brushSize: get('editorBrushSize'),
      eraseGadgets: get('editorEraseGadgets'),
      paletteTabs: get('editorPaletteTabs'),
      paletteSearch: get('editorPaletteSearch'),
      paletteViewList: get('editorPaletteViewList'),
      paletteViewGrid: get('editorPaletteViewGrid'),
      paletteTerrain: get('editorPaletteTerrain'),
      paletteGadgets: get('editorPaletteGadgets'),
      paletteTriggers: get('editorPaletteTriggers'),
      cursorStatus: get('editorCursorStatus'),
      status: get('editorStatus'),
      selectionStatus: get('editorSelectionStatus'),
      headerTitle: get('editorHeaderTitle'),
      headerStyle: get('editorHeaderStyle'),
      headerWidth: get('editorHeaderWidth'),
      headerHeight: get('editorHeaderHeight'),
      headerLemmings: get('editorHeaderLemmings'),
      headerSaveRequirement: get('editorHeaderSaveRequirement'),
      headerTimeLimit: get('editorHeaderTimeLimit'),
      headerSpawnInterval: get('editorHeaderSpawnInterval'),
      headerStartX: get('editorHeaderStartX'),
      headerStartY: get('editorHeaderStartY'),
      selType: get('editorSelType'),
      selName: get('editorSelName'),
      selX: get('editorSelX'),
      selY: get('editorSelY'),
      selWidth: get('editorSelWidth'),
      selHeight: get('editorSelHeight'),
      selRotate: get('editorSelRotate'),
      selSkill: get('editorSelSkill'),
      selLemmings: get('editorSelLemmings'),
      selPairing: get('editorSelPairing'),
      selFlipH: get('editorSelFlipH'),
      selFlipV: get('editorSelFlipV'),
      selNoOverwrite: get('editorSelNoOverwrite'),
      selErase: get('editorSelErase'),
      selOneWay: get('editorSelOneWay'),
      selectionActions: get('editorSelectionActions'),
      selectionFlags: get('editorSelectionFlags'),
      selectionBringFront: get('editorSelectionBringFront'),
      selectionMoveForward: get('editorSelectionMoveForward'),
      selectionMoveBackward: get('editorSelectionMoveBackward'),
      selectionSendBack: get('editorSelectionSendBack'),
      deleteSelection: get('editorDeleteSelection'),
      issuesList: get('editorIssuesList'),
      shortcutOverlay: get('editorShortcutOverlay')
    };
  }

  _bindController() {
    this.controller.setCallbacks({
      onSelectionChange: selection => {
        this._refreshSelection(selection);
        this._drawSelectionOverlay();
      },
      onMarqueeChange: () => {
        this._drawSelectionOverlay();
      },
      onLevelChange: level => {
        this._refreshHeaderFields(level);
        this._refreshValidation();
      },
      onPreviewRequest: label => {
        this._refreshPreview(label);
      }
    });
  }

  _bindEvents() {
    this._bindToolButtons();
    this._bindPaletteTabs();
    this._bindPaletteSearch();
    this._bindPaletteView();
    this._bindHeaderFields();
    this._bindSelectionFields();
    this._bindSelectionActions();
    this._bindUndoRedo();
    this._bindBrushControls();
    this._bindSavedControls();
    this._bindLevelSelectors();
    this._bindPlaytest();
    this._bindCanvasInput();
    this._bindKeybindings();
    this._bindShortcutOverlay();
    this._bindModifierKeys();
  }

  _bindModifierKeys() {
    const win = this.window;
    if (!win?.addEventListener) return;
    const update = (event) => {
      this._shiftKey = !!event.shiftKey;
      this._altKey = !!event.altKey;
    };
    win.addEventListener('keydown', update);
    win.addEventListener('keyup', update);
    win.addEventListener('blur', () => {
      this._shiftKey = false;
      this._altKey = false;
    });
  }

  _bindKeybindings() {
    if (!this.view) return;
    this.keybindings?.dispose?.();
    this.keybindings = new EditorKeybindings(this.controller, {
      fileProvider: this.view.gameFactory?.fileProvider,
      onBindingsLoaded: () => {
        this._applyTooltips();
        this._refreshShortcutOverlay();
      },
      onToolChange: tool => {
        this._setToolButton(tool);
        this._syncPaletteTabForTool(tool);
        this._updateStatus();
      },
      onCopy: () => {
        if (this.controller.copySelection()) {
          this._updateStatus('Copy');
        }
      },
      onPaste: () => {
        if (this.controller.pasteSelection()) {
          this._refreshAfterEdit('Paste');
        }
      },
      onDuplicate: () => {
        if (this.controller.duplicateSelection()) {
          this._refreshAfterEdit('Duplicate');
        }
      },
      onNudge: (dx, dy, step) => {
        if (this.controller.nudgeSelection(dx, dy, step)) {
          this._refreshAfterEdit('Nudge');
        }
      },
      onSnap: () => {
        if (this.controller.snapSelectionToGrid()) {
          this._refreshAfterEdit('Snap');
        }
      },
      onUndo: () => {
        if (this.controller.undo()) {
          this._refreshAfterEdit('Undo');
        }
      },
      onRedo: () => {
        if (this.controller.redo()) {
          this._refreshAfterEdit('Redo');
        }
      },
      onDelete: () => {
        if (this.controller.deleteSelected()) {
          this._refreshAfterEdit('Delete');
        }
      },
      onBringToFront: () => {
        if (this.controller.bringSelectionToFront()) {
          this._refreshAfterEdit('Reorder');
        }
      },
      onSendToBack: () => {
        if (this.controller.sendSelectionToBack()) {
          this._refreshAfterEdit('Reorder');
        }
      },
      onMoveForward: () => {
        if (this.controller.moveSelectionForward()) {
          this._refreshAfterEdit('Reorder');
        }
      },
      onMoveBackward: () => {
        if (this.controller.moveSelectionBackward()) {
          this._refreshAfterEdit('Reorder');
        }
      },
      onPlaytestToggle: () => this._togglePlaytest(),
      onToggleShortcutOverlay: () => this._toggleShortcutOverlay()
    });
    this.keybindings.bind();
    this._applyTooltips();
    this._refreshShortcutOverlay();
  }

  _bindShortcutOverlay() {
    if (this.shortcutOverlay || !this.el.shortcutOverlay) return;
    this.shortcutOverlay = new ShortcutOverlay({
      root: this.el.shortcutOverlay,
      title: 'Editor Shortcuts',
      sections: EDITOR_SHORTCUT_SECTIONS,
      getBindings: action => this.keybindings?.getDisplayBindings(action) || []
    });
  }

  _toggleShortcutOverlay() {
    this.shortcutOverlay?.toggle();
  }

  _refreshShortcutOverlay() {
    if (!this.shortcutOverlay) return;
    this.shortcutOverlay.render();
  }

  _bindToolButtons() {
    if (!this.el.toolList) return;
    this.el.toolList.addEventListener('click', (event) => {
      const button = event.target?.closest?.('button');
      const tool = button?.dataset?.tool;
      if (!tool) return;
      this.controller.setTool(tool);
      this._setToolButton(tool);
      this._syncPaletteTabForTool(tool);
      this._updateStatus();
    });
    this._setToolButton(this.controller.tool);
    this._syncPaletteTabForTool(this.controller.tool);
  }

  _bindPaletteTabs() {
    if (!this.el.paletteTabs) return;
    this.el.paletteTabs.addEventListener('click', (event) => {
      const button = event.target?.closest?.('button');
      const tab = button?.dataset?.tab;
      if (!tab) return;
      this._setPaletteTab(tab);
    });
  }

  _bindPaletteSearch() {
    if (!this.el.paletteSearch) return;
    this.el.paletteSearch.addEventListener('input', () => {
      this._applyPaletteFilter();
    });
  }

  _bindHeaderFields() {
    const headerMap = [
      ['headerTitle', 'TITLE', value => normalizeText(value)],
      ['headerStyle', 'STYLE', value => normalizeText(value)],
      ['headerWidth', 'WIDTH', value => parseNumber(value)],
      ['headerHeight', 'HEIGHT', value => parseNumber(value)],
      ['headerLemmings', 'LEMMINGS', value => parseNumber(value)],
      ['headerSaveRequirement', 'SAVE_REQUIREMENT', value => parseNumber(value)],
      ['headerTimeLimit', 'TIME_LIMIT', value => {
        const text = normalizeText(value);
        if (!text) return 'INFINITE';
        if (text.toUpperCase() === 'INFINITE') return 'INFINITE';
        return parseNumber(text);
      }],
      ['headerSpawnInterval', 'MAX_SPAWN_INTERVAL', value => parseNumber(value)],
      ['headerStartX', 'START_X', value => parseNumber(value)],
      ['headerStartY', 'START_Y', value => parseNumber(value)]
    ];

    for (const [key, headerKey, parser] of headerMap) {
      const el = this.el[key];
      if (!el) continue;
      el.addEventListener('change', async () => {
        if (this._suppressHeader) return;
        const parsed = parser(el.value);
        this.controller.updateHeader(headerKey, parsed);
        this.controller.history.pushSnapshot(this.session?.level, 'Header');
        if (headerKey === 'STYLE') {
          await this._reloadAssets();
        }
        this._refreshAfterEdit('Header');
      });
    }
  }

  _bindSelectionFields() {
    const bindField = (el, handler) => {
      if (!el) return;
      el.addEventListener('change', () => {
        if (this._suppressInspector) return;
        handler();
      });
    };

    bindField(this.el.selX, () => this._commitSelectionPatch({ X: parseNumber(this.el.selX.value) }));
    bindField(this.el.selY, () => this._commitSelectionPatch({ Y: parseNumber(this.el.selY.value) }));
    bindField(this.el.selWidth, () => this._commitSelectionPatch({ WIDTH: parseNumber(this.el.selWidth.value) }));
    bindField(this.el.selHeight, () => this._commitSelectionPatch({ HEIGHT: parseNumber(this.el.selHeight.value) }));
    bindField(this.el.selRotate, () => {
      const snapped = normalizeRotation(this.el.selRotate.value);
      this._commitSelectionPatch({ ROTATE: snapped });
      this.el.selRotate.value = snapped == null ? '' : String(snapped);
    });
    bindField(this.el.selSkill, () => this._commitSelectionPatch({ SKILL: normalizeText(this.el.selSkill.value) }));
    bindField(this.el.selLemmings, () => this._commitSelectionPatch({ LEMMINGS: parseNumber(this.el.selLemmings.value) }));
    bindField(this.el.selPairing, () => this._commitSelectionPatch({ PAIRING: parseNumber(this.el.selPairing.value) }));

    bindField(this.el.selFlipH, () => this._commitSelectionPatch({ FLIP_HORIZONTAL: !!this.el.selFlipH.checked }));
    bindField(this.el.selFlipV, () => this._commitSelectionPatch({ FLIP_VERTICAL: !!this.el.selFlipV.checked }));
    bindField(this.el.selNoOverwrite, () => this._commitSelectionPatch({ NO_OVERWRITE: !!this.el.selNoOverwrite.checked }));
    bindField(this.el.selErase, () => this._commitSelectionPatch({ ERASE: !!this.el.selErase.checked }));
    bindField(this.el.selOneWay, () => this._commitSelectionPatch({ ONE_WAY: !!this.el.selOneWay.checked }));

    if (this.el.deleteSelection) {
      this.el.deleteSelection.addEventListener('click', () => {
        if (this.controller.deleteSelected()) {
          this._refreshAfterEdit('Delete');
        }
      });
    }
  }

  _bindBrushControls() {
    if (this.el.snapToggle) {
      this.el.snapToggle.addEventListener('change', () => {
        this.controller.setSnapEnabled(this.el.snapToggle.checked);
        this._updateStatus();
      });
    }
    if (this.el.gridSize) {
      this.el.gridSize.addEventListener('change', () => {
        const value = parseNumber(this.el.gridSize.value);
        this.controller.gridSize = value && value > 0 ? value : 1;
        this._updateStatus();
      });
    }
    if (this.el.brushSize) {
      this.el.brushSize.addEventListener('change', () => {
        const value = parseNumber(this.el.brushSize.value);
        const next = Number.isFinite(value) ? Math.min(Math.max(value, 1), MAX_BRUSH_SIZE) : 1;
        this.controller.setBrushSize(next);
        this.el.brushSize.value = String(next);
      });
    }
    if (this.el.eraseGadgets) {
      this.el.eraseGadgets.addEventListener('change', () => {
        this.controller.setEraseGadgets(this.el.eraseGadgets.checked);
      });
    }
  }

  _bindSavedControls() {
    if (this.el.newLevel) {
      this.el.newLevel.addEventListener('click', () => {
        this._createNewLevel();
      });
    }
    if (this.el.savedSelect) {
      this.el.savedSelect.addEventListener('change', () => {
        const id = this.el.savedSelect.value;
        if (!id) return;
        const text = loadSavedLevel(undefined, id);
        if (!text) return;
        this._currentSavedId = id;
        this._loadLevelFromText(text, { resetSaved: false });
      });
    }

    if (this.el.savedSave) {
      this.el.savedSave.addEventListener('click', () => {
        this._saveCurrentLevel();
      });
    }

    if (this.el.savedExport) {
      this.el.savedExport.addEventListener('click', () => {
        this._exportCurrentLevel();
      });
    }

    if (this.el.savedExportClassic) {
      this.el.savedExportClassic.addEventListener('click', () => {
        this._exportCurrentLevelClassic();
      });
    }

    if (this.el.savedImport && this.el.savedImportInput) {
      this.el.savedImport.addEventListener('click', () => {
        this.el.savedImportInput.click();
      });
      this.el.savedImportInput.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const text = await readTextFile(file);
          if (!text) return;
          this._currentSavedId = '';
          this._loadLevelFromText(text, { resetSaved: true });
        } catch (error) {
          console.error('Failed to read level file.', error);
        } finally {
          event.target.value = '';
        }
      });
    }

    if (this.el.savedImportClassic && this.el.savedImportClassicInput) {
      this.el.savedImportClassic.addEventListener('click', () => {
        this.el.savedImportClassicInput.click();
      });
      this.el.savedImportClassicInput.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          const buffer = await readArrayBufferFile(file);
          if (!buffer) return;
          const binary = new BinaryReader(buffer, 0, undefined, file.name);
          const levelReader = new LevelReader(binary);
          this._currentSavedId = '';
          this._loadLevelFromClassic(levelReader, { resetSaved: true });
        } catch (error) {
          console.error('Failed to read classic level file.', error);
        } finally {
          event.target.value = '';
        }
      });
    }
  }

  _bindLevelSelectors() {
    if (this.el.gameType) {
      this.el.gameType.addEventListener('change', async (event) => {
        const value = this.view?.strToNum?.(event.target.value) ?? event.target.value;
        await this.view?.selectGameType?.(value);
        await this._syncAfterSelection('Load');
      });
    }
    if (this.el.levelGroup) {
      this.el.levelGroup.addEventListener('change', async (event) => {
        const value = this.view?.strToNum?.(event.target.value) ?? event.target.value;
        await this.view?.selectLevelGroup?.(value);
        await this._syncAfterSelection('Load');
      });
    }
    if (this.el.levelIndex) {
      this.el.levelIndex.addEventListener('change', async (event) => {
        const value = this.view?.strToNum?.(event.target.value) ?? event.target.value;
        await this.view?.selectLevel?.(value);
        await this._syncAfterSelection('Load');
      });
    }
  }

  _bindPlaytest() {
    if (!this.el.playtestToggle) return;
    this.el.playtestToggle.addEventListener('click', () => {
      this._togglePlaytest();
    });
  }

  _bindCanvasInput() {
    const display = this.view?.stage?.getGameDisplay?.();
    if (!display) return;
    display.onMouseDown.on(pos => {
      this._clearActiveInputFocus();
      if (this._playtest) return;
      this._pointerDown = true;
      this.controller.handlePointerDown(pos, 0, { shiftKey: this._shiftKey, altKey: this._altKey });
      this._updateCursor(pos);
    });
    display.onMouseRightDown.on(pos => {
      this._clearActiveInputFocus();
      if (this._playtest) return;
      this._pointerDown = false;
      this.controller.handlePointerDown(pos, 2, { shiftKey: this._shiftKey, altKey: this._altKey });
      this._updateCursor(pos);
    });
    display.onMouseUp.on(() => {
      if (this._playtest) return;
      this._pointerDown = false;
      this.controller.handlePointerUp();
      this._refreshAfterEdit('Pointer');
    });
    display.onMouseRightUp.on(() => {
      if (this._playtest) return;
      this.controller.handlePointerUp();
      this._refreshAfterEdit('Pointer');
    });
    display.onMouseMove.on(pos => {
      if (this._playtest) return;
      this.controller.handlePointerMove(pos, { isDown: this._pointerDown });
      this._updateCursor(pos);
    });
  }

  _clearActiveInputFocus() {
    const doc = this.document;
    const active = doc?.activeElement;
    if (!active) return;
    const tag = active.tagName;
    if (active.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'SELECT' ||
        tag === 'TEXTAREA') {
      active.blur?.();
      if (doc?.body) {
        doc.body.tabIndex = -1;
        doc.body.focus?.({ preventScroll: true });
      }
    }
  }

  _updateCursor(pos) {
    if (!pos) return;
    this._cursorPos = { x: pos.x, y: pos.y };
    this._updateStatus();
  }

  _setToolButton(tool) {
    const buttons = this.el.toolList?.querySelectorAll?.('button') || [];
    buttons.forEach(button => {
      const isActive = button.dataset?.tool === tool;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  _applyTooltips() {
    if (!this.keybindings || !this.el.toolList) return;
    const map = {
      select: 'editorToolSelect',
      terrain: 'editorToolTerrain',
      gadget: 'editorToolGadget',
      trigger: 'editorToolTrigger',
      entrance: 'editorToolEntrance',
      exit: 'editorToolExit',
      steel: 'editorToolSteel',
      brush: 'editorToolBrush',
      eraser: 'editorToolEraser'
    };
    const buttons = this.el.toolList.querySelectorAll('button');
    buttons.forEach(button => {
      const tool = button.dataset?.tool;
      const action = map[tool];
      if (!action) return;
      const bindings = this.keybindings.getDisplayBindings(action);
      const base = button.dataset?.tooltip || button.title || '';
      if (!bindings.length) {
        if (base) button.title = base;
        return;
      }
      const suffix = bindings.length === 1
        ? `Shortcut: ${bindings[0]}`
        : `Shortcuts: ${bindings.join(', ')}`;
      button.title = base ? `${base} (${suffix})` : suffix;
    });
  }

  _setPaletteTab(tab) {
    this._activeTab = tab;
    const tabs = this.el.paletteTabs?.querySelectorAll?.('button') || [];
    tabs.forEach(button => button.classList.toggle('active', button.dataset?.tab === tab));
    if (this.el.paletteTerrain) this.el.paletteTerrain.hidden = tab !== 'terrain';
    if (this.el.paletteGadgets) this.el.paletteGadgets.hidden = tab !== 'gadgets';
    if (this.el.paletteTriggers) this.el.paletteTriggers.hidden = tab !== 'triggers';
  }

  _syncPaletteTabForTool(tool) {
    if (tool === 'terrain') {
      this._setPaletteTab('terrain');
    } else if (tool === 'gadget') {
      this._setPaletteTab('gadgets');
    } else if (tool === 'trigger') {
      this._setPaletteTab('triggers');
    }
  }

  _refreshPalettes() {
    if (!this.assets) return;
    this._renderPaletteList(this.el.paletteTerrain, this.assets.terrain, 'terrain');
    this._renderPaletteList(this.el.paletteGadgets, this.assets.gadgets, 'gadget');
    this._renderPaletteList(this.el.paletteTriggers, this.assets.triggers, 'trigger');
    this._applyPaletteFilter();
    this._setPaletteTab(this._activeTab);
    this._refreshPaletteSelection();
  }

  _bindPaletteView() {
    const setMode = (mode) => {
      this._paletteViewMode = mode;
      const isList = mode === 'list';
      if (this.el.paletteViewList) {
        this.el.paletteViewList.classList.toggle('active', isList);
      }
      if (this.el.paletteViewGrid) {
        this.el.paletteViewGrid.classList.toggle('active', !isList);
      }
      this._applyPaletteViewMode();
    };
    if (this.el.paletteViewList) {
      this.el.paletteViewList.addEventListener('click', () => setMode('list'));
    }
    if (this.el.paletteViewGrid) {
      this.el.paletteViewGrid.addEventListener('click', () => setMode('grid'));
    }
    this._applyPaletteViewMode();
    this._bindPaletteGridZoom();
  }

  _bindPaletteGridZoom() {
    const bind = (container) => {
      if (!container) return;
      container.addEventListener('wheel', (event) => {
        if (!event.ctrlKey || this._paletteViewMode !== 'grid') return;
        event.preventDefault();
        const direction = event.deltaY > 0 ? 1 : -1;
        this._setPaletteGridColumns(this._paletteGridColumns + direction);
      }, { passive: false });
    };
    bind(this.el.paletteTerrain);
    bind(this.el.paletteGadgets);
    bind(this.el.paletteTriggers);
  }

  _setPaletteGridColumns(count) {
    const next = Math.min(6, Math.max(2, Math.round(count)));
    this._paletteGridColumns = next;
    this._applyPaletteGridColumns();
  }

  _applyPaletteGridColumns() {
    const apply = (container) => {
      if (!container) return;
      container.style.setProperty('--palette-grid-columns', String(this._paletteGridColumns));
    };
    apply(this.el.paletteTerrain);
    apply(this.el.paletteGadgets);
    apply(this.el.paletteTriggers);
  }

  _applyPaletteViewMode() {
    const useGrid = this._paletteViewMode === 'grid';
    const setGrid = (container) => {
      if (!container) return;
      container.classList.toggle('grid', useGrid);
    };
    setGrid(this.el.paletteTerrain);
    setGrid(this.el.paletteGadgets);
    setGrid(this.el.paletteTriggers);
    this._applyPaletteGridColumns();
  }

  _getPreviewUrl(entry, type) {
    if (!this.previewCache || !this.assets) return null;
    const image = type === 'terrain'
      ? this.assets.terrainImages?.[entry.id]
      : this.assets.gadgetImages?.[entry.id];
    if (!image) return null;
    return this.previewCache.getPreviewUrl({
      type,
      id: entry.id,
      image
    });
  }

  _renderPaletteList(container, items, type) {
    if (!container) return;
    container.innerHTML = '';
    for (const entry of items || []) {
      const width = Number(entry.width || 0);
      const height = Number(entry.height || 0);
      if (width <= 0 && height <= 0) {
        continue;
      }
      const button = this.document.createElement('button');
      button.type = 'button';
      button.dataset.id = String(entry.id);
      button.dataset.type = type;
      const size = `${entry.width || 0}x${entry.height || 0}`;
      const triggerFlag = entry.triggerEffectId ? ` | T${entry.triggerEffectId}` : '';
      const labelText = `#${entry.id} ${entry.name} (${size})${triggerFlag}`;
      const label = this.document.createElement('span');
      label.className = 'palette-label';
      label.textContent = labelText;
      button.title = `Select ${labelText}`;
      const previewWrap = this.document.createElement('span');
      previewWrap.className = 'palette-preview';
      const previewImg = this.document.createElement('img');
      previewImg.alt = labelText;
      previewImg.loading = 'lazy';
      previewWrap.appendChild(previewImg);
      button.append(previewWrap, label);
      button.addEventListener('click', () => {
        const id = Number(entry.id);
        if (type === 'terrain') {
          this.controller.setSelectedTerrain(id);
        } else if (type === 'trigger') {
          this.controller.setSelectedTrigger(id);
          this.controller.setSelectedGadget(id);
        } else {
          this.controller.setSelectedGadget(id);
        }
        this._refreshPaletteSelection();
      });
      const previewUrl = this._getPreviewUrl(entry, type);
      if (previewUrl) {
        previewImg.src = previewUrl;
      } else {
        previewWrap.classList.add('empty');
      }
      container.appendChild(button);
    }
  }

  _applyPaletteFilter() {
    const term = normalizeText(this.el.paletteSearch?.value || '').toLowerCase();
    const filterList = (container) => {
      if (!container) return;
      const items = container.querySelectorAll('button');
      items.forEach(button => {
        if (!term) {
          button.hidden = false;
          return;
        }
        const text = button.textContent?.toLowerCase() || '';
        button.hidden = !text.includes(term);
      });
    };
    filterList(this.el.paletteTerrain);
    filterList(this.el.paletteGadgets);
    filterList(this.el.paletteTriggers);
  }

  _refreshPaletteSelection() {
    const setActive = (container, id) => {
      if (!container) return;
      const buttons = container.querySelectorAll('button');
      buttons.forEach(button => {
        const match = Number(button.dataset.id) === id;
        button.classList.toggle('active', match);
      });
    };
    setActive(this.el.paletteTerrain, this.controller.selectedTerrainId);
    setActive(this.el.paletteGadgets, this.controller.selectedGadgetId);
    setActive(this.el.paletteTriggers, this.controller.selectedTriggerId);
  }

  _refreshHeaderFields(level = this.session?.level) {
    if (!level) return;
    this._suppressHeader = true;
    if (this.el.headerTitle) this.el.headerTitle.value = formatValue(level.getHeader('TITLE'));
    if (this.el.headerStyle) this.el.headerStyle.value = formatValue(level.getHeader('STYLE'));
    if (this.el.headerWidth) this.el.headerWidth.value = formatValue(level.getHeader('WIDTH'));
    if (this.el.headerHeight) this.el.headerHeight.value = formatValue(level.getHeader('HEIGHT'));
    if (this.el.headerLemmings) this.el.headerLemmings.value = formatValue(level.getHeader('LEMMINGS'));
    if (this.el.headerSaveRequirement) this.el.headerSaveRequirement.value = formatValue(level.getHeader('SAVE_REQUIREMENT'));
    if (this.el.headerTimeLimit) this.el.headerTimeLimit.value = formatValue(level.getHeader('TIME_LIMIT'));
    if (this.el.headerSpawnInterval) this.el.headerSpawnInterval.value = formatValue(level.getHeader('MAX_SPAWN_INTERVAL'));
    if (this.el.headerStartX) this.el.headerStartX.value = formatValue(level.getHeader('START_X'));
    if (this.el.headerStartY) this.el.headerStartY.value = formatValue(level.getHeader('START_Y'));
    this._suppressHeader = false;
  }

  async _resolveAvailableStyles() {
    const config = this.view?.gameResources?.config
      || await this.view?.gameFactory?.getConfig?.(this.view?.gameType);
    const pathKey = config?.path || '';
    if (this._styleAvailability.has(pathKey)) {
      return this._styleAvailability.get(pathKey);
    }
    const styleNames = getStyleNames();
    const provider = this.view?.gameFactory?.fileProvider;
    if (!config || !provider?.loadBinary) {
      this._styleAvailability.set(pathKey, styleNames);
      return styleNames;
    }
    const available = [];
    for (const name of styleNames) {
      const style = getStyle(name);
      const groundSet = Number.isFinite(style?.groundSet) ? style.groundSet | 0 : null;
      if (groundSet == null) continue;
      try {
        await Promise.all([
          provider.loadBinary(config.path, `VGAGR${groundSet}.DAT`),
          provider.loadBinary(config.path, `GROUND${groundSet}O.DAT`)
        ]);
        available.push(style.name);
      } catch (e) {
        // Skip styles missing assets in this pack.
      }
    }
    const list = available.length ? available : styleNames;
    this._styleAvailability.set(pathKey, list);
    return list;
  }

  async _refreshStyleOptions() {
    const select = this.el.headerStyle;
    if (!select) return;
    const current = normalizeText(this.session?.level?.getHeader?.('STYLE'));
    const styles = await this._resolveAvailableStyles();
    const normalized = styles.map(name => normalizeText(name));
    const hasCurrent = current && normalized.includes(current);
    const options = current && !hasCurrent
      ? styles.concat([current])
      : styles.slice();
    select.innerHTML = '';
    for (const name of options) {
      const opt = this.document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
    if (current) {
      select.value = current;
    }
  }

  _refreshSelection(selection) {
    const entries = Array.isArray(selection)
      ? selection
      : this.controller.getSelectedEntries();
    this._selection = entries;
    if (!entries.length) {
      this._setSelectionFields(null);
      this._updateSelectionStatus();
      return;
    }
    if (entries.length > 1) {
      this._setSelectionFields({ multi: true, count: entries.length });
      this._updateSelectionStatus();
      return;
    }
    const selected = entries[0];
    const props = selected.entry?.props || {};
    const isSteel = selected.type === 'steel';
    const meta = selected.type === 'gadget'
      ? this.assets?.gadgetById?.get?.(props.PIECE)
      : this.assets?.terrainById?.get?.(props.PIECE);
    const name = isSteel ? 'Steel' : (meta?.name || `#${props.PIECE}`);
    const pieceId = Number(props.PIECE);
    if (!isSteel && Number.isFinite(pieceId)) {
      if (selected.type === 'gadget') {
        this.controller.setSelectedGadget(pieceId);
      } else {
        this.controller.setSelectedTerrain(pieceId);
      }
      this._refreshPaletteSelection();
    }
    this._setSelectionFields({
      type: selected.type,
      name,
      props,
      meta
    });
    this._updateSelectionStatus();
  }

  _setSelectionFields(data) {
    this._suppressInspector = true;
    if (!data) {
      this._toggleSelectionActions(false);
      if (this.el.selType) this.el.selType.textContent = 'None';
      if (this.el.selName) this.el.selName.textContent = '';
      const inputs = [
        this.el.selX,
        this.el.selY,
        this.el.selWidth,
        this.el.selHeight,
        this.el.selRotate,
        this.el.selSkill,
        this.el.selLemmings,
        this.el.selPairing
      ];
      inputs.forEach(input => {
        if (input) {
          input.value = '';
          input.disabled = true;
        }
      });
      const checks = [
        this.el.selFlipH,
        this.el.selFlipV,
        this.el.selNoOverwrite,
        this.el.selErase,
        this.el.selOneWay
      ];
      checks.forEach(check => {
        if (check) {
          check.checked = false;
          check.disabled = true;
        }
      });
      if (this.el.deleteSelection) this.el.deleteSelection.disabled = true;
      this._suppressInspector = false;
      return;
    }

    if (data.multi) {
      this._toggleSelectionActions(true);
      if (this.el.selType) this.el.selType.textContent = 'Multiple';
      if (this.el.selName) this.el.selName.textContent = `${data.count} items`;
      const inputs = [
        this.el.selX,
        this.el.selY,
        this.el.selWidth,
        this.el.selHeight,
        this.el.selRotate,
        this.el.selSkill,
        this.el.selLemmings,
        this.el.selPairing
      ];
      inputs.forEach(input => {
        if (input) {
          input.value = '';
          input.disabled = true;
        }
      });
      const checks = [
        this.el.selFlipH,
        this.el.selFlipV,
        this.el.selNoOverwrite,
        this.el.selErase,
        this.el.selOneWay
      ];
      checks.forEach(check => {
        if (check) {
          check.checked = false;
          check.disabled = true;
        }
      });
      if (this.el.deleteSelection) this.el.deleteSelection.disabled = false;
      this._suppressInspector = false;
      return;
    }

    this._toggleSelectionActions(true);
    if (this.el.selType) this.el.selType.textContent = data.type;
    if (this.el.selName) this.el.selName.textContent = data.name || '';

    const props = data.props || {};
    const meta = data.meta || null;
    const isGadget = data.type === 'gadget';
    const isSteel = data.type === 'steel';
    const supportsResize = isSteel;
    const widthValue = props.WIDTH ?? (isSteel ? undefined : meta?.width);
    const heightValue = props.HEIGHT ?? (isSteel ? undefined : meta?.height);

    if (this.el.selX) {
      this.el.selX.value = formatValue(props.X);
      this.el.selX.disabled = false;
    }
    if (this.el.selY) {
      this.el.selY.value = formatValue(props.Y);
      this.el.selY.disabled = false;
    }
    if (this.el.selWidth) {
      this.el.selWidth.value = formatValue(widthValue);
      this.el.selWidth.disabled = !supportsResize;
    }
    if (this.el.selHeight) {
      this.el.selHeight.value = formatValue(heightValue);
      this.el.selHeight.disabled = !supportsResize;
    }
    if (this.el.selRotate) {
      this.el.selRotate.value = formatRotation(props.ROTATE);
      this.el.selRotate.disabled = isSteel;
    }
    if (this.el.selSkill) {
      this.el.selSkill.value = formatValue(props.SKILL);
      this.el.selSkill.disabled = !isGadget;
    }
    if (this.el.selLemmings) {
      this.el.selLemmings.value = formatValue(props.LEMMINGS);
      this.el.selLemmings.disabled = !isGadget;
    }
    if (this.el.selPairing) {
      this.el.selPairing.value = formatValue(props.PAIRING);
      this.el.selPairing.disabled = !isGadget;
    }

    if (this.el.selFlipH) {
      this.el.selFlipH.checked = !!props.FLIP_HORIZONTAL;
      this.el.selFlipH.disabled = isSteel;
    }
    if (this.el.selFlipV) {
      this.el.selFlipV.checked = !!props.FLIP_VERTICAL;
      this.el.selFlipV.disabled = isSteel;
    }
    if (this.el.selNoOverwrite) {
      this.el.selNoOverwrite.checked = !!props.NO_OVERWRITE;
      this.el.selNoOverwrite.disabled = isGadget || isSteel;
    }
    if (this.el.selErase) {
      this.el.selErase.checked = !!props.ERASE;
      this.el.selErase.disabled = isGadget || isSteel;
    }
    if (this.el.selOneWay) {
      this.el.selOneWay.checked = !!props.ONE_WAY;
      this.el.selOneWay.disabled = true;
    }
    if (this.el.deleteSelection) this.el.deleteSelection.disabled = false;

    this._suppressInspector = false;
  }

  _toggleSelectionActions(visible) {
    if (this.el.selectionActions) {
      this.el.selectionActions.hidden = !visible;
    }
  }

  _commitSelectionPatch(patch) {
    const updated = this.controller.updateSelectedProps(patch);
    if (!updated) return;
    this.controller.history.pushSnapshot(this.session?.level, 'Edit');
    this._refreshAfterEdit('Edit');
  }

  _refreshSavedList(selectedId = this._currentSavedId) {
    if (!this.el.savedSelect) return;
    const entries = listSavedLevels();
    this.el.savedSelect.innerHTML = '';
    const placeholder = this.document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Saved levels';
    this.el.savedSelect.appendChild(placeholder);
    for (const entry of entries) {
      const opt = this.document.createElement('option');
      opt.value = entry.id;
      opt.textContent = entry.name;
      this.el.savedSelect.appendChild(opt);
    }
    this.el.savedSelect.value = selectedId || '';
  }

  _saveCurrentLevel() {
    if (!this.view?.editorSession?.level) return;
    const defaultName = this.view.getEditorLevelTitle?.() || 'Untitled';
    const prompt = this.window?.prompt;
    if (typeof prompt !== 'function') return;
    const name = normalizeText(prompt('Save level as', defaultName));
    if (!name) return;
    const text = this.view.getEditorLevelText();
    const id = saveLevel(undefined, {
      id: this._currentSavedId || undefined,
      name,
      text
    });
    if (!id) return;
    this._currentSavedId = id;
    this._refreshSavedList(id);
    this._setDirty(false);
  }

  async _createNewLevel() {
    if (!this.view) return;
    this.view.createBlankEditorLevel({ render: false });
    this.session = this.view.editorSession || this.session;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.resetHistory('New');
    this._setDirty(false);
    this._refreshUndoRedo();
    this._needsDefaultEntrances = true;
    this._currentSavedId = '';
    this._refreshSavedList('');
    await this._reloadAssets();
    await this._refreshStyleOptions();
    this._refreshHeaderFields();
    this._refreshSelection(null);
    this._refreshValidation();
    await this._refreshPreview('New', { preserveView: false });
  }

  _bindSelectionActions() {
    const bind = (el, handler) => {
      if (!el) return;
      el.addEventListener('click', () => {
        if (handler()) {
          this._refreshAfterEdit('Reorder');
        }
      });
    };
    bind(this.el.selectionBringFront, () => this.controller.bringSelectionToFront());
    bind(this.el.selectionMoveForward, () => this.controller.moveSelectionForward());
    bind(this.el.selectionMoveBackward, () => this.controller.moveSelectionBackward());
    bind(this.el.selectionSendBack, () => this.controller.sendSelectionToBack());
  }

  _bindUndoRedo() {
    if (this.el.undo) {
      this.el.undo.addEventListener('click', () => {
        if (this.controller.undo()) {
          this._refreshAfterEdit('Undo');
        }
      });
    }
    if (this.el.redo) {
      this.el.redo.addEventListener('click', () => {
        if (this.controller.redo()) {
          this._refreshAfterEdit('Redo');
        }
      });
    }
  }

  _ensureDefaultEntrancesExits() {
    if (!this._needsDefaultEntrances) return;
    if (!this.assets) return;
    const viewRect = this.view?.stage?.getGameViewRect?.() || null;
    const added = this.controller.ensureDefaultEntrancesExits({
      entranceId: this.assets?.entranceId,
      exitId: this.assets?.exitId,
      viewRect
    });
    if (added) {
      this._refreshSelection(null);
      this._refreshValidation();
    }
    if (this.assets?.entranceId != null || this.assets?.exitId != null) {
      this._needsDefaultEntrances = false;
    }
  }

  _exportCurrentLevel() {
    this._refreshValidation();
    if (this._hasErrors) {
      this.window?.alert?.('Fix validation errors before exporting.');
      return;
    }
    const text = this.view.getEditorLevelText();
    const title = this.view.getEditorLevelTitle();
    const filename = `${sanitizeFileName(title)}.nxlv`;
    downloadTextFile(this.document, text, filename);
  }

  _exportCurrentLevelClassic() {
    this._refreshValidation();
    if (this._hasErrors) {
      this.window?.alert?.('Fix validation errors before exporting.');
      return;
    }
    if (!this.session?.level) return;
    const classic = createClassicLevelData(this.session.level);
    if (!classic?.levelReader) return;
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
    const title = this.view.getEditorLevelTitle();
    const filename = `${sanitizeFileName(title)}.lvl`;
    downloadBinaryFile(this.document, bytes, filename);
  }

  async _syncAfterSelection(label) {
    if (!this.view) return;
    this._currentSavedId = '';
    this.session = this.view.editorSession || this.session;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.clearSelection();
    await this._reloadAssets();
    this.controller.resetHistory(label || 'Load');
    this._setDirty(false);
    this._refreshUndoRedo();
    this._refreshHeaderFields(this.session?.level);
    this._refreshSelection(null);
    this._refreshValidation();
    this._refreshSavedList('');
    this._drawSelectionOverlay();
    this._updateStatus(label || 'Load');
  }

  _loadLevelFromText(text, options = {}) {
    if (!this.view) return;
    const level = this.view.loadEditorLevelFromText(text, { render: false });
    if (!level) return;
    this.session = this.view.editorSession;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.clearSelection();
    this._reloadAssets().then(async () => {
      this.controller.resetHistory('Import');
      this._setDirty(false);
      this._refreshUndoRedo();
      this._refreshHeaderFields(level);
      this._refreshSelection(null);
      this._refreshValidation();
      if (options.resetSaved) this._refreshSavedList('');
      await this._refreshPreview('Import', { preserveView: false });
    });
  }

  _loadLevelFromClassic(levelReader, options = {}) {
    if (!this.view) return;
    const session = this.view.ensureEditorSession?.() || this.session;
    const editorLevel = createEditorLevelFromClassic(levelReader);
    if (!editorLevel) return;
    session.level = editorLevel;
    this.session = session;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.clearSelection();
    this._reloadAssets().then(async () => {
      this.controller.resetHistory('Import LVL');
      this._setDirty(false);
      this._refreshUndoRedo();
      this._refreshHeaderFields(editorLevel);
      this._refreshSelection(null);
      this._refreshValidation();
      if (options.resetSaved) this._refreshSavedList('');
      await this._refreshPreview('Import LVL', { preserveView: false });
    });
  }

  async _reloadAssets() {
    const config = this.view?.gameResources?.config
      || await this.view?.gameFactory?.getConfig?.(this.view?.gameType);
    const styleName = this.session?.level?.getHeader?.('STYLE');
    this.assets = await this.assetCache.loadStyleAssets(
      styleName,
      config,
      this.view?.gameFactory?.fileProvider
    );
    this.controller.setAssets(this.assets);
    this._refreshPalettes();
    await this._refreshStyleOptions();
  }

  async _refreshPreview(label, options = {}) {
    if (!this.view) return;
    const preserveView = options.preserveView !== false;
    if (this._previewInFlight) {
      this._previewQueued = true;
      const nextLabel = label || 'Preview';
      if (this._previewQueuedLabel && this._previewQueuedLabel !== nextLabel) {
        this._previewQueuedLabel = 'Preview';
      } else {
        this._previewQueuedLabel = nextLabel;
      }
      const queuedPreserve = this._previewQueuedOptions?.preserveView ?? true;
      this._previewQueuedOptions = { preserveView: queuedPreserve && preserveView };
      return;
    }
    this._previewInFlight = true;
    try {
      await this.view.loadEditorPreviewLevel({
        suspend: !this._playtest,
        preserveView
      });
      this.view.setEditorPlaytest(this._playtest);
      this._ensureDefaultEntrancesExits();
      this._drawSelectionOverlay();
      this._updateStatus(label || 'Preview');
    } finally {
      this._previewInFlight = false;
      if (this._previewQueued) {
        const nextLabel = this._previewQueuedLabel || 'Queued';
        const nextOptions = this._previewQueuedOptions || {};
        this._previewQueued = false;
        this._previewQueuedLabel = null;
        this._previewQueuedOptions = null;
        this._refreshPreview(nextLabel, nextOptions);
      }
    }
  }

  _refreshAfterEdit(label) {
    this._refreshValidation();
    this._drawSelectionOverlay();
    this._updateStatus(label || 'Edit');
    this._setDirty(true);
    this._refreshUndoRedo();
  }

  _setDirty(isDirty) {
    this._dirty = !!isDirty;
    if (this.el.dirtyStatus) {
      this.el.dirtyStatus.textContent = this._dirty ? 'Unsaved' : 'Saved';
      this.el.dirtyStatus.classList.toggle('is-dirty', this._dirty);
    }
    if (this.document) {
      this.document.title = this._dirty ? `${this._baseTitle} *` : this._baseTitle;
    }
  }

  _refreshUndoRedo() {
    const canUndo = !!this.controller?.history?.canUndo?.();
    const canRedo = !!this.controller?.history?.canRedo?.();
    if (this.el.undo) this.el.undo.disabled = !canUndo;
    if (this.el.redo) this.el.redo.disabled = !canRedo;
  }

  _refreshValidation() {
    const issues = validateLevel(this.session?.level, this.assets || null);
    this._renderIssues(issues);
  }

  _renderIssues(issues) {
    this._hasErrors = false;
    if (!this.el.issuesList) return;
    this.el.issuesList.innerHTML = '';
    for (const issue of issues) {
      if (issue.severity === 'error') this._hasErrors = true;
      const item = this.document.createElement('div');
      item.className = `issue-item ${issue.severity}`;
      const message = this.document.createElement('div');
      message.textContent = issue.message;
      item.appendChild(message);
      if (issue.fix) {
        const button = this.document.createElement('button');
        button.type = 'button';
        button.textContent = issue.fixLabel || 'Fix';
        button.title = issue.fixLabel
          ? `Apply fix: ${issue.fixLabel}`
          : 'Apply automatic fix.';
        button.addEventListener('click', () => {
          issue.fix();
          this.controller.history.pushSnapshot(this.session?.level, 'Fix');
          this._refreshAfterEdit('Fix');
          this._refreshPreview('Fix');
        });
        item.appendChild(button);
      }
      this.el.issuesList.appendChild(item);
    }
  }

  _updateStatus(label) {
    if (this.el.cursorStatus) {
      if (this._cursorPos) {
        const cx = Math.round(this._cursorPos.x);
        const cy = Math.round(this._cursorPos.y);
        this.el.cursorStatus.textContent = `X:${cx} Y:${cy}`;
      } else {
        this.el.cursorStatus.textContent = 'X:— Y:—';
      }
    }
    if (!this.el.status) return;
    const parts = [];
    if (label) parts.push(label);
    parts.push(`Tool: ${this.controller.tool}`);
    const grid = this.controller.snapEnabled
      ? `Grid ${this.controller.gridSize}`
      : 'Grid off';
    parts.push(grid);
    parts.push(this._playtest ? 'Playtest' : 'Edit');
    this.el.status.textContent = parts.join(' • ');
  }

  _updateSelectionStatus() {
    if (!this.el.selectionStatus) return;
    if (!this._selection || this._selection.length === 0) {
      this.el.selectionStatus.textContent = 'No selection';
      return;
    }
    if (this._selection.length > 1) {
      this.el.selectionStatus.textContent = `${this._selection.length} selected`;
      return;
    }
    const selected = this._selection[0];
    const props = selected.entry?.props || {};
    const name = selected.type === 'steel'
      ? 'steel'
      : (selected.entry?.props?.PIECE ?? 'unknown');
    this.el.selectionStatus.textContent = `${selected.type} #${name} @ ${props.X ?? 0},${props.Y ?? 0}`;
  }

  _drawSelectionOverlay() {
    if (!this.view?.game || !this.view.stage) return;
    this.view.game.render();
    const display = this.view.stage.getGameDisplay();
    const selectedEntries = this.controller.getSelectedEntries();
    const marquee = this.controller.getMarqueeBounds();
    const steelEntries = this.session?.level?.steel;
    if (marquee) {
      this._antsOffset = (this._antsOffset + 1) % 12;
      display.drawMarchingAntRect(
        marquee.x,
        marquee.y,
        marquee.width,
        marquee.height,
        3,
        this._antsOffset,
        0xFFFFFFFF,
        0x00000000
      );
    }
    if (display?.drawStippleRect && Array.isArray(steelEntries)) {
      const gridSize = 16;
      for (const entry of steelEntries) {
        const bounds = getEntryBounds(entry, null);
        display.drawStippleRect(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          0,
          180,
          180
        );
        for (let x = bounds.x; x <= bounds.x + bounds.width; x += gridSize) {
          display.drawStippleRect(x, bounds.y, 0, bounds.height, 0, 255, 255);
        }
        for (let y = bounds.y; y <= bounds.y + bounds.height; y += gridSize) {
          display.drawStippleRect(bounds.x, y, bounds.width, 0, 0, 255, 255);
        }
      }
    }
    for (const selected of selectedEntries) {
      const meta = selected.type === 'steel'
        ? null
        : selected.type === 'gadget'
          ? this.assets?.gadgetById?.get?.(selected.entry?.props?.PIECE)
          : this.assets?.terrainById?.get?.(selected.entry?.props?.PIECE);
      const bounds = getEntryBounds(selected.entry, meta);
      display.drawDashedRect(bounds.x, bounds.y, bounds.width, bounds.height, 210, 106, 60, 3);
    }
    if (selectedEntries.length === 1 && this.controller.canResizeSelection?.()) {
      const selected = selectedEntries[0];
      const meta = selected.type === 'steel'
        ? null
        : selected.type === 'gadget'
          ? this.assets?.gadgetById?.get?.(selected.entry?.props?.PIECE)
          : this.assets?.terrainById?.get?.(selected.entry?.props?.PIECE);
      const bounds = getEntryBounds(selected.entry, meta);
      const handleSize = this.controller.getHandleSize();
      const half = Math.max(1, Math.floor(handleSize / 2));
      const midX = bounds.x + Math.round(bounds.width / 2);
      const midY = bounds.y + Math.round(bounds.height / 2);
      const handles = [
        [bounds.x, bounds.y],
        [midX, bounds.y],
        [bounds.x + bounds.width, bounds.y],
        [bounds.x + bounds.width, midY],
        [bounds.x + bounds.width, bounds.y + bounds.height],
        [midX, bounds.y + bounds.height],
        [bounds.x, bounds.y + bounds.height],
        [bounds.x, midY]
      ];
      for (const [hx, hy] of handles) {
        display.drawRect(hx - half, hy - half, handleSize - 1, handleSize - 1, 255, 255, 255, true);
      }
    }
    this.view.stage.redraw();
  }

  _togglePlaytest() {
    this._playtest = !this._playtest;
    this.view?.setEditorPlaytest?.(this._playtest);
    if (this.el.playtestToggle) {
      this.el.playtestToggle.classList.toggle('is-active', this._playtest);
      this.el.playtestToggle.textContent = this._playtest ? 'Playtest On' : 'Playtest';
    }
    this._updateStatus('Playtest');
  }
}

export { EditorUiController };
