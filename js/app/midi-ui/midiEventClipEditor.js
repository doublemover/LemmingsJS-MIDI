import { reduceMidiProject } from '../../midi/project/MidiProject.js';
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
    playback: { advance: mapping.phrase?.enabled ? 'game-tick' : 'event', spacingTicks: mapping.phrase?.spacingTicks || 2 },
    steps: Array.from({ length: notes.length > 8 ? 16 : 8 }, (_, index) => ({ index, note: notes[index] ?? null,
      velocity: mapping.velocity ?? null, durationTicks: mapping.durationTicks ?? null, probability: 1, hold: false, tie: false })) } });
  return reduceMidiProject(withClip, { type: 'source.clip.assign', sourceId: source.id, clipId: withClip.ui.selectedClipId });
};

const createMidiEventClipEditor = ({ document, bind, getProject, getSource, commitProject, dispatch, history, setStatus }) => {
  const byId = id => document?.getElementById(id);
  let selected = 0, selectedClip = null, brush = 60, gesture = null;
  const clip = () => getSource()?.mode === 'clip' ? getProject().clips.find(item => item.id === getSource()?.clipId) : null;
  const input = (id, value) => { const element = byId(id); if (element && (element.tagName === 'SELECT' || element !== document.activeElement)) element.value = String(value ?? ''); };
  const update = patch => { const current = clip(); if (current) dispatch({ type: 'clip.step.update', clipId: current.id, stepIndex: selected, patch }); };
  const render = () => {
    const current = clip(), source = getSource(), root = byId('midiEventClipGrid');
    if (!root) return;
    byId('midiClipCreate').hidden = !!current; byId('midiClipCreate').disabled = !source;
    byId('midiClipControls').hidden = !current;
    if (byId('midiDirectSoundControls')) byId('midiDirectSoundControls').hidden = !!current;
    if (!current) { selectedClip = null; return; }
    if (current.id !== selectedClip) { selectedClip = current.id; selected = 0; brush = current.steps[0]?.note ?? 60; }
    selected = Math.min(selected, Math.min(15, current.lengthSteps - 1));
    const focused = document.activeElement?.dataset?.cellIndex;
    root.replaceChildren(); root.style.setProperty('--clip-cells', String(Math.min(16, current.lengthSteps)));
    const center = brush, low = Math.max(0, center - 12), high = Math.min(127, center + 12);
    current.steps.slice(0, 16).forEach((step, index) => {
      const cell = document.createElement('button'); cell.type = 'button'; cell.dataset.cellIndex = String(index); cell.className = 'midi-event-clip-cell';
      cell.setAttribute('aria-pressed', String(index === selected)); cell.tabIndex = index === selected ? 0 : -1;
      cell.setAttribute('aria-label', 'Cell ' + (index + 1) + ': ' + (step.note == null ? 'rest' : soundNoteName(step.note)));
      const bar = document.createElement('span'); bar.className = 'midi-clip-note-bar';
      bar.style.bottom = (step.note == null ? 0 : 12 + Math.max(0, Math.min(1, (step.note - low) / Math.max(1, high - low))) * 65) + '%';
      bar.hidden = step.note == null; bar.textContent = step.note == null ? '' : soundNoteName(step.note);
      const label = document.createElement('small'); label.textContent = String(index + 1);
      cell.append(bar, label); root.appendChild(cell);
      if (focused === String(index)) cell.focus();
    });
    const step = current.steps[selected];
    const lengthSelect = byId('midiEventClipLength');
    lengthSelect.replaceChildren();
    for (const length of [...new Set([8, 16, current.lengthSteps])]) { const option = document.createElement('option'); option.value = String(length); option.textContent = length + ' cells' + (length > 16 ? ' (saved)' : ''); lengthSelect.appendChild(option); }
    byId('midiEventClipAdvance').disabled = current.lengthSteps > 16;
    input('midiEventClipLength', current.lengthSteps); input('midiEventClipAdvance', current.playback?.advance || 'legacy');
    input('midiEventClipSpacing', current.playback?.spacingTicks || 2); byId('midiClipSpacingField').hidden = current.playback?.advance !== 'game-tick';
    input('midiEventClipNote', step.note == null ? 'rest' : soundNoteName(step.note));
    input('midiEventClipVelocity', step.velocity); input('midiEventClipDuration', step.durationTicks);
    input('midiEventClipProbability', (step.probability ?? 1) * 100);
    input('midiEventClipCondition', step.condition?.unit || 'event'); input('midiEventClipEvery', step.condition?.every || 1);
    byId('midiEventClipHint').textContent = current.name + ' · ' + describeMidiClipPlayback(current) + (current.lengthSteps > 16 ? ' Showing the first 16 cells; use detailed wiring for later cells.' : '') + ' Click to paint/erase. Drag vertically to change pitch; drag across to paint. Notes accept C4, F#4, 60 or rest.';
  };
  const finish = () => { if (gesture) { history.endGesture(); gesture = null; } };
  const initialize = () => {
    bind('midiClipCreate', 'click', () => commitProject(createEventClipProject(getProject(), getSource())));
    bind('midiEventClipLength', 'change', event => { const current = clip(); if (current) dispatch({ type: 'clip.update', clipId: current.id, patch: { lengthSteps: Number(event.target.value) } }); });
    const timing = () => { const current = clip(); if (current) dispatch({ type: 'clip.update', clipId: current.id, patch: { playback: byId('midiEventClipAdvance').value === 'legacy' ? null : { advance: byId('midiEventClipAdvance').value, spacingTicks: Number(byId('midiEventClipSpacing').value) } } }); };
    bind('midiEventClipAdvance', 'change', timing); bind('midiEventClipSpacing', 'change', timing);
    bind('midiEventClipNote', 'change', event => { const note = parseClipNote(event.target.value); if (note === undefined) { setStatus('Use a note name such as C4, a MIDI number 0–127, or rest.'); render(); return; } if (note != null) brush = note; update({ note }); });
    for (const [id, field, max] of [['midiEventClipVelocity', 'velocity', 127], ['midiEventClipDuration', 'durationTicks', 960], ['midiEventClipProbability', 'probability', 100]]) {
      bind(id, 'change', event => { const raw = event.target.value.trim(), number = Number(raw); if (!Number.isFinite(number)) return;
        update({ [field]: !raw && field !== 'probability' ? null : Math.max(field === 'probability' ? 0 : 1, Math.min(max, number)) / (field === 'probability' ? 100 : 1) }); });
    }
    const condition = () => update({ condition: { unit: byId('midiEventClipCondition').value, every: Number(byId('midiEventClipEvery').value) } });
    bind('midiEventClipCondition', 'change', condition); bind('midiEventClipEvery', 'change', condition);
    bind('midiEventClipGrid', 'pointerdown', event => {
      const target = event.target.closest?.('[data-cell-index]'), current = clip(); if (!target || !current || event.button !== 0) return;
      selected = Number(target.dataset.cellIndex); const root = byId('midiEventClipGrid');
      gesture = { rect: root.getBoundingClientRect(), startY: event.clientY, note: current.steps[selected].note === brush ? null : brush, last: '' };
      history.beginGesture(); root.setPointerCapture?.(event.pointerId); event.preventDefault();
      update({ note: gesture.note });
    });
    bind('midiEventClipGrid', 'pointermove', event => {
      if (!gesture) return; const current = clip(); if (!current) { finish(); return; }
      selected = Math.max(0, Math.min(Math.min(16, current.lengthSteps) - 1, Math.floor((event.clientX - gesture.rect.left) / gesture.rect.width * Math.min(16, current.lengthSteps))));
      const note = gesture.note == null ? null : Math.max(0, Math.min(127, gesture.note + Math.round((gesture.startY - event.clientY) / 6)));
      const key = selected + ':' + note; if (gesture.last === key) return; gesture.last = key; update({ note });
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

export { parseClipNote, createEventClipProject, createMidiEventClipEditor };
