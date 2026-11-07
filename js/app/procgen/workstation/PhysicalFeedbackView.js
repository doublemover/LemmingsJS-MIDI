import { validatePhysicalFeedback, planPhysicalFeedback } from './physical/PhysicalFeedbackSchema.js';
export function createPhysicalFeedbackView({ document, getOwner, getGraph, getState, save, arm, disarm, mute, capture, onStatus = () => {} }) {
  let dialog = null, previousFocus = null, disposed = false;
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  const close = () => { dialog?.remove(); dialog = null; previousFocus?.focus?.({ preventScroll: true }); };
  const open = () => {
    if (disposed) return; close(); previousFocus = document.activeElement; const owner = getOwner(), graph = getGraph();
    dialog = node('dialog'); dialog.setAttribute('aria-label', 'Physical feedback and intervention layers'); dialog.style.maxWidth = 'min(95vw, 1000px)';
    const editor = node('textarea'); editor.rows = 16; editor.cols = 90; editor.maxLength = 131072; editor.setAttribute('aria-label', 'Versioned bounded conductor and layer definitions'); editor.value = JSON.stringify(graph.feedback || { version: 1, conductors: [], layers: [] }, null, 2);
    const output = node('pre'), notice = node('p'); notice.setAttribute('role', 'status');
    const button = (label, action, safe = false) => { const value = node('button', label); value.type = 'button'; value.addEventListener('click', async () => { value.disabled = true; try { if (!safe && (getOwner() !== owner || !dialog)) throw new Error('Feedback editor belongs to an earlier document.'); const result = await action(); if (dialog) notice.textContent = JSON.stringify(result); } catch (error) { if (dialog) notice.textContent = error.message; onStatus(error.message); } finally { value.disabled = false; } }); return value; };
    const read = () => { if (editor.value.length > 131072) throw new Error('Feedback authoring buffer exceeds capacity.'); return validatePhysicalFeedback(JSON.parse(editor.value), getGraph()); };
    const captureText = node('textarea'); captureText.rows = 5; captureText.cols = 90; captureText.maxLength = 16384; captureText.setAttribute('aria-label', 'Explicit capture: commandId, layerId, revision, anchor and binding'); captureText.value = JSON.stringify({ commandId: '', layerId: 'captured-layer', revision: 1, anchor: { kind: 'PickupCrossing', pickupId: '' }, binding: { version: 1, kind: 'source-actor' }, eligibilityTicks: 0 }, null, 2);
    const layerId = node('input'); layerId.setAttribute('aria-label', 'Layer ID to mute or unmute');
    dialog.append(node('h2', 'Physical feedback'), node('p', 'Observe first; explicit Arm starts a new live epoch. Rules propose canonical next-tick physical commands, never MIDI. Exact tape replay never evaluates rules. Mute cancels pending proposals only; existing bridges and skills remain. No catch-up on unmute. A saved definition never arms itself.'), editor,
      button('Plan / qualify definitions', () => { const plan = planPhysicalFeedback(read()); output.textContent = JSON.stringify(plan, null, 2); return { status: 'definition-plan-only', liveValidation: 'canonical-simulation-command-owner' }; }),
      button('Save definitions', () => save(read())), button('Arm live feedback', arm), button('Disarm / cancel pending', disarm), button('Inspect actual state', () => { output.textContent = JSON.stringify(getState(), null, 2); }), layerId,
      button('Mute layer', () => mute(layerId.value, true)), button('Unmute layer (future anchors)', () => mute(layerId.value, false)), node('h3', 'Capture an actual human command'), node('p', 'Choose an actual retained manual/controller command receipt from this generation and explicitly name its existing gate/motif anchor and target binding. Timestamp proximity is never treated as causality.'), captureText,
      button('Capture explicitly bound layer', () => { if (captureText.value.length > 16384) throw new Error('Capture input exceeds capacity.'); return capture(JSON.parse(captureText.value)); }), output, notice, button('Close', close, true));
    document.body.append(dialog); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); editor.focus();
  };
  return { open, close, dispose() { disposed = true; close(); } };
}
