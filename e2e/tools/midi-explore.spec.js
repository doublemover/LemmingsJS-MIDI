import { test } from '@playwright/test';
import { installExternalAssetStubs } from '../helpers/externalAssets.js';
import {
  collectPageErrors,
  enableWebMidi,
  getEventRowIndexMap,
  getMidiErrorDisplay,
  MIDI_SELECTORS,
  openFirstMidiEvent,
  openMidiUi,
  readMidiOverrides,
  rowByLabel
} from './midiUiSnippets.js';

const IGNORED_MIDI_WARNINGS = [
  /permission to use web midi api was not granted/i,
  /webmidi permission denied/i
];

const isIgnoredMidiWarning = (text) => {
  if (!text) return false;
  return IGNORED_MIDI_WARNINGS.some(pattern => pattern.test(text));
};

const filterMidiWarnings = (text) => {
  if (!text) return '';
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.filter(line => !isIgnoredMidiWarning(line)).join('\n');
};

test('Explore MIDI UI mappings', async ({ page }) => {
  const errors = collectPageErrors(page);
  const issues = [];
  let crashed = false;
  page.on('crash', () => {
    crashed = true;
    issues.push('Page crashed during MIDI init.');
  });
  page.on('request', (request) => {
    if (request.url().includes('sneakyness.com')) {
      console.log('stats request:', request.url());
    }
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('sneakyness.com')) {
      console.log('stats request failed:', request.url(), request.failure());
    }
  });
  await installExternalAssetStubs(page);
  await page.context().grantPermissions(['midi']);

  await page.addInitScript(() => {
    try {
      window.localStorage?.setItem?.('lemmings.midi.enabled', 'true');
      window.localStorage?.removeItem?.('lemmings.midi.panelCollapsed');
    } catch (error) {}
  });
  await page.goto('/');
  const webMidiStatus = await enableWebMidi(page);
  if (webMidiStatus.ok || !isIgnoredMidiWarning(webMidiStatus.reason)) {
    console.log('webmidi enable result:', webMidiStatus);
  }
  if (!webMidiStatus.ok && !isIgnoredMidiWarning(webMidiStatus.reason)) {
    issues.push(`WebMIDI enable failed: ${webMidiStatus.reason || 'unknown'}`);
  }
  if (crashed) {
    console.log('midi exploration issues:', JSON.stringify(issues, null, 2));
    return;
  }

  try {
    const readyState = await page.evaluate(() => document.readyState);
    const toggleCount = await page.locator('#midiEnabledToggle').count();
    console.log('ready state:', readyState, 'toggle count:', toggleCount);
  } catch (error) {
    issues.push(`Unable to read MIDI toggle state: ${error?.message || error}`);
  }

  try {
    await openMidiUi(page, { navigate: false });
  } catch (error) {
    issues.push(`Unable to open MIDI UI: ${error?.message || error}`);
    console.log('midi exploration issues:', JSON.stringify(issues, null, 2));
    return;
  }
  const webdriverFlag = await page.evaluate(() => navigator.webdriver);
  console.log('navigator.webdriver:', webdriverFlag);
  const externalResources = await page.evaluate(() => {
    const origin = window.location.origin;
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    return resources.filter(name => !name.startsWith(origin));
  });
  if (externalResources.length) {
    console.log('external resources:', JSON.stringify(externalResources, null, 2));
  }
  const errorDisplay = await getMidiErrorDisplay(page);
  const filteredErrorDisplay = filterMidiWarnings(errorDisplay);
  if (filteredErrorDisplay) {
    issues.push(`MIDI error display: ${filteredErrorDisplay}`);
  }

  const keySelect = page.locator(MIDI_SELECTORS.keySelect);
  const scaleSelect = page.locator(MIDI_SELECTORS.scaleSelect);
  const keyCount = await keySelect.locator('option').count();
  const scaleCount = await scaleSelect.locator('option').count();
  if (keyCount < 1) issues.push('Key select has no options.');
  if (scaleCount < 1) issues.push('Scale select has no options.');

  if (keyCount > 1) {
    await keySelect.selectOption('1');
    const overrides = await readMidiOverrides(page);
    if (overrides?.scale?.root !== 1) {
      issues.push('Key select did not update scale.root override.');
    }
  }

  if (scaleCount > 1) {
    const nextScale = await scaleSelect.locator('option').nth(1).getAttribute('value');
    if (nextScale) {
      await scaleSelect.selectOption(nextScale);
      const overrides = await readMidiOverrides(page);
      if (overrides?.scale?.name !== nextScale) {
        issues.push('Scale select did not update scale.name override.');
      }
    }
  }

  const { details, sfxId } = await openFirstMidiEvent(page);
  if (!sfxId) issues.push('Unable to read an SFX id from the first MIDI event.');

  const rowIndexMap = await getEventRowIndexMap(details);
  const rowLocator = (label) => {
    if (typeof rowIndexMap?.[label] !== 'number') return null;
    return rowByLabel(details, rowIndexMap, label);
  };
  const controlLocator = (label, selector) => rowLocator(label)?.locator(selector) ?? null;
  const modeSelect = controlLocator('Mode', 'select');
  const noteInput = controlLocator('Note', 'input[type="number"]');
  const keyRowSelect = controlLocator('Key', 'select');
  const keyboardButtons = controlLocator('Keyboard', '.midi-note-key');
  const noteOctaveInput = controlLocator('Octave', 'input[type="number"]');
  const degreeInput = controlLocator('Degree', 'input[type="number"]');
  const scaleOctaveInput = controlLocator('Scale octave', 'input[type="number"]');
  const chordSelect = controlLocator('Chord', 'select');
  const arpToggle = controlLocator('Arp', 'input[type="checkbox"]');
  const arpMode = controlLocator('Arp mode', 'select');
  const arpPresetDown = controlLocator('Arp preset', 'button[data-value="down"]');
  const arpLength = controlLocator('Arp length', 'input[type="number"]');

  const ensureVisible = async (locator, label) => {
    if (!locator) {
      issues.push(`${label} is missing from event details.`);
      return false;
    }
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      issues.push(`${label} is not visible in event details.`);
    }
    return visible;
  };
  const trySelectOption = async (locator, value, label) => {
    if (!locator) {
      issues.push(`${label} select missing from event details.`);
      return false;
    }
    try {
      await locator.selectOption(value, { force: true, timeout: 1000 });
      return true;
    } catch (error) {
      issues.push(`${label} select not visible/enabled for option "${value}".`);
      return false;
    }
  };
  const isDisabled = async (locator) => locator ? locator.isDisabled() : false;

  if (!modeSelect || (await modeSelect.count()) < 1) issues.push('Mode select missing from event details.');
  if (!chordSelect || (await chordSelect.count()) < 1) issues.push('Chord select missing from event details.');
  if (!arpMode && !arpPresetDown) issues.push('Arp preset/mode control missing from event details.');

  if (modeSelect && (await modeSelect.count()) > 0 && sfxId) {
    const modeSelected = await trySelectOption(modeSelect, 'note', 'Mode');
    if (!modeSelected) {
      if (issues.length) {
        console.log('midi exploration issues:', JSON.stringify(issues, null, 2));
      }
      return;
    }
    if (keyRowSelect && await isDisabled(keyRowSelect)) issues.push('Key select disabled in note mode.');
    if (noteOctaveInput && await isDisabled(noteOctaveInput)) issues.push('Octave disabled in note mode.');
    if (noteInput && await isDisabled(noteInput)) issues.push('Note input disabled in note mode.');
    if (keyboardButtons && (await keyboardButtons.first().isDisabled())) issues.push('Keyboard picker disabled in note mode.');
    if (!(await isDisabled(degreeInput))) issues.push('Degree enabled in note mode.');
    if (!(await isDisabled(scaleOctaveInput))) issues.push('Scale octave enabled in note mode.');
    if (!(await isDisabled(chordSelect))) issues.push('Chord enabled in note mode.');

    let expectedNote = 49;
    let expectedNoteModulo = null;
    if (keyRowSelect && noteOctaveInput) {
      await trySelectOption(keyRowSelect, '1', 'Key');
      if (!(await ensureVisible(noteOctaveInput, 'Octave input'))) {
        if (issues.length) {
          console.log('midi exploration issues:', JSON.stringify(issues, null, 2));
        }
        return;
      }
      await noteOctaveInput.fill('4');
      await noteOctaveInput.dispatchEvent('change');
    } else if (keyboardButtons && await keyboardButtons.count() > 1) {
      expectedNote = null;
      expectedNoteModulo = 1;
      await keyboardButtons.nth(1).dispatchEvent('click');
    } else if (noteInput) {
      if (!(await ensureVisible(noteInput, 'Note input'))) {
        if (issues.length) {
          console.log('midi exploration issues:', JSON.stringify(issues, null, 2));
        }
        return;
      }
      await noteInput.fill('49');
      await noteInput.dispatchEvent('change');
    } else {
      issues.push('No note editor control is available in note mode.');
      if (issues.length) {
        console.log('midi exploration issues:', JSON.stringify(issues, null, 2));
      }
      return;
    }

    const noteEntry = await page.evaluate((id) => {
      return window.__LEMMINGS_MIDI_UI__?.getIntentState?.()?.overrides?.sfx?.[id] ?? null;
    }, sfxId);
    if (expectedNote != null && noteEntry?.note !== expectedNote) {
      issues.push('Note selection did not update overrides (expected note 49).');
    }
    if (expectedNoteModulo != null && (noteEntry?.note ?? -1) % 12 !== expectedNoteModulo) {
      issues.push(`Keyboard picker did not update note key (expected modulo ${expectedNoteModulo}).`);
    }

    const chordModeSelected = await trySelectOption(modeSelect, 'chord', 'Mode');
    if (!chordModeSelected) {
      if (issues.length) {
        console.log('midi exploration issues:', JSON.stringify(issues, null, 2));
      }
      return;
    }
    if (keyRowSelect && !(await isDisabled(keyRowSelect))) issues.push('Key select enabled in chord mode.');
    if (noteOctaveInput && !(await isDisabled(noteOctaveInput))) issues.push('Octave enabled in chord mode.');
    if (noteInput && !(await isDisabled(noteInput))) issues.push('Note input enabled in chord mode.');
    if (keyboardButtons && !(await keyboardButtons.first().isDisabled())) issues.push('Keyboard picker enabled in chord mode.');
    if (await isDisabled(degreeInput)) issues.push('Degree disabled in chord mode.');
    if (await isDisabled(scaleOctaveInput)) issues.push('Scale octave disabled in chord mode.');
    if (await isDisabled(chordSelect)) issues.push('Chord disabled in chord mode.');

    if (!(await ensureVisible(degreeInput, 'Degree input'))
      || !(await ensureVisible(scaleOctaveInput, 'Scale octave input'))) {
      if (issues.length) {
        console.log('midi exploration issues:', JSON.stringify(issues, null, 2));
      }
      return;
    }
    await degreeInput.fill('2');
    await degreeInput.dispatchEvent('change');
    await scaleOctaveInput.fill('4');
    await scaleOctaveInput.dispatchEvent('change');
    await trySelectOption(chordSelect, 'sus4', 'Chord');
    if (await ensureVisible(arpToggle, 'Arp toggle')) {
      await arpToggle.check();
    }
    if (arpMode) {
      await trySelectOption(arpMode, 'down', 'Arp mode');
    } else if (arpPresetDown && await ensureVisible(arpPresetDown, 'Arp down preset')) {
      await arpPresetDown.click();
    }
    await arpLength.fill('5');
    await arpLength.dispatchEvent('change');

    const chordEntry = await page.evaluate((id) => {
      return window.__LEMMINGS_MIDI_UI__?.getIntentState?.()?.overrides?.sfx?.[id] ?? null;
    }, sfxId);
    if (chordEntry?.degree !== 2 || chordEntry?.octave !== 4) {
      issues.push('Chord degree/octave did not update overrides.');
    }
    if (chordEntry?.chord?.type !== 'sus4') {
      issues.push('Chord type did not update overrides.');
    }
    if (!chordEntry?.arp?.enabled || chordEntry?.arp?.mode !== 'down' || chordEntry?.arp?.length !== 5) {
      issues.push('Arp settings did not update overrides.');
    }
  }

  await page.locator('button[data-tab-target="midiTabTriggers"]').click();
  const triggerCount = await page.locator('#midiTriggerList details').count();
  if (triggerCount < 1) issues.push('Trigger list is empty.');

  await page.locator('button[data-tab-target="midiTabAdsr"]').click();
  const adsrTargetCount = await page.locator('#midiEnvTarget option').count();
  if (adsrTargetCount < 1) issues.push('ADSR target list is empty.');
  const adsrAttack = page.locator('#midiEnvAttack');
  if ((await adsrAttack.count()) > 0) {
    await adsrAttack.fill('1.5');
    await adsrAttack.dispatchEvent('change');
    const overrides = await readMidiOverrides(page);
    if (overrides?.envelope?.attack !== 1.5) {
      issues.push('ADSR attack did not update overrides.');
    }
  }

  if (errors.length) {
    issues.push(`Console/page errors: ${JSON.stringify(errors)}`);
  }
  if (issues.length) {
    console.log('midi exploration issues:', JSON.stringify(issues, null, 2));
  } else {
    console.log('midi exploration issues: none');
  }
});
