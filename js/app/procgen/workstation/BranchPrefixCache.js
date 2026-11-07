import { procgenSimulationExecutionPolicy } from '../ProcgenSimulationExecutionPolicy.js';
import { canonicalDataText, hashDataText, freezeData } from '../../../core/CanonicalData.js';
import { inspectProcgenCheckpoint, hashProcgenContinuationCheckpoint } from './ProcgenCheckpointProvenance.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const MiB = 1048576, digest = value => /^[a-f0-9]{64}$/.test(value), natural = value => Number.isSafeInteger(value) && value >= 0;
const error = message => Object.assign(new Error(message), { code: 'branch-prefix-cache' });
const keyOptions = { maxBytes: MiB, maxNodes: 32768, domain: 'Exact branch prefix key' };
const text = value => canonicalDataText(value, keyOptions).text;
function boundaryOf(value) {
  const world = value?.world, props = world?.graph?.owners?.find(owner => owner.name === 'world')?.props, cursor = value?.engine?.physicalCursor;
  if (inspectProcgenCheckpoint(world).continuation !== 'current-codec-continuation' || !props || !natural(props.tickIndex) || !natural(props.generation) || typeof props.worldId !== 'string' ||
      value.engine?.version !== 1 || value.engine.recoveryRequired || ![1, 2].includes(value.replay?.version) || !Number.isFinite(value.replay.bpm) || value.replay.bpm <= 0 || typeof value.replay.scoreTimeline !== 'boolean') throw error('Only complete current world and semantic continuations are cacheable.');
  procgenSimulationExecutionPolicy(value.executionPolicy);
  const boundary = { worldId: props.worldId, tick: props.tickIndex, generation: props.generation, causalSequence: world.physicalIdentity.causalSequence };
  if (boundary.tick > 0 && (cursor?.worldId !== boundary.worldId || cursor.tick !== boundary.tick || cursor.generation !== boundary.generation || cursor.lastSequence !== boundary.causalSequence && !(cursor.lastSequence === -1 && boundary.causalSequence === 0))) throw error('The musical reducer and physical checkpoint do not share one completed batch.');
  if (value.replay.scoreTimeline && boundary.tick > 0 && (value.timeline?.worldId !== boundary.worldId || value.timeline.lastTick !== boundary.tick || value.timeline.generation !== boundary.generation)) throw error('The score timeline does not share the cached completed boundary.');
  return Object.freeze(boundary);
}
function inputsOf(inputs, throughTick) {
  if (!Array.isArray(inputs) || inputs.length > 256) throw error('A cache key needs at most256 exact ordered input records.');
  let last = -1;
  return inputs.map(input => { if (!input || !natural(input.tick) || input.tick < last || input.tick > throughTick) throw error('A prefix only includes ordered inputs admitted through its completed tick.'); last = input.tick; return text(input); });
}
function identityOf(source) {
  if (source?.schema !== 'lemmings-branch-prefix-source/v1' || !digest(source.baseContinuationHash) || !digest(source.mappingHash) || !digest(source.performanceHash) ||
      !natural(source.projectRevision) || !Array.isArray(source.assetRefs) || source.assetRefs.length > 1024 || !source.sourceVersions || !source.executionIdentity || !source.policy) throw error('The prefix source must bind the complete base, assets, runtime, mapping, performance and execution policy.');
  return text(source);
}
export async function createBranchPrefixSource({ continuation, graph, performance, sourceVersions, executionIdentity, policy, projectRevision, resourceBudget } = {}) {
  const workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-prefix-source-identity', kind: 'complete-base-canonicalization-and-digest-workspace', category: 'candidate', bytes: 32 * MiB });
  try {
    boundaryOf(continuation);
    const baseContinuationHash = await hashDataText(canonicalDataText(continuation, { maxBytes: 2 * MiB, maxNodes: 262144 }).text),
      mappingHash = await hashDataText(text(graph)), performanceHash = await hashDataText(text(performance));
    const value = { schema: 'lemmings-branch-prefix-source/v1', baseContinuationHash, mappingHash, performanceHash, projectRevision,
      assetRefs: continuation.world.assets, sourceVersions, executionIdentity, policy };
    return freezeData(JSON.parse(identityOf(value)));
  } finally { workspace.release(); }
}
export function createBranchPrefixCache({ resourceBudget, maximumBytes = 8 * MiB, maximumEntries = 16, maximumEntryBytes = 2 * MiB, maximumEntryNodes = 262144, lookupDigest = hashDataText, now = () => globalThis.performance.now() } = {}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 4096 || maximumBytes > 64 * MiB || !Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 128 ||
      !Number.isSafeInteger(maximumEntryBytes) || maximumEntryBytes < 4096 || maximumEntryBytes > 8 * MiB || !Number.isSafeInteger(maximumEntryNodes) || maximumEntryNodes < 64 || maximumEntryNodes > 524288 || typeof lookupDigest !== 'function') throw error('Choose a bounded prefix cache profile.');
  const workspaceBytes = maximumBytes + maximumEntryBytes * 6 + maximumEntryNodes * 64,
    storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-branch-prefix-cache', kind: 'immutable-exact-prefixes-and-canonical-workspace', category: 'candidate', bytes: workspaceBytes }),
    entries = new Map(), buckets = new Map(), readers = new Set(), operations = new Set(), retirement = createProcgenRetirementScope({ deadlineMs: 15000 });
  let generation = 0, disposed = false, serial = 0, bytes = 0, busy = false, resolveReaders;
  const counters = { stores: 0, hits: 0, misses: 0, evictions: 0, refusals: 0, invalidations: 0, integrityFailures: 0, borrowed: 0, lookupMs: 0, restoredCheckpoints: 0, validationMs: 0 };
  const erase = id => { const entry = entries.get(id); if (!entry) return; entries.delete(id); bytes -= entry.bytes; const bucket = buckets.get(entry.bucket); bucket.delete(id); if (!bucket.size) buckets.delete(entry.bucket); };
  const run = work => {
    if (disposed || busy) return Promise.reject(error('Finish the current cache operation before another or retire its owner.'));
    busy = true; const epoch = generation;
    const check = signal => { signal?.throwIfAborted(); if (disposed || epoch !== generation) throw error('The exact-prefix operation was invalidated.'); };
    let task; task = Promise.resolve().then(() => work(check)).finally(() => { busy = false; operations.delete(task); }); operations.add(task); return task;
  };
  const state = () => Object.freeze({ schema: 'lemmings-branch-prefix-cache/v1', entries: entries.size, maximumEntries, bytes, maximumBytes, reservedBytes: workspaceBytes, readers: readers.size, maximumReaders: 2, busy, disposed, generation, ...counters,
    authority: 'exact-source-and-prefix-reuse;selected-finalist-still-needs-independent-fresh-replay', numericIdentity: 'canonical-signed-zero-and-current-checkpoint-typed-f64-sentinels;raw-nonfinite-refused', eviction: 'deterministic-least-recently-used' });
  const remember = ({ source, inputs = [], continuation, signal } = {}) => run(async check => {
    check(signal);
    let identity, inputTexts, boundary, encoded;
    try { identity = identityOf(source); boundary = boundaryOf(continuation); inputTexts = inputsOf(inputs, boundary.tick); encoded = canonicalDataText(continuation, { maxBytes: maximumEntryBytes, maxNodes: maximumEntryNodes, domain: 'Complete branch continuation' }); }
    catch (failure) { counters.refusals++; return Object.freeze({ status: 'not-cacheable', reason: failure.message }); }
    const key = text({ identity, inputs: inputTexts, boundary }), retainedBytes = encoded.bytes.byteLength * 2 + encoded.nodes * 64 + key.length * 2 + 1024;
    if (retainedBytes > maximumBytes) { counters.refusals++; return Object.freeze({ status: 'not-cacheable', reason: 'The complete physical/musical checkpoint exceeds the admitted cache profile.' }); }
    const [bucket, stateHash, worldHash] = await Promise.all([lookupDigest(identity), hashDataText(encoded.text), hashProcgenContinuationCheckpoint(continuation.world)]); check(signal);
    if (typeof bucket !== 'string' || !bucket || bucket.length > 128) throw error('The lookup accelerator returned an invalid bucket identity.');
    const prior = [...(buckets.get(bucket) || [])].find(id => entries.get(id).key === key); if (prior !== undefined) erase(prior);
    while (entries.size >= maximumEntries || bytes + retainedBytes > maximumBytes) { erase(entries.keys().next().value); counters.evictions++; }
    const entry = { id: ++serial, bucket, key, identity, inputs: inputTexts, boundary, stateText: encoded.text, stateHash, worldHash, bytes: retainedBytes };
    entries.set(entry.id, entry); if (!buckets.has(bucket)) buckets.set(bucket, new Set()); buckets.get(bucket).add(entry.id); bytes += entry.bytes; counters.stores++;
    return Object.freeze({ status: 'stored', boundary, stateHash, worldContinuationHash: worldHash, bytes: retainedBytes });
  });
  const borrow = ({ source, inputs = [], throughTick, signal } = {}) => run(async check => {
    const started = now(); check(signal);
    if (!natural(throughTick)) throw error('Choose a completed target tick for prefix lookup.');
    const identity = identityOf(source), inputTexts = inputsOf(inputs, throughTick), bucket = await lookupDigest(identity); check(signal);
    let entry = null;
    for (const id of buckets.get(bucket) || []) { const candidate = entries.get(id); if (candidate.identity !== identity || candidate.boundary.tick > throughTick || candidate.inputs.length > inputTexts.length || candidate.inputs.some((input, index) => input !== inputTexts[index]) || candidate.inputs.length < inputs.length && inputs[candidate.inputs.length].tick < candidate.boundary.tick) continue;
      if (!entry || candidate.boundary.tick > entry.boundary.tick || candidate.boundary.tick === entry.boundary.tick && candidate.id < entry.id) entry = candidate;
    }
    if (!entry || readers.size >= 2) { counters.misses++; counters.lookupMs += Math.max(0, now() - started); return null; }
    if (await hashDataText(entry.stateText) !== entry.stateHash) { erase(entry.id); counters.integrityFailures++; counters.misses++; return null; } check(signal);
    let leaseStorage;
    try { leaseStorage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-prefix-reader:' + entry.id, kind: 'independent-decoded-physical-and-musical-state', category: 'candidate', bytes: Math.max(4096, entry.bytes * 2) }); }
    catch { counters.refusals++; counters.misses++; return null; }
    try { check(signal); } catch (failure) { leaseStorage.release(); throw failure; }
    let value; try { value = JSON.parse(entry.stateText); boundaryOf(value); } catch (failure) { leaseStorage.release(); erase(entry.id); counters.integrityFailures++; counters.misses++; return null; }
    entries.delete(entry.id); entries.set(entry.id, entry); counters.hits++; counters.borrowed++; counters.lookupMs += Math.max(0, now() - started);
    let released = false, verifying = false; const lease = Object.freeze({
      read() { if (released) throw error('The independent prefix reader retired.'); return value; },
      receipt: Object.freeze({ schema: 'lemmings-branch-prefix-restore/v1', boundary: entry.boundary, appliedInputCount: entry.inputs.length, stateHash: entry.stateHash, worldContinuationHash: entry.worldHash, lookup: 'digest-accelerator-plus-complete-canonical-source-and-prefix-comparison', independentFinalistReplayRequired: true, liveOutputs: 'none' }),
      async verify(restored) {
        if (released || verifying) throw error('Use the current independent reader for one completed restore verification.'); verifying = true;
        try { return await run(async check => { const started = now(); check(signal);
          const match = await hashProcgenContinuationCheckpoint(restored.world) === entry.worldHash &&
            text(restored.engine) === text(value.engine) && text(restored.timeline) === text(value.timeline) && text(restored.replay) === text(value.replay) && text(procgenSimulationExecutionPolicy(restored.executionPolicy)) === text(procgenSimulationExecutionPolicy(value.executionPolicy));
          check(signal); counters.validationMs += Math.max(0, now() - started); if (!match) { erase(entry.id); counters.integrityFailures++; return false; } counters.restoredCheckpoints++; return true;
        }); } finally { verifying = false; }
      },
      invalidate() { erase(entry.id); counters.invalidations++; },
      release() { if (released) return false; if (verifying) throw error('Join the restore verification before releasing its reader.'); leaseStorage.release(); released = true; value = null; readers.delete(lease); if (!readers.size) { resolveReaders?.(); resolveReaders = null; } return true; }
    });
    readers.add(lease); return lease;
  });
  return Object.freeze({ state, remember, borrow,
    invalidate() { if (disposed) return false; generation++; entries.clear(); buckets.clear(); bytes = 0; counters.invalidations++; return true; },
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; generation++;
      return retirement.retire([{ name: 'exact-prefix-cache-and-readers', run: async () => { await Promise.allSettled([...operations]); if (readers.size) await new Promise(resolve => { resolveReaders = resolve; }); entries.clear(); buckets.clear(); bytes = 0; storage.release(); } }]);
    } });
}
