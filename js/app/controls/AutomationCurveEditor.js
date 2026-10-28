import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { getPointerGestureArbiter } from './PointerGestureArbiter.js';
import { parseAutomationCurvePoints, formatAutomationCurvePoints, moveAutomationCurvePoint } from './AutomationCurveDraft.js';

let nextOwner = 0;
export function createAutomationCurveEditor({ document, window, curve, getIdentity, commit, resourceBudget = null, onStatus = () => {} }) {
  const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'curve-editor-' + (++nextOwner), kind: 'automation-curve-draft', category: 'checkpoint', bytes: 262144, maxBytes: 262144 });
  const root = document.createElement('section'); root.className = 'studio-curve-editor'; root.__ownedControl = true; root.dataset.curveId = curve.id; root.setAttribute('aria-label', 'Controller curve ' + curve.id);
  const listeners = [], circles = [], arbiter = getPointerGestureArbiter(document), identity = getIdentity();
  let accepted = curve, acceptedText = formatAutomationCurvePoints(curve.points), draftText = acceptedText, draft = curve.points, selected = 0, dirty = false, conflict = false, disposed = false, gesture = null, composing = false, pointDirty = false, pointError = null;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const on = (target, type, handler, options) => { target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener(type, handler, options)); };
  const button = (text, handler) => { const value = node('button', text); value.type = 'button'; on(value, 'click', handler); return value; };
  const label = (text, control) => { const value = node('label', text); value.append(control); return value; };
  const exact = node('input'); exact.type = 'text'; exact.maxLength = 16384; exact.setAttribute('aria-label', 'Points');
  const pointSelect = node('select'); pointSelect.setAttribute('aria-label', 'Selected curve point');
  const position = node('input'), value = node('input'); position.type = value.type = 'text'; position.inputMode = 'decimal'; value.inputMode = 'numeric'; position.setAttribute('aria-label', 'Point position'); value.setAttribute('aria-label', 'Point value');
  const snap = node('select'); snap.setAttribute('aria-label', 'Curve position snap'); for (const [id, text] of [['0', 'Unsnapped'], ['0.25', '¼ unit'], ['1', '1 unit']]) { const option = node('option', text); option.value = id; snap.append(option); } snap.value = curve.axis === 'distance' ? '1' : '0.25';
  const svgNode = tag => document.createElementNS('http://www.w3.org/2000/svg', tag), svg = svgNode('svg'), line = svgNode('polyline'), baseline = svgNode('polyline');
  svg.setAttribute('viewBox', '0 0 400 180'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Controller curve diagram'); baseline.setAttribute('class', 'studio-curve-accepted'); line.setAttribute('class', 'studio-curve-draft'); svg.append(baseline, line);
  const axes = node('output'), message = node('output'), instructions = node('p', 'Select a point; arrows edit position/value, Shift changes by ten steps. Apply publishes one curve edit. Escape cancels the draft before closing the dock.'); instructions.className = 'studio-hint'; message.setAttribute('role', 'status');
  const apply = button('Apply curve', () => {
    if (!active() || composing || conflict || pointDirty) return; const parsed = parseAutomationCurvePoints(exact.value, accepted.length); if (!parsed.valid) { error(parsed.error); return; }
    const previous = accepted, previousText = acceptedText; accepted = { ...accepted, points: parsed.points }; acceptedText = formatAutomationCurvePoints(parsed.points); dirty = false;
    try { if (commit(parsed.points) === false) throw new Error('The curve target changed. Return to its named lane before applying.'); draftText = acceptedText; exact.value = draftText; draft = parsed.points; paint(); }
    catch (failure) { accepted = previous; acceptedText = previousText; dirty = true; error(failure.message); }
  });
  const reset = () => { gesture?.lease.cancel('draft-reset'); composing = false; conflict = false; dirty = false; pointDirty = false; pointError = null; draftText = acceptedText; exact.value = draftText; draft = accepted.points; position.removeAttribute('aria-invalid'); value.removeAttribute('aria-invalid'); paint(); };
  const discard = button('Discard curve draft', reset), useCurrent = button('Use current curve', reset), keepDraft = button('Keep my curve draft', () => { if (!active()) return; conflict = false; if (pointDirty) paint(); else acceptText(); });
  const active = () => !disposed && root.isConnected && getIdentity() === identity;
  const error = text => { message.textContent = text; exact.setAttribute('aria-invalid', 'true'); apply.disabled = true; onStatus(text); };
  const coordinates = points => {
    const vertices = []; for (let index = 0; index < points.length; index++) { const point = points[index], x = 24 + point.beat / accepted.length * 352, y = 152 - point.value / 127 * 128; if (accepted.mode === 'step' && index) vertices.push(`${x},${152 - points[index - 1].value / 127 * 128}`); vertices.push(`${x},${y}`); } return vertices.join(' ');
  };
  const pointFields = () => { selected = Math.max(0, Math.min(draft.length - 1, selected)); const point = draft[selected]; if (!pointDirty) { position.value = point ? String(point.beat) : ''; value.value = point ? String(point.value) : ''; } pointSelect.value = String(selected); };
  function paint() {
    if (disposed) return; const parsed = parseAutomationCurvePoints(draftText, accepted.length); if (parsed.valid) draft = parsed.points;
    root.dataset.dirty = String(dirty || pointDirty); root.dataset.conflict = String(conflict); exact.value = draftText; if (parsed.valid) exact.removeAttribute('aria-invalid'); else exact.setAttribute('aria-invalid', 'true');
    apply.disabled = !dirty || conflict || !parsed.valid || pointDirty || !active(); discard.disabled = !dirty && !pointDirty && !conflict; useCurrent.hidden = keepDraft.hidden = !conflict; position.disabled = value.disabled = pointSelect.disabled = !parsed.valid;
    axes.textContent = `${accepted.axis === 'distance' ? 'World pixels' : 'Beats'}: 0–${accepted.length}; controller value: 0–127; ${accepted.mode}`;
    message.textContent = conflict ? 'This curve changed elsewhere. Choose the current curve or explicitly keep your draft.' : pointDirty ? pointError || 'Finish the point entry with Enter or move focus to update the draft.' : parsed.valid ? dirty ? 'Uncommitted curve draft.' : 'Accepted curve; no draft.' : `${parsed.error} Diagram retains the last valid draft.`;
    baseline.setAttribute('points', coordinates(accepted.points)); line.setAttribute('points', coordinates(draft));
    while (circles.length > draft.length) circles.pop().remove();
    for (let index = 0; index < draft.length; index++) {
      let circle = circles[index]; if (!circle) { circle = svgNode('circle'); circle.dataset.point = String(index); circle.setAttribute('r', '7'); circle.setAttribute('tabindex', '0'); circle.setAttribute('role', 'button'); svg.append(circle); circles.push(circle); }
      const point = draft[index]; circle.setAttribute('cx', String(24 + point.beat / accepted.length * 352)); circle.setAttribute('cy', String(152 - point.value / 127 * 128)); circle.setAttribute('aria-label', `Point ${index + 1}: position ${point.beat}, value ${point.value}`); circle.setAttribute('aria-pressed', String(index === selected));
    }
    if (pointSelect.options.length !== draft.length) pointSelect.replaceChildren(...draft.map((_, index) => { const option = node('option', 'Point ' + (index + 1)); option.value = String(index); return option; })); pointFields();
  }
  const acceptText = () => { if (!active()) return; pointDirty = false; pointError = null; draftText = exact.value; dirty = draftText !== acceptedText; if (composing) { root.dataset.dirty = 'true'; apply.disabled = true; discard.disabled = false; return; } paint(); };
  const canEditPoints = () => active() && !pointDirty && parseAutomationCurvePoints(draftText, accepted.length).valid;
  const replaceDraft = points => { if (!points) { message.textContent = 'Keep positions in order and inside the loop.'; return; } const text = formatAutomationCurvePoints(points); if (text === draftText) return; draft = points; draftText = text; dirty = draftText !== acceptedText; paint(); };
  const editPoint = () => {
    if (!active()) return;
    const parsed = parseAutomationCurvePoints(draft.map((point, index) => index === selected ? `${position.value}:${value.value}` : `${point.beat}:${point.value}`).join(', '), accepted.length);
    if (!parsed.valid) { pointDirty = true; pointError = parsed.error; position.setAttribute('aria-invalid', 'true'); value.setAttribute('aria-invalid', 'true'); paint(); return; }
    pointDirty = false; pointError = null; position.removeAttribute('aria-invalid'); value.removeAttribute('aria-invalid'); replaceDraft(parsed.points); paint();
  };
  const remove = button('Remove selected point', () => { if (canEditPoints() && draft.length > 1) replaceDraft(draft.filter((_, index) => index !== selected)); });
  const add = button('Add curve point', () => {
    if (!canEditPoints() || draft.length >= 128) return; let best = null;
    for (let index = 0; index < draft.length; index++) { const from = draft[index].beat, to = draft[index + 1]?.beat ?? accepted.length; if (to > from && (!best || to - from > best.width)) best = { index, width: to - from, beat: (from + to) / 2 }; }
    if (!best) { message.textContent = 'Use exact points to create space for another position.'; return; } const next = draft.map(point => ({ ...point })); next.splice(best.index + 1, 0, { beat: best.beat, value: draft[best.index].value }); selected = best.index + 1; replaceDraft(next);
  });
  const tools = node('div'); tools.className = 'studio-curve-tools'; tools.append(label('Point', pointSelect), label('Position', position), label('Value', value), label('Snap', snap), add, remove, apply, discard, useCurrent, keepDraft);
  root.append(axes, svg, tools, label('Exact points', exact), message, instructions);
  on(exact, 'input', acceptText); on(exact, 'compositionstart', () => { composing = true; apply.disabled = true; }); on(exact, 'compositionend', () => { composing = false; draftText = exact.value; dirty = draftText !== acceptedText; if (active()) acceptText(); });
  on(pointSelect, 'change', () => { if (!canEditPoints()) { pointSelect.value = String(selected); return; } selected = Number(pointSelect.value); paint(); });
  for (const control of [position, value]) { on(control, 'input', () => { if (!active()) return; pointDirty = true; pointError = null; paint(); }); on(control, 'change', editPoint); on(control, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); editPoint(); } }); }
  on(svg, 'keydown', event => {
    const index = Number(event.target.dataset.point); if (!Number.isInteger(index) || !draft[index] || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Delete', 'Enter', ' '].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); if (!canEditPoints()) return; selected = index; if (event.key === 'Enter' || event.key === ' ') { paint(); return; } const point = draft[index], step = (Number(snap.value) || (accepted.axis === 'distance' ? 1 : 0.01)) * (event.shiftKey ? 10 : 1), amount = event.shiftKey ? 10 : 1;
    if (event.key === 'Delete') { event.preventDefault(); event.stopPropagation(); remove.click(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); event.stopPropagation();
    replaceDraft(moveAutomationCurvePoint(draft, selected, { beat: point.beat + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), value: event.key === 'Home' ? 0 : event.key === 'End' ? 127 : point.value + (event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0) }, accepted.length));
  });
  on(svg, 'pointerdown', event => {
    const index = Number(event.target.dataset.point); if (!canEditPoints() || event.button !== 0 || !Number.isInteger(index) || !draft[index]) return;
    const rect = svg.getBoundingClientRect(); if (!(rect.width > 0 && rect.height > 0)) return; const start = draftText;
    const lease = arbiter.acquire({ pointerId: event.pointerId, targetKey: 'automation-curve:' + accepted.id, identity, getIdentity, onCancel: () => { gesture = null; draftText = start; dirty = draftText !== acceptedText; paint(); } });
    if (!lease) return; selected = index; gesture = { lease, rect }; try { svg.setPointerCapture(event.pointerId); } catch { lease.cancel('capture-unavailable'); return; } event.preventDefault(); event.stopPropagation(); paint();
  });
  on(svg, 'pointermove', event => { if (!gesture?.lease.owns(event)) return; const rect = gesture.rect; replaceDraft(moveAutomationCurvePoint(draft, selected, { beat: ((event.clientX - rect.left) * 400 / rect.width - 24) / 352 * accepted.length, value: (152 - (event.clientY - rect.top) * 180 / rect.height) / 128 * 127 }, accepted.length, Number(snap.value))); });
  on(svg, 'pointerup', event => { if (!gesture?.lease.finish(event)) return; gesture = null; });
  for (const type of ['pointercancel', 'lostpointercapture']) on(svg, type, event => { if (gesture?.lease.owns(event)) gesture.lease.cancel(type); });
  on(window, 'resize', () => gesture?.lease.cancel('resize')); on(window, 'blur', () => gesture?.lease.cancel('blur'));
  on(root, 'keydown', event => { if (event.key === 'Escape' && (dirty || pointDirty || conflict || gesture)) { event.preventDefault(); event.stopPropagation(); reset(); } });
  paint();
  return Object.freeze({ element: root, inspect: () => Object.freeze({ dirty: dirty || pointDirty || composing, conflict, draftText, selected, gestureId: gesture?.lease.id ?? null }),
    update(next) {
      if (disposed) return; if (composing && !root.contains(document.activeElement)) { composing = false; draftText = exact.value; dirty = draftText !== acceptedText; } const nextText = formatAutomationCurvePoints(next.points), changed = nextText !== acceptedText || next.length !== accepted.length || next.mode !== accepted.mode || next.axis !== accepted.axis;
      if (changed) { gesture?.lease.cancel('external-edit'); accepted = next; acceptedText = nextText; if (dirty || pointDirty || composing) conflict = true; else { draftText = acceptedText; draft = next.points; } }
      if (!composing) paint();
    }, cancel: reason => gesture?.lease.cancel(reason), dispose() { if (disposed) return reservation.release(); gesture?.lease.cancel('disposed'); disposed = true; for (const release of listeners) release(); root.remove(); return reservation.release(); } });
}
