import { projectMidiAutomationSpan } from './midiAutomationSpanProjection.js';
import { midiConditionChoices } from './midiEventLabels.js';
const SPAN_COLORS = { note: '#77b9e9', velocity: '#dfb75d', pan: '#a4cf82', duration: '#c698dd', timbre: '#e68f89', attack: '#85cec9', decay: '#85cec9', sustain: '#85cec9', release: '#85cec9' };
const spanEditorUi = new WeakMap();
const createMidiSpan = (domain = 'beats') => ({ domain, start: 0, duration: domain === 'distance' ? 128 : 4, loop: true, shape: 'ramp', laneScope: 'global', laneStart: 0, laneEnd: 0, priority: 0, condition: { sfxId: null, triggerType: null, unit: 'event', every: 1, phase: 0 } });
const createMidiAutomationSpanEditor = ({ document, lane, tracks = [], laneCount = 1024, onUpdate, getState = () => null, open = false, canAddSpan = true, canReturnToSpatial = true }) => {
  const host = document.createElement('details'); host.className = 'midi-span-editor'; host.dataset.automationSpanId = lane.id; host.open = open;
  const summary = document.createElement('summary'); summary.textContent = lane.span ? 'Musical span' : 'Add a musical span'; host.append(summary);
  if (!lane.span) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Create looping beat span'; button.disabled = !canAddSpan;
    button.addEventListener('click', () => onUpdate({ span: createMidiSpan() })); host.append(button); return host;
  }
  const span = lane.span, fields = document.createElement('div'); fields.className = 'midi-span-fields';
  let destination = fields;
  let memories = spanEditorUi.get(document); if (!memories) { memories = new Map(); spanEditorUi.set(document, memories); }
  const advanced = document.createElement('details'), advancedSummary = document.createElement('summary'), advancedFields = document.createElement('div');
  advancedSummary.textContent = 'Conditions, track & priority'; advancedFields.className = 'midi-span-fields'; advanced.open = memories.get(lane.id) === true; advanced.append(advancedSummary, advancedFields);
  advanced.addEventListener('toggle', () => { if (memories.size >= 128 && !memories.has(lane.id)) memories.delete(memories.keys().next().value); memories.set(lane.id, advanced.open); });
  const patch = value => onUpdate({ span: { ...span, ...value } });
  const condition = value => patch({ condition: { ...span.condition, ...value } });
  const field = (label, key, value, choices = null, changed = value => patch({ [key]: value }), limits = {}) => {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement(choices ? 'select' : 'input'); input.dataset.spanField = key;
    if (choices) for (const [value, text] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
    else { input.type = 'number'; input.step = '0.25'; for (const [name, value] of Object.entries(limits)) input[name] = String(value); }
    input.value = String(value ?? ''); input.setAttribute('aria-label', lane.name + ' ' + label);
    input.addEventListener('change', event => {
      const value = choices ? event.target.value : ['sfxId', 'triggerType'].includes(key) && !event.target.value.trim() ? null : Number(event.target.value);
      if (choices || value === null || Number.isFinite(value)) changed(value);
    });
    wrapper.append(input); destination.append(wrapper); return input;
  };
  const units = span.domain === 'distance' ? 'pixels' : 'beats';
  field('Domain', 'domain', span.domain, [['beats', 'Musical beats'], ['distance', 'Actor world distance']], value => patch({ domain: value, start: 0, duration: value === 'distance' ? 128 : 4 }));
  field('Start, ' + units, 'start', span.start, null, undefined, { min: 0 });
  field('Length, ' + units, 'duration', span.duration, null, undefined, { min: span.domain === 'distance' ? 1 : 0.25 });
  field('Shape', 'shape', span.shape, [['constant', 'Constant start value'], ['ramp', 'Ramp start to end']]);
  field('Repeat', 'loop', span.loop ? 'yes' : 'no', [['yes', 'Loop after start'], ['no', 'Play once']], value => patch({ loop: value === 'yes' }));
  field('Lane scope', 'laneScope', span.laneScope, [['global', 'All lanes'], ['lane', 'One lane'], ['group', 'Lane group']]);
  const firstLane = field('First lane', 'laneStart', span.laneStart + 1, null, value => patch({ laneStart: value - 1 }), { min: 1, max: laneCount, step: 1 });
  const lastLane = field('Last lane', 'laneEnd', span.laneEnd + 1, null, value => patch({ laneEnd: value - 1 }), { min: 1, max: laneCount, step: 1 });
  (firstLane.parentElement || firstLane.parent).hidden = span.laneScope === 'global'; (lastLane.parentElement || lastLane.parent).hidden = span.laneScope !== 'group';
  destination = advancedFields;
  field('Track', 'trackId', lane.scope === 'track' ? lane.trackId : '', [['', 'All tracks'], ...tracks.map(track => [track.id, track.name])], value => onUpdate({ scope: value ? 'track' : 'global', trackId: value || null }));
  field('Priority', 'priority', span.priority, null, undefined, { step: 1 });
  field('Every N', 'every', span.condition.every, null, value => condition({ every: value }), { min: 1, max: 1024, step: 1 });
  field('Counter', 'unit', span.condition.unit, [['event', 'Matching events'], ['bar', 'Musical bars'], ['pass', 'Span loop passes']], value => condition({ unit: value }));
  field('Phase (0 = N)', 'phase', span.condition.phase, null, value => condition({ phase: value }), { min: 0, step: 1 });
  field('Sound event', 'sfxId', span.condition.sfxId ?? '', midiConditionChoices('sfx', span.condition.sfxId), value => condition({ sfxId: value === '' ? null : Number(value) }));
  field('Physical trigger', 'triggerType', span.condition.triggerType ?? '', midiConditionChoices('trigger', span.condition.triggerType), value => condition({ triggerType: value === '' ? null : Number(value) }));
  host.append(fields, advanced);
  const timeline = document.createElement('div'); timeline.className = 'midi-span-timeline'; timeline.setAttribute('aria-label', lane.name + ' editable ' + units + ' rectangle');
  const horizon = Math.max(span.domain === 'distance' ? 512 : 16, span.start + span.duration * 2);
  const bar = document.createElement('div'); bar.className = 'midi-span-rectangle ' + span.shape; if (bar.style.setProperty) bar.style.setProperty('--span-color', SPAN_COLORS[lane.target] || '#dfb75d');
  const paint = (start, duration) => { bar.style.left = start / horizon * 100 + '%'; bar.style.width = duration / horizon * 100 + '%'; };
  paint(span.start, span.duration); bar.textContent = lane.target + ' ' + span.start + '–' + (span.start + span.duration) + ' ' + units;
  const handle = document.createElement('span'); handle.className = 'midi-span-resize'; handle.textContent = '↔'; bar.append(handle); timeline.append(bar);
  const phase = document.createElement('span'); phase.className = 'midi-span-playhead'; bar.append(phase);
  let drag = null;
  const point = event => { const box = timeline.getBoundingClientRect(); return Math.max(0, Math.min(horizon, (event.clientX - box.left) / Math.max(1, box.width) * horizon)); };
  const snap = value => Math.round(value / (span.domain === 'distance' ? 1 : 0.25)) * (span.domain === 'distance' ? 1 : 0.25);
  timeline.addEventListener('pointerdown', event => {
    if (event.button) return; event.preventDefault(); timeline.setPointerCapture?.(event.pointerId);
    drag = { x: point(event), start: span.start, duration: span.duration, mode: event.target === handle ? 'resize' : bar.contains?.(event.target) ? 'move' : 'draw' };
  });
  timeline.addEventListener('pointermove', event => {
    if (!drag) return; const delta = snap(point(event) - drag.x);
    const start = drag.mode === 'draw' ? snap(Math.min(point(event), drag.x)) : drag.mode === 'move' ? Math.max(0, drag.start + delta) : drag.start;
    const duration = drag.mode === 'draw' ? Math.max(span.domain === 'distance' ? 1 : 0.25, snap(Math.abs(point(event) - drag.x))) : drag.mode === 'resize' ? Math.max(span.domain === 'distance' ? 1 : 0.25, drag.duration + delta) : drag.duration;
    drag.next = { start, duration }; paint(start, duration);
  });
  timeline.addEventListener('pointerup', () => { if (drag?.next) patch(drag.next); drag = null; });
  timeline.addEventListener('pointercancel', () => { drag = null; paint(span.start, span.duration); });
  host.append(timeline);
  const status = document.createElement('p'); status.className = 'midi-span-status';
  host.syncStatus = () => {
    const state = getState(), projection = projectMidiAutomationSpan(lane, state);
    phase.style.left = Math.max(0, Math.min(1, projection.phase)) * 100 + '%';
    phase.style.display = projection.resolved && lane.enabled !== false ? '' : 'none';
    phase.style.opacity = projection.winning ? '1' : '0.3';
    status.textContent = projection.text + (state ? ' | matching event ' + state.eventCount + (projection.resolved ? ' | resolved bar ' + projection.bar + ' | span pass ' + projection.spanPass : '') : '');
  }; host.syncStatus(); host.append(status);
  const help = document.createElement('p'); help.className = 'midi-span-help'; help.textContent = 'Drag the rectangle to move it; drag ↔ to resize; draw on the empty strip to replace its interval. Up to 64 enabled spans run. Higher priority wins each target; equal priority uses the later row. Beats share game ticks and freeze on pause. Distance samples the actor, not a clock. The playhead holds the last resolved note evaluation, before output admission.'; host.append(help);
  if (canReturnToSpatial) {
    const spatial = document.createElement('button'); spatial.type = 'button'; spatial.textContent = 'Return to spatial curve'; spatial.addEventListener('click', () => onUpdate({ span: null })); host.append(spatial);
  }
  return host;
};
export { createMidiSpan, createMidiAutomationSpanEditor, SPAN_COLORS };
