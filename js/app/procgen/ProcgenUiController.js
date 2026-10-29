import { getProcgenCommandDispatcher } from '../controls/ProcgenCommandDispatcher.js';
import { createProcgenMidiSpanOverlay } from './ProcgenMidiSpanOverlay.js';
import { createProcgenMusicControls } from './ProcgenMusicControls.js';
import { procgenMusicDefaults, procgenMusicState, editProcgenMusicProject } from './ProcgenMusicProject.js';
import { createProcgenMidiSpanControls } from './ProcgenMidiSpanControls.js';
import { createMidiEditHistory } from '../midi-ui/midiEditHistory.js';
import { loadProcgenAutomation, saveProcgenAutomation } from './ProcgenAutomationStorage.js';
import { createMidiTensionControls } from '../midi-ui/midiTensionControls.js';
import { createMidiMusicDirectionControls } from '../midi-ui/midiMusicDirectionControls.js';
import { createMidiOutputCapture } from '../../midi/capture/MidiOutputCapture.js';
import { createMidiCaptureControls } from '../midi-ui/midiCaptureControls.js';
import { DECORATION_CHOICES } from '../../decorations/ProcgenDecorationPacks.js';
import { createCharacterUiController, mountCharacterControls } from '../characterUiController.js';
import { createProcgenMidiOutput } from './ProcgenMidiOutput.js';
import { createLocalGamePreview } from '../midi-ui/localGamePreview.js';
import { createMidiProjectFromMidiConfig, projectToMidiConfig, reduceMidiProject, sanitizeMidiProject, isCanonicalMidiProject, sameMidiRuntimeInputs } from '../../midi/project/MidiProject.js';
import { PROCGEN_GAME_EVENT_MIDI_PRESETS, applyProcgenGameEventMidiPreset, getProcgenSpawnPriority, setProcgenSpawnPriority, getProcgenMusicBeatTicks } from '../../midi/project/ProcgenMidiDefaults.js';
import { normalizeLaneCount, normalizeLaneHeight, DEFAULT_LANE_HEIGHT, normalizePopulationPolicy } from './ProcgenLaneWorld.js';
import { normalizeWorkerLimits } from './ProcgenWorkerLimits.js';
import { DEFAULT_KEYBINDINGS } from '../../input/KeybindingRegistry.js';
import { loadDeferredWebMidi } from './DeferredWebMidi.js';
import { normalizeProcgenSpeed, changeProcgenSpeed, renderProcgenSpeedControl } from './ProcgenSpeedControl.js';
import { normalizeSeed } from '../../core/seededRandom.js';
import { readProcgenUrlConfig, createProcgenRecipeShareDescriptor } from './ProcgenUrlConfig.js';

const createProcgenUiController = ({ document, window, getRuntime, restart, resourceBudget = null, initial = {} }) => {
  const byId = id => document.getElementById(id);
  const listeners = [];
  const projectListeners = new Set();
  const listen = (target, event, handler, options) => { target?.addEventListener(event, handler, options); listeners.push([target, event, handler, options]); };
  const urlConfig = readProcgenUrlConfig(window?.location?.search);
  const laneStorageKey = 'lemmings.procgen.lanes.v1';
  let preferredLanes = 8;
  try {
    const stored = JSON.parse(window.localStorage?.getItem(laneStorageKey) || 'null');
    if (stored?.version === 1 && Number.isInteger(stored.value) && stored.value >= 1 && stored.value <= 1024) preferredLanes = stored.value;
  } catch { /* Start with eight lanes. */ }
  const heightKey = 'lemmings.procgen.laneHeight.v1';
  let preferredHeight = DEFAULT_LANE_HEIGHT;
  try { const stored = JSON.parse(window.localStorage?.getItem(heightKey) || 'null'); if (stored?.version === 1) preferredHeight = normalizeLaneHeight(stored.value, DEFAULT_LANE_HEIGHT); } catch { /* Keep physical default. */ }
  const musicKey = 'lemmings.procgen.music.v1';
  let musicPreference = {};
  try { const stored = JSON.parse(window.localStorage?.getItem(musicKey) || 'null'); if (stored?.version === 1 && PROCGEN_GAME_EVENT_MIDI_PRESETS.some(p => p.id === stored.preset)) musicPreference = { preset: stored.preset, mode: stored.mode === 'phrase' ? 'phrase' : 'steps' }; } catch { /* Keep original favorite default. */ }
  const initialLanes = String(initial.laneCount ?? '').trim();
  const settings = { laneCount: initialLanes && Number.isFinite(Number(initialLanes)) ? normalizeLaneCount(initialLanes) : preferredLanes, speed: normalizeProcgenSpeed(initial.speed), pack: [1, 2, 3, 4, 5, 6].includes(Number(initial.pack)) ? Number(initial.pack) : 1,
    laneHeight: preferredHeight,
    preset: 'game-iron-ensemble', mode: 'steps', decoration: 'none', ...musicPreference, ...urlConfig.settings, ...(urlConfig.seed != null ? { seed: urlConfig.seed } : {}) };
  const tensionStorageKey = 'lemmings.procgen.ensembleTension.v1';
  let tensionPreferences = null;
  try { const stored = JSON.parse(window.localStorage?.getItem(tensionStorageKey) || 'null'); if (stored?.version === 1 && stored.value && typeof stored.value === 'object') tensionPreferences = stored.value; } catch { /* Keep the preset defaults. */ }
  let project = applyProcgenGameEventMidiPreset(createMidiProjectFromMidiConfig({ enabled: false, sfx: {}, triggers: {} }), settings.preset);
  const workerStorageKey = 'lemmings.procgen.workerLimits.v1';
  settings.workerLimits = normalizeWorkerLimits();
  const populationKey = 'lemmings.procgen.population.v1', priorityKey = 'lemmings.procgen.spawnPriority.v1';
  settings.populationPolicy = normalizePopulationPolicy();
  let savedPriority;
  try { const stored = JSON.parse(window.localStorage?.getItem(populationKey) || 'null'); if (stored?.version === 1) settings.populationPolicy = normalizePopulationPolicy(stored.value); } catch { /* Keep defaults. */ }
  try { const stored = JSON.parse(window.localStorage?.getItem(priorityKey) || 'null'); if (stored?.version === 1 && Number.isFinite(stored.value)) savedPriority = stored.value; } catch { /* Keep defaults. */ }
  if (savedPriority !== undefined) project = setProcgenSpawnPriority(project, savedPriority);
  const automationStorage = () => { try { return window.localStorage; } catch { return null; } };
  project = loadProcgenAutomation(automationStorage(), project);
  const restoredMusic = !!project.global.laneMusic;
  if (!restoredMusic) {
    project = applyProcgenGameEventMidiPreset(project, settings.preset, { mode: settings.mode });
    if (savedPriority !== undefined) project = setProcgenSpawnPriority(project, savedPriority);
    if (project.ensemble && tensionPreferences) project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch: tensionPreferences });
    project = sanitizeMidiProject({ ...project, global: { ...project.global, laneMusic: procgenMusicDefaults(project, settings) } });
  }
  settings.preset = project.global.laneMusic.defaultSchemeId || settings.preset; settings.mode = project.global.laneMusic.mode;
  try { const stored = JSON.parse(window.localStorage?.getItem(workerStorageKey) || 'null'); if (stored?.version === 1) settings.workerLimits = normalizeWorkerLimits(stored.value); } catch { /* Keep session defaults. */ }
  let config = projectToMidiConfig(project), disposed = false;
  let syncTargetHelp = () => {};
  let physicalControlOwner = null, operationalMetrics = null;
  const needsMidiDiscovery = state => state.selectedBackend === 'midi' && (state.midiPermission !== 'granted' || !state.selectedOutputId || ['destination-missing', 'permission-revoked'].includes(state.failureKind));
  const renderOutput = state => {
    syncTargetHelp();
    const button = byId('procgenListen'), midi = state.selectedBackend === 'midi';
    const discover = needsMidiDiscovery(state);
    if (button) { button.dataset.outputAction = state.enabled || ['starting', 'discovering'].includes(state.status) ? 'stop' : discover ? 'discover' : midi ? 'activate' : 'listen'; button.textContent = state.enabled || ['starting', 'discovering'].includes(state.status) ? state.status === 'discovering' ? 'Cancel discovery' : midi ? 'Deactivate MIDI output' : 'Disable browser output' : midi ? discover ? 'Discover MIDI outputs' : 'Activate MIDI output' : 'Listen locally'; button.setAttribute('aria-pressed', String(state.enabled)); }
    if (button && (!midi || !discover) && (state.performanceLease || state.audio?.performanceLease)?.status === 'busy') { button.dataset.outputAction = 'takeover'; button.textContent = midi ? 'Take over MIDI output' : 'Take over browser output'; }
    if (byId('procgenAudioStatus')) byId('procgenAudioStatus').textContent = state.message + (!midi && settings.soundFont ? ' Requested sample bank is unavailable; using the browser synth.' : '');
    if (byId('procgenMasterVolume')) byId('procgenMasterVolume').disabled = midi;
    if (byId('procgenMidiDevice')) byId('procgenMidiDevice').hidden = !midi;
  };
  let local;
  const preview = createLocalGamePreview({ getLemmings: () => getRuntime()?.view, getConfig: () => config, immutableConfig: true, resourceBudget,
    onStateChange: () => local?.localStateChanged() });
  local = createProcgenMidiOutput({ local: preview, resourceBudget, getView: () => getRuntime()?.view, getConfig: () => config, getWebMidi: () => window.WebMidi, loadWebMidi: () => loadDeferredWebMidi({ document, window }),
    backend: settings.output, canActivate: () => physicalControlOwner?.canActivateOutput?.() ?? true, onStateChange: state => { renderOutput(state); physicalControlOwner?.outputChanged?.(); }, onDevicesChange: (ports, selectedId) => {
      const select = byId('procgenMidiDevice'); if (!select) return;
      select.replaceChildren(); const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = ports.length ? 'Choose MIDI output' : 'Connect to find MIDI outputs'; select.append(placeholder);
      for (const port of ports) { const option = document.createElement('option'); option.value = port.id; option.textContent = port.name ? port.name + ' · ' + port.id : port.id; select.append(option); }
      select.value = selectedId || '';
    } });
  if (byId('procgenOutput')) byId('procgenOutput').value = settings.output || 'synth';
  listen(byId('procgenOutput'), 'change', event => { settings.output = event.target.value; local.setBackend(settings.output); });
  listen(byId('procgenMidiDevice'), 'change', event => local.setOutputId(event.target.value));
  renderOutput(local.getState());
  const outputCapture = createMidiOutputCapture();
  const captureControls = createMidiCaptureControls({ document, window, capture: outputCapture, prefix: 'procgenCapture', inspect: () => local.getState().backend === 'local-browser-audio' ? local.audio.inspectRender?.() : null,
    attach: capture => local.setCapture(capture),
    getMetadata: () => {
      const runtime = getRuntime(), timer = runtime?.game?.getGameTimer?.();
      return { backend: local.getState().backend, outputId: local.getState().outputId, outputName: local.getState().outputName, seed: runtime?.world?.seed ?? settings.seed, generation: runtime?.world?.generation,
        tempoBpm: project.transport.bpmBase, speed: timer?.speedFactor, frameMs: timer?.frameTime, scale: project.global.scale,
        settingsReference: { localMasterGain: local.audio.getState().masterVolume, preset: settings.preset, mode: settings.mode, laneCount: settings.laneCount, pack: settings.pack,
          tracks: project.tracks.slice(0, 16).map(track => ({ id: track.id, channel: track.channel, program: track.program })), ensemble: project.ensemble, laneMusic: project.global.laneMusic },
        limits: { capacity: outputCapture.capacity, maxDurationMs: outputCapture.maxDurationMs } };
    } });
  const tensionControls = createMidiTensionControls({ document, prefix: 'procgenTension', getOperationalMetrics: () => operationalMetrics,
    getProject: () => project,
    getRouter: () => getRuntime()?.view?.midiPreviewRouter, getLaneCount: () => settings.laneCount,
    update: patch => {
      commitAutomation(reduceMidiProject(project, { type: 'ensemble.tension.update', patch }));
      tensionPreferences = project.ensemble?.tension;
      try { window.localStorage?.setItem(tensionStorageKey, JSON.stringify({ version: 1, value: tensionPreferences })); } catch { /* Keep the session choice. */ }
    } });
  const automationHistory = createMidiEditHistory();
  let automationStatus = '', musicDirection = null, musicControls = null;
  const syncMusic = () => {
    settings.preset = project.global.laneMusic?.defaultSchemeId || settings.preset; settings.mode = project.global.laneMusic?.mode || settings.mode;
    if (byId('procgenPreset')) byId('procgenPreset').value = settings.preset;
    if (byId('procgenPhrases')) byId('procgenPhrases').checked = settings.mode === 'phrase';
    const scheme = PROCGEN_GAME_EVENT_MIDI_PRESETS.find(p => p.id === settings.preset);
    if (byId('procgenPresetDescription')) byId('procgenPresetDescription').textContent = (scheme?.description || '') + (scheme?.percussion ? ' Event-driven drums; phrase mode applies to melodic schemes.' : '');
    musicControls?.sync(); tensionControls.sync();
  };
  const syncAutomationHistory = () => {
    const state = automationHistory.state();
    if (byId('procgenSpanUndo')) byId('procgenSpanUndo').disabled = !state.canUndo;
    if (byId('procgenSpanRedo')) byId('procgenSpanRedo').disabled = !state.canRedo;
    if (byId('procgenSpanHistoryStatus')) byId('procgenSpanHistoryStatus').textContent = automationStatus;
  };
  const commitAutomation = (next, record = true, persist = true) => {
    next = isCanonicalMidiProject(next) ? next : sanitizeMidiProject(next);
    const runtimeUnchanged = sameMidiRuntimeInputs(project, next);
    if (record) automationHistory.record(project, next);
    project = next;
    if (!runtimeUnchanged) {
      config = projectToMidiConfig(project); local.syncConfig(); spanControls.render(); spanOverlay.changed(); musicDirection?.sync(); syncMusic(); syncPopulation();
    }
    if (persist) automationStatus = saveProcgenAutomation(automationStorage(), project) ? '' : 'Music edits kept for this session; browser storage is unavailable.';
    syncAutomationHistory();
    for (const listener of projectListeners) listener(project);
  };
  const dispatchAutomation = intent => commitAutomation(reduceMidiProject(project, intent));
  const spanControls = createProcgenMidiSpanControls({ document, getOperationalMetrics: () => operationalMetrics,
    getProject: () => project, getLaneCount: () => settings.laneCount,
    getRouter: () => getRuntime()?.view?.midiPreviewRouter,
    getBackend: () => local.getState().selectedBackend === 'midi' ? 'midi' : 'synth',
    onSelect: (id, ids) => spanOverlay.select(id, ids), onIntent: dispatchAutomation });
  const spanOverlay = createProcgenMidiSpanOverlay({ document, getRuntime, getOperationalMetrics: () => operationalMetrics,
    getProject: () => project,
    getDomain: () => byId('procgenSpanDomain')?.value || 'beats', getTarget: () => byId('procgenSpanTarget')?.value || 'velocity',
    onUpdate: (automationId, patch) => dispatchAutomation({ type: 'automation.update', automationId, patch }),
    onBatchUpdate: updates => dispatchAutomation({ type: 'automation.batch.update', updates }),
    onStatus: message => { automationStatus = message; syncAutomationHistory(); },
    onPresentation: () => syncSpanTool(),
    onAdd: (span, target) => spanControls.addSpan(span, target), onSelect: (id, options) => { spanControls.select(id, options); setOpen(true); } });
  const restoreAutomation = action => {
    spanOverlay.cancelDraft();
    automationHistory[action](project, next => commitAutomation(next, false)); syncAutomationHistory();
  };
  listen(byId('procgenSpanUndo'), 'click', () => restoreAutomation('undo'));
  listen(byId('procgenSpanRedo'), 'click', () => restoreAutomation('redo')); syncAutomationHistory();
  musicDirection = createMidiMusicDirectionControls({ document, prefix: 'procgenMusic', getOperationalMetrics: () => operationalMetrics,
    getProject: () => project,
    getRouter: () => getRuntime()?.view?.midiPreviewRouter,
    update: musicDirector => dispatchAutomation({ type: 'global.update', patch: { musicDirector } }) });
  musicControls = createProcgenMusicControls({ document, getState: () => procgenMusicState(project, settings),
    onChange: command => commitAutomation(editProcgenMusicProject(project, settings, command)) });
  syncTargetHelp = () => spanControls.syncTargetHelp();
  function syncSpanTool() {
    const control = byId('procgenSpanEdit'), visibleControl = byId('procgenSpanVisible'), status = byId('procgenSpanToolStatus');
    const reason = spanOverlay.presentationStatus(), presentation = spanOverlay.snapshot();
    if (control) { control.disabled = !presentation.presented; control.checked = presentation.editing; }
    if (visibleControl) { visibleControl.disabled = !presentation.presentationSupported; visibleControl.checked = presentation.visible; }
    if (status && status.textContent !== reason) status.textContent = reason;
  }
  const setSpanEditing = enabled => {
    const active = spanOverlay.setEditing(enabled);
    if (active) setNukeArmed(false);
    syncSpanTool();
    if (active && byId('procgenSpanVisible')) byId('procgenSpanVisible').checked = true;
  };
  listen(byId('procgenSpanEdit'), 'change', event => setSpanEditing(event.target.checked));
  listen(byId('procgenSpanVisible'), 'change', event => { spanOverlay.setVisible(event.target.checked); syncSpanTool(); });
  const syncWorkerLimits = () => {
    getRuntime()?.world?.setWorkerLimits?.(settings.workerLimits);
    for (const [key, suffix] of [['bashers', 'Bashers'], ['diggers', 'Diggers'], ['builders', 'Builders']]) if (byId('procgenWorker' + suffix)) byId('procgenWorker' + suffix).value = String(settings.workerLimits[key]);
  };
  for (const [key, suffix] of [['bashers', 'Bashers'], ['diggers', 'Diggers'], ['builders', 'Builders']]) listen(byId('procgenWorker' + suffix), 'change', event => {
    if (!String(event.target.value).trim() || !Number.isFinite(Number(event.target.value))) { syncWorkerLimits(); return; }
    settings.workerLimits = normalizeWorkerLimits({ ...settings.workerLimits, [key]: event.target.value }); syncWorkerLimits();
    try { window.localStorage?.setItem(workerStorageKey, JSON.stringify({ version: 1, value: settings.workerLimits })); } catch { /* Keep the session choice. */ }
  });
  const syncPopulation = () => {
    settings.populationPolicy = normalizePopulationPolicy({ spawnBeatTicks: getProcgenMusicBeatTicks(project, getRuntime()?.world?.getGameTimer?.().TIME_PER_FRAME_MS || 60) }, settings.populationPolicy);
    getRuntime()?.world?.setPopulationPolicy?.(settings.populationPolicy);
    for (const [key, id] of [['scoutsEvery', 'procgenScoutsEvery'], ['scoutDelayTicks', 'procgenScoutDelay'], ['spawnSpreadTicks', 'procgenSpawnSpread']]) if (byId(id)) byId(id).value = settings.populationPolicy[key];
    if (byId('procgenSpawnPriority')) byId('procgenSpawnPriority').value = getProcgenSpawnPriority(project);
  };
  for (const [key, id] of [['scoutsEvery', 'procgenScoutsEvery'], ['scoutDelayTicks', 'procgenScoutDelay'], ['spawnSpreadTicks', 'procgenSpawnSpread']]) listen(byId(id), 'change', event => {
    if (!String(event.target.value).trim() || !Number.isFinite(Number(event.target.value))) { syncPopulation(); return; }
    settings.populationPolicy = normalizePopulationPolicy({ [key]: event.target.value }, settings.populationPolicy); syncPopulation();
    try { window.localStorage?.setItem(populationKey, JSON.stringify({ version: 1, value: settings.populationPolicy })); } catch { /* Keep live settings. */ }
  });
  listen(byId('procgenSpawnPriority'), 'change', event => {
    if (!String(event.target.value).trim() || !Number.isFinite(Number(event.target.value))) { syncPopulation(); return; }
    commitAutomation(setProcgenSpawnPriority(project, Number(event.target.value))); savedPriority = getProcgenSpawnPriority(project);
    try { window.localStorage?.setItem(priorityKey, JSON.stringify({ version: 1, value: savedPriority })); } catch { /* Keep live setting. */ }
  });
  const panel = byId('procgenDrawer'), tab = byId('procgenTab');
  const setOpen = open => {
    if (!panel || !tab) return;
    panel.classList.toggle('is-open', open); byId('procgenPanel')?.classList.toggle('is-open', open); panel.inert = !open;
    tab.setAttribute('aria-expanded', String(open)); tab.textContent = open ? 'Close workspace' : 'Music & world';
    tab.setAttribute('aria-label', open ? 'Hide music and world controls' : 'Show music and world controls'); tab.title = tab.getAttribute('aria-label');
    if (!open && panel.contains(document.activeElement)) tab.focus();
  };
  let dragStart = null, pulledOpen = false;
  listen(tab, 'pointerdown', event => { dragStart = event.clientY; pulledOpen = false; });
  listen(tab, 'pointercancel', () => { dragStart = null; pulledOpen = false; });
  listen(tab, 'pointerup', event => { if (dragStart != null && event.clientY - dragStart > 15) { setOpen(true); pulledOpen = true; } dragStart = null; });
  listen(tab, 'click', event => {
    if (pulledOpen) { pulledOpen = false; return; }
    const open = tab.getAttribute('aria-expanded') !== 'true'; setOpen(open);
    if (open && event.detail === 0) byId('procgenPreset')?.focus();
  });
  const isEditing = event => event.target?.isContentEditable || ['TEXTAREA', 'SELECT'].includes(event.target?.tagName) || (event.target?.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(event.target.type || 'text'));
  listen(document, 'keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && event.target?.tagName !== 'SELECT' && !document.querySelector?.('dialog[open]') &&
        !event.composedPath?.().some(node => node?.tagName === 'DIALOG' && node.open)) { setOpen(false); setSpanEditing(false); setNukeArmed(false); }
  });
  const seedControls = byId('procgenSeedControls');
  listen(document, 'pointerdown', event => {
    if (seedControls?.open && !seedControls.contains(event.target)) seedControls.open = false;
  });
  listen(seedControls, 'keydown', event => {
    if (event.key === 'Escape') {
      seedControls.open = false; seedControls.querySelector?.('summary')?.focus();
      event.preventDefault?.(); event.stopPropagation?.();
    }
  });
  setOpen(false);
  const showHelp = () => {
    updateShortcutHints(); setOpen(true); const help = byId('procgenHelpFields');
    if (help) { help.open = true; if (panel) panel.scrollTop = help.offsetTop || 0; help.querySelector?.('summary')?.focus({ preventScroll: true }); }
  };
  listen(byId('procgenHelp'), 'click', showHelp);
  const charactersHost = byId('procgenCharacters');
  if (charactersHost) mountCharacterControls(document, charactersHost);
  const characters = createCharacterUiController({ document, window, getView: () => getRuntime()?.view,
    defaults: { shape: 'mixed', bodyColor: 'random' }, initial: urlConfig.appearance });
  characters.bind();
  const fill = (id, choices, value) => {
    const select = byId(id); if (!select) return;
    for (const [value, label] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option); }
    select.value = String(value);
  };
  fill('procgenDecoration', DECORATION_CHOICES.map(choice => [choice.id, choice.label]), settings.decoration);
  fill('procgenPreset', PROCGEN_GAME_EVENT_MIDI_PRESETS.map(preset => [preset.id, preset.label]), settings.preset);
  fill('procgenPack', [[1, 'Lemmings'], [2, 'Oh No! More Lemmings'], [3, 'Xmas 1991'], [4, 'Xmas 1992'], [5, 'Holiday 1993'], [6, 'Holiday 1994']], settings.pack);
  if (byId('procgenSpeed')) byId('procgenSpeed').value = settings.speed;
  if (byId('procgenPhrases')) byId('procgenPhrases').checked = settings.mode === 'phrase';
  if (byId('procgenLanes')) byId('procgenLanes').value = settings.laneCount;
  const refreshPreset = ({ replaceRollingDefaults = false } = {}) => {
    const preset = byId('procgenPreset').value, mode = byId('procgenPhrases')?.checked ? 'phrase' : 'steps';
    let next = applyProcgenGameEventMidiPreset(project, preset, { mode, replaceRollingDefaults });
    next = sanitizeMidiProject({ ...next, global: { ...next.global,
      ...(project.global.laneMusic?.pitchEnabled ? { scale: project.global.scale } : {}),
      laneMusic: { ...project.global.laneMusic, referenceRoot: next.global.scale.root, defaultSchemeId: preset, mode } } });
    commitAutomation(next);
    try { window.localStorage?.setItem(musicKey, JSON.stringify({ version: 1, preset: settings.preset, mode: settings.mode })); } catch { /* Keep session palette. */ }
  };
  listen(byId('procgenPreset'), 'change', () => refreshPreset({ replaceRollingDefaults: true })); listen(byId('procgenPhrases'), 'change', () => refreshPreset()); syncMusic();
  listen(byId('procgenListen'), 'click', () => {
    const state = local.getOperationalState();
    if (state.enabled || ['starting', 'discovering'].includes(state.status)) return local.stop();
    if (needsMidiDiscovery(state)) return local.discover();
    if ((state.performanceLease || state.audio?.performanceLease)?.status === 'busy') return local.takeOverPerformance();
    return local.start();
  });
  let restartId = 0;
  const doRestart = async ({ applySeed = false } = {}) => {
    if (physicalControlOwner?.canRestart && !physicalControlOwner.canRestart()) return false;
    const id = ++restartId;
    spanOverlay.cancelDraft();
    const seed = byId('procgenSeed')?.value?.trim();
    if (applySeed && seed) settings.seed = normalizeSeed(seed);
    settings.camera = camera()?.getState?.();
    const listening = local.suspendGame();
    if (byId('procgenRunStatus')) byId('procgenRunStatus').textContent = 'Loading…';
    try { await restart(); if (listening && !disposed && id === restartId) await local.resumeGame(); } catch (error) { if (!disposed && id === restartId && byId('procgenRunStatus')) byId('procgenRunStatus').textContent = `Could not start: ${error.message}`; }
  };
  listen(byId('procgenRestart'), 'click', () => doRestart({ applySeed: true }));
  listen(byId('procgenNewSeed'), 'click', () => {
    const bytes = new Uint32Array(1); window.crypto?.getRandomValues?.(bytes);
    settings.seed = normalizeSeed(bytes[0] || Date.now());
    if (byId('procgenSeed')) byId('procgenSeed').value = String(settings.seed);
    doRestart();
  });
  listen(byId('procgenSeed'), 'keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); if (!event.repeat) doRestart({ applySeed: true }); } });
  const volumeKey = 'lemmings.midi.masterVolume';
  let storedVolume; try { storedVolume = JSON.parse(window.localStorage?.getItem(volumeKey) || 'null'); } catch { /* Use the quiet default. */ }
  const setVolume = (value, persist = true) => {
    const master = local.audio.setMasterVolume(value);
    if (byId('procgenMasterVolume')) byId('procgenMasterVolume').value = String(Math.round(master * 100));
    if (byId('procgenMasterVolumeValue')) byId('procgenMasterVolumeValue').textContent = Math.round(master * 100) + '%';
    if (persist) try { window.localStorage?.setItem(volumeKey, JSON.stringify({ version: 2, value: master })); } catch { /* Keep session gain. */ }
  };
  setVolume(typeof storedVolume === 'number' ? Math.max(0, Math.min(1, storedVolume)) : storedVolume?.version === 2 ? storedVolume.value : 0.7, false);
  listen(byId('procgenMasterVolume'), 'input', event => setVolume(Number(event.target.value) / 100));
  listen(byId('procgenMasterVolume'), 'contextmenu', event => { event.preventDefault?.(); setVolume(1); });
  listen(byId('procgenPanic'), 'click', () => local.panic());
  listen(byId('procgenLanes'), 'change', () => {
    const input = byId('procgenLanes'), value = String(input.value).trim();
    if (!value || !Number.isFinite(Number(value))) { input.value = settings.laneCount; return; }
    settings.laneCount = normalizeLaneCount(value); input.value = settings.laneCount;
    try { window.localStorage?.setItem(laneStorageKey, JSON.stringify({ version: 1, value: settings.laneCount })); } catch { /* Keep the session choice. */ }
    doRestart();
  });
  if (byId('procgenLaneHeight')) byId('procgenLaneHeight').value = settings.laneHeight;
  listen(byId('procgenLaneHeight'), 'change', event => {
    if (!String(event.target.value).trim() || !Number.isFinite(Number(event.target.value))) { event.target.value = settings.laneHeight; return; }
    settings.laneHeight = normalizeLaneHeight(event.target.value, settings.laneHeight); event.target.value = settings.laneHeight;
    try { window.localStorage?.setItem(heightKey, JSON.stringify({ version: 1, value: settings.laneHeight })); } catch { /* Keep session height. */ }
    doRestart();
  });
  listen(byId('procgenDecoration'), 'change', () => { settings.decoration = byId('procgenDecoration').value; doRestart(); });
  listen(byId('procgenPack'), 'change', () => { settings.pack = Number(byId('procgenPack').value); doRestart(); });
  const camera = () => getRuntime()?.lanes?.renderer?.camera;
  const panelSprites = () => getRuntime()?.lanes?.renderer?.hud?.sprites;
  const cctv = () => getRuntime()?.lanes?.renderer?.cctv;
  settings.cctvMode = 'leaders'; settings.cctvPins = []; settings.cctvEnabled = false;
  const syncCctv = state => {
    if (!state) return;
    settings.cctvMode = state.mode; settings.cctvPins = state.pins;
    if (typeof state.enabled === 'boolean') settings.cctvEnabled = state.enabled;
    if (byId('procgenCctvEnabled')) byId('procgenCctvEnabled').checked = settings.cctvEnabled;
    if (byId('procgenCctvMode')) byId('procgenCctvMode').value = state.mode;
    for (let index = 0; index < 8; index++) {
      const button = byId('procgenCctvSlot' + index), slot = state.slots[index]; if (!button) continue;
      button.hidden = state.enabled === false || !slot; if (!slot) continue;
      button.dataset.lane = slot.lane; button.disabled = state.mode !== 'director'; button.setAttribute('aria-pressed', String(slot.pinned));
      button.textContent = 'Lane ' + (slot.lane + 1) + ' / #' + slot.rank + ' / ' + slot.reason;
      button.title = slot.pinned ? 'Unpin this lane' : 'Pin this lane in Director mode';
    }
    const message = state.mode === 'director' ? state.pins.length + '/4 pinned; other views follow actual activity, with one fair rotation slot.'
      : 'Eight distance leaders. Pins are retained for Director mode.';
    if (byId('procgenCctvStatus') && byId('procgenCctvStatus').textContent !== message) byId('procgenCctvStatus').textContent = message;
  };
  listen(byId('procgenCctvEnabled'), 'change', event => { settings.cctvEnabled = event.target.checked; cctv()?.setEnabled?.(settings.cctvEnabled); syncCctv(cctv()?.getState()); });
  listen(byId('procgenCctvMode'), 'change', () => { cctv()?.setMode(byId('procgenCctvMode').value); syncCctv(cctv()?.getState()); });
  const toggleCctvPin = lane => {
    if (!cctv()?.togglePin(lane)) { if (byId('procgenCctvStatus')) byId('procgenCctvStatus').textContent = 'Choose a valid lane; unpin a lane before adding a fifth pin.'; return; }
    syncCctv(cctv().getState());
  };
  listen(byId('procgenCctvPin'), 'click', () => toggleCctvPin(Number(byId('procgenCctvLane')?.value) - 1));
  listen(byId('procgenCctvClear'), 'click', () => { cctv()?.setPins([]); syncCctv(cctv()?.getState()); });
  for (let index = 0; index < 8; index++) listen(byId('procgenCctvSlot' + index), 'click', event => toggleCctvPin(Number(event.currentTarget?.dataset.lane ?? byId('procgenCctvSlot' + index)?.dataset.lane)));

  const setSpeed = (value, { owned = false } = {}) => {
    if (!owned && physicalControlOwner?.speed) return physicalControlOwner.speed(normalizeProcgenSpeed(value, settings.speed));
    settings.speed = normalizeProcgenSpeed(value, settings.speed);
    if (byId('procgenSpeed')) byId('procgenSpeed').value = settings.speed;
    const runtime = getRuntime(); if (!owned && runtime?.view) runtime.view.gameSpeedFactor = settings.speed;
    const timer = runtime?.game?.getGameTimer?.(); if (!owned && timer) timer.speedFactor = settings.speed;
    renderProcgenSpeedControl({ document, sprites: panelSprites(), speed: settings.speed });
  };
  for (const id of ['procgenSpeed', 'procgenSpeedReadout', 'procgenSpeedDown', 'procgenSpeedUp']) listen(byId(id), 'contextmenu', event => { event.preventDefault?.(); setSpeed(1); });
  listen(byId('procgenSpeed'), 'change', () => setSpeed(byId('procgenSpeed').value));
  for (const [id, direction] of [['procgenSpeedDown', -1], ['procgenSpeedUp', 1]]) {
    listen(byId(id), 'click', event => setSpeed(changeProcgenSpeed(settings.speed, direction, { panel: true, fast: event.shiftKey })));
  }
  const commandDispatcher = getProcgenCommandDispatcher({ document, window });
  const shortcutLabel = action => {
    const label = commandDispatcher.getShortcut('world.' + action);
    return settings.workstation && ['Left', 'Right', 'Backspace', 'Delete'].includes(label) ? '' : label;
  };
  const updateShortcutHints = () => {
    if (disposed) return;
    const catalog = new Map(commandDispatcher.list().map(command => [command.id, command]));
    for (const [id, action, label] of [['procgenZoomOut', 'zoomOut', 'Zoom out'], ['procgenZoomIn', 'zoomIn', 'Zoom in'],
      ['procgenFollow', 'followFrontier', 'Follow the leading living lemming'], ['procgenPause', 'togglePause', 'Pause or play'],
      ['procgenStep', 'stepForward', 'Pause and advance one tick'], ['procgenRestart', 'restartLevel', 'Regenerate the same seed'],
      ['procgenSpeedDown', 'speedDown', 'Decrease speed'], ['procgenSpeedUp', 'speedUp', 'Increase speed'], ['procgenHelp', 'toggleShortcutOverlay', 'Shortcut reference']]) {
      const control = byId(id), command = catalog.get('world.' + action), shortcut = command?.enabled ? shortcutLabel(action) : '';
      if (control) control.title = shortcut ? `${label} (${shortcut})` : label;
    }
    const help = byId('procgenShortcutHelp');
    if (help) help.textContent = 'Drag to pan; wheel to zoom; Shift+wheel pans. Double-click follows the leading living actor. ' +
      (commandDispatcher.bindingState().ready ? [...catalog.values()].filter(command => command.id.startsWith('world.')).map(command =>
        `${command.label}: ${!command.enabled ? 'unavailable here' : shortcutLabel(command.id.slice(6)) || 'unbound'}`).join('; ') + '.' :
        'Keyboard shortcuts are loading; use the visible controls.');
  };
  let paused = false;
  const setPaused = next => {
    paused = !!next; getRuntime()?.lanes?.[paused ? 'pause' : 'resume']?.();
    if (byId('procgenPause')) { byId('procgenPause').textContent = paused ? 'Play world' : 'Pause world'; byId('procgenPause').setAttribute('aria-pressed', String(paused)); }
    physicalControlOwner?.operationalChanged?.();
  };
  listen(byId('procgenPause'), 'click', () => setPaused(!paused));
  const stepOnce = () => { if (!paused) setPaused(true); getRuntime()?.lanes?.step(); };
  listen(byId('procgenStep'), 'click', stepOnce);
  listen(byId('procgenFollow'), 'click', () => { camera()?.followFrontier(); byId('gameCanvas')?.focus?.(); });
  for (const [id, factor] of [['procgenZoomOut', 1 / 1.1], ['procgenZoomIn', 1.1]]) listen(byId(id), 'click', () => camera()?.setZoom(camera().getState().scale * factor));
  let nukeArmed = false;
  const setNukeArmed = armed => {
    if (armed) setSpanEditing(false);
    nukeArmed = armed; byId('gameCanvas')?.classList.toggle('nuke-armed', armed);
    if (byId('procgenNukeStatus')) byId('procgenNukeStatus').textContent = armed ? 'Click a lane to start its nuke; Escape cancels.' : '';
  };
  const canvas = byId('gameCanvas');
  listen(canvas, 'pointerdown', event => {
    if (!nukeArmed || event.button !== 0) return;
    const runtime = getRuntime(), renderer = runtime?.lanes?.renderer, world = runtime?.world, rect = canvas.getBoundingClientRect?.();
    if (!renderer || !world || !rect) return;
    const height = renderer.camera.viewport().height, cssY = event.clientY - rect.top;
    const projection = renderer.workstationLayout;
    if (cssY < 0 || cssY >= (projection ? rect.height : height * renderer.scale)) return;
    const lane = projection ? projection.laneAt(cssY) : Math.floor((renderer.cameraY + cssY / renderer.scale) / world.laneHeight);
    if (physicalControlOwner?.nuke ? physicalControlOwner.nuke(lane) : world.nukeLane(lane)) { event.preventDefault?.(); event.stopImmediatePropagation?.(); setNukeArmed(false); }
  }, { capture: true });
  const runWorldCommand = (action, event = {}) => {
    if (action.startsWith('pan') && action !== 'panBoost') {
      const amount = event.shiftKey ? 48 : 24, offset = { panLeft: [-amount, 0], panRight: [amount, 0], panUp: [0, -amount], panDown: [0, amount] }[action];
      if (offset) camera()?.pan(...offset);
    } else if (action === 'zoomIn' || action === 'zoomOut') camera()?.setZoom(camera().getState().scale * (action === 'zoomIn' ? 1.1 : 1 / 1.1));
    else if (action === 'zoomReset') camera()?.setZoom(3);
    else if (action === 'followFrontier') camera()?.followFrontier();
    else if (action.startsWith('speed')) setSpeed(changeProcgenSpeed(settings.speed, action.startsWith('speedUp') ? 1 : -1, { fast: action.endsWith('Fast') }));
    else if (action === 'togglePause') setPaused(!paused);
    else if (action === 'stepForward') stepOnce();
    else if (action === 'toggleShortcutOverlay') showHelp();
    else if (action === 'restartLevel') doRestart();
    else if (action === 'nuke') setNukeArmed(!nukeArmed);
    else if (action === 'nukeInstant') { setSpanEditing(false); physicalControlOwner?.nuke ? physicalControlOwner.nuke(null) : getRuntime()?.world?.nukeAll?.(); setNukeArmed(false); }
  };
  const commandLabels = { panLeft: 'Pan world left', panRight: 'Pan world right', panUp: 'Pan world up', panDown: 'Pan world down',
    zoomIn: 'Zoom world in', zoomOut: 'Zoom world out', zoomReset: 'Reset world zoom', followFrontier: 'Follow the leading living actor',
    speedDown: 'Decrease world speed', speedDownFast: 'Decrease world speed quickly', speedUp: 'Increase world speed', speedUpFast: 'Increase world speed quickly',
    togglePause: 'Play or pause the world', stepForward: 'Step the world once', restartLevel: 'Restart the world', nuke: 'Arm lane nuke', nukeInstant: 'Nuke all actors', toggleShortcutOverlay: 'Open shortcut reference' };
  const commandRegistration = commandDispatcher.register({ priority: 0,
    getContext: () => { const runtime = getRuntime(), owner = runtime?.world || runtime?.game || runtime, display = camera(); return { owner: owner ? new WeakRef(owner) : null, camera: display ? new WeakRef(display) : null, generation: runtime?.world?.generation }; },
    isCurrent: context => { const runtime = getRuntime(), owner = runtime?.world || runtime?.game || runtime; return !disposed && (!context.owner || context.owner.deref() !== undefined) && context.owner?.deref() === (owner || undefined) && (!context.camera || context.camera.deref() !== undefined) && context.camera?.deref() === (camera() || undefined) && context.generation === runtime?.world?.generation; },
    accepts: event => !settings.workstation || !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight'].includes(event.key || event.code),
    commands: [...Object.keys(commandLabels).map(action => ({ id: 'world.' + action, label: commandLabels[action],
      contexts: [action.startsWith('pan') || action.startsWith('zoom') || action === 'followFrontier' ? 'physical-world' : 'global-transport'],
      shortcut: () => shortcutLabel(action), bindingKey: action, bindings: DEFAULT_KEYBINDINGS.bindings[action] || (action === 'followFrontier' ? ['KeyF'] : ['F1', 'Shift+Slash']),
      repeat: action.startsWith('pan') || action.startsWith('zoom') || action.startsWith('speed'),
      cancelGesture: ['nuke', 'nukeInstant', 'restartLevel'].includes(action),
      enabled: () => (physicalControlOwner?.canShortcut?.(action) ?? true) && (action === 'toggleShortcutOverlay' || (action.startsWith('pan') || action.startsWith('zoom') || action === 'followFrontier' ? !!camera() : action.startsWith('nuke') ? !!physicalControlOwner?.nuke || !!getRuntime()?.world : !!getRuntime())),
      execute: (_context, event) => runWorldCommand(action, event) })),
    { id: 'world.cancelTools', label: 'Cancel armed world tools', cancelGesture: true, contexts: ['physical-world'], bindings: ['Escape'], execute: () => { setNukeArmed(false); setSpanEditing(false); } }] });
  const stopWatchingBindings = commandDispatcher.watchBindings(updateShortcutHints);
  if (typeof window.fetch === 'function') {
    commandDispatcher.setBindingsPending();
    Promise.resolve().then(() => window.fetch('keybindings.json')).then(response => response.ok ? response.json() : null).then(config => {
      if (!disposed) commandDispatcher.setBindings(config);
    }).catch(() => { if (!disposed) commandDispatcher.setBindings(null); });
  } else commandDispatcher.setBindings(null);
  updateShortcutHints();
  const getShareDescriptor = ({ includeCamera = false } = {}) => {
    const runtime = getRuntime(), world = runtime?.world;
    if (!world) throw new Error('Wait for the committed world before copying a recipe');
    if (!runtime.recipeSettings && world.laneCount !== settings.laneCount) throw new Error('Wait for the world change to finish before copying a recipe');
    const committed = runtime.recipeSettings || settings;
    return createProcgenRecipeShareDescriptor({ url: window.location.href, seed: world.seed, sceneOrigin: project.procgen?.sceneOrigin,
      settings: { ...committed, laneCount: world.laneCount, laneHeight: world.laneHeight,
        speed: physicalControlOwner?.getRecipeSpeed?.() ?? (world.timer?.speedFactor > 0 ? world.timer.speedFactor : committed.speed ?? settings.speed) },
      camera: camera()?.getState() || { cameraX: 0, cameraY: 0, scale: 3, follow: true },
      includeCamera });
  };
  const getShareUrl = () => getShareDescriptor().url;
  let sharingView = null, sharingLoad = null;
  listen(byId('procgenShare'), 'click', async () => {
    try {
      sharingLoad ||= import('./ProcgenShareView.js');
      const { createProcgenShareView } = await sharingLoad;
      if (disposed) return;
      sharingView ||= createProcgenShareView({ document, window, getDescriptor: getShareDescriptor,
        getExportDescriptor: () => physicalControlOwner?.getShareExportDescriptor?.(),
        prepareExport: (source, options) => physicalControlOwner?.prepareShareExport?.(source, options),
        onPrepared: () => physicalControlOwner?.revealPreparedExport?.() });
      sharingView.open();
    } catch (error) { if (!disposed && byId('procgenShareNotice')) byId('procgenShareNotice').textContent = `Could not open sharing: ${error.message}`; }
  });
  listen(window, 'blur', () => { if (!settings.workstation) local.suspendGame(); });
  listen(window, 'focus', () => { if (!settings.workstation && !document.hidden) local.resumeGame(); });
  listen(document, 'visibilitychange', () => { if (settings.workstation) return; if (document.hidden) local.suspendGame(); else local.resumeGame(); });
  const syncProgress = state => {
    const lanes = getRuntime()?.world?.stall?.lanes;
    const distance = lanes ? lanes.reduce((max, lane) => Math.max(max, lane.maxX - 36), 0) : state?.distance?.max || 0;
    const best = lanes ? lanes.reduce((max, lane) => Math.max(max, lane.previousDistance || 0), 0) : 0;
    if (byId('procgenDistance')) byId('procgenDistance').textContent = Math.max(0, Math.round(distance)).toLocaleString() + ' px';
    if (byId('procgenBest')) byId('procgenBest').textContent = 'Best ' + Math.max(0, Math.round(best)).toLocaleString();
  };
  const syncActiveCount = count => { if (byId('procgenAliveCount')) byId('procgenAliveCount').textContent = Math.max(0, count).toLocaleString() + ' alive'; };
  return { settings, local, outputCapture, captureControls, getShareUrl, getShareDescriptor, syncActiveCount,
    refreshCanvasToolAuthority() { if (!disposed) { spanOverlay.sync(); syncSpanTool(); } },
    getOperationalMetrics: () => operationalMetrics,
    getProject: () => project,
    setProject: (next, { persist = true } = {}) => commitAutomation(next, false, persist),
    subscribeProject(listener) { projectListeners.add(listener); return () => projectListeners.delete(listener); },
    refreshShortcutHints: updateShortcutHints,
    setPhysicalControlOwner(owner) { physicalControlOwner = owner; updateShortcutHints(); return () => { if (physicalControlOwner === owner) { physicalControlOwner = null; updateShortcutHints(); } }; },
    setPaused, setSpeed, restart: doRestart,
    isPaused: () => paused,
    syncMetrics(state) {
      operationalMetrics = Object.freeze({ achievedTicksPerSecond: Number.isFinite(state.achievedTicksPerSecond) ? state.achievedTicksPerSecond : null,
        observedAt: window.performance?.now?.() ?? null, generation: state.generation, alive: state.alive });
      physicalControlOwner?.operationalChanged?.();
      local.syncStatus?.();
      syncActiveCount(state.alive); syncProgress(state); tensionControls.syncStatus(); spanControls.syncStatus(); musicDirection.syncStatus();
      const pressure = getRuntime()?.view?.midiPreviewRouter?.getOutputPressure?.();
      const outputPressure = byId('procgenOutputPressure');
      if (outputPressure) { outputPressure.hidden = false; outputPressure.textContent = pressure?.throttled ? 'Thinned ' + pressure.dropped : '';  outputPressure.title = pressure?.throttled ? 'Shared sound budget: ' + pressure.reason : ''; }
      const label = byId('procgenMetrics');
      const throughput = byId('procgenThroughput'), requested = getRuntime()?.world?.timer?.speedFactor ?? settings.speed;
      if (throughput && Number.isFinite(state.achievedTicksPerSecond)) throughput.textContent = `${Number(requested.toFixed(1))}× / ${(state.achievedTicksPerSecond * 0.06).toFixed(1)}× actual`;
      if (label) label.textContent = `${state.alive.toLocaleString()} alive · ${state.spawnedTotal.toLocaleString()} spawned · ${Math.round(state.distance.max).toLocaleString()} px forward · run ${state.generation}${state.admissionPaused ? ' · spawn admission paused at actor cap' : ''}`;
      if (label && Number.isFinite(state.achievedTicksPerSecond)) label.textContent += ` · ${settings.speed}× requested / ${(state.achievedTicksPerSecond * 0.06).toFixed(1)}× measured`;
      const policy = byId('procgenStallStatus');
      if (policy) policy.textContent = state.stall?.phase === 'cascade' ? 'Stalled cohort: staggered OHNO; restart follows the last actor.' : 'Progressing and working lanes stay protected. Reset follows all-lane probe/transit grace or a sustained growing pile.';
    },
    prepareCharacters: sprites => characters.sync(sprites),
    sync({ charactersReady = false } = {}) {
      if (!charactersReady) characters.sync();
      syncProgress(); musicDirection.sync(); syncMusic(); spanControls.render(); spanOverlay.sync(); syncSpanTool(); syncWorkerLimits(); syncPopulation();
      setPaused(paused); setNukeArmed(false);
      if (byId('procgenSeed')) byId('procgenSeed').value = String(settings.seed ?? window.procgenSeed ?? '');
      camera()?.applyState(settings.camera || urlConfig.camera);
      const overview = cctv();
      if (overview) { const mode = settings.cctvMode, pins = [...settings.cctvPins], enabled = settings.cctvEnabled; overview.onChange = syncCctv; overview.setMode(mode); overview.setPins(pins); overview.setEnabled?.(enabled); syncCctv(overview.getState()); }
      setSpeed(settings.speed);
      const runtime = getRuntime();
      if (byId('procgenAliveCount') && runtime?.world) byId('procgenAliveCount').textContent = runtime.world.actors.reduce((count, actor) => count + (actor.failureReason ? 0 : 1), 0).toLocaleString() + ' alive';
      if (byId('procgenRunStatus')) byId('procgenRunStatus').textContent = `${settings.laneCount.toLocaleString()} ${settings.laneCount === 1 ? 'lane' : 'lanes'} · ${runtime?.world ? 'Wheel zoom; drag to pan. Configured shortcuts are listed in Help.' : 'Left-to-right generation'}`;
      updateShortcutHints();
    },
    dispose() { disposed = true; stopWatchingBindings(); commandRegistration.dispose(); sharingView?.dispose(); local.dispose(); captureControls.dispose(); musicControls.dispose(); musicDirection.dispose(); tensionControls.dispose(); spanControls.dispose(); spanOverlay.dispose(); characters.dispose?.(); for (const [target, event, handler, options] of listeners) target?.removeEventListener(event, handler, options); }
  };
};
export { createProcgenUiController };
