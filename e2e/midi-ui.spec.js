import { expect, test } from '@playwright/test';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
import { clearLocalStorage, waitForHarnessReady } from './helpers/harness.js';
import { MidiUiPage } from './helpers/pageObjects.js';
import { installWebMidiStub } from './helpers/webmidiStub.js';

test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
});

const openMidiUi = async (page, { resetStorage = false, withDevices = true, permission = 'granted' } = {}) => {
  if (resetStorage) await clearLocalStorage(page);
  await installWebMidiStub(page, { withDevices, permission });
  const midi = new MidiUiPage(page);
  await midi.goto('/?e2e=1');
  await waitForHarnessReady(page);
  await page.waitForSelector('#midiSourceList .midi-source-row');
  return midi;
};

const setFieldValue = async (page, selector, value) => {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
};

test('MIDI sequencer gives editor controls scoped accessible names', async ({ page }) => {
  const midi = await openMidiUi(page);
  await expect(midi.workspace()).toBeVisible();

  const labels = await page.locator([
    '#midiProjectResetButton',
    '#midiPanicButton',
    '#midiTemplateSaveButton',
    '#midiProjectExportButton',
    '#midiProjectImportButton',
    '#midiTrackAdd',
    '#midiTrackRemove',
    '#midiClipAddButton',
    '#midiClipDuplicateButton',
    '#midiClipRemoveButton',
    '#midiAssignSourceButton',
    '#midiAuditionButton',
    '#midiClipAuditionButton',
    '#midiSourceRevertButton',
    '#midiAssignClipButton',
    '#midiLearnButton',
    '#midiLearnConfirmButton',
    '#midiLearnCancelButton',
    '#midiAutomationAddButton',
    '#midiRecordButton',
    '#midiRecordCommitButton',
    '#midiRecordCancelButton'
  ].join(', ')).evaluateAll(buttons => Object.fromEntries(
    buttons.map(button => [button.id, button.getAttribute('aria-label')])
  ));

  expect(labels).toEqual({
    midiProjectResetButton: 'Reset MIDI project',
    midiPanicButton: 'Panic all MIDI notes',
    midiTemplateSaveButton: 'Save MIDI template',
    midiProjectExportButton: 'Export MIDI project',
    midiProjectImportButton: 'Import MIDI project',
    midiTrackAdd: 'Add MIDI track',
    midiTrackRemove: 'Remove selected MIDI track',
    midiClipAddButton: 'Add MIDI clip',
    midiClipDuplicateButton: 'Duplicate selected MIDI clip',
    midiClipRemoveButton: 'Remove selected MIDI clip',
    midiAssignSourceButton: 'Assign selected source to track',
    midiAuditionButton: 'Audition selected source',
    midiClipAuditionButton: 'Audition selected clip',
    midiSourceRevertButton: 'Revert selected source mapping',
    midiAssignClipButton: 'Assign selected clip to source',
    midiLearnButton: 'Start MIDI learn',
    midiLearnConfirmButton: 'Commit MIDI learn',
    midiLearnCancelButton: 'Cancel MIDI learn',
    midiAutomationAddButton: 'Add modulation lane',
    midiRecordButton: 'Start MIDI recording',
    midiRecordCommitButton: 'Commit MIDI recording',
    midiRecordCancelButton: 'Cancel MIDI recording'
  });

  const statuses = await page.locator([
    '#midiConflictSummary',
    '#midiLearnStatus',
    '#midiRecordStatus',
    '#midiSchedulerPressure',
    '#midiOutputLog',
    '#midiSourceCount'
  ].join(', ')).evaluateAll(elements => Object.fromEntries(
    elements.map(element => [element.id, {
      role: element.getAttribute('role'),
      live: element.getAttribute('aria-live') || ''
    }])
  ));

  expect(statuses).toEqual({
    midiConflictSummary: { role: 'status', live: 'polite' },
    midiLearnStatus: { role: 'status', live: '' },
    midiRecordStatus: { role: 'status', live: '' },
    midiSchedulerPressure: { role: 'status', live: 'polite' },
    midiOutputLog: { role: 'status', live: 'polite' },
    midiSourceCount: { role: 'status', live: 'polite' }
  });
});

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

  await midi.enable();
  await expect(page.locator('#midiInSelect')).toContainText('No input devices');
  await expect(page.locator('#midiOutSelect')).toContainText('No output devices');
  await expect(page.locator('#errorDisplay')).toContainText('No input device');
  await expect(page.locator('#errorDisplay')).toContainText('No output device');
});

test('MIDI sequencer reports permission denial and mocked device lifecycle', async ({ page }) => {
  let midi = await openMidiUi(page, { permission: 'denied' });
  await midi.enable();
  await expect(page.locator('#errorDisplay')).toContainText('WebMIDI permission denied');

  await page.goto('about:blank');
  midi = await openMidiUi(page);
  await midi.enable();
  await expect(page.locator('#midiInSelect')).toHaveValue('pw-input-1');
  await expect(page.locator('#midiOutSelect')).toHaveValue('pw-output-1');

  const disconnected = await page.evaluate(() => ({
    input: window.__WEBMIDI_STUB__.disconnectInput('pw-input-1'),
    output: window.__WEBMIDI_STUB__.disconnectOutput('pw-output-1')
  }));
  expect(disconnected).toEqual({ input: true, output: true });
  await expect(page.locator('#midiInSelect')).toContainText('No input devices');
  await expect(page.locator('#midiOutSelect')).toContainText('No output devices');
  await expect(page.locator('#errorDisplay')).toContainText('No input device');
  await expect(page.locator('#errorDisplay')).toContainText('No output device');

  const reconnected = await page.evaluate(() => ({
    input: window.__WEBMIDI_STUB__.reconnectInput('pw-input-2', 'Recovered Input'),
    output: window.__WEBMIDI_STUB__.reconnectOutput('pw-output-2', 'Recovered Output')
  }));
  expect(reconnected).toEqual({ input: true, output: true });
  await expect(page.locator('#midiInSelect')).toHaveValue('pw-input-2');
  await expect(page.locator('#midiOutSelect')).toHaveValue('pw-output-2');
  await expect(page.locator('#errorDisplay')).toHaveText('');
});

test('MIDI sequencer supports setup, track routing, direct mapping, and audition', async ({ page }) => {
  const midi = await openMidiUi(page);
  const setField = async (selector, value) => {
    await page.locator(selector).evaluate((element, nextValue) => {
      element.value = String(nextValue);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };
  await midi.enable();
  await expect(page.locator('#midiInSelect')).toHaveValue('pw-input-1');
  await expect(page.locator('#midiOutSelect')).toHaveValue('pw-output-1');
  await page.locator('#midiTrackOutputSelect').selectOption('pw-output-1');
  await page.locator('#midiScaleRoot').selectOption('2');
  await page.locator('#midiScaleName').selectOption('major');
  await page.locator('#midiQuantize').selectOption('1/8');
  await setField('#midiSwing', '0.25');
  await page.locator('#midiReversePanicToggle').check();

  const project = await page.evaluate(() => {
    let next = window.__E2E__.midiDispatchProjectIntent({ type: 'track.add', track: { id: 'lead', name: 'Lead', channel: 3 } });
    next = window.__E2E__.midiDispatchProjectIntent({ type: 'source.assignTrack', sourceId: 'sfx-1', trackId: 'lead' });
    next = window.__E2E__.midiDispatchProjectIntent({ type: 'source.mapping.update', sourceId: 'sfx-1', patch: { note: 72, velocity: 96, durationTicks: 5 } });
    window.__E2E__.midiAudition({ sourceId: 'sfx-1', trackId: 'lead' });
    return next;
  });
  await setField('#midiTrackPriority', '4');
  await setField('#midiTrackVoiceBudget', '6');
  await setField('#midiTrackVelocityScale', '0.75');
  await page.locator('#midiTrackMute').check();
  await page.locator('#midiTrackMute').uncheck();
  await page.locator('#midiTrackSolo').check();
  await page.locator('#midiTrackArm').check();
  await page.locator('#midiMappingArp').selectOption('down');
  await setField('#midiMappingPan', '-24');
  await setField('#midiMappingTimbre', '88');
  await setField('#midiMappingPitchBend', '0.5');
  const updatedProject = await page.evaluate(() => window.__E2E__.midiGetProject());
  const runtime = await page.evaluate(() => window.__E2E__.midiGetRuntimeConfig());
  const updatedMapping = updatedProject.sources.find(source => source.id === 'sfx-1').mapping;
  const updatedTrack = updatedProject.tracks.find(track => track.id === 'lead');

  expect(project.tracks.some(track => track.id === 'lead' && track.channel === 3)).toBe(true);
  expect(project.tracks.find(track => track.id === 'track-1').outputId).toBe('pw-output-1');
  expect(project.sources.find(source => source.id === 'sfx-1').trackId).toBe('lead');
  expect(updatedTrack).toMatchObject({
    priority: 4,
    voiceBudget: 6,
    velocityScale: 0.75,
    mute: false,
    solo: true,
    arm: true
  });
  expect(updatedProject.global.scale).toMatchObject({ name: 'major', root: 2 });
  expect(updatedProject.global.scale.degrees).toEqual([0, 2, 4, 5, 7, 9, 11]);
  expect(updatedProject.global.reverse.allNotesOffOnToggle).toBe(true);
  expect(updatedProject.transport).toMatchObject({ quantize: '1/8', swing: 0.25 });
  expect(updatedMapping).toMatchObject({ note: 72, velocity: 96, durationTicks: 5, pan: -24, timbre: 88, pitchBend: 0.5 });
  expect(updatedMapping.arp).toMatchObject({ enabled: true, mode: 'down' });
  expect(runtime.sfx['1']).toMatchObject({
    note: 72,
    velocity: 72,
    durationTicks: 5,
    channel: 3,
    trackId: 'lead',
    priority: 4,
    voiceBudget: 6,
    pan: -24,
    timbre: 88,
    pitchBend: 0.5
  });
  expect(runtime.sfx['1'].arp).toMatchObject({ enabled: true, mode: 'down' });
  await expect(midi.outputLog()).toContainText(/Audition|skipped/);
  await expect(page.locator('#midiTrackList')).toContainText('Lead');
  await expect(page.locator('#midiSelectedSourceSummary')).toContainText('Lead');
});

test('MIDI sequencer lowers direct chord mappings into runtime config', async ({ page }) => {
  const midi = await openMidiUi(page);
  const setField = async (selector, value) => {
    await page.locator(selector).evaluate((element, nextValue) => {
      element.value = String(nextValue);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };
  await midi.enable();

  await page.locator('#midiMappingChord').selectOption('seventh');
  await setField('#midiMappingDegree', '2');
  await setField('#midiMappingOctave', '5');
  await setField('#midiMappingChordInversion', '1');
  const state = await page.evaluate(() => ({
    auditioned: window.__E2E__.midiAudition({ sourceId: 'sfx-1' }),
    project: window.__E2E__.midiGetProject(),
    runtime: window.__E2E__.midiGetRuntimeConfig()
  }));
  const mapping = state.project.sources.find(source => source.id === 'sfx-1').mapping;

  expect(mapping).toMatchObject({
    note: null,
    degree: 2,
    octave: 5,
    chord: { type: 'seventh', inversion: 1 }
  });
  expect(state.runtime.sfx['1']).toMatchObject({
    degree: 2,
    octave: 5,
    chord: { type: 'seventh', inversion: 1 }
  });
  expect(state.runtime.sfx['1'].note).toBeUndefined();
  expect(state.auditioned).toBe(true);
  await expect(midi.outputLog()).toContainText('Audition');
});

test('MIDI sequencer routes multiple sources to separate track channels', async ({ page }) => {
  await openMidiUi(page);

  const state = await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({ type: 'track.add', track: { id: 'melody', name: 'Melody', channel: 2 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'track.add', track: { id: 'drums', name: 'Drums', channel: 10 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'source.assignTrack', sourceId: 'sfx-1', trackId: 'melody' });
    window.__E2E__.midiDispatchProjectIntent({ type: 'source.assignTrack', sourceId: 'sfx-2', trackId: 'drums' });
    window.__E2E__.midiDispatchProjectIntent({
      type: 'source.mapping.update',
      sourceId: 'sfx-2',
      patch: { note: 36, velocity: 110 }
    });
    return {
      project: window.__E2E__.midiGetProject(),
      runtime: window.__E2E__.midiGetRuntimeConfig()
    };
  });

  expect(state.project.sources.find(source => source.id === 'sfx-1')).toMatchObject({ trackId: 'melody' });
  expect(state.project.sources.find(source => source.id === 'sfx-2')).toMatchObject({ trackId: 'drums' });
  expect(state.runtime.sfx['1']).toMatchObject({ trackId: 'melody', channel: 2 });
  expect(state.runtime.sfx['2']).toMatchObject({ trackId: 'drums', channel: 10, note: 36, velocity: 110 });
  await expect(page.locator('#midiTrackList')).toContainText('Melody');
  await expect(page.locator('#midiTrackList')).toContainText('Drums');
});

test('MIDI sequencer removes tracks and manages clip library controls', async ({ page }) => {
  const midi = await openMidiUi(page);
  await expect(midi.trackRemoveButton()).toBeDisabled();
  await expect(midi.clipDuplicateButton()).toBeDisabled();
  await expect(midi.clipRemoveButton()).toBeDisabled();

  await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({ type: 'track.add', track: { id: 'lead', name: 'Lead', channel: 3 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'track.add', track: { id: 'drums', name: 'Drums', channel: 10 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'source.assignTrack', sourceId: 'sfx-1', trackId: 'drums' });
    window.__E2E__.midiDispatchProjectIntent({
      type: 'automation.add',
      automation: { id: 'lane-drums', scope: 'track', trackId: 'drums', target: 'velocity', axis: 'y' }
    });
    window.__E2E__.midiDispatchProjectIntent({ type: 'track.select', trackId: 'drums' });
  });
  await expect(midi.trackRemoveButton()).toBeEnabled();
  await midi.trackRemoveButton().click();

  let project = await page.evaluate(() => window.__E2E__.midiGetProject());
  expect(project.tracks.map(track => track.id)).toEqual(['track-1', 'lead']);
  expect(project.ui.selectedTrackId).toBe('lead');
  expect(project.sources.find(source => source.id === 'sfx-1').trackId).toBe('lead');
  expect(project.automation.some(lane => lane.id === 'lane-drums')).toBe(false);
  expect(project.automation.every(lane => lane.trackId !== 'drums')).toBe(true);

  await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 4 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.step.update', clipId: 'riff', stepIndex: 0, patch: { note: 65, velocity: 90 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.add', clip: { id: 'fill', name: 'Fill', lengthSteps: 4 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'source.clip.assign', sourceId: 'sfx-1', clipId: 'riff' });
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.select', clipId: 'riff' });
  });
  await expect(midi.clipDuplicateButton()).toBeEnabled();
  await expect(midi.clipRemoveButton()).toBeEnabled();
  await midi.clipDuplicateButton().click();

  project = await page.evaluate(() => window.__E2E__.midiGetProject());
  expect(project.clips.map(clip => clip.id)).toEqual(['riff', 'fill', 'riff-copy']);
  expect(project.ui.selectedClipId).toBe('riff-copy');
  expect(project.clips.find(clip => clip.id === 'riff-copy').steps[0]).toMatchObject({ note: 65, velocity: 90 });
  expect(project.sources.find(source => source.id === 'sfx-1')).toMatchObject({ mode: 'clip', clipId: 'riff' });

  await page.evaluate(() => window.__E2E__.midiDispatchProjectIntent({ type: 'clip.select', clipId: 'riff' }));
  await midi.clipRemoveButton().click();
  project = await page.evaluate(() => window.__E2E__.midiGetProject());
  expect(project.clips.map(clip => clip.id)).toEqual(['fill', 'riff-copy']);
  expect(project.ui.selectedClipId).toBe('fill');
  expect(project.sources.find(source => source.id === 'sfx-1')).toMatchObject({ mode: 'direct', clipId: null });
});

test('MIDI sequencer panic button logs feedback', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();

  await expect(midi.outputLog()).toHaveAttribute('role', 'status');
  await expect(midi.outputLog()).toHaveAttribute('aria-live', 'polite');
  await page.locator('#midiPanicButton').click();
  await expect(midi.outputLog()).toContainText('Panic sent');
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

test('MIDI sequencer learns a selected direct source note and resolves range warnings', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();
  const setField = async (selector, value) => {
    await page.locator(selector).evaluate((element, nextValue) => {
      element.value = String(nextValue);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };

  await setField('#midiGlobalNoteMax', '80');
  await expect(midi.learnPanel()).toBeVisible();
  await midi.learnButton().click();
  await expect(midi.learnStatus()).toContainText('Listening');
  const sent = await page.evaluate(() => window.__WEBMIDI_STUB__.sendNoteOn(86, 104, 6));
  expect(sent).toBe(true);
  await expect(midi.learnStatus()).toContainText('Pending note 86');
  await expect(midi.learnStatus()).toContainText('1 warning');
  await midi.learnConfirmButton().click();
  await expect(midi.conflictSummary()).toContainText('outside the project note range');

  const project = await page.evaluate(() => window.__E2E__.midiGetProject());
  const source = project.sources.find(entry => entry.id === 'sfx-1');
  expect(source.mapping).toMatchObject({ note: 86, velocity: 104, degree: null, chord: null });
  await setField('#midiGlobalNoteMax', '96');
  await page.evaluate(() => window.__E2E__.midiDispatchProjectIntent({ type: 'source.select', sourceId: 'sfx-1' }));
  await expect.poll(() => page.evaluate(() => window.__E2E__.midiGetProject().ui.selectedSourceId)).toBe('sfx-1');
  await expect(midi.conflictSummary()).not.toContainText('outside the project note range');
});

test('MIDI sequencer records mocked MIDI notes into a step clip', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.enable();

  await midi.clipAddButton().click();
  await expect(midi.recordPanel()).toBeVisible();
  await midi.recordButton().click();
  await expect(midi.recordStatus()).toContainText('Recording');
  await page.evaluate(() => {
    window.__WEBMIDI_STUB__.sendNoteOn(62, 90, 1);
    window.__WEBMIDI_STUB__.sendNoteOff(62, 0, 1);
    window.__WEBMIDI_STUB__.sendNoteOn(65, 88, 1);
  });
  await midi.recordCommitButton().click();

  const project = await page.evaluate(() => window.__E2E__.midiGetProject());
  const clip = project.clips.find(entry => entry.id === project.ui.selectedClipId);
  expect(clip.steps[0]).toMatchObject({ note: 62, velocity: 90 });
  expect(clip.steps[1]).toMatchObject({ note: 65, velocity: 88 });
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
  await page.locator('#midiClipType').selectOption('arp');
  await page.locator('#midiClipArpMode').selectOption('updown');
  await page.locator('#midiClipArpPattern').selectOption('custom');
  await setField('.midi-step-note[data-step-index="0"]', 66);
  await setField('.midi-step-velocity[data-step-index="0"]', 91);
  await setField('.midi-step-duration[data-step-index="0"]', 9);
  await setField('.midi-step-note[data-step-index="1"]', 70);
  await midi.sourceModeSelect().selectOption('clip');
  await page.locator('#midiAssignClipButton').click();
  await midi.clipAuditionButton().click();

  const project = await page.evaluate(() => window.__E2E__.midiGetProject());
  const clip = project.clips.find(entry => entry.name === 'Lead Clip');
  const source = project.sources.find(entry => entry.id === 'sfx-1');
  expect(clip).toMatchObject({
    type: 'arp',
    arp: {
      mode: 'updown',
      pattern: { preset: 'custom' }
    }
  });
  expect(clip.steps[0]).toMatchObject({ note: 66, velocity: 91, durationTicks: 9 });
  expect(clip.steps[1]).toMatchObject({ note: 70 });
  expect(source).toMatchObject({ mode: 'clip', clipId: clip.id });
  const runtime = await page.evaluate(() => window.__E2E__.midiGetRuntimeConfig());
  expect(runtime.sfx['1']).toMatchObject({
    note: 66,
    velocity: 91,
    durationTicks: 9,
    clipId: clip.id
  });
  expect(runtime.sfx['1'].notes).toEqual([66, 70]);
  await expect(midi.outputLog()).toContainText(/Audition|skipped/);

  await page.reload();
  await waitForHarnessReady(page);
  await page.waitForSelector('#midiClipList .midi-clip-row');
  const reloaded = await page.evaluate(() => window.__E2E__.midiGetProject());
  expect(reloaded.clips.find(entry => entry.name === 'Lead Clip').steps[0].note).toBe(66);
  expect(reloaded.sources.find(entry => entry.id === 'sfx-1').mode).toBe('clip');
});

test('MIDI clip inspector moves focus when arp controls hide', async ({ page }) => {
  const midi = await openMidiUi(page);
  await midi.clipAddButton().click();
  await page.locator('#midiClipType').selectOption('arp');
  await expect(page.locator('#midiClipArpPatternField')).toBeVisible();
  await page.locator('#midiClipArpPattern').focus();

  const clipId = await page.evaluate(() => window.__E2E__.midiGetProject().ui.selectedClipId);
  await page.evaluate(selectedClipId => {
    window.__E2E__.midiDispatchProjectIntent({
      type: 'clip.update',
      clipId: selectedClipId,
      patch: { type: 'stepPattern' }
    });
  }, clipId);

  await expect(page.locator('#midiClipArpPatternField')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('midiClipType');
});

test('MIDI source browser search and filters remain usable', async ({ page }) => {
  const midi = await openMidiUi(page);
  await expect(midi.sourceRows().first()).toBeVisible();

  await midi.sourceAssignFilter().selectOption('changed');
  await expect(page.locator('#midiSourceList')).toContainText('No sources match');
  await expect(page.locator('#midiSourceCount')).toHaveAttribute('aria-label', '0 sources shown');
  await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({
      type: 'source.mapping.update',
      sourceId: 'sfx-1',
      patch: { note: 91 }
    });
  });
  await expect(midi.sourceRows()).toHaveCount(1);
  await expect(page.locator('#midiSourceCount')).toHaveAttribute('aria-label', '1 source shown');
  await expect(midi.sourceRows().first()).toContainText('Changed');
  await page.locator('#midiSourceRevertButton').click();
  await expect(page.locator('#midiSourceList')).toContainText('No sources match');
  await midi.sourceAssignFilter().selectOption('all');

  await page.evaluate(() => {
    const project = window.__E2E__.midiGetProject();
    window.__E2E__.midiDispatchProjectIntent({
      type: 'project.set',
      project: {
        ...project,
        sources: [
          ...project.sources,
          {
            id: 'system-e2e-unavailable',
            kind: 'system',
            sourceKey: 'e2e-unavailable',
            label: 'E2E unavailable system',
            enabled: true,
            trackId: project.tracks[0]?.id || 'track-1',
            mode: 'direct',
            mapping: { note: 60 },
            clipId: null
          }
        ]
      }
    });
  });
  await midi.sourceAssignFilter().selectOption('available');
  const availableIds = await midi.sourceRows().evaluateAll(rows => rows.map(row => row.dataset.sourceId));
  expect(availableIds).toContain('sfx-16');
  expect(availableIds).not.toContain('system-e2e-unavailable');
  await midi.sourceAssignFilter().selectOption('all');

  await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({
      type: 'source.update',
      sourceId: 'sfx-2',
      patch: { enabled: false }
    });
  });
  await midi.sourceAssignFilter().selectOption('disabled');
  const disabledIds = await midi.sourceRows().evaluateAll(rows => rows.map(row => row.dataset.sourceId));
  expect(disabledIds).toContain('sfx-2');
  await midi.sourceAssignFilter().selectOption('enabled');
  const enabledIds = await midi.sourceRows().evaluateAll(rows => rows.map(row => row.dataset.sourceId));
  expect(enabledIds).not.toContain('sfx-2');
  await midi.sourceAssignFilter().selectOption('assigned');
  await expect(midi.sourceRows().first()).toBeVisible();
  await midi.sourceAssignFilter().selectOption('unassigned');
  await expect(page.locator('#midiSourceList')).toContainText('No sources match');
  await midi.sourceAssignFilter().selectOption('all');

  await page.locator('#midiSourceSearch').fill('skill');
  await expect(midi.sourceRows().first()).toContainText(/skill/i);
  await page.locator('#midiSourceKindFilter').selectOption('trigger');
  await expect(page.locator('#midiSourceList')).toContainText(/No sources|Trigger|MIDI_FLAG/i);
  await page.locator('#midiSourceSearch').fill('no-such-source-name');
  await expect(page.locator('#midiSourceList')).toContainText('No sources match');
});

test('MIDI source filters keep an active listbox option', async ({ page }) => {
  const midi = await openMidiUi(page);
  await page.evaluate(() => {
    const project = window.__E2E__.midiGetProject();
    window.__E2E__.midiDispatchProjectIntent({
      type: 'project.set',
      project: {
        ...project,
        sources: [
          ...project.sources,
          {
            id: 'system-e2e-unavailable',
            kind: 'system',
            sourceKey: 'e2e-unavailable',
            label: 'E2E unavailable system',
            enabled: true,
            trackId: project.tracks[0]?.id || 'track-1',
            mode: 'direct',
            mapping: { note: 60 },
            clipId: null
          }
        ],
        ui: {
          ...project.ui,
          selectedSourceId: 'system-e2e-unavailable'
        }
      }
    });
  });

  await midi.sourceAssignFilter().selectOption('available');
  await expect(midi.sourceRows().first()).toBeVisible();
  const listState = await page.evaluate(() => {
    const list = document.getElementById('midiSourceList');
    const rows = Array.from(list.querySelectorAll('.midi-source-row'));
    const activeId = list.getAttribute('aria-activedescendant');
    const active = document.getElementById(activeId);
    return {
      activeId,
      firstId: rows[0]?.id || '',
      activeTabIndex: active?.tabIndex,
      activeSelected: active?.getAttribute('aria-selected') || '',
      selectedSourceId: window.__E2E__.midiGetProject().ui.selectedSourceId
    };
  });

  expect(listState.activeId).not.toBe('');
  expect(listState.activeId).toBe(listState.firstId);
  expect(listState.activeTabIndex).toBe(0);
  expect(listState.activeSelected).toBe('false');
  expect(listState.selectedSourceId).toBe('system-e2e-unavailable');
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
  await setField('#midiGlobalVelocityMin', '20');
  await setField('#midiGlobalVelocityMax', '110');
  await setField('#midiGlobalNoteMin', '36');
  await setField('#midiGlobalNoteMax', '96');
  await setField('#midiGlobalAccent', '0.8');
  await setField('#midiGlobalDensityWindow', '12');
  await setField('#midiGlobalDurationScale', '0.25');
  await setField('#midiGlobalMaxActiveNotes', '24');
  await setField('#midiGlobalMaxEventsPerTick', '16');
  await setField('#midiGlobalEnvAttack', '1.25');
  await setField('#midiGlobalEnvRelease', '0.75');
  await page.locator('#midiGlobalViewPan').check();
  await setField('#midiGlobalPanMin', '-48');
  await setField('#midiGlobalPanMax', '48');
  await setField('#midiGlobalPanDeadZone', '0.08');
  await setField('#midiGlobalTimbreMin', '12');
  await setField('#midiGlobalTimbreMax', '100');
  await setField('#midiGlobalXNoteMin', '-18');
  await setField('#midiGlobalXNoteMax', '18');
  await page.locator('#midiEnvelopeOverrideToggle').check();
  await midi.automationAddButton().click();
  const laneLayout = await page.locator('.midi-automation-row').last().evaluate(row => {
    const children = Array.from(row.children);
    const rowRect = row.getBoundingClientRect();
    const removeRect = children[children.length - 1].getBoundingClientRect();
    return {
      childCount: children.length,
      rowHeight: rowRect.height,
      removeTopOffset: removeRect.top - rowRect.top
    };
  });
  expect(laneLayout.childCount).toBe(9);
  expect(laneLayout.removeTopOffset).toBeLessThan(laneLayout.rowHeight / 2);
  const laneA11y = await page.locator('.midi-automation-row').last().evaluate(row => ({
    role: row.getAttribute('role'),
    rowLabel: row.getAttribute('aria-label'),
    controlLabels: Array.from(row.querySelectorAll('input, select, button'))
      .map(control => control.getAttribute('aria-label') || '')
  }));
  const laneName = laneA11y.rowLabel.replace(/^Modulation lane /, '');
  expect(laneA11y.role).toBe('group');
  expect(laneA11y.rowLabel).toBe(`Modulation lane ${laneName}`);
  expect(laneA11y.controlLabels).toEqual(expect.arrayContaining([
    `Enable modulation lane ${laneName}`,
    `${laneName} target`,
    `${laneName} axis`,
    `${laneName} operator`,
    `${laneName} minimum`,
    `${laneName} maximum`,
    `${laneName} point beat`,
    `${laneName} point value`,
    `Remove modulation lane ${laneName}`
  ]));
  await page.locator('.midi-automation-axis-op').last().selectOption('mul');
  await midi.automationPointBeatFields().last().evaluate(element => {
    element.value = '2';
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await midi.automationPointValueFields().last().evaluate(element => {
    element.value = '0.7';
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const project = await page.evaluate(() => window.__E2E__.midiGetProject());
  const runtime = await midi.runtimeConfig();
  expect(project.tracks[0].velocityScale).toBe(0.5);
  expect(project.global.velocityRange).toMatchObject({ default: 96, min: 20, max: 110 });
  expect(project.global.noteRange).toMatchObject({ min: 36, max: 96 });
  expect(project.global.density).toMatchObject({ velocityBoost: 0.8, windowTicks: 12, durationScale: 0.25 });
  expect(project.global.limits).toMatchObject({ maxActiveNotes: 24, maxEventsPerTick: 16 });
  expect(project.global.envelope).toMatchObject({ attack: 1.25, release: 0.75 });
  expect(project.global.position.viewPan).toBe(true);
  expect(project.global.position.panRange).toMatchObject({ min: -48, max: 48 });
  expect(project.global.position.panDeadZonePct).toBe(0.08);
  expect(project.global.position.timbreRange).toMatchObject({ min: 12, max: 100 });
  expect(project.global.position.xNoteRange).toMatchObject({ min: -18, max: 18 });
  expect(project.sources.find(source => source.id === 'sfx-1').mapping.envelope).toMatchObject({
    attack: 1,
    decay: 0,
    sustain: 1,
    release: 1
  });
  expect(project.automation.length).toBeGreaterThan(automationCount);
  expect(project.automation.at(-1).axisOp).toBe('mul');
  expect(project.automation.at(-1).points[0]).toEqual({ beat: 2, value: 0.7 });
  expect(runtime.position.mappings.at(-1).points).toEqual([{ beat: 2, value: 0.7 }]);

  await midi.automationRemoveButtons().last().click();
  await expect(midi.automationRows()).toHaveCount(automationCount);
  const afterRemove = await page.evaluate(() => window.__E2E__.midiGetProject());
  expect(afterRemove.automation.length).toBe(automationCount);
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
  await expect(midi.conflictRows().first()).toHaveAttribute('aria-label', /Duplicate runtime key/);
  await expect(midi.conflictSummary()).toContainText('Duplicate runtime key');

  await midi.sourceAssignFilter().selectOption('clean');
  await expect(midi.conflictRows()).toHaveCount(0);
  await midi.sourceAssignFilter().selectOption('conflicts');
  expect(await midi.conflictBadges().count()).toBeGreaterThanOrEqual(2);
  await expect(midi.conflictRows().first()).toHaveAttribute('aria-label', /Duplicate runtime key/);
});

test('MIDI sequencer listboxes support keyboard navigation', async ({ page }) => {
  await openMidiUi(page);
  const optionId = (kind, id) => `midi-${kind}-option-${String(id).replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
  const visibleSources = await page.locator('#midiSourceList .midi-source-row').evaluateAll(rows => rows.map(row => row.dataset.sourceId));
  expect(visibleSources.length).toBeGreaterThan(1);

  await page.locator('#midiSourceList').focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => window.__E2E__.midiGetProject().ui.selectedSourceId)).toBe(visibleSources[1]);
  await expect(page.locator('#midiSourceList')).toHaveAttribute('aria-activedescendant', optionId('source', visibleSources[1]));

  await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({ type: 'track.add', track: { id: 'keys', name: 'Keys', channel: 2 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'track.add', track: { id: 'pad', name: 'Pad', channel: 3 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'track.select', trackId: 'track-1' });
  });
  await page.locator('#midiTrackList').focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => window.__E2E__.midiGetProject().ui.selectedTrackId)).toBe('pad');
  await expect(page.locator('#midiTrackList')).toHaveAttribute('aria-activedescendant', 'midi-track-option-pad');

  await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 4 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.add', clip: { id: 'fill', name: 'Fill', lengthSteps: 4 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.select', clipId: 'riff' });
  });
  await page.locator('#midiClipList').focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => window.__E2E__.midiGetProject().ui.selectedClipId)).toBe('fill');
  await expect(page.locator('#midiClipList')).toHaveAttribute('aria-activedescendant', 'midi-clip-option-fill');
});

test('MIDI step grid keyboard navigation preserves the edited field', async ({ page }) => {
  await openMidiUi(page);
  await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.add', clip: { id: 'grid-clip', name: 'Grid Clip', lengthSteps: 8 } });
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.select', clipId: 'grid-clip' });
  });
  const activeStep = () => page.evaluate(() => {
    const element = document.activeElement;
    return {
      className: element?.className || '',
      stepIndex: element?.dataset?.stepIndex || '',
      label: element?.getAttribute?.('aria-label') || ''
    };
  });

  await page.locator('.midi-step-note[data-step-index="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(activeStep).toMatchObject({ className: 'midi-step-note', stepIndex: '1' });
  await page.keyboard.press('ArrowDown');
  await expect.poll(activeStep).toMatchObject({ className: 'midi-step-note', stepIndex: '5' });
  await page.keyboard.press('End');
  await expect.poll(activeStep).toMatchObject({ className: 'midi-step-note', stepIndex: '7', label: 'Step 8 note' });

  await page.locator('.midi-step-probability[data-step-index="3"]').focus();
  await page.keyboard.press('Home');
  await expect.poll(activeStep).toMatchObject({ className: 'midi-step-probability', stepIndex: '0', label: 'Step 1 probability' });
  await setFieldValue(page, '.midi-step-probability[data-step-index="0"]', '0.25');
  await expect.poll(activeStep).toMatchObject({ className: 'midi-step-probability', stepIndex: '0', label: 'Step 1 probability' });
});

test('MIDI step grid supports rest controls', async ({ page }) => {
  await openMidiUi(page);
  await page.evaluate(() => {
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.add', clip: { id: 'rest-clip', name: 'Rest Clip', lengthSteps: 4 } });
    window.__E2E__.midiDispatchProjectIntent({
      type: 'clip.step.update',
      clipId: 'rest-clip',
      stepIndex: 0,
      patch: {
        note: 72,
        velocity: 96,
        durationTicks: 12,
        probability: 0.5,
        hold: true,
        tie: true
      }
    });
    window.__E2E__.midiDispatchProjectIntent({ type: 'clip.select', clipId: 'rest-clip' });
  });

  const restButton = page.locator('.midi-step-rest[data-step-index="0"]');
  await expect(restButton).toHaveAttribute('aria-label', 'Step 1 rest');
  await restButton.click();

  const step = await page.evaluate(() => {
    const clip = window.__E2E__.midiGetProject().clips.find(entry => entry.id === 'rest-clip');
    return clip.steps[0];
  });
  expect(step).toMatchObject({
    index: 0,
    note: null,
    velocity: null,
    durationTicks: null,
    probability: 1,
    hold: false,
    tie: false
  });
  await expect(page.locator('.midi-step-note[data-step-index="0"]')).toHaveValue('');
  await expect(page.locator('.midi-step-velocity[data-step-index="0"]')).toHaveValue('');
  await expect(page.locator('.midi-step-duration[data-step-index="0"]')).toHaveValue('');
  await expect(page.locator('.midi-step-hold[data-step-index="0"]')).not.toBeChecked();
  await expect(page.locator('.midi-step-tie[data-step-index="0"]')).not.toBeChecked();
});

test('MIDI E2E helpers expose runtime config and UI metrics', async ({ page }) => {
  const midi = await openMidiUi(page);
  const before = await midi.uiMetrics();

  await setFieldValue(page, '#midiMappingNote', 77);

  const after = await midi.uiMetrics();
  const runtime = await midi.runtimeConfig();
  expect(before).toMatchObject({
    renderCount: expect.any(Number),
    queuedRenderCount: expect.any(Number),
    lastRenderDurationMs: expect.any(Number)
  });
  expect(after.renderCount).toBeGreaterThan(before.renderCount);
  expect(after.lastRenderDurationMs).toBeGreaterThanOrEqual(0);
  expect(runtime.sfx['1']).toMatchObject({ note: 77, trackId: 'track-1' });
});

test('MIDI sequencer layout avoids horizontal overflow at desktop, tablet, and phone sizes', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 820, height: 1180 },
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
    const stack = await page.evaluate(() => ({
      sequencer: Number(window.getComputedStyle(document.getElementById('midiSequencerWorkspace')).zIndex),
      previous: Number(window.getComputedStyle(document.getElementById('levelPrevButton')).zIndex),
      next: Number(window.getComputedStyle(document.getElementById('levelNextButton')).zIndex)
    }));
    expect(stack.sequencer).toBeGreaterThan(stack.previous);
    expect(stack.sequencer).toBeGreaterThan(stack.next);
  }
});
