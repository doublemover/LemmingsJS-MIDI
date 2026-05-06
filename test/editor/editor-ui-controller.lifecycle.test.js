import { expect } from 'chai';
import { EditorUiController } from '../../js/app/editorUiController.js';
import { EditorLevel } from '../../js/editor/EditorLevel.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { TestDocument, TestElement, createTestWindow } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';

if (!TestElement.prototype.removeEventListener) {
  TestElement.prototype.removeEventListener = function(type, handler) {
    const handlers = this.listeners.get(type) || [];
    this.listeners.set(type, handlers.filter(next => next !== handler));
  };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createControllerStub = () => ({
  tool: 'select',
  history: {
    pushSnapshot() {},
    canUndo() { return false; },
    canRedo() { return false; }
  },
  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  },
  setTool(tool) {
    this.tool = tool;
  },
  clearSelection() {},
  resetHistory() {},
  setAssets() {},
  getSelectedEntries() { return []; },
  getMarqueeBounds() { return null; },
  dispose() {
    this.disposed = true;
  }
});

const createSelectionPanelElements = (doc) => {
  const makeInput = () => doc.createElement('input');
  const makeCheck = () => doc.createElement('input');
  const makeText = () => doc.createElement('span');
  return {
    selType: makeText(),
    selName: makeText(),
    selX: makeInput(),
    selY: makeInput(),
    selWidth: makeInput(),
    selHeight: makeInput(),
    selRotate: makeInput(),
    selSkill: makeInput(),
    selLemmings: makeInput(),
    selPairing: makeInput(),
    selMidiFlag: makeCheck(),
    selMidiFlagId: makeInput(),
    selFlipH: makeCheck(),
    selFlipV: makeCheck(),
    selNoOverwrite: makeCheck(),
    selErase: makeCheck(),
    selOneWay: makeCheck(),
    deleteSelection: doc.createElement('button')
  };
};

describe('EditorUiController lifecycle', function() {
  it('binds UI events idempotently and removes tracked listeners on dispose', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const toolList = registerElement(doc, 'div', 'editorToolList');
    const paletteTabs = registerElement(doc, 'div', 'editorPaletteTabs');
    const search = registerElement(doc, 'input', 'editorPaletteSearch');
    const controller = createControllerStub();
    const ui = new EditorUiController({
      document: doc,
      window: win,
      view: null,
      controller
    });

    ui._bindEvents();
    ui._bindEvents();

    expect(toolList.listeners.get('click')).to.have.lengthOf(1);
    expect(paletteTabs.listeners.get('click')).to.have.lengthOf(1);
    expect(search.listeners.get('input')).to.have.lengthOf(1);

    ui.dispose();

    expect(toolList.listeners.get('click')).to.have.lengthOf(0);
    expect(paletteTabs.listeners.get('click')).to.have.lengthOf(0);
    expect(search.listeners.get('input')).to.have.lengthOf(0);
    expect(controller.disposed).to.equal(true);
  });

  it('detaches display handlers on dispose', function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const display = {
      onMouseDown: new EventHandler(),
      onMouseRightDown: new EventHandler(),
      onMouseUp: new EventHandler(),
      onMouseRightUp: new EventHandler(),
      onMouseMove: new EventHandler()
    };
    const controller = createControllerStub();
    const ui = new EditorUiController({
      document: doc,
      window: win,
      view: null,
      controller
    });
    ui.view = {
      stage: {
        getGameDisplay() {
          return display;
        }
      }
    };

    ui._bindCanvasInput();
    expect(display.onMouseDown.handlers.size).to.equal(1);
    expect(display.onMouseMove.handlers.size).to.equal(1);

    ui.dispose();

    expect(display.onMouseDown.handlers.size).to.equal(0);
    expect(display.onMouseMove.handlers.size).to.equal(0);
  });

  it('renders validation issues as list items', function() {
    const doc = new TestDocument();
    const issuesList = registerElement(doc, 'div', 'editorIssuesList');
    const ui = Object.create(EditorUiController.prototype);
    ui.document = doc;
    ui.el = { issuesList };

    ui._renderIssues([{
      severity: 'error',
      message: 'Missing entrance.',
      fixLabel: 'Add entrance',
      fix: () => {}
    }]);

    expect(ui._hasErrors).to.equal(true);
    expect(issuesList.children).to.have.lengthOf(1);
    const issueItem = issuesList.children.find(child => child.classList.contains('issue-item'));
    expect(issueItem).to.exist;
    expect(issueItem.getAttribute('role')).to.equal('listitem');
    expect(issueItem.getAttribute('data-severity')).to.equal('error');
    expect(issueItem.getAttribute('aria-label')).to.equal('Error: Missing entrance.');

    const severity = issueItem.children.find(child => child.classList.contains('issue-severity'));
    expect(severity?.textContent).to.equal('Error');

    const message = issueItem.children.find(child => child.classList.contains('issue-message'));
    expect(message?.textContent).to.equal('Missing entrance.');

    const action = issueItem.children.find(child => child.classList.contains('issue-action'));
    expect(action?.tagName).to.equal('BUTTON');
    expect(action?.textContent).to.equal('Add entrance');
    expect(action?.title).to.equal('Apply fix: Add entrance');
  });

  it('marks destructive validation quick fixes', function() {
    const doc = new TestDocument();
    const issuesList = registerElement(doc, 'div', 'editorIssuesList');
    const ui = Object.create(EditorUiController.prototype);
    ui.document = doc;
    ui.el = { issuesList };

    ui._renderIssues([{
      severity: 'warning',
      message: 'Terrain entries include unsupported classic properties.',
      fixLabel: 'Remove unsupported terrain props',
      fix: () => {}
    }]);

    const issueItem = issuesList.children.find(child => child.classList.contains('issue-item'));
    expect(issueItem.getAttribute('data-fix')).to.equal('destructive');
    const note = issueItem.children.find(child => child.classList.contains('issue-note'));
    expect(note?.textContent).to.contain('Destructive quick fix');
    const action = issueItem.children.find(child => child.classList.contains('issue-action'));
    expect(action.classList.contains('destructive')).to.equal(true);
    expect(action.title).to.equal('Destructive quick fix: Remove unsupported terrain props');
  });

  it('adds classic-subset warnings for preserved NXLV data and lossy LVL export', function() {
    const doc = new TestDocument();
    const issuesList = registerElement(doc, 'div', 'editorIssuesList');
    const level = new EditorLevel();
    level.setHeader('TITLE', 'Subset');
    level.unknownSections.push({ name: 'PRETEXT', lines: ['Line one'] });
    level.unknownLines.push('# trailing comment');
    level.terrains.push({
      props: { PIECE: 2, X: 0, Y: 0, ONE_WAY: true },
      order: ['PIECE', 'X', 'Y', 'ONE_WAY'],
      unknownLines: ['# terrain comment']
    });

    const ui = Object.create(EditorUiController.prototype);
    ui.document = doc;
    ui.el = { issuesList };
    ui.session = { level };
    ui.assets = null;
    ui._transientIssues = [];

    ui._refreshValidation();

    const messages = issuesList.children
      .flatMap(item => item.children)
      .filter(child => child.classList.contains('issue-message'))
      .map(child => child.textContent)
      .join('\n');
    expect(messages).to.contain('NXLV has preserved comments or unknown data');
    expect(messages).to.contain('Classic LVL export is lossy');
    expect(ui._validationSummary.warning).to.be.greaterThan(0);
  });

  it('reports import failures in validation and status UI', function() {
    const doc = new TestDocument();
    const issuesList = registerElement(doc, 'div', 'editorIssuesList');
    const status = registerElement(doc, 'span', 'editorStatus');
    const cursorStatus = registerElement(doc, 'span', 'editorCursorStatus');
    const ui = Object.create(EditorUiController.prototype);
    ui.document = doc;
    ui.el = { issuesList, status, cursorStatus };
    ui.controller = {
      tool: 'select',
      snapEnabled: true,
      gridSize: 4
    };
    ui._playtest = false;
    ui._cursorPos = null;
    ui._transientIssues = [];

    ui._reportImportFailure('NXLV', new Error('bad section'));

    expect(issuesList.children).to.have.lengthOf(1);
    const message = issuesList.children[0].children.find(child => child.classList.contains('issue-message'));
    expect(message.textContent).to.equal('NXLV import failed: bad section');
    expect(status.textContent).to.contain('NXLV import failed');
    expect(status.textContent).to.contain('1 error');
  });

  it('enables conservative batch inspector fields for homogeneous multi-selection', function() {
    const doc = new TestDocument();
    const ui = Object.create(EditorUiController.prototype);
    ui.el = createSelectionPanelElements(doc);
    ui._toggleSelectionActions = visible => {
      ui.selectionActionsVisible = visible;
    };

    ui._setSelectionFields({
      multi: true,
      count: 2,
      entries: [{ type: 'terrain' }, { type: 'terrain' }]
    });

    expect(ui.el.selName.textContent).to.equal('2 terrain items');
    expect(ui.el.selX.disabled).to.equal(false);
    expect(ui.el.selX.placeholder).to.equal('batch');
    expect(ui.el.selWidth.disabled).to.equal(true);
    expect(ui.el.selOneWay.disabled).to.equal(false);
    expect(ui.el.selOneWay.indeterminate).to.equal(true);
    expect(ui.el.selSkill.disabled).to.equal(true);

    ui._setSelectionFields({
      multi: true,
      count: 2,
      entries: [{ type: 'terrain' }, { type: 'gadget' }]
    });

    expect(ui.el.selName.textContent).to.equal('2 mixed items');
    expect(ui.el.selX.disabled).to.equal(true);
    expect(ui.el.selOneWay.disabled).to.equal(true);
  });

  it('ignores stale async level imports after a newer import starts', async function() {
    const doc = new TestDocument();
    const win = createTestWindow();
    const controller = createControllerStub();
    const pendingAssets = new Map();
    const assetCache = {
      loadStyleAssets(styleName) {
        return new Promise(resolve => pendingAssets.set(styleName, resolve));
      }
    };
    const makeLevel = (styleName) => ({
      terrains: [],
      gadgets: [],
      steel: [],
      getHeader(key) {
        return key === 'STYLE' ? styleName : null;
      }
    });
    const view = {
      editorSession: { level: makeLevel('initial') },
      gameResources: { config: {} },
      loadEditorLevelFromText(text) {
        const level = makeLevel(text);
        this.editorSession = { level };
        return level;
      },
      loadEditorPreviewLevel() {
        return Promise.resolve();
      },
      setEditorPlaytest() {}
    };
    const ui = new EditorUiController({
      document: doc,
      window: win,
      view,
      controller,
      assetCache,
      previewCache: {
        invalidateTypeIds() {},
        dispose() {}
      }
    });
    ui._refreshPalettes = () => {};
    ui._refreshStyleOptions = async () => {};
    ui._refreshUndoRedo = () => {};
    ui._refreshHeaderFields = () => {};
    ui._refreshSelection = () => {};
    ui._refreshValidation = () => {};
    ui._refreshSavedList = () => {};
    ui._drawSelectionOverlay = () => {};
    ui._updateStatus = () => {};
    ui._setDirty = () => {};

    ui._loadLevelFromText('first');
    ui._loadLevelFromText('second');

    pendingAssets.get('first')({ marker: 'first' });
    await flush();
    expect(ui.assets).to.equal(null);

    pendingAssets.get('second')({ marker: 'second' });
    await flush();
    expect(ui.assets).to.deep.equal({ marker: 'second' });
  });
});
