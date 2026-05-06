import { expect } from 'chai';
import { EditorUiController } from '../../js/app/editorUiController.js';
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

    ui._renderIssues([{ severity: 'error', message: 'Missing entrance.' }]);

    expect(ui._hasErrors).to.equal(true);
    expect(issuesList.children).to.have.lengthOf(1);
    expect(issuesList.children[0].getAttribute('role')).to.equal('listitem');
    expect(issuesList.children[0].children[0].textContent).to.equal('Missing entrance.');
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
