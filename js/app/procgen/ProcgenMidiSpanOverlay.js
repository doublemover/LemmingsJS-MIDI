import { getPointerGestureArbiter } from '../controls/PointerGestureArbiter.js';
import { createMidiSpan, SPAN_COLORS } from '../midi-ui/midiAutomationSpanEditor.js';
import { projectMidiAutomationSpan, selectMidiSpanDisplayEntries } from '../midi-ui/midiAutomationSpanProjection.js';
const getLaneHeight = renderer => renderer.world.laneHeight || 96;
const getSpanAxis = (renderer, domain, project) => {
  const width = renderer.canvas.width / Math.min(2, renderer.window.devicePixelRatio || 1);
  if (domain === 'distance') return { start: renderer.originX, length: renderer.viewWidth, width };
  const tick = renderer.world.tickIndex - (renderer.world.generationStartTick || 0);
  const beat = Math.max(0, tick) * 0.06 * project.transport.bpmBase / 60;
  return { start: Math.floor(beat / 16) * 16, length: 16, width, beat };
};
const getMidiSpanRectangles = (renderer, project, entries = project.automation, projection = null, selectedIds = []) => {
  const dpr = Math.min(2, renderer.window.devicePixelRatio || 1), height = projection?.height ?? renderer.canvas.height / dpr - (renderer.overviewBandHeight || 0);
  const originY = projection?.originY ?? renderer.originY, viewHeight = projection?.viewHeight ?? renderer.viewHeight;
  const result = [], laneHeight = projection?.laneHeight ?? getLaneHeight(renderer);
  const spans = selectMidiSpanDisplayEntries(entries, selectedIds).sort((a, b) => a.span.priority - b.span.priority);
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
const createProcgenMidiSpanOverlay = ({ document, getRuntime, getProject, getDomain, getTarget, onUpdate, onBatchUpdate, onAdd, onSelect, onStatus = () => {}, onPresentation = () => {} }) => {
  const canvas = document.getElementById('gameCanvas'), listeners = [], pointerArbiter = getPointerGestureArbiter(document);
  let selectedIds = new Set();
  let renderer = null, selectedId = null, editing = false, visible = true, drag = null, drafts = null, rectangles = [], revision = 0, presented = null, listening = false, disposed = false, lastAuthorityKey = null;
  const listen = (name, handler) => { listeners.push([name, handler]); };
  const syncInputs = () => {
    const active = editing && visible && supportsPresentation();
    if (active !== listening) { listening = active;
      for (const [name, handler] of listeners) canvas?.[active ? 'addEventListener' : 'removeEventListener']?.(name, handler, { capture: true }); }
    const status = api.presentationStatus(), key = [status, editing, visible, !!canPresent(), supportsPresentation()].join(':');
    if (key !== lastAuthorityKey) { lastAuthorityKey = key; try { onPresentation(Object.freeze({ status, editing, visible, supported: supportsPresentation(), presented: !!canPresent() })); } catch {} }
  };
  const changed = () => { revision++; try { renderer?.render?.(); } catch (error) { editing = false; cancelDrag(); rectangles = []; presented = null; syncInputs(); throw error; } };
  const projectionKey = domain => {
    if (!renderer?.world) return null;
    return [renderer.canvas.width, renderer.canvas.height, renderer.originX, renderer.originY,
      renderer.viewWidth, renderer.viewHeight, renderer.world.generation, domain].join(':');
  };
  const supportsPresentation = () => !disposed && !!canvas && renderer?.canvas === canvas && !renderer.workstationLayout;
  const canPresent = () => visible && supportsPresentation() && renderer.midiSpanOverlay === api &&
    presented?.renderer === renderer && presented.generation === renderer.world?.generation && presented.revision === revision &&
    presented.projectionKey === projectionKey(getDomain());
  const cancelDrag = () => {
    const previous = drag; drafts = drag = null; previous?.lease.cancel('cancelled');
    if (previous?.pointerId != null && canvas.hasPointerCapture?.(previous.pointerId)) canvas.releasePointerCapture?.(previous.pointerId);
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
    if (!editing || !canPresent() || event.button || pointerArbiter.inspect()) return;
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
    const identity = getProject(), projection = projectionKey(domain);
    const lease = pointerArbiter.acquire({ pointerId: event.pointerId, targetKey: 'span:' + (entry?.id || 'new'), identity,
      getIdentity: () => getProject() === identity && projectionKey(domain) === projection ? identity : null,
      onCancel: () => { cancelDrag(); changed(); } });
    if (!lease) { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId); return; }
    drag = { lease, entry, entries, domain, transform, projectionKey: projectionKey(domain), point: source,
      pointerId: event.pointerId, mode: hit ? !hit.repeating && point.x >= hit.x + hit.w - 8 ? 'resize' : 'move' : 'draw' };
  });
  listen('pointermove', event => {
    api.sync();
    if (!drag?.lease.owns(event)) return; stop(event);
    if (drag.projectionKey !== projectionKey(drag.domain)) { cancelDrag(); onStatus('The canvas view changed; the span draft was canceled.'); return; }
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
    if (!drag?.lease.owns(event)) return; stop(event);
    const ready = drafts, entries = drag.entries, entry = drag.entry;
    const current = getProject().automation;
    const stale = entries.some(original => JSON.stringify(current.find(candidate => candidate.id === original.id)?.span) !== JSON.stringify(original.span));
    const presentationValid = canPresent() && drag.projectionKey === projectionKey(drag.domain);
    drag.lease.finish(event); cancelDrag(); if (!presentationValid) { editing = false; syncInputs(); }
    if (ready && !stale && presentationValid) {
      if (!entry) onAdd(ready[0].span, ready[0].target);
      else {
        const updates = ready.filter(candidate => JSON.stringify(candidate.span) !== JSON.stringify(entries.find(original => original.id === candidate.id)?.span))
          .map(candidate => ({ automationId: candidate.id, patch: { span: candidate.span } }));
        if (updates.length > 1) onBatchUpdate(updates); else if (updates.length) onUpdate(updates[0].automationId, updates[0].patch);
      }
    } else if (stale) onStatus('The selected spans changed during this gesture; the draft was canceled.');
    else if (!presentationValid) onStatus('The span draft was canceled because its presentation is no longer current.');
    changed();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) listen(type, event => { if (drag?.lease.owns(event)) { stop(event); cancelDrag(); changed(); } });
  listen('blur', cancelDrag); listen('keydown', event => { if (event.key === 'Escape') cancelDrag(); });
  listen('dblclick', event => { if (editing) stop(event); });
  const api = {
    get revision() { return revision; },
    sync() { if (disposed) return; const next = getRuntime()?.lanes?.renderer;
      if (next === renderer && (presented && (presented.generation !== renderer?.world?.generation || presented.projectionKey !== projectionKey(getDomain())) || drag &&
        (drag.transform.generation !== renderer?.world?.generation || drag.projectionKey !== projectionKey(drag.domain)))) { editing = false; cancelDrag(); rectangles = []; presented = null; }
      if (next !== renderer) { editing = false; cancelDrag(); rectangles = []; presented = null; if (renderer?.midiSpanOverlay === api) renderer.midiSpanOverlay = null; renderer = next; }
      if (renderer && (renderer.workstationLayout || renderer.canvas !== canvas)) { editing = false; cancelDrag(); rectangles = []; presented = null; if (renderer.midiSpanOverlay === api) renderer.midiSpanOverlay = null; }
      else if (renderer) renderer.midiSpanOverlay = api; syncInputs();
    },
    changed, cancelDraft() { cancelDrag(); changed(); }, select(id, ids = [id]) { selectedId = id; selectedIds = new Set(ids.slice(0, 64)); changed(); },
    setEditing(value) { if (disposed) return false; api.sync(); if (value === true) { visible = true; if (!canPresent()) changed(); } editing = value === true && !!canPresent(); if (!editing) { cancelDrag(); if (value === true) onStatus(renderer?.workstationLayout ? 'Canvas span editing is unavailable in workstation layout.' : 'Wait for the span overlay to render before editing.'); } changed(); if (editing && !canPresent()) { editing = false; cancelDrag(); } syncInputs(); return editing; },
    setVisible(value) { if (disposed) return; visible = value === true; if (!visible) { editing = false; cancelDrag(); rectangles = []; presented = null; } syncInputs(); changed(); },
    presentationStatus() { return disposed ? 'Canvas span editing is unavailable after tool retirement.' : renderer?.workstationLayout ? 'Canvas span editing is unavailable in workstation layout.' : !renderer ? 'Canvas span editing is unavailable until the world loads.' : renderer.canvas !== canvas ? 'Canvas span editing is unavailable after the drawing surface changed.' : !canPresent() ? 'Wait for the span overlay to render before editing.' : ''; },
    draw(context, current, dpr) {
      if (disposed || !visible || current.workstationLayout) { editing = false; cancelDrag(); rectangles = []; presented = null; syncInputs(); return; }
      if (presented && presented.projectionKey !== projectionKey(getDomain())) { editing = false; cancelDrag(); }
      const project = getProject(), draftIds = drafts ? new Set(drafts.map(entry => entry.id)) : null;
      const entries = drafts ? [...project.automation.filter(entry => !draftIds.has(entry.id)), ...drafts] : project.automation;
      const displayed = selectMidiSpanDisplayEntries(entries, drafts ? new Set([...selectedIds, ...draftIds]) : selectedIds);
      rectangles = getMidiSpanRectangles(current, project, drafts ? displayed.filter(entry => !draftIds.has(entry.id)) : displayed);
      if (drafts) rectangles.push(...getMidiSpanRectangles(current, project, displayed.filter(entry => draftIds.has(entry.id)), drag.transform));
      const router = getRuntime()?.view?.midiPreviewRouter;
      context.save(); context.scale(dpr, dpr);
      for (const rect of rectangles) {
        const { entry } = rect, color = SPAN_COLORS[entry.target] || '#dfb75d';
        const state = router?.getAutomationSpanState?.(entry.id, entry.span.laneStart);
        const projection = rect.projection = projectMidiAutomationSpan(entry, state, { previewPosition: rect.axis.beat, generation: current.world.generation, draft: !!draftIds?.has(entry.id) });
        context.globalAlpha = entry.enabled ? 0.14 : 0.04; context.fillStyle = color; context.fillRect(rect.x, rect.y, rect.w, rect.h);
        context.globalAlpha = entry.enabled ? 0.85 : 0.35; context.strokeStyle = color; context.lineWidth = selectedIds.has(entry.id) ? 2 : 1;
        context.setLineDash(rect.repeating ? [2, 3] : entry.span.shape === 'ramp' ? [6, 3] : entry.enabled ? [] : [2, 4]); context.strokeRect(rect.x, rect.y, rect.w, rect.h);
        const labelY = Math.max(rect.y, current.hud?.sprites ? 16 * Math.max(1, Math.floor(Math.min(3, rect.axis.width / 540))) + 2 : 0), labelX = rect.x + Math.max(0, rect.w - 280);
        if (labelY + 18 <= rect.y + rect.h && rect.w >= 34) {
          context.globalAlpha = 1; context.fillStyle = '#07140fe6'; context.fillRect(labelX, labelY, Math.min(rect.w, 280), 17);
          context.fillStyle = color; context.font = '11px system-ui'; context.fillText(entry.name + ' · ' + entry.span.domain + (rect.repeating ? ' repeats every ' + entry.span.duration : entry.span.loop ? ' loop' : '') + ' · P' + entry.span.priority + (rect.axis.beat != null ? ' · Transport preview' : ''), labelX + 4, labelY + 12, Math.min(rect.w, 280) - 8);
          if (editing && !rect.repeating && selectedId === entry.id) context.fillText('↔', rect.x + rect.w - 15, labelY + 12);
        }
        if (labelY + 34 <= rect.y + rect.h && rect.w >= 34) {
          context.globalAlpha = 1; context.fillStyle = '#07140fe6'; context.fillRect(labelX, labelY + 17, Math.min(rect.w, 280), 17);
          context.fillStyle = projection.winning ? '#fff' : color;
          context.fillText(projection.text, labelX + 4, labelY + 29, Math.min(rect.w, 280) - 8);
        }
        if (projection.previewActive && projection.previewPosition >= rect.start && projection.previewPosition < rect.end) {
          context.globalAlpha = 0.2; context.fillStyle = color;
          context.fillRect((projection.previewPosition - rect.axis.start) / rect.axis.length * rect.axis.width, rect.y, 1, rect.h);
        }
        if (projection.winning && projection.position >= rect.start && projection.position < rect.end) {
          context.globalAlpha = 0.9; context.fillStyle = '#fff';
          const laneHeight = getLaneHeight(current), height = current.canvas.height / dpr - (current.overviewBandHeight || 0);
          const laneTop = Number.isInteger(projection.laneIndex) ? (projection.laneIndex * laneHeight - current.originY) * height / current.viewHeight : rect.y;
          const laneBottom = Number.isInteger(projection.laneIndex) ? ((projection.laneIndex + 1) * laneHeight - current.originY) * height / current.viewHeight : rect.y + rect.h;
          const top = Math.max(rect.y, laneTop), bottom = Math.min(rect.y + rect.h, laneBottom);
          if (bottom > top) context.fillRect((projection.position - rect.axis.start) / rect.axis.length * rect.axis.width, top, 2, bottom - top);
        }
      }
      context.restore();
      presented = { renderer: current, generation: current.world?.generation, revision,
        projectionKey: projectionKey(getDomain()) };
      syncInputs();
    },
    snapshot: () => ({ editing, visible, disposed, presentationSupported: supportsPresentation(), presented: !!canPresent(), inputListeners: listening ? listeners.length : 0, selectedId, revision, dragging: !!drag, rectangles: rectangles.map(rect => ({ id: rect.entry.id, domain: rect.entry.span.domain, x: rect.x, y: rect.y, width: rect.w, height: rect.h, resolution: rect.projection })) }),
    dispose() { if (disposed) return; disposed = true; editing = false; cancelDrag(); syncInputs(); if (renderer?.midiSpanOverlay === api) renderer.midiSpanOverlay = null; renderer = null; rectangles = []; drafts = drag = null; presented = null; }
  };
  return api;
};
export { getSpanAxis, getMidiSpanRectangles, createProcgenMidiSpanOverlay };
