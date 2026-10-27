export function createProcgenOperationalView({ document, readSnapshot, performAction, onStatus = () => {} }) {
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };
  const element = node('section', null, 'studio-operational'); element.setAttribute('aria-label', 'World, music and output status');
  const atoms = node('div', null, 'studio-operational-atoms'), world = node('span'), music = node('span'), output = node('span'), clock = node('span'); atoms.append(world, music, output, clock);
  const message = node('output', null, 'studio-operational-message'); message.id = 'procgenOperationalMessage'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.setAttribute('aria-atomic', 'true');
  const primary = node('button'); primary.type = 'button'; primary.hidden = true;
  const details = node('details', null, 'studio-operational-details'), summary = node('summary', 'Status details'), facts = node('dl'); details.append(summary, facts);
  const controls = node('div', null, 'studio-operational-actions'), borrowed = [];
  for (const id of ['procgenListen', 'procgenPanic']) {
    const control = document.getElementById(id); if (!control) continue;
    borrowed.push({ control, parent: control.parentNode, next: control.nextSibling, description: control.getAttribute('aria-describedby'), title: control.title, disabled: control.disabled });
    control.setAttribute('aria-describedby', [control.getAttribute('aria-describedby'), message.id].filter(Boolean).join(' ')); controls.append(control);
  }
  controls.append(primary); element.append(atoms, message, controls, details);
  let disposed = false, snapshot = null, busy = false;
  const write = (target, value) => { if (target.textContent !== value) target.textContent = value; };
  const rows = new Map();
  for (const label of ['World rate', 'Musical tempo', 'Browser context', 'Note destination', 'Clock roles', 'Controller evidence', 'Bridge evidence', 'Output pressure', 'Evidence limit']) {
    const title = node('dt', label), value = node('dd'); facts.append(title, value); rows.set(label, value);
  }
  const nativeAction = id => ['listen', 'activate', 'discover'].includes(id);
  const render = current => {
    if (disposed) return;
    if (!current) { write(message, snapshot?.blockedReason.severity === 'error' ? snapshot.blockedReason.message + ' Status refresh is unavailable.' : 'Operational status is unavailable. Use the dedicated controls.'); primary.hidden = true; return; }
    snapshot = current; element.dataset.state = current.blockedReason.code; element.dataset.noteOutputState = current.noteOutput.state; element.dataset.worldState = current.simulation.state; element.dataset.clockState = current.clockAuthority.state; element.dataset.severity = current.blockedReason.severity;
    write(world, current.simulation.label); write(music, current.transport.label); write(output, current.noteOutput.label); write(clock, current.clockAuthority.label);
    write(message, current.blockedReason.message); const action = current.recoveryAction;
    const listen = borrowed.find(value => value.control.id === 'procgenListen')?.control;
    if (nativeAction(action.id) && listen && !busy) write(listen, action.label);
    primary.hidden = !action.enabled || nativeAction(action.id) && !!listen; primary.disabled = busy; primary.dataset.operationalAction = action.id; write(primary, action.label);
    if (listen) listen.disabled = current.nativeOutputActionAllowed === false;
    if (listen) listen.dataset.operationalAction = nativeAction(action.id) ? action.id : 'output-toggle';
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
    dispose() {
      if (disposed) return; disposed = true;
      for (const { control, parent, next, description, title, disabled } of borrowed) {
        if (description == null) control.removeAttribute('aria-describedby'); else control.setAttribute('aria-describedby', description);
        control.title = title; control.disabled = disabled; delete control.dataset.operationalAction;
        if (parent) parent.insertBefore(control, next?.parentNode === parent ? next : null);
      }
      element.remove();
    }
  });
}
