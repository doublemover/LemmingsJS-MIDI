export function createProjectReplacementDialog({ document, restoreDraftFocus = () => false } = {}) {
  let pending = null, disposed = false;
  const request = ({ readReview, signal, isCurrent, isSourceCurrent = isCurrent, hostDialog = null, parkHost = () => {} }) => {
    if (disposed || signal?.aborted || !isCurrent()) return Promise.resolve(null);
    pending?.finish(null);
    const dialog = hostDialog || document.createElement('dialog'), section = document.createElement('section'), heading = document.createElement('h2'), name = document.createElement('p'), reasons = document.createElement('ul'), feedback = document.createElement('output'), save = document.createElement('button'), replace = document.createElement('button'), cancel = document.createElement('button');
    const previousFocus = document.activeElement, hidden = new Map(), releases = [];
    let plan = readReview(); const documentIdentity = plan.documentIdentity; heading.textContent = 'Replace current project?'; feedback.setAttribute('role', 'status');
    save.type = replace.type = cancel.type = 'button'; save.textContent = 'Save project, then replace'; cancel.textContent = 'Cancel replacement'; section.className = 'studio-replacement-review'; section.setAttribute('aria-label', 'Review project replacement'); section.append(heading, name, reasons, feedback, save, replace, cancel);
    if (hostDialog) {
      for (const child of dialog.children) if (!child.classList.contains('studio-modal-output-safety')) { hidden.set(child, { hidden: child.hidden, inert: child.inert }); child.hidden = true; child.inert = true; }
    } else { dialog.className = 'studio-dialog studio-replacement-dialog'; dialog.setAttribute('aria-label', 'Review project replacement'); (document.fullscreenElement || document.body).append(dialog); }
    dialog.append(section);
    const on = (target, type, listener) => { target?.addEventListener(type, listener); releases.push(() => target?.removeEventListener(type, listener)); };
    let displayedIdentity = null;
    const render = (display = plan) => {
      if (displayedIdentity === display.identity) return; displayedIdentity = display.identity;
      name.textContent = display.name; reasons.replaceChildren();
      for (const reason of display.reasons) { const item = document.createElement('li'); item.textContent = reason; reasons.append(item); }
      replace.textContent = display.replaceLabel; replace.disabled = !display.canReplace; save.hidden = !display.canSave;
    };
    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return; const restoreFocus = !result && !disposed && isCurrent(); settled = true;
        if (pending?.section === section) pending = null;
        for (const release of releases) release(); section.remove();
        for (const [child, previous] of hidden) if (child.parentNode === dialog) { child.hidden = previous.hidden; child.inert = previous.inert; }
        if (!hostDialog) { try { if (dialog.open) dialog.close(); } finally { dialog.remove(); } }
        else if (result?.action === 'save') parkHost();
        resolve(result);
        if (restoreFocus) queueMicrotask(() => {
          if (disposed || !isSourceCurrent() || document.querySelector('dialog[open]')) return;
          if (restoreDraftFocus(documentIdentity)) return;
          const menu = previousFocus?.closest?.('.studio-command-menu:not([open])'), target = menu?.querySelector(':scope > summary') || previousFocus;
          if (target?.isConnected) target.focus?.({ preventScroll: true });
        });
      };
      pending = { section, finish, refresh() {
        if (disposed || signal?.aborted || !isCurrent()) { finish(null); return; }
        let current; try { current = readReview(); } catch { finish(null); return; }
        if (current.identity !== displayedIdentity) { render(current); if (feedback.textContent !== 'This project changed during review. Review the current details, then choose again.') feedback.textContent = 'This project changed during review. Review the current details, then choose again.'; }
      } };
      const choose = action => {
        if (disposed || signal?.aborted || !isCurrent()) { finish(null); return; }
        let current; try { current = readReview(); } catch { finish(null); return; }
        if (current.identity !== plan.identity) { plan = current; render(); feedback.textContent = 'This project changed during review. Review the current details, then choose again.'; return; }
        if (action === 'save' ? !plan.canSave : !plan.canReplace) return;
        finish(Object.freeze({ action, identity: plan.identity, finalizeTake: plan.finalizeTake }));
      };
      on(save, 'click', () => choose('save')); on(replace, 'click', () => choose('replace')); on(cancel, 'click', () => finish(null));
      on(dialog, 'cancel', event => { event.preventDefault(); finish(null); }); on(dialog, 'close', () => finish(null)); on(signal, 'abort', () => finish(null));
      render();
      try { if (!hostDialog) dialog.showModal(); cancel.focus(); } catch { finish(null); }
    });
  };
  return Object.freeze({ request, owns: dialog => pending?.section.parentNode === dialog, refresh() { pending?.refresh(); }, dispose() { if (disposed) return; disposed = true; pending?.finish(null); } });
}
