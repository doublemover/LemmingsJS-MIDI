import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SurveyEvidenceStore, SurveyStorageLimitError } from '../scripts/procgen-survey/SurveyEvidenceStore.js';
import { normalizeSurveyResources } from '../scripts/procgen-survey/SurveyWorkerPool.js';

describe('bounded procgen survey evidence', function() {
  let directory, store;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-survey-test-')); store = await new SurveyEvidenceStore(directory, { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' }); });
  afterEach(async () => { const resolved = path.resolve(directory); if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('lemmings-survey-test-')) throw new Error('Unsafe test cleanup target'); await fs.rm(resolved, { recursive: true, force: true }); });
  const result = (status = 'completed') => ({ trialId: 'same-world-policy', status, lastTick: 100, initialStateHash: 'start', finalStateHash: 'end', eventHash: 'events', accounting: { designated: 8, arrived: 8, alive: 8, deaths: 0 } });
  it('keeps original success and failed verification immutable beside normal context', async () => {
    const original = result(); await store.commitResult(original, { id: 'first' });
    await store.exemplar({ kind: 'remarkable-success', reason: 'paired improvement' }, original, { scenario: 'exact', candidate: 'exact' }, [{ status: 'failed', candidateId: 'baseline' }, { status: 'completed', candidateId: 'normal' }]);
    await store.writeImmutable('verification/negative.json', { originalTrialId: original.trialId, status: 'failed' });
    const restored = await new SurveyEvidenceStore(directory).initialize({ id: 'frozen', code: 'sha' });
    expect(await restored.completed(original.trialId)).to.deep.equal(original);
    const success = await restored.read('exemplars/' + original.trialId + '.json'); expect(success.context).to.have.length(2); expect(success.original).to.deep.equal(original);
    expect((await restored.read('verification/negative.json')).status).to.equal('failed');
    try { await restored.exemplar({ kind: 'remarkable-success', reason: 'replace with lucky rerun' }, { ...original, finalStateHash: 'different' }, {}, []); throw new Error('unexpected overwrite'); } catch (error) { expect(error.message).to.include('Conflicting immutable'); }
    expect((await restored.read('exemplars/' + original.trialId + '.json')).original).to.deep.equal(original);
  });
  it('skips verified episodes and detects disagreeing duplicate attempts', async () => {
    await store.commitResult(result(), { id: 'a' }); await store.commitResult(result(), { id: 'b', performance: { elapsedMs: 500 } });
    try { await store.commitResult({ ...result(), finalStateHash: 'diverged' }, { id: 'c' }); throw new Error('unexpected acceptance'); } catch (error) { expect(error.message).to.include('Determinism defect'); }
    expect((await store.completed(result().trialId)).finalStateHash).to.equal('end');
  });
  it('records cancellation without allowing it to become a completed resume result', async () => {
    await store.commitResult(result('cancelled'), { id: 'cancelled' }); expect(await store.completed(result().trialId)).to.equal(null);
    await store.commitResult(result(), { id: 'replayed' }); expect((await store.completed(result().trialId)).status).to.equal('completed');
    expect((await store.read('attempts/' + result().trialId + '-cancelled.json')).result.status).to.equal('cancelled');
  });
  it('stops at the storage cap while retaining pinned originals and reports corrupt receipts', async () => {
    await store.commitResult(result(), { id: 'a' });
    try { await store.writeImmutable('verification/too-large.json', { trace: 'x'.repeat(32768) }); throw new Error('unexpected admission'); } catch (error) { expect(error).to.be.instanceOf(SurveyStorageLimitError); }
    expect((await store.completed(result().trialId)).finalStateHash).to.equal('end'); expect(await store.read('verification/too-large.json')).to.equal(null);
    const file = path.join(directory, 'results', result().trialId + '.json'); const receipt = JSON.parse(await fs.readFile(file, 'utf8')); receipt.value.finalStateHash = 'corrupt'; await fs.writeFile(file, JSON.stringify(receipt));
    try { await store.completed(result().trialId); throw new Error('unexpected read'); } catch (error) { expect(error.message).to.include('checksum mismatch'); }
  });
  it('counts replacement report bytes and rejects nonfinite storage caps', async () => {
    for (const maxBytes of [NaN, Infinity, 0, 32768.5]) expect(() => new SurveyEvidenceStore(directory, { maxBytes })).to.throw(RangeError);
    await store.writeDerivative('report.json', { data: 'x'.repeat(1000) }); const firstBytes = store.snapshot().bytes;
    await store.writeDerivative('report.json', { data: 'x'.repeat(10) }); expect(store.snapshot().bytes).to.equal(firstBytes - 990);
    try { await store.writeDerivative('report.json', { data: 'x'.repeat(32768) }); throw new Error('unexpected report write'); } catch (error) { expect(error).to.be.instanceOf(SurveyStorageLimitError); }
    expect((await store.read('report.json')).data.length).to.equal(10);
  });
  it('separates logical/resident counts from the small CPU worker pool and rejects impossible resources', () => {
    const bounds = normalizeSurveyResources({ residentWorlds: 64, executionWorkers: 1 }); expect(bounds.residentWorlds).to.equal(64); expect(bounds.executionWorkers).to.equal(1);
    for (const patch of [{ executionWorkers: 16 }, { residentWorlds: 65 }, { sliceTicks: 0 }, { maxTotalTicks: Infinity }]) expect(() => normalizeSurveyResources(patch)).to.throw(RangeError);
    expect(() => store._file('../outside.json')).to.throw('Invalid survey evidence path');
  });
});
