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
  console.log('webmidi enable result:', webMidiStatus);
  if (!webMidiStatus.ok) {
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
  if (errorDisplay) {
    issues.push(`MIDI error display: ${errorDisplay}`);
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
  const modeSelect = rowByLabel(details, rowIndexMap, 'Mode').locator('select');
  const keyRowSelect = rowByLabel(details, rowIndexMap, 'Key').locator('select');
  const noteOctaveInput = rowByLabel(details, rowIndexMap, 'Octave').locator('input[type="number"]');
  const degreeInput = rowByLabel(details, rowIndexMap, 'Degree').locator('input[type="number"]');
  const scaleOctaveInput = rowByLabel(details, rowIndexMap, 'Scale octave').locator('input[type="number"]');
  const chordSelect = rowByLabel(details, rowIndexMap, 'Chord').locator('select');
  const arpToggle = rowByLabel(details, rowIndexMap, 'Arp').locator('input[type="checkbox"]');
  const arpMode = rowByLabel(details, rowIndexMap, 'Arp mode').locator('select');
  const arpLength = rowByLabel(details, rowIndexMap, 'Arp length').locator('input[type="number"]');

  if ((await modeSelect.count()) < 1) issues.push('Mode select missing from event details.');
  if ((await chordSelect.count()) < 1) issues.push('Chord select missing from event details.');
  if ((await arpMode.count()) < 1) issues.push('Arp mode select missing from event details.');

  if ((await modeSelect.count()) > 0 && sfxId) {
    await modeSelect.selectOption('note');
    if (await keyRowSelect.isDisabled()) issues.push('Key select disabled in note mode.');
    if (await noteOctaveInput.isDisabled()) issues.push('Octave disabled in note mode.');
    if (!(await degreeInput.isDisabled())) issues.push('Degree enabled in note mode.');
    if (!(await scaleOctaveInput.isDisabled())) issues.push('Scale octave enabled in note mode.');
    if (!(await chordSelect.isDisabled())) issues.push('Chord enabled in note mode.');

    await keyRowSelect.selectOption('1');
    await noteOctaveInput.fill('4');
    await noteOctaveInput.dispatchEvent('change');

    const noteEntry = await page.evaluate((id) => {
      return window.lemmingsMidiOverrides?.sfx?.[id] ?? null;
    }, sfxId);
    if (noteEntry?.note !== 49) {
      issues.push('Note selection did not update overrides (expected note 49).');
    }

    await modeSelect.selectOption('chord');
    if (!(await keyRowSelect.isDisabled())) issues.push('Key select enabled in chord mode.');
    if (!(await noteOctaveInput.isDisabled())) issues.push('Octave enabled in chord mode.');
    if (await degreeInput.isDisabled()) issues.push('Degree disabled in chord mode.');
    if (await scaleOctaveInput.isDisabled()) issues.push('Scale octave disabled in chord mode.');
    if (await chordSelect.isDisabled()) issues.push('Chord disabled in chord mode.');

    await degreeInput.fill('2');
    await degreeInput.dispatchEvent('change');
    await scaleOctaveInput.fill('4');
    await scaleOctaveInput.dispatchEvent('change');
    await chordSelect.selectOption('sus4');
    await arpToggle.check();
    await arpMode.selectOption('down');
    await arpLength.fill('5');
    await arpLength.dispatchEvent('change');

    const chordEntry = await page.evaluate((id) => {
      return window.lemmingsMidiOverrides?.sfx?.[id] ?? null;
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

  await page.locator('button[data-tab="triggers"]').click();
  const triggerCount = await page.locator('#midiTriggerList details').count();
  if (triggerCount < 1) issues.push('Trigger list is empty.');

  await page.locator('button[data-tab="adsr"]').click();
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
