import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SurveyEvidenceStore, SurveyStorageLimitError, SurveyImmutableConflictError, SurveyOutcomeConflictError, SurveyEvidenceIntegrityError, SurveyManifestRecoveryError } from '../scripts/procgen-survey/SurveyEvidenceStore.js';
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
  it('publishes equivalent concurrent attempts under one owner while preserving the first complete original', async () => {
    const contender = await new SurveyEvidenceStore(directory, { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' });
    const outcomes = await Promise.all([store.commitResult({ ...result(), capture: 'first' }, { id: 'one' }, { withReceipt: true }),
      contender.commitResult({ ...result(), capture: 'second' }, { id: 'two' }, { withReceipt: true })]);
    const original = await store.completed(result().trialId);
    expect(outcomes[0].result).to.deep.equal(original); expect(outcomes[1].result).to.deep.equal(original);
    expect(outcomes.every(outcome => outcome.publication.status === 'original-and-attempt-published')).to.equal(true);
    expect(outcomes[0].publication.originalChecksum).to.equal(outcomes[1].publication.originalChecksum);
    expect(outcomes[0].publication.attemptChecksum).not.to.equal(outcomes[1].publication.attemptChecksum);
    expect(await fs.readdir(path.join(directory, 'attempts'))).to.have.length(2); expect(await fs.readdir(path.join(directory, 'conflicts'))).to.deep.equal([]);
  });
  it('preserves a complete attempt after result publication fails and recovers without recomputing it', async () => {
    const write = fs.writeFile; fs.writeFile = async (file, ...args) => {
      if (String(file).startsWith(path.join(directory, 'results', result().trialId + '.json.'))) { const error = new Error('disk full before result publication'); error.code = 'ENOSPC'; throw error; }
      return write(file, ...args);
    };
    try { await store.commitResult(result(), { id: 'recoverable' }); throw new Error('unexpected result publication'); }
    catch (error) { expect(error.code).to.equal('ENOSPC'); } finally { fs.writeFile = write; }
    expect(await store.completed(result().trialId)).to.equal(null);
    const retained = await store.read('attempts/' + result().trialId + '-recoverable.json'); expect(retained.result).to.deep.equal(result());
    const recovered = await store.recoverCompleted(result().trialId);
    expect(recovered).to.include({ status: 'recovered-from-complete-attempt', attemptReference: 'attempts/' + result().trialId + '-recoverable.json' });
    expect(recovered.result).to.deep.equal(result()); expect(await store.completed(result().trialId)).to.deep.equal(result());
    expect((await store.recoverCompleted(result().trialId)).status).to.equal('already-published');
  });
  it('keeps conflicting complete attempts for inspection and refuses to choose one during recovery', async () => {
    await store.writeImmutable('attempts/' + result().trialId + '-one.json', { result: { ...result(), crew: [{ id: 'actor', x: 10 }] }, attempt: { id: 'one' } });
    await store.writeImmutable('attempts/' + result().trialId + '-two.json', { result: { ...result(), crew: [{ id: 'actor', x: 11 }] }, attempt: { id: 'two' } });
    let failure; try { await store.recoverCompleted(result().trialId); } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(SurveyOutcomeConflictError); expect(failure.kind).to.equal('determinism-defect');
    expect(failure.originalReference).to.include('attempts/'); expect(failure.attemptedReference).to.include('attempts/');
    expect(await store.completed(result().trialId)).to.equal(null); expect(await fs.readdir(path.join(directory, 'attempts'))).to.have.length(2);
  });
  it('distinguishes another trial whose retained-attempt filename shares the requested prefix', async () => {
    const other = { ...result(), trialId: result().trialId + '-other' };
    await store.writeImmutable('attempts/' + other.trialId + '-one.json', { result: other, attempt: { id: 'one' } });
    expect((await store.recoverCompleted(result().trialId)).status).to.equal('no-complete-attempt');
    expect((await store.recoverCompleted(other.trialId)).result).to.deep.equal(other);
  });
  it('retains explicit incomplete and unsupported attempts without turning them into scored resume originals', async () => {
    for (const [index, status] of ['completed', 'unsupported', 'interrupted'].entries()) await store.commitResult({ ...result(status), schemaVersion: 1, episodeComplete: false }, { id: 'incomplete-' + index });
    expect(await store.completed(result().trialId)).to.equal(null); expect((await store.recoverCompleted(result().trialId)).status).to.equal('no-complete-attempt');
    expect(await fs.readdir(path.join(directory, 'attempts'))).to.have.length(3);
    for (const attempt of [{}, { id: '../escape' }, { id: 'a/b' }]) {
      let error; try { await store.commitResult(result(), attempt); } catch (failure) { error = failure; }
      expect(error).to.be.instanceOf(TypeError);
    }
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
    await store.writeDerivative('report.json', { data: 'x'.repeat(10) }, { expectedGeneration: 0 }); expect(store.snapshot().bytes).to.equal(firstBytes - 990);
    try { await store.writeDerivative('report.json', { data: 'x'.repeat(32768) }, { expectedGeneration: 1 }); throw new Error('unexpected report write'); } catch (error) { expect(error).to.be.instanceOf(SurveyStorageLimitError); }
    expect((await store.read('report.json')).data.length).to.equal(10);
  });
  it('publishes one immutable value across independent stores and reconciles repeated initialization', async () => {
    const second = await new SurveyEvidenceStore(directory, { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' });
    const before = store.snapshot().bytes;
    await store.initialize({ id: 'frozen', code: 'sha' }); expect(store.snapshot().bytes).to.equal(before);
    const attempts = await Promise.allSettled([store.writeImmutable('results/race.json', { writer: 'A' }), second.writeImmutable('results/race.json', { writer: 'B' })]);
    expect(attempts.filter(entry => entry.status === 'fulfilled')).to.have.length(1);
    expect(attempts.filter(entry => entry.status === 'rejected')[0].reason.message).to.include('Conflicting immutable');
    const retained = await store.read('results/race.json'); expect(['A', 'B']).to.include(retained.writer);
    expect((await fs.readdir(path.join(directory, 'results')))).to.deep.equal(['race.json']);
    expect(await second.writeImmutable('results/race.json', retained)).to.deep.equal(retained);
  });
  it('rejects a stale report generation after another store publishes a newer summary', async () => {
    const second = await new SurveyEvidenceStore(directory, { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' });
    const generation = await second.derivativeGeneration('report.json'); expect(generation).to.equal(null);
    await store.writeDerivative('report.json', { version: 1 }, { expectedGeneration: generation });
    expect(await second.derivativeGeneration('report.json')).to.equal(0);
    await second.writeDerivative('report.json', { version: 2 }, { expectedGeneration: 0 });
    try { await store.writeDerivative('report.json', { version: 'stale' }, { expectedGeneration: 0 }); throw new Error('unexpected stale report'); }
    catch (error) { expect(error.message).to.include('Stale survey derivative generation'); }
    expect(await store.read('report.json')).to.deep.equal({ version: 2 });
  });
  it('preserves originals without silently replacing a missing manifest or bypassing recovery', async () => {
    await store.writeImmutable('results/pinned.json', { value: 'original' });
    await fs.rm(path.join(directory, 'manifest.json'));
    const reopened = new SurveyEvidenceStore(directory, { maxBytes: 32768 });
    let rejected;
    try { await reopened.initialize({ id: 'different-experiment' }); } catch (error) { rejected = error; }
    expect(rejected).to.be.instanceOf(SurveyManifestRecoveryError); expect(rejected.kind).to.equal('manifest-recovery-required');
    expect(await reopened.read('results/pinned.json')).to.deep.equal({ value: 'original' }); expect(await reopened.read('manifest.json')).to.equal(null);
    try { await reopened.writeImmutable('results/bypass.json', { value: 'new' }); throw new Error('unexpected recovery bypass'); }
    catch (error) { expect(error).to.be.instanceOf(SurveyManifestRecoveryError); }
    expect(await reopened.read('results/bypass.json')).to.equal(null);
  });
  it('restores a missing manifest only from the same manifest in a verified report', async () => {
    const manifest = await store.read('manifest.json');
    await store.writeImmutable('results/pinned.json', { value: 'original' });
    await store.writeDerivative('report.json', { manifest, status: 'interrupted' });
    const report = await fs.readFile(path.join(directory, 'report.json'), 'utf8');
    await fs.rm(path.join(directory, 'manifest.json'));
    const reopened = await new SurveyEvidenceStore(directory, { maxBytes: 32768 }).initialize(manifest);
    expect(await reopened.read('manifest.json')).to.deep.equal(manifest);
    expect(await reopened.read('results/pinned.json')).to.deep.equal({ value: 'original' });
    expect(await fs.readFile(path.join(directory, 'report.json'), 'utf8')).to.equal(report);
    expect(await reopened.derivativeGeneration('report.json')).to.equal(0);
  });
  it('rejects a changed recovery manifest and a corrupt backup report while retaining originals', async () => {
    const manifest = await store.read('manifest.json');
    await store.writeImmutable('results/pinned.json', { value: 'original' });
    await store.writeDerivative('report.json', { manifest }); await fs.rm(path.join(directory, 'manifest.json'));
    let rejected;
    try { await new SurveyEvidenceStore(directory).initialize({ ...manifest, id: 'changed' }); } catch (error) { rejected = error; }
    expect(rejected).to.be.instanceOf(SurveyManifestRecoveryError);
    const file = path.join(directory, 'report.json'), report = JSON.parse(await fs.readFile(file, 'utf8'));
    report.value.manifest.id = 'corrupt'; await fs.writeFile(file, JSON.stringify(report));
    try { await new SurveyEvidenceStore(directory).initialize(manifest); throw new Error('unexpected corrupt recovery'); }
    catch (error) { expect(error).to.be.instanceOf(SurveyEvidenceIntegrityError); }
    expect(await store.read('results/pinned.json')).to.deep.equal({ value: 'original' }); expect(await store.read('manifest.json')).to.equal(null);
  });
  it('binds derivative ownership and generation metadata to the intact payload checksum', async () => {
    await store.writeDerivative('report.json', { version: 1 });
    const file = path.join(directory, 'report.json'), receipt = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(receipt.envelopeVersion).to.equal(2); receipt.generation = 99;
    await fs.writeFile(file, JSON.stringify(receipt));
    let rejected;
    try { await store.derivativeGeneration('report.json'); } catch (error) { rejected = error; }
    expect(rejected).to.be.instanceOf(SurveyEvidenceIntegrityError); expect(rejected.message).to.include('metadata checksum mismatch');
  });
  it('preserves legacy envelopes and refuses generation overflow instead of resetting the counter', async () => {
    await store.writeDerivative('report.json', { version: 1 });
    const file = path.join(directory, 'report.json'), receipt = JSON.parse(await fs.readFile(file, 'utf8'));
    delete receipt.envelopeVersion; delete receipt.metadataChecksum;
    await fs.writeFile(file, JSON.stringify(receipt));
    expect(await store.read('report.json')).to.deep.equal({ version: 1 });
    await store.writeDerivative('report.json', { version: 2 }, { expectedGeneration: 0 });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).envelopeVersion).to.equal(2);
    const exhausted = JSON.parse(await fs.readFile(file, 'utf8'));
    delete exhausted.envelopeVersion; delete exhausted.metadataChecksum; exhausted.generation = Number.MAX_SAFE_INTEGER;
    await fs.writeFile(file, JSON.stringify(exhausted));
    try { await store.writeDerivative('report.json', { version: 'overflow' }, { expectedGeneration: Number.MAX_SAFE_INTEGER }); throw new Error('unexpected generation overflow'); }
    catch (error) { expect(error.message).to.include('generation exhausted'); }
    expect(await store.read('report.json')).to.deep.equal({ version: 2 });
  });
  it('retains the conflicting attempt with both checksums without replacing the original', async () => {
    await store.writeImmutable('results/original.json', { writer: 'first' });
    let conflict;
    try { await store.writeImmutable('results/original.json', { writer: 'second' }); } catch (error) { conflict = error; }
    expect(conflict).to.be.instanceOf(SurveyImmutableConflictError);
    const retained = await store.read(conflict.conflictReference);
    expect(retained).to.include({ target: 'results/original.json', originalChecksum: conflict.originalChecksum, attemptedChecksum: conflict.attemptedChecksum });
    expect(retained.value).to.deep.equal({ writer: 'second' }); expect(await store.read('results/original.json')).to.deep.equal({ writer: 'first' });
    expect(store.snapshot().durability).to.include('no power-loss flush guarantee');
  });
  it('protects immutable namespaces against derivative publication and path aliases', async () => {
    await store.writeImmutable('results/original.json', { value: 'original' });
    expect(() => store.writeDerivative('results/original.json', { value: 'replaced' }, { expectedGeneration: 0 })).to.throw('Original evidence cannot be replaced');
    expect(() => store.writeDerivative('verification/../results/original.json', { value: 'alias' })).to.throw('Original evidence cannot be replaced');
    expect(() => store.writeImmutable('report.json', { value: 'wrong owner' })).to.throw('requires generation publication');
    expect(() => store._file('results/../manifest.json')).to.throw('Invalid survey evidence path');
    expect(await store.read('results/original.json')).to.deep.equal({ value: 'original' });
  });
  it('checks replacement staging peak and cancels queued publication before it can commit', async () => {
    await store.writeDerivative('report.json', { data: 'x'.repeat(17000) });
    try { await store.writeDerivative('report.json', { data: 'y'.repeat(17000) }, { expectedGeneration: 0 }); throw new Error('unexpected staging'); }
    catch (error) { expect(error).to.be.instanceOf(SurveyStorageLimitError); }
    expect((await store.read('report.json')).data[0]).to.equal('x');
    const cancelled = new AbortController(); cancelled.abort(new Error('retired persistence generation'));
    try { await store.writeImmutable('results/cancelled.json', { writer: 'late' }, { signal: cancelled.signal }); throw new Error('unexpected commit'); }
    catch (error) { expect(error.message).to.equal('retired persistence generation'); }
    expect(await store.read('results/cancelled.json')).to.equal(null);
    expect((await fs.readdir(path.join(directory, 'results'))).some(name => name.endsWith('.tmp'))).to.equal(false);
  });
  it('cleans a partial disk-full staging write and retains the preceding original exactly', async () => {
    await store.writeImmutable('results/pinned.json', { value: 'original' }); const before = store.snapshot().bytes;
    const writeFile = fs.writeFile;
    fs.writeFile = async (file, data, options) => {
      if (String(file).startsWith(path.join(directory, 'results', 'partial.json.'))) {
        await writeFile(file, String(data).slice(0, 7), options); const error = new Error('disk full during staging'); error.code = 'ENOSPC'; throw error;
      }
      return writeFile(file, data, options);
    };
    try {
      try { await store.writeImmutable('results/partial.json', { value: 'never published' }); throw new Error('unexpected publication'); }
      catch (error) { expect(error.code).to.equal('ENOSPC'); }
    } finally { fs.writeFile = writeFile; }
    expect(await store.read('results/pinned.json')).to.deep.equal({ value: 'original' }); expect(await store.read('results/partial.json')).to.equal(null);
    expect((await fs.readdir(path.join(directory, 'results')))).to.deep.equal(['pinned.json']); expect(store.snapshot().bytes).to.equal(before);
  });
  it('cancels a lease waiter promptly without releasing or modifying the active writer lease', async () => {
    let entered, release;
    const acquired = new Promise(resolve => { entered = resolve; });
    const holding = store._withWriterLease(async () => { entered(); await new Promise(resolve => { release = resolve; }); });
    await acquired;
    const leaseFile = path.join(directory, '.writer-lease', 'owner.json'), owner = await fs.readFile(leaseFile, 'utf8');
    const contender = new SurveyEvidenceStore(directory, { maxBytes: 32768 }), controller = new AbortController();
    const waiting = contender.writeImmutable('results/cancelled-waiter.json', { value: 'late' }, { signal: controller.signal });
    try {
      await new Promise(resolve => setTimeout(resolve, 30)); const started = Date.now(); controller.abort(new Error('retired delivery'));
      let rejected;
      try { await waiting; } catch (error) { rejected = error; }
      expect(rejected).to.be.instanceOf(Error); expect(rejected.name).to.equal('AbortError');
      expect(Date.now() - started).to.be.lessThan(1000); expect(await fs.readFile(leaseFile, 'utf8')).to.equal(owner);
      expect(await store.read('results/cancelled-waiter.json')).to.equal(null);
    } finally { controller.abort(); release(); await holding; }
    await contender.writeImmutable('results/after-cancel.json', { value: 'fresh' });
    expect(await contender.read('results/after-cancel.json')).to.deep.equal({ value: 'fresh' });
  });
  it('removes only app-owned orphan staging after reopening', async () => {
    const orphan = path.join(directory, 'results', 'missing.json.00000000-0000-0000-0000-000000000000.tmp');
    const unknown = path.join(directory, 'results', 'external.tmp');
    await fs.writeFile(orphan, '{partial'); await fs.writeFile(unknown, 'keep');
    const reopened = await new SurveyEvidenceStore(directory, { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' });
    expect((await fs.readdir(path.join(directory, 'results')))).to.deep.equal(['external.tmp']);
    expect(reopened.snapshot().bytes).to.equal(store.snapshot().bytes + 4);
  });
  it('preserves one original when two processes race to publish different values', async function() {
    this.timeout(15000);
    const source = new URL('../scripts/procgen-survey/SurveyEvidenceStore.js', import.meta.url).href;
    const program = `import { SurveyEvidenceStore } from ${JSON.stringify(source)};
      const store = await new SurveyEvidenceStore(process.argv[1], { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' });
      await new Promise(resolve => { process.once('message', resolve); process.send('ready'); });
      try { await store.writeImmutable('results/process-race.json', { writer: process.argv[2] }); process.stdout.write('committed'); }
      catch (error) { process.stdout.write(error.message.includes('Conflicting immutable') ? 'conflict' : 'error:' + error.message); }
      finally { process.disconnect(); }`;
    const children = [], controller = new AbortController();
    const deadline = setTimeout(() => { controller.abort(new Error('Independent evidence writers exceeded their 10-second deadline')); for (const entry of children) entry.process.kill('SIGKILL'); }, 10000);
    const child = writer => {
      const worker = spawn(process.execPath, ['--input-type=module', '-e', program, directory, writer], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], signal: controller.signal });
      let output = '', errorText = '', failure;
      worker.stdout.on('data', chunk => { output = (output + chunk).slice(-32768); }); worker.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-32768); });
      worker.on('error', error => { failure = error; });
      const closed = new Promise(resolve => worker.once('close', code => resolve({ code, output, errorText, failure })));
      const ready = new Promise((resolve, reject) => {
        worker.once('message', message => message === 'ready' ? resolve() : reject(new Error('Unexpected evidence writer readiness message')));
        closed.then(result => reject(result.failure || new Error('Evidence writer closed before readiness: ' + result.code)));
      });
      const entry = { process: worker, closed, ready }; children.push(entry); return entry;
    };
    try {
      const writers = [child('A'), child('B')]; await Promise.all(writers.map(entry => entry.ready));
      for (const entry of writers) entry.process.send('publish');
      const results = await Promise.all(writers.map(entry => entry.closed));
      for (const result of results) { if (result.failure) throw result.failure; expect(result.code, result.errorText).to.equal(0); }
      expect(results.map(result => result.output).sort()).to.deep.equal(['committed', 'conflict']);
      expect(['A', 'B']).to.include((await store.read('results/process-race.json')).writer);
      expect(await fs.readdir(path.join(directory, 'results'))).to.deep.equal(['process-race.json']);
    } finally {
      clearTimeout(deadline); controller.abort();
      for (const entry of children) if (entry.process.exitCode == null && entry.process.signalCode == null) entry.process.kill('SIGKILL');
      await Promise.all(children.map(entry => entry.closed));
    }
  });
  it('recovers a killed writer and preserves its published original beside orphan staging', async () => {
    const source = new URL('../scripts/procgen-survey/SurveyEvidenceStore.js', import.meta.url).href;
    const program = `import { SurveyEvidenceStore } from ${JSON.stringify(source)};
      import fs from 'node:fs/promises'; import path from 'node:path';
      const store = await new SurveyEvidenceStore(process.argv[1], { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' });
      await store.writeImmutable('results/before-crash.json', { writer: 'crashed', verified: true });
      await store._withWriterLease(async () => {
        await fs.writeFile(path.join(process.argv[1], 'results', 'partial.json.00000000-0000-0000-0000-000000000000.tmp'), '{partial');
        process.stdout.write('leased'); await new Promise(() => { setInterval(() => {}, 1000); });
      });`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise((resolve, reject) => { child.on('error', reject); child.stdout.once('data', resolve); child.once('exit', code => reject(new Error('Crash fixture exited before lease: ' + code))); });
      const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
      const reopened = await Promise.all([new SurveyEvidenceStore(directory, { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' }),
        new SurveyEvidenceStore(directory, { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' })]);
      for (const reader of reopened) expect(await reader.read('results/before-crash.json')).to.deep.equal({ writer: 'crashed', verified: true });
      expect((await fs.readdir(path.join(directory, 'results')))).to.deep.equal(['before-crash.json']);
      expect(reopened[0].snapshot().bytes).to.equal(reopened[1].snapshot().bytes);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  });
  it('recovers verified attempts and originals when a process dies immediately after either hard-link boundary', async function() {
    this.timeout(15000);
    const source = new URL('../scripts/procgen-survey/SurveyEvidenceStore.js', import.meta.url).href;
    for (const boundary of ['attempts', 'results']) {
      const trialId = 'crash-' + boundary;
      const program = `import { SurveyEvidenceStore } from ${JSON.stringify(source)}; import fs from 'node:fs/promises'; import path from 'node:path';
        const store = await new SurveyEvidenceStore(process.argv[1], { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' });
        const link = fs.link; fs.link = async (temporary, target) => { await link(temporary, target);
          if (String(target).includes(path.sep + process.argv[2] + path.sep)) { process.stdout.write('published'); await new Promise(() => { setInterval(() => {}, 1000); }); } };
        await store.commitResult({ trialId: process.argv[3], status: 'completed', lastTick: 100, finalStateHash: 'verified-original' }, { id: 'crashed' });`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', program, directory, boundary, trialId], { stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.once('data', resolve); child.once('exit', code => reject(new Error('Crash boundary fixture exited early: ' + code))); });
        const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
        const reopened = await new SurveyEvidenceStore(directory, { maxBytes: 32768 }).initialize({ id: 'frozen', code: 'sha' });
        const recovered = await reopened.recoverCompleted(trialId);
        expect(recovered.status).to.equal(boundary === 'attempts' ? 'recovered-from-complete-attempt' : 'already-published');
        expect(recovered.result.finalStateHash).to.equal('verified-original');
        expect((await reopened.read('attempts/' + trialId + '-crashed.json')).result).to.deep.equal(recovered.result);
        expect((await fs.readdir(path.join(directory, 'results'))).some(name => name.endsWith('.tmp'))).to.equal(false);
      } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    }
  });
  it('separates logical/resident counts from the small CPU worker pool and rejects impossible resources', () => {
    const bounds = normalizeSurveyResources({ residentWorlds: 64, executionWorkers: 1 }); expect(bounds.residentWorlds).to.equal(64); expect(bounds.executionWorkers).to.equal(1);
    for (const patch of [{ executionWorkers: 16 }, { residentWorlds: 65 }, { sliceTicks: 0 }, { maxTotalTicks: Infinity }]) expect(() => normalizeSurveyResources(patch)).to.throw(RangeError);
    expect(() => store._file('../outside.json')).to.throw('Invalid survey evidence path');
  });
});
