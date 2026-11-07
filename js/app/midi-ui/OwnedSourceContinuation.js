import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
const tickets = new WeakMap(); let nextOwner = 0;
const failure = code => Object.assign(new Error('Source continuation: ' + code), { code });
export async function prepareOwnedSourceContinuation({ cut, reference: rawReference, pcm = null, jobs = backgroundJobService, resourceBudget = null, signal = null,
  getCatalog = getNativeInstrumentCatalog, isCurrent = () => true } = {}) {
  const reference = validateSoundContentReference(rawReference), metadata = cut?.metadata?.(), bytes = cut?.bytes?.();
  if (!reference || !metadata || !(bytes instanceof Uint8Array) || metadata.cut?.patchDefinitionHash !== reference.definitionHash || metadata.cut?.engineArtifactHash !== reference.engineRequirement.artifactHash) throw failure('pinned-source-cut-required');
  const catalog = await getCatalog(); signal?.throwIfAborted();
  if (!isCurrent() || catalog.state !== 'bound-application-engines' || !catalog.descriptors.some(descriptor => ['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => descriptor[key] === reference.engineRequirement[key]))) throw failure('source-runtime-unavailable');
  const pcmBytes = pcm?.descriptor?.bytes || pcm?.descriptor?.decodedBytes || 0, inputBytes = bytes.length + Math.max(0, pcmBytes) + 4 * 1048576;
  if (!Number.isSafeInteger(inputBytes) || inputBytes > 64 * 1048576) throw failure('source-input-capacity');
  const owner = 'source-continuation-' + (++nextOwner), retirement = createProcgenRetirementScope(); let job = null;
  try {
    job = await jobs.compute({ kind: 'prepare-owned-source-cut', ownerId: owner, ownerEpoch: 1, sourceRevision: reference.packHash + ':' + reference.definitionHash,
      inputBytes, maxBytes: 64 * 1048576, estimatedPeakBytes: Math.min(256 * 1048576, inputBytes * 3 + 64 * 1048576), deadlineMs: 60000, budgetAdapter: resourceBudget, signal, isCurrent,
      prepareInput: () => ({ definition: reference.definition, engineRequirement: reference.engineRequirement, metadata, bytes, pcm }) });
    signal?.throwIfAborted();
    const value = job.value;
    if (!isCurrent() || value?.schema !== 'lemmings-prepared-source-cut/v1' || value.validation !== 'worker-restored-exact-pinned-kernel' || value.applicationBuildId !== catalog.executionIdentity.buildId ||
        !(value.bytes instanceof Uint8Array) || value.bytes.byteLength !== bytes.byteLength || value.metadata.cut.patchDefinitionHash !== reference.definitionHash || value.metadata.cut.engineArtifactHash !== reference.engineRequirement.artifactHash) throw failure('prepared-source-cut-mismatch');
    const entry = { job, value, reference, busy: false, released: false, retirement }, ticket = Object.freeze({ schema: 'lemmings-source-continuation-ticket/v1', metadata: () => entry.released ? null : entry.value.metadata,
      release() { if (entry.busy) throw failure('continuation-buffer-owned-by-renderer'); if (entry.released) return false; entry.released = true; entry.value = null; const receipt = retirement.retire([{ name: 'prepared-source-result', run: () => { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw failure('continuation-result-retirement-unresolved'); } }]); return receipt; } });
    tickets.set(ticket, entry); return ticket;
  } catch (error) { if (job) { const receipt = retirement.retire([{ name: 'failed-preparation', run: () => { job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw failure('continuation-result-retirement-unresolved'); } }]); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; } throw error; }
}
export function acquireOwnedSourceContinuation(ticket) {
  const entry = tickets.get(ticket); if (!entry || entry.released || entry.busy) throw failure('current-prepared-continuation-required'); entry.busy = true;
  let finished = false;
  return Object.freeze({ value: entry.value, reference: entry.reference,
    release() { if (finished) return false; finished = true; entry.busy = false; return ticket.release(); } });
}
