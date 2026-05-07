import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { EditorUiController } from '../../js/app/editorUiController.js';
import { TestDocument } from '../helpers/test-dom.js';

const createClassList = () => {
  const set = new Set();
  return {
    add(name) {
      set.add(name);
    },
    remove(name) {
      set.delete(name);
    },
    toggle(name, force) {
      if (force) set.add(name);
      else set.delete(name);
    },
    contains(name) {
      return set.has(name);
    }
  };
};

const createRecord = (searchKey, hidden = false, previewLoaded = false) => ({
  searchKey,
  entry: { id: 1 },
  type: 'terrain',
  button: {
    hidden,
    classList: createClassList()
  },
  previewWrap: { classList: createClassList() },
  previewImg: { src: '' },
  previewLoaded
});

const createButtonStub = (dataset = {}) => {
  const attrs = new Map();
  const listeners = new Map();
  return {
    dataset,
    classList: createClassList(),
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.get(name) || null;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.({ type, target: this, ...event });
    }
  };
};

describe('EditorUiController palette throughput helpers', () => {
  it('updates palette tab pressed state with the active tab', () => {
    const ui = Object.create(EditorUiController.prototype);
    const terrain = createButtonStub({ tab: 'terrain' });
    const gadgets = createButtonStub({ tab: 'gadgets' });
    const triggers = createButtonStub({ tab: 'triggers' });
    ui.el = {
      paletteTabs: { querySelectorAll: () => [terrain, gadgets, triggers] },
      paletteTerrain: {},
      paletteGadgets: {},
      paletteTriggers: {}
    };
    ui._schedulePalettePreviewHydration = () => {};

    ui._setPaletteTab('gadgets');

    expect(terrain.classList.contains('active')).to.equal(false);
    expect(terrain.getAttribute('aria-pressed')).to.equal('false');
    expect(gadgets.classList.contains('active')).to.equal(true);
    expect(gadgets.getAttribute('aria-pressed')).to.equal('true');
    expect(triggers.getAttribute('aria-pressed')).to.equal('false');
    expect(ui.el.paletteTerrain.hidden).to.equal(true);
    expect(ui.el.paletteGadgets.hidden).to.equal(false);
  });

  it('updates palette view pressed state when switching modes', () => {
    const ui = Object.create(EditorUiController.prototype);
    const list = createButtonStub();
    const grid = createButtonStub();
    ui.el = {
      paletteViewList: list,
      paletteViewGrid: grid,
      paletteTerrain: null,
      paletteGadgets: null,
      paletteTriggers: null
    };
    ui._paletteViewMode = 'list';
    ui._addDomListener = (element, type, handler) => element.addEventListener(type, handler);
    ui._applyPaletteViewMode = () => {};
    ui._bindPaletteGridZoom = () => {};

    ui._bindPaletteView();
    expect(list.classList.contains('active')).to.equal(true);
    expect(list.getAttribute('aria-pressed')).to.equal('true');
    expect(grid.getAttribute('aria-pressed')).to.equal('false');

    grid.dispatch('click');
    expect(list.classList.contains('active')).to.equal(false);
    expect(list.getAttribute('aria-pressed')).to.equal('false');
    expect(grid.classList.contains('active')).to.equal(true);
    expect(grid.getAttribute('aria-pressed')).to.equal('true');
  });

  it('uses gadget preview keys for trigger entries', () => {
    const ui = Object.create(EditorUiController.prototype);
    const calls = [];
    ui.previewCache = {
      getPreviewUrl(payload) {
        calls.push(payload);
        return 'data:image/png;base64,ok';
      }
    };
    ui.assets = {
      terrainImages: [],
      gadgetImages: [{ id: 3, width: 8, height: 8 }]
    };

    const url = ui._getPreviewUrl({ id: 0 }, 'trigger');
    expect(url).to.equal('data:image/png;base64,ok');
    expect(calls).to.have.length(1);
    expect(calls[0].type).to.equal('gadget');
  });

  it('filters palette entries using cached normalized search keys', () => {
    const ui = Object.create(EditorUiController.prototype);
    let scheduleCount = 0;
    ui._schedulePalettePreviewHydration = () => {
      scheduleCount += 1;
    };
    ui.el = {
      paletteSearch: { value: 'trap' }
    };
    ui._paletteEntries = {
      terrain: [createRecord('stone'), createRecord('trap door')],
      gadget: [createRecord('trap zone')],
      trigger: [createRecord('exit')]
    };

    ui._applyPaletteFilter();
    expect(ui._paletteEntries.terrain[0].button.hidden).to.equal(true);
    expect(ui._paletteEntries.terrain[1].button.hidden).to.equal(false);
    expect(ui._paletteEntries.gadget[0].button.hidden).to.equal(false);
    expect(ui._paletteEntries.trigger[0].button.hidden).to.equal(true);
    expect(scheduleCount).to.equal(1);
  });

  it('records recent palette entries with de-dupe and cap', () => {
    const ui = Object.create(EditorUiController.prototype);
    let renderCount = 0;
    ui._recentPaletteEntries = [];
    ui._renderRecentPaletteEntries = () => {
      renderCount += 1;
    };

    for (let i = 0; i < 10; i += 1) {
      ui._recordRecentPaletteEntry({ id: i, name: `Terrain ${i}`, width: 8, height: 8 }, 'terrain');
    }
    ui._recordRecentPaletteEntry({ id: 4, name: 'Terrain 4', width: 8, height: 8 }, 'terrain');

    expect(ui._recentPaletteEntries).to.have.lengthOf(8);
    expect(ui._recentPaletteEntries[0].id).to.equal(4);
    expect(ui._recentPaletteEntries.filter(entry => entry.id === 4)).to.have.lengthOf(1);
    expect(ui._recentPaletteEntries.map(entry => entry.id)).to.deep.equal([4, 9, 8, 7, 6, 5, 3, 2]);
    expect(renderCount).to.equal(11);
  });

  it('renders recent palette buttons and reuses selection behavior', () => {
    const doc = new TestDocument();
    const recent = doc.createElement('div');
    const ui = Object.create(EditorUiController.prototype);
    const selected = { terrain: null, gadget: null, trigger: null };
    ui.document = doc;
    ui.el = { paletteRecent: recent };
    ui.controller = {
      selectedTerrainId: null,
      selectedGadgetId: null,
      selectedTriggerId: null,
      setSelectedTerrain(id) {
        selected.terrain = id;
        this.selectedTerrainId = id;
      },
      setSelectedGadget(id) {
        selected.gadget = id;
        this.selectedGadgetId = id;
      },
      setSelectedTrigger(id) {
        selected.trigger = id;
        this.selectedTriggerId = id;
      }
    };
    ui._paletteEntries = {
      terrain: [{
        id: 3,
        entry: { id: 3, name: 'Rock', width: 8, height: 8 },
        button: { classList: createClassList() }
      }],
      gadget: [],
      trigger: []
    };
    ui._recentPaletteEntries = [{
      id: 3,
      type: 'terrain',
      label: '#3 Rock (8x8)',
      entry: { id: 3, name: 'Rock', width: 8, height: 8 }
    }];

    ui._renderRecentPaletteEntries();
    expect(recent.hidden).to.equal(false);
    expect(recent.children).to.have.lengthOf(1);
    expect(recent.children[0].dataset.type).to.equal('terrain');
    expect(recent.children[0].dataset.id).to.equal('3');
    expect(recent.children[0].getAttribute('aria-label')).to.equal('Select recent #3 Rock (8x8)');

    recent.children[0].dispatchEvent({ type: 'click' });
    expect(selected.terrain).to.equal(3);
  });

  it('hydrates previews in visible active-tab batches', () => {
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const ui = Object.create(EditorUiController.prototype);
    const first = createRecord('a', false, false);
    const hidden = createRecord('b', true, false);
    const loaded = createRecord('c', false, true);
    ui._activeTab = 'terrain';
    ui._palettePreviewQueue = [];
    ui._palettePreviewToken = 0;
    ui._palettePreviewTimer = null;
    ui._paletteEntries = {
      terrain: [first, hidden, loaded],
      gadget: [],
      trigger: []
    };
    let previewCalls = 0;
    ui._getPreviewUrl = () => {
      previewCalls += 1;
      return 'data:image/png;base64,terrain';
    };

    ui._schedulePalettePreviewHydration();
    clock.tick(0);
    clock.uninstall();

    expect(previewCalls).to.equal(1);
    expect(first.previewLoaded).to.equal(true);
    expect(first.previewImg.src).to.equal('data:image/png;base64,terrain');
    expect(hidden.previewLoaded).to.equal(false);
    expect(loaded.previewLoaded).to.equal(true);
  });

  it('keeps large palette preview hydration batched across timer turns', () => {
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const ui = Object.create(EditorUiController.prototype);
      const records = Array.from({ length: 60 }, (_, i) => createRecord(`terrain-${i}`, false, false));
      ui._activeTab = 'terrain';
      ui._palettePreviewQueue = [];
      ui._palettePreviewIndex = 0;
      ui._palettePreviewToken = 0;
      ui._palettePreviewTimer = null;
      ui._paletteEntries = {
        terrain: records,
        gadget: [],
        trigger: []
      };
      let previewCalls = 0;
      ui._getPreviewUrl = () => {
        previewCalls += 1;
        return 'data:image/png;base64,terrain';
      };

      ui._schedulePalettePreviewHydration();
      expect(previewCalls).to.equal(0);
      clock.tick(0);
      expect(previewCalls).to.equal(24);
      expect(ui._palettePreviewTimer).to.not.equal(null);
      clock.tick(1);
      expect(previewCalls).to.equal(48);
      clock.tick(1);

      expect(previewCalls).to.equal(60);
      expect(records.every(record => record.previewLoaded)).to.equal(true);
      expect(ui._palettePreviewQueue).to.deep.equal([]);
      expect(ui._palettePreviewTimer).to.equal(null);
    } finally {
      clock.uninstall();
    }
  });

  it('cancels stale preview hydration batches when the token changes', () => {
    const clock = FakeTimers.install({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const ui = Object.create(EditorUiController.prototype);
      const first = createRecord('a', false, false);
      ui._activeTab = 'terrain';
      ui._palettePreviewQueue = [];
      ui._palettePreviewIndex = 0;
      ui._palettePreviewToken = 0;
      ui._palettePreviewTimer = null;
      ui._paletteEntries = {
        terrain: [first],
        gadget: [],
        trigger: []
      };
      let previewCalls = 0;
      ui._getPreviewUrl = () => {
        previewCalls += 1;
        return 'data:image/png;base64,terrain';
      };

      ui._schedulePalettePreviewHydration();
      ui._palettePreviewToken += 1;
      clock.tick(0);

      expect(previewCalls).to.equal(0);
      expect(first.previewLoaded).to.equal(false);
    } finally {
      clock.uninstall();
    }
  });

  it('skips hydration timers when no pending previews exist', () => {
    const ui = Object.create(EditorUiController.prototype);
    ui._activeTab = 'terrain';
    ui._palettePreviewQueue = [];
    ui._palettePreviewIndex = 0;
    ui._palettePreviewToken = 0;
    ui._palettePreviewTimer = null;
    ui._paletteEntries = {
      terrain: [createRecord('a', true, false), createRecord('b', false, true)],
      gadget: [],
      trigger: []
    };

    ui._schedulePalettePreviewHydration();

    expect(ui._palettePreviewTimer).to.equal(null);
    expect(ui._palettePreviewQueue).to.deep.equal([]);
    expect(ui._palettePreviewIndex).to.equal(0);
  });

  it('ignores ctrl-wheel zoom updates when wheel delta is zero', () => {
    const ui = Object.create(EditorUiController.prototype);
    const terrainContainer = {
      handler: null,
      addEventListener(type, handler) {
        if (type === 'wheel') {
          this.handler = handler;
        }
      }
    };
    ui.el = {
      paletteTerrain: terrainContainer,
      paletteGadgets: null,
      paletteTriggers: null
    };
    ui._paletteViewMode = 'grid';
    ui._paletteGridColumns = 4;
    const updates = [];
    ui._setPaletteGridColumns = (value) => {
      updates.push(value);
    };

    ui._bindPaletteGridZoom();
    expect(typeof terrainContainer.handler).to.equal('function');

    let prevented = false;
    terrainContainer.handler({
      ctrlKey: true,
      deltaY: 0,
      preventDefault() {
        prevented = true;
      }
    });

    expect(prevented).to.equal(false);
    expect(updates).to.deep.equal([]);

    terrainContainer.handler({
      ctrlKey: true,
      deltaY: -1,
      preventDefault() {}
    });
    expect(updates).to.deep.equal([3]);
  });

  it('refreshes style options using canonical names for case-insensitive current styles', async () => {
    const ui = Object.create(EditorUiController.prototype);
    const appended = [];
    ui.el = {
      headerStyle: {
        innerHTML: '',
        value: '',
        appendChild(option) {
          appended.push(option);
        }
      }
    };
    ui.document = {
      createElement() {
        return { value: '', textContent: '' };
      }
    };
    ui.session = {
      level: {
        getHeader() {
          return 'canyon';
        }
      }
    };
    ui._resolveAvailableStyles = async () => ['Canyon', 'Fire'];

    await ui._refreshStyleOptions();

    expect(appended.map(option => option.value)).to.deep.equal(['Canyon', 'Fire']);
    expect(ui.el.headerStyle.value).to.equal('Canyon');
  });
});
