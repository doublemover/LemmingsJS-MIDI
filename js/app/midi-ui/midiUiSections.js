import { ScaleLibrary } from '../../midi/MidiMapping.js';
import {
  EXCLUDED_SFX_IDS,
  NOTE_NAMES,
  POSITION_AXIS_OPERATORS,
  POSITION_TARGETS,
  REPEAT_TARGETS,
  REPEAT_WINDOW_OPTIONS,
  SFX_NAME_BY_ID,
  TRAP_SFX_IDS,
  listTriggerEntries
} from './midiUiDomain.js';

/**
 * Section-level MIDI UI builders extracted from the main controller.
 */
const createMidiUiSectionsController = ({
  document = globalThis.document,
  window = globalThis.window,
  formatNumber = () => '--',
  setMidiOverrides,
  getConfig,
  createRow,
  buildMappingEditor,
  refreshMidiUiFromConfig
} = {}) => {
  const scheduleRefresh = () => {
    window?.setTimeout?.(() => {
      try {
        refreshMidiUiFromConfig?.();
      } catch (e) {
        console.error('MIDI UI refresh failed', e);
      }
    }, 0);
  };

  const bindEventHandlers = (eventName, elements, handler) => {
    for (const element of elements) {
      if (!element || typeof element.addEventListener !== 'function') continue;
      element.addEventListener(eventName, handler);
    }
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
    for (let i = 1; i <= 16; i += 1) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(i);
      select.appendChild(opt);
    }
    if (Number.isFinite(current)) {
      select.value = String(current);
    } else {
      select.value = 'omni';
    }
  };

  const buildRepeatTargetOptions = (select, current) => {
    if (!select) return;
    select.innerHTML = '';
    REPEAT_TARGETS.forEach(option => {
      const opt = document.createElement('option');
      opt.value = option.value;
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
      const axisXToggle = document.createElement('input');
      axisXToggle.type = 'checkbox';
      const axisYToggle = document.createElement('input');
      axisYToggle.type = 'checkbox';
      const axisOpSelect = document.createElement('select');
      POSITION_AXIS_OPERATORS.forEach(operator => {
        const opt = document.createElement('option');
        opt.value = operator.value;
        opt.textContent = operator.label;
        axisOpSelect.appendChild(opt);
      });
      const axis = entry?.axis || 'x';
      let axisX = typeof entry?.axisX === 'boolean' ? entry.axisX : null;
      let axisY = typeof entry?.axisY === 'boolean' ? entry.axisY : null;
      if (axisX == null && axisY == null) {
        if (axis === 'xy') {
          axisX = true;
          axisY = true;
        } else if (axis === 'y') {
          axisX = false;
          axisY = true;
        } else {
          axisX = true;
          axisY = false;
        }
      }
      if (!axisX && !axisY) {
        axisX = true;
      }
      axisXToggle.checked = !!axisX;
      axisYToggle.checked = !!axisY;
      axisOpSelect.value = entry?.axisOp || 'add';

      const axisControl = document.createElement('div');
      axisControl.className = 'axis-toggle';
      const axisXLabel = document.createElement('label');
      axisXLabel.className = 'axis-checkbox';
      axisXLabel.appendChild(axisXToggle);
      const axisXText = document.createElement('span');
      axisXText.textContent = 'X';
      axisXLabel.appendChild(axisXText);
      const axisYLabel = document.createElement('label');
      axisYLabel.className = 'axis-checkbox';
      axisYLabel.appendChild(axisYToggle);
      const axisYText = document.createElement('span');
      axisYText.textContent = 'Y';
      axisYLabel.appendChild(axisYText);
      axisControl.appendChild(axisXLabel);
      axisControl.appendChild(axisOpSelect);
      axisControl.appendChild(axisYLabel);

      const targetSelect = document.createElement('select');
      POSITION_TARGETS.forEach(target => {
        const opt = document.createElement('option');
        opt.value = target.value;
        opt.textContent = target.label;
        targetSelect.appendChild(opt);
      });
      targetSelect.value = entry?.target || 'velocity';

      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.step = '0.1';
      minInput.className = 'input-mini input-align-right';
      if (Number.isFinite(entry?.min)) {
        minInput.value = String(entry.min);
      }

      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.step = '0.1';
      maxInput.className = 'input-mini input-align-right';
      if (Number.isFinite(entry?.max)) {
        maxInput.value = String(entry.max);
      }

      const enabledToggle = document.createElement('input');
      enabledToggle.type = 'checkbox';
      enabledToggle.checked = entry?.enabled !== false;

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = 'Remove';
      removeButton.className = 'button-danger button-compact';

      const updateAxisUi = () => {
        if (!axisXToggle.checked && !axisYToggle.checked) {
          axisXToggle.checked = true;
        }
        const showOp = axisXToggle.checked && axisYToggle.checked;
        axisOpSelect.hidden = !showOp;
        axisOpSelect.disabled = !showOp;
      };
      updateAxisUi();

      const updateRangePlaceholders = (target) => {
        const rangeDefaults = resolvePositionDefaults({ target }, config);
        minInput.placeholder = Number.isFinite(rangeDefaults.min) ? String(rangeDefaults.min) : '';
        maxInput.placeholder = Number.isFinite(rangeDefaults.max) ? String(rangeDefaults.max) : '';
      };
      updateRangePlaceholders(targetSelect.value);

      const updateEntry = () => {
        const next = (mappings || []).map((item, idx) => {
          if (idx !== index) return { ...item };
          const minValue = minInput.value === '' ? null : Number(minInput.value);
          const maxValue = maxInput.value === '' ? null : Number(maxInput.value);
          const axisX = axisXToggle.checked;
          const axisY = axisYToggle.checked;
          const nextEntry = {
            ...item,
            axis: axisX && axisY ? 'xy' : (axisX ? 'x' : 'y'),
            axisX,
            axisY,
            axisOp: axisOpSelect.value || 'add',
            target: targetSelect.value,
            enabled: !!enabledToggle.checked
          };
          if (Number.isFinite(minValue)) nextEntry.min = minValue;
          else delete nextEntry.min;
          if (Number.isFinite(maxValue)) nextEntry.max = maxValue;
          else delete nextEntry.max;
          return nextEntry;
        });
        setMidiOverrides?.({ position: { mappings: next } });
      };

      const removeEntry = () => {
        const next = (mappings || []).filter((_, idx) => idx !== index);
        setMidiOverrides?.({ position: { mappings: next } });
        scheduleRefresh();
      };

      bindEventHandlers('change', [axisOpSelect, minInput, maxInput, enabledToggle], updateEntry);
      const updateAxisAndEntry = () => {
        updateAxisUi();
        updateEntry();
      };
      bindEventHandlers('change', [axisXToggle, axisYToggle], updateAxisAndEntry);
      const onTargetChange = () => {
        updateRangePlaceholders(targetSelect.value);
        updateEntry();
      };
      bindEventHandlers('change', [targetSelect], onTargetChange);
      bindEventHandlers('click', [removeButton], removeEntry);

      const block = document.createElement('div');
      block.className = 'panel-section';
      const titleRow = document.createElement('div');
      titleRow.className = 'panel-title panel-title-row';
      const title = document.createElement('span');
      title.textContent = `Mapping ${index + 1}`;
      const enabledLabel = document.createElement('label');
      enabledLabel.className = 'panel-title-toggle';
      const enabledText = document.createElement('span');
      enabledText.textContent = 'Enabled';
      enabledLabel.appendChild(enabledText);
      enabledLabel.appendChild(enabledToggle);
      titleRow.appendChild(title);
      titleRow.appendChild(enabledLabel);
      block.appendChild(titleRow);
      block.appendChild(createRow('Axis', axisControl));
      block.appendChild(createRow('Target', targetSelect));
      const rangeRow = document.createElement('label');
      rangeRow.className = 'panel-row';
      const rangeLabel = document.createElement('span');
      rangeLabel.textContent = 'Min / Max';
      const rangeInputs = document.createElement('div');
      rangeInputs.className = 'input-pair';
      rangeInputs.appendChild(minInput);
      rangeInputs.appendChild(maxInput);
      rangeRow.appendChild(rangeLabel);
      rangeRow.appendChild(rangeInputs);
      block.appendChild(rangeRow);
      block.appendChild(removeButton);
      container.appendChild(block);
    });
  };

  const buildDefaultPositionMapping = (config) => {
    const position = config?.position || {};
    const xRange = position.xNoteRange || {};
    return {
      axis: 'x',
      axisX: true,
      axisY: false,
      axisOp: 'add',
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

  const buildTriggerList = (config, availableTriggerTypes = null, level = null) => {
    const container = document.getElementById('midiTriggerList');
    if (!container) return;
    container.innerHTML = '';
    const triggerConfig = config?.triggers || {};
    const entries = listTriggerEntries(config, availableTriggerTypes, level);
    for (const { name, value } of entries) {
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

  const buildAdsrTargetOptions = (select, config, availableSfxIds, availableTriggerTypes, level = null) => {
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

    const entries = listTriggerEntries(config, availableTriggerTypes, level);
    for (const { name, value } of entries) {
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

  return {
    buildScaleOptions,
    buildKeyOptions,
    buildChannelOptions,
    buildRepeatTargetOptions,
    buildRepeatWindowOptions,
    resolvePositionDefaults,
    buildPositionMappingList,
    buildDefaultPositionMapping,
    buildEventList,
    buildTriggerList,
    buildAdsrTargetOptions,
    resolveEnvelopeTarget,
    resolveEnvelopeConfig
  };
};

export { createMidiUiSectionsController };
