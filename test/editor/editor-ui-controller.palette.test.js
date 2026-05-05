import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { EditorUiController } from '../../js/app/editorUiController.js';

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

describe('EditorUiController palette throughput helpers', () => {
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
