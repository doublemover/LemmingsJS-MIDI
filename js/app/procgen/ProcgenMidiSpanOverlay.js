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
const getMidiSpanRectangles = (renderer, project, entries = project.automation, projection = null) => {
  const dpr = Math.min(2, renderer.window.devicePixelRatio || 1), height = projection?.height ?? renderer.canvas.height / dpr - (renderer.overviewBandHeight || 0);
  const originY = projection?.originY ?? renderer.originY, viewHeight = projection?.viewHeight ?? renderer.viewHeight;
  const result = [], laneHeight = projection?.laneHeight ?? getLaneHeight(renderer);
  const spans = entries.filter(entry => entry.span).slice(0, 64).sort((a, b) => a.span.priority - b.span.priority);
  for (const entry of spans) {
    const span = entry.span, axis = projection?.axis || getSpanAxis(renderer, span.domain, project);
    const first = span.laneScope === 'global' ? 0 : span.laneStart, last = span.laneScope === 'global' ? (projection?.laneCount ?? renderer.world.laneCount) - 1 : span.laneScope === 'lane' ? first : span.laneEnd;
    const top = (first * laneHeight - originY) * height / viewHeight, bottom = ((last + 1) * laneHeight - originY) * height / viewHeight;
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
const createProcgenMidiSpanOverlay = ({ document, getRuntime, getProject, getDomain, getTarget, onUpdate, onBatchUpdate, onAdd, onSelect, onStatus = () => {} }) => {
  const canvas = document.getElementById('gameCanvas'), listeners = [];
  let selectedIds = new Set();
  let renderer = null, selectedId = null, editing = false, visible = true, drag = null, drafts = null, rectangles = [], revision = 0;
  const listen = (name, handler) => { canvas?.addEventListener(name, handler, { capture: true }); listeners.push([name, handler]); };
  const changed = () => { revision++; renderer?.render?.(); };
  const cancelDrag = () => {
    if (drag?.pointerId != null && canvas.hasPointerCapture?.(drag.pointerId)) canvas.releasePointerCapture?.(drag.pointerId);
    drafts = drag = null;
  };
  const captureTransform = domain => {
    const box = canvas.getBoundingClientRect();
    return { left: box.left, top: box.top, axis: { ...getSpanAxis(renderer, domain, getProject()) },
      originY: renderer.originY, viewHeight: renderer.viewHeight, laneHeight: getLaneHeight(renderer), laneCount: renderer.world.laneCount,
      height: canvas.height / Math.min(2, renderer.window.devicePixelRatio || 1) - (renderer.overviewBandHeight || 0), generation: renderer.world.generation };
  };
  const position = (event, domain, transform = captureTransform(domain)) => {
    const x = event.clientX - transform.left, y = event.clientY - transform.top, axis = transform.axis;
    return { x, y, value: Math.max(0, axis.start + x / axis.width * axis.length), lane: Math.max(0, Math.min(transform.laneCount - 1,
      Math.floor((transform.originY + y * transform.viewHeight / transform.height) / transform.laneHeight))) };
  };
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation?.(); };
  listen('pointerdown', event => {
    api.sync();
    if (!editing || !visible || !renderer || event.button) return;
    const point = position(event, getDomain()), dpr = Math.min(2, renderer.window.devicePixelRatio || 1);
    if (point.y < 0 || point.y >= canvas.height / dpr - (renderer.overviewBandHeight || 0)) return;
    stop(event); canvas.focus?.(); canvas.setPointerCapture?.(event.pointerId);
    const hit = [...rectangles].reverse().find(rect => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h);
    const entry = hit?.entry ? { ...hit.entry, span: { ...hit.entry.span, condition: { ...hit.entry.span.condition } } } : null;
    const domain = entry?.span.domain || getDomain(), transform = captureTransform(domain), source = position(event, domain, transform);
    let entries = [];
    if (entry) {
      const additive = event.ctrlKey || event.metaKey || event.shiftKey || selectedIds.has(entry.id);
      if (additive && selectedIds.size >= 64 && !selectedIds.has(entry.id)) {
        if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId);
        onStatus('Deselect a span before selecting more than 64.'); return;
      }
      selectedId = entry.id; onSelect(entry.id, { additive });
      if (!additive) selectedIds.clear(); selectedIds.add(entry.id);
      entries = getProject().automation.filter(candidate => candidate.span && selectedIds.has(candidate.id)).slice(0, 64)
        .map(candidate => ({ ...candidate, span: { ...candidate.span, condition: { ...candidate.span.condition } } }));
      if (entries.some(candidate => candidate.span.domain !== domain)) {
        if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId);
        onStatus('Select spans with one domain before moving or resizing together.'); changed(); return;
      }
      if (entries.length > 1 && !onBatchUpdate) {
        if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId);
        onStatus('Grouped canvas editing is unavailable in this host.'); changed(); return;
      }
    }
    onStatus('');
    drag = { entry, entries, domain, transform, point: source, pointerId: event.pointerId, mode: hit ? !hit.repeating && point.x >= hit.x + hit.w - 8 ? 'resize' : 'move' : 'draw' };
  });
  listen('pointermove', event => {
    api.sync();
    if (!drag) return; stop(event);
    const next = position(event, drag.domain, drag.transform), quantum = drag.domain === 'distance' ? 1 : 0.25, snap = value => Math.round(value / quantum) * quantum;
    const entries = drag.entries.length ? drag.entries : [{ id: 'draft', name: getTarget() + ' span', target: getTarget(), min: 48, max: 110, enabled: true, span: createMidiSpan(drag.domain) }];
    const delta = snap(next.value - drag.point.value);
    let applied = delta, laneDelta = next.lane - drag.point.lane;
    if (drag.mode === 'move') {
      applied = Math.min(1e9 - Math.max(...entries.map(entry => entry.span.start)), Math.max(delta, -Math.min(...entries.map(entry => entry.span.start))));
      const scoped = entries.filter(entry => entry.span.laneScope !== 'global');
      if (scoped.length) laneDelta = Math.max(-Math.min(...scoped.map(entry => entry.span.laneStart)), Math.min(laneDelta,
        drag.transform.laneCount - 1 - Math.max(...scoped.map(entry => entry.span.laneScope === 'lane' ? entry.span.laneStart : entry.span.laneEnd))));
    } else if (drag.mode === 'resize') applied = Math.min(1e6 - Math.max(...entries.map(entry => entry.span.duration)), Math.max(delta, quantum - Math.min(...entries.map(entry => entry.span.duration))));
    drafts = entries.map(entry => {
      const original = entry.span;
      const start = drag.mode === 'draw' ? snap(Math.min(next.value, drag.point.value)) : drag.mode === 'move' ? original.start + applied : original.start;
      const duration = drag.mode === 'draw' ? Math.max(quantum, snap(Math.abs(next.value - drag.point.value))) : drag.mode === 'resize' ? original.duration + applied : original.duration;
      const first = Math.min(drag.point.lane, next.lane), last = Math.max(drag.point.lane, next.lane);
      const lanes = drag.mode === 'draw' ? { laneScope: first === last ? 'lane' : 'group', laneStart: first, laneEnd: last } :
        drag.mode === 'move' && original.laneScope !== 'global' ? { laneStart: original.laneStart + laneDelta, laneEnd: original.laneEnd + laneDelta } : {};
      return { ...entry, span: { ...original, start, duration, ...lanes } };
    }); changed();
  });
  listen('pointerup', event => {
    api.sync();
    if (!drag) return; stop(event);
    const ready = drafts, entries = drag.entries, entry = drag.entry;
    const current = getProject().automation;
    const stale = entries.some(original => JSON.stringify(current.find(candidate => candidate.id === original.id)?.span) !== JSON.stringify(original.span));
    cancelDrag();
    if (ready && !stale) {
      if (!entry) onAdd(ready[0].span, ready[0].target);
      else {
        const updates = ready.filter(candidate => JSON.stringify(candidate.span) !== JSON.stringify(entries.find(original => original.id === candidate.id)?.span))
          .map(candidate => ({ automationId: candidate.id, patch: { span: candidate.span } }));
        if (updates.length > 1) onBatchUpdate(updates); else if (updates.length) onUpdate(updates[0].automationId, updates[0].patch);
      }
    } else if (stale) onStatus('The selected spans changed during this gesture; the draft was canceled.');
    changed();
  });
  listen('pointercancel', event => { if (drag) { stop(event); cancelDrag(); changed(); } });
  listen('dblclick', event => { if (editing) stop(event); });
  const api = {
    get revision() { return revision; },
    sync() { const next = getRuntime()?.lanes?.renderer; if (drag && next === renderer && drag.transform.generation !== renderer?.world?.generation) { cancelDrag(); rectangles = []; } if (next !== renderer) { cancelDrag(); rectangles = []; if (renderer?.midiSpanOverlay === api) renderer.midiSpanOverlay = null; renderer = next; if (renderer) renderer.midiSpanOverlay = api; } },
    changed, cancelDraft() { cancelDrag(); changed(); }, select(id, ids = [id]) { selectedId = id; selectedIds = new Set(ids.slice(0, 64)); changed(); },
    setEditing(value) { editing = value === true; if (editing) visible = true; else cancelDrag(); changed(); },
    setVisible(value) { visible = value === true; if (!visible) { editing = false; cancelDrag(); rectangles = []; } changed(); },
    draw(context, current, dpr) {
      if (!visible) { rectangles = []; return; }
      const project = getProject(), draftIds = drafts ? new Set(drafts.map(entry => entry.id)) : null, entries = drafts ? project.automation.filter(entry => !draftIds.has(entry.id)) : project.automation;
      rectangles = getMidiSpanRectangles(current, project, entries);
      if (drafts) rectangles.push(...getMidiSpanRectangles(current, project, drafts, drag.transform));
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
    snapshot: () => ({ editing, visible, selectedId, revision, dragging: !!drag, rectangles: rectangles.map(rect => ({ id: rect.entry.id, domain: rect.entry.span.domain, x: rect.x, y: rect.y, width: rect.w, height: rect.h })) }),
    dispose() { cancelDrag(); for (const [name, handler] of listeners) canvas?.removeEventListener?.(name, handler, { capture: true }); if (renderer?.midiSpanOverlay === api) renderer.midiSpanOverlay = null; renderer = null; rectangles = []; drafts = drag = null; }
  };
  return api;
};
export { getSpanAxis, getMidiSpanRectangles, createProcgenMidiSpanOverlay };
