import { createCharacterUiController, mountCharacterControls } from '../characterUiController.js';
import { createLocalGamePreview } from '../midi-ui/localGamePreview.js';
import { createMidiProjectFromMidiConfig, projectToMidiConfig } from '../../midi/project/MidiProject.js';
import { GAME_EVENT_MIDI_PRESETS, applyGameEventMidiPreset } from '../../midi/project/GameEventMidiPresets.js';
import { normalizeLaneCount } from './ProcgenLaneWorld.js';

const createProcgenUiController = ({ document, window, getRuntime, restart, initial = {} }) => {
  const byId = id => document.getElementById(id);
  const listeners = [];
  const listen = (target, event, handler) => { target?.addEventListener(event, handler); listeners.push([target, event, handler]); };
  const settings = { laneCount: normalizeLaneCount(initial.laneCount || 1), speed: [0.5, 1, 2, 3, 4, 8, 16].includes(Number(initial.speed)) ? Number(initial.speed) : 3, pack: [1, 2, 3, 4, 5, 6].includes(Number(initial.pack)) ? Number(initial.pack) : 2,
    preset: GAME_EVENT_MIDI_PRESETS[0].id, mode: 'steps' };
  let project = applyGameEventMidiPreset(createMidiProjectFromMidiConfig({ enabled: false, sfx: {}, triggers: {} }), settings.preset);
  let config = projectToMidiConfig(project), disposed = false;
  const local = createLocalGamePreview({ getLemmings: () => getRuntime()?.view, getConfig: () => config, immutableConfig: true,
    onStateChange: state => {
      const button = byId('procgenListen');
      if (button) { button.textContent = state.enabled || state.status === 'starting' ? 'Stop listening' : 'Listen locally'; button.setAttribute('aria-pressed', String(state.enabled)); }
      if (byId('procgenAudioStatus')) byId('procgenAudioStatus').textContent = state.message;
    } });
  const panel = byId('procgenDrawer'), tab = byId('procgenTab');
  const setOpen = open => {
    if (!panel || !tab) return;
    panel.classList.toggle('is-open', open); panel.inert = !open;
    tab.setAttribute('aria-expanded', String(open)); tab.textContent = open ? 'Controls ▴' : 'Controls ▾';
    if (!open && panel.contains(document.activeElement)) tab.focus();
  };
  let dragStart = null, pulledOpen = false;
  listen(tab, 'pointerdown', event => { dragStart = event.clientY; });
  listen(tab, 'pointerup', event => { if (dragStart != null && event.clientY - dragStart > 15) { setOpen(true); pulledOpen = true; } dragStart = null; });
  listen(tab, 'click', () => { if (pulledOpen) { pulledOpen = false; return; } setOpen(tab.getAttribute('aria-expanded') !== 'true'); });
  listen(document, 'keydown', event => { if (event.key === 'Escape') setOpen(false); });
  setOpen(false);
  const charactersHost = byId('procgenCharacters');
  if (charactersHost) mountCharacterControls(document, charactersHost);
  const characters = createCharacterUiController({ document, window, getView: () => getRuntime()?.view });
  characters.bind();
  const fill = (id, choices, value) => {
    const select = byId(id); if (!select) return;
    for (const [value, label] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option); }
    select.value = String(value);
  };
  fill('procgenPreset', GAME_EVENT_MIDI_PRESETS.map(preset => [preset.id, preset.label]), settings.preset);
  fill('procgenPack', [[1, 'Lemmings'], [2, 'Oh No! More Lemmings'], [3, 'Xmas 1991'], [4, 'Xmas 1992'], [5, 'Holiday 1993'], [6, 'Holiday 1994']], settings.pack);
  fill('procgenSpeed', [0.5, 1, 2, 3, 4, 8, 16].map(value => [value, `${value}×`]), settings.speed);
  if (byId('procgenLanes')) byId('procgenLanes').value = settings.laneCount;
  const refreshPreset = () => {
    settings.preset = byId('procgenPreset').value; settings.mode = byId('procgenPhrases')?.checked ? 'phrase' : 'steps';
    project = applyGameEventMidiPreset(project, settings.preset, { mode: settings.mode }); config = projectToMidiConfig(project); local.syncConfig();
    if (byId('procgenPresetDescription')) byId('procgenPresetDescription').textContent = GAME_EVENT_MIDI_PRESETS.find(p => p.id === settings.preset).description;
  };
  listen(byId('procgenPreset'), 'change', refreshPreset); listen(byId('procgenPhrases'), 'change', refreshPreset); refreshPreset();
  listen(byId('procgenListen'), 'click', () => { if (local.getState().enabled || local.getState().status === 'starting') local.stop(); else local.start(); });
  const doRestart = async () => {
    local.stop();
    if (byId('procgenRunStatus')) byId('procgenRunStatus').textContent = 'Loading…';
    try { await restart(); } catch (error) { if (!disposed && byId('procgenRunStatus')) byId('procgenRunStatus').textContent = `Could not start: ${error.message}`; }
  };
  listen(byId('procgenRestart'), 'click', doRestart);
  listen(byId('procgenLanes'), 'change', () => { settings.laneCount = normalizeLaneCount(byId('procgenLanes').value); byId('procgenLanes').value = settings.laneCount; doRestart(); });
  listen(byId('procgenPack'), 'change', () => { settings.pack = Number(byId('procgenPack').value); doRestart(); });
  listen(byId('procgenSpeed'), 'change', () => {
    settings.speed = Number(byId('procgenSpeed').value);
    const runtime = getRuntime(); if (runtime?.view) runtime.view.gameSpeedFactor = settings.speed;
    const timer = runtime?.game?.getGameTimer?.(); if (timer) timer.speedFactor = settings.speed;
  });
  listen(window, 'blur', () => local.stop());
  listen(document, 'visibilitychange', () => { if (document.hidden) local.stop(); });
  return { settings, local,
    syncMetrics(state) {
      const label = byId('procgenMetrics');
      if (label) label.textContent = `${state.alive.toLocaleString()} alive · ${state.spawnedTotal.toLocaleString()} spawned · ${Math.round(state.distance.max).toLocaleString()} px forward · run ${state.generation}${state.admissionPaused ? ' · spawn admission paused at actor cap' : ''}`;
      const policy = byId('procgenStallStatus');
      if (policy) policy.textContent = state.stall?.phase === 'cascade' ? 'Stalled cohort: staggered OHNO; restart follows the last actor.' : 'Reset only when every lane stalls: 90 simulated seconds plus 12 new spawns, with a larger allowance farther out.';
    },
    sync() {
      characters.sync();
      const runtime = getRuntime();
      if (byId('procgenRunStatus')) byId('procgenRunStatus').textContent = `${settings.laneCount.toLocaleString()} ${settings.laneCount === 1 ? 'lane' : 'lanes'} · ${runtime?.world ? 'Scroll or drag to explore; double-click to follow.' : 'Left-to-right generation'}`;
    },
    dispose() { disposed = true; local.dispose(); characters.dispose?.(); for (const [target, event, handler] of listeners) target?.removeEventListener(event, handler); }
  };
};
export { createProcgenUiController };
