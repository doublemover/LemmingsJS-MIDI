import { GAME_SOUND_EVENTS, getEventBehavior, createEventBehaviorPatch } from './midiSoundEditor.js';
import { cloneSafeObject } from '../../util/safeObject.js';

const LAYOUTS = ['focus', 'split', 'overlay'];
const LAYOUT_KEY = 'lemmings.midi.workbench.layout';
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const soundReference = source => cloneSafeObject({ enabled: source.enabled, mode: source.mode, mapping: source.mapping, clipId: source.clipId });

const gameClock = timer => {
  const speed = Number(timer?.speedFactor) || 1;
  const frameMs = Number(timer?.frameTime) || 60 / speed;
  return { speed, frameMs, ticksPerSecond: 1000 / frameMs, tick: timer?.tickIndex ?? 0, running: !!timer?.isRunning?.() };
};

const createMidiInstrumentWorkbench = ({ document, window, getLemmings, getProject, getSource,
  updateMapping, updateSource, commitProject, chooseView, bind, panic, history, setStatus }) => {
  const byId = id => document?.getElementById(id);
  const text = (id, value) => { const el = byId(id); if (el && el.textContent !== String(value)) el.textContent = value; };
  const value = (id, next) => { const el = byId(id); if (el && el !== document?.activeElement && el.value !== String(next)) el.value = String(next); };
  let layout = 'split', visible = false, timerId = null, soundBus = null;
  const activity = new Map(), references = new Map();
  let lastEvent = null, lastTick = null;
  try { const stored = window?.localStorage?.getItem(LAYOUT_KEY); if (LAYOUTS.includes(stored)) layout = stored; } catch { /* Layout is optional storage. */ }
  const setLayout = next => {
    if (!LAYOUTS.includes(next)) return;
    layout = next;
    if (document?.body?.dataset) document.body.dataset.midiLayout = next;
    for (const name of LAYOUTS) byId(`midiLayout${name[0].toUpperCase() + name.slice(1)}`)?.setAttribute('aria-pressed', String(name === next));
    try { window?.localStorage?.setItem(LAYOUT_KEY, next); } catch { /* Keep the current session usable. */ }
    window?.dispatchEvent?.(new window.Event('resize'));
  };
  const onEvent = event => {
    if (!Number.isFinite(event?.sfxId)) return;
    const item = activity.get(event.sfxId) || { count: 0, tick: 0 };
    item.count += 1; item.tick = event.tick;
    activity.set(event.sfxId, item);
    lastEvent = event;
  };
  const detach = () => { soundBus?.onEvent?.off?.(onEvent); soundBus = null; };
  const refreshClock = () => {
    if (!visible) return;
    const view = getLemmings();
    const nextBus = view?.game?.soundEvents;
    if (nextBus !== soundBus) {
      detach(); soundBus = nextBus; activity.clear(); lastEvent = null; lastTick = null;
      soundBus?.onEvent?.on?.(onEvent);
    }
    const clock = gameClock(view?.game?.getGameTimer?.());
    if (lastTick != null && clock.tick < lastTick) { activity.clear(); lastEvent = null; }
    lastTick = clock.tick;
    value('midiGameSpeed', clock.speed); value('midiGameSpeedValue', clock.speed);
    text('midiGamePlay', clock.running ? 'Pause game' : 'Play game');
    byId('midiGamePlay')?.setAttribute('aria-pressed', String(clock.running));
    text('midiGameClock', `${clock.running ? 'RUN' : 'PAUSE'} · tick ${clock.tick} · ${clock.ticksPerSecond.toFixed(1)} ticks/s`);
    text('midiLastEvent', lastEvent ? `${GAME_SOUND_EVENTS.find(item => item.id === lastEvent.sfxId)?.label || 'Event'} · tick ${lastEvent.tick}` : 'Waiting for game events');
    for (const row of Array.from(byId('midiGameEventList')?.children || [])) {
      const item = activity.get(Number(row.dataset.gameEventId));
      row.dataset.activityCount = String(item?.count || 0);
      row.classList.toggle('is-playing', !!item && clock.tick - item.tick >= 0 && clock.tick - item.tick < 4);
      const count = row.querySelector?.('.midi-event-count');
      if (count) count.textContent = item ? `${item.count}× · tick ${item.tick}` : 'No events yet';
    }
    const source = getSource();
    const runtime = view?.midiPreviewRouter || view?.midiRouter;
    const state = runtime?.getEventPlaybackState?.({ sfxId: Number(source?.sourceKey) });
    const marker = state?.nextIndex;
    Array.from(byId('midiSoundContour')?.children || []).forEach((bar, index) => {
      const next = getEventBehavior(source) === 'steps' && index === marker;
      bar.classList.toggle('is-next', next);
      if (next) bar.setAttribute('aria-current', 'step'); else bar.removeAttribute?.('aria-current');
    });
    const durations = getProject().global.durationTicks;
    const requested = source?.mapping?.durationTicks ?? durations.default;
    const length = clamp(requested, durations.min, durations.max);
    text('midiSoundDurationEffective', `${length} ticks · ${(length * clock.frameMs).toFixed(0)} ms${requested !== length ? ' · project range limit' : ''}`);
  };
  const setVisible = next => {
    visible = !!next;
    const head = byId('midiInstrumentHead'); if (head) head.hidden = !visible;
    if (timerId != null) window?.clearInterval?.(timerId);
    timerId = null;
    if (visible) { refreshClock(); timerId = window?.setInterval?.(refreshClock, 100) ?? null; }
    else detach();
  };
  const routeSummary = () => {
    const p = getProject(), source = getSource();
    const track = p.tracks.find(item => item.id === source?.trackId);
    const output = track?.outputId || p.devices?.outputId || 'selected MIDI output';
    const soloedOut = p.tracks.some(item => item.solo && !item.mute) && !track?.solo;
    return source ? `${source.label} → ${track?.name || 'Unassigned track'} · ch ${track?.channel || 1}${track?.mute ? ' · MUTED' : soloedOut ? ' · excluded by solo' : ''} · ${output}` : 'Choose an event';
  };
  const render = () => {
    const source = getSource(), p = getProject(), mapping = source?.mapping || {};
    const behavior = getEventBehavior(source), direct = !!source && source.mode === 'direct';
    text('midiSoundRoute', routeSummary());
    text('midiEditScope', `${source?.label || 'Event'} · sound controls`);
    for (const button of Array.from(byId('midiBehaviorChoices')?.children || [])) {
      button.setAttribute('aria-pressed', String(button.dataset.behavior === behavior));
      button.disabled = !source;
    }
    value('midiSoundPitchDial', mapping.note ?? mapping.notes?.[0] ?? 60);
    value('midiSoundLevelNumber', mapping.velocity ?? p.global.velocityRange.default);
    value('midiSoundDuration', mapping.durationTicks ?? p.global.durationTicks.default);
    value('midiSoundDurationNumber', mapping.durationTicks ?? p.global.durationTicks.default);
    value('midiSoundPan', mapping.pan ?? 0); value('midiSoundPanNumber', mapping.pan ?? 0);
    value('midiSoundOrder', mapping.arp?.mode || mapping.phrase?.mode || 'up');
    const order = byId('midiSoundOrderField'); if (order) order.hidden = !mapping.arp?.enabled;
    for (const id of ['midiSoundPitchDial', 'midiSoundLevelNumber', 'midiSoundDuration', 'midiSoundDurationNumber', 'midiSoundPan', 'midiSoundPanNumber']) {
      const el = byId(id); if (el) el.disabled = !direct || (id === 'midiSoundPitchDial' && behavior === 'custom');
    }
    const ref = references.get(source?.id);
    if (source && !ref) references.set(source.id, soundReference(source));
    const undoState = history.state();
    for (const id of ['midiUndo', 'midiMenuUndo']) { const el = byId(id); if (el) el.disabled = !undoState.canUndo; }
    for (const id of ['midiRedo', 'midiMenuRedo']) { const el = byId(id); if (el) el.disabled = !undoState.canRedo; }
    text('midiPatternAxis', mapping.arp?.enabled ? 'Event order · each trigger advances one note' : mapping.phrase?.enabled ? `Phrase · one note every ${mapping.phrase.spacingTicks} game ticks` : 'One note per event');
    refreshClock();
  };
  const finiteInput = (event, min, max) => {
    if (String(event.target.value).trim() === '') { render(); return null; }
    const n = Number(event.target.value);
    if (!Number.isFinite(n)) { render(); return null; }
    return clamp(n, min, max);
  };
  const paired = (range, number, min, max, apply) => {
    bind(range, 'pointerdown', history.beginGesture);
    bind(range, 'keydown', event => { if (!event.repeat) history.beginGesture(); });
    bind(range, 'input', event => { const n = finiteInput(event, min, max); if (n != null) apply(n); });
    bind(range, 'change', event => { const n = finiteInput(event, min, max); if (n != null) apply(n); history.endGesture(); });
    bind(range, 'keyup', history.endGesture);
    bind(range, 'blur', history.endGesture);
    if (number) bind(number, 'change', event => { const n = finiteInput(event, min, max); if (n != null) apply(n); });
  };
  const initialize = () => {
    setLayout(layout);
    for (const name of LAYOUTS) bind(`midiLayout${name[0].toUpperCase() + name.slice(1)}`, 'click', () => setLayout(name));
    for (const name of LAYOUTS) bind(`midiMenu${name[0].toUpperCase() + name.slice(1)}`, 'click', () => setLayout(name));
    bind('midiGamePlay', 'click', () => { getLemmings()?.game?.getGameTimer?.()?.toggle?.(); refreshClock(); });
    bind('midiGameStep', 'click', () => {
      const view = getLemmings(); view?.game?.getGameTimer?.()?.suspend?.(); view?.nextFrame?.(); refreshClock();
    });
    bind('midiGameStop', 'click', () => { getLemmings()?.game?.getGameTimer?.()?.suspend?.(); panic(); refreshClock(); });
    paired('midiGameSpeed', 'midiGameSpeedValue', 0.1, 8, speed => { getLemmings()?.selectSpeedFactor?.(speed); refreshClock(); });
    paired('midiSoundPitchDial', null, 0, 127, note => {
      const m = getSource()?.mapping || {}, old = m.note ?? m.notes?.[0] ?? 60;
      updateMapping({ note, ...(m.notes?.length ? { notes: m.notes.map(n => clamp(n + note - old, 0, 127)) } : {}) });
    });
    paired('midiSoundLevel', 'midiSoundLevelNumber', 1, 127, velocity => updateMapping({ velocity }));
    paired('midiSoundDuration', 'midiSoundDurationNumber', 1, 96, durationTicks => updateMapping({ durationTicks }));
    paired('midiSoundPan', 'midiSoundPanNumber', -127, 127, pan => updateMapping({ pan }));
    bind('midiBehaviorChoices', 'click', event => {
      const behavior = event.target?.dataset?.behavior;
      const source = getSource(), patch = createEventBehaviorPatch(source, behavior, getProject().global.scale);
      if (patch) updateSource({ mode: 'direct', clipId: null, mapping: { ...source.mapping, ...patch } });
    });
    bind('midiSoundOrder', 'change', event => {
      const mode = event.target.value;
      if (['up', 'down', 'updown'].includes(mode)) updateMapping({ arp: { ...getSource()?.mapping?.arp, mode } });
    });
    bind('midiSoundSnapshot', 'click', () => { const source = getSource(); if (source) references.set(source.id, soundReference(source)); setStatus('Sound reference saved for this session'); });
    bind('midiSoundRevert', 'click', () => { const source = getSource(), ref = references.get(source?.id); if (ref) updateSource(cloneSafeObject(ref)); });
    for (const id of ['midiUndo', 'midiMenuUndo']) bind(id, 'click', () => { history.undo(getProject(), commitProject); render(); });
    for (const id of ['midiRedo', 'midiMenuRedo']) bind(id, 'click', () => { history.redo(getProject(), commitProject); render(); });
    for (const [id, target] of Object.entries({ midiMenuImport: 'midiProjectImportButton', midiMenuExport: 'midiProjectExportButton', midiMenuSave: 'midiTemplateSaveButton', midiMenuPanic: 'midiPanicButton' })) bind(id, 'click', () => byId(target)?.click?.());
    bind('midiMenuProject', 'click', () => chooseView('project'));
    bind('midiMenuDevices', 'click', () => chooseView('devices'));
    bind('midiInspectTrack', 'click', () => {
      const p = getProject(), source = getSource();
      if (source?.trackId) commitProject({ ...p, ui: { ...p.ui, selectedTrackId: source.trackId, activeRegion: 'tracks' } });
      chooseView('expert');
      const inspector = byId('midiTrackInspector'); if (inspector) inspector.open = true;
      byId('midiTrackName')?.focus?.();
    });
    bind('midiSequencerWorkspace', 'keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || String(event.key).toLowerCase() !== 'z') return;
      const tag = event.target?.tagName?.toLowerCase();
      if (['input', 'textarea'].includes(tag) || event.target?.isContentEditable) return;
      event.preventDefault?.(); event.stopPropagation?.();
      (event.shiftKey ? history.redo : history.undo)(getProject(), commitProject); render();
    });
    bind('midiInstrumentMenus', 'click', event => {
      if (event.target?.tagName?.toLowerCase() !== 'button') return;
      for (const menu of Array.from(byId('midiInstrumentMenus')?.querySelectorAll?.('details') || [])) menu.open = false;
    });
    bind('midiInstrumentMenus', 'keydown', event => {
      if (event.key !== 'Escape') return;
      for (const menu of Array.from(byId('midiInstrumentMenus')?.querySelectorAll?.('details') || [])) {
        if (menu.open) { menu.open = false; menu.querySelector?.('summary')?.focus?.(); }
      }
      event.preventDefault?.(); event.stopPropagation?.();
    });
  };
  return { initialize, render, setVisible, setLayout, refreshClock,
    getState: () => ({ layout, visible, clock: gameClock(getLemmings()?.game?.getGameTimer?.()), lastEvent: lastEvent && { sfxId: lastEvent.sfxId, tick: lastEvent.tick } }),
    dispose: () => { setVisible(false); references.clear(); activity.clear(); } };
};

export { createMidiInstrumentWorkbench, gameClock, LAYOUTS };
