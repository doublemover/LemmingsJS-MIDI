import { prepareOwnedPcmBank } from './OwnedPcmBank.js';
import { createOwnedPcmSetDescriptor } from '../resources/OwnedPcmSetVerification.js';
import { MAX_OWNED_PCM_BYTES, MAX_OWNED_PCM_BANKS } from '../../midi/content/OwnedPcmFormat.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
const failure = message => Object.assign(new Error(message), { name: 'OwnedPcmError', code: 'owned-pcm-set' });
const nowDefault = () => globalThis.performance.now();
export async function prepareOwnedPcmSet(pins, { resources, owner, generation = 0, signal, isCurrent = () => true, maxPrepareMs = 15000, now = nowDefault, yieldTask, digest } = {}) {
  if (!Array.isArray(pins) || !pins.length || pins.length > MAX_OWNED_PCM_BANKS || !resources?.reserve || typeof owner !== 'string' || !owner || !Number.isSafeInteger(generation) || generation < 0 || typeof isCurrent !== 'function' || !Number.isInteger(maxPrepareMs) || maxPrepareMs < 1 || maxPrepareMs > 60000 || typeof now !== 'function') throw failure('PCM sets require bounded source pins and resource ownership.');
  const byHash = new Map(); let total = 0;
  for (const pin of pins) {
    if (!pin?.isActive?.() || !/^[a-f0-9]{64}$/.test(pin.ref?.contentHash) || pin.ref.kind !== 'sample') throw failure('PCM set source is unavailable.');
    const previous = byHash.get(pin.ref.contentHash);
    if (previous) { if (previous.variant?.pcmHash !== pin.variant?.pcmHash || previous.ref.frames !== pin.ref.frames || previous.ref.channels !== pin.ref.channels || previous.ref.sourceSampleRate !== pin.ref.sourceSampleRate || previous.variant?.decoderVersion !== pin.variant?.decoderVersion || previous.variant?.targetSampleRate !== pin.variant?.targetSampleRate || previous.buffer !== pin.buffer) throw failure('Duplicate asset identities have conflicting decoded variants.'); continue; }
    const buffer = pin.buffer, bytes = buffer?.length * buffer?.numberOfChannels * 4;
    if (!Number.isSafeInteger(bytes) || bytes < 8 || bytes > MAX_OWNED_PCM_BYTES || ![1, 2].includes(buffer.numberOfChannels) || !Number.isInteger(buffer.sampleRate) || buffer.sampleRate < 8000 || buffer.sampleRate > 192000) throw failure('Unsupported PCM set source format.');
    total += bytes; if (total > MAX_OWNED_PCM_BYTES) throw failure('PCM set exceeds sixteen MiB across all attack and release assets.'); byHash.set(pin.ref.contentHash, pin);
  }
  const started = now(); let lastTime = started, index = null; const banks = [];
  const check = () => { signal?.throwIfAborted(); const time = now(); if (!Number.isFinite(time) || !Number.isFinite(started) || time < lastTime || time - started >= maxPrepareMs || !isCurrent()) throw failure('PCM set source, preparation clock or deadline changed.'); lastTime = time; };
  check();
  try {
    index = resources.reserve({ kind: 'owned-pcm-set-index', owner, generation, estimateBytes: 524288, consumerOwned: true });
    for (const hash of [...byHash.keys()].sort()) { check(); banks.push(await prepareOwnedPcmBank(byHash.get(hash), { resources, owner, generation, signal, now, maxPrepareMs, isCurrent: () => { check(); return true; }, ...(yieldTask ? { yieldTask } : {}), ...(digest ? { digest } : {}) })); }
    check(); const descriptor = await createOwnedPcmSetDescriptor(banks.map(bank => bank.descriptor), { signal }); check();
    const result = createSet(banks, descriptor, index, { now }); index = null; return result;
  } catch (error) {
    const receipts = [], cleanup = createProcgenRetirementScope().retire([
      ...banks.map((bank, position) => ({ name: 'pcm-bank-' + position, run: () => { const value = bank.discard(); receipts.push(value); return value; } })),
      { name: 'pcm-set-index', run: async () => { await Promise.all(receipts.map(receipt => receipt.completion)); if (receipts.some(receipt => receipt.outcome !== 'complete') || cleanup.resources.some(value => ['failed', 'unknown'].includes(value.status))) throw failure('PCM set preparation retirement is unresolved.'); if (index && index.release() !== true) throw failure('PCM set index retirement was not acknowledged.'); } }
    ]);
    await cleanup.completion; const caught = error instanceof Error ? error : failure(String(error ?? 'PCM set preparation failed.')); if (cleanup.outcome !== 'complete') { caught.retirement = cleanup; index?.retainUnknown(caught); } throw caught;
  }
}
function createSet(banks, descriptor, index, { now }) {
  let acknowledge; const quiescent = new Promise(resolve => { acknowledge = resolve; });
  const readers = new Set(), retirement = createProcgenRetirementScope(); let discarded = false, unknown = false;
  const settle = () => { if (discarded && !readers.size && !unknown) acknowledge(); };
  const state = () => Object.freeze({ discarded, unknown, banks: banks.length, readers: readers.size, bytes: descriptor.bytes, retirement: retirement.getReceipt()?.outcome || null });
  return Object.freeze({ descriptor, state,
    async copyForProcessor({ signal, isCurrent = () => true, maxCopyMs = 15000 } = {}) {
      if (discarded || unknown || readers.size >= 2 || typeof isCurrent !== 'function' || !Number.isInteger(maxCopyMs) || maxCopyMs < 1 || maxCopyMs > 60000) throw failure('PCM set copy admission is unavailable.');
      const controller = new AbortController(), started = now(); let lastTime = started, payload = null; const record = { ready: false, controller, loans: [] }, close = createProcgenRetirementScope();
      const abort = () => controller.abort(signal.reason), check = () => { signal?.throwIfAborted(); controller.signal.throwIfAborted(); const time = now(); if (!Number.isFinite(time) || !Number.isFinite(started) || time < lastTime || time - started >= maxCopyMs || discarded || unknown || !isCurrent()) throw failure('PCM set copy is stale or outside its deadline.'); lastTime = time; };
      check(); readers.add(record); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      const release = () => {
        if (close.getReceipt()) return close.getReceipt();
        const receipts = [], receipt = close.retire([
          ...record.loans.map((loan, position) => ({ name: 'pcm-input-' + position, run: () => { const value = loan.release(); receipts.push(value); return value; } })),
          { name: 'pcm-set-reader', run: async () => { await Promise.all(receipts.map(value => value.completion)); if (receipts.some(value => value.outcome !== 'complete') || close.getReceipt().resources.some(value => ['failed', 'unknown'].includes(value.status))) throw failure('PCM input retirement is unresolved.'); payload = null; readers.delete(record); signal?.removeEventListener('abort', abort); settle(); } }
        ]);
        receipt.completion.then(value => { if (value.outcome !== 'complete') { unknown = true; index.retainUnknown(failure('PCM set reader retirement is unresolved.')); } }); return receipt;
      };
      try {
        for (const bank of banks) { check(); record.loans.push(await bank.copyForProcessor({ signal: controller.signal, isCurrent: () => { check(); return true; }, maxCopyMs })); }
        check(); payload = Object.freeze({ descriptor, banks: Object.freeze(record.loans.map(loan => loan.payload)) }); record.ready = true;
        return Object.freeze({ descriptor, get payload() { signal?.throwIfAborted(); controller.signal.throwIfAborted(); if (!payload) throw failure('PCM set processor input retired.'); return payload; }, release });
      } catch (error) { const receipt = release(); await receipt.completion; const caught = error instanceof Error ? error : failure(String(error ?? 'PCM set copy failed.')); if (receipt.outcome !== 'complete') caught.retirement = receipt; if (caught.retirement?.outcome !== undefined && caught.retirement.outcome !== 'complete') { unknown = true; index.retainUnknown(caught); } throw caught; }
    },
    discard() {
      if (retirement.getReceipt()) return retirement.getReceipt(); discarded = true; settle(); for (const reader of readers) if (!reader.ready) reader.controller.abort(failure('PCM set discarded during copy.'));
      const receipts = [];
      const receipt = retirement.retire([
        ...banks.map((bank, position) => ({ name: 'pcm-bank-' + position, run: () => { const value = bank.discard(); receipts.push(value); return value; } })),
        { name: 'pcm-set-index', run: async () => { await Promise.all([...receipts.map(value => value.completion), quiescent]); if (receipts.some(value => value.outcome !== 'complete') || readers.size || unknown || retirement.getReceipt().resources.some(value => ['failed', 'unknown'].includes(value.status))) throw failure('PCM set consumer retirement is unresolved.'); if (index.release() !== true) throw failure('PCM set metadata release was not acknowledged.'); } }
      ]);
      receipt.completion.then(value => { if (value.outcome !== 'complete') { unknown = true; index.retainUnknown(failure('PCM set retirement is unresolved.')); } }); return receipt;
    }
  });
}
