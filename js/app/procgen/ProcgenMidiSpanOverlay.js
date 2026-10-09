import { createMidiSpan, SPAN_COLORS } from '../midi-ui/midiAutomationSpanEditor.js';
import { previewMidiAutomationSpan } from '../../midi/project/MidiAutomationSpan.js';
const getLaneHeight = renderer => renderer.world.laneHeight || 96;
const getSpanAxis = (renderer, domain, project) => {
  const width = renderer.canvas.width / Math.min(2, renderer.window.devicePixelRatio || 1);
  if (domain === 'distance') return { start: renderer.originX, length: renderer.viewWidth, width };
  const tick = renderer.world.tickIndex - (renderer.world.generationStartTick || 0);
  const beat = Math.max(0, tick) * 0.06 * project.transport.bpmBase / 60;
  return { start: Math.floor(beat / 16) * 16, length: 16, width, beat };
};
const getMidiSpanRectangles = (renderer, project, entries = project.automation) => {
  const dpr = Math.min(2, renderer.window.devicePixelRatio || 1), height = renderer.canvas.height / dpr - (renderer.overviewBandHeight || 0);
  const result = [], laneHeight = getLaneHeight(renderer);
  const spans = entries.filter(entry => entry.span).slice(0, 64).sort((a, b) => a.span.priority - b.span.priority);
  for (const entry of spans) {
    const span = entry.span, axis = getSpanAxis(renderer, span.domain, project);
    const first = span.laneScope === 'global' ? 0 : span.laneStart, last = span.laneScope === 'global' ? renderer.world.laneCount - 1 : span.laneScope === 'lane' ? first : span.laneEnd;
    const top = (first * laneHeight - renderer.originY) * height / renderer.viewHeight, bottom = ((last + 1) * laneHeight - renderer.originY) * height / renderer.viewHeight;
    if (bottom <= 0 || top >= height) continue;
    if (span.loop && (axis.start + axis.length - Math.max(axis.start, span.start)) / span.duration > 4) {
      const start = Math.max(axis.start, span.start), x = (start - axis.start) / axis.length * axis.width;
      result.push({ entry, x, y: Math.max(0, top), w: axis.width - x, h: Math.min(height, bottom) - Math.max(0, top), axis, start, end: axis.start + axis.length, repeating: true });
      continue;
    }
    const cycle = span.loop ? Math.max(0, Math.floor((axis.start - span.start) / span.duration)) : 0;
    for (let index = 0; index < (span.loop ? 4 : 1); index++) {
      const start = span.start + (cycle + index) * span.duration, x = (start - axis.start) / axis.length * axis.width, width = span.duration / axis.length * axis.width;
      if (x >= axis.width) break; if (x + width <= 0) continue;
      result.push({ entry, x: Math.max(0, x), y: Math.max(0, top), w: Math.min(axis.width, x + width) - Math.max(0, x), h: Math.min(height, bottom) - Math.max(0, top), axis, start, end: start + span.duration });
    }
  }
  return result;
};
const createProcgenMidiSpanOverlay = ({ document, getRuntime, getProject, getDomain, getTarget, onUpdate, onAdd, onSelect }) => {
  const canvas = document.getElementById('gameCanvas'), listeners = [];
  let selectedIds = new Set();
  let renderer = null, selectedId = null, editing = false, visible = true, drag = null, draft = null, rectangles = [], revision = 0;
  const listen = (name, handler) => { canvas?.addEventListener(name, handler, { capture: true }); listeners.push([name, handler]); };
  const changed = () => { revision++; renderer?.render(); };
  const cancelDrag = () => {
    if (drag?.pointerId != null && canvas.hasPointerCapture?.(drag.pointerId)) canvas.releasePointerCapture?.(drag.pointerId);
    draft = drag = null;
  };
  const position = (event, domain) => {
    const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top, axis = getSpanAxis(renderer, domain, getProject());
    return { x, y, value: Math.max(0, axis.start + x / axis.width * axis.length), lane: Math.max(0, Math.min(renderer.world.laneCount - 1, Math.floor((renderer.originY + y * renderer.viewHeight / (canvas.height / Math.min(2, renderer.window.devicePixelRatio || 1) - (renderer.overviewBandHeight || 0))) / getLaneHeight(renderer)))) };
  };
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation?.(); };
  listen('pointerdown', event => {
    api.sync();
    if (!editing || !visible || !renderer || event.button) return;
    const point = position(event, getDomain()), dpr = Math.min(2, renderer.window.devicePixelRatio || 1);
    if (point.y >= canvas.height / dpr - (renderer.overviewBandHeight || 0)) return;
    stop(event); canvas.focus?.(); canvas.setPointerCapture?.(event.pointerId);
    const hit = [...rectangles].reverse().find(rect => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h);
    const entry = hit?.entry, domain = entry?.span.domain || getDomain(), source = position(event, domain);
    if (entry) { selectedId = entry.id; onSelect(entry.id); }
    drag = { entry, domain, point: source, pointerId: event.pointerId, mode: hit ? !hit.repeating && point.x >= hit.x + hit.w - 8 ? 'resize' : 'move' : 'draw' };
  });
  listen('pointermove', event => {
    api.sync();
    if (!drag) return; stop(event);
    const next = position(event, drag.domain), quantum = drag.domain === 'distance' ? 1 : 0.25, snap = value => Math.round(value / quantum) * quantum;
    const original = drag.entry?.span || createMidiSpan(drag.domain), delta = snap(next.value - drag.point.value);
    const start = drag.mode === 'draw' ? snap(Math.min(next.value, drag.point.value)) : drag.mode === 'move' ? Math.max(0, original.start + delta) : original.start;
    const duration = drag.mode === 'draw' ? Math.max(quantum, snap(Math.abs(next.value - drag.point.value))) : drag.mode === 'resize' ? Math.max(quantum, original.duration + delta) : original.duration;
    const first = Math.min(drag.point.lane, next.lane), last = Math.max(drag.point.lane, next.lane);
    const span = { ...original, start, duration, ...(drag.mode === 'draw' ? { laneScope: first === last ? 'lane' : 'group', laneStart: first, laneEnd: last } : {}) };
    draft = { ...(drag.entry || { id: 'draft', name: getTarget() + ' span', target: getTarget(), min: 48, max: 110, enabled: true }), span }; changed();
  });
  listen('pointerup', event => {
    api.sync();
    if (!drag) return; stop(event);
    const ready = draft, entry = drag.entry; cancelDrag();
    if (ready) { if (entry) onUpdate(entry.id, { span: ready.span }); else onAdd(ready.span, ready.target); }
    changed();
  });
  listen('pointercancel', event => { if (drag) { stop(event); cancelDrag(); changed(); } });
  listen('dblclick', event => { if (editing) stop(event); });
  const api = {
    get revision() { return revision; },
    sync() { const next = getRuntime()?.lanes?.renderer; if (next !== renderer) { cancelDrag(); rectangles = []; if (renderer?.midiSpanOverlay === api) renderer.midiSpanOverlay = null; renderer = next; if (renderer) renderer.midiSpanOverlay = api; } },
    changed, cancelDraft() { cancelDrag(); changed(); }, select(id, ids = [id]) { selectedId = id; selectedIds = new Set(ids); changed(); },
    setEditing(value) { editing = value === true; if (editing) visible = true; else cancelDrag(); changed(); },
    setVisible(value) { visible = value === true; if (!visible) { editing = false; cancelDrag(); rectangles = []; } changed(); },
    draw(context, current, dpr) {
      if (!visible) { rectangles = []; return; }
      const project = getProject(), entries = draft ? [...project.automation.filter(entry => entry.id !== draft.id), draft] : project.automation;
      rectangles = getMidiSpanRectangles(current, project, entries);
      context.save(); context.scale(dpr, dpr);
      for (const rect of rectangles) {
        const { entry } = rect, color = SPAN_COLORS[entry.target] || '#dfb75d';
        context.globalAlpha = entry.enabled ? 0.14 : 0.04; context.fillStyle = color; context.fillRect(rect.x, rect.y, rect.w, rect.h);
        context.globalAlpha = entry.enabled ? 0.85 : 0.35; context.strokeStyle = color; context.lineWidth = selectedIds.has(entry.id) ? 2 : 1;
        context.setLineDash(rect.repeating ? [2, 3] : entry.span.shape === 'ramp' ? [6, 3] : entry.enabled ? [] : [2, 4]); context.strokeRect(rect.x, rect.y, rect.w, rect.h);
        const labelY = Math.max(rect.y, current.hud?.sprites ? 16 * Math.max(1, Math.floor(Math.min(3, rect.axis.width / 540))) + 2 : 0), labelX = rect.x + Math.max(0, rect.w - 280);
        if (labelY + 18 <= rect.y + rect.h && rect.w >= 34) {
          context.globalAlpha = 1; context.fillStyle = '#07140fe6'; context.fillRect(labelX, labelY, Math.min(rect.w, 280), 17);
          context.fillStyle = color; context.font = '11px system-ui'; context.fillText(entry.name + ' · ' + entry.span.domain + (rect.repeating ? ' repeats every ' + entry.span.duration : entry.span.loop ? ' loop' : '') + ' · P' + entry.span.priority, labelX + 4, labelY + 12, Math.min(rect.w, 280) - 8);
          if (editing && !rect.repeating && selectedId === entry.id) context.fillText('↔', rect.x + rect.w - 15, labelY + 12);
        }
        const state = entry.span.domain === 'beats' ? previewMidiAutomationSpan(entry, rect.axis.beat) : getRuntime()?.view?.midiPreviewRouter?.getAutomationSpanState?.(entry.id, entry.span.laneStart);
        const currentPosition = entry.span.domain === 'beats' ? rect.axis.beat : state?.distance;
        if (entry.enabled && state?.active && currentPosition >= rect.start && currentPosition < rect.end) { context.globalAlpha = 0.9; context.fillStyle = '#fff'; context.fillRect((currentPosition - rect.axis.start) / rect.axis.length * rect.axis.width, rect.y, 1, rect.h); }
      }
      context.restore();
    },
    snapshot: () => ({ editing, visible, selectedId, revision, rectangles: rectangles.map(rect => ({ id: rect.entry.id, domain: rect.entry.span.domain, x: rect.x, y: rect.y, width: rect.w, height: rect.h })) }),
    dispose() { cancelDrag(); for (const [name, handler] of listeners) canvas?.removeEventListener?.(name, handler, { capture: true }); if (renderer?.midiSpanOverlay === api) renderer.midiSpanOverlay = null; renderer = null; rectangles = []; draft = drag = null; }
  };
  return api;
};
export { getSpanAxis, getMidiSpanRectangles, createProcgenMidiSpanOverlay };
