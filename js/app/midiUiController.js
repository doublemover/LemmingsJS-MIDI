import { MidiMapping, ScaleLibrary } from '../midi/MidiMapping.js';
import { TriggerTypes } from '../level/TriggerTypes.js';
import {
  CHORD_OPTIONS,
  EXCLUDED_TRIGGER_NAMES,
  EXCLUDED_SFX_IDS,
  NOTE_NAMES,
  POSITION_AXES,
  POSITION_TARGETS,
  REPEAT_TARGETS,
  REPEAT_WINDOW_OPTIONS,
  SFX_NAME_BY_ID,
  TRAP_SFX_IDS,
  TRIGGER_NAME_BY_VALUE,
  collectTriggerTypes,
  resolveAvailableSfxIds,
  resolvePositionMappings
} from './midi-ui/midiUiDomain.js';
import {
  midiStorageKeys,
  readStoredMidiId,
  readStoredJson,
  storeJson,
  storeMidiId
} from './midi-ui/midiUiStorage.js';

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


export const createMidiUiController = ({
  window = globalThis.window,
  document = globalThis.document,
  getLemmings = () => globalThis.lemmings,
  getWebMidi = () => globalThis.WebMidi,
  getMidiConfig = null
} = {}) => {
  const storage = window?.localStorage;
  let activeMidiInput = null;
  let midiUiBound = false;
  let midiViewPanEnabled = false;
  let midiInputController = null;
  let midiOverrides = readStoredJson(storage, midiStorageKeys.overrides) || {};
  let envControlsBound = false;
  let lastUiSignature = null;
  let noteCapture = null;
  let lastEnableError = null;
  let deviceRefreshTimer = null;
  let deviceListenersBound = false;
  let deviceListener = null;
  if (!isPlainObject(midiOverrides)) {
    midiOverrides = {};
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.lemmingsMidiOverrides = midiOverrides;
  }

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
    midiOverrides = mergeDeep(midiOverrides || {}, patch);
    storeJson(storage, midiStorageKeys.overrides, midiOverrides);
    if (typeof globalThis !== 'undefined') {
      globalThis.lemmingsMidiOverrides = midiOverrides;
    }
    const lemmings = getLemmings();
    if (lemmings?.applyMidiOverrides) {
      lemmings.applyMidiOverrides(midiOverrides);
    }
  };

  const setNoteCapture = (handler) => {
    noteCapture = handler;
    if (midiInputController?.setNoteCapture) {
      midiInputController.setNoteCapture(handler);
    }
  };

  const clearNoteCapture = () => {
    setNoteCapture(null);
  };

  const applyViewPanSetting = (enabled) => {
    midiViewPanEnabled = !!enabled;
    if (typeof globalThis !== 'undefined') {
      globalThis.lemmingsMidiViewPan = midiViewPanEnabled;
    }
    setMidiOverrides({ position: { viewPan: midiViewPanEnabled } });
  };

  const getConfig = () => {
    if (typeof getMidiConfig === 'function') return getMidiConfig();
    const lemmings = getLemmings();
    return lemmings?.getMidiConfig?.() || lemmings?.getMidiBaseConfig?.() || null;
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
    storeJson(storage, midiStorageKeys.overrides, null);
  };

  const resetMidiDefaults = (persistHash = true) => {
    const expectedHash = getSchemaHash();
    clearMidiStorage();
    midiOverrides = {};
    if (typeof globalThis !== 'undefined') {
      globalThis.lemmingsMidiOverrides = midiOverrides;
    }
    if (expectedHash && persistHash) {
      storeMidiId(storage, midiStorageKeys.schemaHash, expectedHash);
    } else if (!persistHash) {
      storeMidiId(storage, midiStorageKeys.schemaHash, null);
    }
    const lemmings = getLemmings();
    if (lemmings?.applyMidiOverrides) {
      lemmings.applyMidiOverrides({});
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
      level?.steelRanges?.length ?? -1,
      level?.arrowRanges?.length ?? -1,
      skills?.cheatMode ? 'cheat' : 'no-cheat',
      skillKey
    ].join('|');
  };

  const buildScaleOptions = (select, current) => {
    if (!select) return;
    select.innerHTML = '';
    const names = Object.keys(ScaleLibrary);
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
    if (current && names.includes(current)) {
      select.value = current;
    }
  };

  const buildKeyOptions = (select, current) => {
    if (!select) return;
    select.innerHTML = '';
    NOTE_NAMES.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = idx.toString();
      opt.textContent = name;
      select.appendChild(opt);
    });
    if (Number.isFinite(current)) {
      select.value = String(current);
    }
  };

  const buildChannelOptions = (select, current) => {
    if (!select) return;
    select.innerHTML = '';
    const omni = document.createElement('option');
    omni.value = 'omni';
    omni.textContent = 'Omni';
    select.appendChild(omni);
    for (let ch = 1; ch <= 16; ch++) {
      const opt = document.createElement('option');
      opt.value = String(ch);
      opt.textContent = String(ch);
      select.appendChild(opt);
    }
    if (current) {
      select.value = String(current);
    } else {
      select.value = 'omni';
    }
  };

  const buildRepeatTargetOptions = (select, current) => {
    if (!select) return;
    select.innerHTML = '';
    REPEAT_TARGETS.forEach(target => {
      const opt = document.createElement('option');
      opt.value = target.value;
      opt.textContent = target.label;
      select.appendChild(opt);
    });
    if (current) {
      select.value = String(current);
    }
  };

  const buildRepeatWindowOptions = (select, current) => {
    if (!select) return;
    select.innerHTML = '';
    REPEAT_WINDOW_OPTIONS.forEach(option => {
      const opt = document.createElement('option');
      opt.value = String(option.value);
      opt.textContent = option.label;
      select.appendChild(opt);
    });
    if (current != null) {
      const value = String(current);
      const hasOption = Array.from(select.options || []).some(opt => opt.value === value);
      if (!hasOption) {
        const custom = document.createElement('option');
        custom.value = value;
        custom.textContent = value;
        select.appendChild(custom);
      }
      select.value = value;
    }
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

  const buildMappingEditor = ({ id, name, entry, targetKey, allowIndependentArp = false }) => {
    const details = document.createElement('details');
    details.className = 'panel-section';
    const summary = document.createElement('summary');
    summary.className = 'panel-title';
    summary.textContent = name || `Event ${id}`;
    details.appendChild(summary);

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

    const arpToggle = document.createElement('input');
    arpToggle.type = 'checkbox';
    const arpMode = document.createElement('select');
    ['up', 'down', 'updown'].forEach(mode => {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = mode;
      arpMode.appendChild(opt);
    });
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

    const disabledToggle = document.createElement('input');
    disabledToggle.type = 'checkbox';

    const initialMode = entry?.chord
      ? 'chord'
      : (entry?.degree != null ? 'degree' : 'note');
    modeSelect.value = initialMode;
    const noteValue = Number.isFinite(entry?.note) ? entry.note : null;
    if (noteValue != null) {
      noteKeySelect.value = String(noteValue % 12);
      noteOctaveInput.value = String(Math.floor(noteValue / 12));
    } else {
      noteKeySelect.value = '';
      noteOctaveInput.value = '';
    }
    degreeInput.value = entry?.degree ?? '';
    octaveInput.value = entry?.octave ?? '';
    chordSelect.value = entry?.chord?.type || 'triad';
    arpToggle.checked = !!entry?.arp?.enabled;
    arpMode.value = entry?.arp?.mode || 'up';
    arpLength.value = entry?.arp?.length ?? 3;
    arpIndependentToggle.checked = !!entry?.arp?.independent;
    priorityInput.value = entry?.priority ?? '';
    disabledToggle.checked = !!entry?.disabled;

    const updateModeAvailability = () => {
      const mode = modeSelect.value;
      const noteEnabled = mode === 'note';
      const degreeEnabled = mode === 'degree' || mode === 'chord';
      noteKeySelect.disabled = !noteEnabled;
      noteOctaveInput.disabled = !noteEnabled;
      degreeInput.disabled = !degreeEnabled;
      octaveInput.disabled = !degreeEnabled;
      chordSelect.disabled = mode !== 'chord';
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
      if (mode === 'note' && noteKeySelect.value !== '' && noteOctaveInput.value !== '') {
        const key = Number(noteKeySelect.value);
        const octave = Number(noteOctaveInput.value);
        if (Number.isFinite(key) && Number.isFinite(octave)) {
          next.note = Math.max(0, Math.min(127, key + octave * 12));
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
      if (disabledToggle.checked) next.disabled = true;
      const patch = { [targetKey]: { [String(id)]: next } };
      setMidiOverrides(patch);
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
        noteKeySelect.value = String(note % 12);
        noteOctaveInput.value = String(Math.floor(note / 12));
      } else {
        const resolved = noteToScaleDegree(note);
        degreeInput.value = String(resolved.degree);
        octaveInput.value = String(resolved.octave);
      }
      updateEntry();
    };

    const bindNoteCapture = (row, input) => {
      if (!row || !input) return;
      const arm = () => {
        if (input.disabled) return;
        setNoteCapture((captureNote) => {
          applyLearnedNote(captureNote);
          clearNoteCapture();
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
      input.addEventListener('blur', clearNoteCapture);
    };

    modeSelect.addEventListener('change', () => {
      updateModeAvailability();
      updateEntry();
    });
    [noteKeySelect, noteOctaveInput, degreeInput, octaveInput, chordSelect, arpToggle, arpMode, arpLength, arpIndependentToggle, priorityInput, disabledToggle]
      .forEach(el => el.addEventListener('change', updateEntry));

    const modeRow = createRow('Mode', modeSelect);
    const keyRow = createRow('Key', noteKeySelect);
    const octaveRow = createRow('Octave', noteOctaveInput);
    const degreeRow = createRow('Degree', degreeInput);
    const scaleOctaveRow = createRow('Scale octave', octaveInput);
    details.appendChild(modeRow);
    details.appendChild(keyRow);
    details.appendChild(octaveRow);
    details.appendChild(degreeRow);
    details.appendChild(scaleOctaveRow);
    details.appendChild(createRow('Chord', chordSelect));
    details.appendChild(createRow('Arp', arpToggle));
    details.appendChild(createRow('Arp mode', arpMode));
    details.appendChild(createRow('Arp length', arpLength));
    if (allowIndependentArp) {
      details.appendChild(createRow('Independent arp', arpIndependentToggle));
    }
    details.appendChild(createRow('Priority', priorityInput));
    details.appendChild(createRow('Disabled', disabledToggle));
    bindNoteCapture(keyRow, noteKeySelect);
    bindNoteCapture(octaveRow, noteOctaveInput);
    bindNoteCapture(degreeRow, degreeInput);
    bindNoteCapture(scaleOctaveRow, octaveInput);
    return details;
  };

  const resolvePositionDefaults = (entry, config) => {
    const position = config?.position || {};
    const velocityRange = config?.velocityRange || {};
    const durationRange = config?.durationTicks || {};
    const target = entry?.target || 'velocity';
    switch (target) {
    case 'note':
      return {
        min: position.xNoteRange?.min ?? 0,
        max: position.xNoteRange?.max ?? 0
      };
    case 'velocity':
      return {
        min: velocityRange.min ?? 1,
        max: velocityRange.max ?? 127
      };
    case 'timbre':
      return {
        min: position.timbreRange?.min ?? 0,
        max: position.timbreRange?.max ?? 127
      };
    case 'pan':
      return {
        min: position.panRange?.min ?? -127,
        max: position.panRange?.max ?? 127
      };
    case 'duration':
      return {
        min: durationRange.min ?? 1,
        max: durationRange.max ?? 24
      };
    case 'pitchBend':
      return { min: -1, max: 1 };
    case 'attack':
    case 'decay':
    case 'release':
      return { min: 0, max: 2 };
    case 'sustain':
      return { min: 0.25, max: 2 };
    default:
      return { min: null, max: null };
    }
  };

  const buildPositionMappingList = (container, mappings, config) => {
    if (!container) return;
    container.innerHTML = '';
    (mappings || []).forEach((entry, index) => {
      const axisSelect = document.createElement('select');
      POSITION_AXES.forEach(axis => {
        const opt = document.createElement('option');
        opt.value = axis.value;
        opt.textContent = axis.label;
        axisSelect.appendChild(opt);
      });
      axisSelect.value = entry?.axis || 'x';

      const targetSelect = document.createElement('select');
      POSITION_TARGETS.forEach(target => {
        const opt = document.createElement('option');
        opt.value = target.value;
        opt.textContent = target.label;
        targetSelect.appendChild(opt);
      });
      targetSelect.value = entry?.target || 'velocity';

      const defaults = resolvePositionDefaults(entry, config);
      const minValue = Number.isFinite(entry?.min) ? entry.min : defaults.min;
      const maxValue = Number.isFinite(entry?.max) ? entry.max : defaults.max;

      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.step = '0.1';
      minInput.value = Number.isFinite(minValue) ? String(minValue) : '';

      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.step = '0.1';
      maxInput.value = Number.isFinite(maxValue) ? String(maxValue) : '';

      const enabledToggle = document.createElement('input');
      enabledToggle.type = 'checkbox';
      enabledToggle.checked = entry?.enabled !== false;

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = 'Remove';

      const updateEntry = () => {
        const next = (mappings || []).map((item, idx) => {
          if (idx !== index) return { ...item };
          const minValue = minInput.value === '' ? null : Number(minInput.value);
          const maxValue = maxInput.value === '' ? null : Number(maxInput.value);
          const nextEntry = {
            ...item,
            axis: axisSelect.value,
            target: targetSelect.value,
            enabled: !!enabledToggle.checked
          };
          if (Number.isFinite(minValue)) nextEntry.min = minValue;
          else delete nextEntry.min;
          if (Number.isFinite(maxValue)) nextEntry.max = maxValue;
          else delete nextEntry.max;
          return nextEntry;
        });
        setMidiOverrides({ position: { mappings: next } });
      };

      const removeEntry = () => {
        const next = (mappings || []).filter((_, idx) => idx !== index);
        setMidiOverrides({ position: { mappings: next } });
        window?.setTimeout?.(() => {
          try {
            refreshMidiUiFromConfig();
          } catch (e) {
            console.error('MIDI UI refresh failed', e);
          }
        }, 0);
      };

      [axisSelect, minInput, maxInput, enabledToggle]
        .forEach(el => el.addEventListener('change', updateEntry));
      targetSelect.addEventListener('change', () => {
        if (minInput.value === '' && maxInput.value === '') {
          const nextDefaults = resolvePositionDefaults({ target: targetSelect.value }, config);
          if (Number.isFinite(nextDefaults.min)) minInput.value = String(nextDefaults.min);
          if (Number.isFinite(nextDefaults.max)) maxInput.value = String(nextDefaults.max);
        }
        updateEntry();
      });
      removeButton.addEventListener('click', removeEntry);

      const block = document.createElement('div');
      block.className = 'panel-section';
      const title = document.createElement('div');
      title.className = 'panel-title';
      title.textContent = `Mapping ${index + 1}`;
      block.appendChild(title);
      block.appendChild(createRow('Axis', axisSelect));
      block.appendChild(createRow('Target', targetSelect));
      block.appendChild(createRow('Min', minInput));
      block.appendChild(createRow('Max', maxInput));
      block.appendChild(createRow('Enabled', enabledToggle));
      block.appendChild(removeButton);
      container.appendChild(block);
    });
  };

  const buildDefaultPositionMapping = (config) => {
    const position = config?.position || {};
    const xRange = position.xNoteRange || {};
    return {
      axis: 'x',
      target: 'note',
      min: xRange.min ?? 0,
      max: xRange.max ?? 0,
      enabled: true
    };
  };

  const buildEventList = (config, availableSfxIds = null) => {
    const container = document.getElementById('midiEventList');
    if (!container) return;
    container.innerHTML = '';
    const sfx = config?.sfx || {};
    let ids = Object.keys(sfx).sort((a, b) => Number(a) - Number(b));
    if (!ids.length) {
      ids = Array.from(SFX_NAME_BY_ID.keys()).sort((a, b) => a - b).map(String);
    }
    ids.forEach(id => {
      const numericId = Number(id);
      if (EXCLUDED_SFX_IDS.has(numericId)) return;
      if (availableSfxIds && availableSfxIds.size && !availableSfxIds.has(numericId)) return;
      const entry = sfx[id] || {};
      const fallbackName = SFX_NAME_BY_ID.get(numericId);
      const name = entry?.name
        ? `${entry.name} (#${id})`
        : (fallbackName ? `${fallbackName} (#${id})` : `SFX ${id}`);
      container.appendChild(buildMappingEditor({
        id,
        name,
        entry,
        targetKey: 'sfx',
        allowIndependentArp: TRAP_SFX_IDS.has(numericId)
      }));
    });
  };

  const buildTriggerList = (config, availableTriggerTypes = null) => {
    const container = document.getElementById('midiTriggerList');
    if (!container) return;
    container.innerHTML = '';
    const triggerConfig = config?.triggers || {};
    const entries = Object.entries(TriggerTypes)
      .filter(([name, value]) => Number.isFinite(value) && value > 0 && !EXCLUDED_TRIGGER_NAMES.has(name))
      .sort((a, b) => a[1] - b[1]);
    for (const [name, value] of entries) {
      if (availableTriggerTypes && !availableTriggerTypes.has(value)) continue;
      const entry = triggerConfig[String(value)] || {};
      container.appendChild(buildMappingEditor({
        id: value,
        name: `${name} (#${value})`,
        entry,
        targetKey: 'triggers',
        allowIndependentArp: true
      }));
    }
  };

  const buildAdsrTargetOptions = (select, config, availableSfxIds, availableTriggerTypes) => {
    if (!select) return;
    select.innerHTML = '';
    const globalOpt = document.createElement('option');
    globalOpt.value = 'global';
    globalOpt.textContent = 'Global envelope';
    select.appendChild(globalOpt);

    const sfx = config?.sfx || {};
    const ids = Object.keys(sfx).sort((a, b) => Number(a) - Number(b));
    for (const id of ids) {
      const numericId = Number(id);
      if (EXCLUDED_SFX_IDS.has(numericId)) continue;
      if (availableSfxIds && availableSfxIds.size && !availableSfxIds.has(numericId)) continue;
      const entry = sfx[id];
      const name = entry?.name ? `${entry.name} (#${id})` : `SFX ${id}`;
      const opt = document.createElement('option');
      opt.value = `sfx:${id}`;
      opt.textContent = name;
      select.appendChild(opt);
    }

    const entries = Object.entries(TriggerTypes)
      .filter(([name, value]) => Number.isFinite(value) && value > 0 && !EXCLUDED_TRIGGER_NAMES.has(name))
      .sort((a, b) => a[1] - b[1]);
    for (const [, value] of entries) {
      if (availableTriggerTypes && !availableTriggerTypes.has(value)) continue;
      const name = TRIGGER_NAME_BY_VALUE.get(value) || `Trigger ${value}`;
      const opt = document.createElement('option');
      opt.value = `trigger:${value}`;
      opt.textContent = `${name} (#${value})`;
      select.appendChild(opt);
    }
  };

  const resolveEnvelopeTarget = (value) => {
    if (!value || value === 'global') return { scope: 'global', id: null };
    if (value.startsWith('sfx:')) return { scope: 'sfx', id: value.slice(4) };
    if (value.startsWith('trigger:')) return { scope: 'trigger', id: value.slice(8) };
    return { scope: 'global', id: null };
  };

  const resolveEnvelopeConfig = (config, targetValue) => {
    const target = resolveEnvelopeTarget(targetValue);
    const base = config?.envelope || {};
    if (target.scope === 'sfx' && target.id && config?.sfx?.[target.id]?.envelope) {
      return { ...base, ...config.sfx[target.id].envelope };
    }
    if (target.scope === 'trigger' && target.id && config?.triggers?.[target.id]?.envelope) {
      return { ...base, ...config.triggers[target.id].envelope };
    }
    return { ...base };
  };

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

  const refreshMidiUiFromConfig = () => {
    const config = getConfig();
    if (!config) return false;
    bindEnvelopeControls();
    const keySelect = document.getElementById('midiKeySelect');
    const scaleSelect = document.getElementById('midiScaleSelect');
    const positionList = document.getElementById('midiPositionList');
    const intensity = document.getElementById('midiIntensity');
    const accent = document.getElementById('midiAccent');
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
    if (bpmBase) bpmBase.value = String(bpmValue);
    if (scaleSelect) buildScaleOptions(scaleSelect, config.scale?.name || 'chromatic-minor');
    if (keySelect) {
      const root = Number.isFinite(config.scale?.root) ? config.scale.root : 0;
      buildKeyOptions(keySelect, root);
    }
    if (intensity) {
      const defaultVelocity = Number.isFinite(config.velocityRange?.default)
        ? config.velocityRange.default
        : 80;
      intensity.value = String(defaultVelocity);
    }
    if (accent) {
      const defaultAccent = Number.isFinite(config.density?.velocityBoost)
        ? config.density.velocityBoost
        : 0.4;
      accent.value = String(defaultAccent);
    }
    const repeatCfg = config.repeat || {};
    if (repeatCount) {
      const maxRepeats = Number.isFinite(repeatCfg.maxRepeats) ? repeatCfg.maxRepeats : 0;
      repeatCount.value = String(maxRepeats);
    }
    if (repeatSpacing) {
      const windowBeats = Number.isFinite(repeatCfg.windowBeats)
        ? repeatCfg.windowBeats
        : (Number.isFinite(repeatCfg.spacingTicks) ? repeatCfg.spacingTicks : 1);
      buildRepeatWindowOptions(repeatSpacing, windowBeats);
    }
    if (repeatTarget) {
      const target = repeatCfg.target
        || (repeatCfg.durationBoost ? 'duration' : 'velocity');
      buildRepeatTargetOptions(repeatTarget, target);
    }
    if (repeatAmount) {
      const amount = Number.isFinite(repeatCfg.amount)
        ? repeatCfg.amount
        : (repeatCfg.durationBoost ?? repeatCfg.velocityBoost ?? 0);
      repeatAmount.value = String(amount);
    }
    if (positionList) {
      const mappings = resolvePositionMappings(config);
      buildPositionMappingList(positionList, mappings, config);
    }
    const storedViewPan = readStoredMidiId(storage, midiStorageKeys.viewPan);
    if (viewPanToggle) {
      if (storedViewPan != null) {
        viewPanToggle.checked = storedViewPan === 'true';
      } else if (typeof config.position?.viewPan === 'boolean') {
        viewPanToggle.checked = config.position.viewPan;
      }
    }
    const storedChannel = readStoredMidiId(storage, midiStorageKeys.inputChannel);
    if (inputChannel) {
      const channel = storedChannel ?? config.input?.channel ?? 'omni';
      const value = channel === 'omni' ? null : channel;
      buildChannelOptions(inputChannel, value);
    }
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
    buildEventList(config, sfxFilter);
    buildTriggerList(config, availableTriggerTypes);
    if (envTarget) {
      buildAdsrTargetOptions(envTarget, config, sfxFilter, availableTriggerTypes);
      const storedTarget = readStoredMidiId(storage, midiStorageKeys.adsrTarget);
      const options = Array.from(envTarget.options || envTarget.children || []);
      const matches = storedTarget &&
        options.some(opt => opt.value === storedTarget);
      envTarget.value = matches ? storedTarget : 'global';
    }
    const env = resolveEnvelopeConfig(config, envTarget?.value || 'global');
    if (envAttack) envAttack.value = String(Number.isFinite(env.attack) ? env.attack : 1);
    if (envDecay) envDecay.value = String(Number.isFinite(env.decay) ? env.decay : 0);
    if (envSustain) envSustain.value = String(Number.isFinite(env.sustain) ? env.sustain : 1);
    if (envRelease) envRelease.value = String(Number.isFinite(env.release) ? env.release : 1);
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
      'midiInSelect',
      'midiOutSelect',
      'midiInputChannel',
      'midiResetButton',
      'midiViewPanToggle',
      'midiPositionAdd'
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
    const keySelect = document.getElementById('midiKeySelect');
    const scaleSelect = document.getElementById('midiScaleSelect');
    const positionAdd = document.getElementById('midiPositionAdd');
    const intensity = document.getElementById('midiIntensity');
    const accent = document.getElementById('midiAccent');
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
      });
    }
    if (outputSelect) {
      outputSelect.addEventListener('change', (event) => {
        const selectedId = event.target.value || null;
        storeMidiId(storage, midiStorageKeys.outputId, selectedId);
        setActiveMidiOutput(selectedId);
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
        refreshMidiUiFromConfig();
      });
    }
    if (bpmBase) {
      const updateBpmBase = (event) => {
        const bpm = Number(event.target.value) || 120;
        setMidiOverrides({ timing: { bpmBase: bpm } });
        if (bpmCurrent) {
          const lemmings = getLemmings();
          const speed = lemmings?.game?.getGameTimer?.()?.speedFactor ?? lemmings?.gameSpeedFactor ?? 1;
          bpmCurrent.textContent = String(Math.round(bpm * speed));
        }
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
        window?.setTimeout?.(() => {
          try {
            refreshMidiUiFromConfig();
          } catch (e) {
            console.error('MIDI UI refresh failed', e);
          }
        }, 0);
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

    const tabs = document.querySelectorAll('.tab-button');
    const panels = document.querySelectorAll('.tab-panel');
    tabs.forEach(button => {
      button.addEventListener('click', () => {
        tabs.forEach(btn => btn.classList.remove('active'));
        panels.forEach(panel => panel.classList.remove('active'));
        button.classList.add('active');
        const target = document.getElementById(`midiTab${button.dataset.tab?.[0]?.toUpperCase()}${button.dataset.tab?.slice(1)}`);
        if (target) target.classList.add('active');
      });
    });

    const updateBpm = () => {
      if (!bpmCurrent) return;
      const config = getConfig();
      const base = config?.timing?.bpmBase ?? 120;
      const lemmings = getLemmings();
      const speed = lemmings?.game?.getGameTimer?.()?.speedFactor ?? lemmings?.gameSpeedFactor ?? 1;
      bpmCurrent.textContent = Math.round(base * speed).toString();
      const signature = buildUiSignature();
      if (signature !== lastUiSignature) {
        lastUiSignature = signature;
        try {
          refreshMidiUiFromConfig();
        } catch (e) {
          console.error('MIDI UI refresh failed', e);
        }
      }
    };
    updateBpm();
    window?.setInterval?.(updateBpm, 500);

    midiUiBound = true;
  };

  return {
    bindMidiUi,
    scheduleMidiUiRefresh,
    onEnabled,
    showError,
    refreshMidiUiFromConfig,
    setMidiOverrides,
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
    setActiveMidiInput,
    setActiveMidiOutput
  };
};
