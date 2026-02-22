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
});
