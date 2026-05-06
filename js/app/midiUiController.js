import { getAppContext, getRuntimeDependency } from '../core/dependencies.js';
import {
  AUTOMATION_AXES,
  AUTOMATION_TARGETS,
  ARP_MODES,
  createDefaultMidiStep,
  createEmptyDirectMapping,
  createMidiProjectExportPayload,
  createMidiProjectFromMidiConfig,
  detectMidiProjectConflicts,
  importMidiProjectPayload,
  projectToMidiConfig,
  reduceMidiProject,
  sanitizeMidiProject
} from '../midi/project/MidiProject.js';
import {
  PROJECT_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
  cleanupLegacyMidiProjectStorage,
  readStoredMidiProject,
  readStoredMidiProjectTemplates,
  resetMidiProjectStorage,
  saveMidiProject,
  saveMidiProjectTemplate
} from '../midi/project/MidiProjectStorage.js';
import {
  downloadTextFile as downloadTextFileDefault,
  readTextFile as readTextFileDefault
} from './editor-ui/editorUiFiles.js';
import {
  populateMidiSelect,
  resolveMidiId,
  toDeviceList
} from './midi-ui/midiUiDevices.js';
import {
  ARP_PATTERN_PRESETS,
  collectTriggerTypes,
  buildTriggerLabel,
  createArpPatternFromPreset,
  deriveArpModeFromPattern,
  POSITION_AXIS_OPERATORS,
  resolveAvailableSfxIds
} from './midi-ui/midiUiDomain.js';
import { isMidiFlagTriggerType, toMidiFlagTriggerType } from '../midi/MidiFlagTriggers.js';
import {
  buildChordNotes,
  clampNoteToRange,
  DEFAULT_SCALES,
  resolveScale
} from '../midi/midi-mapping/MidiMappingDomain.js';
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

const KEY_ROOT_LABELS = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
const SCALE_LABELS = Object.freeze({
  major: 'Major',
  minor: 'Minor',
  dorian: 'Dorian',
  mixolydian: 'Mixolydian',
  pentatonic: 'Pentatonic',
  chromatic: 'Chromatic',
  'chromatic-minor': 'Chromatic minor'
});

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
const STEP_GRID_COLUMNS = 4;
const STEP_GRID_FIELD_CLASSES = Object.freeze([
  'midi-step-note',
  'midi-step-velocity',
  'midi-step-duration',
  'midi-step-probability',
  'midi-step-hold',
  'midi-step-tie'
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toNumberOrNull = (value) => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const formatSourceKey = (source) => `${source.kind}:${source.sourceKey}`;
const domIdSafe = (value, fallback = 'item') => {
  const text = String(value || fallback).replace(/[^a-zA-Z0-9_-]+/g, '-');
  return text || fallback;
};
const listOptionId = (kind, id) => `midi-${kind}-option-${domIdSafe(id)}`;
const filenameSafe = (value, fallback) => {
  const text = String(value || fallback || 'midi-project')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback || 'midi-project';
};

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

const scalePresetDegrees = (name) => (
  Array.isArray(DEFAULT_SCALES[name]) ? [...DEFAULT_SCALES[name]] : null
);

const configureListbox = (list, activeOptionId) => {
  if (!list) return;
  list.tabIndex = 0;
  list.setAttribute('aria-orientation', 'vertical');
  list.setAttribute('aria-activedescendant', activeOptionId || '');
};

const handleListboxNavigation = (event, items, getId, currentId, selectId) => {
  if (!event || !Array.isArray(items) || !items.length) return false;
  const key = event.key;
  if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(key)) return false;
  const currentIndex = items.findIndex(item => getId(item) === currentId);
  let nextIndex = currentIndex;
  if (key === 'Home') {
    nextIndex = 0;
  } else if (key === 'End') {
    nextIndex = items.length - 1;
  } else if (key === 'ArrowDown' || key === 'ArrowRight') {
    nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, items.length - 1);
  } else if (key === 'ArrowUp' || key === 'ArrowLeft') {
    nextIndex = currentIndex < 0 ? items.length - 1 : Math.max(currentIndex - 1, 0);
  }
  event.preventDefault?.();
  const nextId = getId(items[nextIndex]);
  if (nextId && nextId !== currentId) selectId(nextId);
  return true;
};

const stepGridFieldClass = (target) => STEP_GRID_FIELD_CLASSES.find(className => target?.classList?.contains?.(className)) || null;

const sourceChangeSnapshot = (source = {}) => ({
  enabled: !!source.enabled,
  trackId: source.trackId || '',
  mode: source.mode === 'clip' ? 'clip' : 'direct',
  mapping: source.mode === 'clip' ? null : source.mapping || null,
  clipId: source.mode === 'clip' ? source.clipId || null : null
});

const focusStepGridField = (grid, fieldClass, stepIndex) => {
  const fields = Array.from(grid?.querySelectorAll?.(`.${fieldClass}`) || []);
  const field = fields.find(item => Number(item.dataset?.stepIndex) === stepIndex);
  field?.focus?.();
};

const handleStepGridNavigation = (event, grid, stepCount) => {
  if (!event || stepCount <= 0) return false;
  const fieldClass = stepGridFieldClass(event.target);
  if (!fieldClass) return false;
  const currentIndex = Number(event.target?.dataset?.stepIndex);
  if (!Number.isInteger(currentIndex)) return false;
  const key = event.key;
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return false;
  let nextIndex = currentIndex;
  if (key === 'Home') {
    nextIndex = 0;
  } else if (key === 'End') {
    nextIndex = stepCount - 1;
  } else if (key === 'ArrowRight') {
    nextIndex = Math.min(currentIndex + 1, stepCount - 1);
  } else if (key === 'ArrowLeft') {
    nextIndex = Math.max(currentIndex - 1, 0);
  } else if (key === 'ArrowDown') {
    nextIndex = Math.min(currentIndex + STEP_GRID_COLUMNS, stepCount - 1);
  } else if (key === 'ArrowUp') {
    nextIndex = Math.max(currentIndex - STEP_GRID_COLUMNS, 0);
  }
  event.preventDefault?.();
  if (nextIndex !== currentIndex) focusStepGridField(grid, fieldClass, nextIndex);
  return true;
};

const createMidiUiController = ({
  window = getRuntimeDependency('window', null),
  document = getRuntimeDependency('document', null),
  getLemmings = () => getAppContext(),
  getWebMidi = () => getRuntimeDependency('webMidi', null),
  getMidiConfig = null,
  downloadTextFile = downloadTextFileDefault,
  readTextFile = readTextFileDefault
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
  let factorySourceIndex = null;
  const learnState = {
    active: false,
    pending: null,
    sourceId: null,
    trackId: null,
    conflicts: []
  };
  const recordState = {
    active: false,
    clipId: null,
    trackId: null,
    notes: [],
    activeNotes: new Map()
  };
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

  const captureFactoryProject = (factoryConfig = getFactoryConfig() || {}) => {
    const factoryProject = createMidiProjectFromMidiConfig(factoryConfig || {});
    factorySourceIndex = new Map(factoryProject.sources.map(source => [formatSourceKey(source), source]));
    return factoryProject;
  };

  const getFactorySourceIndex = () => {
    if (!factorySourceIndex) captureFactoryProject();
    return factorySourceIndex;
  };

  const defaultRuntimeSourceSnapshot = (source, currentProject = ensureProject()) => sourceChangeSnapshot({
    enabled: true,
    trackId: currentProject.tracks[0]?.id || 'track-1',
    mode: 'direct',
    mapping: createEmptyDirectMapping(),
    clipId: null
  });

  const isSourceChangedFromFactory = (source, factorySources = getFactorySourceIndex(), currentProject = ensureProject()) => {
    const factorySource = factorySources.get(formatSourceKey(source));
    const baseline = factorySource
      ? sourceChangeSnapshot(factorySource)
      : defaultRuntimeSourceSnapshot(source, currentProject);
    return JSON.stringify(sourceChangeSnapshot(source)) !== JSON.stringify(baseline);
  };

  const sourceBaselinePatch = (source, currentProject = ensureProject(), factorySources = getFactorySourceIndex()) => {
    const factorySource = factorySources.get(formatSourceKey(source));
    if (factorySource) {
      return {
        label: factorySource.label,
        enabled: factorySource.enabled,
        trackId: factorySource.trackId,
        mode: factorySource.mode,
        mapping: cloneSafeObject(factorySource.mapping) || createEmptyDirectMapping(),
        clipId: factorySource.clipId
      };
    }
    return {
      label: source.label,
      enabled: true,
      trackId: currentProject.tracks[0]?.id || 'track-1',
      mode: 'direct',
      mapping: createEmptyDirectMapping(),
      clipId: null
    };
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
    const factory = getFactoryConfig();
    const factoryProject = factory ? captureFactoryProject(factory) : null;
    const stored = readStoredMidiProject(storage);
    if (stored) {
      projectNeedsFactory = false;
      return stored;
    }
    if (factoryProject) {
      projectNeedsFactory = false;
      return saveMidiProject(storage, factoryProject);
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
        project = saveMidiProject(storage, captureFactoryProject(factory));
        projectNeedsFactory = false;
      }
    }
    return project;
  };

  const getRuntimeLevel = () => {
    const lemmings = getLemmings();
    return lemmings?.game?.level || lemmings?.level || null;
  };

  const getRuntimeSkills = () => {
    const lemmings = getLemmings();
    return (
      lemmings?.game?.getGameSkills?.() ||
      lemmings?.getGameSkills?.() ||
      lemmings?.game?.skills ||
      lemmings?.skills ||
      null
    );
  };

  const getAvailableSourceKeys = (currentProject = ensureProject()) => {
    const keys = new Set();
    const level = getRuntimeLevel();
    const skills = getRuntimeSkills();
    const add = (kind, sourceKey) => keys.add(`${kind}:${String(sourceKey)}`);
    const sfxConfig = { sfx: {} };
    for (const source of currentProject.sources) {
      if (source.kind === 'sfx') sfxConfig.sfx[source.sourceKey] = { name: source.label };
    }
    for (const id of resolveAvailableSfxIds(sfxConfig, level, skills)) {
      add('sfx', id);
    }
    for (const triggerType of collectTriggerTypes(level)) {
      if (!isMidiFlagTriggerType(triggerType)) add('trigger', triggerType);
    }
    const flags = Array.isArray(level?.midiFlags) ? level.midiFlags : [];
    for (const flag of flags) {
      const triggerType = Number.isFinite(flag?.triggerType)
        ? Math.trunc(flag.triggerType)
        : toMidiFlagTriggerType(flag?.id);
      if (Number.isFinite(triggerType)) add('midiFlag', triggerType);
    }
    return keys;
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
      ? captureFactoryProject(factory)
      : reduceMidiProject(current, intent);
    return commitProject(next);
  };

  const getProjectTemplates = () => readStoredMidiProjectTemplates(storage);

  const selectedTemplateId = () => (
    document?.getElementById('midiTemplateSelect')?.value ||
    ensureProject().templateId ||
    'midi-mapping'
  );

  const resetProject = (templateId = null) => {
    const factory = getFactoryConfig() || {};
    captureFactoryProject(factory);
    project = resetMidiProjectStorage(storage, factory, templateId || selectedTemplateId());
    projectNeedsFactory = false;
    applyProjectToRuntime();
    render();
    return project;
  };

  const setProject = (nextProject) => commitProject(nextProject);

  const saveProjectTemplate = (options = {}) => {
    const template = saveMidiProjectTemplate(storage, ensureProject(), options);
    setStatus(`Saved template ${template.name}`);
    renderTransport();
    return template;
  };

  const exportProject = (options = {}) => {
    const current = ensureProject();
    const payload = createMidiProjectExportPayload(current, options);
    const name = payload.template?.name || payload.project?.name || current.name;
    const suffix = options.asTemplate ? 'template' : 'project';
    const filename = `${filenameSafe(name, `midi-${suffix}`)}.lemmings-midi-${suffix}.json`;
    if (options.download !== false) {
      downloadTextFile(
        document,
        `${JSON.stringify(payload, null, 2)}\n`,
        filename,
        'application/json'
      );
      logOutput(`Exported ${options.asTemplate ? 'template' : 'project'}`);
    }
    return payload;
  };

  const importProject = (payload) => {
    const imported = importMidiProjectPayload(payload);
    projectNeedsFactory = false;
    const next = commitProject(imported);
    setStatus(`Imported ${next.name}`);
    logOutput(`Imported ${next.name}`);
    return next;
  };

  const importProjectFile = async (file) => {
    if (!file) return null;
    try {
      return importProject(await readTextFile(file));
    } catch (e) {
      const message = e?.message || 'MIDI project import failed.';
      showError(message);
      setStatus('Import failed');
      return null;
    }
  };

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

  const renderScaleRootOptions = (select, selectedRoot) => {
    if (!select) return;
    removeChildren(select);
    for (let root = 0; root < KEY_ROOT_LABELS.length; root += 1) {
      appendOption(document, select, root, KEY_ROOT_LABELS[root]);
    }
    select.value = String(selectedRoot ?? 0);
  };

  const renderScaleNameOptions = (select, selectedName) => {
    if (!select) return;
    removeChildren(select);
    for (const name of Object.keys(DEFAULT_SCALES)) {
      appendOption(document, select, name, SCALE_LABELS[name] || name);
    }
    if (selectedName && !DEFAULT_SCALES[selectedName]) {
      appendOption(document, select, selectedName, selectedName);
    }
    select.value = selectedName || 'chromatic-minor';
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

  const selectedLearnSource = () => {
    const source = selectedSource();
    return source?.mode === 'clip' ? null : source;
  };

  const clearLearnCapture = () => {
    midiInputController?.setNoteCapture?.(null);
  };

  const previewLearnProject = (capture) => {
    const current = ensureProject();
    const source = current.sources.find(entry => entry.id === learnState.sourceId) || selectedLearnSource();
    const track = current.tracks.find(entry => entry.id === learnState.trackId) ||
      current.tracks.find(entry => entry.id === source?.trackId) ||
      selectedTrack();
    if (!source || !track || !capture) return current;
    let preview = reduceMidiProject(current, {
      type: 'source.mapping.update',
      sourceId: source.id,
      patch: {
        note: capture.note,
        velocity: capture.velocity,
        degree: null,
        notes: null,
        chord: null
      }
    });
    if (track.arm) {
      preview = reduceMidiProject(preview, {
        type: 'track.update',
        trackId: track.id,
        patch: { channel: capture.channel }
      });
    }
    return preview;
  };

  const renderLearnPanel = () => {
    const panel = document?.getElementById('midiLearnPanel');
    if (!panel) return;
    const status = document?.getElementById('midiLearnStatus');
    const confirm = document?.getElementById('midiLearnConfirmButton');
    const cancel = document?.getElementById('midiLearnCancelButton');
    const learn = document?.getElementById('midiLearnButton');
    const source = selectedLearnSource();
    panel.classList.toggle('is-active', learnState.active || !!learnState.pending);
    if (learn) learn.disabled = !source;
    if (confirm) confirm.disabled = !learnState.pending;
    if (cancel) cancel.disabled = !learnState.active && !learnState.pending;
    if (!status) return;
    if (!source) {
      status.textContent = 'Learn needs a direct source.';
      return;
    }
    if (learnState.pending) {
      const conflictText = learnState.conflicts.length
        ? ` ${learnState.conflicts.length} warning${learnState.conflicts.length === 1 ? '' : 's'}.`
        : ' No conflicts.';
      status.textContent = `Pending note ${learnState.pending.note}, velocity ${learnState.pending.velocity}, channel ${learnState.pending.channel}.${conflictText}`;
      return;
    }
    status.textContent = learnState.active
      ? `Listening for ${source.label}.`
      : 'Learn waits for the next note-on.';
  };

  const handleLearnNote = (note, velocity, channel) => {
    if (!learnState.active) return false;
    const capture = {
      note: clamp(Math.round(note), 0, 127),
      velocity: clamp(Math.round(velocity), 1, 127),
      channel: clamp(Math.round(channel), 1, 16)
    };
    learnState.pending = capture;
    const preview = previewLearnProject(capture);
    const report = detectMidiProjectConflicts(preview);
    learnState.conflicts = learnState.sourceId
      ? (report.bySourceId?.[learnState.sourceId] || []).filter(isActionableConflict)
      : [];
    clearLearnCapture();
    setStatus('Learn note captured');
    renderLearnPanel();
    return true;
  };

  const startLearn = () => {
    const source = selectedLearnSource();
    const track = selectedTrack();
    if (!source || !track) {
      setStatus('Learn unavailable');
      renderLearnPanel();
      return false;
    }
    learnState.active = true;
    learnState.pending = null;
    learnState.sourceId = source.id;
    learnState.trackId = track.id;
    learnState.conflicts = [];
    midiInputController?.setNoteCapture?.(handleLearnNote);
    setStatus('Learning next note');
    renderLearnPanel();
    return true;
  };

  const cancelLearn = () => {
    learnState.active = false;
    learnState.pending = null;
    learnState.sourceId = null;
    learnState.trackId = null;
    learnState.conflicts = [];
    clearLearnCapture();
    setStatus('Learn canceled');
    renderLearnPanel();
    return true;
  };

  const confirmLearn = () => {
    if (!learnState.pending || !learnState.sourceId) {
      renderLearnPanel();
      return false;
    }
    const current = ensureProject();
    const source = current.sources.find(entry => entry.id === learnState.sourceId);
    const track = current.tracks.find(entry => entry.id === learnState.trackId) ||
      current.tracks.find(entry => entry.id === source?.trackId);
    if (!source || source.mode === 'clip') {
      cancelLearn();
      return false;
    }
    let next = reduceMidiProject(current, {
      type: 'source.mapping.update',
      sourceId: source.id,
      patch: {
        note: learnState.pending.note,
        velocity: learnState.pending.velocity,
        degree: null,
        notes: null,
        chord: null
      }
    });
    if (track?.arm) {
      next = reduceMidiProject(next, {
        type: 'track.update',
        trackId: track.id,
        patch: { channel: learnState.pending.channel }
      });
    }
    const label = source.label;
    learnState.active = false;
    learnState.pending = null;
    learnState.sourceId = null;
    learnState.trackId = null;
    learnState.conflicts = [];
    clearLearnCapture();
    commitProject(next);
    logOutput(`Learned ${label}`);
    return true;
  };

  const clearRecordCapture = () => {
    midiInputController?.setMessageCapture?.(null);
  };

  const resetRecordState = () => {
    recordState.active = false;
    recordState.clipId = null;
    recordState.trackId = null;
    recordState.notes = [];
    recordState.activeNotes.clear();
  };

  const renderRecordPanel = () => {
    const panel = document?.getElementById('midiRecordPanel');
    if (!panel) return;
    const status = document?.getElementById('midiRecordStatus');
    const start = document?.getElementById('midiRecordButton');
    const commit = document?.getElementById('midiRecordCommitButton');
    const cancel = document?.getElementById('midiRecordCancelButton');
    const clip = selectedClip();
    panel.classList.toggle('is-active', recordState.active || recordState.notes.length > 0);
    if (start) start.disabled = !clip || recordState.active;
    if (commit) commit.disabled = !recordState.notes.length && !recordState.activeNotes.size;
    if (cancel) cancel.disabled = !recordState.active && !recordState.notes.length;
    if (!status) return;
    if (!clip) {
      status.textContent = 'Create a clip before recording.';
      return;
    }
    if (recordState.active) {
      status.textContent = `Recording into ${clip.name}: ${recordState.notes.length} notes captured.`;
      return;
    }
    status.textContent = recordState.notes.length
      ? `${recordState.notes.length} notes ready to commit.`
      : 'Record writes captured notes into clip steps.';
  };

  const noteKey = (event) => `${event.channel}:${event.note}`;

  const durationMsToTicks = (durationMs) => {
    const current = ensureProject();
    const fallback = current.global.durationTicks.default ?? 6;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return fallback;
    return clamp(Math.round(durationMs / 120), current.global.durationTicks.min, current.global.durationTicks.max);
  };

  const finishRecordNote = (event, fallbackTime = null) => {
    const key = noteKey(event);
    const started = recordState.activeNotes.get(key);
    if (!started) return;
    recordState.activeNotes.delete(key);
    const endTime = Number.isFinite(event.timestamp) ? event.timestamp : fallbackTime;
    recordState.notes.push({
      note: clamp(Math.round(started.note), 0, 127),
      velocity: clamp(Math.round(started.velocity), 1, 127),
      channel: clamp(Math.round(started.channel), 1, 16),
      durationTicks: durationMsToTicks((endTime ?? started.timestamp) - started.timestamp)
    });
  };

  const handleRecordMessage = (event) => {
    if (!recordState.active) return false;
    const type = event?.type;
    const note = Number(event?.note);
    const velocity = Number(event?.velocity ?? 0);
    if ((type !== 0x90 && type !== 0x80) || !Number.isFinite(note)) return false;
    const timestamp = Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
    const normalized = {
      note: clamp(Math.round(note), 0, 127),
      velocity: clamp(Math.round(velocity), 0, 127),
      channel: clamp(Math.round(event.channel), 1, 16),
      timestamp
    };
    if (type === 0x90 && normalized.velocity > 0) {
      finishRecordNote(normalized, timestamp);
      recordState.activeNotes.set(noteKey(normalized), normalized);
    } else {
      finishRecordNote(normalized, timestamp);
    }
    renderRecordPanel();
    return true;
  };

  const startRecording = () => {
    const clipId = ensureSelectedClipId();
    const clip = ensureProject().clips.find(entry => entry.id === clipId);
    if (!clip) {
      renderRecordPanel();
      return false;
    }
    cancelLearn();
    resetRecordState();
    recordState.active = true;
    recordState.clipId = clip.id;
    recordState.trackId = selectedTrack()?.id ?? null;
    midiInputController?.setMessageCapture?.(handleRecordMessage);
    setStatus('Recording MIDI clip');
    renderRecordPanel();
    return true;
  };

  const cancelRecording = () => {
    clearRecordCapture();
    resetRecordState();
    setStatus('Recording canceled');
    renderRecordPanel();
    return true;
  };

  const commitRecording = () => {
    const now = Date.now();
    for (const started of recordState.activeNotes.values()) {
      finishRecordNote({ ...started, timestamp: now }, now);
    }
    recordState.activeNotes.clear();
    clearRecordCapture();
    const current = ensureProject();
    const clipId = recordState.clipId || current.ui.selectedClipId;
    const clip = current.clips.find(entry => entry.id === clipId);
    if (!clip || !recordState.notes.length) {
      resetRecordState();
      renderRecordPanel();
      return false;
    }
    let next = current;
    recordState.notes.slice(0, clip.lengthSteps).forEach((note, index) => {
      next = reduceMidiProject(next, {
        type: 'clip.step.update',
        clipId: clip.id,
        stepIndex: index,
        patch: {
          note: note.note,
          velocity: note.velocity,
          durationTicks: note.durationTicks,
          probability: 1,
          hold: false,
          tie: false
        }
      });
    });
    const noteCount = Math.min(recordState.notes.length, clip.lengthSteps);
    resetRecordState();
    commitProject(next);
    logOutput(`Recorded ${noteCount} notes into ${clip.name}`);
    return true;
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
    clearMidiOutputState();
    if (lemmings) lemmings.midiOut = output;
  };

  const setAvailableMidiOutputs = (outputs) => {
    const router = getLemmings()?.midiRouter;
    if (router?.setOutputs) router.setOutputs(outputs);
    else router?.scheduler?.setOutputs?.(outputs);
  };

  const clearMidiOutputState = () => {
    const scheduler = getLemmings()?.midiRouter?.scheduler;
    scheduler?.allNotesOff?.();
    scheduler?.clearQueue?.();
  };

  const refreshDeviceLists = ({ preserveSelection = true } = {}) => {
    const current = ensureProject();
    const webMidi = getWebMidi();
    const inputs = toDeviceList(webMidi?.inputs);
    const outputs = toDeviceList(webMidi?.outputs);
    const inputSelect = document?.getElementById('midiInSelect');
    const outputSelect = document?.getElementById('midiOutSelect');
    setAvailableMidiOutputs(outputs);
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
    renderTrackOutputOptions(document?.getElementById('midiTrackOutputSelect'), selectedTrack()?.outputId);
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

  const resolveAuditionNotes = (mapping) => {
    if (Array.isArray(mapping?.notes) && mapping.notes.length) {
      return mapping.notes.map(note => clamp(Math.round(note), 0, 127));
    }
    if (mapping?.chord && (Number.isFinite(mapping.degree) || !Number.isFinite(mapping.note))) {
      const current = ensureProject();
      const scale = resolveScale(current.global.scale);
      const degree = Number.isFinite(mapping.degree) ? Math.max(0, Math.round(mapping.degree)) : 0;
      const octave = Number.isFinite(mapping.octave) ? Math.round(mapping.octave) : 4;
      const type = CHORD_TYPES.includes(mapping.chord?.type) ? mapping.chord.type : 'triad';
      const inversion = Number.isFinite(mapping.chord?.inversion) ? Math.max(0, Math.round(mapping.chord.inversion)) : 0;
      return buildChordNotes(degree, scale, octave, type, inversion)
        .map(note => clampNoteToRange(note, current.global.noteRange));
    }
    return [resolveAuditionNote(mapping)];
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
    const notes = resolveAuditionNotes(mapping);
    const velocity = mapping.velocity ?? ensureProject().global.velocityRange.default ?? 80;
    const durationTicks = mapping.durationTicks ?? ensureProject().global.durationTicks.default ?? 6;
    let sent = false;
    for (const note of notes) {
      sent = scheduler.sendNote({
        note,
        velocity,
        durationTicks,
        channel: track.channel,
        outputId: track.outputId ?? null,
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
          timeSignature: patch.timing.timeSignature ?? current.transport.timeSignature,
          quantize: patch.timing.quantize ?? current.transport.quantize,
          swing: patch.timing.swing ?? current.transport.swing
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
    if (patch.scale || patch.noteRange || patch.velocityRange || patch.durationTicks || patch.density || patch.envelope || patch.position || patch.mpe || patch.limits || patch.reverse) {
      const nextScaleDegrees = patch.scale?.name && !Array.isArray(patch.scale.degrees)
        ? scalePresetDegrees(patch.scale.name)
        : null;
      patchGlobal({
        ...(patch.scale ? {
          scale: {
            ...current.global.scale,
            ...patch.scale,
            ...(nextScaleDegrees ? { degrees: nextScaleDegrees } : {})
          }
        } : {}),
        ...(patch.noteRange ? { noteRange: { ...current.global.noteRange, ...patch.noteRange } } : {}),
        ...(patch.velocityRange ? { velocityRange: { ...current.global.velocityRange, ...patch.velocityRange } } : {}),
        ...(patch.durationTicks ? { durationTicks: { ...current.global.durationTicks, ...patch.durationTicks } } : {}),
        ...(patch.density ? { density: { ...current.global.density, ...patch.density } } : {}),
        ...(patch.envelope ? { envelope: { ...current.global.envelope, ...patch.envelope } } : {}),
        ...(patch.position ? { position: { ...current.global.position, ...patch.position } } : {}),
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
    const factorySources = sourceFilters.assignment === 'changed' ? getFactorySourceIndex() : null;
    const availableSourceKeys = sourceFilters.assignment === 'available' ? getAvailableSourceKeys(current) : null;
    return current.sources.filter(source => {
      const conflicts = getSourceConflicts(report, source.id);
      if (sourceFilters.kind !== 'all' && source.kind !== sourceFilters.kind) return false;
      if (sourceFilters.assignment === 'changed' && !isSourceChangedFromFactory(source, factorySources, current)) return false;
      if (sourceFilters.assignment === 'available' && !availableSourceKeys.has(formatSourceKey(source))) return false;
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
    const factorySources = getFactorySourceIndex();
    const activeOptionId = sources.some(source => source.id === current.ui.selectedSourceId)
      ? listOptionId('source', current.ui.selectedSourceId)
      : '';
    configureListbox(list, activeOptionId);
    setText(document.getElementById('midiSourceCount'), String(sources.length));
    for (const source of sources) {
      const track = current.tracks.find(item => item.id === source.trackId);
      const conflicts = getSourceConflicts(report, source.id);
      const changed = isSourceChangedFromFactory(source, factorySources, current);
      const selected = current.ui.selectedSourceId === source.id;
      const row = document.createElement('button');
      row.type = 'button';
      row.id = listOptionId('source', source.id);
      row.className = 'midi-source-row';
      row.classList.toggle('is-selected', selected);
      row.classList.toggle('is-disabled', !source.enabled);
      row.classList.toggle('is-changed', changed);
      row.classList.toggle('has-conflict', conflicts.length > 0);
      row.dataset.sourceId = source.id;
      row.tabIndex = selected ? 0 : -1;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      row.setAttribute('aria-label', `${source.label}, ${SOURCE_KIND_LABELS[source.kind] || source.kind}, ${track?.name || 'Unassigned'}${changed ? ', changed' : ''}${conflicts.length ? `, ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}` : ''}`);
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
      if (changed) {
        const changedPill = document.createElement('span');
        changedPill.className = 'midi-pill midi-pill--changed';
        changedPill.textContent = 'Changed';
        row.appendChild(changedPill);
      }
      if (conflicts.length) {
        const badge = document.createElement('span');
        badge.className = 'midi-conflict-badge';
        badge.dataset.conflictCount = String(conflicts.length);
        badge.title = conflicts.map(issue => issue.message).join('\n');
        badge.setAttribute('aria-hidden', 'true');
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
      empty.setAttribute('role', 'option');
      empty.setAttribute('aria-disabled', 'true');
      empty.setAttribute('aria-selected', 'false');
      empty.textContent = 'No sources match the filters';
      list.appendChild(empty);
    }
  };

  const renderTrackList = () => {
    const current = ensureProject();
    const list = document?.getElementById('midiTrackList');
    if (!list) return;
    removeChildren(list);
    const activeOptionId = current.tracks.some(track => track.id === current.ui.selectedTrackId)
      ? listOptionId('track', current.ui.selectedTrackId)
      : '';
    configureListbox(list, activeOptionId);
    for (const track of current.tracks) {
      const selected = current.ui.selectedTrackId === track.id;
      const row = document.createElement('button');
      row.type = 'button';
      row.id = listOptionId('track', track.id);
      row.className = 'midi-track-row';
      row.classList.toggle('is-selected', selected);
      row.dataset.trackId = track.id;
      row.tabIndex = selected ? 0 : -1;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      row.setAttribute('aria-label', `${track.name}, channel ${track.channel}, ${track.instrumentLabel}${track.mute ? ', muted' : ''}${track.solo ? ', solo' : ''}`);
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
    const activeOptionId = current.clips.some(clip => clip.id === current.ui.selectedClipId)
      ? listOptionId('clip', current.ui.selectedClipId)
      : '';
    configureListbox(list, activeOptionId);
    for (const clip of current.clips) {
      const selected = current.ui.selectedClipId === clip.id;
      const row = document.createElement('button');
      row.type = 'button';
      row.id = listOptionId('clip', clip.id);
      row.className = 'midi-clip-row';
      row.classList.toggle('is-selected', selected);
      row.dataset.clipId = clip.id;
      row.tabIndex = selected ? 0 : -1;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      row.setAttribute('aria-label', `${clip.name}, ${clip.type}, ${clip.lengthSteps} steps`);
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
      empty.setAttribute('role', 'option');
      empty.setAttribute('aria-disabled', 'true');
      empty.setAttribute('aria-selected', 'false');
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

  const renderTrackOutputOptions = (select, selectedOutputId) => {
    if (!select) return;
    removeChildren(select);
    appendOption(document, select, '', 'Project output');
    const outputs = toDeviceList(getWebMidi()?.outputs);
    const outputIds = new Set();
    for (const output of outputs) {
      if (!output?.id) continue;
      outputIds.add(output.id);
      appendOption(document, select, output.id, output.name || output.id);
    }
    if (selectedOutputId && !outputIds.has(selectedOutputId)) {
      appendOption(document, select, selectedOutputId, `Unavailable: ${selectedOutputId}`);
    }
    select.value = selectedOutputId || '';
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
      grid.setAttribute('aria-rowcount', '0');
      grid.setAttribute('aria-colcount', String(STEP_GRID_COLUMNS));
      const empty = document.createElement('div');
      empty.className = 'midi-selection-summary';
      empty.setAttribute('role', 'note');
      empty.textContent = 'Create a clip to edit steps';
      grid.appendChild(empty);
      return;
    }
    const count = Math.min(clip.lengthSteps || 0, STEP_FIELD_COUNT);
    grid.setAttribute('aria-rowcount', String(Math.ceil(count / STEP_GRID_COLUMNS)));
    grid.setAttribute('aria-colcount', String(STEP_GRID_COLUMNS));
    for (let index = 0; index < count; index += 1) {
      const step = clip.steps[index] || createDefaultMidiStep(index, { note: null });
      const stepLabel = `Step ${index + 1}`;
      const cell = document.createElement('div');
      cell.className = 'midi-step-cell';
      cell.dataset.stepIndex = String(index);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-rowindex', String(Math.floor(index / STEP_GRID_COLUMNS) + 1));
      cell.setAttribute('aria-colindex', String((index % STEP_GRID_COLUMNS) + 1));
      cell.setAttribute('aria-label', stepLabel);
      const label = document.createElement('div');
      label.className = 'midi-step-cell__index';
      label.textContent = stepLabel;
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
      note.setAttribute('aria-label', `${stepLabel} note`);
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
      velocity.setAttribute('aria-label', `${stepLabel} velocity`);
      velocity.addEventListener('change', event => updateSelectedClipStep(index, { velocity: toNumberOrNull(event.target.value) }));
      velocityLabel.appendChild(velocity);
      const durationLabel = document.createElement('label');
      durationLabel.textContent = 'Dur';
      const duration = document.createElement('input');
      duration.className = 'midi-step-duration';
      duration.dataset.stepIndex = String(index);
      duration.type = 'number';
      duration.min = '1';
      duration.max = '960';
      duration.step = '1';
      duration.value = step.durationTicks == null ? '' : String(step.durationTicks);
      duration.setAttribute('aria-label', `${stepLabel} duration`);
      duration.addEventListener('change', event => updateSelectedClipStep(index, { durationTicks: toNumberOrNull(event.target.value) }));
      durationLabel.appendChild(duration);
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
      probability.setAttribute('aria-label', `${stepLabel} probability`);
      probability.addEventListener('change', event => updateSelectedClipStep(index, { probability: toNumberOrNull(event.target.value) ?? 1 }));
      probabilityLabel.appendChild(probability);
      const holdLabel = document.createElement('label');
      holdLabel.textContent = 'Hold';
      const hold = document.createElement('input');
      hold.className = 'midi-step-hold';
      hold.dataset.stepIndex = String(index);
      hold.type = 'checkbox';
      hold.checked = !!step.hold;
      hold.setAttribute('aria-label', `${stepLabel} hold`);
      hold.addEventListener('change', event => updateSelectedClipStep(index, { hold: !!event.target.checked }));
      holdLabel.appendChild(hold);
      const tieLabel = document.createElement('label');
      tieLabel.textContent = 'Tie';
      const tie = document.createElement('input');
      tie.className = 'midi-step-tie';
      tie.dataset.stepIndex = String(index);
      tie.type = 'checkbox';
      tie.checked = !!step.tie;
      tie.setAttribute('aria-label', `${stepLabel} tie`);
      tie.addEventListener('change', event => updateSelectedClipStep(index, { tie: !!event.target.checked }));
      tieLabel.appendChild(tie);
      cell.append(label, noteLabel, velocityLabel, durationLabel, probabilityLabel, holdLabel, tieLabel);
      grid.appendChild(cell);
    }
  };

  const renderClipInspector = () => {
    const clip = selectedClip();
    const arpMode = document?.getElementById('midiClipArpMode');
    const arpModeField = document?.getElementById('midiClipArpModeField');
    const arpPattern = document?.getElementById('midiClipArpPattern');
    const arpPatternField = document?.getElementById('midiClipArpPatternField');
    const isArpClip = clip?.type === 'arp';
    setInputValue(document?.getElementById('midiClipName'), clip?.name);
    setInputValue(document?.getElementById('midiClipType'), clip?.type);
    setInputValue(arpMode, clip?.arp?.mode || 'up');
    setInputValue(arpPattern, clip?.arp?.pattern?.preset || clip?.arp?.mode || 'up');
    if (arpMode) arpMode.disabled = !isArpClip;
    if (arpPattern) arpPattern.disabled = !isArpClip;
    if (arpModeField) arpModeField.style.display = isArpClip ? '' : 'none';
    if (arpPatternField) arpPatternField.style.display = isArpClip ? '' : 'none';
    setInputValue(document?.getElementById('midiClipLengthSteps'), clip?.lengthSteps);
    renderRecordPanel();
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

      const opLabel = document.createElement('label');
      opLabel.className = 'midi-field midi-field--compact';
      const opText = document.createElement('span');
      opText.textContent = 'Op';
      const op = document.createElement('select');
      op.className = 'midi-automation-axis-op';
      for (const entry of POSITION_AXIS_OPERATORS) {
        appendOption(document, op, entry.value, entry.label);
      }
      op.value = lane.axisOp || 'add';
      op.addEventListener('change', event => dispatchProjectIntent({
        type: 'automation.update',
        automationId: lane.id,
        patch: { axisOp: event.target.value }
      }));
      opLabel.append(opText, op);

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

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'midi-automation-remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove modulation lane ${lane.name}`);
      remove.addEventListener('click', () => dispatchProjectIntent({
        type: 'automation.remove',
        automationId: lane.id
      }));

      row.append(enabledLabel, targetLabel, axisLabel, opLabel, minLabel, maxLabel, remove);
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
    setInputValue(document?.getElementById('midiGlobalVelocityMin'), current.global.velocityRange.min);
    setInputValue(document?.getElementById('midiGlobalVelocityMax'), current.global.velocityRange.max);
    setInputValue(document?.getElementById('midiGlobalNoteMin'), current.global.noteRange.min);
    setInputValue(document?.getElementById('midiGlobalNoteMax'), current.global.noteRange.max);
    setInputValue(document?.getElementById('midiGlobalAccent'), current.global.density.velocityBoost);
    setInputValue(document?.getElementById('midiGlobalDensityWindow'), current.global.density.windowTicks);
    setInputValue(document?.getElementById('midiGlobalDurationScale'), current.global.density.durationScale);
    setChecked(document?.getElementById('midiGlobalViewPan'), current.global.position.viewPan);
    setInputValue(document?.getElementById('midiGlobalPanMin'), current.global.position.panRange.min);
    setInputValue(document?.getElementById('midiGlobalPanMax'), current.global.position.panRange.max);
    setInputValue(document?.getElementById('midiGlobalPanDeadZone'), current.global.position.panDeadZonePct);
    setInputValue(document?.getElementById('midiGlobalMaxActiveNotes'), current.global.limits.maxActiveNotes);
    setInputValue(document?.getElementById('midiGlobalMaxEventsPerTick'), current.global.limits.maxEventsPerTick);
    setInputValue(document?.getElementById('midiGlobalDurationDefault'), current.global.durationTicks.default);
    setInputValue(document?.getElementById('midiGlobalDurationMin'), current.global.durationTicks.min);
    setInputValue(document?.getElementById('midiGlobalDurationMax'), current.global.durationTicks.max);
    setInputValue(document?.getElementById('midiGlobalEnvAttack'), current.global.envelope.attack);
    setInputValue(document?.getElementById('midiGlobalEnvDecay'), current.global.envelope.decay);
    setInputValue(document?.getElementById('midiGlobalEnvSustain'), current.global.envelope.sustain);
    setInputValue(document?.getElementById('midiGlobalEnvRelease'), current.global.envelope.release);
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
    renderTrackOutputOptions(document?.getElementById('midiTrackOutputSelect'), track?.outputId);
    setInputValue(document?.getElementById('midiTrackChannel'), track?.channel);
    setInputValue(document?.getElementById('midiTrackPriority'), track?.priority);
    setInputValue(document?.getElementById('midiTrackVoiceBudget'), track?.voiceBudget);
    setInputValue(document?.getElementById('midiTrackVelocityScale'), track?.velocityScale);
    setChecked(document?.getElementById('midiTrackMute'), track?.mute);
    setChecked(document?.getElementById('midiTrackSolo'), track?.solo);
    setChecked(document?.getElementById('midiTrackArm'), track?.arm);

    const revertButton = document?.getElementById('midiSourceRevertButton');
    if (revertButton) {
      revertButton.disabled = !source || !isSourceChangedFromFactory(source, getFactorySourceIndex(), current);
    }
    setChecked(document?.getElementById('midiSourceEnabled'), source?.enabled);
    renderTrackOptions(document?.getElementById('midiSourceTrackSelect'), source?.trackId);
    renderTrackOptions(document?.getElementById('midiAssignTrackSelect'), track?.id);
    renderClipOptions(document?.getElementById('midiSourceClipSelect'), source?.clipId || clip?.id);
    setInputValue(document?.getElementById('midiSourceModeSelect'), source?.mode || 'direct');
    renderConflictSummary(report, source, track, source?.mode === 'clip' ? current.clips.find(item => item.id === source.clipId) || clip : clip);
    renderLearnPanel();
    const mapping = source?.mapping || createEmptyDirectMapping();
    const directDisabled = source?.mode === 'clip';
    for (const id of [
      'midiMappingNote',
      'midiMappingDegree',
      'midiMappingOctave',
      'midiMappingVelocity',
      'midiMappingDuration',
      'midiMappingChord',
      'midiMappingChordInversion',
      'midiMappingArp',
      'midiMappingPan',
      'midiMappingTimbre',
      'midiMappingPitchBend',
      'midiEnvelopeOverrideToggle'
    ]) {
      const element = document?.getElementById(id);
      if (element) element.disabled = directDisabled;
    }
    const chordInversion = document?.getElementById('midiMappingChordInversion');
    if (chordInversion) chordInversion.disabled = directDisabled || !mapping.chord;
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
    setInputValue(document?.getElementById('midiMappingChordInversion'), mapping.chord?.inversion ?? 0);
    setInputValue(document?.getElementById('midiMappingArp'), mapping.arp?.enabled === false ? '' : mapping.arp?.mode || '');
    setInputValue(document?.getElementById('midiMappingPan'), mapping.pan);
    setInputValue(document?.getElementById('midiMappingTimbre'), mapping.timbre);
    setInputValue(document?.getElementById('midiMappingPitchBend'), mapping.pitchBend);
    setInputValue(document?.getElementById('midiEnvAttack'), mapping.envelope?.attack);
    setInputValue(document?.getElementById('midiEnvDecay'), mapping.envelope?.decay);
    setInputValue(document?.getElementById('midiEnvSustain'), mapping.envelope?.sustain);
    setInputValue(document?.getElementById('midiEnvRelease'), mapping.envelope?.release);

    const summary = source
      ? `${source.label} routes to ${current.tracks.find(item => item.id === source.trackId)?.name || 'no track'} in ${source.mode} mode${source.clipId ? ` using ${current.clips.find(item => item.id === source.clipId)?.name || source.clipId}` : ''}.`
      : 'No source selected';
    setText(document?.getElementById('midiSelectedSourceSummary'), summary);
  };

  const renderTemplateOptions = () => {
    const select = document?.getElementById('midiTemplateSelect');
    if (!select) return;
    const current = ensureProject();
    const selected = current.templateId || 'midi-mapping';
    removeChildren(select);
    appendOption(document, select, 'midi-mapping', 'Factory');
    for (const template of getProjectTemplates()) {
      appendOption(document, select, template.id, template.name);
    }
    select.value = Array.from(select.children).some(option => option.value === selected)
      ? selected
      : 'midi-mapping';
  };

  const renderTransport = () => {
    const current = ensureProject();
    const enabledToggle = document?.getElementById('midiEnabledToggle');
    setChecked(enabledToggle, current.enabled);
    renderChannelOptions(document?.getElementById('midiInputChannel'), current.devices.inputChannel, { includeOmni: true });
    setInputValue(document?.getElementById('midiInputChannel'), current.devices.inputChannel);
    setInputValue(document?.getElementById('midiBpmBase'), current.transport.bpmBase);
    setInputValue(document?.getElementById('midiTimeSignatureBeats'), current.transport.timeSignature?.beats ?? 4);
    setInputValue(document?.getElementById('midiTimeSignatureUnit'), current.transport.timeSignature?.unit ?? 4);
    renderScaleRootOptions(document?.getElementById('midiScaleRoot'), current.global.scale.root);
    renderScaleNameOptions(document?.getElementById('midiScaleName'), current.global.scale.name);
    setInputValue(document?.getElementById('midiQuantize'), current.transport.quantize);
    setInputValue(document?.getElementById('midiSwing'), current.transport.swing);
    renderTemplateOptions();
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

  const revertSelectedSource = () => {
    const current = ensureProject();
    const source = selectedSource();
    if (!source) return;
    dispatchProjectIntent({
      type: 'source.update',
      sourceId: source.id,
      patch: sourceBaselinePatch(source, current)
    });
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
    bindById('midiQuantize', 'change', event => {
      dispatchProjectIntent({ type: 'transport.set', transport: { quantize: event.target.value || '1/16' } });
    });
    bindById('midiSwing', 'change', event => {
      dispatchProjectIntent({ type: 'transport.set', transport: { swing: Number(event.target.value) || 0 } });
    });
    const updateTimeSignature = () => {
      const current = ensureProject();
      const beats = Number(document?.getElementById('midiTimeSignatureBeats')?.value) ||
        current.transport.timeSignature?.beats ||
        4;
      const unit = Number(document?.getElementById('midiTimeSignatureUnit')?.value) ||
        current.transport.timeSignature?.unit ||
        4;
      dispatchProjectIntent({
        type: 'transport.set',
        transport: { timeSignature: { beats, unit } }
      });
    };
    bindById('midiTimeSignatureBeats', 'change', updateTimeSignature);
    bindById('midiTimeSignatureUnit', 'change', updateTimeSignature);
    const updateScale = (patch) => {
      const current = ensureProject();
      updateGlobal({ scale: { ...current.global.scale, ...patch } });
    };
    bindById('midiScaleRoot', 'change', event => {
      updateScale({ root: toNumberOrNull(event.target.value) ?? 0 });
    });
    bindById('midiScaleName', 'change', event => {
      const name = event.target.value || 'chromatic-minor';
      updateScale({
        name,
        degrees: scalePresetDegrees(name) || ensureProject().global.scale.degrees
      });
    });
    bindById('midiProjectResetButton', 'click', () => resetProject());
    bindById('midiPanicButton', 'click', () => panic());
    bindById('midiTemplateSelect', 'change', () => setStatus('Template ready'));
    bindById('midiTemplateSaveButton', 'click', () => saveProjectTemplate());
    bindById('midiProjectExportButton', 'click', () => exportProject());
    bindById('midiProjectImportButton', 'click', () => document?.getElementById('midiProjectImportInput')?.click?.());
    bindById('midiProjectImportInput', 'change', async event => {
      const file = event.target?.files?.[0] || null;
      await importProjectFile(file);
      if (event.target) event.target.value = '';
    });
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
    bindById('midiSourceList', 'keydown', event => {
      handleListboxNavigation(
        event,
        filteredSources(),
        source => source.id,
        ensureProject().ui.selectedSourceId,
        sourceId => dispatchProjectIntent({ type: 'source.select', sourceId })
      );
    });
    bindById('midiTrackList', 'keydown', event => {
      handleListboxNavigation(
        event,
        ensureProject().tracks,
        track => track.id,
        ensureProject().ui.selectedTrackId,
        trackId => dispatchProjectIntent({ type: 'track.select', trackId })
      );
    });
    bindById('midiClipList', 'keydown', event => {
      handleListboxNavigation(
        event,
        ensureProject().clips,
        clip => clip.id,
        ensureProject().ui.selectedClipId,
        clipId => dispatchProjectIntent({ type: 'clip.select', clipId })
      );
    });
    bindById('midiStepPatternGrid', 'keydown', event => {
      const clip = selectedClip();
      const stepCount = Math.min(clip?.lengthSteps || 0, STEP_FIELD_COUNT);
      handleStepGridNavigation(event, document?.getElementById('midiStepPatternGrid'), stepCount);
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
    bindById('midiLearnButton', 'click', () => startLearn());
    bindById('midiLearnConfirmButton', 'click', () => confirmLearn());
    bindById('midiLearnCancelButton', 'click', () => cancelLearn());
    bindById('midiTrackName', 'change', event => updateSelectedTrack({ name: event.target.value }));
    bindById('midiTrackInstrument', 'change', event => updateSelectedTrack({ instrumentLabel: event.target.value }));
    bindById('midiTrackOutputSelect', 'change', event => {
      clearMidiOutputState();
      updateSelectedTrack({ outputId: event.target.value || null });
    });
    bindById('midiTrackChannel', 'change', event => updateSelectedTrack({ channel: Number(event.target.value) || 1 }));
    bindById('midiTrackPriority', 'change', event => updateSelectedTrack({ priority: Number(event.target.value) || 0 }));
    bindById('midiTrackVoiceBudget', 'change', event => updateSelectedTrack({ voiceBudget: Number(event.target.value) || 1 }));
    bindById('midiTrackVelocityScale', 'change', event => updateSelectedTrack({ velocityScale: Number(event.target.value) }));
    bindById('midiTrackMute', 'change', event => updateSelectedTrack({ mute: !!event.target.checked }));
    bindById('midiTrackSolo', 'change', event => updateSelectedTrack({ solo: !!event.target.checked }));
    bindById('midiTrackArm', 'change', event => updateSelectedTrack({ arm: !!event.target.checked }));
    bindById('midiSourceRevertButton', 'click', () => revertSelectedSource());
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
    bindById('midiMappingPan', 'change', event => updateSelectedMapping({ pan: toNumberOrNull(event.target.value) }));
    bindById('midiMappingTimbre', 'change', event => updateSelectedMapping({ timbre: toNumberOrNull(event.target.value) }));
    bindById('midiMappingPitchBend', 'change', event => updateSelectedMapping({ pitchBend: toNumberOrNull(event.target.value) }));
    bindById('midiMappingChord', 'change', event => {
      const type = event.target.value;
      const inversion = selectedSource()?.mapping?.chord?.inversion ?? 0;
      updateSelectedMapping({
        chord: CHORD_TYPES.includes(type) ? { type, inversion } : null,
        note: type ? null : selectedSource()?.mapping?.note ?? null,
        degree: type ? selectedSource()?.mapping?.degree ?? 0 : selectedSource()?.mapping?.degree ?? null
      });
    });
    bindById('midiMappingChordInversion', 'change', event => {
      const chord = selectedSource()?.mapping?.chord;
      if (!chord) return;
      updateSelectedMapping({
        chord: {
          ...chord,
          inversion: Math.max(0, Math.round(Number(event.target.value) || 0))
        }
      });
    });
    bindById('midiMappingArp', 'change', event => {
      const mode = ARP_MODES.includes(event.target.value) ? event.target.value : '';
      updateSelectedMapping({
        arp: mode
          ? { ...(selectedSource()?.mapping?.arp || {}), enabled: true, mode }
          : null
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
    const readGlobalNumber = (value, fallback) => toNumberOrNull(value) ?? fallback;
    const updateGlobalVelocityRange = (patch) => {
      const current = ensureProject();
      updateGlobal({ velocityRange: { ...current.global.velocityRange, ...patch } });
    };
    const updateGlobalNoteRange = (patch) => {
      const current = ensureProject();
      updateGlobal({ noteRange: { ...current.global.noteRange, ...patch } });
    };
    bindById('midiGlobalIntensity', 'change', event => {
      const current = ensureProject();
      updateGlobalVelocityRange({ default: readGlobalNumber(event.target.value, current.global.velocityRange.default) });
    });
    bindById('midiGlobalVelocityMin', 'change', event => {
      const current = ensureProject();
      updateGlobalVelocityRange({ min: readGlobalNumber(event.target.value, current.global.velocityRange.min) });
    });
    bindById('midiGlobalVelocityMax', 'change', event => {
      const current = ensureProject();
      updateGlobalVelocityRange({ max: readGlobalNumber(event.target.value, current.global.velocityRange.max) });
    });
    bindById('midiGlobalNoteMin', 'change', event => {
      const current = ensureProject();
      updateGlobalNoteRange({ min: readGlobalNumber(event.target.value, current.global.noteRange.min) });
    });
    bindById('midiGlobalNoteMax', 'change', event => {
      const current = ensureProject();
      updateGlobalNoteRange({ max: readGlobalNumber(event.target.value, current.global.noteRange.max) });
    });
    const updateGlobalDensity = (patch) => {
      const current = ensureProject();
      updateGlobal({ density: { ...current.global.density, ...patch } });
    };
    bindById('midiGlobalAccent', 'change', event => {
      updateGlobalDensity({ velocityBoost: Number(event.target.value) || 0 });
    });
    bindById('midiGlobalDensityWindow', 'change', event => {
      updateGlobalDensity({ windowTicks: Number(event.target.value) || 0 });
    });
    bindById('midiGlobalDurationScale', 'change', event => {
      updateGlobalDensity({ durationScale: Number(event.target.value) || 0 });
    });
    const updateGlobalLimits = (patch) => {
      const current = ensureProject();
      updateGlobal({ limits: { ...current.global.limits, ...patch } });
    };
    bindById('midiGlobalMaxActiveNotes', 'change', event => {
      updateGlobalLimits({ maxActiveNotes: Number(event.target.value) || 1 });
    });
    bindById('midiGlobalMaxEventsPerTick', 'change', event => {
      updateGlobalLimits({ maxEventsPerTick: Number(event.target.value) || 1 });
    });
    const updateGlobalPosition = (patch) => {
      const current = ensureProject();
      updateGlobal({ position: { ...current.global.position, ...patch } });
    };
    bindById('midiGlobalViewPan', 'change', event => {
      updateGlobalPosition({ viewPan: !!event.target.checked });
    });
    bindById('midiGlobalPanMin', 'change', event => {
      const current = ensureProject();
      updateGlobalPosition({
        panRange: {
          ...current.global.position.panRange,
          min: readGlobalNumber(event.target.value, current.global.position.panRange.min)
        }
      });
    });
    bindById('midiGlobalPanMax', 'change', event => {
      const current = ensureProject();
      updateGlobalPosition({
        panRange: {
          ...current.global.position.panRange,
          max: readGlobalNumber(event.target.value, current.global.position.panRange.max)
        }
      });
    });
    bindById('midiGlobalPanDeadZone', 'change', event => {
      const current = ensureProject();
      updateGlobalPosition({
        panDeadZonePct: readGlobalNumber(event.target.value, current.global.position.panDeadZonePct)
      });
    });
    const updateGlobalDurationTicks = () => {
      const current = ensureProject();
      const readDurationValue = (id, fallback) => toNumberOrNull(document?.getElementById(id)?.value) ?? fallback;
      updateGlobal({
        durationTicks: {
          default: readDurationValue('midiGlobalDurationDefault', current.global.durationTicks.default),
          min: readDurationValue('midiGlobalDurationMin', current.global.durationTicks.min),
          max: readDurationValue('midiGlobalDurationMax', current.global.durationTicks.max)
        }
      });
    };
    for (const id of ['midiGlobalDurationDefault', 'midiGlobalDurationMin', 'midiGlobalDurationMax']) {
      bindById(id, 'change', updateGlobalDurationTicks);
    }
    const updateGlobalEnvelope = () => {
      const current = ensureProject();
      const readEnvelopeValue = (id, fallback) => toNumberOrNull(document?.getElementById(id)?.value) ?? fallback;
      updateGlobal({
        envelope: {
          attack: readEnvelopeValue('midiGlobalEnvAttack', current.global.envelope.attack),
          decay: readEnvelopeValue('midiGlobalEnvDecay', current.global.envelope.decay),
          sustain: readEnvelopeValue('midiGlobalEnvSustain', current.global.envelope.sustain),
          release: readEnvelopeValue('midiGlobalEnvRelease', current.global.envelope.release)
        }
      });
    };
    for (const id of ['midiGlobalEnvAttack', 'midiGlobalEnvDecay', 'midiGlobalEnvSustain', 'midiGlobalEnvRelease']) {
      bindById(id, 'change', updateGlobalEnvelope);
    }
    bindById('midiAutomationAddButton', 'click', () => {
      const current = ensureProject();
      const targets = ['note', 'velocity', 'pan', 'duration'];
      const target = targets.find(item => !current.automation.some(lane => lane.target === item)) || 'velocity';
      dispatchProjectIntent({ type: 'automation.add', automation: { target, axis: target === 'velocity' ? 'y' : 'x' } });
    });
    bindById('midiClipName', 'change', event => updateSelectedClip({ name: event.target.value }));
    bindById('midiClipType', 'change', event => updateSelectedClip({ type: event.target.value }));
    bindById('midiClipArpMode', 'change', event => {
      const mode = ARP_MODES.includes(event.target.value) ? event.target.value : 'up';
      const clip = selectedClip();
      const patternLength = Array.isArray(clip?.arp?.pattern?.steps) ? clip.arp.pattern.steps.length : undefined;
      const pattern = createArpPatternFromPreset(mode, patternLength);
      updateSelectedClip({ arp: { ...(clip?.arp || {}), mode, pattern } });
    });
    bindById('midiClipArpPattern', 'change', event => {
      const clip = selectedClip();
      const preset = ARP_PATTERN_PRESETS.some(entry => entry.value === event.target.value)
        ? event.target.value
        : 'up';
      const patternLength = Array.isArray(clip?.arp?.pattern?.steps) ? clip.arp.pattern.steps.length : undefined;
      const pattern = createArpPatternFromPreset(preset, patternLength);
      const mode = deriveArpModeFromPattern(pattern, clip?.arp?.mode || 'up');
      updateSelectedClip({ arp: { ...(clip?.arp || {}), mode, pattern } });
    });
    bindById('midiClipLengthSteps', 'change', event => updateSelectedClip({ lengthSteps: Number(event.target.value) || 16 }));
    bindById('midiRecordButton', 'click', () => startRecording());
    bindById('midiRecordCommitButton', 'click', () => commitRecording());
    bindById('midiRecordCancelButton', 'click', () => cancelRecording());
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
      exportProject,
      importProject,
      importProjectFile,
      saveProjectTemplate,
      getProjectTemplates,
      startLearn,
      confirmLearn,
      cancelLearn,
      captureLearnNote: handleLearnNote,
      startRecording,
      commitRecording,
      cancelRecording,
      captureRecordMessage: handleRecordMessage,
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
    clearLearnCapture();
    clearRecordCapture();
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
    exportProject,
    importProject,
    importProjectFile,
    saveProjectTemplate,
    getProjectTemplates,
    startLearn,
    confirmLearn,
    cancelLearn,
    captureLearnNote: handleLearnNote,
    startRecording,
    commitRecording,
    cancelRecording,
    captureRecordMessage: handleRecordMessage,
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
      if (learnState.active) midiInputController?.setNoteCapture?.(handleLearnNote);
      if (recordState.active) midiInputController?.setMessageCapture?.(handleRecordMessage);
    },
    setActiveMidiInput,
    setActiveMidiOutput,
    dispose,
    getStorageKeys() {
      return { project: PROJECT_STORAGE_KEY, templates: TEMPLATE_STORAGE_KEY };
    }
  };
};

export { createMidiUiController };
