export function createPhysicalJunctionView({ document, displayScheduler, getDefinitions, query, save, request, cancel, onStatus = () => {} }) {
  let dialog = null, surface = null, previousFocus = null, rows = new Map(), disposed = false;
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  const close = () => { surface?.dispose(); surface = null; const current = dialog; dialog = null; rows.clear(); current?.remove(); previousFocus?.focus?.({ preventScroll: true }); };
  const renderStatus = () => {
    for (const [id, row] of rows) {
      const current = query(id), pending = current?.pending || [], actual = current?.actual;
      if (!current || current.authoringRevision !== row.desiredRevision) { row.status.textContent = 'Definition update pending a simulation boundary.'; row.cancel.disabled = true; continue; }
      row.status.textContent = actual ? `${actual.configurationId} · ${actual.status}. ` : 'No applied configuration. ';
      row.status.textContent += pending.length ? pending.map(value => `${value.desiredConfiguration}: ${value.state}${value.reason ? ' (' + value.reason + ')' : ''}`).join('; ') : current?.receipts.at(-1)?.reason || 'Idle';
      row.cancel.disabled = !pending.length; row.pending = pending;
    }
  };
  const open = () => {
    if (disposed) return; close(); previousFocus = document.activeElement; dialog = node('dialog'); dialog.className = 'studio-junction-dialog'; dialog.setAttribute('aria-label', 'Physical junctions');
    const heading = node('h2', 'Physical junctions'), note = node('p', 'Requests change real geometry only at a safe future boundary. Port compatibility is not a traversal guarantee; timing remains unqualified until replayed.'), list = node('div');
    list.style.maxHeight = '40vh'; list.style.overflow = 'auto';
    for (const definition of getDefinitions()) {
      const row = node('fieldset'), title = node('legend', definition.id), select = node('select'), policy = node('select'), state = node('output'), apply = node('button', 'Request'), stop = node('button', 'Cancel pending');
      select.setAttribute('aria-label', definition.id + ' desired configuration'); policy.setAttribute('aria-label', definition.id + ' busy policy'); state.setAttribute('aria-live', 'polite');
      for (const config of definition.configurations) { const option = node('option', config.id); option.value = config.id; select.append(option); }
      for (const [value, label] of [['waitForSafeBoundary', 'Wait for safe boundary'], ['rejectIfBusy', 'Reject if busy']]) { const option = node('option', label); option.value = value; policy.append(option); }
      const value = { status: state, cancel: stop, pending: [], desiredRevision: definition.revision }; rows.set(definition.id, value);
      apply.addEventListener('click', () => { try { request(definition.id, select.value, policy.value); refresh(); } catch (error) { onStatus(error.message); } });
      stop.addEventListener('click', () => { try { for (const pending of value.pending) cancel(pending.requestId); refresh(); } catch (error) { onStatus(error.message); } });
      row.append(title, select, policy, apply, stop, state); list.append(row);
    }
    if (!rows.size) list.append(node('p', 'No authored junctions. Add validated definitions below or import a project.'));
    const author = node('details'), summary = node('summary', 'Edit bounded junction definitions (JSON)'), text = node('textarea'), commit = node('button', 'Save definitions'), exit = node('button', 'Close');
    text.value = JSON.stringify(getDefinitions(), null, 2); text.maxLength = 1048576; text.rows = 12; text.cols = 70; text.setAttribute('aria-label', 'Physical junction definitions JSON');
    commit.addEventListener('click', () => { try { if (text.value.length > 1048576) throw new Error('Junction definitions exceed the editor byte bound.'); save(JSON.parse(text.value)); onStatus('Definitions saved; their command boundary is pending.'); open(); } catch (error) { onStatus(error.message); } });
    author.append(summary, text, commit); exit.addEventListener('click', close); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.append(heading, note, list, author, exit); document.body.append(dialog);
    surface = displayScheduler?.register({ id: 'physical-junctions', element: dialog, intervalMs: 100, read: () => null, write: renderStatus, onError: onStatus });
    try { dialog.showModal(); exit.focus(); renderStatus(); } catch { close(); }
  };
  const refresh = () => { if (!dialog) return; if (surface) surface.invalidate(); else renderStatus(); };
  return { open, refresh, suspend: close, dispose() { disposed = true; close(); } };
}
