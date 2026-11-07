import { getPointerGestureArbiter } from './PointerGestureArbiter.js';

const owners = new WeakMap();
export function createModalOutputSafety({ document, stop, panic, onStatus = () => {} }) {
  owners.get(document)?.dispose();
  const records = new WeakMap(), arbiter = getPointerGestureArbiter(document);
  let actions = { stop, panic, onStatus };
  let disposed = false;
  const remove = dialog => { records.get(dialog)?.remove(); records.delete(dialog); };
  const owned = () => [...document.querySelectorAll('.studio-modal-output-safety')].filter(toolbar => records.get(toolbar.parentElement) === toolbar);
  const report = message => { try { actions?.onStatus?.(message); } catch { /* Status failure cannot prevent output release. */ } };
  const mount = dialog => {
    if (disposed || dialog.tagName !== 'DIALOG' || !dialog.isConnected || records.has(dialog)) return;
    const toolbar = document.createElement('div'); toolbar.className = 'studio-modal-output-safety'; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Output safety');
    for (const [label, action, reason] of [['Stop music', 'stop', 'output-stop'], ['Panic', 'panic', 'output-panic']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.outputSafetyAction = reason;
      button.addEventListener('pointerdown', event => { if (event.button === 0) event.preventDefault(); });
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (disposed || !dialog.open || !dialog.isConnected || records.get(dialog) !== toolbar) return;
        try { arbiter.cancel(reason); } catch (error) { report('Gesture cancellation failed: ' + error.message); }
        try { actions?.[action]?.(); } catch (error) { report('Output safety action failed: ' + error.message); }
      });
      toolbar.append(button);
    }
    records.set(dialog, toolbar); dialog.prepend(toolbar);
  };
  const toggle = event => {
    if (event.target?.tagName !== 'DIALOG') return;
    if (event.newState === 'open') mount(event.target);
    else if (event.newState === 'closed') remove(event.target);
  };
  const close = event => { if (event.target?.tagName === 'DIALOG') remove(event.target); };
  document.addEventListener('beforetoggle', toggle, true); document.addEventListener('close', close, true);
  for (const dialog of document.querySelectorAll('dialog[open]')) mount(dialog);
  const api = Object.freeze({
    inspect() { return Object.freeze({ disposed, dialogs: owned().filter(toolbar => toolbar.parentElement.open).length }); },
    dispose() {
      if (disposed) return; disposed = true;
      document.removeEventListener('beforetoggle', toggle, true); document.removeEventListener('close', close, true);
      for (const toolbar of owned()) remove(toolbar.parentElement); actions = null;
      if (owners.get(document) === api) owners.delete(document);
    }
  }); owners.set(document, api); return api;
}
