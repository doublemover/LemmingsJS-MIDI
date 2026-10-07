import { DECORATION_CHOICES } from '../../decorations/ProcgenDecorationPacks.js';
import { createCharacterUiController, mountCharacterControls } from '../characterUiController.js';
import { createLocalGamePreview } from '../midi-ui/localGamePreview.js';
import { createMidiProjectFromMidiConfig, projectToMidiConfig } from '../../midi/project/MidiProject.js';
import { GAME_EVENT_MIDI_PRESETS, applyGameEventMidiPreset } from '../../midi/project/GameEventMidiPresets.js';
import { normalizeLaneCount } from './ProcgenLaneWorld.js';
import { getCharacterPreference } from '../../lemmings/CharacterSpriteSet.js';
import { KeybindingRegistry, DEFAULT_KEYBINDINGS } from '../../input/KeybindingRegistry.js';
import { normalizeProcgenSpeed, changeProcgenSpeed, renderProcgenSpeedControl } from './ProcgenSpeedControl.js';
import { readProcgenUrlConfig, createProcgenShareUrl } from './ProcgenUrlConfig.js';

const createProcgenUiController = ({ document, window, getRuntime, restart, initial = {} }) => {
  const byId = id => document.getElementById(id);
  const listeners = [];
  const listen = (target, event, handler) => { target?.addEventListener(event, handler); listeners.push([target, event, handler]); };
  const urlConfig = readProcgenUrlConfig(window?.location?.search);
  const settings = { laneCount: normalizeLaneCount(initial.laneCount || 1), speed: normalizeProcgenSpeed(initial.speed), pack: [1, 2, 3, 4, 5, 6].includes(Number(initial.pack)) ? Number(initial.pack) : 2,
    preset: GAME_EVENT_MIDI_PRESETS[0].id, mode: 'steps', decoration: 'none', ...urlConfig.settings };
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
  listen(byId('procgenDecoration'), 'change', () => { settings.decoration = byId('procgenDecoration').value; doRestart(); });
  listen(byId('procgenPack'), 'change', () => { settings.pack = Number(byId('procgenPack').value); doRestart(); });
  const camera = () => getRuntime()?.lanes?.renderer?.camera;
  const panelSprites = () => getRuntime()?.lanes?.renderer?.hud?.sprites;
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
      else if (action === 'togglePause' && !event.repeat) { paused = !paused; getRuntime()?.lanes?.[paused ? 'pause' : 'resume'](); handled = true; }
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
  return { settings, local, getShareUrl,
    syncMetrics(state) {
      const label = byId('procgenMetrics');
      if (label) label.textContent = `${state.alive.toLocaleString()} alive · ${state.spawnedTotal.toLocaleString()} spawned · ${Math.round(state.distance.max).toLocaleString()} px forward · run ${state.generation}${state.admissionPaused ? ' · spawn admission paused at actor cap' : ''}`;
      const policy = byId('procgenStallStatus');
      if (policy) policy.textContent = state.stall?.phase === 'cascade' ? 'Stalled cohort: staggered OHNO; restart follows the last actor.' : 'Reset only when every lane stalls: 90 simulated seconds plus 12 new spawns, with a larger allowance farther out.';
    },
    sync() {
      characters.sync();
      paused = false;
      camera()?.applyState(urlConfig.camera);
      setSpeed(settings.speed);
      const runtime = getRuntime();
      if (byId('procgenRunStatus')) byId('procgenRunStatus').textContent = `${settings.laneCount.toLocaleString()} ${settings.laneCount === 1 ? 'lane' : 'lanes'} · ${runtime?.world ? 'Wheel or Z/X zoom; arrows or drag pan; F follows the leader.' : 'Left-to-right generation'}`;
    },
    dispose() { disposed = true; local.dispose(); characters.dispose?.(); for (const [target, event, handler] of listeners) target?.removeEventListener(event, handler); }
  };
};
export { createProcgenUiController };
