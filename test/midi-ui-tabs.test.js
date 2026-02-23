import { expect } from 'chai';
import { createMidiUiTabsController } from '../js/app/midi-ui/midiUiTabs.js';

const createClassList = (initial = []) => {
  const values = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    contains(name) {
      return values.has(name);
    }
  };
};

const createNode = ({
  id = '',
  tabGroup = null,
  tabTarget = null,
  sectionKey = null,
  open = false,
  active = false
} = {}) => {
  const listeners = new Map();
  const node = {
    id,
    dataset: {},
    open,
    classList: createClassList(active ? ['active'] : []),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatch(type) {
      const handlers = listeners.get(type) || [];
      handlers.forEach((handler) => handler({ type, target: node }));
    },
    hasAttribute(name) {
      if (name === 'open') return !!node.open;
      return false;
    }
  };
  if (tabGroup != null) node.dataset.tabGroup = tabGroup;
  if (tabTarget != null) node.dataset.tabTarget = tabTarget;
  if (sectionKey != null) node.dataset.sectionKey = sectionKey;
  return node;
};

const createDocument = ({ buttons = [], panels = [], sections = [] } = {}) => ({
  querySelectorAll(selector) {
    if (selector === '.tab-button[data-tab-group]') return buttons;
    if (selector === '.tab-panel[data-tab-group]') return panels;
    if (selector === 'details[data-section-key]') return sections;
    const buttonGroup = selector.match(/^\.tab-button\[data-tab-group="([^"]+)"\]$/);
    if (buttonGroup) {
      return buttons.filter((button) => button.dataset.tabGroup === buttonGroup[1]);
    }
    const panelGroup = selector.match(/^\.tab-panel\[data-tab-group="([^"]+)"\]$/);
    if (panelGroup) {
      return panels.filter((panel) => panel.dataset.tabGroup === panelGroup[1]);
    }
    return [];
  }
});

describe('midiUiTabs controller', function () {
  it('activates and persists selected tabs', function () {
    const stored = [];
    const buttonA = createNode({ tabGroup: 'midi-left', tabTarget: 'leftA', active: true });
    const buttonB = createNode({ tabGroup: 'midi-left', tabTarget: 'leftB' });
    const panelA = createNode({ id: 'leftA', tabGroup: 'midi-left', active: true });
    const panelB = createNode({ id: 'leftB', tabGroup: 'midi-left' });
    const controller = createMidiUiTabsController({
      document: createDocument({ buttons: [buttonA, buttonB], panels: [panelA, panelB] }),
      storage: {},
      storeMidiId(_storage, key, value) {
        stored.push({ key, value });
      },
      midiStorageKeys: { tabLeft: 'tab.left', tabRight: 'tab.right', sectionStates: 'sections' }
    });

    controller.setActiveTab('midi-left', 'leftB', { persist: true });

    expect(buttonA.classList.contains('active')).to.equal(false);
    expect(buttonB.classList.contains('active')).to.equal(true);
    expect(panelA.classList.contains('active')).to.equal(false);
    expect(panelB.classList.contains('active')).to.equal(true);
    expect(stored).to.deep.equal([{ key: 'tab.left', value: 'leftB' }]);
  });

  it('bindTabs restores stored tab state and persists click changes', function () {
    const stored = [];
    const buttonA = createNode({ tabGroup: 'midi-left', tabTarget: 'leftA' });
    const buttonB = createNode({ tabGroup: 'midi-left', tabTarget: 'leftB' });
    const panelA = createNode({ id: 'leftA', tabGroup: 'midi-left' });
    const panelB = createNode({ id: 'leftB', tabGroup: 'midi-left' });
    const controller = createMidiUiTabsController({
      document: createDocument({ buttons: [buttonA, buttonB], panels: [panelA, panelB] }),
      storage: {},
      readStoredMidiId(_storage, key) {
        return key === 'tab.left' ? 'leftB' : null;
      },
      storeMidiId(_storage, key, value) {
        stored.push({ key, value });
      },
      midiStorageKeys: { tabLeft: 'tab.left', tabRight: 'tab.right', sectionStates: 'sections' }
    });

    controller.bindTabs();
    expect(panelB.classList.contains('active')).to.equal(true);
    buttonA.dispatch('click');
    expect(panelA.classList.contains('active')).to.equal(true);
    expect(stored).to.deep.equal([{ key: 'tab.left', value: 'leftA' }]);
  });

  it('binds section state persistence and restores defaults', function () {
    const writes = [];
    const section = createNode({ sectionKey: 'advanced', open: true });
    const controller = createMidiUiTabsController({
      document: createDocument({ sections: [section] }),
      storage: {},
      readStoredSectionStates() {
        return { advanced: false };
      },
      storeJson(_storage, key, value) {
        writes.push({ key, value });
      },
      midiStorageKeys: { tabLeft: 'tab.left', tabRight: 'tab.right', sectionStates: 'sections' }
    });

    controller.bindSectionPersistence();
    expect(section.open).to.equal(false);

    section.open = true;
    section.dispatch('toggle');
    expect(writes).to.deep.equal([{ key: 'sections', value: { advanced: true } }]);

    controller.applySectionStates({ useStored: false });
    expect(section.open).to.equal(true);
  });

  it('normalizes invalid injected section-state maps', function () {
    const writes = [];
    const section = createNode({ sectionKey: 'advanced', open: false });
    const controller = createMidiUiTabsController({
      document: createDocument({ sections: [section] }),
      storage: {},
      readStoredSectionStates() {
        return null;
      },
      storeJson(_storage, key, value) {
        writes.push({ key, value });
      },
      midiStorageKeys: { tabLeft: 'tab.left', tabRight: 'tab.right', sectionStates: 'sections' }
    });

    expect(() => controller.bindSectionPersistence()).to.not.throw();
    section.open = true;
    expect(() => section.dispatch('toggle')).to.not.throw();
    expect(writes).to.deep.equal([{ key: 'sections', value: { advanced: true } }]);
  });
});
