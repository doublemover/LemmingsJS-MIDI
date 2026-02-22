import { MidiMapping, ScaleLibrary } from '../midi/MidiMapping.js';
import { getAppContext } from '../core/dependencies.js';
import {
  CHORD_OPTIONS,
  NOTE_NAMES,
  collectTriggerTypes,
  resolveAvailableSfxIds,
  resolvePositionMappings
} from './midi-ui/midiUiDomain.js';
import {
  midiStorageKeys,
  readStoredMidiId,
  readStoredMidiOverrides,
  readStoredSectionStates,
  readStoredJson,
  storeJson,
  storeMidiId
} from './midi-ui/midiUiStorage.js';
import { createMidiIntentState, reduceMidiIntent } from './midi-ui/midiUiIntent.js';
import { createMidiLearnController } from './midi-ui/midiUiLearn.js';
import { createMidiUiTabsController } from './midi-ui/midiUiTabs.js';
import { createMidiUiSectionsController } from './midi-ui/midiUiSections.js';

const mergeDeep = (target, source) => {
  if (!source || typeof source !== 'object') return target;
  const out = { ...(target || {}) };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = mergeDeep(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const formatNumber = (value, digits = 2) => {
  if (!Number.isFinite(value)) return '--';
  const fixed = value.toFixed(digits);
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/\.?0+$/, '');
};

const formatDebugBytes = (bytes) => {
  if (!Array.isArray(bytes) || !bytes.length) return '--';
  return bytes
    .map(value => Number(value).toString(16).padStart(2, '0'))
    .join(' ');
};

const formatDebugOutput = (payload) => {
  if (!payload) return '--';
  if (Array.isArray(payload)) return formatDebugBytes(payload);
  if (typeof payload === 'object') {
    const note = Number.isFinite(payload.note) ? payload.note : '?';
    const velocity = Number.isFinite(payload.velocity) ? payload.velocity : '?';
    const channel = Number.isFinite(payload.channel) ? payload.channel : '?';
    return `note ${note} vel ${velocity} ch ${channel}`;
  }
  return String(payload);
};


export const createMidiUiController = ({
  window = globalThis.window,
  document = globalThis.document,
  getLemmings = () => getAppContext(),
  getWebMidi = () => globalThis.WebMidi,
  getMidiConfig = null
} = {}) => {
  const storage = window?.localStorage;
  let activeMidiInput = null;
  let midiUiBound = false;
  let midiViewPanEnabled = false;
  let midiInputController = null;
  let midiOverrides = readStoredMidiOverrides(storage);
  let midiIntentState = createMidiIntentState({ overrides: midiOverrides });
  let envControlsBound = false;
  let lastUiSignature = null;
  let noteCapture = null;
  let lastEnableError = null;
  let deviceRefreshTimer = null;
  let deviceListenersBound = false;
  let deviceListener = null;
  let queuedRefreshTimer = null;
  let queuedRefreshAll = false;
  let queuedRefreshForce = false;
  const queuedRefreshSections = new Set();
  if (!isPlainObject(midiOverrides)) {
    midiOverrides = {};
  }
  midiIntentState = createMidiIntentState({ overrides: midiOverrides });

  const applyOverridesToRuntime = () => {
    storeJson(storage, midiStorageKeys.overrides, midiOverrides);
    const lemmings = getLemmings();
    if (lemmings?.setMidiOverrides) {
      lemmings.setMidiOverrides(midiOverrides);
    } else if (lemmings?.applyMidiOverrides) {
      lemmings.applyMidiOverrides(midiOverrides);
    }
  };

  const runMidiIntent = (intent) => {
    const prevOverrides = midiIntentState.overrides;
    midiIntentState = reduceMidiIntent(midiIntentState, intent);
    if (!isPlainObject(midiIntentState.overrides)) {
      midiIntentState = reduceMidiIntent(midiIntentState, { type: 'overrides.replace', overrides: {} });
    }
    midiOverrides = midiIntentState.overrides;
    if (midiOverrides !== prevOverrides) {
      applyOverridesToRuntime();
    }
    return midiIntentState;
  };

  const deriveRefreshSectionsFromPatch = (patch) => {
    if (!isPlainObject(patch)) return null;
    const sections = new Set();
    if (Object.prototype.hasOwnProperty.call(patch, 'timing')) {
      sections.add('bpm');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'scale')) {
      sections.add('scale');
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, 'velocityRange') ||
      Object.prototype.hasOwnProperty.call(patch, 'density')
    ) {
      sections.add('velocity');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'repeat')) {
      sections.add('repeat');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'input')) {
      sections.add('view');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'envelope')) {
      sections.add('envelope');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'position')) {
      sections.add('position');
      sections.add('view');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'sfx')) {
      sections.add('events');
      sections.add('envTargets');
      sections.add('envelope');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'triggers')) {
      sections.add('triggers');
      sections.add('envTargets');
      sections.add('envelope');
    }
    return sections.size ? sections : null;
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

  const resolveMidiId = (devices, ...preferredIds) => {
    if (!devices || !devices.length) return null;
    for (const preferredId of preferredIds) {
      if (preferredId && devices.some(device => device.id === preferredId)) {
        return preferredId;
      }
    }
    return devices[0].id;
  };

  const populateMidiSelect = (select, devices, emptyLabel) => {
    if (!select) return;
    select.innerHTML = '';
    if (!devices || !devices.length) {
      const opt = document.createElement('option');
      opt.textContent = emptyLabel;
      opt.value = '';
      select.appendChild(opt);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    for (const device of devices.values()) {
      const opt = document.createElement('option');
      opt.textContent = device.name;
      opt.value = device.id;
      select.appendChild(opt);
    }
  };

  const getErrorDisplay = () => document.getElementById('errorDisplay');

  const clearErrorDisplay = () => {
    const errorDisplay = getErrorDisplay();
    if (errorDisplay) errorDisplay.innerHTML = '';
  };

  const appendError = (message) => {
    const errorDisplay = getErrorDisplay();
    if (!errorDisplay || !message) return;
    errorDisplay.innerHTML += `${message}<br />`;
  };

  const renderErrorDisplay = ({ inputs, outputs } = {}) => {
    clearErrorDisplay();
    if (lastEnableError) {
      appendError(lastEnableError);
    }
    if (Array.isArray(inputs) && inputs.length < 1) {
      appendError('No input device detected.');
    }
    if (Array.isArray(outputs) && outputs.length < 1) {
      appendError('No output device detected.');
    }
  };

  const showError = (message) => {
    lastEnableError = message ? String(message) : null;
    const webMidi = getWebMidi();
    renderErrorDisplay({
      inputs: webMidi?.inputs || [],
      outputs: webMidi?.outputs || []
    });
  };

  const setActiveMidiInput = (inputId) => {
    activeMidiInput = null;
    if (!inputId || !getWebMidi()?.enabled || !midiInputController) {
      midiInputController?.detach?.();
      return;
    }
    const input = getWebMidi().getInputById(inputId);
    if (!input) return;
    midiInputController.attach(input);
    activeMidiInput = input;
  };

  const setActiveMidiOutput = (outputId) => {
    if (!getWebMidi()?.enabled) return;
    const output = outputId ? getWebMidi().getOutputById(outputId) : null;
    const lemmings = getLemmings();
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
    midiViewPanEnabled = !!enabled;
    setMidiOverrides({ position: { viewPan: midiViewPanEnabled } });
  };

  const getConfig = () => {
    if (typeof getMidiConfig === 'function') return getMidiConfig();
    const lemmings = getLemmings();
    return lemmings?.getMidiConfig?.() || lemmings?.getMidiBaseConfig?.() || null;
  };

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
  };

  const resetMidiDefaults = (persistHash = true) => {
    const expectedHash = getSchemaHash();
    clearMidiStorage();
    runMidiIntent({ type: 'overrides.replace', overrides: {} });
    storeJson(storage, midiStorageKeys.overrides, null);
    disarmMidiLearn();
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

  const createChoiceButtons = (choices, initialValue, onChange) => {
    const wrap = document.createElement('div');
    wrap.className = 'midi-choice-buttons';
    let value = initialValue;
    const sync = () => {
      Array.from(wrap.children).forEach((btn) => {
        const selected = btn.dataset.value === String(value);
        btn.classList.toggle('active', selected);
      });
    };
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button-compact';
      btn.dataset.value = String(choice.value);
      btn.textContent = choice.label;
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

  const buildMappingEditor = ({ id, name, entry, targetKey, allowIndependentArp = false }) => {
    const details = document.createElement('details');
    details.className = 'panel-section';
    const summary = document.createElement('summary');
    summary.className = 'panel-title panel-title-row';
    const summaryTitle = document.createElement('span');
    summaryTitle.className = 'panel-title-text';
    summaryTitle.textContent = name || `Event ${id}`;
    const enabledToggle = document.createElement('input');
    enabledToggle.type = 'checkbox';
    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'panel-title-toggle';
    const enabledText = document.createElement('span');
    enabledText.textContent = 'Enabled';
    enabledLabel.appendChild(enabledText);
    enabledLabel.appendChild(enabledToggle);
    summary.appendChild(summaryTitle);
    summary.appendChild(enabledLabel);
    details.appendChild(summary);

    summary.addEventListener('click', (event) => {
      if (enabledLabel.contains(event.target)) return;
      event.preventDefault();
      details.open = !details.open;
    });

    const modeSelect = document.createElement('select');
    ['note', 'degree', 'chord'].forEach(mode => {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = mode;
      modeSelect.appendChild(opt);
    });
    const noteKeySelect = document.createElement('select');
    const notePlaceholder = document.createElement('option');
    notePlaceholder.value = '';
    notePlaceholder.textContent = '--';
    noteKeySelect.appendChild(notePlaceholder);
    NOTE_NAMES.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = name;
      noteKeySelect.appendChild(opt);
    });
    const noteInput = document.createElement('input');
    noteInput.type = 'number';
    noteInput.min = '0';
    noteInput.max = '127';

    const noteOctaveInput = document.createElement('input');
    noteOctaveInput.type = 'number';
    noteOctaveInput.min = '0';
    noteOctaveInput.max = '9';

    const degreeInput = document.createElement('input');
    degreeInput.type = 'number';
    degreeInput.min = '0';
    degreeInput.max = '12';

    const octaveInput = document.createElement('input');
    octaveInput.type = 'number';
    octaveInput.min = '0';
    octaveInput.max = '9';

    const chordSelect = document.createElement('select');
    CHORD_OPTIONS.forEach(chord => {
      const opt = document.createElement('option');
      opt.value = chord;
      opt.textContent = chord;
      chordSelect.appendChild(opt);
    });
    const chordQuick = createChoiceButtons(
      CHORD_OPTIONS.map((chord) => ({ value: chord, label: chord })),
      entry?.chord?.type || 'triad',
      (value) => {
        chordSelect.value = value;
        updateEntry();
      }
    );

    const arpToggle = document.createElement('input');
    arpToggle.type = 'checkbox';
    const arpMode = document.createElement('select');
    ['up', 'down', 'updown'].forEach(mode => {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = mode;
      arpMode.appendChild(opt);
    });
    const arpQuick = createChoiceButtons(
      ['up', 'down', 'updown'].map((mode) => ({ value: mode, label: mode })),
      entry?.arp?.mode || 'up',
      (value) => {
        arpMode.value = value;
        updateEntry();
      }
    );
    const arpLength = document.createElement('input');
    arpLength.type = 'number';
    arpLength.min = '1';
    arpLength.max = '8';

    const arpIndependentToggle = document.createElement('input');
    arpIndependentToggle.type = 'checkbox';

    const priorityInput = document.createElement('input');
    priorityInput.type = 'number';
    priorityInput.min = '1';
    priorityInput.max = '4';

    const initialMode = entry?.chord
      ? 'chord'
      : (entry?.degree != null ? 'degree' : 'note');
    modeSelect.value = initialMode;
    const noteValue = Number.isFinite(entry?.note) ? entry.note : null;
    if (noteValue != null) {
      noteInput.value = String(noteValue);
      noteKeySelect.value = String(noteValue % 12);
      noteOctaveInput.value = String(Math.floor(noteValue / 12));
    } else {
      noteInput.value = '';
      noteKeySelect.value = '';
      noteOctaveInput.value = '';
    }
    degreeInput.value = entry?.degree ?? '';
    octaveInput.value = entry?.octave ?? '';
    chordSelect.value = entry?.chord?.type || 'triad';
    chordQuick.setValue(chordSelect.value);
    arpToggle.checked = !!entry?.arp?.enabled;
    arpMode.value = entry?.arp?.mode || 'up';
    arpQuick.setValue(arpMode.value);
    arpLength.value = entry?.arp?.length ?? 3;
    arpIndependentToggle.checked = !!entry?.arp?.independent;
    priorityInput.value = entry?.priority ?? '';
    enabledToggle.checked = !entry?.disabled;

    const updateModeAvailability = () => {
      const mode = modeSelect.value;
      const noteEnabled = mode === 'note';
      const degreeEnabled = mode === 'degree' || mode === 'chord';
      noteInput.disabled = !noteEnabled;
      noteKeySelect.disabled = !noteEnabled;
      noteOctaveInput.disabled = !noteEnabled;
      degreeInput.disabled = !degreeEnabled;
      octaveInput.disabled = !degreeEnabled;
      chordSelect.disabled = mode !== 'chord';
      chordQuick.element.hidden = mode !== 'chord';
      arpQuick.element.hidden = !arpToggle.checked;
    };
    updateModeAvailability();

    const updateEntry = () => {
      const next = { ...(entry || {}) };
      if (name) next.name = name;
      next.note = null;
      next.degree = null;
      next.octave = null;
      next.chord = null;
      next.arp = null;
      next.priority = null;
      next.disabled = false;
      const mode = modeSelect.value;
      if (mode === 'note') {
        const directNote = Number(noteInput.value);
        if (noteInput.value !== '' && Number.isFinite(directNote)) {
          next.note = Math.max(0, Math.min(127, Math.trunc(directNote)));
        } else if (noteKeySelect.value !== '' && noteOctaveInput.value !== '') {
          const key = Number(noteKeySelect.value);
          const octave = Number(noteOctaveInput.value);
          if (Number.isFinite(key) && Number.isFinite(octave)) {
            next.note = Math.max(0, Math.min(127, key + octave * 12));
          }
        }
      }
      if (mode === 'degree' || mode === 'chord') {
        if (degreeInput.value !== '') next.degree = Number(degreeInput.value);
        if (octaveInput.value !== '') next.octave = Number(octaveInput.value);
      }
      if (mode === 'chord') {
        next.chord = { type: chordSelect.value || 'triad' };
      }
      if (arpToggle.checked) {
        next.arp = { enabled: true, mode: arpMode.value, length: Number(arpLength.value) || 3 };
        if (allowIndependentArp && arpIndependentToggle.checked) {
          next.arp.independent = true;
        }
      }
      if (priorityInput.value !== '') next.priority = Number(priorityInput.value);
      if (!enabledToggle.checked) next.disabled = true;
      chordQuick.setValue(chordSelect.value || 'triad');
      arpQuick.setValue(arpMode.value || 'up');
      const patch = { [targetKey]: { [String(id)]: next } };
      setMidiOverrides(patch);
    };

    const syncDirectNoteFromKeyOctave = () => {
      const key = Number(noteKeySelect.value);
      const octave = Number(noteOctaveInput.value);
      if (noteKeySelect.value === '' || noteOctaveInput.value === '' || !Number.isFinite(key) || !Number.isFinite(octave)) {
        noteInput.value = '';
        return;
      }
      noteInput.value = String(Math.max(0, Math.min(127, key + octave * 12)));
    };

    const syncKeyOctaveFromDirectNote = () => {
      const note = Number(noteInput.value);
      if (noteInput.value === '' || !Number.isFinite(note)) {
        noteKeySelect.value = '';
        noteOctaveInput.value = '';
        return;
      }
      const clamped = Math.max(0, Math.min(127, Math.trunc(note)));
      noteInput.value = String(clamped);
      noteKeySelect.value = String(clamped % 12);
      noteOctaveInput.value = String(Math.floor(clamped / 12));
    };

    const resolveScaleForNote = () => {
      const config = getConfig();
      const scale = config?.scale || {};
      const root = Number.isFinite(scale.root) ? scale.root : 0;
      const degrees = Array.isArray(scale.degrees) && scale.degrees.length
        ? scale.degrees
        : (ScaleLibrary[scale.name] || ScaleLibrary['chromatic-minor'] || NOTE_NAMES.map((_, idx) => idx));
      return { root, degrees };
    };

    const noteToScaleDegree = (note) => {
      const { root, degrees } = resolveScaleForNote();
      const relative = ((note - root) % 12 + 12) % 12;
      let degreeIndex = degrees.indexOf(relative);
      if (degreeIndex < 0) {
        let best = 0;
        let bestDist = 99;
        degrees.forEach((deg, idx) => {
          const dist = Math.min(Math.abs(deg - relative), 12 - Math.abs(deg - relative));
          if (dist < bestDist) {
            bestDist = dist;
            best = idx;
          }
        });
        degreeIndex = best;
      }
      const degreeOffset = degrees[degreeIndex] ?? 0;
      const octave = Math.max(0, Math.floor((note - root - degreeOffset) / 12));
      return { degree: degreeIndex, octave };
    };

    const applyLearnedNote = (note) => {
      if (!Number.isFinite(note)) return;
      if (modeSelect.value === 'note') {
        const clamped = Math.max(0, Math.min(127, Math.trunc(note)));
        noteInput.value = String(clamped);
        syncKeyOctaveFromDirectNote();
      } else {
        const resolved = noteToScaleDegree(note);
        degreeInput.value = String(resolved.degree);
        octaveInput.value = String(resolved.octave);
      }
      updateEntry();
    };

    const bindNoteCapture = (row, input) => {
      if (!row || !input) return;
      const learnTarget = `${targetKey}:${id}:${row.children?.[0]?.textContent || 'field'}`;
      const arm = () => {
        if (input.disabled) return;
        armMidiLearn(learnTarget, (captureNote) => {
          applyLearnedNote(captureNote);
          return true;
        });
      };
      const label = typeof row.querySelector === 'function'
        ? row.querySelector('span')
        : (row.children ? row.children[0] : null);
      if (label) {
        label.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof input.focus === 'function') input.focus();
          arm();
        });
      }
      input.addEventListener('focus', arm);
      input.addEventListener('blur', () => disarmMidiLearn(learnTarget));
    };

    modeSelect.addEventListener('change', () => {
      updateModeAvailability();
      updateEntry();
    });
    noteInput.addEventListener('input', () => {
      syncKeyOctaveFromDirectNote();
      updateEntry();
    });
    noteInput.addEventListener('change', () => {
      syncKeyOctaveFromDirectNote();
      updateEntry();
    });
    [noteKeySelect, noteOctaveInput].forEach((el) => {
      el.addEventListener('change', () => {
        syncDirectNoteFromKeyOctave();
        updateEntry();
      });
    });
    [degreeInput, octaveInput, chordSelect, arpLength, arpIndependentToggle, priorityInput, enabledToggle]
      .forEach(el => el.addEventListener('change', updateEntry));
    arpToggle.addEventListener('change', () => {
      updateModeAvailability();
      updateEntry();
    });
    arpMode.addEventListener('change', () => {
      arpQuick.setValue(arpMode.value || 'up');
      updateEntry();
    });
    chordSelect.addEventListener('change', () => {
      chordQuick.setValue(chordSelect.value || 'triad');
      updateEntry();
    });

    const modeRow = createRow('Mode', modeSelect);
    const noteRow = createRow('Note', noteInput);
    const keyRow = createRow('Key', noteKeySelect);
    const octaveRow = createRow('Octave', noteOctaveInput);
    const degreeRow = createRow('Degree', degreeInput);
    const scaleOctaveRow = createRow('Scale octave', octaveInput);
    details.appendChild(modeRow);
    details.appendChild(noteRow);
    details.appendChild(keyRow);
    details.appendChild(octaveRow);
    details.appendChild(degreeRow);
    details.appendChild(scaleOctaveRow);
    details.appendChild(createRow('Chord', chordSelect));
    details.appendChild(createRow('Chord quick', chordQuick.element));
    details.appendChild(createRow('Arp', arpToggle));
    details.appendChild(createRow('Arp mode', arpMode));
    details.appendChild(createRow('Arp quick', arpQuick.element));
    details.appendChild(createRow('Arp length', arpLength));
    if (allowIndependentArp) {
      details.appendChild(createRow('Independent arp', arpIndependentToggle));
    }
    details.appendChild(createRow('Priority', priorityInput));
    enabledLabel.addEventListener('click', (event) => event.stopPropagation());
    enabledToggle.addEventListener('click', (event) => event.stopPropagation());
    bindNoteCapture(noteRow, noteInput);
    bindNoteCapture(keyRow, noteKeySelect);
    bindNoteCapture(octaveRow, noteOctaveInput);
    bindNoteCapture(degreeRow, degreeInput);
    bindNoteCapture(scaleOctaveRow, octaveInput);
    return details;
  };

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
    let attempts = 0;
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
          window?.setTimeout?.(attempt, 250);
        }
      }
    };
    window?.setTimeout?.(attempt, 0);
  };

  const refreshDeviceLists = ({ preserveSelection = true } = {}) => {
    const inputSelect = document.getElementById('midiInSelect');
    const outputSelect = document.getElementById('midiOutSelect');
    const viewPanToggle = document.getElementById('midiViewPanToggle');
    const webMidi = getWebMidi();
    const inputs = webMidi?.inputs || [];
    const outputs = webMidi?.outputs || [];
    renderErrorDisplay({ inputs, outputs });
    populateMidiSelect(inputSelect, inputs, 'No input devices');

    populateMidiSelect(outputSelect, outputs, 'No output devices');

    const storedInputId = readStoredMidiId(storage, midiStorageKeys.inputId);
    const storedOutputId = readStoredMidiId(storage, midiStorageKeys.outputId);
    const currentInputId = preserveSelection ? (activeMidiInput?.id || inputSelect?.value) : null;
    const currentOutputId = preserveSelection
      ? (getLemmings()?.midiOut?.id || outputSelect?.value)
      : null;
    const resolvedInputId = resolveMidiId(inputs, currentInputId, storedInputId);
    const resolvedOutputId = resolveMidiId(outputs, currentOutputId, storedOutputId);
    const shouldResetUi = (storedInputId && resolvedInputId && storedInputId !== resolvedInputId) ||
      (storedOutputId && resolvedOutputId && storedOutputId !== resolvedOutputId);

    if (resolvedInputId && inputSelect) {
      inputSelect.value = resolvedInputId;
      storeMidiId(storage, midiStorageKeys.inputId, resolvedInputId);
      setActiveMidiInput(resolvedInputId);
    } else {
      setActiveMidiInput(null);
    }

    if (resolvedOutputId && outputSelect) {
      outputSelect.value = resolvedOutputId;
      storeMidiId(storage, midiStorageKeys.outputId, resolvedOutputId);
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

  const bindMidiUi = () => {
    if (midiUiBound) return;
    const enabledToggle = document.getElementById('midiEnabledToggle');
    const inputSelect = document.getElementById('midiInSelect');
    const outputSelect = document.getElementById('midiOutSelect');
    const viewPanToggle = document.getElementById('midiViewPanToggle');
    const inputChannel = document.getElementById('midiInputChannel');
    const resetButton = document.getElementById('midiResetButton');
    const defaultsButton = document.getElementById('midiDefaultsButton');
    const panelToggle = document.getElementById('midiPanelToggle');
    const leftPanel = document.getElementById('controlLeft');
    const bpmBase = document.getElementById('midiBpmBase');
    const bpmCurrent = document.getElementById('midiBpmCurrent');
    const debugInput = document.getElementById('midiDebugInput');
    const debugOutput = document.getElementById('midiDebugOutput');
    const keySelect = document.getElementById('midiKeySelect');
    const scaleSelect = document.getElementById('midiScaleSelect');
    const positionAdd = document.getElementById('midiPositionAdd');
    const intensity = document.getElementById('midiIntensity');
    const accent = document.getElementById('midiAccent');
    const repeatEnabled = document.getElementById('midiRepeatEnabled');
    const repeatSection = document.getElementById('midiRepeatSection');
    const repeatCount = document.getElementById('midiRepeatCount');
    const repeatSpacing = document.getElementById('midiRepeatSpacing');
    const repeatTarget = document.getElementById('midiRepeatTarget');
    const repeatAmount = document.getElementById('midiRepeatAmount');

    ensureSchemaHash();

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
    if (panelToggle && leftPanel) {
      panelToggle.addEventListener('click', () => {
        leftPanel.classList.toggle('collapsed');
        const isCollapsed = leftPanel.classList.contains('collapsed');
        storeMidiId(storage, midiStorageKeys.panelCollapsed, isCollapsed ? 'true' : null);
        window?.setTimeout?.(() => {
          if (typeof window?.dispatchEvent === 'function') {
            const evt = typeof Event === 'function' ? new Event('resize') : { type: 'resize' };
            window.dispatchEvent(evt);
          }
        }, 0);
      });
    }

    if (enabledToggle) {
      enabledToggle.addEventListener('change', async (event) => {
        const enabled = !!event.target.checked;
        storeMidiId(storage, midiStorageKeys.enabled, enabled ? 'true' : 'false');
        toggleMidiUiEnabled(enabled);
        const lemmings = getLemmings();
        if (lemmings?.setMidiEnabled) {
          await lemmings.setMidiEnabled(enabled);
        }
        if (!enabled) {
          unbindDeviceListeners();
          lastEnableError = null;
          clearErrorDisplay();
          setActiveMidiInput(null);
          setActiveMidiOutput(null);
        } else if (getWebMidi()?.enabled) {
          onEnabled();
        }
      });
    }

    if (inputSelect) {
      inputSelect.addEventListener('change', (event) => {
        const selectedId = event.target.value || null;
        storeMidiId(storage, midiStorageKeys.inputId, selectedId);
        setActiveMidiInput(selectedId);
        resetUiState();
      });
    }
    if (outputSelect) {
      outputSelect.addEventListener('change', (event) => {
        const selectedId = event.target.value || null;
        storeMidiId(storage, midiStorageKeys.outputId, selectedId);
        setActiveMidiOutput(selectedId);
        resetUiState();
      });
    }
    if (viewPanToggle) {
      viewPanToggle.addEventListener('change', (event) => {
        const enabled = !!event.target.checked;
        storeMidiId(storage, midiStorageKeys.viewPan, enabled ? 'true' : null);
        applyViewPanSetting(enabled);
      });
    }
    if (inputChannel) {
      inputChannel.addEventListener('change', (event) => {
        const raw = event.target.value;
        const storedValue = raw && raw !== 'omni' ? raw : null;
        storeMidiId(storage, midiStorageKeys.inputChannel, storedValue);
        setMidiOverrides({ input: { channel: storedValue ? Number(storedValue) : 'omni' } });
      });
    }
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        const lemmings = getLemmings();
        lemmings?.midiRouter?.scheduler?.allNotesOff?.();
        lemmings?.midiRouter?.scheduler?.clearQueue?.();
      });
    }
    if (defaultsButton) {
      defaultsButton.addEventListener('click', () => {
        resetMidiDefaults(true);
        resetUiState();
        refreshMidiUiFromConfig();
      });
    }
    if (bpmBase) {
      const updateBpmBase = (event) => {
        const bpm = Number(event.target.value) || 120;
        setMidiOverrides({ timing: { bpmBase: bpm } });
        updateBpm();
      };
      bpmBase.addEventListener('change', updateBpmBase);
      bpmBase.addEventListener('input', updateBpmBase);
    }
    if (keySelect) {
      keySelect.addEventListener('change', (event) => {
        const value = Number(event.target.value);
        setMidiOverrides({ scale: { root: value } });
      });
    }
    if (scaleSelect) {
      scaleSelect.addEventListener('change', (event) => {
        const value = event.target.value;
        setMidiOverrides({ scale: { name: value } });
      });
    }
    if (positionAdd) {
      positionAdd.addEventListener('click', () => {
        const config = getConfig();
        if (!config) return;
        const mappings = resolvePositionMappings(config);
        mappings.push(buildDefaultPositionMapping(config));
        setMidiOverrides({ position: { mappings } });
        queueMidiUiRefresh();
      });
    }
    if (intensity) {
      intensity.addEventListener('change', (event) => {
        const value = Number(event.target.value) || 0;
        setMidiOverrides({ velocityRange: { default: value } });
      });
    }
    if (accent) {
      accent.addEventListener('change', (event) => {
        const value = Number(event.target.value) || 0;
        setMidiOverrides({ density: { velocityBoost: value } });
      });
    }
    if (repeatEnabled) {
      repeatEnabled.addEventListener('click', (event) => event.stopPropagation());
      repeatEnabled.addEventListener('change', (event) => {
        const enabled = !!event.target.checked;
        setMidiOverrides({ repeat: { enabled } });
        if (enabled && repeatSection && !repeatSection.open) {
          repeatSection.open = true;
          const key = repeatSection.dataset.sectionKey || 'repeat';
          const states = tabUi.readSectionStates();
          states[key] = true;
          tabUi.storeSectionStates(states);
        }
      });
    }
    if (repeatCount) {
      repeatCount.addEventListener('change', (event) => {
        const value = Number(event.target.value) || 0;
        setMidiOverrides({ repeat: { maxRepeats: value } });
      });
    }
    if (repeatSpacing) {
      repeatSpacing.addEventListener('change', (event) => {
        const value = Number(event.target.value) || 1;
        setMidiOverrides({ repeat: { windowBeats: value } });
      });
    }
    if (repeatTarget) {
      repeatTarget.addEventListener('change', (event) => {
        const value = event.target.value || 'velocity';
        setMidiOverrides({ repeat: { target: value } });
      });
    }
    if (repeatAmount) {
      repeatAmount.addEventListener('change', (event) => {
        const value = Number(event.target.value) || 0;
        setMidiOverrides({ repeat: { amount: value } });
      });
    }
    bindEnvelopeControls();

    tabUi.bindTabs();
    tabUi.bindSectionPersistence();

    const updateBpm = () => {
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
    window?.setInterval?.(updateBpm, 500);

    const updateDebug = () => {
      if (debugInput) {
        debugInput.textContent = `Input: ${formatDebugBytes(window?.lastMidiInputMessage)}`;
      }
      if (debugOutput) {
        debugOutput.textContent = `Output: ${formatDebugOutput(window?.lastMidiOutputMessage)}`;
      }
    };
    updateDebug();
    window?.setInterval?.(updateDebug, 250);

    if (window) {
      window.__LEMMINGS_MIDI_UI__ = {
        dispatchIntent: (intent) => runMidiIntent(intent),
        getIntentState: () => ({ ...midiIntentState, overrides: mergeDeep({}, midiIntentState.overrides || {}) }),
        setOverrides: (patch) => setMidiOverrides(patch),
        refresh: () => refreshMidiUiFromConfig(),
        captureNote: (note) => (typeof noteCapture === 'function' ? !!noteCapture(note) : false)
      };
    }

    midiUiBound = true;
  };

  return {
    bindMidiUi,
    scheduleMidiUiRefresh,
    onEnabled,
    showError,
    refreshMidiUiFromConfig,
    setMidiOverrides,
    dispatchMidiIntent(intent) {
      return runMidiIntent(intent);
    },
    getMidiIntentState() {
      return { ...midiIntentState, overrides: mergeDeep({}, midiIntentState.overrides || {}) };
    },
    captureLearnNote(note) {
      return typeof noteCapture === 'function' ? !!noteCapture(note) : false;
    },
    setMidiInputController(controller) {
      midiInputController = controller;
      if (midiInputController?.setNoteCapture) {
        midiInputController.setNoteCapture(noteCapture);
      }
    },
    getMidiOverrides() {
      return midiOverrides;
    },
    getMidiConfig: getConfig,
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
