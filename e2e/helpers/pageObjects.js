import { clearLocalStorage, waitForHarnessReady } from './harness.js';

const midiUiSelectors = Object.freeze({
  enabledToggle: '#midiEnabledToggle',
  controlRight: '#controlRight',
  eventDetails: '#midiEventList details',
  triggerDetails: '#midiTriggerList details'
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

  controlRight() {
    return this.page.locator(midiUiSelectors.controlRight);
  }

  eventDetails() {
    return this.page.locator(midiUiSelectors.eventDetails);
  }

  async openFirstEventDetails() {
    await this.eventDetails().first().locator('summary').click();
  }

  tabButton(targetId) {
    return this.page.locator(`[data-tab-target="${targetId}"]`);
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
