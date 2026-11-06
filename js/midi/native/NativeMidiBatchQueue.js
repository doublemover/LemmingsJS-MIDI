import { parseWords } from '../protocol/UmpPacketCodec.js';

const failure = reason => Object.assign(new Error(reason), { notSubmitted: true });
export function createNativeMidiBatchQueue({ client, maximumWords = 65536, maximumBatches = 128, maximumJobs = 4096, maximumBytes = 8 * 1048576 } = {}) {
  const groups = new Set(), tails = new Map(), performanceChains = new Map();
  let queuedWords = 0, jobs = 0, retainedBytes = 0, flushPending = false, closed = false;
  const release = group => {
    if (group.settled) return; group.settled = true; groups.delete(group); if (tails.get(group.key) === group) tails.delete(group.key);
    queuedWords -= group.wordCount; jobs -= group.jobs.length; retainedBytes -= group.retainedBytes;
  };
  const notify = (job, row) => { try { job.onReceipt?.(Object.freeze(row)); } catch {} };
  const receiptFor = (group, job, row) => {
    if (row.kind === 'queued') return Object.freeze({ ...row, provenance: job.provenance });
    const observed = Number.isSafeInteger(row.acceptedWords), accepted = observed ? Math.min(job.words.length, Math.max(0, row.acceptedWords - job.offset)) : 0;
    const complete = observed && accepted === job.words.length;
    const failedHere = observed && row.failureWordOffset >= job.offset && row.failureWordOffset < job.offset + job.words.length;
    const unconfirmed = !!row.failedPacketUnconfirmed && (!observed || failedHere);
    let packets = 0; for (const end of job.packetEnds) if (end <= accepted) packets++;
    return Object.freeze({ ...row, session: group.session, grant: group.grant, execution: group.execution, kind: complete ? 'driver-submitted' : accepted ? 'partial' : row.kind === 'cancelled' ? 'cancelled' : 'rejected',
      acceptedWords: accepted, acceptedPackets: packets, failureWordOffset: failedHere ? row.failureWordOffset - job.offset : accepted,
      failedPacketUnconfirmed: unconfirmed, submissionExtent: !observed && unconfirmed ? 'unobserved-batch' : 'observed-prefix', provenance: job.provenance,
      nativeBatch: Object.freeze({ requestId: row.requestId ?? null, acceptedWords: observed ? row.acceptedWords : null, wordOffset: job.offset, totalWords: group.wordCount,
        failedPacketUnconfirmed: !!row.failedPacketUnconfirmed, reason: row.reason ?? null }) });
  };
  const settle = (group, row) => { if (group.settled) return; for (const job of group.jobs) job.resolve(receiptFor(group, job, row)); release(group); };
  const startGroup = async group => {
    if (group.settled || closed) { settle(group, { kind: 'cancelled', acceptedWords: 0, failedPacketUnconfirmed: false, reason: 'native-batch-owner-retired' }); return false; }
    group.started = true;
    const words = new Array(group.wordCount); let at = 0; for (const job of group.jobs) for (const word of job.words) words[at++] = word;
    const first = group.jobs[0].provenance;
    const provenance = Object.freeze({ schema: 'lemmings-native-intent-batch/v1', worldId: first.worldId, generation: first.generation, batchId: first.batchId,
      intents: group.jobs.length, receiptMapping: 'owned-browser-packet-ranges', sourceOrder: first.sourceOrder ?? null });
    let receipt;
    try { receipt = await client.sendBatch({ grant: group.grant, execution: group.execution, targetTimeMs: group.targetTimeMs, priority: group.priority, words, provenance,
      onReceipt: row => { for (const job of group.jobs) notify(job, receiptFor(group, job, row)); } }); }
    catch (error) { receipt = error.receipt || { kind: 'error', reason: error.message, failedPacketUnconfirmed: error.notSubmitted !== true }; }
    settle(group, receipt); return receipt.kind === 'driver-submitted';
  };
  const flush = () => {
    flushPending = false;
    for (const group of groups) {
      if (group.submitted || group.settled) continue; group.submitted = true; if (tails.get(group.key) === group) tails.delete(group.key);
      if (group.priority !== 1) { void startGroup(group); continue; }
      const key = [group.session, group.grant, group.execution].join(':');
      const previous = performanceChains.get(key) || Promise.resolve(true);
      const completion = previous.then(allowed => {
        if (!allowed) { settle(group, { kind: 'rejected', acceptedWords: 0, failedPacketUnconfirmed: false, reason: 'preceding-native-performance-batch-failed' }); return false; }
        return startGroup(group);
      });
      performanceChains.set(key, completion);
    }
  };
  return Object.freeze({
    enqueue({ grant, execution, targetTimeMs, priority = 1, words, provenance, onReceipt }) {
      if (closed || !Number.isSafeInteger(grant) || grant < 1 || !Number.isSafeInteger(execution) || execution < 1 || !Number.isFinite(targetTimeMs) || !Number.isInteger(priority) || priority < 0 || priority > 2) return { status: 'rejected', reason: 'native-batch-owner-unavailable' };
      let owned, metadata, packetEnds, bytes;
      try {
        if (typeof SharedArrayBuffer === 'function' && words?.buffer instanceof SharedArrayBuffer) throw failure('Shared native batch words');
        owned = Array.from(words); const packets = parseWords(owned, { maximumWords: 4096, preserveUnknown: false }); if (!packets.length) throw failure('Empty native batch');
        let offset = 0; packetEnds = packets.map(packet => offset += packet.wordCount);
        const json = JSON.stringify(provenance); if (!json || json.length > 8192) throw failure('Native causal metadata capacity'); metadata = Object.freeze(JSON.parse(json)); bytes = 512 + owned.length * 8 + json.length * 2;
      } catch (error) { return { status: 'rejected', reason: error.message }; }
      const key = JSON.stringify([client.session, grant, execution, targetTimeMs, priority, metadata.worldId, metadata.generation, metadata.batchId]);
      let group = tails.get(key); if (group && (group.wordCount + owned.length > 4096 || group.jobs.length >= 1024)) group = null;
      if (queuedWords + owned.length > maximumWords - (priority === 0 ? 0 : 4096) || jobs >= maximumJobs || retainedBytes + bytes > maximumBytes ||
          !group && groups.size >= maximumBatches - (priority === 0 ? 0 : 8)) return { status: 'rejected', reason: 'native-batch-capacity' };
      if (!group) { group = { key, session: client.session, grant, execution, targetTimeMs, priority, wordCount: 0, retainedBytes: 0, jobs: [], submitted: false, started: false, settled: false }; groups.add(group); tails.set(key, group); }
      let resolve; const completion = new Promise(done => { resolve = done; });
      group.jobs.push({ offset: group.wordCount, words: owned, packetEnds, provenance: metadata, onReceipt, resolve }); group.wordCount += owned.length; group.retainedBytes += bytes;
      queuedWords += owned.length; jobs++; retainedBytes += bytes;
      if (!flushPending) { flushPending = true; queueMicrotask(flush); }
      return Object.freeze({ status: 'accepted', stage: 'browser-owned-batch', completion });
    },
    cancelExecution(grant, execution) {
      let removedJobs = 0, removedWords = 0;
      for (const group of [...groups]) if (!group.started && group.grant === grant && group.execution === execution) {
        removedJobs += group.jobs.length; removedWords += group.wordCount;
        settle(group, { kind: 'cancelled', session: client.session, grant, execution, acceptedWords: 0, acceptedPackets: 0, failedPacketUnconfirmed: false, reason: 'cancelled-before-native-submission' });
      }
      performanceChains.delete([client.session, grant, execution].join(':'));
      return Object.freeze({ removedJobs, removedWords });
    },
    state: () => Object.freeze({ closed, pendingBatches: groups.size, pendingWords: queuedWords, pendingJobs: jobs, retainedEstimateBytes: retainedBytes }),
    dispose() { if (closed) return; closed = true; performanceChains.clear(); for (const group of [...groups]) if (!group.started) settle(group, { kind: 'cancelled', acceptedWords: 0, acceptedPackets: 0, failedPacketUnconfirmed: false, reason: 'native-batch-owner-retired' }); }
  });
}
