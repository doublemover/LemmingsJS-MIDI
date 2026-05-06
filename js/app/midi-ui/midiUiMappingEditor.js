import { ScaleLibrary } from '../../midi/MidiMapping.js';
import {
  CHORD_OPTIONS,
  NOTE_NAMES,
  ARP_PATTERN_PRESETS,
  ARP_PATTERN_STEP_OPTIONS,
  ARP_PATTERN_DEFAULT_STEPS,
  createArpPatternFromPreset,
  deriveArpModeFromPattern,
  resolveArpPatternPreset,
  sanitizeArpPattern
} from './midiUiDomain.js';

const createBuildMappingEditor = ({
  document,
  getMidiUiFeatureFlags,
  createChoiceButtons,
  createRow,
  setA11yAttr,
  setMidiOverrides,
  getConfig,
  armMidiLearn,
  disarmMidiLearn,
  auditionMappingEntry
}) => {
  const buildMappingEditor = ({ id, name, entry, targetKey, allowIndependentArp = false }) => {
    const midiUiFeatureFlags = getMidiUiFeatureFlags();
  
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
    const useExpressiveControls = midiUiFeatureFlags.expressiveControls !== false;
  
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
    const notePicker = document.createElement('div');
    notePicker.className = 'midi-note-picker';
    notePicker.tabIndex = 0;
    notePicker.dataset.midiTest = `note-picker:${targetKey}:${id}`;
    setA11yAttr(notePicker, 'role', 'group');
    setA11yAttr(notePicker, 'aria-label', 'Keyboard note picker');
    const notePickerKeys = document.createElement('div');
    notePickerKeys.className = 'midi-note-picker-keys';
    const noteKeyButtons = [];
    NOTE_NAMES.forEach((noteName, idx) => {
      const keyButton = document.createElement('button');
      keyButton.type = 'button';
      keyButton.className = 'midi-note-key';
      keyButton.textContent = noteName;
      keyButton.dataset.noteValue = String(idx);
      keyButton.dataset.midiTest = `note-key:${targetKey}:${id}:${idx}`;
      setA11yAttr(keyButton, 'aria-label', `Set note key ${noteName}`);
      notePickerKeys.appendChild(keyButton);
      noteKeyButtons.push(keyButton);
    });
    notePicker.appendChild(notePickerKeys);
    const octaveShift = document.createElement('div');
    octaveShift.className = 'midi-octave-shift';
    const octaveDownButton = document.createElement('button');
    octaveDownButton.type = 'button';
    octaveDownButton.className = 'midi-octave-step';
    octaveDownButton.textContent = '-';
    octaveDownButton.dataset.midiTest = `note-octave-down:${targetKey}:${id}`;
    setA11yAttr(octaveDownButton, 'aria-label', 'Shift octave down');
    const octaveLabel = document.createElement('span');
    octaveLabel.className = 'midi-octave-value';
    octaveLabel.dataset.midiTest = `note-octave-value:${targetKey}:${id}`;
    const octaveUpButton = document.createElement('button');
    octaveUpButton.type = 'button';
    octaveUpButton.className = 'midi-octave-step';
    octaveUpButton.textContent = '+';
    octaveUpButton.dataset.midiTest = `note-octave-up:${targetKey}:${id}`;
    setA11yAttr(octaveUpButton, 'aria-label', 'Shift octave up');
    octaveShift.appendChild(octaveDownButton);
    octaveShift.appendChild(octaveLabel);
    octaveShift.appendChild(octaveUpButton);
    notePicker.appendChild(octaveShift);
  
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
    const stepLabelByValue = {
      up: '↑',
      down: '↓',
      hold: '•'
    };
    const normalizeArpStepToken = (value) => {
      const next = typeof value === 'string' ? value.trim().toLowerCase() : '';
      return ARP_PATTERN_STEP_OPTIONS.some(option => option.value === next) ? next : 'hold';
    };
    let arpPattern = sanitizeArpPattern(entry?.arp?.pattern, entry?.arp?.mode || 'up');
    if (!Array.isArray(arpPattern.steps) || arpPattern.steps.length !== ARP_PATTERN_DEFAULT_STEPS) {
      arpPattern = sanitizeArpPattern(createArpPatternFromPreset(arpPattern.preset, ARP_PATTERN_DEFAULT_STEPS), arpPattern.preset);
    }
    const arpPresetButtons = createChoiceButtons(
      ARP_PATTERN_PRESETS.map((preset) => ({
        value: preset.value,
        label: preset.label,
        testId: `arp-preset:${targetKey}:${id}:${preset.value}`,
        ariaLabel: `Arpeggiator preset ${preset.label}`
      })),
      arpPattern.preset,
      (value) => {
        const resolved = resolveArpPatternPreset(value, 'up');
        arpPattern = sanitizeArpPattern(createArpPatternFromPreset(resolved, ARP_PATTERN_DEFAULT_STEPS), resolved);
        syncArpPatternUi();
        updateEntry();
      },
      {
        className: 'midi-choice-buttons midi-arp-presets',
        buttonClassName: 'midi-choice-button',
        ariaLabel: 'Arpeggiator presets'
      }
    );
    const arpPatternEditor = document.createElement('div');
    arpPatternEditor.className = 'midi-arp-pattern-editor';
    arpPatternEditor.dataset.midiTest = `arp-pattern:${targetKey}:${id}`;
    setA11yAttr(arpPatternEditor, 'role', 'group');
    setA11yAttr(arpPatternEditor, 'aria-label', 'Arpeggiator step pattern');
    const arpStepButtons = [];
    for (let i = 0; i < ARP_PATTERN_DEFAULT_STEPS; i += 1) {
      const stepButton = document.createElement('button');
      stepButton.type = 'button';
      stepButton.className = 'midi-arp-step';
      stepButton.dataset.stepIndex = String(i);
      stepButton.dataset.midiTest = `arp-step:${targetKey}:${id}:${i}`;
      stepButton.addEventListener('click', () => {
        const current = normalizeArpStepToken(arpPattern.steps[i]);
        const order = ARP_PATTERN_STEP_OPTIONS.map(option => option.value);
        const currentIdx = order.indexOf(current);
        const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % order.length : 0;
        const nextStep = order[nextIdx];
        arpPattern.steps[i] = nextStep;
        arpPattern = sanitizeArpPattern({ ...arpPattern, preset: 'custom', steps: arpPattern.steps }, 'custom');
        arpPresetButtons.setValue('custom');
        syncArpPatternUi();
        updateEntry();
      });
      arpPatternEditor.appendChild(stepButton);
      arpStepButtons.push(stepButton);
    }
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
    arpMode.value = deriveArpModeFromPattern(arpPattern, entry?.arp?.mode || 'up');
    arpQuick.setValue(arpMode.value);
    arpLength.value = entry?.arp?.length ?? 3;
    arpIndependentToggle.checked = !!entry?.arp?.independent;
    priorityInput.value = entry?.priority ?? '';
    enabledToggle.checked = !entry?.disabled;
    const syncArpPatternUi = () => {
      const sequence = Array.isArray(arpPattern.steps)
        ? arpPattern.steps
        : createArpPatternFromPreset(arpPattern.preset, ARP_PATTERN_DEFAULT_STEPS).steps;
      for (let i = 0; i < arpStepButtons.length; i += 1) {
        const stepValue = normalizeArpStepToken(sequence[i]);
        const button = arpStepButtons[i];
        button.textContent = stepLabelByValue[stepValue] || '•';
        button.title = `Step ${i + 1}: ${stepValue}`;
        setA11yAttr(button, 'aria-label', `Arp step ${i + 1}: ${stepValue}`);
        button.dataset.step = stepValue;
      }
      arpPresetButtons.setValue(arpPattern.preset || 'up');
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
  
    const syncNotePickerUi = () => {
      const selectedKey = Number(noteKeySelect.value);
      const selectedOctave = Number(noteOctaveInput.value);
      const hasSelectedKey = noteKeySelect.value !== '' && Number.isFinite(selectedKey);
      const noteEnabled = modeSelect.value === 'note';
      for (const keyButton of noteKeyButtons) {
        const buttonKey = Number(keyButton.dataset.noteValue);
        const isActive = hasSelectedKey && buttonKey === selectedKey;
        keyButton.classList.toggle('active', isActive);
        keyButton.disabled = !noteEnabled;
        setA11yAttr(keyButton, 'aria-pressed', isActive ? 'true' : 'false');
      }
      octaveDownButton.disabled = !noteEnabled;
      octaveUpButton.disabled = !noteEnabled;
      octaveLabel.textContent = Number.isFinite(selectedOctave)
        ? `Oct ${selectedOctave}`
        : 'Oct --';
    };
  
    const buildEntryFromControls = () => {
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
        const resolvedPattern = useExpressiveControls
          ? sanitizeArpPattern(arpPattern, arpPattern.preset || arpMode.value || 'up')
          : sanitizeArpPattern(createArpPatternFromPreset(arpMode.value || 'up', ARP_PATTERN_DEFAULT_STEPS), arpMode.value || 'up');
        const resolvedMode = deriveArpModeFromPattern(resolvedPattern, arpMode.value || 'up');
        arpMode.value = resolvedMode;
        next.arp = {
          enabled: true,
          mode: resolvedMode,
          length: Number(arpLength.value) || 3,
          pattern: resolvedPattern
        };
        if (allowIndependentArp && arpIndependentToggle.checked) {
          next.arp.independent = true;
        }
      }
      if (priorityInput.value !== '') next.priority = Number(priorityInput.value);
      if (!enabledToggle.checked) next.disabled = true;
      return next;
    };
  
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
      arpQuick.element.hidden = !arpToggle.checked || useExpressiveControls;
      arpPatternEditor.hidden = !arpToggle.checked || !useExpressiveControls;
      arpPresetButtons.element.hidden = !arpToggle.checked || !useExpressiveControls;
      syncNotePickerUi();
      syncArpPatternUi();
    };
    updateModeAvailability();
  
    const updateEntry = () => {
      const next = buildEntryFromControls();
      chordQuick.setValue(chordSelect.value || 'triad');
      arpQuick.setValue(arpMode.value || 'up');
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
        const clamped = Math.max(0, Math.min(127, Math.trunc(note)));
        noteInput.value = String(clamped);
        syncKeyOctaveFromDirectNote();
        syncNotePickerUi();
      } else {
        const resolved = noteToScaleDegree(note);
        degreeInput.value = String(resolved.degree);
        octaveInput.value = String(resolved.octave);
      }
      updateEntry();
    };
  
    const bindNoteCapture = (row, input, options = {}) => {
      if (!row || !input) return;
      const learnTarget = `${targetKey}:${id}:${row.children?.[0]?.textContent || 'field'}`;
      const focusTarget = options.focusTarget || input;
      const isDisabled = () => (typeof options.isDisabled === 'function'
        ? options.isDisabled()
        : !!input.disabled);
      const focusSources = Array.isArray(options.focusSources) && options.focusSources.length
        ? options.focusSources
        : [input];
      const arm = () => {
        if (isDisabled()) return;
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
          if (typeof focusTarget.focus === 'function') focusTarget.focus();
          arm();
        });
      }
      for (const source of focusSources) {
        source?.addEventListener?.('focus', arm);
        source?.addEventListener?.('blur', () => disarmMidiLearn(learnTarget));
      }
    };
  
    modeSelect.addEventListener('change', () => {
      updateModeAvailability();
      updateEntry();
    });
    noteInput.addEventListener('input', () => {
      syncKeyOctaveFromDirectNote();
      syncNotePickerUi();
      updateEntry();
    });
    noteInput.addEventListener('change', () => {
      syncKeyOctaveFromDirectNote();
      syncNotePickerUi();
      updateEntry();
    });
    [noteKeySelect, noteOctaveInput].forEach((el) => {
      el.addEventListener('change', () => {
        syncDirectNoteFromKeyOctave();
        syncNotePickerUi();
        updateEntry();
      });
    });
    const stepNote = (delta) => {
      let base = Number(noteInput.value);
      if (!Number.isFinite(base)) {
        const key = Number(noteKeySelect.value);
        const octave = Number(noteOctaveInput.value);
        if (Number.isFinite(key) && Number.isFinite(octave)) {
          base = key + octave * 12;
        } else {
          base = 60;
        }
      }
      const next = Math.max(0, Math.min(127, Math.trunc(base + delta)));
      noteInput.value = String(next);
      syncKeyOctaveFromDirectNote();
      syncNotePickerUi();
      updateEntry();
    };
    noteKeyButtons.forEach((button, keyValue) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        noteKeySelect.value = String(keyValue);
        if (noteOctaveInput.value === '') {
          noteOctaveInput.value = '4';
        }
        syncDirectNoteFromKeyOctave();
        syncNotePickerUi();
        updateEntry();
      });
    });
    octaveDownButton.addEventListener('click', () => {
      if (octaveDownButton.disabled) return;
      const octave = Number(noteOctaveInput.value);
      const nextOctave = Number.isFinite(octave)
        ? Math.max(0, octave - 1)
        : 4;
      noteOctaveInput.value = String(nextOctave);
      syncDirectNoteFromKeyOctave();
      syncNotePickerUi();
      updateEntry();
    });
    octaveUpButton.addEventListener('click', () => {
      if (octaveUpButton.disabled) return;
      const octave = Number(noteOctaveInput.value);
      const nextOctave = Number.isFinite(octave)
        ? Math.min(9, octave + 1)
        : 4;
      noteOctaveInput.value = String(nextOctave);
      syncDirectNoteFromKeyOctave();
      syncNotePickerUi();
      updateEntry();
    });
    notePicker.addEventListener('keydown', (event) => {
      if (modeSelect.value !== 'note') return;
      switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        stepNote(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        stepNote(1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        stepNote(-12);
        break;
      case 'ArrowUp':
        event.preventDefault();
        stepNote(12);
        break;
      default:
        break;
      }
    });
    [degreeInput, octaveInput, chordSelect, arpLength, arpIndependentToggle, priorityInput, enabledToggle]
      .forEach(el => el.addEventListener('change', updateEntry));
    arpToggle.addEventListener('change', () => {
      updateModeAvailability();
      updateEntry();
    });
    arpMode.addEventListener('change', () => {
      arpQuick.setValue(arpMode.value || 'up');
      if (!useExpressiveControls) {
        arpPattern = sanitizeArpPattern(
          createArpPatternFromPreset(arpMode.value || 'up', ARP_PATTERN_DEFAULT_STEPS),
          arpMode.value || 'up'
        );
      }
      syncArpPatternUi();
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
    const notePickerRow = createRow('Keyboard', notePicker);
    const degreeRow = createRow('Degree', degreeInput);
    const scaleOctaveRow = createRow('Scale octave', octaveInput);
    const arpPresetRow = createRow('Arp preset', arpPresetButtons.element);
    const arpPatternRow = createRow('Arp pattern', arpPatternEditor);
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'midi-preview-button';
    previewButton.dataset.midiTest = `preview:${targetKey}:${id}`;
    previewButton.textContent = 'Preview';
    previewButton.disabled = !midiUiFeatureFlags.audition;
    setA11yAttr(previewButton, 'aria-label', `Preview mapping ${name || id}`);
    previewButton.addEventListener('click', () => {
      auditionMappingEntry({
        id,
        targetKey,
        entry: buildEntryFromControls()
      });
    });
    const previewRow = createRow('Preview', previewButton);
    details.appendChild(modeRow);
    details.appendChild(noteRow);
    if (useExpressiveControls) {
      details.appendChild(notePickerRow);
    } else {
      details.appendChild(keyRow);
      details.appendChild(octaveRow);
    }
    details.appendChild(degreeRow);
    details.appendChild(scaleOctaveRow);
    details.appendChild(createRow('Chord', chordSelect));
    details.appendChild(createRow('Chord quick', chordQuick.element));
    details.appendChild(createRow('Arp', arpToggle));
    if (useExpressiveControls) {
      details.appendChild(arpPresetRow);
      details.appendChild(arpPatternRow);
    } else {
      details.appendChild(createRow('Arp mode', arpMode));
      details.appendChild(createRow('Arp quick', arpQuick.element));
    }
    details.appendChild(createRow('Arp length', arpLength));
    if (allowIndependentArp) {
      details.appendChild(createRow('Independent arp', arpIndependentToggle));
    }
    details.appendChild(previewRow);
    details.appendChild(createRow('Priority', priorityInput));
    enabledLabel.addEventListener('click', (event) => event.stopPropagation());
    enabledToggle.addEventListener('click', (event) => event.stopPropagation());
    bindNoteCapture(noteRow, noteInput);
    if (useExpressiveControls) {
      bindNoteCapture(notePickerRow, notePicker, {
        focusTarget: noteKeyButtons[0] || notePicker,
        isDisabled: () => modeSelect.value !== 'note',
        focusSources: [notePicker, ...noteKeyButtons, octaveDownButton, octaveUpButton]
      });
    } else {
      bindNoteCapture(keyRow, noteKeySelect);
      bindNoteCapture(octaveRow, noteOctaveInput);
    }
    bindNoteCapture(degreeRow, degreeInput);
    bindNoteCapture(scaleOctaveRow, octaveInput);
    syncNotePickerUi();
    syncArpPatternUi();
    return details;
  };
  return buildMappingEditor;
};

export { createBuildMappingEditor };
