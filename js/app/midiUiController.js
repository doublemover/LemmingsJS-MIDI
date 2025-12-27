import { ScaleLibrary } from '../midi/MidiMapping.js';
import { SoundEffectIds } from '../game/SoundEvents.js';
import { SkillTypes } from '../game/SkillTypes.js';
import { TriggerTypes } from '../level/TriggerTypes.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORD_OPTIONS = [
  'triad',
  'seventh',
  'sixth',
  'ninth',
  'power',
  'sus2',
  'sus4',
  'octave'
];
const POSITION_AXES = [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'xy', label: 'X+Y' }
];
const POSITION_TARGETS = [
  { value: 'note', label: 'Note offset' },
  { value: 'velocity', label: 'Intensity' },
  { value: 'timbre', label: 'Timbre' },
  { value: 'pan', label: 'Pan' },
  { value: 'duration', label: 'Duration' },
  { value: 'pitchBend', label: 'Pitch bend' },
  { value: 'attack', label: 'Attack' },
  { value: 'decay', label: 'Decay' },
  { value: 'sustain', label: 'Sustain' },
  { value: 'release', label: 'Release' }
];

const midiStorageKeys = {
  inputId: 'lemmings.midi.inputId',
  outputId: 'lemmings.midi.outputId',
  viewPan: 'lemmings.midi.viewPan',
  enabled: 'lemmings.midi.enabled',
  inputChannel: 'lemmings.midi.inputChannel',
  adsrTarget: 'lemmings.midi.adsrTarget',
  overrides: 'lemmings.midi.overrides'
};

const readStoredMidiId = (storage, key) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch (e) {
    return null;
  }
};

const storeMidiId = (storage, key, value) => {
  try {
    if (value) {
      storage?.setItem(key, value);
    } else {
      storage?.removeItem(key);
    }
  } catch (e) {
    // Ignore storage failures (private mode, blocked access, etc.).
  }
};

const readStoredJson = (storage, key) => {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

const storeJson = (storage, key, value) => {
  try {
    if (value == null) {
      storage?.removeItem(key);
    } else {
      storage?.setItem(key, JSON.stringify(value));
    }
  } catch (e) {
    // ignore
  }
};

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

const ALL_SKILLS = Object.values(SkillTypes)
  .filter(value => Number.isFinite(value) && value !== SkillTypes.UNKNOWN);

const SKILL_SFX_MAP = new Map([
  [SoundEffectIds.BUILDER_STEP, SkillTypes.BUILDER],
  [SoundEffectIds.BUILDER_WARNING, SkillTypes.BUILDER],
  [SoundEffectIds.BASH, SkillTypes.BASHER],
  [SoundEffectIds.DIG, SkillTypes.DIGGER],
  [SoundEffectIds.MINE, SkillTypes.MINER],
  [SoundEffectIds.OHNO, SkillTypes.BOMBER],
  [SoundEffectIds.EXPLOSION, SkillTypes.BOMBER]
]);

const ANY_SKILL_SFX = new Set([
  SoundEffectIds.SKILL_SELECT,
  SoundEffectIds.SKILL_ASSIGN
]);

const TRAP_SFX_IDS = new Set([
  SoundEffectIds.TRAP_ZAP,
  SoundEffectIds.TRAP_SQUISH,
  SoundEffectIds.TRAP_SLICER,
  SoundEffectIds.TRAP_FIRE,
  SoundEffectIds.TRAP_TEN_TON,
  SoundEffectIds.TRAP_BEAR
]);

const EXCLUDED_TRIGGER_NAMES = new Set(['UNKNOWN_2', 'UNKNOWN_3']);
const TRIGGER_NAME_BY_VALUE = new Map(
  Object.entries(TriggerTypes).map(([name, value]) => [value, name])
);

const resolveSkillAvailability = (level, skills) => {
  const available = new Set();
  const cheat = skills?.cheatMode === true;
  if (cheat) {
    ALL_SKILLS.forEach(skill => available.add(skill));
    return { cheat: true, available, hasAny: true };
  }
  for (const skill of ALL_SKILLS) {
    let count = null;
    if (skills?.getSkill) {
      count = skills.getSkill(skill);
    } else if (Array.isArray(level?.skills)) {
      count = level.skills[skill] ?? 0;
    }
    if (Number.isFinite(count) && count > 0) {
      available.add(skill);
    }
  }
  return { cheat: false, available, hasAny: available.size > 0 };
};

const levelHasSteel = (level) => {
  if (!level) return false;
  if (level.steelRanges && level.steelRanges.length > 0) return true;
  if (level.steelMask?.mask && level.steelMask.mask.some(value => value)) return true;
  return false;
};

const collectTriggerTypes = (level) => {
  const types = new Set();
  if (!level) return types;
  const triggers = Array.isArray(level.triggers) ? level.triggers : [];
  for (const trigger of triggers) {
    if (Number.isFinite(trigger?.type)) types.add(trigger.type);
    if (trigger?.disableTicksCount > 0) types.add(TriggerTypes.DISABLED);
  }
  if (level.arrowRanges && level.arrowRanges.length > 0) {
    types.add(TriggerTypes.ONEWAY_LEFT);
    types.add(TriggerTypes.ONEWAY_RIGHT);
  }
  if (levelHasSteel(level)) {
    types.add(TriggerTypes.STEEL);
  }
  return types;
};

const collectTrapSfxIds = (level) => {
  const ids = new Set();
  if (!level) return ids;
  const triggers = Array.isArray(level.triggers) ? level.triggers : [];
  for (const trigger of triggers) {
    if (trigger?.type === TriggerTypes.TRAP) {
      if (Number.isFinite(trigger.soundIndex) && trigger.soundIndex > 0) {
        ids.add(trigger.soundIndex);
      }
    }
    if (trigger?.type === TriggerTypes.KILL || trigger?.type === TriggerTypes.FRYING) {
      ids.add(SoundEffectIds.TRAP_FIRE);
    }
  }
  return ids;
};

const resolveAvailableSfxIds = (config, level, skills) => {
  const available = new Set();
  const sfx = config?.sfx || {};
  const ids = Object.keys(sfx)
    .map(key => Number(key))
    .filter(id => Number.isFinite(id));
  if (!level && !skills) {
    ids.forEach(id => available.add(id));
    return available;
  }
  const skillInfo = resolveSkillAvailability(level, skills);
  const trapSfx = collectTrapSfxIds(level);
  const triggerTypes = collectTriggerTypes(level);
  const hasSteel = levelHasSteel(level);
  for (const id of ids) {
    if (SKILL_SFX_MAP.has(id)) {
      const skill = SKILL_SFX_MAP.get(id);
      if (skillInfo.cheat || skillInfo.available.has(skill)) {
        available.add(id);
      }
      continue;
    }
    if (ANY_SKILL_SFX.has(id)) {
      if (skillInfo.cheat || skillInfo.hasAny) {
        available.add(id);
      }
      continue;
    }
    if (id === SoundEffectIds.STEEL_HIT) {
      if (hasSteel) available.add(id);
      continue;
    }
    if (id === SoundEffectIds.DROWN) {
      if (triggerTypes.has(TriggerTypes.DROWN)) available.add(id);
      continue;
    }
    if (TRAP_SFX_IDS.has(id)) {
      if (trapSfx.has(id)) available.add(id);
      continue;
    }
    available.add(id);
  }
  return available;
};

const resolvePositionMappings = (config) => {
  const position = config?.position || {};
  if (Array.isArray(position.mappings)) {
    return position.mappings.map(entry => ({ ...entry }));
  }
  const velocityRange = config?.velocityRange || {};
  const timbreRange = position.timbreRange || {};
  const mappings = [];
  if (position.xToNote) {
    const xRange = position.xNoteRange || {};
    mappings.push({
      axis: 'x',
      target: 'note',
      min: xRange.min ?? 0,
      max: xRange.max ?? 0,
      enabled: true
    });
  }
  if (position.yToVelocity) {
    mappings.push({
      axis: 'y',
      target: 'velocity',
      min: velocityRange.max ?? 127,
      max: velocityRange.min ?? 1,
      enabled: true
    });
  }
  if (position.yToTimbre) {
    mappings.push({
      axis: 'y',
      target: 'timbre',
      min: timbreRange.max ?? 127,
      max: timbreRange.min ?? 0,
      enabled: true
    });
  }
  return mappings;
};

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
  let lastUiSignature = null;
  if (typeof globalThis !== 'undefined') {
    globalThis.lemmingsMidiOverrides = midiOverrides;
  }

  const resolveMidiId = (devices, preferredId) => {
    if (!devices || !devices.length) return null;
    if (preferredId && devices.some(device => device.id === preferredId)) {
      return preferredId;
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

  const applyViewPanSetting = (enabled) => {
    midiViewPanEnabled = !!enabled;
    if (typeof globalThis !== 'undefined') {
      globalThis.lemmingsMidiViewPan = midiViewPanEnabled;
    }
    setMidiOverrides({ position: { viewPan: midiViewPanEnabled } });
  };

  const getConfig = () => {
    if (typeof getMidiConfig === 'function') return getMidiConfig();
    return getLemmings()?.getMidiConfig?.() || null;
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
      delete next.note;
      delete next.degree;
      delete next.octave;
      delete next.chord;
      delete next.arp;
      delete next.priority;
      delete next.disabled;
      if (name) next.name = name;
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

    modeSelect.addEventListener('change', () => {
      updateModeAvailability();
      updateEntry();
    });
    [noteKeySelect, noteOctaveInput, degreeInput, octaveInput, chordSelect, arpToggle, arpMode, arpLength, arpIndependentToggle, priorityInput, disabledToggle]
      .forEach(el => el.addEventListener('change', updateEntry));

    details.appendChild(createRow('Mode', modeSelect));
    details.appendChild(createRow('Key', noteKeySelect));
    details.appendChild(createRow('Octave', noteOctaveInput));
    details.appendChild(createRow('Degree', degreeInput));
    details.appendChild(createRow('Scale octave', octaveInput));
    details.appendChild(createRow('Chord', chordSelect));
    details.appendChild(createRow('Arp', arpToggle));
    details.appendChild(createRow('Arp mode', arpMode));
    details.appendChild(createRow('Arp length', arpLength));
    if (allowIndependentArp) {
      details.appendChild(createRow('Independent arp', arpIndependentToggle));
    }
    details.appendChild(createRow('Priority', priorityInput));
    details.appendChild(createRow('Disabled', disabledToggle));
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
    const ids = Object.keys(sfx).sort((a, b) => Number(a) - Number(b));
    ids.forEach(id => {
      const numericId = Number(id);
      if (availableSfxIds && !availableSfxIds.has(numericId)) return;
      const entry = sfx[id];
      const name = entry?.name ? `${entry.name} (#${id})` : `SFX ${id}`;
      container.appendChild(buildMappingEditor({ id, name, entry, targetKey: 'sfx' }));
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
      if (availableSfxIds && !availableSfxIds.has(numericId)) continue;
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

  const refreshMidiUiFromConfig = () => {
    const config = getConfig();
    if (!config) return false;
    const keySelect = document.getElementById('midiKeySelect');
    const scaleSelect = document.getElementById('midiScaleSelect');
    const positionList = document.getElementById('midiPositionList');
    const intensity = document.getElementById('midiIntensity');
    const accent = document.getElementById('midiAccent');
    const repeatCount = document.getElementById('midiRepeatCount');
    const repeatSpacing = document.getElementById('midiRepeatSpacing');
    const envAttack = document.getElementById('midiEnvAttack');
    const envDecay = document.getElementById('midiEnvDecay');
    const envSustain = document.getElementById('midiEnvSustain');
    const envRelease = document.getElementById('midiEnvRelease');
    const envTarget = document.getElementById('midiEnvTarget');
    const viewPanToggle = document.getElementById('midiViewPanToggle');
    const inputChannel = document.getElementById('midiInputChannel');
    const bpmBase = document.getElementById('midiBpmBase');
    if (bpmBase && Number.isFinite(config.timing?.bpmBase)) {
      bpmBase.value = String(config.timing.bpmBase);
    }
    if (scaleSelect) buildScaleOptions(scaleSelect, config.scale?.name);
    if (keySelect) buildKeyOptions(keySelect, config.scale?.root);
    if (intensity && Number.isFinite(config.velocityRange?.default)) {
      intensity.value = String(config.velocityRange.default);
    }
    if (accent && Number.isFinite(config.density?.velocityBoost)) {
      accent.value = String(config.density.velocityBoost);
    }
    if (repeatCount && Number.isFinite(config.repeat?.maxRepeats)) {
      repeatCount.value = String(config.repeat.maxRepeats);
    }
    if (repeatSpacing && (Number.isFinite(config.repeat?.windowBeats) || Number.isFinite(config.repeat?.spacingTicks))) {
      const windowBeats = Number.isFinite(config.repeat?.windowBeats)
        ? config.repeat.windowBeats
        : config.repeat.spacingTicks;
      repeatSpacing.value = String(windowBeats);
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
    const availableTriggerTypes = level ? collectTriggerTypes(level) : null;
    buildEventList(config, availableSfxIds);
    buildTriggerList(config, availableTriggerTypes);
    if (envTarget) {
      buildAdsrTargetOptions(envTarget, config, availableSfxIds, availableTriggerTypes);
      const storedTarget = readStoredMidiId(storage, midiStorageKeys.adsrTarget);
      const options = Array.from(envTarget.options || envTarget.children || []);
      const matches = storedTarget &&
        options.some(opt => opt.value === storedTarget);
      envTarget.value = matches ? storedTarget : 'global';
    }
    const env = resolveEnvelopeConfig(config, envTarget?.value || 'global');
    if (envAttack && Number.isFinite(env.attack)) envAttack.value = String(env.attack);
    if (envDecay && Number.isFinite(env.decay)) envDecay.value = String(env.decay);
    if (envSustain && Number.isFinite(env.sustain)) envSustain.value = String(env.sustain);
    if (envRelease && Number.isFinite(env.release)) envRelease.value = String(env.release);
    return true;
  };

  const scheduleMidiUiRefresh = () => {
    const attempt = () => {
      if (!refreshMidiUiFromConfig()) {
        window?.requestAnimationFrame?.(attempt);
      }
    };
    window?.requestAnimationFrame?.(attempt);
  };

  const onEnabled = () => {
    const inputSelect = document.getElementById('midiInSelect');
    const outputSelect = document.getElementById('midiOutSelect');
    const viewPanToggle = document.getElementById('midiViewPanToggle');
    const inputChannel = document.getElementById('midiInputChannel');
    const inputs = getWebMidi()?.inputs || [];
    const outputs = getWebMidi()?.outputs || [];
    if (inputs.length < 1) {
      document.getElementById('errorDisplay').innerHTML += 'No input device detected. <br />';
    }
    populateMidiSelect(inputSelect, inputs, 'No input devices');

    if (outputs.length < 1) {
      document.getElementById('errorDisplay').innerHTML += 'No output device detected. <br />';
    }
    populateMidiSelect(outputSelect, outputs, 'No output devices');

    const storedInputId = readStoredMidiId(storage, midiStorageKeys.inputId);
    const storedOutputId = readStoredMidiId(storage, midiStorageKeys.outputId);
    const resolvedInputId = resolveMidiId(inputs, storedInputId);
    const resolvedOutputId = resolveMidiId(outputs, storedOutputId);

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
  };

  const bindMidiUi = () => {
    if (midiUiBound) return;
    const enabledToggle = document.getElementById('midiEnabledToggle');
    const inputSelect = document.getElementById('midiInSelect');
    const outputSelect = document.getElementById('midiOutSelect');
    const viewPanToggle = document.getElementById('midiViewPanToggle');
    const inputChannel = document.getElementById('midiInputChannel');
    const resetButton = document.getElementById('midiResetButton');
    const bpmBase = document.getElementById('midiBpmBase');
    const bpmCurrent = document.getElementById('midiBpmCurrent');
    const keySelect = document.getElementById('midiKeySelect');
    const scaleSelect = document.getElementById('midiScaleSelect');
    const positionAdd = document.getElementById('midiPositionAdd');
    const intensity = document.getElementById('midiIntensity');
    const accent = document.getElementById('midiAccent');
    const repeatCount = document.getElementById('midiRepeatCount');
    const repeatSpacing = document.getElementById('midiRepeatSpacing');
    const envAttack = document.getElementById('midiEnvAttack');
    const envDecay = document.getElementById('midiEnvDecay');
    const envSustain = document.getElementById('midiEnvSustain');
    const envRelease = document.getElementById('midiEnvRelease');

    const storedEnabled = readStoredMidiId(storage, midiStorageKeys.enabled);
    const configEnabled = getConfig()?.enabled;
    const midiEnabled = storedEnabled != null
      ? storedEnabled !== 'false'
      : (typeof configEnabled === 'boolean' ? configEnabled : true);
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
    if (bpmBase) {
      bpmBase.addEventListener('change', (event) => {
        const bpm = Number(event.target.value) || 120;
        setMidiOverrides({ timing: { bpmBase: bpm } });
      });
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
        refreshMidiUiFromConfig();
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
    refreshMidiUiFromConfig,
    setMidiOverrides,
    setMidiInputController(controller) {
      midiInputController = controller;
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
      return true;
    },
    getStorageKeys() {
      return { ...midiStorageKeys };
    },
    setActiveMidiInput,
    setActiveMidiOutput
  };
};
