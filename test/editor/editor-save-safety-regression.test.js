import { expect } from 'chai';
import { EditorUiController } from '../../js/app/editorUiController.js';
import { NxlvParser } from '../../js/editor/NxlvParser.js';
import { STORAGE_KEYS, saveLevel, loadSavedLevel, listSavedLevels } from '../../js/editor/EditorStorage.js';
import {
  PROJECT_STORAGE_KEYS, createEditorProject, createEditorProjectPackArchive,
  saveEditorProject, loadEditorProject, installEditorProjectPackArchive
} from '../../js/editor/EditorProjectStorage.js';
import { setRuntimeContext, clearRuntimeContext } from '../../js/core/dependencies.js';
import { TestDocument, createTestWindow } from '../helpers/test-dom.js';

const createStorage = () => createTestWindow().localStorage;
const levelText = title => `TITLE ${title}\nSTYLE dirt\nWIDTH 320\nHEIGHT 160\n`;
const project = () => createEditorProject({ id: 'pack', name: 'Pack', levelId: 'one', text: levelText('One') });

const createUi = (storage, decisions = []) => {
  const doc = new TestDocument();
  doc.body = doc.createElement('body');
  const win = createTestWindow();
  win.localStorage = storage;
  const prompts = [];
  const alerts = [];
  win.prompt = message => { prompts.push(message); return decisions.shift() ?? null; };
  win.alert = message => alerts.push(message);
  const controller = {
    resetCount: 0,
    resetHistory() { this.resetCount += 1; },
    setCallbacks() {}, clearSelection() {},
    history: { canUndo: () => false, canRedo: () => false }
  };
  const ui = new EditorUiController({ document: doc, window: win, view: null, controller });
  let text = levelText('Edited');
  const session = { level: NxlvParser.parse(text) };
  ui.session = session;
  ui.view = {
    editorSession: session,
    gameType: 1, levelGroupIndex: 2, levelIndex: 3,
    getEditorLevelText: () => text,
    getEditorLevelTitle: () => session.level.getHeader('TITLE'),
    createBlankEditorLevel() { text = levelText('Untitled'); session.level = NxlvParser.parse(text); },
    loadEditorLevelFromText(value) { text = value; session.level = NxlvParser.parse(value); return session.level; }
  };
  for (const name of ['_refreshSavedList', '_refreshProjectList', '_refreshProjectLevelList', '_refreshHeaderFields', '_refreshSelection', '_refreshValidation', '_updateStatus']) ui[name] = () => {};
  ui._reloadAssets = () => Promise.resolve();
  ui._refreshStyleOptions = () => Promise.resolve();
  ui._refreshPreview = () => Promise.resolve();
  ui._clearSolvabilityCheck = () => {};
  ui.el.dirtyStatus = doc.createElement('span');
  ui._setDirty(true);
  return { ui, win, doc, controller, prompts, alerts };
};

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('Editor save safety regressions', function() {
  afterEach(() => clearRuntimeContext());

  for (const save of [
    { name: 'level', keys: STORAGE_KEYS, prefix: 'levelPrefix', call: storage => saveLevel(storage, { id: 'one', name: 'One', text: levelText('New') }) },
    { name: 'project', keys: PROJECT_STORAGE_KEYS, prefix: 'projectPrefix', call: storage => saveEditorProject(storage, project()) }
  ]) {
    it(`reports ${save.name} writes as failed when storage cannot write`, function() {
      expect(save.call({ getItem: () => null, setItem: () => { throw new Error('Quota'); } })).to.equal(null);
      expect(save.call({ getItem: () => null })).to.equal(null);
    });

    it(`restores last-good ${save.name} content when its index write fails`, function() {
      const storage = createStorage();
      const id = save.name === 'level' ? 'one' : 'pack';
      const contentKey = save.keys[save.prefix] + id;
      storage.setItem(contentKey, 'last-good');
      storage.setItem(save.keys.index, '{"version":1,"entries":[]}');
      const original = storage.setItem;
      storage.setItem = (key, value) => {
        if (key === save.keys.index) throw new Error('Quota');
        original(key, value);
      };
      expect(save.call(storage)).to.equal(null);
      expect(storage.getItem(contentKey)).to.equal('last-good');
      expect(storage.getItem(save.keys.index)).to.equal('{"version":1,"entries":[]}');
    });

    it(`does not write ${save.name} content when existing storage cannot be read`, function() {
      let writes = 0;
      expect(save.call({ getItem() { throw new Error('Denied'); }, setItem() { writes += 1; } })).to.equal(null);
      expect(writes).to.equal(0);
    });
  }

  it('does not report a pack archive installed when persistence fails', function() {
    const archive = createEditorProjectPackArchive(project());
    const result = installEditorProjectPackArchive({ getItem: () => null, setItem: () => { throw new Error('Quota'); } }, archive);
    expect(result.ok).to.equal(false);
    expect(result.projectId).to.equal(null);
    expect(result.report.issues.map(issue => issue.code)).to.include('pack_archive_storage_failed');
  });

  for (const decision of [null, 'cancel', 'unrecognized']) {
    it(`keeps dirty New Level edits and history when the decision is ${decision}`, async function() {
      const { ui, controller } = createUi(createStorage(), [decision]);
      expect(await ui._createNewLevel()).to.equal(false);
      expect(ui.view.getEditorLevelTitle()).to.equal('Edited');
      expect(ui._dirty).to.equal(true);
      expect(controller.resetCount).to.equal(0);
    });
  }

  it('creates a fresh unsaved document after explicit discard', async function() {
    const { ui, controller } = createUi(createStorage(), ['discard']);
    await ui._createNewLevel();
    expect(ui.view.getEditorLevelTitle()).to.equal('Untitled');
    expect(ui.el.dirtyStatus.textContent).to.equal('Not saved');
    expect(controller.resetCount).to.equal(1);
  });

  it('saves the old edits before replacing them with New Level', async function() {
    const storage = createStorage();
    setRuntimeContext({ localStorage: storage });
    const { ui } = createUi(storage, ['save', 'Edited']);
    await ui._createNewLevel();
    const saved = listSavedLevels(storage);
    expect(saved).to.have.lengthOf(1);
    expect(loadSavedLevel(storage, saved[0].id)).to.equal(levelText('Edited'));
    expect(ui.view.getEditorLevelTitle()).to.equal('Untitled');
  });

  it('blocks replacement and leaves dirty edits open when Save fails', async function() {
    const storage = { getItem: () => null, setItem: () => { throw new Error('Quota'); } };
    setRuntimeContext({ localStorage: storage });
    const { ui, alerts, controller } = createUi(storage, ['save', 'Edited']);
    expect(await ui._createNewLevel()).to.equal(false);
    expect(ui.view.getEditorLevelTitle()).to.equal('Edited');
    expect(ui._dirty).to.equal(true);
    expect(ui._currentSavedId).to.equal('');
    expect(alerts).to.have.lengthOf(1);
    expect(controller.resetCount).to.equal(0);
  });

  it('keeps the current project and dirty level after a failed project save', function() {
    const storage = { getItem: () => null, setItem: () => { throw new Error('Quota'); } };
    setRuntimeContext({ localStorage: storage });
    const { ui } = createUi(storage);
    const original = project();
    ui._currentProject = original;
    expect(ui._saveCurrentLevelToProject()).to.equal(false);
    expect(ui._currentProject).to.equal(original);
    expect(ui._dirty).to.equal(true);
    expect(ui.view.getEditorLevelTitle()).to.equal('Edited');
  });

  it('protects imported levels and project switching with the same guard', function() {
    const storage = createStorage();
    setRuntimeContext({ localStorage: storage });
    saveEditorProject(storage, project());
    const { ui } = createUi(storage, ['cancel', 'cancel', 'cancel']);
    ui._currentProject = project();
    expect(ui._loadLevelFromText(levelText('Other'))).to.equal(false);
    expect(ui._loadProjectById('pack')).to.equal(false);
    expect(ui._loadProjectLevel('one')).to.equal(false);
    expect(ui.view.getEditorLevelTitle()).to.equal('Edited');
    expect(ui._dirty).to.equal(true);
  });

  it('restores saved-level and built-in selectors after cancelling navigation', async function() {
    const storage = createStorage();
    setRuntimeContext({ localStorage: storage });
    saveLevel(storage, { id: 'other', name: 'Other', text: levelText('Other') });
    const { ui, doc } = createUi(storage, ['cancel', 'cancel', 'cancel', 'cancel']);
    ui._currentSavedId = 'current';
    ui.el.savedSelect = doc.createElement('select');
    for (const name of ['gameType', 'levelGroup', 'levelIndex']) ui.el[name] = doc.createElement('select');
    let loads = 0;
    for (const name of ['selectGameType', 'selectLevelGroup', 'selectLevel']) ui.view[name] = () => { loads += 1; };
    ui._bindSavedControls();
    ui._bindLevelSelectors();
    ui.el.savedSelect.value = 'other';
    ui.el.savedSelect.dispatchEvent({ type: 'change', target: ui.el.savedSelect });
    expect(ui.el.savedSelect.value).to.equal('current');
    for (const [name, expected] of [['gameType', '1'], ['levelGroup', '2'], ['levelIndex', '3']]) {
      ui.el[name].value = '999';
      ui.el[name].dispatchEvent({ type: 'change', target: ui.el[name] });
      expect(ui.el[name].value).to.equal(expected);
    }
    await flush();
    expect(loads).to.equal(0);
    expect(ui.view.getEditorLevelTitle()).to.equal('Edited');
  });

  it('does not erase edits or history made while imported assets are still loading', async function() {
    const { ui, controller } = createUi(createStorage(), ['discard']);
    let resolve;
    ui._reloadAssets = () => new Promise(done => { resolve = done; });
    expect(ui._loadLevelFromText(levelText('Other'), { resetSaved: true })).to.equal(true);
    expect(controller.resetCount).to.equal(1);
    ui._setDirty(true);
    resolve();
    await flush();
    expect(ui._dirty).to.equal(true);
    expect(controller.resetCount).to.equal(1);
  });

  it('keeps a current in-memory pack export snapshot when storage is unavailable', function() {
    const { ui } = createUi(null);
    ui._currentProject = project();
    const snapshot = ui._getCurrentProjectForExport();
    expect(snapshot.levels[0].text).to.equal(levelText('Edited'));
    expect(ui._currentProject.levels[0].text).to.equal(levelText('One'));
    expect(ui._dirty).to.equal(true);
  });

  it('reloads freshly saved project data when switching to the same project', async function() {
    const storage = createStorage();
    setRuntimeContext({ localStorage: storage });
    saveEditorProject(storage, project());
    const { ui } = createUi(storage, ['save']);
    ui._currentProject = project();
    expect(ui._loadProjectById('pack')).to.equal(true);
    await flush();
    expect(ui.view.getEditorLevelTitle()).to.equal('Edited');
    expect(ui._currentProject.levels[0].text).to.equal(levelText('Edited'));
  });

  it('offers a raw recovery export without marking failed edits saved', async function() {
    const { ui, win, doc } = createUi(null);
    win.confirm = () => true;
    let blob;
    let filename;
    const originalUrl = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalCreate = doc.createElement.bind(doc);
    URL.createObjectURL = value => { blob = value; return 'blob:recovery'; };
    URL.revokeObjectURL = () => {};
    doc.createElement = tag => {
      const element = originalCreate(tag);
      if (tag === 'a') element.click = () => { filename = element.download; };
      return element;
    };
    try {
      ui._reportStorageFailure();
      expect(filename).to.equal('Edited.recovery.nxlv');
      expect(await blob.text()).to.equal(levelText('Edited'));
      expect(ui._dirty).to.equal(true);
    } finally {
      URL.createObjectURL = originalUrl;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('marks Saved only after a successful project write', function() {
    const storage = createStorage();
    setRuntimeContext({ localStorage: storage });
    const { ui } = createUi(storage);
    ui._currentProject = project();
    expect(ui._saveCurrentLevelToProject()).to.equal(true);
    expect(loadEditorProject(storage, 'pack').levels[0].text).to.equal(levelText('Edited'));
    expect(ui._dirty).to.equal(false);
    expect(ui.el.dirtyStatus.textContent).to.equal('Saved');
  });
});
