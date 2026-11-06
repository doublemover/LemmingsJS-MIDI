import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
const tickets = new WeakMap(); let serial = 0;
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'effect-continuation-ownership' }); };
export async function prepareOwnedEffectContinuation({ cut, definition, jobs = backgroundJobService, resourceBudget = null, signal, isCurrent = () => true, getCatalog = getNativeInstrumentCatalog } = {}) {
  const metadata = cut?.metadata?.(), components = cut?.components?.();
  if (metadata?.schema !== 'lemmings-live-effect-cut/v1' || !Array.isArray(components) || components.length > 512) fail('An owned complete live effect cut is required.');
  const byteCount = components.reduce((sum, row) => sum + (row.bytes?.length || 0), 0), inputBytes = byteCount + 8 * 1048576, peak = inputBytes * 6 + 64 * 1048576;
  if (!Number.isSafeInteger(byteCount) || byteCount > 48 * 1048576 || inputBytes > 64 * 1048576 || peak > 512 * 1048576) fail('The effect cut exceeds its bounded continuation profile.');
  const catalog = await getCatalog(); signal?.throwIfAborted();
  if (!isCurrent() || catalog.state !== 'bound-application-engines') fail('The current application engine identity is unavailable.');
  const retirement = createProcgenRetirementScope(); let job = null;
  try {
    job = await jobs.compute({ kind: 'prepare-owned-effect-cut', ownerId: 'effect-continuation:' + (++serial), ownerEpoch: 1, sourceRevision: metadata.graphHash,
      inputBytes, maxBytes: 64 * 1048576, estimatedPeakBytes: peak, deadlineMs: 60000, budgetAdapter: resourceBudget, signal, isCurrent,
      prepareInput: () => ({ definition, metadata, components }) });
    signal?.throwIfAborted(); const value = job.value;
    if (!isCurrent() || value?.schema !== 'lemmings-prepared-effect-cut/v1' || value.validation !== 'worker-restored-pinned-effect-components' || value.applicationBuildId !== catalog.executionIdentity.buildId || value.metadata.graphHash !== metadata.graphHash || value.metadata.audioFrame !== metadata.audioFrame || value.components.length !== components.length || job.receipt.method !== 'dedicated-worker') fail('Prepared effect continuation differs from its executing worker and source image.');
    const entry = { job, value, busy: false, released: false, retirement };
    const ticket = Object.freeze({ schema: 'lemmings-effect-continuation-ticket/v1', metadata: () => entry.released ? null : entry.value.metadata,
      release() { if (entry.busy) fail('The renderer exclusively owns this prepared effect image.'); if (entry.released) return false; entry.released = true; entry.value = null; return retirement.retire([{ name: 'prepared-effect-state', run: () => { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) fail('Prepared effect state retirement remains unresolved.'); } }]); } });
    tickets.set(ticket, entry); return ticket;
  } catch (error) { if (job) { const receipt = retirement.retire([{ name: 'failed-effect-preparation', run: () => { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) fail('Failed preparation retirement remains unresolved.'); } }]); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; } throw error; }
}
export function acquireOwnedEffectContinuation(ticket) {
  const entry = tickets.get(ticket); if (!entry || entry.released || entry.busy) fail('Choose an idle prepared effect continuation.'); entry.busy = true; let finished = false;
  return Object.freeze({ value: entry.value, release() { if (finished) return false; finished = true; entry.busy = false; return ticket.release(); } });
}
