import { getRuntimeDependency } from '../../core/dependencies.js';

const createMidiUiTabsController = ({
  document = getRuntimeDependency('document', null),
  storage = null,
  readStoredMidiId,
  readStoredSectionStates,
  storeMidiId,
  readStoredJson,
  storeJson,
  midiStorageKeys
} = {}) => {
  const tabStorageKeys = {
    'midi-left': midiStorageKeys?.tabLeft,
    'midi-right': midiStorageKeys?.tabRight
  };

  const readSectionStates = () => {
    if (typeof readStoredSectionStates === 'function') {
      return readStoredSectionStates(storage);
    }
    const stored = readStoredJson?.(storage, midiStorageKeys?.sectionStates);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return stored;
  };

  const storeSectionStates = (state) => {
    storeJson?.(storage, midiStorageKeys?.sectionStates, state);
  };

  const applySectionStates = ({ useStored = true } = {}) => {
    const states = useStored ? readSectionStates() : {};
    const sections = Array.from(document?.querySelectorAll?.('details[data-section-key]') || []);
    sections.forEach((section) => {
      const key = section.dataset.sectionKey;
      if (!key) return;
      if (!section.dataset.defaultOpen) {
        section.dataset.defaultOpen = section.hasAttribute('open') ? 'true' : 'false';
      }
      if (useStored && typeof states[key] === 'boolean') {
        section.open = states[key];
      } else if (!useStored) {
        section.open = section.dataset.defaultOpen === 'true';
      }
    });
  };

  const bindSectionPersistence = () => {
    const sections = Array.from(document?.querySelectorAll?.('details[data-section-key]') || []);
    const states = readSectionStates();
    if (!sections.length) return;
    sections.forEach((section) => {
      const key = section.dataset.sectionKey;
      if (!key) return;
      if (!section.dataset.defaultOpen) {
        section.dataset.defaultOpen = section.hasAttribute('open') ? 'true' : 'false';
      }
      if (typeof states[key] === 'boolean') {
        section.open = states[key];
      }
      section.addEventListener('toggle', () => {
        const next = readSectionStates();
        next[key] = section.open;
        storeSectionStates(next);
      });
    });
  };

  const setActiveTab = (group, targetId, { persist = false } = {}) => {
    if (!group) return;
    const buttons = Array.from(document?.querySelectorAll?.(`.tab-button[data-tab-group="${group}"]`) || []);
    const panels = Array.from(document?.querySelectorAll?.(`.tab-panel[data-tab-group="${group}"]`) || []);
    if (!buttons.length || !panels.length) return;
    const target = targetId || buttons.find(button => button.classList.contains('active'))?.dataset.tabTarget;
    const finalTarget = target || buttons[0]?.dataset.tabTarget;
    buttons.forEach(button => button.classList.remove('active'));
    panels.forEach(panel => panel.classList.remove('active'));
    const activeButton = buttons.find(button => button.dataset.tabTarget === finalTarget) || buttons[0];
    const activePanel = panels.find(panel => panel.id === finalTarget) || panels[0];
    if (activeButton) activeButton.classList.add('active');
    if (activePanel) activePanel.classList.add('active');
    const storageKey = tabStorageKeys[group];
    if (persist && storageKey && activePanel?.id) {
      storeMidiId?.(storage, storageKey, activePanel.id);
    }
  };

  const applyTabState = ({ useStored = true } = {}) => {
    const groups = new Set();
    const buttons = Array.from(document?.querySelectorAll?.('.tab-button[data-tab-group]') || []);
    buttons.forEach(button => {
      if (button.dataset.tabGroup) groups.add(button.dataset.tabGroup);
    });
    groups.forEach(group => {
      const storageKey = tabStorageKeys[group];
      const stored = useStored && storageKey ? readStoredMidiId?.(storage, storageKey) : null;
      setActiveTab(group, stored, { persist: false });
    });
  };

  const bindTabs = () => {
    const buttons = Array.from(document?.querySelectorAll?.('.tab-button[data-tab-group]') || []);
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const group = button.dataset.tabGroup;
        const target = button.dataset.tabTarget;
        setActiveTab(group, target, { persist: true });
      });
    });
    applyTabState({ useStored: true });
  };

  return {
    readSectionStates,
    storeSectionStates,
    applySectionStates,
    bindSectionPersistence,
    setActiveTab,
    applyTabState,
    bindTabs
  };
};

export { createMidiUiTabsController };
