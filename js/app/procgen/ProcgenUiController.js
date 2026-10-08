import { createProcgenMidiSpanOverlay } from './ProcgenMidiSpanOverlay.js';
import { createProcgenMidiSpanControls } from './ProcgenMidiSpanControls.js';
import { createMidiTensionControls } from '../midi-ui/midiTensionControls.js';
import { createMidiOutputCapture } from '../../midi/capture/MidiOutputCapture.js';
import { createMidiCaptureControls } from '../midi-ui/midiCaptureControls.js';
import { DECORATION_CHOICES } from '../../decorations/ProcgenDecorationPacks.js';
import { createCharacterUiController, mountCharacterControls } from '../characterUiController.js';
import { createLocalGamePreview } from '../midi-ui/localGamePreview.js';
import { createMidiProjectFromMidiConfig, projectToMidiConfig, reduceMidiProject, sanitizeMidiProject } from '../../midi/project/MidiProject.js';
import { GAME_EVENT_MIDI_PRESETS, applyGameEventMidiPreset } from '../../midi/project/GameEventMidiPresets.js';
import { normalizeLaneCount } from './ProcgenLaneWorld.js';
import { getCharacterPreference } from '../../lemmings/CharacterSpriteSet.js';
import { KeybindingRegistry, DEFAULT_KEYBINDINGS } from '../../input/KeybindingRegistry.js';
import { normalizeProcgenSpeed, changeProcgenSpeed, renderProcgenSpeedControl } from './ProcgenSpeedControl.js';
import { normalizeSeed } from '../../core/seededRandom.js';
import { readProcgenUrlConfig, createProcgenShareUrl } from './ProcgenUrlConfig.js';

const createProcgenUiController = ({ document, window, getRuntime, restart, initial = {} }) => {
  const byId = id => document.getElementById(id);
  const listeners = [];
  const listen = (target, event, handler) => { target?.addEventListener(event, handler); listeners.push([target, event, handler]); };
  const urlConfig = readProcgenUrlConfig(window?.location?.search);
  const settings = { laneCount: normalizeLaneCount(initial.laneCount || 1), speed: normalizeProcgenSpeed(initial.speed), pack: [1, 2, 3, 4, 5, 6].includes(Number(initial.pack)) ? Number(initial.pack) : 2,
    preset: 'game-iron-ensemble', mode: 'steps', decoration: 'none', ...urlConfig.settings, ...(urlConfig.seed != null ? { seed: urlConfig.seed } : {}) };
  const tensionStorageKey = 'lemmings.procgen.ensembleTension.v1';
  let tensionPreferences = null;
  try { const stored = JSON.parse(window.localStorage?.getItem(tensionStorageKey) || 'null'); if (stored?.version === 1 && stored.value && typeof stored.value === 'object') tensionPreferences = stored.value; } catch { /* Keep the preset defaults. */ }
  let project = applyGameEventMidiPreset(createMidiProjectFromMidiConfig({ enabled: false, sfx: {}, triggers: {} }), settings.preset);
  const spanStorageKey = 'lemmings.procgen.automationSpans.v1', workerStorageKey = 'lemmings.procgen.workerLimits.v1';
  const normalizeWorkerLimits = value => Object.fromEntries(['bashers', 'diggers', 'builders'].map(key => [key, Number.isFinite(Number(value?.[key])) ? Math.max(0, Math.min(16, Math.trunc(Number(value[key])))) : 2]));
  settings.workerLimits = normalizeWorkerLimits(null);
  try { const stored = JSON.parse(window.localStorage?.getItem(spanStorageKey) || 'null'); if (stored?.version === 1 && Array.isArray(stored.value)) project = sanitizeMidiProject({ ...project, automation: [...project.automation, ...stored.value.filter(entry => entry?.span).slice(0, 64)] }); } catch { /* Keep session defaults. */ }
  try { const stored = JSON.parse(window.localStorage?.getItem(workerStorageKey) || 'null'); if (stored?.version === 1) settings.workerLimits = normalizeWorkerLimits(stored.value); } catch { /* Keep session defaults. */ }
  let config = projectToMidiConfig(project), disposed = false;
  const local = createLocalGamePreview({ getLemmings: () => getRuntime()?.view, getConfig: () => config, immutableConfig: true,
    onStateChange: state => {
      const button = byId('procgenListen');
      if (button) { button.textContent = state.enabled || state.status === 'starting' ? 'Stop listening' : 'Listen locally'; button.setAttribute('aria-pressed', String(state.enabled)); }
      if (byId('procgenAudioStatus')) byId('procgenAudioStatus').textContent = state.message;
    } });
  const outputCapture = createMidiOutputCapture();
  const captureControls = createMidiCaptureControls({ document, window, capture: outputCapture, prefix: 'procgenCapture', inspect: () => local.audio.inspectRender?.(),
    attach: capture => local.setCapture(capture),
    getMetadata: () => {
      const runtime = getRuntime(), timer = runtime?.game?.getGameTimer?.();
      return { backend: local.getState().enabled ? 'local-browser-audio' : 'no-active-output', seed: runtime?.world?.seed ?? settings.seed, generation: runtime?.world?.generation,
        tempoBpm: project.transport.bpmBase, speed: timer?.speedFactor, frameMs: timer?.frameTime, scale: project.global.scale,
        settingsReference: { localMasterGain: local.audio.getState().masterVolume, preset: settings.preset, mode: settings.mode, laneCount: settings.laneCount, pack: settings.pack,
          tracks: project.tracks.slice(0, 16).map(track => ({ id: track.id, channel: track.channel, program: track.program })), ensemble: project.ensemble },
        limits: { capacity: outputCapture.capacity, maxDurationMs: outputCapture.maxDurationMs } };
    } });
  const tensionControls = createMidiTensionControls({ document, prefix: 'procgenTension', getProject: () => project,
    getRouter: () => getRuntime()?.view?.midiPreviewRouter, getLaneCount: () => settings.laneCount,
    update: patch => {
      project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch });
      tensionPreferences = project.ensemble?.tension; config = projectToMidiConfig(project); local.syncConfig();
      try { window.localStorage?.setItem(tensionStorageKey, JSON.stringify({ version: 1, value: tensionPreferences })); } catch { /* Keep the session choice. */ }
    } });
  const spanControls = createProcgenMidiSpanControls({ document, getProject: () => project, getLaneCount: () => settings.laneCount,
    getRouter: () => getRuntime()?.view?.midiPreviewRouter,
    onSelect: id => spanOverlay.select(id),
    onIntent: intent => { project = reduceMidiProject(project, intent); config = projectToMidiConfig(project); local.syncConfig(); spanControls.render(); spanOverlay.changed();
      try { window.localStorage?.setItem(spanStorageKey, JSON.stringify({ version: 1, value: project.automation.filter(entry => entry.span) })); } catch { /* Keep the session edits. */ }
    } });
  const spanOverlay = createProcgenMidiSpanOverlay({ document, getRuntime, getProject: () => project,
    getDomain: () => byId('procgenSpanDomain')?.value || 'beats', getTarget: () => byId('procgenSpanTarget')?.value || 'velocity',
    onUpdate: (automationId, patch) => { project = reduceMidiProject(project, { type: 'automation.update', automationId, patch }); config = projectToMidiConfig(project); local.syncConfig(); spanControls.render();
      try { window.localStorage?.setItem(spanStorageKey, JSON.stringify({ version: 1, value: project.automation.filter(entry => entry.span) })); } catch { /* Keep session edits. */ }
    }, onAdd: (span, target) => spanControls.addSpan(span, target), onSelect: id => { spanControls.select(id); setOpen(true); } });
  listen(byId('procgenSpanEdit'), 'change', event => { spanOverlay.setEditing(event.target.checked); if (event.target.checked && byId('procgenSpanVisible')) byId('procgenSpanVisible').checked = true; });
  listen(byId('procgenSpanVisible'), 'change', event => { spanOverlay.setVisible(event.target.checked); if (!event.target.checked && byId('procgenSpanEdit')) byId('procgenSpanEdit').checked = false; });
  const syncWorkerLimits = () => {
    getRuntime()?.world?.setWorkerLimits?.(settings.workerLimits);
    for (const [key, suffix] of [['bashers', 'Bashers'], ['diggers', 'Diggers'], ['builders', 'Builders']]) if (byId('procgenWorker' + suffix)) byId('procgenWorker' + suffix).value = String(settings.workerLimits[key]);
  };
  for (const [key, suffix] of [['bashers', 'Bashers'], ['diggers', 'Diggers'], ['builders', 'Builders']]) listen(byId('procgenWorker' + suffix), 'change', event => {
    if (!String(event.target.value).trim() || !Number.isFinite(Number(event.target.value))) { syncWorkerLimits(); return; }
    settings.workerLimits = normalizeWorkerLimits({ ...settings.workerLimits, [key]: event.target.value }); syncWorkerLimits();
    try { window.localStorage?.setItem(workerStorageKey, JSON.stringify({ version: 1, value: settings.workerLimits })); } catch { /* Keep the session choice. */ }
  });
  const panel = byId('procgenDrawer'), tab = byId('procgenTab');
  const setOpen = open => {
    if (!panel || !tab) return;
    panel.classList.toggle('is-open', open); panel.inert = !open;
    tab.setAttribute('aria-expanded', String(open)); tab.textContent = open ? 'Close details' : 'Details';
    if (!open && panel.contains(document.activeElement)) tab.focus();
  };
  let dragStart = null, pulledOpen = false;
  listen(tab, 'pointerdown', event => { dragStart = event.clientY; });
  listen(tab, 'pointerup', event => { if (dragStart != null && event.clientY - dragStart > 15) { setOpen(true); pulledOpen = true; } dragStart = null; });
  listen(tab, 'click', () => { if (pulledOpen) { pulledOpen = false; return; } setOpen(tab.getAttribute('aria-expanded') !== 'true'); });
  listen(document, 'keydown', event => { if (event.key === 'Escape') { setOpen(false); spanOverlay.setEditing(false); if (byId('procgenSpanEdit')) byId('procgenSpanEdit').checked = false; } });
  setOpen(false);
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
  fill('procgenPreset', GAME_EVENT_MIDI_PRESETS.map(preset => [preset.id, preset.label]), settings.preset);
  fill('procgenPack', [[1, 'Lemmings'], [2, 'Oh No! More Lemmings'], [3, 'Xmas 1991'], [4, 'Xmas 1992'], [5, 'Holiday 1993'], [6, 'Holiday 1994']], settings.pack);
  if (byId('procgenSpeed')) byId('procgenSpeed').value = settings.speed;
  if (byId('procgenPhrases')) byId('procgenPhrases').checked = settings.mode === 'phrase';
  if (byId('procgenLanes')) byId('procgenLanes').value = settings.laneCount;
  const refreshPreset = () => {
    settings.preset = byId('procgenPreset').value; settings.mode = byId('procgenPhrases')?.checked ? 'phrase' : 'steps';
    project = applyGameEventMidiPreset(project, settings.preset, { mode: settings.mode });
    if (project.ensemble && tensionPreferences) project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch: tensionPreferences });
    config = projectToMidiConfig(project); local.syncConfig(); tensionControls.sync(); spanControls.render();
    if (byId('procgenPresetDescription')) byId('procgenPresetDescription').textContent = GAME_EVENT_MIDI_PRESETS.find(p => p.id === settings.preset).description;
  };
  listen(byId('procgenPreset'), 'change', refreshPreset); listen(byId('procgenPhrases'), 'change', refreshPreset); refreshPreset();
  listen(byId('procgenListen'), 'click', () => { if (local.getState().enabled || local.getState().status === 'starting') local.stop(); else local.start(); });
  const doRestart = async () => {
    const seed = byId('procgenSeed')?.value?.trim();
    if (seed) settings.seed = normalizeSeed(seed);
    local.stop();
    if (byId('procgenRunStatus')) byId('procgenRunStatus').textContent = 'Loading…';
    try { await restart(); } catch (error) { if (!disposed && byId('procgenRunStatus')) byId('procgenRunStatus').textContent = `Could not start: ${error.message}`; }
  };
  listen(byId('procgenRestart'), 'click', doRestart);
  listen(byId('procgenNewSeed'), 'click', () => {
    const bytes = new Uint32Array(1); window.crypto?.getRandomValues?.(bytes);
    settings.seed = normalizeSeed(bytes[0] || Date.now());
    if (byId('procgenSeed')) byId('procgenSeed').value = String(settings.seed);
    doRestart();
  });
  listen(byId('procgenSeed'), 'keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); doRestart(); } });
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
  listen(byId('procgenPanic'), 'click', () => local.panic());
  listen(byId('procgenLanes'), 'change', () => { settings.laneCount = normalizeLaneCount(byId('procgenLanes').value); byId('procgenLanes').value = settings.laneCount; doRestart(); });
  listen(byId('procgenDecoration'), 'change', () => { settings.decoration = byId('procgenDecoration').value; doRestart(); });
  listen(byId('procgenPack'), 'change', () => { settings.pack = Number(byId('procgenPack').value); doRestart(); });
  const camera = () => getRuntime()?.lanes?.renderer?.camera;
  const panelSprites = () => getRuntime()?.lanes?.renderer?.hud?.sprites;
  const cctv = () => getRuntime()?.lanes?.renderer?.cctv;
  settings.cctvMode = 'leaders'; settings.cctvPins = [];
  const syncCctv = state => {
    if (!state) return;
    settings.cctvMode = state.mode; settings.cctvPins = state.pins;
    if (byId('procgenCctvMode')) byId('procgenCctvMode').value = state.mode;
    for (let index = 0; index < 8; index++) {
      const button = byId('procgenCctvSlot' + index), slot = state.slots[index]; if (!button) continue;
      button.hidden = !slot; if (!slot) continue;
      button.dataset.lane = slot.lane; button.disabled = state.mode !== 'director'; button.setAttribute('aria-pressed', String(slot.pinned));
      button.textContent = 'Lane ' + (slot.lane + 1) + ' / #' + slot.rank + ' / ' + slot.reason;
      button.title = slot.pinned ? 'Unpin this lane' : 'Pin this lane in Director mode';
    }
    const message = state.mode === 'director' ? state.pins.length + '/4 pinned; other views follow actual activity, with one fair rotation slot.'
      : 'Eight distance leaders. Pins are retained for Director mode.';
    if (byId('procgenCctvStatus') && byId('procgenCctvStatus').textContent !== message) byId('procgenCctvStatus').textContent = message;
  };
  listen(byId('procgenCctvMode'), 'change', () => { cctv()?.setMode(byId('procgenCctvMode').value); syncCctv(cctv()?.getState()); });
  const toggleCctvPin = lane => {
    if (!cctv()?.togglePin(lane)) { if (byId('procgenCctvStatus')) byId('procgenCctvStatus').textContent = 'Choose a valid lane; unpin a lane before adding a fifth pin.'; return; }
    syncCctv(cctv().getState());
  };
  listen(byId('procgenCctvPin'), 'click', () => toggleCctvPin(Number(byId('procgenCctvLane')?.value) - 1));
  listen(byId('procgenCctvClear'), 'click', () => { cctv()?.setPins([]); syncCctv(cctv()?.getState()); });
  for (let index = 0; index < 8; index++) listen(byId('procgenCctvSlot' + index), 'click', event => toggleCctvPin(Number(event.currentTarget?.dataset.lane ?? byId('procgenCctvSlot' + index)?.dataset.lane)));

  const setSpeed = value => {
    settings.speed = normalizeProcgenSpeed(value, settings.speed);
    if (byId('procgenSpeed')) byId('procgenSpeed').value = settings.speed;
    const runtime = getRuntime(); if (runtime?.view) runtime.view.gameSpeedFactor = settings.speed;
    const timer = runtime?.game?.getGameTimer?.(); if (timer) timer.speedFactor = settings.speed;
    renderProcgenSpeedControl({ document, sprites: panelSprites(), speed: settings.speed });
  };
  listen(byId('procgenSpeed'), 'change', () => setSpeed(byId('procgenSpeed').value));
  for (const [id, direction] of [['procgenSpeedDown', -1], ['procgenSpeedUp', 1]]) {
    listen(byId(id), 'click', event => setSpeed(changeProcgenSpeed(settings.speed, direction, { panel: true, fast: event.shiftKey })));
  }
  const supportedKeys = new Set(['panLeft', 'panRight', 'panUp', 'panDown', 'zoomIn', 'zoomOut', 'zoomReset', 'speedDown', 'speedDownFast', 'speedUp', 'speedUpFast', 'togglePause', 'stepForward', 'restartLevel']);
  const keyConfig = config => ({ bindings: { ...Object.fromEntries(Object.entries(DEFAULT_KEYBINDINGS.bindings).map(([action, bindings]) =>
    [action, supportedKeys.has(action) ? config?.bindings?.[action] ?? bindings : []])), followFrontier: config?.bindings?.followFrontier || ['KeyF'] } });
  const keybindings = new KeybindingRegistry(keyConfig());
  window?.fetch?.('keybindings.json').then(response => response.ok ? response.json() : null).then(config => {
    if (config && !disposed) keybindings.setConfig(keyConfig(config));
  }).catch(() => {});
  let paused = false;
  const setPaused = next => {
    paused = !!next; getRuntime()?.lanes?.[paused ? 'pause' : 'resume']();
    if (byId('procgenPause')) { byId('procgenPause').textContent = paused ? 'Play' : 'Pause'; byId('procgenPause').setAttribute('aria-pressed', String(paused)); }
  };
  listen(byId('procgenPause'), 'click', () => setPaused(!paused));
  listen(byId('procgenStep'), 'click', () => { setPaused(true); getRuntime()?.lanes?.step(); });
  listen(byId('procgenFollow'), 'click', () => { camera()?.followFrontier(); byId('gameCanvas')?.focus?.(); });
  for (const [id, factor] of [['procgenZoomOut', 1 / 1.1], ['procgenZoomIn', 1.1]]) listen(byId(id), 'click', () => camera()?.setZoom(camera().getState().scale * factor));
  const handleKey = event => {
    if (event.defaultPrevented || event.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target?.tagName)) return;
    let handled = false;
    for (const action of keybindings.getActionsForEvent(event)) {
      if (action.startsWith('pan') && action !== 'panBoost') {
        const amount = event.shiftKey ? 48 : 24;
        const offset = { panLeft: [-amount, 0], panRight: [amount, 0], panUp: [0, -amount], panDown: [0, amount] }[action];
        if (offset) { camera()?.pan(...offset); handled = true; }
      } else if (action === 'zoomIn' || action === 'zoomOut') {
        camera()?.setZoom(camera().getState().scale * (action === 'zoomIn' ? 1.1 : 1 / 1.1)); handled = true;
      } else if (action === 'zoomReset') { camera()?.setZoom(3); handled = true; }
      else if (action === 'followFrontier') { camera()?.followFrontier(); handled = true; }
      else if (action.startsWith('speed')) { setSpeed(changeProcgenSpeed(settings.speed, action.startsWith('speedUp') ? 1 : -1, { fast: action.endsWith('Fast') })); handled = true; }
      else if (action === 'togglePause' && !event.repeat) { setPaused(!paused); handled = true; }
      else if (action === 'stepForward') { if (paused) getRuntime()?.lanes?.step(); handled = true; }
      else if (action === 'restartLevel' && !event.repeat) { doRestart(); handled = true; }
    }
    if (handled) event.preventDefault?.();
  };
  listen(window, 'keydown', handleKey);
  const getShareUrl = () => createProcgenShareUrl({ url: window.location.href, seed: window.procgenSeed,
    settings, appearance: getCharacterPreference(), camera: camera()?.getState() || { cameraX: 0, cameraY: 0, scale: 3, follow: true } });
  listen(byId('procgenShare'), 'click', () => {
    const input = byId('procgenShareUrl'); if (!input) return;
    input.value = getShareUrl(); input.hidden = false; input.focus?.(); input.select?.();
  });
  listen(window, 'blur', () => local.stop());
  listen(document, 'visibilitychange', () => { if (document.hidden) local.stop(); });
  const syncActiveCount = count => { if (byId('procgenAliveCount')) byId('procgenAliveCount').textContent = Math.max(0, count).toLocaleString() + ' alive'; };
  return { settings, local, outputCapture, captureControls, getShareUrl, syncActiveCount,
    syncMetrics(state) {
      syncActiveCount(state.alive); tensionControls.syncStatus(); spanControls.syncStatus();
      const pressure = getRuntime()?.view?.midiPreviewRouter?.getOutputPressure?.();
      const outputPressure = byId('procgenOutputPressure');
      if (outputPressure) { outputPressure.hidden = !pressure?.throttled; outputPressure.textContent = pressure?.throttled ? 'Thinned ' + pressure.dropped : ''; outputPressure.title = pressure?.throttled ? 'Shared sound budget: ' + pressure.reason : ''; }
      const label = byId('procgenMetrics');
      if (label) label.textContent = `${state.alive.toLocaleString()} alive · ${state.spawnedTotal.toLocaleString()} spawned · ${Math.round(state.distance.max).toLocaleString()} px forward · run ${state.generation}${state.admissionPaused ? ' · spawn admission paused at actor cap' : ''}`;
      const policy = byId('procgenStallStatus');
      if (policy) policy.textContent = state.stall?.phase === 'cascade' ? 'Stalled cohort: staggered OHNO; restart follows the last actor.' : 'Progressing and working lanes stay protected. Reset follows all-lane probe/transit grace or a sustained growing pile.';
    },
    sync() {
      characters.sync(); tensionControls.sync(); spanControls.render(); spanOverlay.sync(); syncWorkerLimits();
      paused = false;
      if (byId('procgenPause')) { byId('procgenPause').textContent = 'Pause'; byId('procgenPause').setAttribute('aria-pressed', 'false'); }
      if (byId('procgenSeed')) byId('procgenSeed').value = String(settings.seed ?? window.procgenSeed ?? '');
      camera()?.applyState(urlConfig.camera);
      const overview = cctv();
      if (overview) { const mode = settings.cctvMode, pins = [...settings.cctvPins]; overview.onChange = syncCctv; overview.setMode(mode); overview.setPins(pins); syncCctv(overview.getState()); }
      setSpeed(settings.speed);
      const runtime = getRuntime();
      if (byId('procgenAliveCount') && runtime?.world) byId('procgenAliveCount').textContent = runtime.world.actors.reduce((count, actor) => count + (actor.failureReason ? 0 : 1), 0).toLocaleString() + ' alive';
      if (byId('procgenRunStatus')) byId('procgenRunStatus').textContent = `${settings.laneCount.toLocaleString()} ${settings.laneCount === 1 ? 'lane' : 'lanes'} · ${runtime?.world ? 'Wheel or Z/X zoom; arrows or drag pan; F follows the leader.' : 'Left-to-right generation'}`;
    },
    dispose() { disposed = true; local.dispose(); captureControls.dispose(); tensionControls.dispose(); spanControls.dispose(); spanOverlay.dispose(); characters.dispose?.(); for (const [target, event, handler] of listeners) target?.removeEventListener(event, handler); }
  };
};
export { createProcgenUiController };
