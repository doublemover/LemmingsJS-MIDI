const editable = element => element.tagName === 'TEXTAREA' || element.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(element.type);
const read = element => element.type === 'checkbox' ? element.checked : element.value;
const write = (element, value) => { if (element.type === 'checkbox') element.checked = !!value; else element.value = value ?? ''; };
const key = element => element.dataset?.fieldKey || element.dataset?.controlKey || null;

export function createKeyedControlTree({ document, onStatus = () => {}, focusFallback = () => null, conflictHost = null }) {
  const definitions = new WeakMap(), roots = new WeakMap();
  let disposed = false, epoch = 0, context = null, activeConflict = null, activeConflictAccepted = null, conflictSequence = 0;
  const clearConflict = element => {
    element.removeAttribute('data-edit-conflict'); element.removeAttribute('aria-invalid');
    if (activeConflict === element) { activeConflict = null; activeConflictAccepted = null; conflictSequence++; if (conflictHost) { conflictHost.hidden = true; conflictHost.replaceChildren(); } }
  };
  const showConflict = element => {
    if (disposed || !element.isConnected) return;
    element.dataset.editConflict = 'true'; element.setAttribute('aria-invalid', 'true');
    const accepted = definitions.get(element)?.accepted;
    if (activeConflict === element && activeConflictAccepted === accepted && (!conflictHost || !conflictHost.hidden)) {
      const keep = conflictHost?.querySelector('[data-resolution=keep]'); if (keep) keep.disabled = !!(element.disabled || element.readOnly); return;
    }
    activeConflict = element; activeConflictAccepted = accepted; const token = ++conflictSequence;
    const message = 'This value changed while you were editing. Keep your edit or use the current value.'; onStatus(message);
    if (!conflictHost) return;
    conflictHost.hidden = false; conflictHost.replaceChildren();
    const text = document.createElement('span'); text.textContent = message; conflictHost.append(text);
    const resolve = keep => {
      const definition = definitions.get(element);
      if (disposed || token !== conflictSequence || activeConflict !== element || !definition?.active || definition.getIdentity && definition.identity !== definition.getIdentity() || !element.isConnected || keep && (element.disabled || element.readOnly)) return;
      clearConflict(element); definition.dirty = false;
      if (keep) { const previous = definition.accepted; definition.accepted = read(element); if (definition.change?.({ currentTarget: element, target: element }) === false) { definition.accepted = previous; definition.dirty = true; } }
      else write(element, definition.accepted);
      element.focus({ preventScroll: true });
    };
    for (const [label, keep] of [['Keep my edit', true], ['Use current value', false]]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.resolution = keep ? 'keep' : 'current'; button.disabled = keep && !!(element.disabled || element.readOnly);
      button.addEventListener('click', () => resolve(keep)); conflictHost.append(button);
    }
  };
  const listen = (element, type, callback) => element.addEventListener(type, callback);
  const bind = (element, { change = null, click = null, input = null, getIdentity = null } = {}) => {
    const definition = { active: true, epoch, accepted: change ? read(element) : null, dirty: false, composing: false, change, click, input, getIdentity, identity: getIdentity?.() };
    definitions.set(element, definition);
    const current = event => {
      const value = definitions.get(event.currentTarget);
      return !disposed && value?.active && (!value.getIdentity || value.identity === value.getIdentity()) && event.currentTarget.isConnected !== false ? value : null;
    };
    if (click) listen(element, 'click', event => { const value = current(event); value?.click?.(event); });
    if (change) {
      listen(element, 'input', event => { const value = current(event); if (value) { value.dirty = read(element) !== value.accepted; if (value.input) { value.accepted = read(element); value.dirty = false; value.input(event); } } });
      listen(element, 'compositionstart', event => { const value = current(event); if (value) value.composing = true; });
      listen(element, 'compositionend', event => { const value = current(event); if (value) { value.composing = false; value.dirty = read(element) !== value.accepted; } });
      const commit = event => {
        const value = current(event); if (!value || element.disabled || element.readOnly || value.composing || event.isComposing || read(element) === value.accepted) return;
        if (element.dataset.editConflict) { showConflict(element); return; }
        const previous = value.accepted; value.dirty = false; value.accepted = read(element);
        if (value.change(event) === false) { value.accepted = previous; value.dirty = true; }
      };
      listen(element, 'change', commit);
      listen(element, 'focus', () => { if (element.dataset.editConflict) showConflict(element); });
      listen(element, 'keydown', event => {
        if (!['Enter', 'Escape'].includes(event.key) || !editable(element) || definition.composing || event.isComposing) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Enter') commit(event);
        else { write(element, definition.accepted); definition.dirty = false; clearConflict(element); }
      });
    }
    return element;
  };
  const retire = element => {
    const definition = definitions.get(element); if (definition) definition.active = false;
    if (activeConflict === element) clearConflict(element);
    for (const child of element.children || []) retire(child);
  };
  const compatible = (left, right) => left.tagName === right.tagName && (left.tagName !== 'INPUT' || left.type === right.type) && key(left) === key(right);
  const patch = (target, candidate) => {
    if (candidate.__retainedControl) { for (const attribute of candidate.attributes) candidate.__retainedControl.setAttribute(attribute.name, attribute.value); return candidate.__retainedControl; }
    const candidateValue = ['INPUT', 'TEXTAREA', 'SELECT'].includes(candidate.tagName) ? read(candidate) : null;
    const previous = definitions.get(target), next = definitions.get(candidate), preserve = previous && next?.change && editable(target) && (previous.dirty || previous.composing || document.activeElement === target && read(target) !== previous.accepted);
    const conflict = preserve && next.accepted !== previous.accepted;
    const draft = preserve ? read(target) : null;
    for (const attribute of [...target.attributes]) if (!candidate.hasAttribute(attribute.name) && !['data-edit-conflict', 'aria-invalid'].includes(attribute.name)) target.removeAttribute(attribute.name);
    for (const attribute of candidate.attributes) if (target.getAttribute(attribute.name) !== attribute.value) target.setAttribute(attribute.name, attribute.value);
    if (previous && next) { previous.change = next.change; previous.click = next.click; previous.input = next.input; previous.getIdentity = next.getIdentity; previous.identity = next.identity; previous.accepted = next.accepted; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      if (target.tagName === 'SELECT') reconcileChildren(target, candidate);
      write(target, preserve ? draft : candidateValue);
      if (conflict) showConflict(target); else if (!preserve) { if (previous) previous.dirty = false; clearConflict(target); }
    } else reconcileChildren(target, candidate);
    return target;
  };
  const reconcileChildren = (target, candidate) => {
    const old = [...target.children], keyed = new Map(old.filter(child => key(child)).map(child => [key(child), child])), used = new Set();
    let position = target.firstChild;
    for (const child of [...candidate.childNodes]) {
      if (child.nodeType === 3) {
        if (position?.nodeType === 3) { if (position.data !== child.data) position.data = child.data; position = position.nextSibling; }
        else target.insertBefore(child, position);
        continue;
      }
      if (child.nodeType !== 1) continue;
      let existing = child.__retainedControl || (!child.__ownedControl && (key(child) ? keyed.get(key(child)) : position?.nodeType === 1 && !key(position) && compatible(position, child) ? position : null));
      if (existing && (!compatible(existing, child) && !child.__retainedControl || used.has(existing))) existing = null;
      const result = existing ? patch(existing, child) : child;
      used.add(result); if (result !== position) { if (typeof target.moveBefore === 'function' && result.isConnected && target.isConnected) target.moveBefore(result, position); else target.insertBefore(result, position); } else position = position.nextSibling;
    }
    while (position) { const next = position.nextSibling; if (position.nodeType === 1) retire(position); position.remove(); position = next; }
    for (const child of old) if (!used.has(child) && child.parentNode === target) { retire(child); child.remove(); }
  };
  return Object.freeze({ bind,
    update(element, value, { identity = null } = {}) {
      if (disposed) return false;
      const definition = definitions.get(element); if (!definition?.active) return false;
      if (Object.hasOwn(definition, 'valueIdentity') && definition.valueIdentity !== identity) {
        const discarded = definition.dirty || definition.composing; definition.dirty = definition.composing = false; clearConflict(element); write(element, value); definition.accepted = value;
        if (discarded) onStatus('The document changed; this control now shows its current value.');
      }
      definition.valueIdentity = identity; definition.identity = definition.getIdentity?.();
      const preserve = editable(element) && (definition.dirty || definition.composing || document.activeElement === element && read(element) !== definition.accepted);
      const conflict = preserve && (value !== definition.accepted || element.disabled || element.readOnly); definition.accepted = value;
      if (!preserve) { write(element, value); clearConflict(element); }
      if (conflict || element.dataset.editConflict) showConflict(element);
      return true;
    },
    retain(element) { const placeholder = document.createElement(element.tagName); placeholder.__retainedControl = element; return placeholder; },
    reconcile(root, candidate, identity) {
      if (disposed) return false;
      const active = document.activeElement, ownedFocus = root.contains(active); let caret = null;
      if (ownedFocus) try { if (active.selectionStart != null) caret = [active.selectionStart, active.selectionEnd, active.selectionDirection]; } catch { /* Numeric controls have no text caret. */ }
      if (context !== identity) { context = identity; epoch++; }
      if (roots.get(root) !== identity) { roots.set(root, identity); for (const child of root.children) retire(child); root.replaceChildren(); }
      reconcileChildren(root, candidate);
      if (ownedFocus && active.isConnected && document.activeElement !== active) { active.focus({ preventScroll: true }); if (caret) active.setSelectionRange(...caret); }
      if (ownedFocus && !active.isConnected) { focusFallback()?.focus?.({ preventScroll: true }); onStatus('The selected control is no longer available. Focus moved to the inspector tab.'); }
      return true;
    },
    inspect: () => Object.freeze({ epoch, context, conflict: activeConflict?.dataset.fieldKey || null }),
    dispose() { if (disposed) return; disposed = true; epoch++; if (activeConflict) clearConflict(activeConflict); }
  });
}
