export function createProcgenCommandPalette({ document, dispatcher, getScopeLabel = () => '', onStatus = () => {} }) {
  let current = null, disposed = false;
  const node = (tag, text) => { const value = document.createElement(tag); if (text) value.textContent = text; return value; };
  const close = ({ restore = true } = {}) => {
    if (!current) return; const owned = current; current = null; owned.dialog.close?.(); owned.dialog.remove();
    if (restore && owned.focus?.isConnected) owned.focus.focus({ preventScroll: true });
  };
  return Object.freeze({
    open() {
      if (disposed || current || document.querySelector('dialog[open]')) return false;
      const dialog = node('dialog'); dialog.className = 'studio-command-palette'; dialog.setAttribute('aria-label', 'Commands and shortcuts');
      const search = node('input'); search.type = 'search'; search.setAttribute('aria-label', 'Find a command'); search.maxLength = 128;
      const status = node('p'); status.setAttribute('role', 'status');
      const list = node('div'); list.className = 'studio-command-list'; list.setAttribute('role', 'list');
      const dismiss = node('button', 'Close'); dismiss.type = 'button';
      const entries = dispatcher.list(), owned = { dialog, focus: document.activeElement };
      const execute = entry => {
        if (current !== owned) return;
        if (!entry.canRun()) { status.textContent = 'The selection changed or this command is unavailable. Close and reopen Commands to review the current target.'; return; }
        close(); const result = entry.run();
        if (result.status !== 'executed') onStatus('The command target changed. Review the current selection before trying again.');
      };
      const render = () => {
        const query = search.value.trim().toLocaleLowerCase(), matches = entries.filter(entry => (entry.label + ' ' + entry.shortcut + ' ' + entry.contexts.join(' ')).toLocaleLowerCase().includes(query));
        list.replaceChildren();
        for (const entry of matches.slice(0, 48)) {
          const row = node('div'); row.setAttribute('role', 'listitem'); const button = node('button'); button.type = 'button';
          button.dataset.commandId = entry.id; button.disabled = !entry.enabled; button.append(node('span', entry.label), node('kbd', entry.shortcut));
          button.addEventListener('keydown', event => { if (event.repeat && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); } });
          button.addEventListener('click', () => execute(entry)); row.append(button); list.append(row);
        }
        status.textContent = matches.length > 48 ? 'Showing 48 of ' + matches.length + ' matches. Refine the search.' : matches.length + ' commands. Unavailable actions stay visible.';
      };
      dismiss.addEventListener('click', () => close());
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); });
      search.addEventListener('input', render);
      search.addEventListener('keydown', event => { if (event.key !== 'Enter' || event.isComposing) return; event.preventDefault(); event.stopPropagation(); if (!event.repeat && search.value.trim()) list.querySelector('button:not(:disabled)')?.click(); });
      dialog.append(node('h2', 'Commands and shortcuts'), node('p', getScopeLabel()), search, status, list, dismiss);
      current = owned; document.body.append(dialog); render(); dialog.showModal(); search.focus(); return true;
    },
    suspend: close,
    dispose() { if (disposed) return; disposed = true; close({ restore: false }); }
  });
}
