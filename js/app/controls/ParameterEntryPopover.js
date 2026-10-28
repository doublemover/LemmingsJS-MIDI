import { placeAnchoredControl } from './AnchoredControlPosition.js';

let nextEntryId = 0;

export function createParameterEntryPopover({ document, window, root, cap, label, output, entry, controls, name, contextName = name,
  getIdentity, isComposing, resetDraft, focusFallback = () => null, onActivity = () => {} }) {
  if (++nextEntryId > Number.MAX_SAFE_INTEGER) throw new Error('Exact-entry identity exhausted.');
  const panel = document.createElement('section'), heading = document.createElement('strong'), help = document.createElement('p');
  const toggle = document.createElement('button'), close = document.createElement('button'), listeners = [];
  let open = false, disposed = false, focusTimer = null;
  const nativePopover = typeof panel.showPopover === 'function'; if (nativePopover) panel.setAttribute('popover', 'manual');
  panel.id = 'parameter-entry-' + nextEntryId; panel.className = 'parameter-entry-popover'; panel.hidden = true;
  panel.dataset.parameterId = root.dataset.parameterId;
  panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', contextName + ' exact value');
  heading.textContent = contextName; help.textContent = 'Enter applies an exact value. Escape resets a draft, then closes.';
  toggle.type = close.type = 'button'; toggle.className = 'parameter-entry-toggle'; toggle.setAttribute('aria-label', 'Edit ' + name + ' value');
  toggle.setAttribute('aria-controls', panel.id); toggle.setAttribute('aria-expanded', 'false'); close.textContent = 'Close exact ' + name;
  panel.append(heading, ...controls, help, close); root.append(label, cap, toggle, panel); toggle.append(output); root.dataset.density = 'compact';
  const on = (target, type, handler, options) => { target?.addEventListener?.(type, handler, options); listeners.push(() => target?.removeEventListener?.(type, handler, options)); };
  const clearFocusTimer = () => { if (focusTimer != null) window?.clearTimeout?.(focusTimer); focusTimer = null; };
  function hide({ focus = false } = {}) {
    clearFocusTimer();
    if (!open) return; open = false; if (nativePopover) { try { panel.hidePopover(); } catch { /* Removing an owner may already hide its top-layer entry. */ } } panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); delete root.dataset.entryOpen;
    if (focus) (root.isConnected ? toggle : focusFallback())?.focus?.({ preventScroll: true }); onActivity();
  }
  function show() {
    if (disposed || !root.isConnected || getIdentity() == null) return;
    if (open) { hide({ focus: true }); return; }
    if (!nativePopover) (document.fullscreenElement || document.getElementById?.('procgenPresentationRoot') || document.body).append(panel);
    panel.dataset.laneId = root.closest?.('[data-lane-id]')?.dataset.laneId || root.dataset.laneId || '';
    panel.dataset.parameterName = name;
    open = true; panel.hidden = false; if (nativePopover) panel.showPopover(); root.dataset.entryOpen = 'true'; toggle.setAttribute('aria-expanded', 'true');
    placeAnchoredControl({ element: panel, anchor: toggle, window });
    entry.focus?.({ preventScroll: true }); entry.select?.(); onActivity();
  }
  on(toggle, 'click', show); on(close, 'pointerdown', event => event.preventDefault()); on(close, 'click', () => hide({ focus: true }));
  on(panel, 'keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || isComposing()) return;
    event.preventDefault(); event.stopPropagation(); if (!resetDraft()) hide({ focus: true });
  }, true);
  on(document, 'pointerdown', event => { if (open && !root.contains(event.target) && !panel.contains(event.target)) hide(); }, true);
  on(window, 'resize', () => hide()); on(window, 'blur', () => hide());
  on(panel, 'input', onActivity); on(panel, 'focusin', event => { clearFocusTimer(); onActivity(event); });
  on(panel, 'focusout', event => {
    if (!open || disposed || event.relatedTarget?.nodeType && (root.contains(event.relatedTarget) || panel.contains(event.relatedTarget))) return;
    clearFocusTimer();
    const settleFocus = () => { focusTimer = null; if (open && !disposed && !root.contains(document.activeElement) && !panel.contains(document.activeElement)) hide(); };
    // Native focus moves through body between blur and focus; a microtask can hide the next click target.
    if (window?.setTimeout) focusTimer = window.setTimeout(settleFocus, 0); else void Promise.resolve().then(settleFocus);
  });
  on(document, 'visibilitychange', () => { if (document.hidden) hide(); });
  return Object.freeze({ isOpen: () => open, close: hide, element: panel,
    dispose() { if (disposed) return; const focused = panel.contains(document.activeElement); hide(); clearFocusTimer(); disposed = true; for (const release of listeners) release(); panel.remove(); toggle.remove(); if (focused) focusFallback()?.focus?.({ preventScroll: true }); } });
}
