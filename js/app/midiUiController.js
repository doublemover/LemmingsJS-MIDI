import { MidiMapping, ScaleLibrary } from '../midi/MidiMapping.js';
import { getAppContext, getRuntimeDependency } from '../core/dependencies.js';
import {
  CHORD_OPTIONS,
  NOTE_NAMES,
  ARP_PATTERN_PRESETS,
  ARP_PATTERN_STEP_OPTIONS,
  ARP_PATTERN_DEFAULT_STEPS,
  collectTriggerTypes,
  createArpPatternFromPreset,
  deriveArpModeFromPattern,
  resolveArpPatternPreset,
  sanitizeArpPattern,
  resolveAvailableSfxIds,
  resolvePositionMappings
} from './midi-ui/midiUiDomain.js';
import {
  midiStorageKeys,
  readStoredMidiId,
  readStoredMidiIntentState,
  readStoredSectionStates,
  readStoredJson,
  storeJson,
  storeMidiId,
  storeMidiIntentState
} from './midi-ui/midiUiStorage.js';
import { createMidiIntentState, reduceMidiIntent } from './midi-ui/midiUiIntent.js';
import { createMidiLearnController } from './midi-ui/midiUiLearn.js';
import { createMidiUiTabsController } from './midi-ui/midiUiTabs.js';
import { createMidiUiSectionsController } from './midi-ui/midiUiSections.js';
import { createBuildMappingEditor } from './midi-ui/midiUiMappingEditor.js';
import { createMidiUiErrorReporter } from './midi-ui/midiUiErrors.js';
import { formatDebugBytes, formatDebugOutput } from './midi-ui/midiUiDebug.js';
import {
  populateMidiSelect,
  resolveMidiId,
  toDeviceList
} from './midi-ui/midiUiDevices.js';
import {
  createDefaultMidiUiFeatureFlags,
  resolveMidiUiFeatureFlags
} from './midi-ui/midiUiFeatureFlags.js';
import { deriveRefreshSectionsFromPatch } from './midi-ui/midiUiRefreshSections.js';
import { cloneSafeObject, isPlainObject, mergeDeepSafe } from '../util/safeObject.js';

const mergeDeep = mergeDeepSafe;
const cloneOverrides = (value) => isPlainObject(value) ? cloneSafeObject(value) : {};

const formatNumber = (value, digits = 2) => {
  if (!Number.isFinite(value)) return '--';
  const fixed = value.toFixed(digits);
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/\.?0+$/, '');
};

/**
 * Create the browser MIDI UI controller and bind it to runtime dependencies.
 * @param {object} [options]
 * @returns {object}
 */
export const createMidiUiController = ({
  window = getRuntimeDependency('window', null),
  document = getRuntimeDependency('document', null),
  getLemmings = () => getAppContext(),
  getWebMidi = () => getRuntimeDependency('webMidi', null),
  getMidiConfig = null
} = {}) => {
  const storage = window?.localStorage;
  const storedIntentState = readStoredMidiIntentState(storage);
  let activeMidiInput = null;
  let midiUiBound = false;
  let midiInputController = null;
  let midiIntentState = createMidiIntentState(storedIntentState);
  let midiOverrides = midiIntentState.overrides;
  let envControlsBound = false;
  let lastUiSignature = null;
  let noteCapture = null;
  let lastEnableError = null;
  let deviceRefreshTimer = null;
  let deviceListenersBound = false;
  let deviceListener = null;
  let queuedRefreshTimer = null;
  let scheduledRefreshTimer = null;
  let scheduledRefreshNonce = 0;
  let queuedRefreshAll = false;
  let queuedRefreshForce = false;
  let midiUiFeatureFlags = createDefaultMidiUiFeatureFlags();
  let bpmIntervalId = null;
  let debugIntervalId = null;
  const domListeners = [];
  const queuedRefreshSections = new Set();
  if (!isPlainObject(midiOverrides)) {
    midiOverrides = {};
  }
  midiIntentState = createMidiIntentState({
    ...storedIntentState,
    overrides: midiOverrides
  });

  const applyOverridesToRuntime = () => {
    const lemmings = getLemmings();
    if (lemmings?.setMidiOverrides) {
      lemmings.setMidiOverrides(midiOverrides);
    } else if (lemmings?.applyMidiOverrides) {
      lemmings.applyMidiOverrides(midiOverrides);
    }
  };

  const runMidiIntent = (intent) => {
    const previousIntentState = midiIntentState;
    const prevOverrides = midiIntentState.overrides;
    midiIntentState = reduceMidiIntent(midiIntentState, intent);
    if (!isPlainObject(midiIntentState.overrides)) {
      midiIntentState = reduceMidiIntent(midiIntentState, { type: 'overrides.replace', overrides: {} });
    }
    midiOverrides = midiIntentState.overrides;
    if (midiIntentState !== previousIntentState) {
      storeMidiIntentState(storage, midiIntentState);
    }
    if (midiOverrides !== prevOverrides) {
      applyOverridesToRuntime();
    }
    return midiIntentState;
  };

  const queueMidiUiRefresh = ({ sections = null, force = false } = {}) => {
    if (force) queuedRefreshForce = true;
    if (sections === null) {
      queuedRefreshAll = true;
      queuedRefreshSections.clear();
    } else if (!queuedRefreshAll) {
      for (const section of sections) {
        queuedRefreshSections.add(section);
      }
    }
    if (queuedRefreshTimer != null) return;
    const flushQueuedRefresh = () => {
      const forceRefresh = queuedRefreshForce;
      const requestAll = queuedRefreshAll;
      const requestSections = requestAll ? null : new Set(queuedRefreshSections);
      queuedRefreshForce = false;
      queuedRefreshAll = false;
      queuedRefreshSections.clear();
      try {
        refreshMidiUiFromConfig({ sections: requestSections, force: forceRefresh });
      } catch (e) {
        console.error('MIDI UI refresh failed', e);
      }
    };
    if (typeof window?.setTimeout === 'function') {
      let fired = false;
      const timerId = window.setTimeout(() => {
        fired = true;
        queuedRefreshTimer = null;
        flushQueuedRefresh();
      }, 0);
      if (!fired) {
        queuedRefreshTimer = timerId;
      }
    } else {
      flushQueuedRefresh();
    }
  };

  const clearPendingRefreshTimers = () => {
    if (queuedRefreshTimer != null && typeof window?.clearTimeout === 'function') {
      window.clearTimeout(queuedRefreshTimer);
    }
    queuedRefreshTimer = null;
    queuedRefreshAll = false;
    queuedRefreshForce = false;
    queuedRefreshSections.clear();

    if (deviceRefreshTimer != null && typeof window?.clearTimeout === 'function') {
      window.clearTimeout(deviceRefreshTimer);
    }
    deviceRefreshTimer = null;

    if (scheduledRefreshTimer != null && typeof window?.clearTimeout === 'function') {
      window.clearTimeout(scheduledRefreshTimer);
    }
    scheduledRefreshTimer = null;
    scheduledRefreshNonce += 1;
  };

  const {
    clearErrorDisplay,
    renderErrorDisplay,
    showError
  } = createMidiUiErrorReporter({
    document,
    getDeviceSnapshot: () => {
      const webMidi = getWebMidi();
      return {
        inputs: webMidi?.inputs || [],
        outputs: webMidi?.outputs || []
      };
    },
    getLastEnableError: () => lastEnableError,
    setLastEnableError: (message) => {
      lastEnableError = message ? String(message) : null;
    }
  });

  const setActiveMidiInput = (inputId) => {
    const webMidi = getWebMidi();
    if (!inputId || !webMidi?.enabled) {
      if (activeMidiInput) {
        midiInputController?.detach?.();
      }
      activeMidiInput = null;
      return;
    }
    const input = webMidi.getInputById(inputId);
    if (!input) {
      if (activeMidiInput) {
        midiInputController?.detach?.();
      }
      activeMidiInput = null;
      return;
    }
    if (!midiInputController) {
      activeMidiInput = input;
      return;
    }
    if (activeMidiInput === input) {
      return;
    }
    if (activeMidiInput) {
      midiInputController.detach?.();
    }
    midiInputController.attach?.(input);
    activeMidiInput = input;
  };

  const setActiveMidiOutput = (outputId) => {
    const webMidi = getWebMidi();
    if (!webMidi?.enabled) return;
    const output = outputId ? webMidi.getOutputById(outputId) : null;
    const lemmings = getLemmings();
    const currentOutput = lemmings?.midiOut ?? null;
    if (currentOutput === (output || null)) {
      return;
    }
    if (lemmings?.midiRouter?.scheduler?.allNotesOff) {
      lemmings.midiRouter.scheduler.allNotesOff();
      lemmings.midiRouter.scheduler.clearQueue?.();
    }
    if (lemmings) {
      lemmings.midiOut = output || null;
    }
  };

  const setMidiOverrides = (patch) => {
    runMidiIntent({ type: 'overrides.merge', patch });
    if (midiUiBound) {
      queueMidiUiRefresh({ sections: deriveRefreshSectionsFromPatch(patch) });
    }
  };

  const setNoteCapture = (handler) => {
    noteCapture = handler;
    if (midiInputController?.setNoteCapture) {
      midiInputController.setNoteCapture(handler);
    }
  };

  const midiLearn = createMidiLearnController({
    runMidiIntent,
    setNoteCapture,
    getIntentState: () => midiIntentState
  });
  const { armMidiLearn, disarmMidiLearn, clearNoteCapture } = midiLearn;

  const applyViewPanSetting = (enabled) => {
    const resolved = !!enabled;
    if (midiOverrides?.position?.viewPan === resolved) {
      return;
    }
    setMidiOverrides({ position: { viewPan: resolved } });
  };

  const getConfig = () => {
    if (typeof getMidiConfig === 'function') return getMidiConfig();
    const lemmings = getLemmings();
    return lemmings?.getMidiConfig?.() || lemmings?.getMidiBaseConfig?.() || null;
  };

  const readMidiUiFeatureFlags = () => resolveMidiUiFeatureFlags({ getConfig, storage, window });
  midiUiFeatureFlags = readMidiUiFeatureFlags();

  const getEffectiveConfig = () => {
    const base = getConfig() || {};
    return mergeDeep(base, midiOverrides || {});
  };

  const getSchemaHash = () => getLemmings()?.getMidiSchemaHash?.() || null;

  const clearMidiStorage = () => {
    storeMidiId(storage, midiStorageKeys.inputId, null);
    storeMidiId(storage, midiStorageKeys.outputId, null);
    storeMidiId(storage, midiStorageKeys.viewPan, null);
    storeMidiId(storage, midiStorageKeys.enabled, null);
    storeMidiId(storage, midiStorageKeys.inputChannel, null);
    storeMidiId(storage, midiStorageKeys.adsrTarget, null);
    storeMidiId(storage, midiStorageKeys.panelCollapsed, null);
    storeMidiId(storage, midiStorageKeys.tabLeft, null);
    storeMidiId(storage, midiStorageKeys.tabRight, null);
    storeJson(storage, midiStorageKeys.sectionStates, null);
    storeJson(storage, midiStorageKeys.overrides, null);
    storeJson(storage, midiStorageKeys.midiIntent, null);
  };

  const resetMidiDefaults = (persistHash = true) => {
    const expectedHash = getSchemaHash();
    clearMidiStorage();
    runMidiIntent({ type: 'overrides.replace', overrides: {} });
    disarmMidiLearn();
    storeJson(storage, midiStorageKeys.overrides, null);
    storeJson(storage, midiStorageKeys.midiIntent, null);
    if (expectedHash && persistHash) {
      storeMidiId(storage, midiStorageKeys.schemaHash, expectedHash);
    } else if (!persistHash) {
      storeMidiId(storage, midiStorageKeys.schemaHash, null);
    }
  };

  const ensureSchemaHash = () => {
    const expectedHash = getSchemaHash();
    if (!expectedHash) return false;
    const storedHash = readStoredMidiId(storage, midiStorageKeys.schemaHash);
    if (storedHash && storedHash === expectedHash) return false;
    resetMidiDefaults(true);
    return true;
  };

  const tabUi = createMidiUiTabsController({
    document,
    storage,
    readStoredMidiId,
    storeMidiId,
    readStoredJson,
    readStoredSectionStates,
    storeJson,
    midiStorageKeys
  });

  const resetUiState = () => {
    storeMidiId(storage, midiStorageKeys.tabLeft, null);
    storeMidiId(storage, midiStorageKeys.tabRight, null);
    storeJson(storage, midiStorageKeys.sectionStates, null);
    tabUi.applyTabState({ useStored: false });
    tabUi.applySectionStates({ useStored: false });
  };

  const buildUiSignature = () => {
    const lemmings = getLemmings();
    const game = lemmings?.game ?? null;
    const level = game?.level ?? lemmings?.level ?? null;
    const skills = game?.getGameSkills?.() ?? null;
    const skillCounts = skills?.skills ?? level?.skills ?? [];
    const skillKey = Array.isArray(skillCounts) ? skillCounts.join(',') : '';
    return [
      lemmings?.gameType ?? 'none',
      lemmings?.levelGroupIndex ?? 'none',
      lemmings?.levelIndex ?? 'none',
      level?.triggers?.length ?? -1,
      Array.isArray(level?.midiFlags) ? level.midiFlags.map(flag => `${flag.id}:${flag.triggerType}`).join(',') : '-',
      level?.steelRanges?.length ?? -1,
      level?.arrowRanges?.length ?? -1,
      skills?.cheatMode ? 'cheat' : 'no-cheat',
      skillKey
    ].join('|');
  };

  const createRow = (labelText, input) => {
    const label = document.createElement('label');
    label.className = 'panel-row';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(input);
    return label;
  };

  const setA11yAttr = (element, name, value) => {
    if (!element) return;
    if (typeof element.setAttribute === 'function') {
      element.setAttribute(name, value);
    } else {
      element[name] = value;
    }
  };

  const bindRangeInput = (input) => {
    if (!input) return;
    const updateTitle = () => {
      input.title = input.value;
    };
    const updateLabels = () => {
      const parent = input.parentElement || input.parentNode || input.parent;
      const children = parent?.children || [];
      const labels = Array.from(children).filter(child => child.classList?.contains('range-label'));
      if (labels.length > 0) {
        const minValue = Number(input.min);
        labels[0].textContent = Number.isFinite(minValue) ? formatNumber(minValue, 2) : '';
      }
      if (labels.length > 1) {
        const maxValue = Number(input.max);
        labels[labels.length - 1].textContent = Number.isFinite(maxValue) ? formatNumber(maxValue, 2) : '';
      }
    };
    updateTitle();
    updateLabels();
    if (input.dataset.rangeBound === 'true') return;
    input.addEventListener('input', updateTitle);
    input.addEventListener('change', updateTitle);
    input.dataset.rangeBound = 'true';
  };

  const createChoiceButtons = (choices, initialValue, onChange, options = {}) => {
    const wrap = document.createElement('div');
    wrap.className = options.className || 'midi-choice-buttons';
    if (options.ariaLabel) {
      setA11yAttr(wrap, 'role', 'group');
      setA11yAttr(wrap, 'aria-label', options.ariaLabel);
    }
    let value = initialValue;
    const sync = () => {
      Array.from(wrap.children).forEach((btn) => {
        const selected = btn.dataset.value === String(value);
        btn.classList.toggle('active', selected);
        setA11yAttr(btn, 'aria-pressed', selected ? 'true' : 'false');
      });
    };
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = options.buttonClassName || 'button-compact';
      btn.dataset.value = String(choice.value);
      btn.textContent = choice.label;
      if (choice.testId) {
        btn.dataset.midiTest = choice.testId;
      }
      const choiceLabel = choice.ariaLabel || `${options.ariaChoicePrefix || ''}${choice.label}`;
      if (choiceLabel) {
        setA11yAttr(btn, 'aria-label', choiceLabel);
      }
      if (choice.title) {
        btn.title = choice.title;
      }
      btn.addEventListener('click', () => {
        value = choice.value;
        sync();
        onChange?.(choice.value);
      });
      wrap.appendChild(btn);
    }
    sync();
    return {
      element: wrap,
      setValue(nextValue) {
        value = nextValue;
        sync();
      },
      getValue() {
        return value;
      }
    };
  };

  const resolveScaleForMapping = () => {
    const config = getConfig();
    const scale = config?.scale || {};
    const root = Number.isFinite(scale.root) ? scale.root : 0;
    const degrees = Array.isArray(scale.degrees) && scale.degrees.length
      ? scale.degrees
      : (ScaleLibrary[scale.name] || ScaleLibrary['chromatic-minor'] || NOTE_NAMES.map((_, idx) => idx));
    return { root, degrees };
  };

  const resolvePreviewNote = (entry) => {
    if (Number.isFinite(entry?.note)) {
      return Math.max(0, Math.min(127, Math.trunc(entry.note)));
    }
    if (Number.isFinite(entry?.degree)) {
      const { root, degrees } = resolveScaleForMapping();
      const degreeIndex = Math.max(0, Math.trunc(entry.degree));
      const octave = Number.isFinite(entry?.octave) ? Math.max(0, Math.trunc(entry.octave)) : 4;
      const stepsPerOctave = Math.max(1, degrees.length);
      const octaveOffset = Math.floor(degreeIndex / stepsPerOctave);
      const degreeOffset = degrees[degreeIndex % stepsPerOctave] ?? 0;
      return Math.max(0, Math.min(127, root + degreeOffset + (octave + octaveOffset) * 12));
    }
    return 60;
  };

  const auditionMappingEntry = ({ id, targetKey, entry }) => {
    if (!midiUiFeatureFlags.audition) return false;
    const lemmings = getLemmings();
    const scheduler = lemmings?.midiRouter?.scheduler;
    if (!scheduler?.sendNote) return false;
    const resolvedEntry = isPlainObject(entry) ? entry : {};
    const note = resolvePreviewNote(resolvedEntry);
    const numericId = Number(id);
    scheduler.sendNote({
      note,
      velocity: 100,
      durationTicks: 3,
      timeMs: Date.now()
    }, {
      sfxId: Number.isFinite(numericId) ? numericId : 0,
      triggerType: targetKey === 'triggers' && Number.isFinite(numericId) ? numericId : null,
      eventType: 'preview',
      priority: 2
    });
    return true;
  };

  const buildMappingEditor = createBuildMappingEditor({
    document,
    getMidiUiFeatureFlags: () => midiUiFeatureFlags,
    createChoiceButtons,
    createRow,
    setA11yAttr,
    setMidiOverrides,
    getConfig,
    armMidiLearn,
    disarmMidiLearn,
    auditionMappingEntry
  });

  const sectionsUi = createMidiUiSectionsController({
    document,
    window,
    formatNumber,
    setMidiOverrides,
    getConfig,
    createRow,
    buildMappingEditor,
    refreshMidiUiFromConfig: () => queueMidiUiRefresh()
  });
  const {
    buildScaleOptions,
    buildKeyOptions,
    buildChannelOptions,
    buildRepeatTargetOptions,
    buildRepeatWindowOptions,
    buildPositionMappingList,
    buildDefaultPositionMapping,
    buildEventList,
    buildTriggerList,
    buildAdsrTargetOptions,
    resolveEnvelopeTarget,
    resolveEnvelopeConfig
  } = sectionsUi;

  const bindEnvelopeControls = () => {
    if (envControlsBound) return;
    const envAttack = document.getElementById('midiEnvAttack');
    const envDecay = document.getElementById('midiEnvDecay');
    const envSustain = document.getElementById('midiEnvSustain');
    const envRelease = document.getElementById('midiEnvRelease');
    const envTarget = document.getElementById('midiEnvTarget');
    if (!envAttack && !envDecay && !envSustain && !envRelease && !envTarget) {
      return;
    }
    [envAttack, envDecay, envSustain, envRelease].forEach(bindRangeInput);
    const envUpdate = () => {
      if (!envAttack || !envDecay || !envSustain || !envRelease) return;
      const envelope = {
        attack: Number(envAttack.value) || 0,
        decay: Number(envDecay.value) || 0,
        sustain: Number(envSustain.value) || 0,
        release: Number(envRelease.value) || 0
      };
      const target = resolveEnvelopeTarget(envTarget?.value || 'global');
      if (target.scope === 'sfx' && target.id) {
        setMidiOverrides({ sfx: { [target.id]: { envelope } } });
        return;
      }
      if (target.scope === 'trigger' && target.id) {
        setMidiOverrides({ triggers: { [target.id]: { envelope } } });
        return;
      }
      setMidiOverrides({ envelope });
    };
    if (envAttack) envAttack.addEventListener('change', envUpdate);
    if (envDecay) envDecay.addEventListener('change', envUpdate);
    if (envSustain) envSustain.addEventListener('change', envUpdate);
    if (envRelease) envRelease.addEventListener('change', envUpdate);
    if (envTarget) {
      envTarget.addEventListener('change', (event) => {
        const value = event.target.value || 'global';
        storeMidiId(storage, midiStorageKeys.adsrTarget, value);
        const config = getConfig();
        const env = resolveEnvelopeConfig(config, value);
        if (envAttack && Number.isFinite(env.attack)) envAttack.value = String(env.attack);
        if (envDecay && Number.isFinite(env.decay)) envDecay.value = String(env.decay);
        if (envSustain && Number.isFinite(env.sustain)) envSustain.value = String(env.sustain);
        if (envRelease && Number.isFinite(env.release)) envRelease.value = String(env.release);
      });
    }
    envControlsBound = true;
  };

  const refreshMidiUiFromConfig = (options = {}) => {
    const config = getEffectiveConfig();
    if (!config) return false;
    const requestedSections = options.sections instanceof Set ? options.sections : null;
    const refreshAll = options.force === true || requestedSections === null;
    const shouldRefreshSection = (name) => refreshAll || requestedSections.has(name);
    bindEnvelopeControls();
    const keySelect = document.getElementById('midiKeySelect');
    const scaleSelect = document.getElementById('midiScaleSelect');
    const positionList = document.getElementById('midiPositionList');
    const intensity = document.getElementById('midiIntensity');
    const accent = document.getElementById('midiAccent');
    const repeatEnabled = document.getElementById('midiRepeatEnabled');
    const repeatSection = document.getElementById('midiRepeatSection');
    const repeatCount = document.getElementById('midiRepeatCount');
    const repeatSpacing = document.getElementById('midiRepeatSpacing');
    const repeatTarget = document.getElementById('midiRepeatTarget');
    const repeatAmount = document.getElementById('midiRepeatAmount');
    const envAttack = document.getElementById('midiEnvAttack');
    const envDecay = document.getElementById('midiEnvDecay');
    const envSustain = document.getElementById('midiEnvSustain');
    const envRelease = document.getElementById('midiEnvRelease');
    const envTarget = document.getElementById('midiEnvTarget');
    const viewPanToggle = document.getElementById('midiViewPanToggle');
    const inputChannel = document.getElementById('midiInputChannel');
    const bpmBase = document.getElementById('midiBpmBase');
    const bpmValue = Number.isFinite(config.timing?.bpmBase) ? config.timing.bpmBase : 120;
    if (bpmBase && shouldRefreshSection('bpm')) {
      bpmBase.value = String(bpmValue);
    }
    if (scaleSelect && shouldRefreshSection('scale')) {
      buildScaleOptions(scaleSelect, config.scale?.name || 'chromatic-minor');
    }
    if (keySelect && shouldRefreshSection('scale')) {
      const root = Number.isFinite(config.scale?.root) ? config.scale.root : 0;
      buildKeyOptions(keySelect, root);
    }
    if (intensity && shouldRefreshSection('velocity')) {
      const defaultVelocity = Number.isFinite(config.velocityRange?.default)
        ? config.velocityRange.default
        : 80;
      if (Number.isFinite(config.velocityRange?.min)) {
        intensity.min = String(config.velocityRange.min);
      }
      if (Number.isFinite(config.velocityRange?.max)) {
        intensity.max = String(config.velocityRange.max);
      }
      intensity.value = String(defaultVelocity);
      bindRangeInput(intensity);
    }
    if (accent && shouldRefreshSection('velocity')) {
      const defaultAccent = Number.isFinite(config.density?.velocityBoost)
        ? config.density.velocityBoost
        : 0.4;
      accent.value = String(defaultAccent);
      bindRangeInput(accent);
    }
    const repeatCfg = config.repeat || {};
    if (repeatEnabled && shouldRefreshSection('repeat')) {
      repeatEnabled.checked = repeatCfg.enabled === true;
    }
    if (repeatCount && shouldRefreshSection('repeat')) {
      const maxRepeats = Number.isFinite(repeatCfg.maxRepeats) ? repeatCfg.maxRepeats : 0;
      repeatCount.value = String(maxRepeats);
    }
    if (repeatSpacing && shouldRefreshSection('repeat')) {
      const windowBeats = Number.isFinite(repeatCfg.windowBeats)
        ? repeatCfg.windowBeats
        : (Number.isFinite(repeatCfg.spacingTicks) ? repeatCfg.spacingTicks : 1);
      buildRepeatWindowOptions(repeatSpacing, windowBeats);
    }
    if (repeatTarget && shouldRefreshSection('repeat')) {
      const target = repeatCfg.target
        || (repeatCfg.durationBoost ? 'duration' : 'velocity');
      buildRepeatTargetOptions(repeatTarget, target);
    }
    if (repeatAmount && shouldRefreshSection('repeat')) {
      const amount = Number.isFinite(repeatCfg.amount)
        ? repeatCfg.amount
        : (repeatCfg.durationBoost ?? repeatCfg.velocityBoost ?? 0);
      repeatAmount.value = String(amount);
      bindRangeInput(repeatAmount);
    }
    if (positionList && shouldRefreshSection('position')) {
      const mappings = resolvePositionMappings(config);
      buildPositionMappingList(positionList, mappings, config);
    }
    const storedViewPan = readStoredMidiId(storage, midiStorageKeys.viewPan);
    if (viewPanToggle && shouldRefreshSection('view')) {
      if (storedViewPan != null) {
        viewPanToggle.checked = storedViewPan === 'true';
      } else if (typeof config.position?.viewPan === 'boolean') {
        viewPanToggle.checked = config.position.viewPan;
      }
    }
    const storedChannel = readStoredMidiId(storage, midiStorageKeys.inputChannel);
    if (inputChannel && shouldRefreshSection('view')) {
      const channel = storedChannel ?? config.input?.channel ?? 'omni';
      const value = channel === 'omni' ? null : channel;
      buildChannelOptions(inputChannel, value);
    }
    const shouldBuildEvents = shouldRefreshSection('events');
    const shouldBuildTriggers = shouldRefreshSection('triggers');
    const shouldBuildEnvTargets = shouldRefreshSection('envTargets');
    if (shouldBuildEvents || shouldBuildTriggers || shouldBuildEnvTargets) {
      const { level, skills } = (() => {
        const lemmings = getLemmings();
        const game = lemmings?.game ?? null;
        return {
          level: game?.level ?? lemmings?.level ?? null,
          skills: game?.getGameSkills?.() ?? null
        };
      })();
      const availableSfxIds = resolveAvailableSfxIds(config, level, skills);
      const sfxFilter = availableSfxIds && availableSfxIds.size ? availableSfxIds : null;
      const availableTriggerTypes = level ? collectTriggerTypes(level) : null;
      if (shouldBuildEvents) {
        buildEventList(config, sfxFilter);
      }
      if (shouldBuildTriggers) {
        buildTriggerList(config, availableTriggerTypes, level);
      }
      if (envTarget && shouldBuildEnvTargets) {
        buildAdsrTargetOptions(envTarget, config, sfxFilter, availableTriggerTypes, level);
        const storedTarget = readStoredMidiId(storage, midiStorageKeys.adsrTarget);
        const targetOptions = Array.from(envTarget.options || envTarget.children || []);
        const matches = storedTarget &&
          targetOptions.some(opt => opt.value === storedTarget);
        envTarget.value = matches ? storedTarget : 'global';
      }
    }
    if (shouldRefreshSection('envelope') || shouldBuildEnvTargets) {
      const env = resolveEnvelopeConfig(config, envTarget?.value || 'global');
      if (envAttack) envAttack.value = String(Number.isFinite(env.attack) ? env.attack : 1);
      if (envDecay) envDecay.value = String(Number.isFinite(env.decay) ? env.decay : 0);
      if (envSustain) envSustain.value = String(Number.isFinite(env.sustain) ? env.sustain : 1);
      if (envRelease) envRelease.value = String(Number.isFinite(env.release) ? env.release : 1);
      bindRangeInput(envAttack);
      bindRangeInput(envDecay);
      bindRangeInput(envSustain);
      bindRangeInput(envRelease);
    }
    return true;
  };

  const scheduleMidiUiRefresh = () => {
    if (scheduledRefreshTimer != null && typeof window?.clearTimeout === 'function') {
      window.clearTimeout(scheduledRefreshTimer);
      scheduledRefreshTimer = null;
    }
    const scheduleToken = scheduledRefreshNonce + 1;
    scheduledRefreshNonce = scheduleToken;
    let attempts = 0;
    const scheduleAttempt = (delayMs) => {
      if (typeof window?.setTimeout !== 'function') return;
      const timerId = window.setTimeout(() => {
        if (scheduledRefreshTimer === timerId) {
          scheduledRefreshTimer = null;
        }
        if (scheduledRefreshNonce !== scheduleToken) {
          return;
        }
        attempt();
      }, delayMs);
      scheduledRefreshTimer = timerId;
    };
    const attempt = () => {
      let refreshed = false;
      try {
        ensureSchemaHash();
        refreshed = refreshMidiUiFromConfig();
      } catch (e) {
        console.error('MIDI UI refresh failed', e);
      }
      if (!refreshed) {
        attempts += 1;
        if (attempts < 120) {
          scheduleAttempt(250);
        }
      }
    };
    scheduleAttempt(0);
  };

  const refreshDeviceLists = ({ preserveSelection = true } = {}) => {
    const inputSelect = document.getElementById('midiInSelect');
    const outputSelect = document.getElementById('midiOutSelect');
    const viewPanToggle = document.getElementById('midiViewPanToggle');
    const webMidi = getWebMidi();
    const inputs = toDeviceList(webMidi?.inputs);
    const outputs = toDeviceList(webMidi?.outputs);
    renderErrorDisplay({ inputs, outputs });
    populateMidiSelect(document, inputSelect, inputs, 'No input devices');

    populateMidiSelect(document, outputSelect, outputs, 'No output devices');

    const storedInputId = readStoredMidiId(storage, midiStorageKeys.inputId);
    const storedOutputId = readStoredMidiId(storage, midiStorageKeys.outputId);
    const currentInputId = preserveSelection ? (activeMidiInput?.id || inputSelect?.value) : null;
    const currentOutputId = preserveSelection
      ? (getLemmings()?.midiOut?.id || outputSelect?.value)
      : null;
    const resolvedInputId = resolveMidiId(inputs, currentInputId, storedInputId);
    const resolvedOutputId = resolveMidiId(outputs, currentOutputId, storedOutputId);
    const shouldResetUi = (currentInputId && resolvedInputId && currentInputId !== resolvedInputId) ||
      (currentOutputId && resolvedOutputId && currentOutputId !== resolvedOutputId);

    if (resolvedInputId && inputSelect) {
      inputSelect.value = resolvedInputId;
      if (storedInputId !== resolvedInputId) {
        storeMidiId(storage, midiStorageKeys.inputId, resolvedInputId);
      }
      setActiveMidiInput(resolvedInputId);
    } else {
      setActiveMidiInput(null);
    }

    if (resolvedOutputId && outputSelect) {
      outputSelect.value = resolvedOutputId;
      if (storedOutputId !== resolvedOutputId) {
        storeMidiId(storage, midiStorageKeys.outputId, resolvedOutputId);
      }
      setActiveMidiOutput(resolvedOutputId);
    } else {
      setActiveMidiOutput(null);
    }

    if (shouldResetUi) {
      resetUiState();
    }

    const storedViewPan = readStoredMidiId(storage, midiStorageKeys.viewPan);
    if (storedViewPan != null) {
      const resolvedViewPan = storedViewPan === 'true';
      if (viewPanToggle) {
        viewPanToggle.checked = resolvedViewPan;
      }
      applyViewPanSetting(resolvedViewPan);
    }
    refreshMidiUiFromConfig();
  };

  const scheduleDeviceRefresh = () => {
    if (deviceRefreshTimer) return;
    deviceRefreshTimer = window?.setTimeout?.(() => {
      deviceRefreshTimer = null;
      if (getWebMidi()?.enabled) {
        refreshDeviceLists({ preserveSelection: true });
      }
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
    lastEnableError = null;
    refreshDeviceLists({ preserveSelection: true });
    bindDeviceListeners();
  };

  const toggleMidiUiEnabled = (enabled) => {
    const inputs = [
      'midiBpmBase',
      'midiInSelect',
      'midiOutSelect',
      'midiInputChannel',
      'midiResetButton',
      'midiViewPanToggle',
      'midiPositionAdd',
      'midiIntensity',
      'midiAccent',
      'midiRepeatEnabled',
      'midiRepeatCount',
      'midiRepeatSpacing',
      'midiRepeatTarget',
      'midiRepeatAmount'
    ];
    for (const id of inputs) {
      const el = document.getElementById(id);
      if (el) el.disabled = !enabled;
    }
    const root = document?.body;
    if (root?.classList) root.classList.toggle('midi-disabled', !enabled);
  };

  const clearUiIntervals = () => {
    if (bpmIntervalId != null && typeof window?.clearInterval === 'function') {
      window.clearInterval(bpmIntervalId);
    }
    if (debugIntervalId != null && typeof window?.clearInterval === 'function') {
      window.clearInterval(debugIntervalId);
    }
    bpmIntervalId = null;
    debugIntervalId = null;
  };

  const clearMidiUiHook = () => {
    if (!window || !Object.prototype.hasOwnProperty.call(window, '__LEMMINGS_MIDI_UI__')) return;
    try {
      delete window.__LEMMINGS_MIDI_UI__;
    } catch {
      window.__LEMMINGS_MIDI_UI__ = undefined;
    }
  };

  const setMidiUiHook = () => {
    if (!window) return;
    window.__LEMMINGS_MIDI_UI__ = {
      dispatchIntent: (intent) => runMidiIntent(intent),
      getIntentState: () => ({ ...midiIntentState, overrides: cloneOverrides(midiIntentState.overrides) }),
      getFeatureFlags: () => ({ ...midiUiFeatureFlags }),
      setOverrides: (patch) => setMidiOverrides(patch),
      refresh: () => refreshMidiUiFromConfig(),
      dispose: () => disposeMidiUi(),
      captureNote: (note) => (typeof noteCapture === 'function' ? !!noteCapture(note) : false),
      auditionMapping: ({ targetKey = 'sfx', id, entry = null } = {}) => auditionMappingEntry({ targetKey, id, entry })
    };
  };

  const addDomListener = (element, eventName, handler) => {
    if (!element?.addEventListener || typeof handler !== 'function') return;
    element.addEventListener(eventName, handler);
    domListeners.push({ element, eventName, handler });
  };

  const disposeDomListeners = () => {
    while (domListeners.length) {
      const { element, eventName, handler } = domListeners.pop();
      element?.removeEventListener?.(eventName, handler);
    }
  };

  const disposeMidiUi = () => {
    clearUiIntervals();
    clearPendingRefreshTimers();
    unbindDeviceListeners();
    disposeDomListeners();
    clearMidiUiHook();
    clearNoteCapture();
    midiInputController?.setNoteCapture?.(null);
    midiInputController?.detach?.();
    activeMidiInput = null;
    midiUiBound = false;
    envControlsBound = false;
    lastUiSignature = null;
  };

  const bindMidiUi = () => {
    if (midiUiBound) return;
    const enabledToggle = document.getElementById('midiEnabledToggle');
    const inputChannel = document.getElementById('midiInputChannel');
    const leftPanel = document.getElementById('controlLeft');
    const bpmCurrent = document.getElementById('midiBpmCurrent');
    const debugInput = document.getElementById('midiDebugInput');
    const debugOutput = document.getElementById('midiDebugOutput');
    const repeatSection = document.getElementById('midiRepeatSection');

    ensureSchemaHash();
    midiUiFeatureFlags = readMidiUiFeatureFlags();
    if (document?.body?.classList) {
      document.body.classList.toggle('midi-expressive-controls', !!midiUiFeatureFlags.expressiveControls);
    }

    const storedEnabled = readStoredMidiId(storage, midiStorageKeys.enabled);
    const configEnabled = getConfig()?.enabled;
    const midiEnabled = storedEnabled != null
      ? storedEnabled !== 'false'
      : (typeof configEnabled === 'boolean' ? configEnabled : false);
    if (enabledToggle) enabledToggle.checked = midiEnabled;
    toggleMidiUiEnabled(midiEnabled);
    const storedChannel = readStoredMidiId(storage, midiStorageKeys.inputChannel);
    if (inputChannel) {
      const channel = storedChannel ?? getConfig()?.input?.channel ?? 'omni';
      const value = channel === 'omni' ? null : channel;
      buildChannelOptions(inputChannel, value);
    }
    if (storedChannel && storedChannel !== 'omni' &&
        (!midiOverrides?.input?.channel || midiOverrides.input.channel === 'omni')) {
      setMidiOverrides({ input: { channel: Number(storedChannel) } });
    }

    if (leftPanel) {
      const collapsed = readStoredMidiId(storage, midiStorageKeys.panelCollapsed) === 'true';
      if (collapsed) leftPanel.classList.add('collapsed');
    }

    let updateBpm = () => {};
    let updateDebug = () => {};
    const ensureUiIntervals = () => {
      if (typeof window?.setInterval !== 'function') return;
      if (bpmIntervalId == null) {
        bpmIntervalId = window.setInterval(updateBpm, 500);
      }
      if (debugIntervalId == null) {
        debugIntervalId = window.setInterval(updateDebug, 250);
      }
    };
    const updateBpmBase = (event) => {
      const bpm = Number(event.target.value) || 120;
      setMidiOverrides({ timing: { bpmBase: bpm } });
      updateBpm();
    };

    const clickHandlersById = {
      midiPanelToggle: () => {
        if (!leftPanel) return;
        leftPanel.classList.toggle('collapsed');
        const isCollapsed = leftPanel.classList.contains('collapsed');
        storeMidiId(storage, midiStorageKeys.panelCollapsed, isCollapsed ? 'true' : null);
        window?.setTimeout?.(() => {
          if (typeof window?.dispatchEvent === 'function') {
            const evt = typeof Event === 'function' ? new Event('resize') : { type: 'resize' };
            window.dispatchEvent(evt);
          }
        }, 0);
      },
      midiResetButton: () => {
        const lemmings = getLemmings();
        lemmings?.midiRouter?.scheduler?.allNotesOff?.();
        lemmings?.midiRouter?.scheduler?.clearQueue?.();
      },
      midiDefaultsButton: () => {
        resetMidiDefaults(true);
        resetUiState();
        refreshMidiUiFromConfig();
      },
      midiPositionAdd: () => {
        const config = getConfig();
        if (!config) return;
        const mappings = resolvePositionMappings(config);
        mappings.push(buildDefaultPositionMapping(config));
        setMidiOverrides({ position: { mappings } });
        queueMidiUiRefresh();
      },
      midiRepeatEnabled: (event) => event.stopPropagation()
    };

    const changeHandlersById = {
      midiEnabledToggle: async (event) => {
        const enabled = !!event.target.checked;
        storeMidiId(storage, midiStorageKeys.enabled, enabled ? 'true' : 'false');
        toggleMidiUiEnabled(enabled);
        const lemmings = getLemmings();
        if (lemmings?.setMidiEnabled) {
          await lemmings.setMidiEnabled(enabled);
        }
        if (!enabled) {
          clearUiIntervals();
          clearPendingRefreshTimers();
          clearMidiUiHook();
          unbindDeviceListeners();
          lastEnableError = null;
          clearErrorDisplay();
          setActiveMidiInput(null);
          setActiveMidiOutput(null);
        } else {
          setMidiUiHook();
          ensureUiIntervals();
          if (getWebMidi()?.enabled) {
            onEnabled();
          }
        }
      },
      midiInSelect: (event) => {
        const selectedId = event.target.value || null;
        storeMidiId(storage, midiStorageKeys.inputId, selectedId);
        setActiveMidiInput(selectedId);
        resetUiState();
      },
      midiOutSelect: (event) => {
        const selectedId = event.target.value || null;
        storeMidiId(storage, midiStorageKeys.outputId, selectedId);
        setActiveMidiOutput(selectedId);
        resetUiState();
      },
      midiViewPanToggle: (event) => {
        const enabled = !!event.target.checked;
        storeMidiId(storage, midiStorageKeys.viewPan, enabled ? 'true' : null);
        applyViewPanSetting(enabled);
      },
      midiInputChannel: (event) => {
        const raw = event.target.value;
        const storedValue = raw && raw !== 'omni' ? raw : null;
        storeMidiId(storage, midiStorageKeys.inputChannel, storedValue);
        setMidiOverrides({ input: { channel: storedValue ? Number(storedValue) : 'omni' } });
      },
      midiBpmBase: updateBpmBase,
      midiKeySelect: (event) => {
        const value = Number(event.target.value);
        setMidiOverrides({ scale: { root: value } });
      },
      midiScaleSelect: (event) => {
        const value = event.target.value;
        setMidiOverrides({ scale: { name: value } });
      },
      midiIntensity: (event) => {
        const value = Number(event.target.value) || 0;
        setMidiOverrides({ velocityRange: { default: value } });
      },
      midiAccent: (event) => {
        const value = Number(event.target.value) || 0;
        setMidiOverrides({ density: { velocityBoost: value } });
      },
      midiRepeatEnabled: (event) => {
        const enabled = !!event.target.checked;
        setMidiOverrides({ repeat: { enabled } });
        if (enabled && repeatSection && !repeatSection.open) {
          repeatSection.open = true;
          const key = repeatSection.dataset.sectionKey || 'repeat';
          const states = tabUi.readSectionStates();
          states[key] = true;
          tabUi.storeSectionStates(states);
        }
      },
      midiRepeatCount: (event) => {
        const value = Number(event.target.value) || 0;
        setMidiOverrides({ repeat: { maxRepeats: value } });
      },
      midiRepeatSpacing: (event) => {
        const value = Number(event.target.value) || 1;
        setMidiOverrides({ repeat: { windowBeats: value } });
      },
      midiRepeatTarget: (event) => {
        const value = event.target.value || 'velocity';
        setMidiOverrides({ repeat: { target: value } });
      },
      midiRepeatAmount: (event) => {
        const value = Number(event.target.value) || 0;
        setMidiOverrides({ repeat: { amount: value } });
      }
    };

    const inputHandlersById = {
      midiBpmBase: updateBpmBase
    };

    const bindHandlersById = (eventName, handlersById) => {
      for (const [id, handler] of Object.entries(handlersById)) {
        const element = document.getElementById(id);
        if (!element || typeof handler !== 'function') continue;
        addDomListener(element, eventName, handler);
      }
    };

    bindHandlersById('click', clickHandlersById);
    bindHandlersById('change', changeHandlersById);
    bindHandlersById('input', inputHandlersById);

    bindEnvelopeControls();

    tabUi.bindTabs();
    tabUi.bindSectionPersistence();

    updateBpm = () => {
      if (!bpmCurrent) return;
      const config = getEffectiveConfig() || {};
      const timing = config.timing || {};
      const base = Number.isFinite(timing.bpmBase) ? timing.bpmBase : 120;
      const timeSignature = timing.timeSignature || {};
      const beats = Number.isFinite(timeSignature.beats) ? timeSignature.beats : 4;
      const unit = Number.isFinite(timeSignature.unit) && timeSignature.unit > 0 ? timeSignature.unit : 4;
      const lemmings = getLemmings();
      const timer = lemmings?.game?.getGameTimer?.();
      const speed = timer?.speedFactor ?? lemmings?.gameSpeedFactor ?? 1;
      const tps = timer?.tps ?? (timer?.frameTime ? 1000 / timer.frameTime : 1000 / 60);
      const currentBpm = base * speed;
      const ticksPerQuarter = currentBpm > 0 ? (tps * 60 / currentBpm) : 0;
      const unitScale = 4 / unit;
      const ticksPerBeat = ticksPerQuarter * unitScale;
      const ticksPerMeasure = ticksPerBeat * beats;
      bpmCurrent.textContent = `${formatNumber(speed, 2)}x ${formatNumber(base, 0)} = ${formatNumber(currentBpm, 0)} BPM | ${formatNumber(tps, 1)} tps | ${formatNumber(ticksPerBeat, 1)} t/beat | ${formatNumber(ticksPerMeasure, 1)} t/measure`;
      const uiSignature = buildUiSignature();
      if (uiSignature !== lastUiSignature) {
        lastUiSignature = uiSignature;
        try {
          refreshMidiUiFromConfig();
        } catch (e) {
          console.error('MIDI UI refresh failed', e);
        }
      }
    };
    updateBpm();

    updateDebug = () => {
      if (debugInput) {
        debugInput.textContent = `Input: ${formatDebugBytes(window?.lastMidiInputMessage)}`;
      }
      if (debugOutput) {
        debugOutput.textContent = `Output: ${formatDebugOutput(window?.lastMidiOutputMessage)}`;
      }
    };
    updateDebug();
    if (midiEnabled) {
      setMidiUiHook();
      ensureUiIntervals();
    } else {
      clearUiIntervals();
      clearPendingRefreshTimers();
      clearMidiUiHook();
    }

    midiUiBound = true;
  };

  return {
    bindMidiUi,
    scheduleMidiUiRefresh,
    onEnabled,
    showError,
    getMidiStatusHandlers() {
      return {
        onEnabled,
        onError: showError
      };
    },
    refreshMidiUiFromConfig,
    setMidiOverrides,
    auditionMapping(targetKey, id, entry = null) {
      return auditionMappingEntry({ targetKey, id, entry });
    },
    dispatchMidiIntent(intent) {
      const state = runMidiIntent(intent);
      if (midiUiBound) {
        const sections = intent?.type === 'overrides.merge'
          ? deriveRefreshSectionsFromPatch(intent.patch)
          : null;
        queueMidiUiRefresh({ sections });
      }
      return state;
    },
    getMidiIntentState() {
      return { ...midiIntentState, overrides: cloneOverrides(midiIntentState.overrides) };
    },
    captureLearnNote(note) {
      return typeof noteCapture === 'function' ? !!noteCapture(note) : false;
    },
    setMidiInputController(controller) {
      const previousController = midiInputController;
      if (previousController && previousController !== controller) {
        previousController.detach?.();
      }
      midiInputController = controller;
      if (midiInputController?.setNoteCapture) {
        midiInputController.setNoteCapture(noteCapture);
      }
      if (activeMidiInput) {
        midiInputController?.attach?.(activeMidiInput);
      }
    },
    getMidiOverrides() {
      return midiOverrides;
    },
    getMidiConfig: getConfig,
    getFeatureFlags() {
      return { ...midiUiFeatureFlags };
    },
    getStoredEnabled() {
      const stored = readStoredMidiId(storage, midiStorageKeys.enabled);
      if (stored != null) return stored !== 'false';
      const configEnabled = getConfig()?.enabled;
      if (typeof configEnabled === 'boolean') return configEnabled;
      return false;
    },
    getStorageKeys() {
      return { ...midiStorageKeys };
    },
    dispose: disposeMidiUi,
    __test__: {
      applySectionStates: tabUi.applySectionStates,
      buildPositionMappingList,
      resetMidiDefaults,
      runMidiIntent,
      armMidiLearn,
      disarmMidiLearn
    },
    setActiveMidiInput,
    setActiveMidiOutput
  };
};
