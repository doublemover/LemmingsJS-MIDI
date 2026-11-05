import { createProcgenNotices } from './ProcgenNotices.js';

export function createProcgenNoticeView({ document, message, readSnapshot, performAction }) {
  const owner = createProcgenNotices(), element = document.createElement('section'), details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ol');
  element.className = 'studio-notices'; element.setAttribute('aria-label', 'Project and output notices');
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.setAttribute('aria-atomic', 'true');
  list.setAttribute('aria-live', 'off'); details.append(summary, list); element.append(message, details);
  let disposed = false, rendered = -1, renderedSecond = -1;
  const rows = new Map(), write = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const render = () => {
    if (disposed) return;
    const state = owner.snapshot();
    write(message, state.headline?.message || 'Ready'); element.dataset.severity = state.headline?.severity || 'info';
    write(summary, 'Notice history (' + state.entries.length + ')' + (state.dropped ? ' · ' + state.dropped + ' messages omitted' : ''));
    const second = Math.floor(state.observedAt / 1000);
    if (!details.open || rendered === state.revision && renderedSecond === second) return;
    rendered = state.revision; renderedSecond = second;
    for (const [id, row] of rows) if (!state.entries.some(entry => entry.id === id)) { row.element.remove(); rows.delete(id); }
    for (const entry of state.entries) {
      let row = rows.get(entry.id);
      if (!row) {
        const item = document.createElement('li'), label = document.createElement('span'), action = document.createElement('button'), dismiss = document.createElement('button'), feedback = document.createElement('output'), technical = document.createElement('details'), technicalSummary = document.createElement('summary'), technicalText = document.createElement('pre');
        technicalSummary.textContent = 'Technical details'; technical.append(technicalSummary, technicalText);
        feedback.setAttribute('role', 'status'); action.type = dismiss.type = 'button'; item.dataset.noticeId = entry.id; item.append(label, action, dismiss, feedback, technical); list.append(item);
        row = { element: item, label, action, dismiss, technical, technicalText }; rows.set(entry.id, row);
        dismiss.addEventListener('click', () => { const current = owner.snapshot().entries.find(value => value.id === entry.id); if (current) { owner.dismiss(entry.id, !current.dismissed); render(); } });
        action.addEventListener('click', async () => {
          if (disposed || action.disabled) return;
          const notice = owner.snapshot().entries.find(value => value.id === entry.id), current = readSnapshot();
          if (!notice?.active || !current || notice.identity !== current.identity || !current.conditions?.some(value => value.code === notice.code && value.target === notice.target) || current.recoveryAction?.id !== notice.actionId) {
            write(feedback, 'This notice belongs to an earlier state. Review the current output or project controls.'); return;
          }
          write(feedback, ''); action.disabled = true;
          try { await performAction(notice.actionId, notice.identity); }
          catch (error) { if (!disposed && readSnapshot()?.identity === notice.identity) owner.publish({ message: error.message, severity: 'error', target: notice.target }); }
          finally { if (!disposed) { action.disabled = false; owner.synchronize(readSnapshot()); render(); } }
        });
      }
      write(row.label, `${entry.severity}: ${entry.message}${entry.count > 1 ? ' · repeated ' + entry.count + ' times' : ''} · ${Math.max(0, Math.floor((state.observedAt - entry.lastAt) / 1000))}s ago · ${entry.active ? entry.dismissed ? 'dismissed; condition retained' : entry.condition ? 'unresolved' : 'retained for review' : entry.scope === 'operation' ? 'finished operation; resource retirement reported separately' : 'resolved or earlier context'}`);
      write(row.dismiss, entry.dismissed ? 'Show notice' : 'Dismiss notice'); row.action.hidden = !entry.actionId; write(row.action, entry.actionLabel);
      row.technical.hidden = !entry.code && !entry.detail && !entry.receipt; write(row.technicalText, [entry.code, entry.receipt ? JSON.stringify(entry.receipt, null, 2) : entry.detail].filter(Boolean).join('\n'));
    }
  };
  details.addEventListener('toggle', render);
  return Object.freeze({ element,
    operation(receipt) {
      if (disposed) return;
      owner.publish({ scope: 'operation', operationId: receipt.id, code: 'operation:' + receipt.id, target: receipt.source.documentIdentity,
        message: receipt.kind + ' · ' + receipt.outcome + (receipt.accepted?.storedRevision != null ? ' · stored revision ' + receipt.accepted.storedRevision : ''),
        severity: ['failed', 'unknown', 'committed-with-error'].includes(receipt.outcome) ? 'warning' : 'info',
        createdRevision: receipt.source.editRevision, receipt, present: false }); render();
    },
    status(text, options = {}) { if (disposed) return; const current = readSnapshot(); owner.synchronize(current); owner.publish({ message: text, target: current?.documentIdentity, createdRevision: current?.documentRevision, ...options }); render(); },
    refresh(snapshot) { if (disposed) return; owner.synchronize(snapshot); render(); },
    snapshot: owner.snapshot,
    dispose() { if (disposed) return; disposed = true; owner.dispose(); rows.clear(); list.replaceChildren(); element.remove(); }
  });
}
