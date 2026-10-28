import { getPointerGestureArbiter } from './PointerGestureArbiter.js';
import { normalizeParameterDescriptor, parameterUnitPosition, parameterValueAt, quantizeParameter, parseParameterValue, formatParameterValue } from './ParameterDescriptor.js';
import { createParameterEntryPopover } from './ParameterEntryPopover.js';

export function createParameterKnob({ document, window = document.defaultView, descriptor: input, value, getIdentity = () => input,
  commit, preview = () => {}, onCancel = () => {}, onFinish = () => {}, readOnly = false, pending = false, momentary = false, presentation = 'knob',
  compact = false, contextName, focusFallback, onEntryActivity, compactFormat, compactLabel } = {}) {
  if (!['knob', 'fader'].includes(presentation)) throw new Error('Invalid parameter presentation.');
  const descriptor = normalizeParameterDescriptor(input), arbiter = getPointerGestureArbiter(document), listeners = [];
  const node = (tag, cls, text) => { const element = document.createElement(tag); element.className = cls; if (text != null) element.textContent = text; return element; };
  const root = node('div', 'parameter-knob'), cap = node('button', 'parameter-knob-cap'), indicator = node('span', 'parameter-knob-indicator');
  const label = node('span', 'parameter-knob-label', descriptor.name), output = node('output', 'parameter-knob-value'), entry = node('input', 'parameter-knob-number');
  const effective = node('span', 'parameter-knob-effective'), pickup = node('span', 'parameter-knob-pickup'), error = node('output', 'parameter-knob-error'), textConflict = node('div', 'parameter-knob-text-conflict');
  textConflict.hidden = true; const actionButtons = [], conflictButtons = new Map();
  root.dataset.presentation = presentation;
  root.dataset.parameterRole = descriptor.functionalRole;
  if (compact && compactLabel) label.textContent = compactLabel;
  effective.hidden = pickup.hidden = true; cap.type = 'button'; cap.setAttribute('role', 'slider'); cap.setAttribute('aria-label', descriptor.name); cap.setAttribute('aria-orientation', 'vertical');
  cap.setAttribute('aria-valuemin', String(descriptor.min)); cap.setAttribute('aria-valuemax', String(descriptor.max));
  entry.type = 'text'; entry.maxLength = 2048; entry.inputMode = 'decimal'; entry.setAttribute('aria-label', descriptor.name + ' numeric value'); error.setAttribute('aria-live', 'polite');
  root.dataset.parameterId = descriptor.id; root.dataset.quantity = descriptor.quantity; cap.append(indicator, effective, pickup); root.append(label, cap, output, entry);
  let authored = value == null ? null : quantizeParameter(descriptor, value, true), draft = authored, gesture = null, disposed = false, wheelTimer = null, entryDirty = false, entryConflict = false, entryComposing = false, exactPopover = null;
  const on = (target, type, fn, options) => { target?.addEventListener?.(type, fn, options); listeners.push(() => target?.removeEventListener?.(type, fn, options)); };
  const paint = () => {
    const text = formatParameterValue(descriptor, draft), display = compact && compactFormat && draft != null ? compactFormat(draft) : text;
    if (output.textContent !== display) {
      if (output.firstChild?.nodeType === 3 && output.childNodes.length === 1) output.firstChild.nodeValue = display;
      else output.textContent = display;
    }
    cap.setAttribute('aria-valuetext', text);
    if (draft == null) { cap.removeAttribute?.('aria-valuenow'); root.dataset.unknown = 'true'; }
    else { cap.setAttribute('aria-valuenow', String(draft)); delete root.dataset.unknown; indicator.style.transform = presentation === 'fader' ? 'none' : `rotate(${-135 + parameterUnitPosition(descriptor, draft) * 270}deg)`; if (presentation === 'fader') indicator.style.top = `${(1 - parameterUnitPosition(descriptor, draft)) * 90}%`; }
    if (document.activeElement !== entry && !entryDirty && !entryConflict) entry.value = draft == null ? '' : descriptor.formatInput ? descriptor.formatInput(draft) : String(draft);
    const movingFocus = document.activeElement === cap || actionButtons.includes(document.activeElement);
    cap.disabled = readOnly || pending || entryConflict; entry.readOnly = readOnly || pending; cap.setAttribute('aria-readonly', String(readOnly)); root.setAttribute('aria-busy', String(pending));
    for (const button of actionButtons) button.disabled = readOnly || pending || entryConflict;
    const keep = conflictButtons.get(true); if (keep) keep.disabled = readOnly || pending;
    if (movingFocus && cap.disabled) entry.focus?.({ preventScroll: true }); root.dataset.pending = String(pending);
  };
  const cancel = reason => {
    const previous = gesture; gesture = null; if (wheelTimer != null) window?.clearTimeout?.(wheelTimer); wheelTimer = null;
    if (previous) { try { cap.releasePointerCapture?.(previous.pointerId); } catch { /* Capture may already be lost. */ } }
    draft = authored; preview(authored, { phase: 'cancel', reason }); paint(); onCancel(reason);
  };
  const begin = event => {
    if (disposed || readOnly || pending || entryConflict || authored == null) return false;
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
    on(button, 'click', () => { if (begin(null)) { change(operation(), null); finish(null); } }); root.append(button); actionButtons.push(button); return button; };
  action('−', () => draft - descriptor.step); action('+', () => draft + descriptor.step); action('Reset', () => descriptor.defaultValue); root.append(error);
  const acceptedText = () => authored == null ? '' : descriptor.formatInput ? descriptor.formatInput(authored) : String(authored);
  let conflictMessage = null;
  const showTextConflict = message => {
    if (message) conflictMessage = message;
    entryConflict = true; entry.dataset.editConflict = 'true'; entry.setAttribute('aria-invalid', 'true'); textConflict.hidden = false;
    error.textContent = conflictMessage || 'This control changed while you were typing. Keep your edit or use the current value.'; paint();
  };
  const clearTextConflict = () => { entryConflict = false; conflictMessage = null; textConflict.hidden = true; delete entry.dataset.editConflict; entry.removeAttribute('aria-invalid'); error.textContent = ''; };
  const acceptText = () => {
    if (disposed || entryComposing || compact && !exactPopover?.isOpen()) return;
    if (entryConflict) { showTextConflict(); return; }
    try {
      const next = parseParameterValue(descriptor, entry.value);
      if (!begin(null)) return;
      change(next, { shiftKey: true }); finish(null);
      if (!momentary && authored !== quantizeParameter(descriptor, next, true)) return;
      entryDirty = false; entry.value = acceptedText(); clearTextConflict();
    } catch (failure) { error.textContent = failure.message; entry.setAttribute('aria-invalid', 'true'); }
  };
  for (const [label, keep] of [['Keep my edit', true], ['Use current value', false]]) {
    const button = node('button', 'parameter-knob-action', label); button.type = 'button';
    on(button, 'click', () => { if (disposed || !entryConflict || keep && (readOnly || pending)) return; entry.focus?.({ preventScroll: true }); clearTextConflict(); if (keep) acceptText(); else { entryDirty = false; entry.value = acceptedText(); paint(); } });
    textConflict.append(button); conflictButtons.set(keep, button);
  }
  root.append(textConflict);
  on(entry, 'compositionstart', () => { entryComposing = true; });
  on(entry, 'compositionend', () => { entryComposing = false; entryDirty = entry.value !== acceptedText(); });
  on(entry, 'input', () => { entryDirty = entry.value !== acceptedText(); });
  on(entry, 'change', () => { if (!compact) acceptText(); });
  on(entry, 'keydown', event => {
    if (entryComposing || event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); acceptText(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); entryDirty = false; clearTextConflict(); entry.value = acceptedText(); paint(); }
  });
  on(cap, 'blur', () => gesture?.lease.cancel('blur')); on(window, 'blur', () => gesture?.lease.cancel('window-blur'));
  on(document, 'visibilitychange', () => { if (document.hidden) gesture?.lease.cancel('hidden'); });
  const observer = typeof window?.MutationObserver === 'function' ? new window.MutationObserver(() => { if (!root.isConnected) { gesture?.lease.cancel('removed'); exactPopover?.close({ focus: true }); } }) : null;
  observer?.observe(document.documentElement, { childList: true, subtree: true }); paint();
  if (compact) exactPopover = createParameterEntryPopover({ document, window, root, cap, label, output, entry, controls: [entry, ...actionButtons, error, textConflict],
    name: descriptor.name, contextName, getIdentity, isComposing: () => entryComposing, focusFallback, onActivity: onEntryActivity,
    resetDraft() { if (!entryDirty && !entryConflict) return false; entryDirty = false; clearTextConflict(); entry.value = acceptedText(); paint(); return true; } });
  const observations = ({ effectiveValue = null, pickupValue = null } = {}) => {
    if (disposed) return;
    for (const [mark, position] of [[effective, effectiveValue], [pickup, pickupValue]]) {
      mark.hidden = !Number.isFinite(position);
      if (!mark.hidden) { mark.style.transform = presentation === 'fader' ? 'none' : `rotate(${-135 + parameterUnitPosition(descriptor, position) * 270}deg)`;
        if (presentation === 'fader') mark.style.top = `${(1 - parameterUnitPosition(descriptor, position)) * 90}%`; }
    }
  };
  return Object.freeze({ element: root, descriptor, inspect: () => Object.freeze({ authored, draft, gestureId: gesture?.lease.id ?? null, exactOpen: !!exactPopover?.isOpen(), textDirty: entryDirty || entryConflict || entryComposing }),
    snapshotDraft() {
      if (disposed || !getIdentity() || !(entryDirty || entryConflict || entryComposing) || entry.value.length > 2048) return null;
      return Object.freeze({ version: 1, identity: getIdentity(), descriptor: input, signature: JSON.stringify(descriptor), parse: input.parse, format: input.format, formatInput: input.formatInput,
        text: entry.value, authored, conflict: entryConflict, composing: entryComposing, error: String(error.textContent).slice(0, 512), invalid: entry.getAttribute('aria-invalid') === 'true', start: entry.selectionStart, end: entry.selectionEnd });
    },
    restoreDraft(snapshot) {
      if (disposed || !snapshot || snapshot.version !== 1 || !snapshot.identity || snapshot.identity !== getIdentity() || snapshot.descriptor !== input || snapshot.signature !== JSON.stringify(descriptor) ||
        snapshot.parse !== input.parse || snapshot.format !== input.format || snapshot.formatInput !== input.formatInput || typeof snapshot.text !== 'string' || snapshot.text.length > 2048) return false;
      entry.value = snapshot.text; entryDirty = true; entryComposing = false; entry.setSelectionRange?.(Math.max(0, Math.min(entry.value.length, snapshot.start || 0)), Math.max(0, Math.min(entry.value.length, snapshot.end || 0)));
      if (snapshot.composing) showTextConflict('Composition ended when this lane was hidden. Review the draft or use the current value.');
      else if (snapshot.conflict || snapshot.authored !== authored || readOnly || pending) showTextConflict();
      else { if (snapshot.invalid) entry.setAttribute('aria-invalid', 'true'); error.textContent = snapshot.error || ''; paint(); }
      onEntryActivity?.(); return true;
    },
    setState({ value: next = authored, effectiveValue = null, pickupValue = null, isReadOnly = readOnly, isPending = pending } = {}) {
      if (disposed) return;
      const incoming = next == null ? null : quantizeParameter(descriptor, next, true), unavailable = isReadOnly && !readOnly || isPending && !pending, conflict = entryDirty && (incoming !== authored || unavailable);
      if (gesture && (getIdentity() !== gesture.lease.identity || incoming !== authored || unavailable)) gesture.lease.cancel(unavailable ? 'unavailable' : 'external-edit');
      if (unavailable) entryComposing = false;
      readOnly = isReadOnly; pending = isPending; authored = incoming;
      if (!gesture) draft = authored;
      observations({ effectiveValue, pickupValue });
      if (conflict) showTextConflict(); else paint();
    }, setObservations: observations, cancel(reason) { gesture?.lease.cancel(reason); exactPopover?.close(); }, dispose() { if (disposed) return; gesture?.lease.cancel('disposed'); disposed = true; exactPopover?.dispose(); observer?.disconnect(); for (const remove of listeners) remove(); listeners.length = 0; } });
}
