import { createProcgenOperationReceipt } from './ProcgenOperationView.js';

const text = (value, length = 240) => typeof value === 'string' ? value.slice(0, length) : '';
const priority = { info: 1, warning: 2, error: 3 };
const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);

export function createProcgenNotices({ maxEntries = 32, now = () => globalThis.performance.now() } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 4 || maxEntries > 64) throw new RangeError('Invalid notice history capacity.');
  let entries = [], sequence = 0, revision = 0, dropped = 0, disposed = false, context = '';
  const publish = (input, repeated = true) => {
    if (disposed || !input || !priority[input.severity || 'info']) return null;
    const value = { message: text(input.message), code: text(input.code, 96), target: text(input.target || context, 1024),
      severity: input.severity || 'info', priority: Number.isFinite(input.priority) ? Math.max(0, Math.min(1000, input.priority)) : priority[input.severity || 'info'] * 32,
      scope: text(input.scope || 'document', 64), operationId: text(input.operationId, 128), detail: text(input.detail, 512),
      receipt: input.receipt ? createProcgenOperationReceipt(input.receipt) : null, condition: input.condition === true };
    if (!value.message) return null;
    const previous = entries.find(entry => entry.target === value.target && entry.scope === value.scope && entry.code === value.code &&
      entry.operationId === value.operationId && entry.condition === value.condition && (value.condition && value.code || entry.message === value.message));
    if (previous) {
      const changed = previous.message !== value.message || previous.severity !== value.severity || previous.priority !== value.priority || previous.detail !== value.detail || !previous.active;
      if (!previous.active) { previous.identity = text(input.identity, 1024); previous.actionId = text(input.actionId, 96); previous.actionLabel = text(input.actionLabel, 120); }
      if (changed) { previous.message = value.message; previous.severity = value.severity; previous.priority = value.priority; previous.detail = value.detail; previous.active = input.present !== false; previous.dismissed = false; }
      if (repeated) previous.count = increment(previous.count);
      if (changed || repeated) { previous.lastAt = now(); previous.lastRevision = ++revision; }
      return previous.id;
    }
    if (entries.length === maxEntries) {
      const rank = entry => entry.active && !entry.dismissed ? entry.priority : 0;
      let victim = 0;
      for (let index = 1; index < entries.length; index++) if (rank(entries[index]) < rank(entries[victim])) victim = index;
      if (rank(entries[victim]) > value.priority) { dropped = increment(dropped); revision++; return null; }
      entries.splice(victim, 1); dropped = increment(dropped);
    }
    if (sequence === Number.MAX_SAFE_INTEGER) return null;
    const entry = { ...value, id: 'notice:' + (++sequence), active: input.present !== false, dismissed: false, count: 1,
      createdRevision: Number.isSafeInteger(input.createdRevision) && input.createdRevision >= 0 ? input.createdRevision : null,
      identity: text(input.identity, 1024), actionId: text(input.actionId, 96), actionLabel: text(input.actionLabel, 120), createdAt: now(), lastAt: now(), lastRevision: revision + 1 };
    entries.push(entry); revision++; return entry.id;
  };
  const synchronize = snapshot => {
    if (disposed || !snapshot) return;
    const next = text(snapshot.documentIdentity, 1024), conditions = snapshot.conditions || [];
    if (context !== next) {
      context = next;
      for (const entry of entries) if (entry.active) { entry.active = false; revision++; }
    }
    for (const entry of entries) if (entry.condition && entry.active && !conditions.some(condition => condition.code === entry.code && condition.target === entry.target)) { entry.active = false; revision++; }
    for (const condition of conditions) publish({ ...condition, condition: true, createdRevision: snapshot.documentRevision, identity: snapshot.identity }, false);
  };
  return Object.freeze({ publish, synchronize,
    dismiss(id, dismissed = true) {
      const entry = entries.find(entry => entry.id === id);
      if (disposed || !entry || entry.dismissed === dismissed) return false;
      entry.dismissed = dismissed; revision++; return true;
    },
    snapshot() {
      const visible = entries.filter(entry => entry.active && !entry.dismissed);
      const headline = visible.reduce((best, entry) => !best || entry.priority > best.priority || entry.priority === best.priority && entry.lastRevision >= best.lastRevision ? entry : best, null);
      return Object.freeze({ revision, observedAt: now(), capacity: maxEntries, dropped, headline: headline ? Object.freeze({ ...headline }) : null,
        entries: Object.freeze(entries.map(entry => Object.freeze({ ...entry }))) });
    },
    dispose() { if (disposed) return; disposed = true; entries = []; revision++; }
  });
}
