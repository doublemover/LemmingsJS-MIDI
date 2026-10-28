import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { projectCausalHistory, explainCausalVisual } from './CausalVisualProjection.js';

let nextOwner = 0;
export function createCausalVisualView({ document, stage, actions, parent, resourceBudget = null, getDocumentIdentity, read, invalidate }) {
  const layer = document.createElement('div'); layer.className = 'studio-causal-layer'; layer.setAttribute('aria-label', 'Observed past physical causes'); stage.append(layer);
  const summary = document.createElement('output'); summary.className = 'studio-causal-summary'; layer.append(summary);
  const historyButton = document.createElement('button'); historyButton.type = 'button'; historyButton.textContent = 'Cause history'; actions.append(historyButton);
  const dialog = document.createElement('dialog'); dialog.className = 'studio-dialog studio-causal-dialog'; dialog.setAttribute('aria-label', 'Physical cause explanation'); parent.append(dialog);
  const heading = document.createElement('h2'); heading.textContent = 'Observed physical cause';
  const causeSelect = document.createElement('select'); causeSelect.setAttribute('aria-label', 'Retained physical cause');
  const intentSelect = document.createElement('select'); intentSelect.setAttribute('aria-label', 'Owned intent for this cause');
  const details = document.createElement('pre'), frozenStatus = document.createElement('output');
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh retained evidence';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close cause explanation';
  dialog.append(heading, causeSelect, intentSelect, frozenStatus, details, refresh, close);
  const buttons = new Map(), listeners = [];
  let renderer = null, unsubscribe = null, disposed = false, sourceIdentity = getDocumentIdentity(), projectionRevision = null, selection = null, suppressFocus = false, reservation = null, unavailable = null;
  try { reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'causal-visual-view-' + (++nextOwner), kind: 'causal-visual-view', category: 'checkpoint', bytes: 1048576, maxBytes: 1048576 }); }
  catch { unavailable = 'Cause view storage unavailable'; historyButton.disabled = true; historyButton.title = unavailable; }
  const on = (target, name, callback) => { target.addEventListener(name, callback); listeners.push(() => target.removeEventListener(name, callback)); };
  const current = values => projectCausalHistory({ displays: values || read(), presentation: renderer?.presentation?.getSnapshot?.() || null });
  const text = (target, value) => { if (target.textContent !== value) target.textContent = value; };
  const reset = () => {
    for (const button of buttons.values()) button.remove(); buttons.clear(); layer.hidden = true; selection = null;
    suppressFocus = true; dialog.close(); suppressFocus = false; causeSelect.replaceChildren(); intentSelect.replaceChildren(); text(details, '');
  };
  const options = (target, entries, selected) => {
    target.replaceChildren(...entries.map(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }));
    if (selected != null) target.value = selected;
  };
  const showIntent = () => {
    if (disposed) return;
    if (sourceIdentity !== getDocumentIdentity()) { reset(); return; }
    const cause = current().causes.find(value => value.key === causeSelect.value), index = cause?.intents.findIndex(value => value.intentId === intentSelect.value) ?? -1;
    if (!cause || index < 0) { text(frozenStatus, 'This reference is no longer retained. The previous frozen explanation is preserved; no current actor is substituted.'); return; }
    selection = { causeKey: cause.key, intentId: cause.intents[index].intentId };
    text(frozenStatus, 'Frozen past evidence. Refresh explicitly for retained receipt changes.'); text(details, explainCausalVisual(cause, index));
  };
  const chooseCause = () => {
    if (disposed) return;
    const cause = current().causes.find(value => value.key === causeSelect.value);
    options(intentSelect, (cause?.intents || []).map(event => [event.intentId, `${event.kind} · ${event.voiceId || 'unknown voice'} · ${event.intentId.slice(0, 80)}`])); showIntent();
  };
  const open = keys => {
    if (disposed || unavailable || sourceIdentity !== getDocumentIdentity()) return;
    const model = current(), selected = keys && new Set(keys), causes = model.causes.filter(value => !selected || selected.has(value.key));
    options(causeSelect, causes.map(value => [value.key, `${value.action || value.kind || 'Unrecorded source'} · actor ${value.actorId ?? 'shared/unknown'} · tick ${value.tick ?? 'unknown'} · ${value.eventId.slice(0, 80)}`]));
    if (causes.length) chooseCause();
    else { intentSelect.replaceChildren(); selection = null; text(details, keys ? 'The selected past cause is no longer retained. It cannot be rebound to a current actor.' : 'No physical-to-musical cause is retained in the current visible-lane history.'); text(frozenStatus, 'No acoustic or receiver evidence is implied.'); }
    if (!dialog.open) dialog.showModal();
  };
  on(historyButton, 'click', () => open()); on(causeSelect, 'change', chooseCause); on(intentSelect, 'change', showIntent); on(refresh, 'click', showIntent); on(close, 'click', () => dialog.close());
  on(dialog, 'close', () => { selection = null; if (!disposed && !suppressFocus) historyButton.focus({ preventScroll: true }); });
  return Object.freeze({ historyButton, layer, dialog,
    bind(next) {
      if (renderer === next || disposed) return;
      const release = unsubscribe; unsubscribe = null; renderer = null; release?.(); layer.hidden = true; projectionRevision = null;
      renderer = next;
      if (!unavailable) unsubscribe = renderer?.presentation?.subscribe?.(snapshot => {
        if (disposed) return;
        if (!snapshot || projectionRevision !== snapshot.projectionRevision) layer.hidden = true;
        invalidate();
      }, { entities: false }) || null;
    },
    render(values) {
      if (disposed || unavailable) return;
      if (sourceIdentity !== getDocumentIdentity()) { reset(); sourceIdentity = getDocumentIdentity(); }
      const model = current(values), snapshot = renderer?.presentation?.getSnapshot?.(), stageRect = stage.getBoundingClientRect();
      projectionRevision = model.projectionRevision;
      text(historyButton, `Cause history (${model.causes.length})`);
      const s = model.summary, message = `${model.causes.length} past causes · ${s.unlocated} unlocated · ${s.outside} outside view · ${s.pending} awaiting projection · ${s.sourceMismatch} wrong source · ${s.omitted + s.historyOmitted} omitted · ${s.expired} expired`;
      text(summary, message); summary.title = message;
      const retained = new Set();
      for (const mark of model.marks) {
        retained.add(mark.key); let button = buttons.get(mark.key);
        if (!button) {
          button = document.createElement('button'); button.type = 'button'; button.className = 'studio-causal-mark';
          const identity = sourceIdentity;
          button.addEventListener('click', event => { event.stopPropagation(); if (!disposed && button.isConnected && buttons.get(mark.key) === button && identity === getDocumentIdentity()) open(button.causeKeys); });
          button.addEventListener('pointerdown', event => event.stopPropagation()); layer.append(button); buttons.set(mark.key, button);
        }
        button.causeKeys = mark.causes.map(cause => cause.key);
        const first = mark.causes[0], rejected = mark.causes.some(cause => cause.outcome === 'rejected' || cause.outcome === 'cancelled'), glyph = first.glyph + (rejected ? '×' : mark.causes.some(cause => cause.outcome === 'mixed') ? '±' : mark.causes.some(cause => cause.outcome === 'degraded') ? '!' : '');
        text(button, `${glyph}${mark.count > 1 ? '\n' + mark.count : ''}`);
        const label = `${mark.count} observed past ${mark.count === 1 ? 'cause' : 'causes'}; ${first.action || first.kind}; ${mark.causes.map(cause => cause.outcome).join(', ')}. Open exact cause evidence.`;
        button.setAttribute('aria-label', label); button.dataset.eventId = first.eventId; button.dataset.outcome = first.outcome; button.dataset.count = String(mark.count); button.dataset.projectionRevision = String(model.projectionRevision);
        button.style.left = (mark.x - stageRect.left - stage.clientLeft) + 'px'; button.style.top = (mark.y - stageRect.top - stage.clientTop) + 'px';
        const row = snapshot?.rows.find(value => value.lane === first.laneIndex);
        if (row) {
          const top = snapshot.rect.top + row.destinationY / snapshot.logicalSize.height * snapshot.rect.height, bottom = top + row.destinationHeight / snapshot.logicalSize.height * snapshot.rect.height;
          button.style.clipPath = `inset(${Math.max(0, top - (mark.y - 22))}px 0 ${Math.max(0, mark.y + 22 - bottom)}px 0)`;
        }
      }
      for (const [key, button] of buttons) if (!retained.has(key)) { if (button === document.activeElement) historyButton.focus({ preventScroll: true }); button.remove(); buttons.delete(key); }
      layer.hidden = !snapshot || !renderer.presentation.valid(snapshot);
      if (dialog.open && selection && !model.causes.some(cause => cause.key === selection.causeKey)) text(frozenStatus, 'This reference left the retained window. The frozen explanation stays available until closed.');
    },
    diagnostics: () => Object.freeze({ marks: buttons.size, projectionRevision, disposed, unavailable, reservation: reservation?.receipt() || null }),
    dispose() {
      if (disposed) { const receipt = reservation?.receipt(); if (receipt && receipt.state !== 'released') throw new Error('Cause view retirement remains unconfirmed.'); return receipt; }
      disposed = true; unsubscribe?.(); unsubscribe = null; renderer = null; reset(); for (const remove of listeners) remove(); layer.remove(); historyButton.remove(); dialog.remove(); return reservation?.release() || null;
    }
  });
}
