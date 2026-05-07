import { clearLocalStorage, waitForHarnessReady } from './harness.js';

const midiUiSelectors = Object.freeze({
  enabledToggle: '#midiEnabledToggle',
  workspace: '#midiSequencerWorkspace',
  sourceRows: '#midiSourceList .midi-source-row',
  sourceAssignFilter: '#midiSourceAssignFilter',
  conflictRows: '#midiSourceList .midi-source-row.has-conflict',
  trackRows: '#midiTrackList .midi-track-row',
  trackRemoveButton: '#midiTrackRemove',
  clipRows: '#midiClipList .midi-clip-row',
  clipAddButton: '#midiClipAddButton',
  clipDuplicateButton: '#midiClipDuplicateButton',
  clipRemoveButton: '#midiClipRemoveButton',
  clipInspector: '#midiClipInspector',
  clipAuditionButton: '#midiClipAuditionButton',
  sourceModeSelect: '#midiSourceModeSelect',
  sourceClipSelect: '#midiSourceClipSelect',
  conflictSummary: '#midiConflictSummary',
  conflictBadges: '#midiSourceList .midi-conflict-badge',
  modulationInspector: '#midiModulationInspector',
  automationRows: '#midiAutomationList .midi-automation-row',
  automationRemoveButtons: '#midiAutomationList .midi-automation-remove',
  automationAddButton: '#midiAutomationAddButton',
  automationPointBeatFields: '#midiAutomationList .midi-automation-point-beat',
  automationPointValueFields: '#midiAutomationList .midi-automation-point-value',
  templateSelect: '#midiTemplateSelect',
  templateSaveButton: '#midiTemplateSaveButton',
  projectExportButton: '#midiProjectExportButton',
  projectImportButton: '#midiProjectImportButton',
  learnPanel: '#midiLearnPanel',
  learnButton: '#midiLearnButton',
  learnConfirmButton: '#midiLearnConfirmButton',
  learnStatus: '#midiLearnStatus',
  recordPanel: '#midiRecordPanel',
  recordButton: '#midiRecordButton',
  recordCommitButton: '#midiRecordCommitButton',
  recordStatus: '#midiRecordStatus',
  stepCells: '#midiStepPatternGrid .midi-step-cell',
  inspector: '#midiInspector',
  outputLog: '#midiOutputLog'
});

class MidiUiPage {
  constructor(page) {
    this.page = page;
  }

  async goto(path = '/') {
    await this.page.goto(path);
    await this.page.waitForSelector(midiUiSelectors.enabledToggle);
  }

  enabledToggle() {
    return this.page.locator(midiUiSelectors.enabledToggle);
  }

  async enable() {
    await this.enabledToggle().check();
  }

  workspace() {
    return this.page.locator(midiUiSelectors.workspace);
  }

  sourceRows() {
    return this.page.locator(midiUiSelectors.sourceRows);
  }

  sourceAssignFilter() {
    return this.page.locator(midiUiSelectors.sourceAssignFilter);
  }

  conflictRows() {
    return this.page.locator(midiUiSelectors.conflictRows);
  }

  trackRows() {
    return this.page.locator(midiUiSelectors.trackRows);
  }

  trackRemoveButton() {
    return this.page.locator(midiUiSelectors.trackRemoveButton);
  }

  clipRows() {
    return this.page.locator(midiUiSelectors.clipRows);
  }

  clipAddButton() {
    return this.page.locator(midiUiSelectors.clipAddButton);
  }

  clipDuplicateButton() {
    return this.page.locator(midiUiSelectors.clipDuplicateButton);
  }

  clipRemoveButton() {
    return this.page.locator(midiUiSelectors.clipRemoveButton);
  }

  clipInspector() {
    return this.page.locator(midiUiSelectors.clipInspector);
  }

  clipAuditionButton() {
    return this.page.locator(midiUiSelectors.clipAuditionButton);
  }

  sourceModeSelect() {
    return this.page.locator(midiUiSelectors.sourceModeSelect);
  }

  sourceClipSelect() {
    return this.page.locator(midiUiSelectors.sourceClipSelect);
  }

  conflictSummary() {
    return this.page.locator(midiUiSelectors.conflictSummary);
  }

  conflictBadges() {
    return this.page.locator(midiUiSelectors.conflictBadges);
  }

  modulationInspector() {
    return this.page.locator(midiUiSelectors.modulationInspector);
  }

  automationRows() {
    return this.page.locator(midiUiSelectors.automationRows);
  }

  automationRemoveButtons() {
    return this.page.locator(midiUiSelectors.automationRemoveButtons);
  }

  automationAddButton() {
    return this.page.locator(midiUiSelectors.automationAddButton);
  }

  automationPointBeatFields() {
    return this.page.locator(midiUiSelectors.automationPointBeatFields);
  }

  automationPointValueFields() {
    return this.page.locator(midiUiSelectors.automationPointValueFields);
  }

  runtimeConfig() {
    return this.page.evaluate(() => window.__E2E__.midiGetRuntimeConfig());
  }

  uiMetrics() {
    return this.page.evaluate(() => window.__E2E__.midiGetUiMetrics());
  }

  setupState() {
    return this.page.evaluate(() => window.__E2E__.midiGetSetupState());
  }

  templateSelect() {
    return this.page.locator(midiUiSelectors.templateSelect);
  }

  templateSaveButton() {
    return this.page.locator(midiUiSelectors.templateSaveButton);
  }

  projectExportButton() {
    return this.page.locator(midiUiSelectors.projectExportButton);
  }

  projectImportButton() {
    return this.page.locator(midiUiSelectors.projectImportButton);
  }

  learnPanel() {
    return this.page.locator(midiUiSelectors.learnPanel);
  }

  learnButton() {
    return this.page.locator(midiUiSelectors.learnButton);
  }

  learnConfirmButton() {
    return this.page.locator(midiUiSelectors.learnConfirmButton);
  }

  learnStatus() {
    return this.page.locator(midiUiSelectors.learnStatus);
  }

  recordPanel() {
    return this.page.locator(midiUiSelectors.recordPanel);
  }

  recordButton() {
    return this.page.locator(midiUiSelectors.recordButton);
  }

  recordCommitButton() {
    return this.page.locator(midiUiSelectors.recordCommitButton);
  }

  recordStatus() {
    return this.page.locator(midiUiSelectors.recordStatus);
  }

  stepCells() {
    return this.page.locator(midiUiSelectors.stepCells);
  }

  inspector() {
    return this.page.locator(midiUiSelectors.inspector);
  }

  outputLog() {
    return this.page.locator(midiUiSelectors.outputLog);
  }
}

class HarnessGamePage {
  constructor(page) {
    this.page = page;
  }

  async goto({ resetStorage = true } = {}) {
    if (resetStorage) {
      await clearLocalStorage(this.page);
    }
    await this.page.goto('/?e2e=1');
    await waitForHarnessReady(this.page);
  }

  async invoke(method, ...args) {
    return this.page.evaluate(([name, params]) => {
      const api = window.__E2E__;
      if (!api || typeof api[name] !== 'function') return null;
      return api[name](...params);
    }, [method, args]);
  }

  async state() {
    return this.page.evaluate(() => window.__E2E__?.getState?.());
  }
}

export {
  HarnessGamePage,
  MidiUiPage,
  midiUiSelectors
};
