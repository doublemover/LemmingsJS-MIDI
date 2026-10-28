import { canonicalDataText, cloneData, freezeData } from '../../core/CanonicalData.js';
import { generatePatchNeighborhood } from '../../midi/content/PatchNeighborhood.js';

const fail = (code, message) => Object.assign(new Error(message), { name: 'PatchVariationError', code });
const identityKey = identity => canonicalDataText(identity, { maxBytes: 16384, maxNodes: 1024, domain: 'Variation source identity' }).text;
const retire = async lease => {
  if (!lease) return;
  if (typeof lease.release !== 'function') throw fail('unknown-retirement', 'The comparison did not return an owned release boundary.');
  const receipt = await lease.release();
  const result = receipt?.completion ? await receipt.completion : receipt;
  if (result === false || result?.outcome && result.outcome !== 'complete') throw fail('unknown-retirement', 'Comparison retirement remains unresolved.');
};

export function createPatchVariationSession({ getSourceIdentity, generate = generatePatchNeighborhood, compare, keep, apply, revise,
  onChange = () => {}, maxRetainedBytes = 16 * 1048576 } = {}) {
  if (typeof getSourceIdentity !== 'function' || typeof generate !== 'function' || !Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes < 65536 || maxRetainedBytes > 64 * 1048576)
    throw new TypeError('A variation session needs a bounded source identity and generator.');
  let binding = null, generation = 0, pending = null, disposed = false, unknownRetirement = false, comparison = null, actionSerial = 0, retiring = 0;
  let rows = [], retainedBytes = 0, lastOutcome = null;
  const pins = new Map(), entries = new Map(), actions = new Set(), generations = new Set(), unresolved = new Map();
  const current = key => !disposed && !unknownRetirement && binding?.key === key && identityKey(getSourceIdentity()) === key;
  const describe = entry => freezeData({ id: entry.id, candidateId: entry.candidate?.id || null, slot: entry.slot, generation: entry.generation,
    state: entry.state, name: entry.candidate?.name || 'Candidate ' + (entry.slot + 1), pinned: pins.has(entry.id), kept: !!entry.kept, busy: entry.busy,
    sourceCurrent: current(entry.key), duplicateLike: !!entry.candidate?.duplicateLike, code: entry.code || null, reason: entry.reason || null,
    deltas: (entry.candidate?.provenance?.changes || []).slice(0, 2).map(change => ({ ...change })),
    qualification: entry.candidate?.qualification || null, compared: comparison?.entry === entry, admitted: !!entry.admission,
    reference: entry.candidate?.reference ? { packHash: entry.candidate.reference.packHash, patchId: entry.candidate.reference.patchId,
      revision: entry.candidate.reference.revision, definitionHash: entry.candidate.reference.definitionHash } : null,
    provenance: entry.candidate?.provenance || null, fork: entry.candidate?.fork || null,
    macros: (entry.candidate?.reference?.definition?.macros || []).map(macro => ({ id: macro.id, name: macro.name, default01: macro.default01,
      locked: !!entry.candidate.provenance?.locks?.macros?.includes(macro.id) || (macro.targets || []).some(target => entry.candidate.provenance?.locks?.parameters?.includes(target.parameter)) })) } );
  const snapshot = () => freezeData({ generation, parent: binding ? { identity: binding.identity, name: binding.reference.definition.name,
    revision: binding.reference.revision, packHash: binding.reference.packHash, definitionHash: binding.reference.definitionHash } : null,
  rows: rows.map(describe), pins: [...pins.values()].map(describe), generating: !!pending, retiring, retainedBytes, maxRetainedBytes,
  comparison: comparison ? { id: comparison.entry.id, candidateId: comparison.entry.candidate.id, name: comparison.entry.candidate.name, revision: comparison.entry.candidate.reference?.revision } : null,
  unknownRetirement, unresolvedLeases: unresolved.size, lastOutcome, disposed });
  const publish = () => { if (!disposed) onChange(snapshot()); };
  const collect = () => {
    for (const [id, entry] of entries) if (!rows.includes(entry) && !pins.has(id) && comparison?.entry !== entry && !entry.busy && ![...unresolved.values()].includes(entry)) {
      entries.delete(id); retainedBytes -= entry.bytes;
    }
  };
  const report = (code, message) => { lastOutcome = { code, message: String(message).slice(0, 1024) }; publish(); };
  const requireEntry = id => {
    const entry = entries.get(id);
    if (!entry?.candidate || entry.candidate.state !== 'compiled') throw fail('candidate-unavailable', 'Choose a compiled candidate.');
    return entry;
  };
  const check = entry => { if (!current(entry.key)) throw fail('changed-source', 'The document, lane, parent or reference take changed. Re-prepare before applying.'); };
  const retireOwned = async (entry, lease) => {
    try { await retire(lease); }
    catch (error) { if (lease) unresolved.set(lease, entry); unknownRetirement = true; throw error; }
  };
  const stop = async () => {
    actionSerial++;
    const previous = comparison; comparison = null;
    retiring++;
    try { await retireOwned(previous?.entry, previous?.lease); }
    catch (error) { unknownRetirement = true; report('unknown-retirement', error.message); throw error; }
    finally { retiring--; collect(); publish(); }
  };
  const cancel = () => { const operation = pending; pending = null; operation?.controller.abort(fail('canceled', 'Variation generation canceled.')); };
  const bind = async source => {
    if (disposed || unknownRetirement) throw fail('session-unavailable', 'The variation session is unavailable.');
    const identity = freezeData(cloneData(source.identity, { maxBytes: 16384, maxNodes: 1024 })), key = identityKey(identity);
    if (key !== identityKey(getSourceIdentity())) throw fail('changed-source', 'The selected variation source is already stale.');
    if (source.reference?.packHash !== source.prepared?.contentHash || identity.parentHash !== source.reference.definitionHash || identity.parentPackHash !== source.reference.packHash)
      throw fail('changed-parent', 'Variation source identity must pin the exact parent definition and pack.');
    cancel(); const serial = ++generation;
    await stop();
    if (disposed || unknownRetirement || serial !== generation || key !== identityKey(getSourceIdentity())) throw fail('changed-source', 'The variation source changed while retiring its comparison.');
    binding = { ...source, identity, key }; rows = []; collect(); publish();
  };
  const start = async options => {
    if (!binding || !current(binding.key)) throw fail('changed-source', 'Prepare an exact current parent before generating.');
    if (retiring || generations.size >= 2) throw fail('generation-busy', 'Retire earlier work before starting another bounded batch.');
    cancel();
    const source = binding, serial = ++generation, controller = new AbortController();
    const operation = { serial, controller, key: source.key, finished: null }; pending = operation; generations.add(operation);
    rows = Array.from({ length: 4 }, (_, slot) => ({ id: 'generation:' + serial + ':slot:' + slot, slot, generation: serial, key: source.key,
      state: 'pending', bytes: 0, candidate: null, busy: false }));
    for (const entry of rows) entries.set(entry.id, entry);
    collect(); publish();
    const alive = () => pending === operation && generation === serial && current(source.key) && !controller.signal.aborted;
    operation.finished = (async () => {
      try {
        const result = await generate({ ...options, prepared: source.prepared, reference: source.reference, descriptor: source.descriptor,
          count: 4, signal: controller.signal, isCurrent: alive, onCandidate: candidate => {
            if (!alive()) return;
            const entry = rows[candidate.slot];
            if (!entry || entry.generation !== serial || entry.candidate) throw fail('invalid-slot', 'The generator changed a published candidate slot.');
            let bytes;
            try { bytes = canonicalDataText(candidate, { maxBytes: maxRetainedBytes, maxNodes: 800000 }).bytes.byteLength * 2; } catch { bytes = maxRetainedBytes + 1; }
            if (retainedBytes + bytes > maxRetainedBytes) { entry.state = 'rejected'; entry.code = 'capacity'; entry.reason = 'Retained candidate capacity reached. Unpin an earlier candidate and generate again.'; }
            else { entry.candidate = freezeData(candidate); entry.state = candidate.state; entry.bytes = bytes; retainedBytes += bytes; entry.code = candidate.code; entry.reason = candidate.reason; }
            publish();
          } });
        if (!alive()) return null;
        lastOutcome = { code: 'generated', message: result.counts.compiled + ' compiled; ' + result.counts.rejected + ' generator rejections. Audio qualification is still required.' };
        return result;
      } catch (error) {
        if (alive()) { for (const entry of rows) if (entry.state === 'pending') { entry.state = 'rejected'; entry.code = error.code || 'generation-failed'; entry.reason = String(error.message).slice(0, 1024); } report(error.code || 'generation-failed', error.message); }
        if (controller.signal.aborted || !current(source.key)) return null;
        throw error;
      } finally {
        generations.delete(operation);
        if (pending === operation) { pending = null; publish(); }
      }
    })();
    return operation.finished;
  };
  const pin = id => {
    const entry = requireEntry(id);
    if (!pins.has(id) && pins.size >= 4) throw fail('pin-capacity', 'Keep at most four pinned candidates.');
    pins.set(id, entry); publish(); return describe(entry);
  };
  const unpin = id => { const removed = pins.delete(id); collect(); publish(); return removed; };
  const act = (id, kind, changes = null) => {
    const entry = requireEntry(id); check(entry);
    if (retiring || actions.size >= 4) throw fail('action-busy', 'Retire earlier variation actions before starting another.');
    if (entry.busy) throw fail('candidate-busy', 'This candidate already has a pending action.');
    const callback = { compare, keep, apply, edit: revise }[kind];
    if (typeof callback !== 'function') throw fail('capability-unavailable', 'This source cannot ' + kind + ' candidates yet.');
    if (kind === 'compare' && (!binding.identity.takeId || !Number.isSafeInteger(binding.identity.takeRevision))) throw fail('missing-reference-take', 'Select an immutable captured physical take before comparing.');
    if (kind === 'apply' && (!entry.kept || !entry.admission)) throw fail('not-admitted', 'Keep and qualify this exact candidate before applying it to the lane.');
    if (kind === 'edit' && pending) throw fail('generation-busy', 'Finish or cancel generation before creating an exact revision.');
    entry.busy = true;
    const controller = new AbortController(), token = kind === 'compare' ? ++actionSerial : actionSerial, source = binding, editGeneration = generation;
    const operation = { controller, finished: null }; actions.add(operation);
    const alive = () => current(entry.key) && !controller.signal.aborted && (kind !== 'compare' || token === actionSerial) && (kind !== 'edit' || editGeneration === generation);
    operation.finished = (async () => {
      let lease = null;
      try {
        if (kind === 'compare') { const previous = comparison; comparison = null; await retireOwned(previous?.entry, previous?.lease); }
        if (!alive()) throw fail('changed-source', 'The variation action was superseded.');
        const result = await callback({ candidate: entry.candidate, source, signal: controller.signal, isCurrent: alive,
          kept: entry.kept || null, admission: entry.admission || null, changes });
        if (kind === 'compare') lease = result;
        if (kind !== 'apply' && !alive()) throw fail('changed-source', 'The completed variation action belongs to an older source.');
        if (kind === 'compare') {
          if (!lease || typeof lease.release !== 'function') throw fail('invalid-comparison', 'Comparison requires an owned cue lease.');
          comparison = { entry, lease }; entry.admission = lease.admission || null; lease = null;
        } else if (kind === 'keep') entry.kept = result;
        else if (kind === 'edit') {
          if (result?.state !== 'compiled' || result.id === entry.candidate.id || !(result.reference?.revision > entry.candidate.reference?.revision)) throw fail('invalid-revision', 'An edit must return a distinct complete candidate revision.');
          const bytes = canonicalDataText(result, { maxBytes: maxRetainedBytes, maxNodes: 800000 }).bytes.byteLength * 2;
          if (retainedBytes + bytes > maxRetainedBytes) throw fail('capacity', 'Retained revision capacity reached. Unpin an earlier candidate before editing.');
          const nextId = 'revision:' + result.reference.patchId + '@' + result.reference.revision;
          if (entries.has(nextId)) throw fail('existing-revision', 'This exact revision is already retained.');
          if (rows.length !== 4) {
            rows = Array.from({ length: 4 }, (_, slot) => ({ id: 'generation:' + generation + ':slot:' + slot, slot, generation, key: entry.key, state: 'empty', bytes: 0, candidate: null, busy: false }));
            for (const row of rows) entries.set(row.id, row);
          }
          const next = { id: nextId, slot: entry.slot, generation, key: entry.key,
            state: 'compiled', bytes, candidate: freezeData(result), busy: false };
          rows[entry.slot] = next; entries.set(next.id, next); retainedBytes += bytes; report('edit-complete', 'Created exact revision ' + result.reference.revision + ' · ' + result.name + '.'); return describe(next);
        }
        report(kind + '-complete', kind + ' completed for ' + entry.candidate.name + '.'); return result;
      } catch (error) {
        try { await retireOwned(entry, lease); } catch (retirementError) { report('unknown-retirement', retirementError.message); throw retirementError; }
        if (error.code === 'unknown-retirement') unknownRetirement = true;
        report(error.code || kind + '-failed', error.message); throw error;
      } finally { entry.busy = false; actions.delete(operation); collect(); publish(); }
    })();
    publish(); return operation.finished;
  };
  return Object.freeze({ bind, generate: start, pin, unpin, compare: id => act(id, 'compare'), keep: id => act(id, 'keep'), apply: id => act(id, 'apply'),
    revise: (id, changes) => act(id, 'edit', changes),
    drainGeneration: () => Promise.allSettled([...generations].map(operation => operation.finished)),
    stop, cancel() { cancel(); for (const entry of rows) if (entry.state === 'pending') { entry.state = 'canceled'; entry.code = 'canceled'; } publish(); }, snapshot,
    async dispose() {
      if (disposed) return;
      disposed = true; cancel();
      for (const operation of actions) operation.controller.abort(fail('disposed', 'Variation session retired.'));
      await Promise.allSettled([...generations, ...actions].map(operation => operation.finished));
      await stop(); rows = []; pins.clear(); collect(); binding = null;
      return Object.freeze({ outcome: unknownRetirement ? 'unknown' : 'complete', unresolvedLeases: unresolved.size });
    }
  });
}
