export function createNativeMidiDeviceStateView({ document, container, getBank, getSelection, onStatus = () => {} }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Private device-state capture and restore'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls);
  const removers = [], buttons = [], bind = (node, event, handler) => { node.addEventListener(event, handler); removers.push(() => node.removeEventListener(event, handler)); };
  const field = (text, node) => { const label = element('label'); label.className = 'midi-field'; label.append(element('span', text), node); node.setAttribute('aria-label', text); controls.append(label); return node; };
  const state = field('Advertised device state', element('select')), capture = field('Private captured state', element('select'));
  const file = field('Import private device-state file', element('input')); file.type = 'file'; file.accept = '.json,application/json';
  const confirmation = field('Apply the previewed state to this exact device; all owned native outputs must be stopped', element('input')); confirmation.type = 'checkbox';
  const previewText = element('p'), status = element('output'); status.className = 'midi-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(previewText, status, element('p', 'Device states can affect every group and channel, including global settings. Captures contain private vendor data. They are held only in this connection and are omitted from project exports. Saving a private state file explicitly includes those bytes.')); container.append(root);
  let bank = null, unsubscribe = null, busy = false, disposed = false, preview = null, selection = null, operation = 0;
  const signature = () => JSON.stringify(getSelection());
  const reset = () => { preview = null; confirmation.checked = false; };
  const options = (node, rows, placeholder) => { const old = node.value, empty = element('option', placeholder); empty.value = ''; node.replaceChildren(empty); for (const [value, title] of rows) { const option = element('option', title); option.value = value; node.append(option); } if ([...node.options].some(row => row.value === old)) node.value = old; };
  const render = () => {
    if (disposed) return; const currentSelection = signature(); if (selection !== currentSelection) { selection = currentSelection; reset(); }
    const view = bank?.state(), target = getSelection(), compatible = view && view.peerMuid === target.peerMuid && view.outputGrant === target.grant;
    options(state, (view?.states || []).map(row => [row.stateId, row.title + ' · ' + row.stateId + (row.size == null ? '' : ' · ' + row.size + ' bytes')]), 'Select an advertised state');
    options(capture, (view?.captures || []).map(row => [row.captureId, row.title + ' · ' + row.byteSize + ' bytes' + (row.compatible ? '' : ' · different device identity')]), 'Select a private capture');
    for (const button of buttons) button.disabled = busy || view?.busy === true;
    captureState.disabled ||= !compatible || !state.value; review.disabled ||= !compatible || !capture.value; restore.disabled ||= !compatible || !preview || !confirmation.checked;
    save.disabled ||= !capture.value; discard.disabled ||= !capture.value; cancel.disabled = !(busy || view?.busy); file.disabled = busy || view?.busy === true;
    previewText.textContent = preview ? 'Destination: native output ' + preview.targetGrant + ', CI peer ' + preview.peerMuid + '. State “' + preview.targetTitle + '” (' + preview.stateId + '), ' + preview.byteSize + ' bytes, SHA-256 ' + preview.sha256 +
      '. Captured revision: ' + (preview.sourceStateRev || 'unknown') + '; current device revision: ' + (preview.targetStateRev || 'unknown') + '. Affected state: ' + preview.affectedState + '. Native outputs held during the write: ' + preview.affectedNativeOutputs.length + '.' : 'Review a capture against the currently selected device before restoring it.';
    status.textContent = view ? (compatible ? 'Selected device state bank' : 'Select this bank’s exact CI peer/output before capturing or restoring') + ' · ' + view.captures.length + ' private captures · ' + view.retainedBytes + ' retained bytes' +
      (view.latest ? ' · ' + view.latest.status + (view.latest.reason ? ' · ' + view.latest.reason : '') : '') : 'Read the selected CI peer’s advertised StateList to begin.';
  };
  const ensure = async () => { const owner = await getBank(); if (owner !== bank) { unsubscribe?.(); bank = owner; unsubscribe = bank.subscribe(render); reset(); } return owner; };
  const action = async callback => {
    if (disposed || busy) return; const selected = ++operation; busy = true; render();
    try { await callback(); } catch (error) { if (!disposed && selected === operation) onStatus(error.message); }
    finally { if (selected === operation) busy = false; render(); }
  };
  const button = (text, handler) => { const node = element('button', text); node.type = 'button'; buttons.push(node); controls.append(node); bind(node, 'click', () => action(handler)); return node; };
  button('Read advertised device states', async () => { reset(); const result = await (await ensure()).load(); onStatus(result.reason || 'Device states: ' + result.status); });
  const captureState = button('Capture selected state without changing hardware', async () => { reset(); const owner = await ensure(), result = await owner.capture(state.value); if (result.captureId && owner === bank) { render(); capture.value = result.captureId; } onStatus(result.reason || 'Read-only state capture: ' + result.status); });
  const review = button('Preview captured state on selected device', async () => { reset(); const owner = await ensure(), selected = signature(), result = await owner.preview(capture.value, getSelection().grant); if (!disposed && owner === bank && selected === signature()) preview = result.preview || null; onStatus(result.reason || 'State preview: ' + result.status); });
  const restore = button('Restore previewed device state', async () => {
    const owner = bank, selected = signature(), reviewed = preview, confirmed = confirmation.checked; reset();
    const result = await owner.restore(reviewed, { confirmed, isCurrent: () => !disposed && owner === bank && selected === signature() });
    onStatus(result.reason || (result.restored ? 'Device state readback matches the private capture. Rebind affected instrument routes before performing.' : 'Device state: ' + result.status + '; restoration is unverified.'));
  });
  const save = button('Save private state file with vendor data', () => {
    const snapshot = bank.exportPrivate(capture.value), url = URL.createObjectURL(new Blob([JSON.stringify(snapshot)], { type: 'application/json' })), link = element('a');
    link.href = url; link.download = 'lemmings-private-device-state-' + snapshot.stateId + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  const discard = button('Discard private capture', () => { reset(); bank?.discard(capture.value); });
  const cancel = element('button', 'Cancel state operation'); cancel.type = 'button'; buttons.push(cancel); controls.append(cancel); bind(cancel, 'click', () => { reset(); bank?.cancel(); });
  bind(file, 'change', () => action(async () => { reset(); const selected = file.files?.[0]; file.value = ''; if (!selected) return; if (selected.size > 4194304) throw new Error('Private device-state file exceeds 4 MiB'); const owner = await ensure(), result = await owner.importPrivate(JSON.parse(await selected.text())); if (result.captureId && owner === bank) { render(); capture.value = result.captureId; } onStatus(result.reason || 'Private state import: ' + result.status); }));
  for (const node of [state, capture]) bind(node, 'change', () => { reset(); render(); });
  bind(confirmation, 'change', render); bind(root, 'toggle', () => { if (!root.open) { reset(); bank?.cancel(); } render(); });
  render(); return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; operation++; unsubscribe?.(); bank?.cancel(); for (const remove of removers) remove(); root.remove(); } });
}
