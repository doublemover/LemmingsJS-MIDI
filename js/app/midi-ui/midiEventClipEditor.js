import { reduceMidiProject } from '../../midi/project/MidiProject.js';
import { getMidiClipVoices, MAX_CLIP_CELL_VOICES, MAX_CLIP_TRANSFORM_LAYERS } from '../../midi/project/MidiClipTransforms.js';
import { describeMidiClipPlayback } from '../../midi/project/MidiClipPlayback.js';
import { soundNoteName } from './midiSoundEditor.js';

const parseClipNote = raw => {
  const text = String(raw).trim().replace(/\u266f/g, '#').replace(/\u266d/g, 'b');
  if (/^(rest|-)$/i.test(text) || !text) return null;
  if (/^\d+$/.test(text)) { const number = Number(text); return number <= 127 ? number : undefined; }
  const match = /^([a-g])([#b]?)(-?\d)$/i.exec(text);
  if (!match) return undefined;
  const pitch = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[match[1].toLowerCase()];
  const note = (Number(match[3]) + 1) * 12 + pitch + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  return note >= 0 && note <= 127 ? note : undefined;
};

const createEventClipProject = (project, source) => {
  if (!source) return project;
  const mapping = source.mapping || {}, notes = mapping.notes?.length ? mapping.notes : [mapping.note ?? 60];
  const withClip = reduceMidiProject(project, { type: 'clip.add', clip: { name: source.label + ' cells', lengthSteps: notes.length > 8 ? 16 : 8,
    playback: { advance: mapping.phrase?.enabled ? 'game-tick' : 'event', spacingTicks: mapping.phrase?.spacingTicks || 2, passCounter: 'completed' },
    steps: Array.from({ length: notes.length > 8 ? 16 : 8 }, (_, index) => ({ index, note: notes[index] ?? null,
      velocity: mapping.velocity ?? null, durationTicks: mapping.durationTicks ?? null, probability: 1, hold: false, tie: false })) } });
  return reduceMidiProject(withClip, { type: 'source.clip.assign', sourceId: source.id, clipId: withClip.ui.selectedClipId });
};

const getMidiClipCellHelp = clip => {
  const phrase = clip?.playback?.advance === 'game-tick', temporal = !!clip?.playback;
  return {
    hold: phrase ? 'Extends each played voice until the next played cell or phrase end; longer durations are retained.'
      : temporal ? 'Stored for phrase mode; Hold does not extend a one-cell-per-event note.' : 'Stored with the clip; legacy playback does not extend held notes.',
    tie: phrase ? 'Extends the preceding played voices by one cell spacing unless Hold already covers it; this cell starts no new notes.'
      : temporal ? 'Skips this event cell; extending the previous note requires phrase mode.' : 'Omits this note in legacy playback; it does not extend the previous note.',
    probability: temporal ? 'Deterministic chance per event and phrase pass; 0 skips the cell. Chance and conditions also gate Tie extensions.'
      : '0 omits this note. Every positive value enables it in legacy playback.'
  };
};

const createMidiEventClipEditor = ({ document, bind, getProject, getSource, commitProject, dispatch, history, setStatus }) => {
  const byId = id => document?.getElementById(id);
  let selected = 0, selectedClip = null, selectedSource = null, brush = 60, gesture = null, replaceFieldValues = false, updatingGesture = false;
  const clip = () => getSource()?.mode === 'clip' ? getProject().clips.find(item => item.id === getSource()?.clipId) : null;
  const input = (id, value) => { const element = byId(id); if (element && (replaceFieldValues || element.tagName === 'SELECT' || element !== document.activeElement)) element.value = String(value ?? ''); };
  const update = patch => { const current = clip(); if (current) dispatch({ type: 'clip.step.update', clipId: current.id, stepIndex: selected, patch }); };
  const retainFieldFocus = root => {
    const active = document.activeElement;
    if (!root.contains(active) || !active?.dataset?.clipField) return () => {};
    let row = active;
    while (row && row !== root && row.dataset?.clipRow == null) row = row.parentElement || row.parent;
    const key = active.dataset.clipField, rowIndex = row?.dataset?.clipRow, cell = row?.dataset?.clipCell;
    const selection = Number.isInteger(active.selectionStart) ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    return () => {
      const nextRow = Array.from(root.children).find(value => value.dataset.clipRow === rowIndex && value.dataset.clipCell === cell);
      const controls = nextRow ? Array.from(nextRow.children).flatMap(value => [value, ...Array.from(value.children)]) : [];
      let control = controls.find(value => value.dataset.clipField === key);
      if (control?.disabled) control = controls.find(value => ['Earlier', 'Later'].includes(value.dataset.clipField) && !value.disabled);
      control?.focus?.({ preventScroll: true });
      if (selection && control?.setSelectionRange) control.setSelectionRange(...selection);
    };
  };
  const field = (row, text, value, change, options = {}) => {
    const label = document.createElement('label'); label.textContent = text;
    const control = document.createElement(options.choices ? 'select' : 'input');
    control.className = options.className || ''; control.dataset.clipField = text; control.setAttribute('aria-label', text);
    if (options.choices) for (const [key, name] of options.choices) { const option = document.createElement('option'); option.value = key; option.textContent = name; control.appendChild(option); }
    else { control.type = options.type || 'number'; control.min = String(options.min ?? 0); control.max = String(options.max ?? 127); control.placeholder = 'Default'; }
    control.value = String(value ?? ''); control.disabled = !clip()?.playback;
    control.addEventListener('change', event => change(event.target.value)); label.appendChild(control); row.appendChild(label); return control;
  };
  const button = (row, text, action, disabled = false) => {
    const control = document.createElement('button'); control.type = 'button'; control.textContent = text;
    control.dataset.clipField = text; control.disabled = disabled || !clip()?.playback; control.addEventListener('click', action); row.appendChild(control);
  };
  const renderVoices = step => {
    const root = byId('midiEventClipVoices'); if (!root) return; const restoreFocus = retainFieldFocus(root); root.replaceChildren();
    const voices = getMidiClipVoices(step);
    const changeVoice = (index, patch, remove = false) => {
      const current = clip(); if (!current) return;
      const next = getMidiClipVoices(current.steps[selected]).map(voice => ({ ...voice }));
      if (!next[index]) return; if (remove) next.splice(index, 1); else Object.assign(next[index], patch); update({ voices: next });
    };
    voices.forEach((voice, index) => {
      const row = document.createElement('div'); row.className = 'midi-clip-controls'; row.dataset.clipRow = String(index); row.dataset.clipCell = clip().id + ':' + selected;
      field(row, 'Voice ' + (index + 1) + ' pitch', soundNoteName(voice.note), raw => {
        const note = parseClipNote(raw); if (note === undefined || note === null) { setStatus('Use a note name or MIDI pitch; Remove deletes a voice.'); render(); return; } changeVoice(index, { note });
      }, { type: 'text', className: 'midi-clip-voice-note' });
      for (const [name, key, max] of [['velocity', 'velocity', 127], ['ticks', 'durationTicks', 960]]) field(row, 'Voice ' + (index + 1) + ' ' + name, voice[key], raw => {
        if (raw.trim() && !Number.isFinite(Number(raw))) return; changeVoice(index, { [key]: raw.trim() ? Number(raw) : null });
      }, { min: 1, max, className: 'midi-clip-voice-' + key });
      button(row, 'Remove voice ' + (index + 1), () => changeVoice(index, {}, true)); root.appendChild(row);
    });
    const add = byId('midiEventClipVoiceAdd'); if (add) add.disabled = !clip()?.playback || voices.length >= MAX_CLIP_CELL_VOICES; restoreFocus();
  };
  const renderLayers = step => {
    const root = byId('midiEventClipLayers'); if (!root) return; const restoreFocus = retainFieldFocus(root); root.replaceChildren();
    const layers = step.transformLayers || [];
    const changeLayer = (index, patch, operation = null) => {
      const current = clip(); if (!current) return;
      const next = (current.steps[selected].transformLayers || []).map(layer => ({ ...layer, condition: { ...layer.condition } }));
      if (!next[index]) return;
      if (operation === 'remove') next.splice(index, 1);
      else if (operation === 'up' && index > 0) [next[index - 1], next[index]] = [next[index], next[index - 1]];
      else if (operation === 'down' && index + 1 < next.length) [next[index + 1], next[index]] = [next[index], next[index + 1]];
      else next[index] = { ...next[index], ...patch, ...(patch.condition ? { condition: { ...next[index].condition, ...patch.condition } } : {}) };
      if (operation === 'up' || operation === 'down') {
        let row = document.activeElement;
        while (row && row !== root && row.dataset?.clipRow == null) row = row.parentElement || row.parent;
        if (root.contains(row) && row.dataset.clipCell === current.id + ':' + selected && row.dataset.clipRow === String(index)) row.dataset.clipRow = String(operation === 'up' ? Math.max(0, index - 1) : Math.min(next.length - 1, index + 1));
      }
      update({ transformLayers: next });
    };
    layers.forEach((layer, index) => {
      const row = document.createElement('div'); row.className = 'midi-clip-controls'; row.dataset.clipRow = String(index); row.dataset.clipCell = clip().id + ':' + selected;
      field(row, 'Layer ' + (index + 1), layer.type, type => changeLayer(index, { type }), { choices: [['pitch', 'Pitch'], ['repeat', 'Repeat']], className: 'midi-clip-layer-type' });
      field(row, 'Layer ' + (index + 1) + ' enabled', layer.enabled ? 'on' : 'off', value => changeLayer(index, { enabled: value === 'on' }), { choices: [['on', 'On'], ['off', 'Bypass']] });
      const spec = layer.type === 'repeat' ? [['count', 1, 8, 2], ['spacingTicks', 1, 8, 1], ['transpose', -24, 24, 0]]
        : [['transpose', -48, 48, 0], ['octave', -4, 4, 0], ['interval', -12, 12, 0], ['span', 1, 16, 1]];
      const names = { count: 'Repeat count', spacingTicks: 'Repeat spacing (ticks)', transpose: 'Transpose (semitones)', octave: 'Octaves', interval: 'Ramp interval', span: 'Ramp span' };
      for (const [key, min, max, fallback] of spec) field(row, names[key], layer[key] ?? fallback,
        raw => { if (Number.isFinite(Number(raw))) changeLayer(index, { [key]: Number(raw) }); }, { min, max, className: 'midi-clip-layer-' + key });
      if (layer.type === 'pitch') field(row, 'Ramp counter', layer.unit || 'event', unit => changeLayer(index, { unit }), { choices: [['event', 'Events'], ['pass', 'Passes'], ['bar', 'Trigger bars']] });
      field(row, 'Layer condition', layer.condition?.unit || 'event', unit => changeLayer(index, { condition: { unit } }), { choices: [['event', 'Events'], ['pass', 'Passes'], ['bar', 'Trigger bars']] });
      for (const [key, min, max, fallback] of [['every', 1, 64, 1], ['phase', 0, (layer.condition?.every || 1) - 1, 0]]) field(row, key === 'every' ? 'Every N' : 'Phase (0 = Nth)', layer.condition?.[key] ?? fallback,
        raw => { if (Number.isFinite(Number(raw))) changeLayer(index, { condition: { [key]: Number(raw) } }); }, { min, max });
      button(row, 'Earlier', () => changeLayer(index, {}, 'up'), index === 0);
      button(row, 'Later', () => changeLayer(index, {}, 'down'), index + 1 === layers.length);
      button(row, 'Remove layer', () => changeLayer(index, {}, 'remove')); root.appendChild(row);
    });
    const add = byId('midiEventClipLayerAdd'); if (add) add.disabled = !clip()?.playback || layers.length >= MAX_CLIP_TRANSFORM_LAYERS; restoreFocus();
  };
  const finish = event => {
    if (!gesture || event?.pointerId != null && gesture.pointerId != null && event.pointerId !== gesture.pointerId) return;
    const pointerId = gesture.pointerId; gesture = null; history.endGesture();
    const root = byId('midiEventClipGrid'); if (root?.hasPointerCapture?.(pointerId)) root.releasePointerCapture?.(pointerId);
  };
  const ownsGesture = current => current?.id === gesture?.clipId && getSource()?.id === gesture?.sourceId && (updatingGesture || getProject() === gesture.project);
  const updateGesture = patch => {
    updatingGesture = true;
    try { update(patch); } finally { updatingGesture = false; if (gesture) gesture.project = getProject(); }
  };
  const render = () => {
    const current = clip(), source = getSource(), root = byId('midiEventClipGrid');
    if (!root) return;
    const replacedGesture = gesture && !ownsGesture(current); if (replacedGesture) finish();
    byId('midiClipCreate').hidden = !!current; byId('midiClipCreate').disabled = !source;
    byId('midiClipControls').hidden = !current;
    if (byId('midiDirectSoundControls')) byId('midiDirectSoundControls').hidden = !!current;
    if (!current) { selectedClip = selectedSource = null; return; }
    replaceFieldValues = replacedGesture || current.id !== selectedClip || source?.id !== selectedSource; selectedSource = source?.id;
    if (current.id !== selectedClip) { selectedClip = current.id; selected = 0; brush = current.steps[0]?.note ?? 60; }
    selected = Math.min(selected, Math.min(15, current.lengthSteps - 1));
    const focused = document.activeElement?.dataset?.cellIndex;
    root.replaceChildren(); root.style.setProperty('--clip-cells', String(Math.min(16, current.lengthSteps)));
    const center = brush, low = Math.max(0, center - 12), high = Math.min(127, center + 12);
    current.steps.slice(0, 16).forEach((step, index) => {
      const cell = document.createElement('button'); cell.type = 'button'; cell.dataset.cellIndex = String(index); cell.className = 'midi-event-clip-cell';
      cell.setAttribute('aria-pressed', String(index === selected)); cell.tabIndex = index === selected ? 0 : -1;
      const voices = getMidiClipVoices(step);
      cell.setAttribute('aria-label', 'Cell ' + (index + 1) + ': ' + (voices.length ? voices.map(voice => soundNoteName(voice.note)).join(', ') : 'rest'));
      cell.title = voices.map(voice => soundNoteName(voice.note) + ': velocity ' + (voice.velocity ?? 'default') + ', ' + (voice.durationTicks ?? 'default') + ' ticks').join(' | ');
      for (const voice of voices) {
        const bar = document.createElement('span'); bar.className = 'midi-clip-note-bar';
        bar.style.bottom = (voice.note == null ? 0 : 12 + Math.max(0, Math.min(1, (voice.note - low) / Math.max(1, high - low))) * 65) + '%';
        bar.textContent = soundNoteName(voice.note); bar.style.left = (5 + voices.indexOf(voice) * 90 / Math.max(1, voices.length)) + '%'; bar.style.width = (90 / Math.max(1, voices.length)) + '%'; cell.appendChild(bar); }
      const label = document.createElement('small'); label.textContent = String(index + 1);
      cell.appendChild(label); root.appendChild(cell);
      if (focused === String(index)) cell.focus();
    });
    const step = current.steps[selected];
    renderVoices(step); renderLayers(step);
    const lengthSelect = byId('midiEventClipLength');
    lengthSelect.replaceChildren();
    for (const length of [...new Set([8, 16, current.lengthSteps])]) { const option = document.createElement('option'); option.value = String(length); option.textContent = length + ' cells' + (length > 16 ? ' (saved)' : ''); lengthSelect.appendChild(option); }
    byId('midiEventClipAdvance').disabled = current.lengthSteps > 16;
    input('midiEventClipLength', current.lengthSteps); input('midiEventClipAdvance', current.playback?.advance || 'legacy');
    input('midiEventClipSpacing', current.playback?.spacingTicks || 2); byId('midiClipSpacingField').hidden = current.playback?.advance !== 'game-tick';
    input('midiEventClipNote', step.note == null ? 'rest' : soundNoteName(step.note));
    input('midiEventClipVelocity', step.velocity); input('midiEventClipDuration', step.durationTicks);
    input('midiEventClipProbability', (step.probability ?? 1) * 100);
    const help = getMidiClipCellHelp(current);
    for (const [key, value] of [['Hold', step.hold], ['Tie', step.tie]]) {
      const control = byId('midiEventClip' + key); if (!control) continue;
      control.checked = !!value; control.title = help[key.toLowerCase()]; control.setAttribute('aria-describedby', 'midiEventClipHint');
    }
    byId('midiEventClipProbability').title = help.probability;
    input('midiEventClipPassCounter', current.playback?.passCounter || 'started'); byId('midiClipPassField').hidden = current.playback?.advance !== 'game-tick';
    input('midiEventClipPhase', step.condition?.phase || 0); byId('midiEventClipPhase').max = String((step.condition?.every || 1) - 1);
    for (const [id, field, fallback] of [['Transpose', 'transpose', 0], ['Octave', 'octave', 0], ['Interval', 'interval', 0], ['Span', 'span', 1], ['TransformUnit', 'unit', 'event']]) input('midiEventClip' + id, step.transforms?.[field] ?? fallback);
    for (const id of ['Probability', 'Condition', 'Every', 'Phase', 'Transpose', 'Octave', 'Interval', 'Span', 'TransformUnit']) byId('midiEventClip' + id).disabled = !current.playback;
    input('midiEventClipCondition', step.condition?.unit || 'event'); input('midiEventClipEvery', step.condition?.every || 1);
    byId('midiEventClipHint').textContent = current.name + ' · ' + describeMidiClipPlayback(current) + (current.lengthSteps > 16 ? ' Showing the first 16 cells; use detailed wiring for later cells.' : '') + ' Open Counter timing for event/pass/bar and phase semantics. Click to paint/erase. Drag vertically to change pitch; drag across to paint. Notes accept C4, F#4, 60 or rest.';
  };

  const initialize = () => {
    bind('midiEventClipVoiceAdd', 'click', () => { const current = clip(); if (!current?.playback) return;
      const voices = getMidiClipVoices(current.steps[selected]).map(voice => ({ ...voice }));
      if (voices.length < MAX_CLIP_CELL_VOICES) update({ voices: [...voices, { note: Math.min(127, (voices[0]?.note ?? brush) + (voices.length ? 7 : 0)), velocity: null, durationTicks: null }] }); });
    bind('midiEventClipLayerAdd', 'click', () => { const current = clip(); if (!current?.playback) return;
      const layers = current.steps[selected].transformLayers || [];
      if (layers.length < MAX_CLIP_TRANSFORM_LAYERS) update({ transformLayers: [...layers, { type: 'pitch', enabled: true }] }); });
    bind('midiClipCreate', 'click', () => commitProject(createEventClipProject(getProject(), getSource())));
    bind('midiEventClipLength', 'change', event => { const current = clip(); if (current) dispatch({ type: 'clip.update', clipId: current.id, patch: { lengthSteps: Number(event.target.value) } }); });
    const timing = () => { const current = clip(); if (current) dispatch({ type: 'clip.update', clipId: current.id, patch: { playback: byId('midiEventClipAdvance').value === 'legacy' ? null : { advance: byId('midiEventClipAdvance').value, spacingTicks: Number(byId('midiEventClipSpacing').value), passCounter: byId('midiEventClipPassCounter').value } } }); };
    bind('midiEventClipAdvance', 'change', timing); bind('midiEventClipSpacing', 'change', timing); bind('midiEventClipPassCounter', 'change', timing);
    for (const key of ['Hold', 'Tie']) bind('midiEventClip' + key, 'change', event => update({ [key.toLowerCase()]: !!event.target.checked }));
    bind('midiEventClipNote', 'change', event => { const note = parseClipNote(event.target.value); if (note === undefined) { setStatus('Use a note name such as C4, a MIDI number 0–127, or rest.'); render(); return; } if (note != null) brush = note; update({ note }); });
    for (const [id, field, max] of [['midiEventClipVelocity', 'velocity', 127], ['midiEventClipDuration', 'durationTicks', 960], ['midiEventClipProbability', 'probability', 100]]) {
      bind(id, 'change', event => { const raw = event.target.value.trim(), number = Number(raw); if (!Number.isFinite(number)) return;
        update({ [field]: !raw && field !== 'probability' ? null : Math.max(field === 'probability' ? 0 : 1, Math.min(max, number)) / (field === 'probability' ? 100 : 1) }); });
    }
    const condition = () => update({ condition: { unit: byId('midiEventClipCondition').value, every: Number(byId('midiEventClipEvery').value), phase: Number(byId('midiEventClipPhase').value) } });
    bind('midiEventClipCondition', 'change', condition); bind('midiEventClipEvery', 'change', condition); bind('midiEventClipPhase', 'change', condition);
    const transforms = () => update({ transforms: { transpose: Number(byId('midiEventClipTranspose').value), octave: Number(byId('midiEventClipOctave').value), interval: Number(byId('midiEventClipInterval').value), span: Number(byId('midiEventClipSpan').value), unit: byId('midiEventClipTransformUnit').value } });
    for (const id of ['Transpose', 'Octave', 'Interval', 'Span', 'TransformUnit']) bind('midiEventClip' + id, 'change', transforms);
    bind('midiEventClipGrid', 'pointerdown', event => {
      const target = event.target.closest?.('[data-cell-index]'), original = clip(), sourceId = getSource()?.id; if (!target || !original || event.button !== 0) return;
      finish(); target.focus?.({ preventScroll: true });
      const current = clip(); if (current?.id !== original.id || getSource()?.id !== sourceId) return;
      selected = Number(target.dataset.cellIndex); const root = byId('midiEventClipGrid');
      gesture = { project: getProject(), clipId: current.id, sourceId: getSource()?.id, pointerId: event.pointerId, rect: root.getBoundingClientRect(), startY: event.clientY, note: current.steps[selected].note === brush ? null : brush, last: '' };
      history.beginGesture(); root.setPointerCapture?.(event.pointerId); event.preventDefault();
      updateGesture({ note: gesture.note });
    });
    bind('midiEventClipGrid', 'pointermove', event => {
      if (!gesture || event.pointerId != null && gesture.pointerId != null && event.pointerId !== gesture.pointerId) return;
      const current = clip(); if (!ownsGesture(current)) { finish(); return; }
      selected = Math.max(0, Math.min(Math.min(16, current.lengthSteps) - 1, Math.floor((event.clientX - gesture.rect.left) / gesture.rect.width * Math.min(16, current.lengthSteps))));
      const note = gesture.note == null ? null : Math.max(0, Math.min(127, gesture.note + Math.round((gesture.startY - event.clientY) / 6)));
      const key = selected + ':' + note; if (gesture.last === key) return; gesture.last = key;
      byId('midiEventClipGrid').children[selected]?.focus?.({ preventScroll: true }); updateGesture({ note });
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) bind('midiEventClipGrid', event, finish);
    bind('midiEventClipGrid', 'click', event => { if (event.detail !== 0) return; const cell = event.target.closest?.('[data-cell-index]'); if (!cell) return;
      selected = Number(cell.dataset.cellIndex); const current = clip(); if (current) update({ note: current.steps[selected].note === brush ? null : brush }); });
    bind('midiEventClipGrid', 'keydown', event => {
      const current = clip(); if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Delete', 'Backspace'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const focused = event.target.closest?.('[data-cell-index]'); if (focused) selected = Number(focused.dataset.cellIndex);
      if (['Delete', 'Backspace'].includes(event.key)) { update({ note: null }); return; }
      if (['ArrowUp', 'ArrowDown'].includes(event.key)) { const note = Math.max(0, Math.min(127, (current.steps[selected].note ?? brush) + (event.key === 'ArrowUp' ? 1 : -1))); brush = note; update({ note }); return; }
      selected = event.key === 'Home' ? 0 : event.key === 'End' ? Math.min(15, current.lengthSteps - 1) : Math.max(0, Math.min(Math.min(15, current.lengthSteps - 1), selected + (event.key === 'ArrowRight' ? 1 : -1)));
      render(); byId('midiEventClipGrid').children[selected]?.focus();
    });
  };
  return { initialize, render, dispose: finish };
};

export { parseClipNote, createEventClipProject, createMidiEventClipEditor, getMidiClipCellHelp };
