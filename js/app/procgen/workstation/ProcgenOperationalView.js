/** @typedef {{ control: HTMLButtonElement, origin: { parent: ParentNode | null, next: ChildNode | null, description: string | null, title: string, disabled: boolean }, label: string }} ControlLease */
/** @type {WeakMap<HTMLButtonElement, ControlLease>} */
const controlOwners = new WeakMap();

/** @param {import('./ProcgenOperationalContracts.js').OperationalViewOptions} options */
export function createProcgenOperationalView({ document, readSnapshot, performAction, cancelOperation = () => false, onStatus = () => {} }) {
  /** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string | null} [text] @param {string} [className] @returns {HTMLElementTagNameMap[K]} */
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };
  const element = node('section', null, 'studio-operational'); element.setAttribute('aria-label', 'World, music and output status');
  const atoms = node('div', null, 'studio-operational-atoms'), world = node('span'), music = node('span'), output = node('span'), clock = node('span'); atoms.append(world, music, output, clock);
  const message = node('output', null, 'studio-operational-message'); message.id = 'procgenOperationalMessage'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.setAttribute('aria-atomic', 'true');
  const primary = node('button'); primary.type = 'button'; primary.hidden = true;
  const details = node('details', null, 'studio-operational-details'), summary = node('summary', 'Status details'), facts = node('dl'); details.append(summary, facts);
  const controls = node('div', null, 'studio-operational-actions');
  /** @type {ControlLease[]} */
  const borrowed = [];
  for (const id of ['procgenListen', 'procgenPanic']) {
    const candidate = document.getElementById(id); if (candidate?.tagName !== 'BUTTON') continue;
    const control = /** @type {HTMLButtonElement} */ (candidate);
    const previous = controlOwners.get(control), lease = { control, origin: previous?.origin || { parent: control.parentNode, next: control.nextSibling, description: control.getAttribute('aria-describedby'), title: control.title, disabled: control.disabled }, label: previous?.label ?? control.textContent };
    borrowed.push(lease); controlOwners.set(control, lease);
    control.setAttribute('aria-describedby', [lease.origin.description, message.id].filter(Boolean).join(' ')); controls.append(control);
  }
  const operations = node('div', null, 'studio-operation-list'); operations.setAttribute('aria-label', 'Current operations');
  controls.append(primary); element.append(atoms, message, controls, operations, details);
  let disposed = false, busy = false;
  /** @type {import('./ProcgenOperationalContracts.js').OperationalSnapshot | null} */
  let snapshot = null;
  /** @param {Element} target @param {string} value */
  const write = (target, value) => { if (target.textContent !== value) target.textContent = value; };
  /** @type {Map<string, { element: HTMLDivElement, label: HTMLSpanElement, cancel: HTMLButtonElement }>} */
  const operationRows = new Map();
  /** @param {import('./ProcgenOperationalContracts.js').OperationalSnapshot} current */
  const renderOperations = current => {
    const active = current.operations || [];
    for (const [id, row] of operationRows) if (!active.some(operation => operation.id === id)) { row.element.remove(); operationRows.delete(id); }
    for (const operation of active) {
      let row = operationRows.get(operation.id);
      if (!row) {
        const item = node('div'), label = node('span'), cancel = node('button', 'Cancel operation'); cancel.type = 'button';
        item.dataset.operationId = operation.id; item.append(label, cancel); operations.append(item); row = { element: item, label, cancel }; operationRows.set(operation.id, row);
        cancel.addEventListener('click', () => {
          if (disposed) return;
          const fresh = readSnapshot(), owned = fresh?.operations?.find(value => value.id === operation.id);
          if (!owned?.cancelable) { if (fresh) render(fresh); return; }
          cancelOperation(owned.id); render(readSnapshot());
        });
      }
      row.element.dataset.phase = operation.phase; row.element.dataset.kind = operation.kind;
      row.label.setAttribute('role', operation.progressKind === 'none' ? 'status' : 'progressbar'); row.label.setAttribute('aria-label', operation.label); row.label.removeAttribute('aria-valuenow');
      write(row.label, operation.label + (operation.phase === 'committing' || operation.phase === 'finalizing' ? ' · cancellation unavailable after publication begins' : ''));
      row.cancel.hidden = !operation.cancelable; row.cancel.setAttribute('aria-label', 'Cancel ' + operation.kind + ' operation');
    }
    operations.hidden = !active.length;
  };
  const rows = new Map();
  for (const label of ['World rate', 'Musical tempo', 'Browser context', 'Note destination', 'Clock roles', 'Controller evidence', 'Bridge evidence', 'Output pressure', 'Evidence limit']) {
    const title = node('dt', label), value = node('dd'); facts.append(title, value); rows.set(label, value);
  }
  /** @param {import('./ProcgenOperationalContracts.js').OperationalActionId} id */
  const nativeAction = id => ['listen', 'activate', 'discover'].includes(id);
  const listenLease = borrowed.find(value => value.control.id === 'procgenListen');
  const ownedListen = () => listenLease && controlOwners.get(listenLease.control) === listenLease ? listenLease.control : null;
  /** @param {import('./ProcgenOperationalContracts.js').OperationalSnapshot | null} current */
  const presentOutput = current => {
    const listen = ownedListen(); if (!listen) return false;
    const action = current?.recoveryAction, native = action && nativeAction(action.id);
    write(listen, native && !busy && !['stop', 'takeover'].includes(listen.dataset.outputAction) ? action.label : listenLease.label);
    if (current) listen.disabled = current.nativeOutputActionAllowed === false;
    listen.dataset.operationalAction = native ? action.id : 'output-toggle'; return true;
  };
  /** @param {import('./ProcgenOperationalContracts.js').OperationalSnapshot | null} current */
  const render = current => {
    if (disposed) return;
    if (!current) { write(message, snapshot?.blockedReason.severity === 'error' ? snapshot.blockedReason.message + ' Status refresh is unavailable.' : 'Operational status is unavailable. Use the dedicated controls.'); primary.hidden = true; return; }
    snapshot = current; element.dataset.state = current.blockedReason.code; element.dataset.noteOutputState = current.noteOutput.state; element.dataset.worldState = current.simulation.state; element.dataset.clockState = current.clockAuthority.state; element.dataset.severity = current.blockedReason.severity;
    renderOperations(current);
    write(world, current.simulation.label); write(music, current.transport.label); write(output, current.noteOutput.label); write(clock, current.clockAuthority.label);
    write(message, current.blockedReason.message); const action = current.recoveryAction;
    presentOutput(current);
    primary.hidden = !action.enabled || nativeAction(action.id) && !!listenLease; primary.disabled = busy; primary.dataset.operationalAction = action.id; write(primary, action.label);
    const requested = current.simulation.requestedSpeed, measured = current.simulation.achievedTicksPerSecond, duration = current.simulation.tickDurationMs;
    write(rows.get('World rate'), `${requested == null ? 'Requested rate unavailable' : 'Requested ' + requested + '×'}; ${measured == null ? 'no measured tick report' :
      'last reported ' + measured.toFixed(1) + ' ticks/s' + (duration == null ? '' : ' (' + (measured * duration / 1000).toFixed(1) + '×)')}. Display refresh is not a simulation measurement.`);
    write(rows.get('Musical tempo'), `${current.transport.baseBpm ?? 'Unknown'} base BPM; ${current.transport.bpm ?? 'unknown'} effective BPM; ${current.transport.linked ? 'linked' : 'unlinked'} world timing.`);
    write(rows.get('Browser context'), current.audioContext.label + '; local engine ' + current.localBackend.state + '.');
    write(rows.get('Note destination'), current.noteOutput.label + (current.noteOutput.selectedId ? '; reviewed ID ' + current.noteOutput.selectedId : '') + (current.noteOutput.activeId ? '; activated ID ' + current.noteOutput.activeId : '') + '. Permission ' + current.noteOutput.permission + '.');
    write(rows.get('Clock roles'), `${current.clockAuthority.label}; input ${current.clockAuthority.inputId || 'none'}; output ${current.clockAuthority.outputId || 'none'}. Note routing is separate.`);
    write(rows.get('Controller evidence'), `Port ${current.controller.connected == null ? 'not selected' : current.controller.connected ? 'connected' : 'disconnected'}; liveness ${current.controller.liveness}; ${current.controller.evidence}; ${current.controller.evidenceAgeMs == null ? 'observation age unavailable' : 'observation age at report ' + current.controller.evidenceAgeMs.toFixed(0) + ' ms'}; epoch ${current.controller.connectionEpoch ?? 'unreported'}; ${current.controller.observationDomain}. A connected port is not a heartbeat.`);
    write(rows.get('Bridge evidence'), 'Bridge health ' + current.controller.bridge + '. Controller and external-clock observations remain separate.');
    write(rows.get('Output pressure'), current.pressure.throttled ? 'Thinning: ' + (current.pressure.reason || 'admitted budget') + '; ' + (current.pressure.dropped ?? 'unknown') + ' dropped.' : 'No current throttling report.');
    write(rows.get('Evidence limit'), current.evidence);
  };
  primary.addEventListener('click', async () => {
    if (disposed || busy || !snapshot) return;
    const current = readSnapshot();
    if (!current || current.identity !== snapshot.identity || current.recoveryAction.id !== snapshot.recoveryAction.id) { render(current); onStatus('Operational state changed. Review the current action before trying again.'); return; }
    const identity = current.identity; busy = true; primary.disabled = true;
    try { await performAction(current.recoveryAction.id, identity); }
    catch (error) { if (!disposed && readSnapshot()?.identity === identity) onStatus(error.message); }
    finally { busy = false; if (!disposed) render(readSnapshot()); }
  });
  return Object.freeze({ element, render,
    /** @param {string} label */
    presentOutputLabel(label) {
      if (disposed || !ownedListen() || typeof label !== 'string' || label.length > 240) return false;
      listenLease.label = label; return presentOutput(readSnapshot());
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const lease of [...borrowed].reverse()) {
        const { control, origin: { parent, next, description, title, disabled } } = lease;
        if (controlOwners.get(control) !== lease) continue; controlOwners.delete(control);
        if (description == null) control.removeAttribute('aria-describedby'); else control.setAttribute('aria-describedby', description);
        control.title = title; control.disabled = disabled; delete control.dataset.operationalAction;
        if (parent) parent.insertBefore(control, next?.parentNode === parent ? next : null);
      }
      operationRows.clear(); element.remove();
    }
  });
}
