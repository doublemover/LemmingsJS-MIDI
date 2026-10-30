import { expect } from 'chai';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createCausalTakeRecorder } from '../js/app/procgen/workstation/CausalTake.js';
import { inspectCausalTakeArchive, prepareCausalTakeArchive } from '../js/app/procgen/workstation/CausalTakeArchive.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';

const graph = { version: 1, revision: 1, instruments: [
  { id: 'crossing', sourceKind: 'MotionCommitted', gateX: 40, pitchCents: 6000,
    velocity01: 0.7, role: 'crossing', route: 'local' }
] };

describe('causal take portable archive', () => {
  it('passes preparation cancellation to verification and refuses a source returned after cancellation', async () => {
    const controller = new AbortController(); let verifiedSignal, opened = 0;
    const storage = { loadCausalTake() {}, loadCausalCheckpoint() {}, loadCausalChunk() {} };
    const journal = { async verify(_takeId, { signal }) { verifiedSignal = signal; controller.abort(); }, async openTake() { opened++; } };
    try { await prepareCausalTakeArchive({ journal, storage, takeId: 'take:cancel', signal: controller.signal }); throw new Error('Expected cancellation'); }
    catch (error) { expect(error.name).to.equal('AbortError'); }
    expect(verifiedSignal).to.equal(controller.signal); expect(opened).to.equal(0);
    const second = new AbortController(); journal.verify = async () => {}; journal.openTake = async () => { second.abort(); return { state: 'finalized' }; };
    try { await prepareCausalTakeArchive({ journal, storage, takeId: 'take:cancel', signal: second.signal }); throw new Error('Expected cancellation'); }
    catch (error) { expect(error.name).to.equal('AbortError'); }
  });
  it('streams one finalized source revision, verifies it for inspection, and rejects later byte mutation', async () => {
    const memory = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: memory.storage });
    const takeId = 'take:archive-fixture';
    const recorder = await createCausalTakeRecorder({ journal, takeId, takeName: 'Night Crossing',
      documentId: 'doc:archive-fixture', sourceVersions: { generator: 'procgen-workstation-1', worldCheckpoint: 2 },
      initialCheckpoint: { world: { version: 2, seed: 42 } }, mapping: graph, assetRefs: [] });
    recorder.recordCommittedBatch({ batch: { version: 1, worldId: 'world:archive', generation: 1,
      tick: 1, batchId: 'world:archive:1:1:0', sourceTimeMs: 20, tickDurationMs: 20,
      completeness: { status: 'complete', dropped: 0 }, facts: [] }, intents: [] });
    expect((await recorder.stop()).complete).to.equal(true);
    const { artifact } = await prepareCausalTakeArchive({ journal, storage: memory.storage, takeId });
    expect(artifact.metadata()).to.include({ formatVersion: 'lemmings-causal-take-archive/v1',
      suggestedFilename: 'Night-Crossing.causal.ndjson' });
    const lease = artifact.borrow(), pieces = [];
    for await (const piece of lease.openChunks()) pieces.push(piece);
    lease.release();
    const inspected = await inspectCausalTakeArchive(pieces);
    expect(inspected).to.include({ takeId, takeName: 'Night Crossing', complete: true, chunks: 1, checkpoints: 1 });
    expect(inspected.inspection).to.include({ paused: true, recording: false, hardware: false });
    const changed = [...pieces]; changed[2] = new TextEncoder().encode(new TextDecoder().decode(changed[2]).replace('version', 'versi0n'));
    try { await inspectCausalTakeArchive(changed); throw new Error('Expected tamper rejection.'); }
    catch (error) { expect(error.message).to.match(/checkpoint|corrupt|identity|JSON/); }
    const firstChunk = memory.chunks.values().next().value;
    firstChunk.canonical = firstChunk.canonical.replace('physical-batch', 'physical-botch');
    const retry = artifact.borrow();
    try {
      for await (const _ of retry.openChunks()) { /* A source change must fail before completion. */ }
      throw new Error('Expected changed source rejection.');
    } catch (error) { expect(error.message).to.contain('changed after archive preparation'); }
    finally { retry.release(); artifact.discard(); }
  });
});
