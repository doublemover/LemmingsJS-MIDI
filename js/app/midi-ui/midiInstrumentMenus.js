const createMidiInstrumentMenus = ({ root, document, window }) => {
  const entries = (root?.tagName?.toLowerCase() === 'details' ? [root] : Array.from(root?.children || [])).filter(element => element.tagName?.toLowerCase() === 'details')
    .map(menu => ({ menu, summary: menu.querySelector('summary') }));
  const listeners = [];
  const listen = (target, type, handler) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener?.(type, handler));
  };
  const close = () => { for (const { menu } of entries) menu.open = false; };
  const buttonsIn = entry => Array.from(entry.menu.querySelectorAll('button'));
  const enabledButtons = entry => buttonsIn(entry).filter(button => !button.disabled && !button.hidden);
  const containing = target => entries.find(entry => entry.menu.contains(target));
  const open = entry => {
    close();
    entry.menu.open = true;
  };
  const focusEdge = (entry, last = false) => {
    const buttons = enabledButtons(entry);
    (buttons[last ? buttons.length - 1 : 0] || entry.summary)?.focus();
  };
  listen(root, 'click', event => {
    const entry = containing(event.target);
    if (!entry) return;
    if (entry.summary?.contains(event.target)) {
      for (const other of entries) if (other !== entry) other.menu.open = false;
      return;
    }
    const item = buttonsIn(entry).find(button => button.contains(event.target));
    if (!item) return;
    // Actions may deliberately focus another view. Preserve that destination.
    const returnFocus = entry.menu.contains(document?.activeElement);
    close();
    if (returnFocus) entry.summary?.focus();
  });
  listen(root, 'keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const entry = containing(event.target);
    if (!entry) return;
    if (event.key !== 'Escape' && (['input', 'select', 'textarea'].includes(event.target?.tagName?.toLowerCase()) || event.target?.isContentEditable)) return;
    const atSummary = entry.summary?.contains(event.target);
    const buttons = enabledButtons(entry);
    const index = buttons.findIndex(button => button.contains(event.target));
    let handled = true;
    if (event.key === 'Escape') {
      close(); entry.summary?.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const next = entries[(entries.indexOf(entry) + direction + entries.length) % entries.length];
      const wasOpen = entry.menu.open;
      close();
      if (wasOpen) { open(next); focusEdge(next); } else next.summary?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (atSummary) { open(entry); focusEdge(entry, event.key === 'ArrowUp'); }
      else if (buttons.length) buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      if (atSummary && !entry.menu.open) entries[event.key === 'End' ? entries.length - 1 : 0].summary?.focus();
      else focusEdge(entry, event.key === 'End');
    } else if (entry.menu.open && event.key?.length === 1 && /[a-z0-9]/i.test(event.key)) {
      const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
      const match = ordered.find(button => button.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()));
      if (match) match.focus(); else handled = false;
    } else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  });
  listen(document, 'pointerdown', event => { if (!root?.contains(event.target)) close(); });
  listen(root, 'focusin', event => {
    const entry = containing(event.target);
    if (entry?.summary?.contains(event.target) && !entry.menu.open) close();
  });
  listen(root, 'focusout', event => { if (!root?.contains(event.relatedTarget)) close(); });
  listen(window, 'blur', close);
  return { close, dispose: () => { close(); while (listeners.length) listeners.pop()(); } };
};

export { createMidiInstrumentMenus };
