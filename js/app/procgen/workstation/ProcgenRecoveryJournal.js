import { requireSynchronousResourceAcknowledgement } from '../../resources/ResourceRetirement.js';
import { validatePhysicalFeedbackState } from './physical/PhysicalFeedback.js';
const owners = new WeakMap(), snapshots = new WeakSet();
const MAX_RECORD_BYTES = 1048576, PAGE_RECORDS = 128;
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const boundary = world => Object.freeze({ worldId: world.worldId, tick: world.tickIndex, generation: world.generation, seed: world.seed,
  terrainRevision: world.terrainRevision, nextActorId: world.nextActorId, simulationTimeMs: world.simulationTimeMs,
  causalSequence: world.soundEvents.snapshotIdentity().causalSequence });

export function createProcgenRecoveryJournal(world, checkpoint, { resourceBudget = null, maxBytes = 8 * 1048576, baseToken = null, replace = null, captureStats = null } = {}) {
  if (owners.has(world) && owners.get(world) !== replace || world._stepping || !checkpoint?.graph || !Number.isSafeInteger(maxBytes) || maxBytes < 16384) throw new Error('Invalid recovery journal owner.');
  const pages = [], tokens = [], initial = boundary(world); let tail = [], tailBytes = 0, pageToken = null, bytes = 0, sequence = 0, complete = true, failure = null, disposed = false, retirementError = null;
  const fail = reason => { complete = false; failure = String(reason); };
  const append = record => {
    if (disposed || !complete) return false;
    try {
      const size = JSON.stringify(record).length * 2 + 128;
      if (size > MAX_RECORD_BYTES || bytes + size > maxBytes || sequence === Number.MAX_SAFE_INTEGER) { fail('Recovery journal capacity reached; pause to compact its checkpoint.'); return false; }
      const token = pageToken || {};
      resourceBudget?.reserve({ token, owner: 'recovery-journal', category: 'live', bytes: tailBytes + size, pinned: true, reloadable: false });
      if (!pageToken) { pageToken = token; tokens.push(token); }
      tailBytes += size;
      tail.push(Object.freeze({ ...record, sequence: ++sequence })); bytes += size;
      if (tail.length === PAGE_RECORDS) { pages.push(Object.freeze(tail)); tail = []; tailBytes = 0; pageToken = null; }
      return true;
    } catch (error) { fail(error?.message || error); return false; }
  };
  const journal = Object.freeze({
    step(eventTimeMs, speedFactor) { return append({ kind: 'step', eventTimeMs, speedFactor, boundary: boundary(world) }); },
    command(command) {
      if (world._stepping || world._disposed) { if (world._stepping && !world.soundEvents._tick) fail('A reentrant boundary command needs a new full checkpoint.'); return false; }
      return append({ kind: 'command', command: Object.freeze({ ...command, target: Object.freeze({ ...command.target }), parameters: Object.freeze({ ...command.parameters }) }) });
    },
    feedback(state) { if (world._stepping || world._disposed) { fail('Feedback recovery needs a committed boundary.'); return false; } return append({ kind: 'feedback', state: validatePhysicalFeedbackState(state) }); },
    authoring(state) { if (world._stepping || world._disposed) { fail('Reentrant authoring requires a new recovery checkpoint.'); return false; } return append({ kind: 'authoring', state }); },
    cancel(commandId, reason) { if (world._stepping || world._disposed) return false; return append({ kind: 'cancel', commandId, reason }); },
    snapshot() {
      if (disposed || world._stepping || world._failedTick || !complete) throw new Error(failure || 'Recovery is not at a complete physical boundary.');
      const snapshot = Object.freeze({ schema: 'procgen-recovery-journal/v1', initial, final: boundary(world), sequence,
        pages: Object.freeze([...pages, ...(tail.length ? [Object.freeze([...tail])] : [])]) }); snapshots.add(snapshot); return snapshot;
    },
    checkpoint: () => checkpoint,
    stats: () => ({ bytes, sequence, capture: captureStats, pages: pages.length + Number(!!tail.length), complete, failure }),
    fail,
    dispose() {
      if (retirementError) throw retirementError; if (disposed) return true; disposed = true; if (owners.get(world) === journal) owners.delete(world);
      pages.length = 0; tail = []; checkpoint = null;
      for (const token of [...tokens]) { try { requireSynchronousResourceAcknowledgement(resourceBudget?.release({ token, owner: 'recovery-journal' }), 'Recovery page storage'); tokens.splice(tokens.indexOf(token), 1); } catch (error) { failure = error.message; } }
      if (baseToken) { try { requireSynchronousResourceAcknowledgement(resourceBudget?.release({ token: baseToken, owner: 'recovery-base' }), 'Recovery base storage'); baseToken = null; } catch (error) { failure = error.message; } }
      if (tokens.length || baseToken) { retirementError = new Error(failure || 'Recovery storage retirement is unresolved.'); throw retirementError; } return true;
    }
  });
  owners.set(world, journal); return journal;
}
export const getProcgenRecoveryJournal = world => owners.get(world) || null;
export const recordProcgenRecoveryStep = (world, eventTimeMs, speedFactor) => {
  const owner = owners.get(world); if (!owner) return;
  try { owner.step(eventTimeMs, speedFactor); } catch (error) { owner.fail(error.message); }
};
export const recordProcgenRecoveryAuthoring = (world, state) => owners.get(world)?.authoring(state);
export const recordProcgenRecoveryCommand = (world, command) => owners.get(world)?.command(command);
export const recordProcgenRecoveryCancellation = (world, commandId, reason) => owners.get(world)?.cancel(commandId, reason);

export function validateProcgenRecoveryJournal(value) {
  if (snapshots.has(value)) return value;
  if (!plain(value) || value.schema !== 'procgen-recovery-journal/v1' || !Array.isArray(value.pages) || value.pages.length > 8192 ||
    !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !plain(value.initial) || !plain(value.final)) throw new Error('Invalid incremental recovery journal.');
  let sequence = 0;
  for (const page of value.pages) {
    if (!Array.isArray(page) || !page.length || page.length > PAGE_RECORDS) throw new Error('Invalid recovery page.');
    for (const record of page) {
      if (!plain(record) || record.sequence !== ++sequence || !['step', 'command', 'cancel', 'authoring', 'feedback'].includes(record.kind) || JSON.stringify(record).length * 2 > MAX_RECORD_BYTES) throw new Error('Invalid recovery record.');
      if (record.kind === 'step' && (record.eventTimeMs != null && !Number.isFinite(record.eventTimeMs) || !Number.isFinite(record.speedFactor) || record.speedFactor <= 0 || !plain(record.boundary))) throw new Error('Invalid recovery clock.');
    }
  }
  if (sequence !== value.sequence) throw new Error('Incomplete recovery journal.'); return value;
}
export async function replayProcgenRecoveryJournal(world, value, { signal, now = () => performance.now(), yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)), sliceMs = 4 } = {}) {
  validateProcgenRecoveryJournal(value);
  const same = expected => JSON.stringify(boundary(world)) === JSON.stringify(expected);
  if (!same(value.initial)) throw new Error('Recovery base does not match its journal boundary.');
  const listen = () => {}; world.soundEvents.onBatch.on(listen); let started = now();
  try {
    for (const page of value.pages) for (const record of page) {
      signal?.throwIfAborted();
      if (record.kind === 'step') {
        world.timer.speedFactor = record.speedFactor; world.step(record.eventTimeMs);
        if (!same(record.boundary)) throw new Error(`Recovery diverged at sequence ${record.sequence}.`);
      } else if (record.kind === 'feedback') { const state = validatePhysicalFeedbackState(record.state); if (state.lastTick !== world.tickIndex || state.generation !== world.generation) throw new Error('Recovery feedback boundary differs.'); world.physicalFeedback = state;
      } else if (record.kind === 'authoring') { world.configurePhysicalAuthoring(record.state.graph, record.state.instances);
      } else if (record.kind === 'command') {
        if (world.enqueueIntervention(record.command).status !== 'queued') throw new Error('Recovery command was not admitted.');
      } else if (!world.cancelIntervention(record.commandId, record.reason)) throw new Error('Recovery cancellation target is missing.');
      if (now() - started >= sliceMs) { await yieldTask(); started = now(); }
    }
    if (!same(value.final)) throw new Error('Recovery final boundary differs.'); return world;
  } finally { world.soundEvents.onBatch.off(listen); }
}

export async function validateProcgenRecoveryJournalCooperative(value, { signal, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  if (!value || !Array.isArray(value.pages) || value.pages.length > 8192) throw new Error('Invalid recovery pages.');
  validateProcgenRecoveryJournal({ ...value, pages: [], sequence: 0 });
  let count = 0;
  for (const page of value.pages) {
    signal?.throwIfAborted();
    const normalized = page.map(record => ({ ...record, sequence: record.sequence - count }));
    validateProcgenRecoveryJournal({ ...value, pages: [normalized], sequence: normalized.length });
    for (const record of page) {
      if (record.command) { Object.freeze(record.command.target); Object.freeze(record.command.parameters); Object.freeze(record.command); }
      if (record.boundary) Object.freeze(record.boundary); Object.freeze(record);
    }
    count += page.length; Object.freeze(page); await yieldTask();
  }
  if (count !== value.sequence) throw new Error('Incomplete recovery page sequence.');
  Object.freeze(value.initial); Object.freeze(value.final); Object.freeze(value.pages); Object.freeze(value); snapshots.add(value); return value;
}
