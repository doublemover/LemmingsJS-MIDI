import {
  BinaryReader,
  EDITOR_SHORTCUT_SECTIONS,
  EditorAssetCache,
  EditorController,
  EditorHistory,
  EditorKeybindings,
  EditorPreviewCache,
  HISTORY_COALESCE_WINDOW_MS,
  LevelReader,
  LevelWriter,
  MAX_BRUSH_SIZE,
  MAX_HISTORY,
  MAX_HISTORY_BYTES,
  PALETTE_PREVIEW_BATCH_SIZE,
  PALETTE_SEARCH_DEBOUNCE_MS,
  ShortcutOverlay,
  createClassicLevelData,
  createEditorLevelFromClassic,
  downloadBinaryFile,
  downloadTextFile,
  ensureLevelEntryUids,
  formatRotation,
  formatValue,
  getEntryBounds,
  getRuntimeDependency,
  getStyle,
  getStyleNames,
  listSavedLevels,
  loadSavedLevel,
  normalizeRotation,
  normalizeText,
  parseNumber,
  readArrayBufferFile,
  readTextFile,
  sanitizeFileName,
  saveLevel,
  validateLevel
} from './EditorUiControllerShared.js';
const editorPaletteUiMethods = {
  _setPaletteTab(tab) {
    this._activeTab = tab;
    const tabs = this.el.paletteTabs?.querySelectorAll?.('button') || [];
    tabs.forEach(button => button.classList.toggle('active', button.dataset?.tab === tab));
    if (this.el.paletteTerrain) this.el.paletteTerrain.hidden = tab !== 'terrain';
    if (this.el.paletteGadgets) this.el.paletteGadgets.hidden = tab !== 'gadgets';
    if (this.el.paletteTriggers) this.el.paletteTriggers.hidden = tab !== 'triggers';
    this._schedulePalettePreviewHydration();
  },

  _syncPaletteTabForTool(tool) {
    if (tool === 'terrain') {
      this._setPaletteTab('terrain');
    } else if (tool === 'gadget') {
      this._setPaletteTab('gadgets');
    } else if (tool === 'trigger' || tool === 'midi-flag') {
      this._setPaletteTab('triggers');
    }
  },

  _refreshPalettes() {
    if (!this.assets) return;
    this._cancelPalettePreviewHydration();
    this._renderPaletteList(this.el.paletteTerrain, this.assets.terrain, 'terrain');
    this._renderPaletteList(this.el.paletteGadgets, this.assets.gadgets, 'gadget');
    this._renderPaletteList(this.el.paletteTriggers, this.assets.triggers, 'trigger');
    this._applyPaletteFilter();
    this._setPaletteTab(this._activeTab);
    this._refreshPaletteSelection();
  },

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
      this._addDomListener(this.el.paletteViewList, 'click', () => setMode('list'));
    }
    if (this.el.paletteViewGrid) {
      this._addDomListener(this.el.paletteViewGrid, 'click', () => setMode('grid'));
    }
    this._applyPaletteViewMode();
    this._bindPaletteGridZoom();
  },

  _bindPaletteGridZoom() {
    const bind = (container) => {
      if (!container) return;
      this._addDomListener(container, 'wheel', (event) => {
        if (!event.ctrlKey || this._paletteViewMode !== 'grid') return;
        if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
        event.preventDefault();
        const direction = event.deltaY > 0 ? 1 : -1;
        this._setPaletteGridColumns(this._paletteGridColumns + direction);
      }, { passive: false });
    };
    bind(this.el.paletteTerrain);
    bind(this.el.paletteGadgets);
    bind(this.el.paletteTriggers);
  },

  _setPaletteGridColumns(count) {
    const next = Math.min(6, Math.max(2, Math.round(count)));
    this._paletteGridColumns = next;
    this._applyPaletteGridColumns();
  },

  _applyPaletteGridColumns() {
    const apply = (container) => {
      if (!container) return;
      container.style.setProperty('--palette-grid-columns', String(this._paletteGridColumns));
    };
    apply(this.el.paletteTerrain);
    apply(this.el.paletteGadgets);
    apply(this.el.paletteTriggers);
  },

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
  },

  _getPreviewUrl(entry, type) {
    if (!this.previewCache || !this.assets) return null;
    const cacheType = type === 'trigger' ? 'gadget' : type;
    const image = type === 'terrain'
      ? this.assets.terrainImages?.[entry.id]
      : this.assets.gadgetImages?.[entry.id];
    if (!image) return null;
    return this.previewCache.getPreviewUrl({
      type: cacheType,
      id: entry.id,
      image
    });
  },

  _cancelPalettePreviewHydration() {
    this._palettePreviewToken += 1;
    this._palettePreviewQueue = [];
    this._palettePreviewIndex = 0;
    if (this._palettePreviewTimer) {
      clearTimeout(this._palettePreviewTimer);
      this._palettePreviewTimer = null;
    }
  },

  _getActivePaletteTypes() {
    if (this._activeTab === 'gadgets') return ['gadget'];
    if (this._activeTab === 'triggers') return ['trigger'];
    return ['terrain'];
  },

  _schedulePalettePreviewHydration() {
    const types = this._getActivePaletteTypes();
    const queue = [];
    for (const type of types) {
      const records = this._paletteEntries[type] || [];
      for (const record of records) {
        if (record.button.hidden || record.previewLoaded) continue;
        queue.push(record);
      }
    }
    this._palettePreviewToken += 1;
    const token = this._palettePreviewToken;
    this._palettePreviewQueue = queue;
    this._palettePreviewIndex = 0;
    if (this._palettePreviewTimer) {
      clearTimeout(this._palettePreviewTimer);
      this._palettePreviewTimer = null;
    }
    if (!this._palettePreviewQueue.length) {
      return;
    }
    const pump = () => {
      if (token !== this._palettePreviewToken) return;
      let remaining = PALETTE_PREVIEW_BATCH_SIZE;
      while (remaining > 0 && this._palettePreviewIndex < this._palettePreviewQueue.length) {
        const record = this._palettePreviewQueue[this._palettePreviewIndex];
        this._palettePreviewIndex += 1;
        if (!record || record.button.hidden || record.previewLoaded) {
          continue;
        }
        const previewUrl = this._getPreviewUrl(record.entry, record.type);
        if (previewUrl) {
          record.previewImg.src = previewUrl;
          record.previewWrap.classList.remove('empty');
        } else {
          record.previewWrap.classList.add('empty');
        }
        record.previewLoaded = true;
        record.previewWrap.classList.remove('pending');
        remaining -= 1;
      }
      if (this._palettePreviewIndex < this._palettePreviewQueue.length) {
        this._palettePreviewTimer = setTimeout(pump, 0);
      } else {
        this._palettePreviewQueue = [];
        this._palettePreviewIndex = 0;
        this._palettePreviewTimer = null;
      }
    };
    this._palettePreviewTimer = setTimeout(pump, 0);
  },

  _applyPaletteFilter() {
    const term = normalizeText(this.el.paletteSearch?.value || '').toLowerCase();
    const filterList = (type) => {
      const entries = this._paletteEntries[type] || [];
      for (const record of entries) {
        record.button.hidden = !!(term && !record.searchKey.includes(term));
      }
    };
    filterList('terrain');
    filterList('gadget');
    filterList('trigger');
    this._schedulePalettePreviewHydration();
  },

  _refreshPaletteSelection() {
    const setActive = (type, id) => {
      const entries = this._paletteEntries[type] || [];
      for (const record of entries) {
        const match = Number(record.id) === id;
        record.button.classList.toggle('active', match);
      }
    };
    setActive('terrain', this.controller.selectedTerrainId);
    setActive('gadget', this.controller.selectedGadgetId);
    setActive('trigger', this.controller.selectedTriggerId);
  },

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
  },

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
  },

  async _refreshStyleOptions() {
    const select = this.el.headerStyle;
    if (!select) return;
    const toStyleKey = value => normalizeText(value).toLowerCase();
    const current = normalizeText(this.session?.level?.getHeader?.('STYLE'));
    const currentKey = toStyleKey(current);
    const styles = await this._resolveAvailableStyles();
    const options = styles.slice();
    const optionKeyToName = new Map();
    for (const name of options) {
      optionKeyToName.set(toStyleKey(name), name);
    }
    if (current && !optionKeyToName.has(currentKey)) {
      options.push(current);
      optionKeyToName.set(currentKey, current);
    }
    select.innerHTML = '';
    for (const name of options) {
      const opt = this.document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
    if (current) {
      select.value = optionKeyToName.get(currentKey) || current;
    }
  }
};
export { editorPaletteUiMethods };