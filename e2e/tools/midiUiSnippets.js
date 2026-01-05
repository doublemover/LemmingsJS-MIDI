export const MIDI_SELECTORS = {
  enableToggle: '#midiEnabledToggle',
  errorDisplay: '#errorDisplay',
  eventList: '#midiEventList details',
  keySelect: '#midiKeySelect',
  scaleSelect: '#midiScaleSelect'
};

export const collectPageErrors = (page) => {
  const errors = [];
  const ignored = [
    /SSL certificate error occurred when fetching the script\./i
  ];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location();
      const detail = location?.url
        ? `${message.text()} (${location.url}:${location.lineNumber || 0})`
        : message.text();
      if (!ignored.some(pattern => pattern.test(detail))) {
        errors.push(detail);
      }
    }
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    if (failure?.errorText) {
      const detail = `requestfailed: ${failure.errorText} (${request.url()})`;
      if (!ignored.some(pattern => pattern.test(detail))) {
        errors.push(detail);
      }
    }
  });
  return errors;
};

export const readMidiOverrides = (page) => {
  return page.evaluate(() => window.lemmingsMidiOverrides);
};

export const enableWebMidi = async (page) => {
  return page.evaluate(async () => {
    try {
      if (!window.WebMidi) {
        return { ok: false, reason: 'WebMidi missing' };
      }
      if (window.WebMidi.enabled) {
        return { ok: true, enabled: true };
      }
      await window.WebMidi.enable();
      return { ok: true, enabled: true };
    } catch (error) {
      return {
        ok: false,
        reason: error?.message || String(error)
      };
    }
  });
};

export const openMidiUi = async (page, { url = '/', navigate = true } = {}) => {
  if (navigate) {
    await page.goto(url);
  }
  await page.waitForSelector(MIDI_SELECTORS.enableToggle, { state: 'attached' });
  const toggle = page.locator(MIDI_SELECTORS.enableToggle);
  if (await toggle.isVisible() && !(await toggle.isChecked())) {
    await toggle.check();
  }
  await page.waitForSelector(MIDI_SELECTORS.eventList, { state: 'attached' });
  await page.waitForSelector('#controlRight', { state: 'visible' });
};

export const getMidiErrorDisplay = async (page) => {
  const text = await page.locator(MIDI_SELECTORS.errorDisplay).innerText();
  return text.trim();
};

export const openFirstMidiEvent = async (page) => {
  const details = page.locator(MIDI_SELECTORS.eventList).first();
  await details.waitFor({ state: 'attached' });
  await details.locator('summary').waitFor({ state: 'visible' });
  await details.locator('summary').click();
  await details.evaluate((node) => {
    node.open = true;
  });
  const sfxId = await page.evaluate(() => {
    const entry = document.querySelector('#midiEventList details');
    const summary = entry?.querySelector('summary');
    const text = summary?.textContent || '';
    const match = text.match(/#(\d+)/);
    if (match) return match[1];
    const fallback = text.match(/SFX\s+(\d+)/i);
    return fallback ? fallback[1] : null;
  });
  return { details, sfxId };
};

export const getEventRowIndexMap = async (details) => {
  return details.evaluate((node) => {
    const rows = Array.from(node.querySelectorAll('label'));
    return rows.reduce((acc, row, idx) => {
      const text = row.querySelector('span')?.textContent?.trim();
      if (text) acc[text] = idx;
      return acc;
    }, {});
  });
};

export const rowByLabel = (details, indexMap, label) => {
  const index = indexMap[label];
  return typeof index === 'number'
    ? details.locator('label').nth(index)
    : details.locator('label').first().locator('select').locator('nonexistent');
};
