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
  NxlvParser,
  PALETTE_PREVIEW_BATCH_SIZE,
  PALETTE_SEARCH_DEBOUNCE_MS,
  ShortcutOverlay,
  createClassicLevelData,
  createEditorProject,
  createEditorProjectPackArchive,
  createEditorLevelFromClassic,
  createEditorProjectPackBundle,
  createValidationReport,
  deleteEditorProjectLevel,
  downloadBinaryFile,
  downloadTextFile,
  duplicateEditorProjectLevel,
  ensureLevelEntryUids,
  formatRotation,
  formatValue,
  getEntryBounds,
  getRuntimeDependency,
  getStyle,
  getStyleNames,
  installEditorProjectPackArchive,
  listSavedProjects,
  listSavedLevels,
  loadEditorProject,
  loadSavedLevel,
  normalizeRotation,
  normalizeText,
  parseNumber,
  readArrayBufferFile,
  readTextFile,
  renameEditorProjectLevel,
  sanitizeFileName,
  saveEditorProject,
  saveLevel,
  upsertEditorProjectLevel,
  validateLevel
} from './EditorUiControllerShared.js';
import {
  getClassicExportLossSummary
} from './editorClassicSubsetContract.js';
const editorLevelIoUiMethods = {
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
  },

  _refreshProjectList(selectedId = this._currentProject?.id || '') {
    if (!this.el.projectSelect) return;
    const entries = listSavedProjects();
    this.el.projectSelect.innerHTML = '';
    const placeholder = this.document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Projects';
    this.el.projectSelect.appendChild(placeholder);
    for (const entry of entries) {
      const opt = this.document.createElement('option');
      opt.value = entry.id;
      opt.textContent = `${entry.name} (${entry.levelCount})`;
      this.el.projectSelect.appendChild(opt);
    }
    this.el.projectSelect.value = selectedId || '';
    this._refreshProjectLevelList(this._currentProject?.activeLevelId || '');
  },

  _refreshProjectLevelList(selectedId = this._currentProject?.activeLevelId || '') {
    if (!this.el.projectLevelSelect) return;
    this.el.projectLevelSelect.innerHTML = '';
    const placeholder = this.document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Project levels';
    this.el.projectLevelSelect.appendChild(placeholder);
    const levels = Array.isArray(this._currentProject?.levels) ? this._currentProject.levels : [];
    for (const level of levels) {
      const opt = this.document.createElement('option');
      opt.value = level.id;
      opt.textContent = level.title;
      this.el.projectLevelSelect.appendChild(opt);
    }
    this.el.projectLevelSelect.value = selectedId || '';
  },

  _getCurrentProjectLevelPayload(title = this.view?.getEditorLevelTitle?.() || 'Untitled') {
    const level = this.session?.level;
    return {
      title: normalizeText(title) || this.view?.getEditorLevelTitle?.() || 'Untitled',
      style: level?.getHeader?.('STYLE') || '',
      text: this.view?.getEditorLevelText?.() || '',
      updatedAt: Date.now()
    };
  },

  _promptText(message, fallback) {
    const prompt = this.window?.prompt;
    if (typeof prompt !== 'function') return normalizeText(fallback);
    return normalizeText(prompt(message, fallback));
  },

  _saveProjectAndRefresh(project, label = 'Project') {
    this._currentProject = project;
    saveEditorProject(undefined, project);
    this._refreshProjectList(project.id);
    this._refreshProjectLevelList(project.activeLevelId);
    this._updateStatus(label);
  },

  _createProjectFromCurrentLevel() {
    const defaultName = this.view?.getEditorLevelTitle?.() || 'Untitled Project';
    const name = this._promptText('Project name', defaultName);
    if (!name) return null;
    const project = createEditorProject({
      name,
      text: this.view?.getEditorLevelText?.() || '',
      title: this.view?.getEditorLevelTitle?.() || 'Untitled',
      style: this.session?.level?.getHeader?.('STYLE') || ''
    });
    this._saveProjectAndRefresh(project, 'New project');
    return project;
  },

  _saveCurrentLevelToProject(options = {}) {
    let project = this._currentProject;
    if (!project) {
      project = this._createProjectFromCurrentLevel();
      return !!project;
    }
    const forceNew = options.forceNew === true;
    const activeId = forceNew ? null : project.activeLevelId;
    const activeLevel = project.levels.find(level => level.id === project.activeLevelId);
    const fallbackTitle = this.view?.getEditorLevelTitle?.() || 'Untitled';
    const title = forceNew
      ? this._promptText('Project level name', fallbackTitle)
      : (options.preserveTitle === true ? activeLevel?.title || fallbackTitle : fallbackTitle);
    if (forceNew && !title) return false;
    project = upsertEditorProjectLevel(project, {
      id: activeId || undefined,
      ...this._getCurrentProjectLevelPayload(title)
    });
    this._saveProjectAndRefresh(project, forceNew ? 'Project level added' : 'Project level saved');
    this._setDirty(false);
    return true;
  },

  _loadProjectById(id) {
    const project = loadEditorProject(undefined, id);
    if (!project) return false;
    this._currentProject = project;
    this._refreshProjectList(project.id);
    this._refreshProjectLevelList(project.activeLevelId);
    const active = project.levels.find(level => level.id === project.activeLevelId) || project.levels[0];
    if (active) {
      this._loadLevelFromText(active.text, { resetSaved: false });
    }
    this._updateStatus('Project loaded');
    return true;
  },

  _loadProjectLevel(levelId) {
    if (!this._currentProject || !levelId) return false;
    const level = this._currentProject.levels.find(entry => entry.id === levelId);
    if (!level) return false;
    this._currentProject.activeLevelId = level.id;
    saveEditorProject(undefined, this._currentProject);
    this._refreshProjectList(this._currentProject.id);
    this._refreshProjectLevelList(level.id);
    this._loadLevelFromText(level.text, { resetSaved: false });
    this._updateStatus('Project level loaded');
    return true;
  },

  _duplicateProjectLevel() {
    if (!this._currentProject?.activeLevelId) return false;
    this._saveCurrentLevelToProject({ preserveTitle: true });
    const activeLevel = this._currentProject.activeLevelId;
    const source = this._currentProject.levels.find(level => level.id === activeLevel);
    const title = this._promptText('Duplicate level as', `${source?.title || 'Level'} Copy`);
    if (!title) return false;
    const project = duplicateEditorProjectLevel(this._currentProject, activeLevel, { title });
    this._saveProjectAndRefresh(project, 'Project level duplicated');
    this._loadProjectLevel(project.activeLevelId);
    return true;
  },

  _renameProjectLevel() {
    if (!this._currentProject?.activeLevelId) return false;
    const level = this._currentProject.levels.find(entry => entry.id === this._currentProject.activeLevelId);
    if (!level) return false;
    const title = this._promptText('Rename project level', level.title);
    if (!title) return false;
    const project = renameEditorProjectLevel(this._currentProject, level.id, title);
    this._saveProjectAndRefresh(project, 'Project level renamed');
    return true;
  },

  _deleteProjectLevel() {
    if (!this._currentProject?.activeLevelId) return false;
    const confirm = this.window?.confirm;
    if (typeof confirm === 'function' && !confirm('Delete this project level?')) return false;
    const activeLevel = this._currentProject.activeLevelId;
    const project = deleteEditorProjectLevel(this._currentProject, activeLevel);
    this._saveProjectAndRefresh(project, 'Project level deleted');
    if (project.activeLevelId) {
      this._loadProjectLevel(project.activeLevelId);
    } else {
      this._createNewLevel();
    }
    return true;
  },

  _buildProjectValidationReports(project) {
    const reports = {};
    for (const levelEntry of project?.levels || []) {
      let parsedLevel = null;
      try {
        parsedLevel = levelEntry.id === project.activeLevelId && this.session?.level
          ? this.session.level
          : NxlvParser.parse(levelEntry.text);
      } catch (error) {
        reports[levelEntry.id] = {
          kind: 'editor-validation-report',
          schemaVersion: 1,
          level: {
            id: levelEntry.id,
            title: levelEntry.title,
            style: levelEntry.style
          },
          pack: null,
          summary: { total: 1, errors: 1, warnings: 0, infos: 0, blockers: 1, destructive: 0, unsupportedPreservedData: 0 },
          issues: [{
            index: 0,
            source: 'project-export',
            severity: 'error',
            code: 'project_level_parse_failed',
            target: `levels.${levelEntry.id}`,
            message: 'Project level could not be parsed for validation.',
            blocker: true,
            blocksEditing: false,
            blocksExport: true,
            destructive: false,
            exportFormat: null,
            hasFix: false,
            fixLabel: null,
            metadata: {}
          }]
        };
        continue;
      }
      reports[levelEntry.id] = createValidationReport(parsedLevel, this.assets || null, {
        pack: {
          title: project.name,
          levels: [parsedLevel]
        },
        assetsByStyle: this.assets?.styleName
          ? { [this.assets.styleName]: this.assets }
          : null
      });
    }
    return reports;
  },

  _buildProjectPackValidationReport(project) {
    const levels = [];
    for (const levelEntry of project?.levels || []) {
      try {
        levels.push(levelEntry.id === project.activeLevelId && this.session?.level
          ? this.session.level
          : NxlvParser.parse(levelEntry.text));
      } catch (error) {
        // Per-level reports carry parse failures; pack consistency can still
        // run on parseable levels.
      }
    }
    const level = levels[0] || this.session?.level || null;
    return createValidationReport(level, this.assets || null, {
      pack: {
        title: project?.name || 'Editor project',
        levels
      },
      assetsByStyle: this.assets?.styleName
        ? { [this.assets.styleName]: this.assets }
        : null
    });
  },

  _exportCurrentProjectPack() {
    if (!this._currentProject) {
      const project = this._createProjectFromCurrentLevel();
      if (!project) return false;
    } else {
      this._saveCurrentLevelToProject();
    }
    const reportsByLevelId = this._buildProjectValidationReports(this._currentProject);
    const packValidationReport = this._buildProjectPackValidationReport(this._currentProject);
    const bundle = createEditorProjectPackBundle(this._currentProject, {
      packValidationReport,
      reportsByLevelId
    });
    const filename = `${sanitizeFileName(this._currentProject.name)}.editor-pack.json`;
    downloadTextFile(this.document, JSON.stringify(bundle, null, 2), filename, 'application/json');
    this._updateStatus('Project pack export');
    return true;
  },

  _exportCurrentProjectPackArchive() {
    if (!this._currentProject) {
      const project = this._createProjectFromCurrentLevel();
      if (!project) return false;
    } else {
      this._saveCurrentLevelToProject();
    }
    const reportsByLevelId = this._buildProjectValidationReports(this._currentProject);
    const packValidationReport = this._buildProjectPackValidationReport(this._currentProject);
    const archive = createEditorProjectPackArchive(this._currentProject, {
      packValidationReport,
      reportsByLevelId
    });
    const filename = `${sanitizeFileName(this._currentProject.name)}.editor-pack-archive.json`;
    downloadTextFile(this.document, JSON.stringify(archive, null, 2), filename, 'application/json');
    this._updateStatus('Project pack archive export');
    return true;
  },

  _installProjectPackArchiveText(text) {
    const result = installEditorProjectPackArchive(undefined, text);
    if (!result.ok || !result.project) {
      const summary = result.report?.summary;
      const reason = summary?.errors
        ? `${summary.errors} archive error${summary.errors === 1 ? '' : 's'}`
        : 'invalid archive';
      this.window?.alert?.(`Pack archive install failed: ${reason}.`);
      this._updateStatus('Pack archive install failed');
      return result;
    }
    this._currentProject = result.project;
    this._refreshProjectList(result.project.id);
    this._refreshProjectLevelList(result.project.activeLevelId);
    const active = result.project.levels.find(level => level.id === result.project.activeLevelId)
      || result.project.levels[0];
    if (active) {
      this._loadLevelFromText(active.text, { resetSaved: false });
    }
    this._updateStatus(`Pack archive installed: ${result.project.name}`);
    return result;
  },

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
  },

  async _createNewLevel() {
    if (!this.view) return;
    const token = this._nextAsyncToken();
    this._clearTransientIssue?.('import');
    this._clearSolvabilityCheck?.();
    this.view.createBlankEditorLevel({ render: false });
    this.session = this.view.editorSession || this.session;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.resetHistory('New');
    this._setDirty(false);
    this._refreshUndoRedo();
    this._needsDefaultEntrances = true;
    this._currentSavedId = '';
    this._currentProject = null;
    this._refreshSavedList('');
    this._refreshProjectList('');
    await this._reloadAssets(token);
    if (!this._isAsyncCurrent(token)) return;
    await this._refreshStyleOptions();
    this._refreshHeaderFields();
    this._refreshSelection(null);
    this._refreshValidation();
    await this._refreshPreview('New', { preserveView: false, token });
  },

  _bindSelectionActions() {
    const bind = (el, handler, label = 'Selection') => {
      if (!el) return;
      this._addDomListener(el, 'click', () => {
        if (handler()) {
          this._refreshAfterEdit(label);
        }
      });
    };
    const parsePieceIds = (value) => {
      const text = normalizeText(value);
      if (!text) return [];
      return text
        .split(/[,\s]+/)
        .map(token => parseNumber(token))
        .filter(id => Number.isFinite(id));
    };

    bind(this.el.selectionBringFront, () => this.controller.bringSelectionToFront(), 'Reorder');
    bind(this.el.selectionMoveForward, () => this.controller.moveSelectionForward(), 'Reorder');
    bind(this.el.selectionMoveBackward, () => this.controller.moveSelectionBackward(), 'Reorder');
    bind(this.el.selectionSendBack, () => this.controller.sendSelectionToBack(), 'Reorder');

    bind(this.el.selectionAlignLeft, () => this.controller.alignSelection('x', 'min'), 'Align');
    bind(this.el.selectionAlignCenter, () => this.controller.alignSelection('x', 'center'), 'Align');
    bind(this.el.selectionAlignRight, () => this.controller.alignSelection('x', 'max'), 'Align');
    bind(this.el.selectionAlignTop, () => this.controller.alignSelection('y', 'min'), 'Align');
    bind(this.el.selectionAlignMiddle, () => this.controller.alignSelection('y', 'center'), 'Align');
    bind(this.el.selectionAlignBottom, () => this.controller.alignSelection('y', 'max'), 'Align');
    bind(this.el.selectionDistributeX, () => this.controller.distributeSelection('x'), 'Distribute');
    bind(this.el.selectionDistributeY, () => this.controller.distributeSelection('y'), 'Distribute');

    bind(this.el.selectionReplaceApply, () => {
      const pieceId = parseNumber(this.el.selectionReplacePiece?.value);
      return this.controller.replaceSelectionPiece(pieceId);
    }, 'Replace');

    bind(this.el.selectionRandomApply, () => {
      const pieceIds = parsePieceIds(this.el.selectionRandomPieces?.value);
      const seed = parseNumber(this.el.selectionRandomSeed?.value);
      const requireSameSize = !!this.el.selectionRandomSameSize?.checked;
      return this.controller.randomizeSelectionPieces(pieceIds, {
        requireSameSize,
        seed
      });
    }, 'Randomize');

    bind(this.el.selectionTransformApply, () => {
      const scaleX = parseNumber(this.el.selectionScaleX?.value);
      const scaleY = parseNumber(this.el.selectionScaleY?.value);
      return this.controller.transformSelectionGroup({
        scaleX: Number.isFinite(scaleX) ? scaleX : 1,
        scaleY: Number.isFinite(scaleY) ? scaleY : 1
      });
    }, 'Transform');
  },

  _bindUndoRedo() {
    if (this.el.undo) {
      this._addDomListener(this.el.undo, 'click', () => {
        if (this.controller.undo()) {
          this._refreshAfterEdit('Undo');
        }
      });
    }
    if (this.el.redo) {
      this._addDomListener(this.el.redo, 'click', () => {
        if (this.controller.redo()) {
          this._refreshAfterEdit('Redo');
        }
      });
    }
  },

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
  },

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
  },

  _exportCurrentLevelClassic() {
    this._refreshValidation();
    if (this._hasErrors) {
      this.window?.alert?.('Fix validation errors before exporting.');
      return;
    }
    if (!this.session?.level) return;
    const loss = getClassicExportLossSummary(this.session.level);
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
    this._updateStatus(loss.hasLoss ? `Export LVL lossy: ${loss.summary}` : 'Export LVL');
  },

  _loadLevelFromText(text, options = {}) {
    if (!this.view) return;
    const token = Number.isFinite(options.token) ? options.token : this._nextAsyncToken();
    let level = null;
    try {
      level = this.view.loadEditorLevelFromText(text, { render: false });
    } catch (error) {
      this._reportImportFailure?.('NXLV', error);
      return;
    }
    if (!level) {
      this._reportImportFailure?.('NXLV', 'No level data was loaded.');
      return;
    }
    this._clearTransientIssue?.('import');
    this._clearSolvabilityCheck?.();
    if (options.resetSaved) {
      this._currentProject = null;
      this._refreshProjectList('');
    }
    this.session = this.view.editorSession;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.clearSelection();
    this._reloadAssets(token).then(async () => {
      if (!this._isAsyncCurrent(token)) return;
      this.controller.resetHistory('Import');
      this._setDirty(false);
      this._refreshUndoRedo();
      this._refreshHeaderFields(level);
      this._refreshSelection(null);
      this._refreshValidation();
      if (options.resetSaved) this._refreshSavedList('');
      await this._refreshPreview('Import', { preserveView: false, token });
    });
  },

  _loadLevelFromClassic(levelReader, options = {}) {
    if (!this.view) return;
    const token = Number.isFinite(options.token) ? options.token : this._nextAsyncToken();
    const session = this.view.ensureEditorSession?.() || this.session;
    let editorLevel = null;
    try {
      editorLevel = createEditorLevelFromClassic(levelReader);
    } catch (error) {
      this._reportImportFailure?.('LVL', error);
      return;
    }
    if (!editorLevel) {
      this._reportImportFailure?.('LVL', 'No classic level data was loaded.');
      return;
    }
    this._clearTransientIssue?.('import');
    this._clearSolvabilityCheck?.();
    if (options.resetSaved) {
      this._currentProject = null;
      this._refreshProjectList('');
    }
    session.level = editorLevel;
    this.session = session;
    this.controller.session = this.session;
    ensureLevelEntryUids(this.session?.level);
    this.controller.clearSelection();
    this._reloadAssets(token).then(async () => {
      if (!this._isAsyncCurrent(token)) return;
      this.controller.resetHistory('Import LVL');
      this._setDirty(false);
      this._refreshUndoRedo();
      this._refreshHeaderFields(editorLevel);
      this._refreshSelection(null);
      this._refreshValidation();
      if (options.resetSaved) this._refreshSavedList('');
      await this._refreshPreview('Import LVL', { preserveView: false, token });
    });
  },

  async _reloadAssets(token = this._asyncToken) {
    const config = this.view?.gameResources?.config
        || await this.view?.gameFactory?.getConfig?.(this.view?.gameType);
    if (!this._isAsyncCurrent(token)) return null;
    const styleName = this.session?.level?.getHeader?.('STYLE');
    const assets = await this.assetCache.loadStyleAssets(
      styleName,
      config,
      this.view?.gameFactory?.fileProvider
    );
    if (!this._isAsyncCurrent(token)) return null;
    this.assets = assets;
    if (this.previewCache?.invalidateTypeIds) {
      this.previewCache.invalidateTypeIds(
        'terrain',
        this.assets?.terrain?.map(entry => Number(entry?.id))
      );
      const gadgetIds = this.assets?.gadgets?.map(entry => Number(entry?.id));
      this.previewCache.invalidateTypeIds('gadget', gadgetIds);
      // Remove older trigger-scoped cache keys after hard-cutover to gadget previews.
      this.previewCache.invalidateTypeIds('trigger', gadgetIds);
    }
    this.controller.setAssets(this.assets);
    this._refreshPalettes();
    await this._refreshStyleOptions();
  },

  async _refreshPreview(label, options = {}) {
    if (!this.view) return;
    const token = Number.isFinite(options.token) ? options.token : this._asyncToken;
    if (!this._isAsyncCurrent(token)) return;
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
      if (!this._isAsyncCurrent(token)) return;
      this.view.setEditorPlaytest(this._playtest);
      this._ensureDefaultEntrancesExits();
      this._drawSelectionOverlay();
      this._refreshValidation();
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
};
export { editorLevelIoUiMethods };
