import { getPointerGestureArbiter } from './PointerGestureArbiter.js';
import { normalizeParameterDescriptor, parameterUnitPosition, parameterValueAt, quantizeParameter, parseParameterValue, formatParameterValue } from './ParameterDescriptor.js';

export function createParameterKnob({ document, window = document.defaultView, descriptor: input, value, getIdentity = () => input,
  commit, preview = () => {}, onCancel = () => {}, onFinish = () => {}, readOnly = false, pending = false, momentary = false, presentation = 'knob' } = {}) {
  if (!['knob', 'fader'].includes(presentation)) throw new Error('Invalid parameter presentation.');
  const descriptor = normalizeParameterDescriptor(input), arbiter = getPointerGestureArbiter(document), listeners = [];
  const node = (tag, cls, text) => { const element = document.createElement(tag); element.className = cls; if (text != null) element.textContent = text; return element; };
  const root = node('div', 'parameter-knob'), cap = node('button', 'parameter-knob-cap'), indicator = node('span', 'parameter-knob-indicator');
  const label = node('span', 'parameter-knob-label', descriptor.name), output = node('output', 'parameter-knob-value'), entry = node('input', 'parameter-knob-number');
  const effective = node('span', 'parameter-knob-effective'), pickup = node('span', 'parameter-knob-pickup'), error = node('output', 'parameter-knob-error');
  root.dataset.presentation = presentation;
  effective.hidden = pickup.hidden = true; cap.type = 'button'; cap.setAttribute('role', 'slider'); cap.setAttribute('aria-label', descriptor.name); cap.setAttribute('aria-orientation', 'vertical');
  cap.setAttribute('aria-valuemin', String(descriptor.min)); cap.setAttribute('aria-valuemax', String(descriptor.max));
  entry.type = 'text'; entry.inputMode = 'decimal'; entry.setAttribute('aria-label', descriptor.name + ' numeric value'); error.setAttribute('aria-live', 'polite');
  root.dataset.parameterId = descriptor.id; root.dataset.quantity = descriptor.quantity; cap.append(indicator, effective, pickup); root.append(label, cap, output, entry);
  let authored = value == null ? null : quantizeParameter(descriptor, value, true), draft = authored, gesture = null, disposed = false, wheelTimer = null;
  const on = (target, type, fn, options) => { target?.addEventListener?.(type, fn, options); listeners.push(() => target?.removeEventListener?.(type, fn, options)); };
  const paint = () => {
    const text = formatParameterValue(descriptor, draft); output.textContent = text; cap.setAttribute('aria-valuetext', text);
    if (draft == null) { cap.removeAttribute?.('aria-valuenow'); root.dataset.unknown = 'true'; }
    else { cap.setAttribute('aria-valuenow', String(draft)); delete root.dataset.unknown; indicator.style.transform = presentation === 'fader' ? 'none' : `rotate(${-135 + parameterUnitPosition(descriptor, draft) * 270}deg)`; if (presentation === 'fader') indicator.style.top = `${(1 - parameterUnitPosition(descriptor, draft)) * 90}%`; }
    if (document.activeElement !== entry) entry.value = draft == null ? '' : descriptor.formatInput ? descriptor.formatInput(draft) : String(draft);
    cap.disabled = entry.disabled = readOnly || pending; root.dataset.pending = String(pending);
  };
  const cancel = reason => {
    const previous = gesture; gesture = null; if (wheelTimer != null) window?.clearTimeout?.(wheelTimer); wheelTimer = null;
    if (previous) { try { cap.releasePointerCapture?.(previous.pointerId); } catch { /* Capture may already be lost. */ } }
    draft = authored; preview(authored, { phase: 'cancel', reason }); paint(); onCancel(reason);
  };
  const begin = event => {
    if (disposed || readOnly || pending || authored == null) return false;
    if (gesture) return gesture.lease.owns(event);
    const identity = getIdentity(), lease = arbiter.acquire({ pointerId: event?.pointerId ?? null, targetKey: descriptor.id, identity, getIdentity, onCancel: cancel });
    if (!lease) return false;
    gesture = { lease, pointerId: event?.pointerId ?? null, startY: event?.clientY ?? 0, position: parameterUnitPosition(descriptor, authored), beginValue: authored, detent: null }; return true;
  };
  const change = (next, event) => {
    if (!gesture?.lease.owns(event) || root.isConnected === false) { gesture?.lease.cancel('removed'); return false; }
    draft = quantizeParameter(descriptor, next, event?.shiftKey); paint(); preview(draft, { phase: 'preview', gestureId: gesture.lease.id, parameterId: descriptor.id, normalizedPressure: Number.isFinite(event?.pressure) ? event.pressure : null, pointerType: event?.pointerType || null }); return true;
  };
  const finish = event => {
    const current = gesture; if (!current?.lease.finish(event)) return false;
    gesture = null; if (wheelTimer != null) window?.clearTimeout?.(wheelTimer); wheelTimer = null;
    try { if (current.pointerId != null) cap.releasePointerCapture?.(current.pointerId); } catch { /* Already released. */ }
    const next = draft; draft = momentary ? authored : next;
    if (momentary) preview(authored, { phase: 'return', gestureId: current.lease.id });
    else if (next !== authored) { const previous = authored; try { commit(next, Object.freeze({ gestureId: current.lease.id, parameterId: descriptor.id, descriptorRevision: descriptor.revision, beginValue: current.beginValue, phase: 'commit' })); authored = next; } catch (failure) { authored = draft = previous; preview(previous, { phase: 'cancel', reason: 'commit-rejected' }); onCancel('commit-rejected'); error.textContent = failure.message; } }
    onFinish(); if (!disposed) paint(); return true;
  };
  on(cap, 'pointerdown', event => { if ((event.button ?? 0) !== 0 || !begin(event)) return; event.preventDefault(); cap.focus?.(); cap.setPointerCapture?.(event.pointerId); change(authored, event); });
  on(cap, 'pointermove', event => {
    if (!gesture?.lease.owns(event)) return;
    let position = Math.max(0, Math.min(1, gesture.position + (gesture.startY - event.clientY) / (event.shiftKey ? 1600 : 160)));
    if (gesture.detent != null && Math.abs(position - gesture.detent) <= 0.025) position = gesture.detent;
    else { gesture.detent = null; for (const detent of descriptor.detents) { const at = parameterUnitPosition(descriptor, detent); if (Math.abs(position - at) <= 0.012) { gesture.detent = at; position = at; break; } } }
    change(parameterValueAt(descriptor, position), event);
  });
  on(cap, 'pointerup', finish);
  for (const name of ['pointercancel', 'lostpointercapture']) on(cap, name, event => { if (gesture?.lease.owns(event)) gesture.lease.cancel(name); });
  const keys = new Set(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End', 'PageUp', 'PageDown']);
  on(cap, 'keydown', event => {
    if (event.key === 'Escape') { if (gesture) { event.preventDefault(); event.stopPropagation(); gesture.lease.cancel('escape'); } return; }
    if (!keys.has(event.key) || !begin(event)) return; event.preventDefault(); event.stopPropagation();
    const delta = (event.shiftKey ? descriptor.fineStep : descriptor.step) * (event.key.startsWith('Page') ? 10 : 1);
    change(event.key === 'Home' ? descriptor.min : event.key === 'End' ? descriptor.max : draft + (['ArrowDown', 'ArrowLeft', 'PageDown'].includes(event.key) ? -delta : delta), event);
  });
  on(cap, 'keyup', event => { if (keys.has(event.key)) finish(event); });
  on(cap, 'wheel', event => {
    if (document.activeElement !== cap || !begin(null)) return; event.preventDefault();
    change(draft + Math.sign(-event.deltaY) * (event.shiftKey ? descriptor.fineStep : descriptor.step), event);
    if (wheelTimer != null) window?.clearTimeout?.(wheelTimer); wheelTimer = window?.setTimeout?.(() => finish(null), 180);
  }, { passive: false });
  const action = (text, operation) => { const button = node('button', 'parameter-knob-action', text); button.type = 'button'; button.setAttribute('aria-label', text + ' ' + descriptor.name);
    on(button, 'click', () => { if (begin(null)) { change(operation(), null); finish(null); } }); root.append(button); return button; };
  action('−', () => draft - descriptor.step); action('+', () => draft + descriptor.step); action('Reset', () => descriptor.defaultValue); root.append(error);
  on(entry, 'change', () => { try { const next = parseParameterValue(descriptor, entry.value); if (begin(null)) { change(next, { shiftKey: true }); finish(null); } error.textContent = ''; entry.removeAttribute?.('aria-invalid'); }
  catch (failure) { error.textContent = failure.message; entry.setAttribute('aria-invalid', 'true'); } });
  on(entry, 'keydown', event => { if (event.key === 'Enter') entry.dispatchEvent?.(new window.Event('change')); if (event.key === 'Escape') { entry.value = authored == null ? '' : descriptor.formatInput ? descriptor.formatInput(authored) : String(authored); error.textContent = ''; } });
  on(cap, 'blur', () => gesture?.lease.cancel('blur')); on(window, 'blur', () => gesture?.lease.cancel('window-blur'));
  on(document, 'visibilitychange', () => { if (document.hidden) gesture?.lease.cancel('hidden'); });
  const observer = typeof window?.MutationObserver === 'function' ? new window.MutationObserver(() => { if (!root.isConnected) gesture?.lease.cancel('removed'); }) : null;
  observer?.observe(document.documentElement, { childList: true, subtree: true }); paint();
  const observations = ({ effectiveValue = null, pickupValue = null } = {}) => {
    for (const [mark, position] of [[effective, effectiveValue], [pickup, pickupValue]]) {
      mark.hidden = !Number.isFinite(position);
      if (!mark.hidden) { mark.style.transform = presentation === 'fader' ? 'none' : `rotate(${-135 + parameterUnitPosition(descriptor, position) * 270}deg)`;
        if (presentation === 'fader') mark.style.top = `${(1 - parameterUnitPosition(descriptor, position)) * 90}%`; }
    }
  };
  return Object.freeze({ element: root, descriptor, inspect: () => Object.freeze({ authored, draft, gestureId: gesture?.lease.id ?? null }),
    setState({ value: next = authored, effectiveValue = null, pickupValue = null, isReadOnly = readOnly, isPending = pending } = {}) {
      if (gesture && (getIdentity() !== gesture.lease.identity || next !== authored)) gesture.lease.cancel('external-edit');
      readOnly = isReadOnly; pending = isPending; authored = draft = next == null ? null : quantizeParameter(descriptor, next, true);
      observations({ effectiveValue, pickupValue });
      paint();
    }, setObservations: observations, cancel: reason => gesture?.lease.cancel(reason), dispose() { if (disposed) return; gesture?.lease.cancel('disposed'); disposed = true; observer?.disconnect(); for (const remove of listeners) remove(); listeners.length = 0; } });
}
