import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { clearLocalStorage, waitForHarnessReady } from './helpers/harness.js';
import { MidiUiPage } from './helpers/pageObjects.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
});

const openMidiUi = async (page, { resetStorage = false, withDevices = true } = {}) => {
  if (resetStorage) await clearLocalStorage(page);
  await installWebMidiStub(page, { withDevices });
  const midi = new MidiUiPage(page);
  await midi.goto('/?e2e=1');
  await waitForHarnessReady(page);
  await page.waitForSelector('#midiSourceList .midi-source-row');
  return midi;
};

test('MIDI sequencer creates a fresh project and clears legacy storage', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage?.setItem?.('lemmings.midi.intent', '{"revision":99}');
    window.localStorage?.setItem?.('lemmings.midi.overrides', '{"sfx":{"1":{"note":99}}}');
    window.localStorage?.setItem?.('lemmings.midi.inputId', 'legacy-input');
  });
  const midi = await openMidiUi(page, { resetStorage: false, withDevices: false });

  await expect(midi.workspace()).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/midi-disabled/);
  const state = await page.evaluate(() => ({
    legacyIntent: window.localStorage.getItem('lemmings.midi.intent'),
    legacyOverrides: window.localStorage.getItem('lemmings.midi.overrides'),
    legacyInput: window.localStorage.getItem('lemmings.midi.inputId'),
    project: window.__E2E__.midiGetProject()
  }));

  expect(state.legacyIntent).toBeNull();
  expect(state.legacyOverrides).toBeNull();
  expect(state.legacyInput).toBeNull();
  expect(state.project.version).toBe(1);
  expect(state.project.sources.some(source => source.kind === 'sfx' && source.sourceKey === '1')).toBe(true);
});

test('MIDI sequencer supports setup, track routing, direct mapping, and audition', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  await expect(page.locator('#midiInSelect')).toHaveValue('pw-input-1');
  await expect(page.locator('#midiOutSelect')).toHaveValue('pw-output-1');

  const project = await page.evaluate(() => {
    let next = window.__E2E__.midiDispatchProjectIntent({ type: 'track.add', track: { id: 'lead', name: 'Lead', channel: 3 } });
    next = window.__E2E__.midiDispatchProjectIntent({ type: 'source.assignTrack', sourceId: 'sfx-1', trackId: 'lead' });
    next = window.__E2E__.midiDispatchProjectIntent({ type: 'source.mapping.update', sourceId: 'sfx-1', patch: { note: 72, velocity: 96, durationTicks: 5 } });
    window.__E2E__.midiAudition({ sourceId: 'sfx-1', trackId: 'lead' });
    return next;
  });

  expect(project.tracks.some(track => track.id === 'lead' && track.channel === 3)).toBe(true);
  expect(project.sources.find(source => source.id === 'sfx-1').trackId).toBe('lead');
  await expect(midi.outputLog()).toContainText(/Audition|skipped/);
  await expect(page.locator('#midiTrackList')).toContainText('Lead');
  await expect(page.locator('#midiSelectedSourceSummary')).toContainText('Lead');
});

test('MIDI project persists across reload', async ({ page }) => {
  await openMidiUi(page);
  await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({ type: 'source.mapping.update', sourceId: 'sfx-1', patch: { note: 74 } });
  });

  await page.reload();
  await waitForHarnessReady(page);
  await page.waitForSelector('#midiSourceList .midi-source-row');
  const note = await page.evaluate(() => (
    window.__E2E__.midiGetProject().sources.find(source => source.id === 'sfx-1').mapping.note
  ));
  expect(note).toBe(74);
});

test('MIDI sequencer imports, exports, saves templates, and resets from templates', async ({ page }) => {
  const midi = await openMidiUi(page);

  const state = await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({
      type: 'source.mapping.update',
      sourceId: 'sfx-1',
      patch: { note: 79 }
    });
    const exported = window.__E2E__.midiExportProject({ download: false, exportedAt: 1 });
    const template = window.__E2E__.midiSaveProjectTemplate({
      id: 'lead-template',
      name: 'Lead Template',
      now: 1
    });
    const imported = window.__E2E__.midiImportProject(JSON.stringify({
      kind: 'lemmings.midi.project',
      version: 1,
      project: {
        ...exported.project,
        name: 'Imported MIDI',
        sources: exported.project.sources.map(source => (
          source.id === 'sfx-1'
            ? { ...source, mapping: { ...source.mapping, note: 84 } }
            : source
        ))
      }
    }));
    const reset = window.__E2E__.midiResetProject('lead-template');
    return {
      exported,
      template,
      importedNote: imported.sources.find(source => source.id === 'sfx-1').mapping.note,
      resetNote: reset.sources.find(source => source.id === 'sfx-1').mapping.note,
      templates: window.__E2E__.midiGetProjectTemplates()
    };
  });

  expect(state.exported.kind).toBe('lemmings.midi.project');
  expect(state.template).toMatchObject({ id: 'lead-template', name: 'Lead Template' });
  expect(state.importedNote).toBe(84);
  expect(state.resetNote).toBe(79);
  expect(state.templates.map(template => template.id)).toContain('lead-template');
  await expect(midi.templateSelect()).toContainText('Lead Template');
});

test('MIDI sequencer creates, edits, assigns, auditions, and persists a clip', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  const setField = async (selector, value) => {
    await page.locator(selector).evaluate((element, nextValue) => {
      element.value = String(nextValue);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };

  await midi.clipAddButton().click();
  await setField('#midiClipName', 'Lead Clip');
  await setField('.midi-step-note[data-step-index="0"]', 66);
  await setField('.midi-step-velocity[data-step-index="0"]', 91);
  await setField('.midi-step-note[data-step-index="1"]', 70);
  await midi.sourceModeSelect().selectOption('clip');
  await page.locator('#midiAssignClipButton').click();
  await midi.clipAuditionButton().click();

  const project = await page.evaluate(() => window.__E2E__.midiGetProject());
  const clip = project.clips.find(entry => entry.name === 'Lead Clip');
  const source = project.sources.find(entry => entry.id === 'sfx-1');
  expect(clip.steps[0]).toMatchObject({ note: 66, velocity: 91 });
  expect(clip.steps[1]).toMatchObject({ note: 70 });
  expect(source).toMatchObject({ mode: 'clip', clipId: clip.id });
  await expect(midi.outputLog()).toContainText(/Audition|skipped/);

  await page.reload();
  await waitForHarnessReady(page);
  await page.waitForSelector('#midiClipList .midi-clip-row');
  const reloaded = await page.evaluate(() => window.__E2E__.midiGetProject());
  expect(reloaded.clips.find(entry => entry.name === 'Lead Clip').steps[0].note).toBe(66);
  expect(reloaded.sources.find(entry => entry.id === 'sfx-1').mode).toBe('clip');
});

test('MIDI source browser search and filters remain usable', async ({ page }) => {
  const midi = await openMidiUi(page);
  await expect(midi.sourceRows().first()).toBeVisible();

  await page.locator('#midiSourceSearch').fill('skill');
  await expect(midi.sourceRows().first()).toContainText(/skill/i);
  await page.locator('#midiSourceKindFilter').selectOption('trigger');
  await expect(page.locator('#midiSourceList')).toContainText(/No sources|Trigger|MIDI_FLAG/i);
  await page.locator('#midiSourceSearch').fill('no-such-source-name');
  await expect(page.locator('#midiSourceList')).toContainText('No sources match');
});

test('MIDI sequencer edits modulation controls', async ({ page }) => {
  const midi = await openMidiUi(page);
  await expect(midi.modulationInspector()).toBeVisible();
  const setField = async (selector, value) => {
    await page.locator(selector).evaluate((element, nextValue) => {
      element.value = String(nextValue);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };
  const automationCount = await midi.automationRows().count();

  await setField('#midiTrackVelocityScale', '0.5');
  await setField('#midiGlobalIntensity', '96');
  await setField('#midiGlobalAccent', '0.8');
  await page.locator('#midiGlobalViewPan').check();
  await page.locator('#midiEnvelopeOverrideToggle').check();
  await midi.automationAddButton().click();

  const project = await page.evaluate(() => window.__E2E__.midiGetProject());
  expect(project.tracks[0].velocityScale).toBe(0.5);
  expect(project.global.velocityRange.default).toBe(96);
  expect(project.global.density.velocityBoost).toBe(0.8);
  expect(project.global.position.viewPan).toBe(true);
  expect(project.sources.find(source => source.id === 'sfx-1').mapping.envelope).toMatchObject({
    attack: 1,
    decay: 0,
    sustain: 1,
    release: 1
  });
  expect(project.automation.length).toBeGreaterThan(automationCount);
});

test('MIDI sequencer surfaces source conflicts in the browser and inspector', async ({ page }) => {
  const midi = await openMidiUi(page);
  await page.evaluate(() => {
    const project = window.__E2E__.midiGetProject();
    const source = project.sources.find(entry => entry.id === 'sfx-1');
    window.__E2E__.midiDispatchProjectIntent({
      type: 'project.set',
      project: {
        ...project,
        sources: [
          ...project.sources,
          {
            ...source,
            id: 'sfx-1-conflict',
            label: 'Duplicate Skill Select'
          }
        ],
        ui: {
          ...project.ui,
          selectedSourceId: 'sfx-1'
        }
      }
    });
  });

  await expect(midi.conflictRows().first()).toBeVisible();
  expect(await midi.conflictBadges().count()).toBeGreaterThanOrEqual(2);
  await expect(midi.conflictSummary()).toContainText('Duplicate runtime key');

  await midi.sourceAssignFilter().selectOption('clean');
  await expect(midi.conflictRows()).toHaveCount(0);
  await midi.sourceAssignFilter().selectOption('conflicts');
  expect(await midi.conflictBadges().count()).toBeGreaterThanOrEqual(2);
});

test('MIDI sequencer layout avoids horizontal overflow at desktop and phone sizes', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await openMidiUi(page);
    const metrics = await page.evaluate(() => {
      const selectors = ['#midiSequencerWorkspace', '#midiSourceBrowser', '#midiSourceList', '#midiTrackWorkspace', '#midiInspector', '#midiConflictSummary', '#midiModulationInspector', '#midiAutomationList'];
      return selectors.map(selector => {
        const el = document.querySelector(selector);
        return {
          selector,
          scrollWidth: el?.scrollWidth ?? 0,
          clientWidth: el?.clientWidth ?? 0
        };
      });
    });
    for (const metric of metrics) {
      expect(metric.scrollWidth).toBeLessThanOrEqual(metric.clientWidth + 2);
    }
  }
});
