export function createProjectNameDialog({ document, window } = {}) {
  let pending = null, disposed = false;
  const request = ({ value = '', title = 'Project name' } = {}) => {
    if (disposed) return Promise.resolve(null); pending?.finish(null);
    const previousFocus = document.activeElement, dialog = document.createElement('dialog'), form = document.createElement('form');
    const label = document.createElement('label'), input = document.createElement('input'), error = document.createElement('output');
    const save = document.createElement('button'), cancel = document.createElement('button');
    dialog.className = 'studio-name-dialog'; dialog.setAttribute('aria-label', title); label.textContent = title;
    input.type = 'text'; input.value = String(value); input.maxLength = 120; input.setAttribute('aria-label', title);
    error.setAttribute('aria-live', 'polite'); save.type = 'submit'; save.textContent = 'Save'; cancel.type = 'button'; cancel.textContent = 'Cancel';
    label.append(input); form.append(label, error, save, cancel); dialog.append(form); document.body.append(dialog);
    return new Promise(resolve => {
      let done = false;
      const finish = result => { if (done) return; done = true; if (pending?.dialog === dialog) pending = null;
        try { dialog.close?.(); } finally { dialog.remove(); if (previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true }); resolve(result); } };
      pending = { dialog, finish };
      form.addEventListener('submit', event => {
        event.preventDefault(); const name = input.value.trim();
        if (!name || name.length > 120) { error.textContent = 'Enter a project name (1–120 characters).'; input.setAttribute('aria-invalid', 'true'); input.focus?.(); return; }
        finish(name);
      });
      input.addEventListener('input', () => { error.textContent = ''; input.removeAttribute?.('aria-invalid'); });
      cancel.addEventListener('click', () => finish(null)); dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); }); dialog.addEventListener('close', () => finish(null));
      try { dialog.showModal(); input.focus?.(); input.select?.(); } catch { finish(null); }
    });
  };
  return Object.freeze({ request, dispose() { if (disposed) return; disposed = true; pending?.finish(null); } });
}
