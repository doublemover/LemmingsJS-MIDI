import { getAppContext, getRuntimeDependency } from '../core/dependencies.js';
import {
  AUTOMATION_AXES,
  AUTOMATION_TARGETS,
  createDefaultMidiStep,
  createEmptyDirectMapping,
  createMidiProjectFromMidiConfig,
  detectMidiProjectConflicts,
  projectToMidiConfig,
  reduceMidiProject,
  sanitizeMidiProject
} from '../midi/project/MidiProject.js';
import {
  PROJECT_STORAGE_KEY,
  cleanupLegacyMidiProjectStorage,
  readStoredMidiProject,
  resetMidiProjectStorage,
  saveMidiProject
} from '../midi/project/MidiProjectStorage.js';
import {
  populateMidiSelect,
  resolveMidiId,
  toDeviceList
} from './midi-ui/midiUiDevices.js';
import { collectTriggerTypes, buildTriggerLabel } from './midi-ui/midiUiDomain.js';
import { toMidiFlagTriggerType } from '../midi/MidiFlagTriggers.js';
import { cloneSafeObject, isPlainObject } from '../util/safeObject.js';

const SOURCE_KIND_LABELS = Object.freeze({
  sfx: 'SFX',
  trigger: 'Trigger',
  midiFlag: 'MIDI flag',
  system: 'System',
  procgen: 'Procgen'
});

const CHORD_TYPES = Object.freeze([
  'triad',
  'seventh',
  'sixth',
  'ninth',
  'power',
  'sus2',
  'sus4',
  'octave'
]);

const AUTOMATION_TARGET_LABELS = Object.freeze({
  note: 'Note',
  velocity: 'Velocity',
  pan: 'Pan',
  duration: 'Duration',
  timbre: 'Timbre',
  attack: 'Attack',
  decay: 'Decay',
  sustain: 'Sustain',
  release: 'Release'
});

const STEP_FIELD_COUNT = 32;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toNumberOrNull = (value) => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const formatSourceKey = (source) => `${source.kind}:${source.sourceKey}`;

const isActionableConflict = (issue) => issue?.severity !== 'info';

const setText = (element, value) => {
  if (element) element.textContent = value;
};

const setInputValue = (element, value) => {
  if (!element) return;
  const next = value == null ? '' : String(value);
  if (element.value !== next) element.value = next;
};

const setChecked = (element, value) => {
  if (element) element.checked = !!value;
};

const removeChildren = (element) => {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
};

const appendOption = (document, select, value, label) => {
  const option = document.createElement('option');
  option.value = value == null ? '' : String(value);
  option.textContent = label;
  select.appendChild(option);
};

const createMidiUiController = ({
  window = getRuntimeDependency('window', null),
  document = getRuntimeDependency('document', null),
  getLemmings = () => getAppContext(),
  getWebMidi = () => getRuntimeDependency('webMidi', null),
  getMidiConfig = null
} = {}) => {
  const storage = window?.localStorage || getRuntimeDependency('localStorage', null);
  const domListeners = [];
  const outputLog = [];
  let project = null;
  let projectNeedsFactory = false;
  let bound = false;
  let activeMidiInput = null;
  let midiInputController = null;
  let deviceRefreshTimer = null;
  let deviceListenersBound = false;
  let deviceListener = null;
  let refreshTimer = null;
  let lastStatus = 'Project loading';
  const sourceFilters = {
    search: '',
    kind: 'all',
    assignment: 'all'
  };

  const getFactoryConfig = () => {
    if (typeof getMidiConfig === 'function') return getMidiConfig();
    const lemmings = getLemmings();
    return lemmings?.getMidiBaseConfig?.() || null;
  };

  const getProjectConfig = () => projectToMidiConfig(ensureProject(), getFactoryConfig() || {});

  const getConflictReport = () => detectMidiProjectConflicts(ensureProject(), {
    availableOutputIds: toDeviceList(getWebMidi()?.outputs)
      .map(output => output?.id)
      .filter(Boolean),
    requireOutput: false
  });

  const getSourceConflicts = (report, sourceId, { includeInfo = false } = {}) => (
    (report.bySourceId?.[sourceId] || []).filter(issue => includeInfo || isActionableConflict(issue))
  );

  const readOrCreateProject = () => {
    cleanupLegacyMidiProjectStorage(storage);
    const stored = readStoredMidiProject(storage);
    if (stored) {
      projectNeedsFactory = false;
      return stored;
    }
    const factory = getFactoryConfig();
    if (factory) {
      projectNeedsFactory = false;
      return saveMidiProject(storage, createMidiProjectFromMidiConfig(factory));
    }
    projectNeedsFactory = true;
    return createMidiProjectFromMidiConfig({ enabled: false, sfx: {}, triggers: {} });
  };

  const ensureProject = () => {
    if (!project) {
      project = readOrCreateProject();
    }
    if (projectNeedsFactory) {
      const factory = getFactoryConfig();
      if (factory) {
        project = saveMidiProject(storage, createMidiProjectFromMidiConfig(factory));
        projectNeedsFactory = false;
      }
    }
    return project;
  };

  const getRuntimeLevel = () => {
    const lemmings = getLemmings();
    return lemmings?.game?.level || lemmings?.level || null;
  };

  const syncRuntimeSources = () => {
    const current = ensureProject();
    const level = getRuntimeLevel();
    if (!level) return current;
    const byKey = new Set(current.sources.map(formatSourceKey));
    const nextSources = current.sources.slice();
    const triggerTypes = collectTriggerTypes(level);
    for (const triggerType of triggerTypes) {
      const key = String(triggerType);
      const kind = 'trigger';
      const sourceKey = `${kind}:${key}`;
      if (byKey.has(sourceKey)) continue;
      byKey.add(sourceKey);
      nextSources.push({
        id: `${kind}-${key}`,
        kind,
        sourceKey: key,
        label: buildTriggerLabel(triggerType),
        enabled: true,
        trackId: current.tracks[0]?.id || 'track-1',
        mode: 'direct',
        mapping: createEmptyDirectMapping(),
        clipId: null
      });
    }
    const flags = Array.isArray(level.midiFlags) ? level.midiFlags : [];
    for (const flag of flags) {
      const triggerType = Number.isFinite(flag?.triggerType)
        ? Math.trunc(flag.triggerType)
        : toMidiFlagTriggerType(flag?.id);
      if (!Number.isFinite(triggerType)) continue;
      const key = String(triggerType);
      const kind = 'midiFlag';
      const sourceKey = `${kind}:${key}`;
      if (byKey.has(sourceKey)) continue;
      byKey.add(sourceKey);
      const idLabel = Number.isFinite(flag?.id) ? `MIDI_FLAG_${flag.id}` : buildTriggerLabel(triggerType);
      nextSources.push({
        id: `${kind}-${key}`,
        kind,
        sourceKey: key,
        label: idLabel,
        enabled: true,
        trackId: current.tracks[0]?.id || 'track-1',
        mode: 'direct',
        mapping: createEmptyDirectMapping(),
        clipId: null
      });
    }
    if (nextSources.length === current.sources.length) return current;
    project = saveMidiProject(storage, sanitizeMidiProject({ ...current, sources: nextSources }));
    return project;
  };

  const applyProjectToRuntime = () => {
    const lemmings = getLemmings();
    if (!lemmings) return;
    const config = getProjectConfig();
    if (typeof lemmings.setMidiProjectConfig === 'function') {
      lemmings.setMidiProjectConfig(config);
    } else if (typeof lemmings.applyMidiOverrides === 'function') {
      lemmings.applyMidiOverrides(config);
    }
    lemmings.midiEnabled = !!project?.enabled;
  };

  const queueRender = () => {
    if (refreshTimer != null || typeof window?.setTimeout !== 'function') return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      render();
    }, 0);
  };

  const commitProject = (nextProject, { persist = true, apply = true, renderUi = true } = {}) => {
    project = sanitizeMidiProject(nextProject);
    if (persist) project = saveMidiProject(storage, project);
    if (apply) applyProjectToRuntime();
    if (renderUi) render();
    return project;
  };

  const dispatchProjectIntent = (intent) => {
    const current = ensureProject();
    const factory = getFactoryConfig() || {};
    const next = intent?.type === 'project.reset'
      ? createMidiProjectFromMidiConfig(factory)
      : reduceMidiProject(current, intent);
    return commitProject(next);
  };

  const resetProject = () => {
    project = resetMidiProjectStorage(storage, getFactoryConfig() || {});
    projectNeedsFactory = false;
    applyProjectToRuntime();
    render();
    return project;
  };

  const setProject = (nextProject) => commitProject(nextProject);

  const logOutput = (message) => {
    const text = String(message || '').trim();
    if (!text) return;
    outputLog.unshift(`${new Date().toLocaleTimeString()} ${text}`);
    outputLog.splice(8);
    renderOutputStatus();
  };

  const setStatus = (message) => {
    lastStatus = message;
    setText(document?.getElementById('midiProjectStatus'), message);
  };

  const showError = (message) => {
    setText(document?.getElementById('errorDisplay'), message || '');
  };

  const renderChannelOptions = (select, value, { includeOmni = false } = {}) => {
    if (!select || select.dataset.channelsBound === 'true') return;
    removeChildren(select);
    if (includeOmni) appendOption(document, select, 'omni', 'Omni');
    for (let channel = 1; channel <= 16; channel += 1) {
      appendOption(document, select, channel, String(channel));
    }
    select.dataset.channelsBound = 'true';
    select.value = String(value ?? (includeOmni ? 'omni' : 1));
  };

  const selectedTrack = () => {
    const current = ensureProject();
    return current.tracks.find(track => track.id === current.ui.selectedTrackId) || current.tracks[0] || null;
  };

  const selectedSource = () => {
    const current = ensureProject();
    return current.sources.find(source => source.id === current.ui.selectedSourceId) || current.sources[0] || null;
  };

  const selectedClip = () => {
    const current = ensureProject();
    return current.clips.find(clip => clip.id === current.ui.selectedClipId) || current.clips[0] || null;
  };

  const setActiveMidiInput = (inputId) => {
    const webMidi = getWebMidi();
    if (!inputId || !webMidi?.enabled) {
      midiInputController?.detach?.();
      activeMidiInput = null;
      return;
    }
    const input = webMidi.getInputById?.(inputId) || toDeviceList(webMidi.inputs).find(device => device?.id === inputId);
    if (!input) {
      midiInputController?.detach?.();
      activeMidiInput = null;
      return;
    }
    if (activeMidiInput === input) return;
    if (activeMidiInput) midiInputController?.detach?.();
    midiInputController?.attach?.(input);
    activeMidiInput = input;
  };

  const setActiveMidiOutput = (outputId) => {
    const webMidi = getWebMidi();
    const lemmings = getLemmings();
    const output = outputId && webMidi?.enabled
      ? (webMidi.getOutputById?.(outputId) || toDeviceList(webMidi.outputs).find(device => device?.id === outputId) || null)
      : null;
    if (lemmings?.midiOut === output) return;
    lemmings?.midiRouter?.scheduler?.allNotesOff?.();
    lemmings?.midiRouter?.scheduler?.clearQueue?.();
    if (lemmings) lemmings.midiOut = output;
  };

  const refreshDeviceLists = ({ preserveSelection = true } = {}) => {
    const current = ensureProject();
    const webMidi = getWebMidi();
    const inputs = toDeviceList(webMidi?.inputs);
    const outputs = toDeviceList(webMidi?.outputs);
    const inputSelect = document?.getElementById('midiInSelect');
    const outputSelect = document?.getElementById('midiOutSelect');
    populateMidiSelect(document, inputSelect, inputs, 'No input devices');
    populateMidiSelect(document, outputSelect, outputs, 'No output devices');
    const currentInput = preserveSelection ? (current.devices.inputId || activeMidiInput?.id || inputSelect?.value) : null;
    const currentOutput = preserveSelection ? (current.devices.outputId || getLemmings()?.midiOut?.id || outputSelect?.value) : null;
    const inputId = resolveMidiId(inputs, currentInput);
    const outputId = resolveMidiId(outputs, currentOutput);
    if (inputSelect) inputSelect.value = inputId || '';
    if (outputSelect) outputSelect.value = outputId || '';
    if (inputId !== current.devices.inputId || outputId !== current.devices.outputId) {
      project = saveMidiProject(storage, reduceMidiProject(current, {
        type: 'devices.set',
        devices: { inputId, outputId }
      }));
      applyProjectToRuntime();
    }
    setActiveMidiInput(inputId);
    setActiveMidiOutput(outputId);
    const missing = [];
    if (!inputs.length) missing.push('No input device');
    if (!outputs.length) missing.push('No output device');
    showError(missing.join('. '));
  };

  const scheduleDeviceRefresh = () => {
    if (deviceRefreshTimer != null || typeof window?.setTimeout !== 'function') return;
    deviceRefreshTimer = window.setTimeout(() => {
      deviceRefreshTimer = null;
      if (getWebMidi()?.enabled) refreshDeviceLists({ preserveSelection: true });
    }, 100);
  };

  const bindDeviceListeners = () => {
    const webMidi = getWebMidi();
    if (!webMidi?.addListener || deviceListenersBound) return;
    deviceListener = () => scheduleDeviceRefresh();
    webMidi.addListener('connected', deviceListener);
    webMidi.addListener('disconnected', deviceListener);
    webMidi.addListener('portschanged', deviceListener);
    deviceListenersBound = true;
  };

  const unbindDeviceListeners = () => {
    const webMidi = getWebMidi();
    if (!webMidi?.removeListener || !deviceListenersBound || !deviceListener) return;
    webMidi.removeListener('connected', deviceListener);
    webMidi.removeListener('disconnected', deviceListener);
    webMidi.removeListener('portschanged', deviceListener);
    deviceListenersBound = false;
    deviceListener = null;
  };

  const onEnabled = () => {
    bindDeviceListeners();
    refreshDeviceLists({ preserveSelection: true });
  };

  const panic = () => {
    const scheduler = getLemmings()?.midiRouter?.scheduler;
    scheduler?.allNotesOff?.();
    scheduler?.clearQueue?.();
    logOutput('Panic sent');
    return true;
  };

  const resolveAuditionMapping = (request = {}) => {
    const current = ensureProject();
    const source = request.sourceId
      ? current.sources.find(entry => entry.id === request.sourceId)
      : selectedSource();
    const track = request.trackId
      ? current.tracks.find(entry => entry.id === request.trackId)
      : current.tracks.find(entry => entry.id === source?.trackId) || selectedTrack();
    const clip = request.clipId
      ? current.clips.find(entry => entry.id === request.clipId)
      : current.clips.find(entry => entry.id === source?.clipId) || selectedClip();
    if (source?.mode === 'clip' || request.clipId) {
      return { source, track, mapping: clipToMapping(clip), clip };
    }
    const mapping = isPlainObject(request.mapping)
      ? sanitizeMidiProject({ ...current, sources: [{ ...source, mapping: request.mapping }] }).sources[0]?.mapping
      : source?.mapping;
    return { source, track, mapping, clip: null };
  };

  const clipToMapping = (clip) => {
    const current = ensureProject();
    const steps = Array.isArray(clip?.steps)
      ? clip.steps
        .filter(step => Number.isFinite(step?.note) && (step.probability ?? 1) > 0 && !step.tie)
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      : [];
    const first = steps[0] || null;
    if (!first) return null;
    const notes = steps.map(step => clamp(Math.round(step.note), 0, 127));
    return {
      note: notes[0],
      notes: notes.length > 1 ? notes : null,
      velocity: first.velocity ?? current.global.velocityRange.default ?? 80,
      durationTicks: first.durationTicks ?? current.global.durationTicks.default ?? 6,
      arp: clip?.type === 'arp' && notes.length > 1
        ? { enabled: true, mode: 'up', length: notes.length }
        : null
    };
  };

  const resolveAuditionNote = (mapping) => {
    if (Number.isFinite(mapping?.note)) return clamp(Math.round(mapping.note), 0, 127);
    if (Array.isArray(mapping?.notes) && Number.isFinite(mapping.notes[0])) {
      return clamp(Math.round(mapping.notes[0]), 0, 127);
    }
    if (Number.isFinite(mapping?.degree)) {
      const current = ensureProject();
      const scale = current.global.scale;
      const degrees = Array.isArray(scale.degrees) && scale.degrees.length ? scale.degrees : [0];
      const degree = Math.max(0, Math.round(mapping.degree));
      const octave = Number.isFinite(mapping.octave) ? Math.round(mapping.octave) : 4;
      const octaveOffset = Math.floor(degree / degrees.length);
      const degreeOffset = degrees[degree % degrees.length] || 0;
      return clamp(scale.root + degreeOffset + ((octave + octaveOffset) * 12), 0, 127);
    }
    return 60;
  };

  const audition = (request = {}) => {
    const { source, track, mapping, clip } = resolveAuditionMapping(request);
    if (!track || !mapping) {
      logOutput('Audition skipped: no source');
      return false;
    }
    const scheduler = getLemmings()?.midiRouter?.scheduler;
    if (!scheduler?.sendNote) {
      logOutput('Audition skipped: no router');
      return false;
    }
    if (track.mute || (ensureProject().tracks.some(item => item.solo && !item.mute) && !track.solo)) {
      logOutput(`Audition skipped: ${track.name} muted`);
      return false;
    }
    const notes = Array.isArray(mapping.notes) && mapping.notes.length
      ? mapping.notes.map(note => clamp(Math.round(note), 0, 127))
      : [resolveAuditionNote(mapping)];
    const velocity = mapping.velocity ?? ensureProject().global.velocityRange.default ?? 80;
    const durationTicks = mapping.durationTicks ?? ensureProject().global.durationTicks.default ?? 6;
    let sent = false;
    for (const note of notes) {
      sent = scheduler.sendNote({
        note,
        velocity,
        durationTicks,
        channel: track.channel,
        timeMs: Date.now()
      }, {
        sfxId: source?.kind === 'sfx' ? Number(source.sourceKey) || 0 : 0,
        triggerType: source && source.kind !== 'sfx' ? Number(source.sourceKey) || null : null,
        eventType: clip ? 'clip-audition' : 'audition',
        priority: track.priority,
        sourceId: source?.id ?? null,
        trackId: track.id,
        clipId: clip?.id ?? null
      }) || sent;
    }
    const label = clip?.name || source?.label || 'clip';
    logOutput(sent ? `Audition ${label} -> ${track.name} ch ${track.channel} notes ${notes.join(',')}` : 'Audition skipped: no output');
    return !!sent;
  };

  const patchGlobal = (patch) => {
    const current = ensureProject();
    commitProject({
      ...current,
      global: sanitizeMidiProject({ ...current, global: { ...current.global, ...patch } }).global
    });
  };

  const applyRuntimePatch = (patch) => {
    if (!isPlainObject(patch)) return ensureProject();
    let current = ensureProject();
    if (patch.timing) {
      current = reduceMidiProject(current, {
        type: 'transport.set',
        transport: {
          bpmBase: patch.timing.bpmBase ?? current.transport.bpmBase,
          timeSignature: patch.timing.timeSignature ?? current.transport.timeSignature
        }
      });
    }
    if (patch.input) {
      current = reduceMidiProject(current, {
        type: 'devices.set',
        devices: { inputChannel: patch.input.channel ?? current.devices.inputChannel }
      });
    }
    project = current;
    if (patch.scale || patch.noteRange || patch.velocityRange || patch.durationTicks || patch.mpe || patch.limits || patch.reverse) {
      patchGlobal({
        ...(patch.scale ? { scale: { ...current.global.scale, ...patch.scale } } : {}),
        ...(patch.noteRange ? { noteRange: { ...current.global.noteRange, ...patch.noteRange } } : {}),
        ...(patch.velocityRange ? { velocityRange: { ...current.global.velocityRange, ...patch.velocityRange } } : {}),
        ...(patch.durationTicks ? { durationTicks: { ...current.global.durationTicks, ...patch.durationTicks } } : {}),
        ...(patch.mpe ? { mpe: { ...current.global.mpe, ...patch.mpe } } : {}),
        ...(patch.limits ? { limits: { ...current.global.limits, ...patch.limits } } : {}),
        ...(patch.reverse ? { reverse: { ...current.global.reverse, ...patch.reverse } } : {})
      });
      current = ensureProject();
    }
    const updateGroup = (group, kind) => {
      if (!isPlainObject(group)) return;
      for (const [sourceKey, mappingPatch] of Object.entries(group)) {
        const source = current.sources.find(item =>
          item.sourceKey === String(sourceKey) &&
          (kind === 'sfx' ? item.kind === 'sfx' : (item.kind === 'trigger' || item.kind === 'midiFlag'))
        );
        if (!source) continue;
        current = reduceMidiProject(current, {
          type: 'source.mapping.update',
          sourceId: source.id,
          patch: mappingPatch
        });
      }
    };
    updateGroup(patch.sfx, 'sfx');
    updateGroup(patch.triggers, 'trigger');
    return commitProject(current);
  };

  const filteredSources = (report = getConflictReport()) => {
    const current = ensureProject();
    const search = sourceFilters.search.trim().toLowerCase();
    return current.sources.filter(source => {
      const conflicts = getSourceConflicts(report, source.id);
      if (sourceFilters.kind !== 'all' && source.kind !== sourceFilters.kind) return false;
      if (sourceFilters.assignment === 'assigned' && !source.trackId) return false;
      if (sourceFilters.assignment === 'unassigned' && source.trackId) return false;
      if (sourceFilters.assignment === 'enabled' && !source.enabled) return false;
      if (sourceFilters.assignment === 'disabled' && source.enabled) return false;
      if (sourceFilters.assignment === 'conflicts' && !conflicts.length) return false;
      if (sourceFilters.assignment === 'clean' && conflicts.length) return false;
      if (!search) return true;
      return `${source.label} ${source.kind} ${source.sourceKey}`.toLowerCase().includes(search);
    });
  };

  const renderSourceList = () => {
    const current = ensureProject();
    const list = document?.getElementById('midiSourceList');
    if (!list) return;
    removeChildren(list);
    const report = getConflictReport();
    const sources = filteredSources(report);
    setText(document.getElementById('midiSourceCount'), String(sources.length));
    for (const source of sources) {
      const track = current.tracks.find(item => item.id === source.trackId);
      const conflicts = getSourceConflicts(report, source.id);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'midi-source-row';
      row.classList.toggle('is-selected', current.ui.selectedSourceId === source.id);
      row.classList.toggle('is-disabled', !source.enabled);
      row.classList.toggle('has-conflict', conflicts.length > 0);
      row.dataset.sourceId = source.id;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', current.ui.selectedSourceId === source.id ? 'true' : 'false');
      const label = document.createElement('span');
      label.className = 'midi-source-row__label';
      label.textContent = source.label;
      const pill = document.createElement('span');
      pill.className = 'midi-pill';
      pill.textContent = SOURCE_KIND_LABELS[source.kind] || source.kind;
      const meta = document.createElement('span');
      meta.className = 'midi-source-row__meta';
      meta.textContent = `${source.sourceKey} -> ${track?.name || 'Unassigned'}`;
      row.append(label, pill);
      if (conflicts.length) {
        const badge = document.createElement('span');
        badge.className = 'midi-conflict-badge';
        badge.dataset.conflictCount = String(conflicts.length);
        badge.title = conflicts.map(issue => issue.message).join('\n');
        badge.textContent = String(conflicts.length);
        row.appendChild(badge);
      }
      row.appendChild(meta);
      row.addEventListener('click', () => dispatchProjectIntent({ type: 'source.select', sourceId: source.id }));
      list.appendChild(row);
    }
    if (!sources.length) {
      const empty = document.createElement('div');
      empty.className = 'midi-selection-summary';
      empty.textContent = 'No sources match the filters';
      list.appendChild(empty);
    }
  };

  const renderTrackList = () => {
    const current = ensureProject();
    const list = document?.getElementById('midiTrackList');
    if (!list) return;
    removeChildren(list);
    for (const track of current.tracks) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'midi-track-row';
      row.classList.toggle('is-selected', current.ui.selectedTrackId === track.id);
      row.dataset.trackId = track.id;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', current.ui.selectedTrackId === track.id ? 'true' : 'false');
      const label = document.createElement('span');
      label.className = 'midi-track-row__label';
      label.textContent = track.name;
      const meta = document.createElement('span');
      meta.className = 'midi-track-row__meta';
      meta.textContent = `ch ${track.channel} | ${track.instrumentLabel}${track.mute ? ' | muted' : ''}${track.solo ? ' | solo' : ''}`;
      row.append(label, meta);
      row.addEventListener('click', () => dispatchProjectIntent({ type: 'track.select', trackId: track.id }));
      list.appendChild(row);
    }
  };

  const renderClipList = () => {
    const current = ensureProject();
    const list = document?.getElementById('midiClipList');
    if (!list) return;
    removeChildren(list);
    for (const clip of current.clips) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'midi-clip-row';
      row.classList.toggle('is-selected', current.ui.selectedClipId === clip.id);
      row.dataset.clipId = clip.id;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', current.ui.selectedClipId === clip.id ? 'true' : 'false');
      const label = document.createElement('span');
      label.className = 'midi-clip-row__label';
      label.textContent = clip.name;
      const meta = document.createElement('span');
      meta.className = 'midi-clip-row__meta';
      meta.textContent = `${clip.type} | ${clip.lengthSteps} steps`;
      row.append(label, meta);
      row.addEventListener('click', () => dispatchProjectIntent({ type: 'clip.select', clipId: clip.id }));
      list.appendChild(row);
    }
    if (!current.clips.length) {
      const empty = document.createElement('div');
      empty.className = 'midi-selection-summary';
      empty.textContent = 'No clips yet';
      list.appendChild(empty);
    }
  };

  const renderTrackOptions = (select, selectedId) => {
    if (!select) return;
    removeChildren(select);
    for (const track of ensureProject().tracks) {
      appendOption(document, select, track.id, `${track.name} (ch ${track.channel})`);
    }
    select.value = selectedId || ensureProject().tracks[0]?.id || '';
  };

  const renderClipOptions = (select, selectedId) => {
    if (!select) return;
    removeChildren(select);
    const clips = ensureProject().clips;
    if (!clips.length) {
      appendOption(document, select, '', 'No clips');
      select.disabled = true;
      return;
    }
    select.disabled = false;
    for (const clip of clips) {
      appendOption(document, select, clip.id, `${clip.name} (${clip.lengthSteps})`);
    }
    select.value = selectedId || selectedClip()?.id || clips[0]?.id || '';
  };

  const renderStepPatternGrid = (clip) => {
    const grid = document?.getElementById('midiStepPatternGrid');
    if (!grid) return;
    removeChildren(grid);
    if (!clip) {
      const empty = document.createElement('div');
      empty.className = 'midi-selection-summary';
      empty.textContent = 'Create a clip to edit steps';
      grid.appendChild(empty);
      return;
    }
    const count = Math.min(clip.lengthSteps || 0, STEP_FIELD_COUNT);
    for (let index = 0; index < count; index += 1) {
      const step = clip.steps[index] || createDefaultMidiStep(index, { note: null });
      const cell = document.createElement('div');
      cell.className = 'midi-step-cell';
      cell.dataset.stepIndex = String(index);
      cell.setAttribute('role', 'gridcell');
      const label = document.createElement('div');
      label.className = 'midi-step-cell__index';
      label.textContent = `Step ${index + 1}`;
      const noteLabel = document.createElement('label');
      noteLabel.textContent = 'Note';
      const note = document.createElement('input');
      note.className = 'midi-step-note';
      note.dataset.stepIndex = String(index);
      note.type = 'number';
      note.min = '0';
      note.max = '127';
      note.step = '1';
      note.value = step.note == null ? '' : String(step.note);
      note.addEventListener('change', event => updateSelectedClipStep(index, { note: toNumberOrNull(event.target.value) }));
      noteLabel.appendChild(note);
      const velocityLabel = document.createElement('label');
      velocityLabel.textContent = 'Vel';
      const velocity = document.createElement('input');
      velocity.className = 'midi-step-velocity';
      velocity.dataset.stepIndex = String(index);
      velocity.type = 'number';
      velocity.min = '1';
      velocity.max = '127';
      velocity.step = '1';
      velocity.value = step.velocity == null ? '' : String(step.velocity);
      velocity.addEventListener('change', event => updateSelectedClipStep(index, { velocity: toNumberOrNull(event.target.value) }));
      velocityLabel.appendChild(velocity);
      const probabilityLabel = document.createElement('label');
      probabilityLabel.textContent = 'Prob';
      const probability = document.createElement('input');
      probability.className = 'midi-step-probability';
      probability.dataset.stepIndex = String(index);
      probability.type = 'number';
      probability.min = '0';
      probability.max = '1';
      probability.step = '0.05';
      probability.value = step.probability == null ? '1' : String(step.probability);
      probability.addEventListener('change', event => updateSelectedClipStep(index, { probability: toNumberOrNull(event.target.value) ?? 1 }));
      probabilityLabel.appendChild(probability);
      const holdLabel = document.createElement('label');
      holdLabel.textContent = 'Hold';
      const hold = document.createElement('input');
      hold.className = 'midi-step-hold';
      hold.dataset.stepIndex = String(index);
      hold.type = 'checkbox';
      hold.checked = !!step.hold;
      hold.addEventListener('change', event => updateSelectedClipStep(index, { hold: !!event.target.checked }));
      holdLabel.appendChild(hold);
      const tieLabel = document.createElement('label');
      tieLabel.textContent = 'Tie';
      const tie = document.createElement('input');
      tie.className = 'midi-step-tie';
      tie.dataset.stepIndex = String(index);
      tie.type = 'checkbox';
      tie.checked = !!step.tie;
      tie.addEventListener('change', event => updateSelectedClipStep(index, { tie: !!event.target.checked }));
      tieLabel.appendChild(tie);
      cell.append(label, noteLabel, velocityLabel, probabilityLabel, holdLabel, tieLabel);
      grid.appendChild(cell);
    }
  };

  const renderClipInspector = () => {
    const clip = selectedClip();
    setInputValue(document?.getElementById('midiClipName'), clip?.name);
    setInputValue(document?.getElementById('midiClipType'), clip?.type);
    setInputValue(document?.getElementById('midiClipLengthSteps'), clip?.lengthSteps);
    renderStepPatternGrid(clip);
  };

  const renderAutomationList = () => {
    const current = ensureProject();
    const list = document?.getElementById('midiAutomationList');
    if (!list) return;
    removeChildren(list);
    for (const lane of current.automation) {
      const row = document.createElement('div');
      row.className = 'midi-automation-row';
      row.dataset.automationId = lane.id;

      const enabledLabel = document.createElement('label');
      enabledLabel.className = 'midi-field midi-field--toggle';
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = !!lane.enabled;
      enabled.addEventListener('change', event => dispatchProjectIntent({
        type: 'automation.update',
        automationId: lane.id,
        patch: { enabled: !!event.target.checked }
      }));
      const enabledText = document.createElement('span');
      enabledText.textContent = 'On';
      enabledLabel.append(enabledText, enabled);

      const targetLabel = document.createElement('label');
      targetLabel.className = 'midi-field midi-field--compact';
      const targetText = document.createElement('span');
      targetText.textContent = 'Target';
      const target = document.createElement('select');
      for (const value of AUTOMATION_TARGETS) {
        appendOption(document, target, value, AUTOMATION_TARGET_LABELS[value] || value);
      }
      target.value = lane.target;
      target.addEventListener('change', event => dispatchProjectIntent({
        type: 'automation.update',
        automationId: lane.id,
        patch: { target: event.target.value }
      }));
      targetLabel.append(targetText, target);

      const axisLabel = document.createElement('label');
      axisLabel.className = 'midi-field midi-field--compact';
      const axisText = document.createElement('span');
      axisText.textContent = 'Axis';
      const axis = document.createElement('select');
      for (const value of AUTOMATION_AXES) {
        appendOption(document, axis, value, value.toUpperCase());
      }
      axis.value = lane.axis;
      axis.addEventListener('change', event => dispatchProjectIntent({
        type: 'automation.update',
        automationId: lane.id,
        patch: { axis: event.target.value }
      }));
      axisLabel.append(axisText, axis);

      const minLabel = document.createElement('label');
      minLabel.className = 'midi-field midi-field--compact';
      const minText = document.createElement('span');
      minText.textContent = 'Min';
      const min = document.createElement('input');
      min.type = 'number';
      min.step = '0.05';
      min.value = String(lane.min);
      min.addEventListener('change', event => dispatchProjectIntent({
        type: 'automation.update',
        automationId: lane.id,
        patch: { min: Number(event.target.value) }
      }));
      minLabel.append(minText, min);

      const maxLabel = document.createElement('label');
      maxLabel.className = 'midi-field midi-field--compact';
      const maxText = document.createElement('span');
      maxText.textContent = 'Max';
      const max = document.createElement('input');
      max.type = 'number';
      max.step = '0.05';
      max.value = String(lane.max);
      max.addEventListener('change', event => dispatchProjectIntent({
        type: 'automation.update',
        automationId: lane.id,
        patch: { max: Number(event.target.value) }
      }));
      maxLabel.append(maxText, max);

      row.append(enabledLabel, targetLabel, axisLabel, minLabel, maxLabel);
      list.appendChild(row);
    }
    if (!current.automation.length) {
      const empty = document.createElement('div');
      empty.className = 'midi-selection-summary';
      empty.textContent = 'No modulation lanes';
      list.appendChild(empty);
    }
  };

  const renderModulation = () => {
    const current = ensureProject();
    setInputValue(document?.getElementById('midiGlobalIntensity'), current.global.velocityRange.default);
    setInputValue(document?.getElementById('midiGlobalAccent'), current.global.density.velocityBoost);
    setChecked(document?.getElementById('midiGlobalViewPan'), current.global.position.viewPan);
    renderAutomationList();
  };

  const renderConflictSummary = (report, source, track, clip) => {
    const element = document?.getElementById('midiConflictSummary');
    if (!element) return;
    removeChildren(element);
    element.textContent = '';
    const issuesById = new Map();
    const collect = (issues = []) => {
      for (const issue of issues) issuesById.set(issue.id, issue);
    };
    if (source?.id) collect(getSourceConflicts(report, source.id, { includeInfo: true }));
    if (track?.id) collect((report.byTrackId?.[track.id] || []).filter(isActionableConflict));
    if (clip?.id) collect((report.byClipId?.[clip.id] || []).filter(isActionableConflict));
    const issues = [...issuesById.values()];
    element.className = `midi-conflict-summary ${issues.some(isActionableConflict) ? 'has-conflict' : 'is-clean'}`;
    if (!issues.length) {
      element.textContent = 'No conflicts for the selected source.';
      return;
    }
    for (const issue of issues.slice(0, 5)) {
      const row = document.createElement('div');
      row.className = 'midi-conflict-summary__item';
      row.dataset.severity = issue.severity;
      row.textContent = issue.message;
      element.appendChild(row);
    }
    if (issues.length > 5) {
      const more = document.createElement('div');
      more.className = 'midi-conflict-summary__item';
      more.dataset.severity = 'info';
      more.textContent = `${issues.length - 5} more conflicts`;
      element.appendChild(more);
    }
  };

  const renderInspector = () => {
    const current = ensureProject();
    const track = selectedTrack();
    const source = selectedSource();
    const clip = selectedClip();
    const report = getConflictReport();
    setInputValue(document?.getElementById('midiTrackName'), track?.name);
    setInputValue(document?.getElementById('midiTrackInstrument'), track?.instrumentLabel);
    setInputValue(document?.getElementById('midiTrackChannel'), track?.channel);
    setInputValue(document?.getElementById('midiTrackPriority'), track?.priority);
    setInputValue(document?.getElementById('midiTrackVoiceBudget'), track?.voiceBudget);
    setInputValue(document?.getElementById('midiTrackVelocityScale'), track?.velocityScale);
    setChecked(document?.getElementById('midiTrackMute'), track?.mute);
    setChecked(document?.getElementById('midiTrackSolo'), track?.solo);
    setChecked(document?.getElementById('midiTrackArm'), track?.arm);

    setChecked(document?.getElementById('midiSourceEnabled'), source?.enabled);
    renderTrackOptions(document?.getElementById('midiSourceTrackSelect'), source?.trackId);
    renderTrackOptions(document?.getElementById('midiAssignTrackSelect'), track?.id);
    renderClipOptions(document?.getElementById('midiSourceClipSelect'), source?.clipId || clip?.id);
    setInputValue(document?.getElementById('midiSourceModeSelect'), source?.mode || 'direct');
    renderConflictSummary(report, source, track, source?.mode === 'clip' ? current.clips.find(item => item.id === source.clipId) || clip : clip);
    const mapping = source?.mapping || createEmptyDirectMapping();
    const directDisabled = source?.mode === 'clip';
    for (const id of [
      'midiMappingNote',
      'midiMappingDegree',
      'midiMappingOctave',
      'midiMappingVelocity',
      'midiMappingDuration',
      'midiMappingChord',
      'midiEnvelopeOverrideToggle'
    ]) {
      const element = document?.getElementById(id);
      if (element) element.disabled = directDisabled;
    }
    const envelopeEnabled = !!mapping.envelope && !directDisabled;
    setChecked(document?.getElementById('midiEnvelopeOverrideToggle'), !!mapping.envelope);
    for (const id of ['midiEnvAttack', 'midiEnvDecay', 'midiEnvSustain', 'midiEnvRelease']) {
      const element = document?.getElementById(id);
      if (element) element.disabled = !envelopeEnabled;
    }
    setInputValue(document?.getElementById('midiMappingNote'), mapping.note);
    setInputValue(document?.getElementById('midiMappingDegree'), mapping.degree);
    setInputValue(document?.getElementById('midiMappingOctave'), mapping.octave);
    setInputValue(document?.getElementById('midiMappingVelocity'), mapping.velocity);
    setInputValue(document?.getElementById('midiMappingDuration'), mapping.durationTicks);
    setInputValue(document?.getElementById('midiMappingChord'), mapping.chord?.type || '');
    setInputValue(document?.getElementById('midiEnvAttack'), mapping.envelope?.attack);
    setInputValue(document?.getElementById('midiEnvDecay'), mapping.envelope?.decay);
    setInputValue(document?.getElementById('midiEnvSustain'), mapping.envelope?.sustain);
    setInputValue(document?.getElementById('midiEnvRelease'), mapping.envelope?.release);

    const summary = source
      ? `${source.label} routes to ${current.tracks.find(item => item.id === source.trackId)?.name || 'no track'} in ${source.mode} mode${source.clipId ? ` using ${current.clips.find(item => item.id === source.clipId)?.name || source.clipId}` : ''}.`
      : 'No source selected';
    setText(document?.getElementById('midiSelectedSourceSummary'), summary);
  };

  const renderTransport = () => {
    const current = ensureProject();
    const enabledToggle = document?.getElementById('midiEnabledToggle');
    setChecked(enabledToggle, current.enabled);
    renderChannelOptions(document?.getElementById('midiInputChannel'), current.devices.inputChannel, { includeOmni: true });
    setInputValue(document?.getElementById('midiInputChannel'), current.devices.inputChannel);
    setInputValue(document?.getElementById('midiBpmBase'), current.transport.bpmBase);
    document?.body?.classList?.toggle('midi-disabled', !current.enabled);
    setStatus(current.enabled ? 'MIDI enabled' : 'MIDI disabled');
  };

  const renderOutputStatus = () => {
    const router = getLemmings()?.midiRouter;
    const report = router?.getRateReport?.();
    const pressure = report?.reason ? `Scheduler: ${report.reason}` : 'Scheduler: idle';
    setText(document?.getElementById('midiSchedulerPressure'), pressure);
    setText(document?.getElementById('midiOutputLog'), outputLog[0] || 'No output yet');
  };

  const render = () => {
    syncRuntimeSources();
    applyProjectToRuntime();
    renderTransport();
    renderSourceList();
    renderTrackList();
    renderClipList();
    renderInspector();
    renderModulation();
    renderClipInspector();
    renderOutputStatus();
    if (getWebMidi()?.enabled) refreshDeviceLists({ preserveSelection: true });
  };

  const addDomListener = (element, eventName, handler) => {
    if (!element?.addEventListener || typeof handler !== 'function') return;
    element.addEventListener(eventName, handler);
    domListeners.push({ element, eventName, handler });
  };

  const bindById = (id, eventName, handler) => addDomListener(document?.getElementById(id), eventName, handler);

  const updateGlobal = (patch) => {
    dispatchProjectIntent({ type: 'global.update', patch });
  };

  const updateSelectedTrack = (patch) => {
    const track = selectedTrack();
    if (!track) return;
    dispatchProjectIntent({ type: 'track.update', trackId: track.id, patch });
  };

  const updateSelectedSource = (patch) => {
    const source = selectedSource();
    if (!source) return;
    dispatchProjectIntent({ type: 'source.update', sourceId: source.id, patch });
  };

  const updateSelectedMapping = (patch) => {
    const source = selectedSource();
    if (!source) return;
    dispatchProjectIntent({ type: 'source.mapping.update', sourceId: source.id, patch });
  };

  const updateSelectedClip = (patch) => {
    const clip = selectedClip();
    if (!clip) return;
    dispatchProjectIntent({ type: 'clip.update', clipId: clip.id, patch });
  };

  const updateSelectedClipStep = (stepIndex, patch) => {
    const clip = selectedClip();
    if (!clip) return;
    dispatchProjectIntent({ type: 'clip.step.update', clipId: clip.id, stepIndex, patch });
  };

  const ensureSelectedClipId = () => {
    const current = ensureProject();
    if (current.ui.selectedClipId && current.clips.some(clip => clip.id === current.ui.selectedClipId)) {
      return current.ui.selectedClipId;
    }
    if (current.clips[0]) return current.clips[0].id;
    const next = dispatchProjectIntent({ type: 'clip.add', clip: {} });
    return next.ui.selectedClipId || next.clips[0]?.id || null;
  };

  const updateEnvelope = () => {
    const attack = toNumberOrNull(document?.getElementById('midiEnvAttack')?.value);
    const decay = toNumberOrNull(document?.getElementById('midiEnvDecay')?.value);
    const sustain = toNumberOrNull(document?.getElementById('midiEnvSustain')?.value);
    const release = toNumberOrNull(document?.getElementById('midiEnvRelease')?.value);
    const values = [attack, decay, sustain, release];
    updateSelectedMapping({
      envelope: values.every(value => value == null)
        ? null
        : {
          attack: attack ?? 0,
          decay: decay ?? 0,
          sustain: sustain ?? 1,
          release: release ?? 0
        }
    });
  };

  const bindMidiUi = () => {
    if (bound) return;
    ensureProject();
    cleanupLegacyMidiProjectStorage(storage);
    bindById('midiEnabledToggle', 'change', async event => {
      const enabled = !!event.target.checked;
      dispatchProjectIntent({ type: 'enabled.set', enabled });
      const lemmings = getLemmings();
      if (lemmings?.setMidiEnabled) await lemmings.setMidiEnabled(enabled);
      if (enabled && getWebMidi()?.enabled) onEnabled();
      if (!enabled) {
        unbindDeviceListeners();
        setActiveMidiInput(null);
        showError('');
      }
      render();
    });
    bindById('midiInSelect', 'change', event => {
      const inputId = event.target.value || null;
      dispatchProjectIntent({ type: 'devices.set', devices: { inputId } });
      setActiveMidiInput(inputId);
    });
    bindById('midiOutSelect', 'change', event => {
      const outputId = event.target.value || null;
      dispatchProjectIntent({ type: 'devices.set', devices: { outputId } });
      setActiveMidiOutput(outputId);
    });
    bindById('midiInputChannel', 'change', event => {
      dispatchProjectIntent({ type: 'devices.set', devices: { inputChannel: event.target.value || 'omni' } });
    });
    bindById('midiBpmBase', 'change', event => {
      dispatchProjectIntent({ type: 'transport.set', transport: { bpmBase: Number(event.target.value) || 120 } });
    });
    bindById('midiProjectResetButton', 'click', () => resetProject());
    bindById('midiPanicButton', 'click', () => panic());
    bindById('midiSourceSearch', 'input', event => {
      sourceFilters.search = event.target.value || '';
      renderSourceList();
    });
    bindById('midiSourceKindFilter', 'change', event => {
      sourceFilters.kind = event.target.value || 'all';
      renderSourceList();
    });
    bindById('midiSourceAssignFilter', 'change', event => {
      sourceFilters.assignment = event.target.value || 'all';
      renderSourceList();
    });
    bindById('midiTrackAdd', 'click', () => dispatchProjectIntent({ type: 'track.add', track: {} }));
    bindById('midiClipAddButton', 'click', () => dispatchProjectIntent({ type: 'clip.add', clip: {} }));
    bindById('midiAssignSourceButton', 'click', () => {
      const source = selectedSource();
      const trackId = document?.getElementById('midiAssignTrackSelect')?.value;
      if (source && trackId) dispatchProjectIntent({ type: 'source.assignTrack', sourceId: source.id, trackId });
    });
    bindById('midiAssignClipButton', 'click', () => {
      const source = selectedSource();
      const clipId = document?.getElementById('midiSourceClipSelect')?.value || ensureSelectedClipId();
      if (source && clipId) dispatchProjectIntent({ type: 'source.clip.assign', sourceId: source.id, clipId });
    });
    bindById('midiAuditionButton', 'click', () => audition());
    bindById('midiClipAuditionButton', 'click', () => audition({ clipId: selectedClip()?.id, trackId: selectedTrack()?.id }));
    bindById('midiTrackName', 'change', event => updateSelectedTrack({ name: event.target.value }));
    bindById('midiTrackInstrument', 'change', event => updateSelectedTrack({ instrumentLabel: event.target.value }));
    bindById('midiTrackChannel', 'change', event => updateSelectedTrack({ channel: Number(event.target.value) || 1 }));
    bindById('midiTrackPriority', 'change', event => updateSelectedTrack({ priority: Number(event.target.value) || 0 }));
    bindById('midiTrackVoiceBudget', 'change', event => updateSelectedTrack({ voiceBudget: Number(event.target.value) || 1 }));
    bindById('midiTrackVelocityScale', 'change', event => updateSelectedTrack({ velocityScale: Number(event.target.value) }));
    bindById('midiTrackMute', 'change', event => updateSelectedTrack({ mute: !!event.target.checked }));
    bindById('midiTrackSolo', 'change', event => updateSelectedTrack({ solo: !!event.target.checked }));
    bindById('midiTrackArm', 'change', event => updateSelectedTrack({ arm: !!event.target.checked }));
    bindById('midiSourceEnabled', 'change', event => updateSelectedSource({ enabled: !!event.target.checked }));
    bindById('midiSourceTrackSelect', 'change', event => {
      const source = selectedSource();
      if (source) dispatchProjectIntent({ type: 'source.assignTrack', sourceId: source.id, trackId: event.target.value });
    });
    bindById('midiSourceModeSelect', 'change', event => {
      const source = selectedSource();
      if (!source) return;
      const mode = event.target.value === 'clip' ? 'clip' : 'direct';
      const clipId = mode === 'clip' ? ensureSelectedClipId() : null;
      dispatchProjectIntent({ type: 'source.mode.set', sourceId: source.id, mode, clipId });
    });
    bindById('midiSourceClipSelect', 'change', event => {
      const source = selectedSource();
      if (source && event.target.value) dispatchProjectIntent({ type: 'source.clip.assign', sourceId: source.id, clipId: event.target.value });
    });
    bindById('midiMappingNote', 'change', event => {
      const note = toNumberOrNull(event.target.value);
      updateSelectedMapping({ note, degree: note == null ? selectedSource()?.mapping?.degree ?? null : null, chord: note == null ? selectedSource()?.mapping?.chord ?? null : null });
    });
    bindById('midiMappingDegree', 'change', event => {
      const degree = toNumberOrNull(event.target.value);
      updateSelectedMapping({ degree, note: degree == null ? selectedSource()?.mapping?.note ?? null : null });
    });
    bindById('midiMappingOctave', 'change', event => updateSelectedMapping({ octave: Number(event.target.value) || 4 }));
    bindById('midiMappingVelocity', 'change', event => updateSelectedMapping({ velocity: toNumberOrNull(event.target.value) }));
    bindById('midiMappingDuration', 'change', event => updateSelectedMapping({ durationTicks: toNumberOrNull(event.target.value) }));
    bindById('midiMappingChord', 'change', event => {
      const type = event.target.value;
      updateSelectedMapping({
        chord: CHORD_TYPES.includes(type) ? { type, inversion: 0 } : null,
        note: type ? null : selectedSource()?.mapping?.note ?? null,
        degree: type ? selectedSource()?.mapping?.degree ?? 0 : selectedSource()?.mapping?.degree ?? null
      });
    });
    bindById('midiEnvelopeOverrideToggle', 'change', event => {
      updateSelectedMapping({
        envelope: event.target.checked
          ? { attack: 1, decay: 0, sustain: 1, release: 1 }
          : null
      });
    });
    for (const id of ['midiEnvAttack', 'midiEnvDecay', 'midiEnvSustain', 'midiEnvRelease']) {
      bindById(id, 'change', updateEnvelope);
    }
    bindById('midiGlobalIntensity', 'change', event => {
      const current = ensureProject();
      const velocityRange = { ...current.global.velocityRange, default: Number(event.target.value) || current.global.velocityRange.default };
      updateGlobal({ velocityRange });
    });
    bindById('midiGlobalAccent', 'change', event => {
      const current = ensureProject();
      const density = { ...current.global.density, velocityBoost: Number(event.target.value) || 0 };
      updateGlobal({ density });
    });
    bindById('midiGlobalViewPan', 'change', event => {
      const current = ensureProject();
      updateGlobal({ position: { ...current.global.position, viewPan: !!event.target.checked } });
    });
    bindById('midiAutomationAddButton', 'click', () => {
      const current = ensureProject();
      const targets = ['note', 'velocity', 'pan', 'duration'];
      const target = targets.find(item => !current.automation.some(lane => lane.target === item)) || 'velocity';
      dispatchProjectIntent({ type: 'automation.add', automation: { target, axis: target === 'velocity' ? 'y' : 'x' } });
    });
    bindById('midiClipName', 'change', event => updateSelectedClip({ name: event.target.value }));
    bindById('midiClipType', 'change', event => updateSelectedClip({ type: event.target.value }));
    bindById('midiClipLengthSteps', 'change', event => updateSelectedClip({ lengthSteps: Number(event.target.value) || 16 }));
    setMidiUiHook();
    render();
    bound = true;
  };

  const disposeDomListeners = () => {
    while (domListeners.length) {
      const { element, eventName, handler } = domListeners.pop();
      element.removeEventListener?.(eventName, handler);
    }
  };

  const clearMidiUiHook = () => {
    if (!window || !Object.prototype.hasOwnProperty.call(window, '__LEMMINGS_MIDI_UI__')) return;
    try {
      delete window.__LEMMINGS_MIDI_UI__;
    } catch (e) {
      window.__LEMMINGS_MIDI_UI__ = undefined;
    }
  };

  const setMidiUiHook = () => {
    if (!window) return;
    window.__LEMMINGS_MIDI_UI__ = {
      getProject: () => cloneSafeObject(ensureProject()),
      dispatchProjectIntent,
      setProject,
      resetProject,
      audition,
      panic
    };
  };

  const dispose = () => {
    if (refreshTimer != null && typeof window?.clearTimeout === 'function') {
      window.clearTimeout(refreshTimer);
    }
    if (deviceRefreshTimer != null && typeof window?.clearTimeout === 'function') {
      window.clearTimeout(deviceRefreshTimer);
    }
    refreshTimer = null;
    deviceRefreshTimer = null;
    unbindDeviceListeners();
    disposeDomListeners();
    clearMidiUiHook();
    midiInputController?.detach?.();
    activeMidiInput = null;
    bound = false;
  };

  return {
    bindMidiUi,
    scheduleMidiUiRefresh: queueRender,
    refreshMidiUiFromConfig: render,
    onEnabled,
    showError,
    getMidiStatusHandlers() {
      return { onEnabled, onError: showError };
    },
    getProject: () => cloneSafeObject(ensureProject()),
    dispatchProjectIntent,
    setProject,
    resetProject,
    audition,
    panic,
    applyRuntimePatch,
    getMidiConfig: getProjectConfig,
    getStoredEnabled() {
      cleanupLegacyMidiProjectStorage(storage);
      const stored = readStoredMidiProject(storage);
      if (stored) return !!stored.enabled;
      const factory = getFactoryConfig();
      return !!factory?.enabled;
    },
    setMidiInputController(controller) {
      if (midiInputController && midiInputController !== controller) {
        midiInputController.detach?.();
      }
      midiInputController = controller;
      if (activeMidiInput) midiInputController?.attach?.(activeMidiInput);
    },
    setActiveMidiInput,
    setActiveMidiOutput,
    dispose,
    getStorageKeys() {
      return { project: PROJECT_STORAGE_KEY };
    }
  };
};

export { createMidiUiController };
