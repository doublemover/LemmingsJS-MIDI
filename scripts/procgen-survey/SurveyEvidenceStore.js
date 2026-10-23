import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableOutcome = result => ({ status: result.status, lastTick: result.lastTick, initialStateHash: result.initialStateHash,
  finalStateHash: result.finalStateHash, eventHash: result.eventHash, initialScenarioStateHash: result.initialScenarioStateHash, accounting: result.accounting, metrics: result.metrics, provenance: result.provenance, episodeComplete: result.episodeComplete });
const verifiedEpisode = result => ['completed', 'failed', 'timed-out', 'timeout', 'unsupported'].includes(result.status);
const derivativePath = name => name === 'report.json' || /^verification\/[a-zA-Z0-9_-]+-qualification-summary\.json$/.test(name);
class SurveyStorageLimitError extends Error {}
class SurveyWriterLeaseError extends Error {}
class SurveyDerivativeConflictError extends Error {}
class SurveyImmutableConflictError extends Error {
  constructor(name, originalChecksum, attemptedChecksum, conflictReference = null) {
    super('Conflicting immutable survey evidence: ' + name); this.name = 'SurveyImmutableConflictError';
    this.originalChecksum = originalChecksum; this.attemptedChecksum = attemptedChecksum; this.conflictReference = conflictReference;
  }
}
class SurveyEvidenceStore {
  constructor(directory, { maxBytes = 32 * 1048576 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 32768 || maxBytes > 128 * 1048576) throw new RangeError('Survey storage bytes must be an integer between 32 KiB and 128 MiB');
    this.directory = path.resolve(directory); this.maxBytes = Math.max(32768, Math.min(128 * 1048576, maxBytes));
    this.bytes = 0; this.tail = Promise.resolve();
  }
  async initialize(manifest) {
    await fs.mkdir(this.directory, { recursive: true });
    for (const name of ['results', 'attempts', 'exemplars', 'verification', 'conflicts']) await fs.mkdir(path.join(this.directory, name), { recursive: true });
    this.bytes = await this._countBytes(); await this.writeImmutable('manifest.json', manifest); return this;
  }
  async _countBytes() {
    let bytes = 0;
    const count = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name === '.writer-lease' || entry.name.startsWith('.writer-recovery-')) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await count(file); else if (entry.isFile()) bytes += (await fs.stat(file)).size;
      }
    };
    await count(this.directory); return bytes;
  }
  async _cleanOrphanStaging() {
    const appTemporary = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;
    const visit = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name === '.writer-lease' || entry.name.startsWith('.writer-recovery-')) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile() && appTemporary.test(entry.name)) await fs.rm(file);
      }
    };
    await visit(this.directory);
  }
  async _withWriterLease(action) {
    const lease = path.join(this.directory, '.writer-lease'), token = randomUUID(), deadline = Date.now() + 10000;
    for (;;) {
      try {
        await fs.mkdir(lease);
        try { await fs.writeFile(path.join(lease, 'owner.json'), JSON.stringify({ pid: process.pid, token }), { flag: 'wx' }); }
        catch (error) { await fs.rm(lease, { recursive: true, force: true }); throw error; }
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let stale = false, owner = null;
        try { owner = JSON.parse(await fs.readFile(path.join(lease, 'owner.json'), 'utf8')); }
        catch (readError) { if (readError.code !== 'ENOENT') throw readError; const stat = await fs.stat(lease).catch(() => null); stale = !!stat && Date.now() - stat.mtimeMs > 60000; }
        if (owner?.pid && Number.isSafeInteger(owner.pid)) {
          try { process.kill(owner.pid, 0); } catch (checkError) { stale = checkError.code === 'ESRCH'; }
        }
        if (stale) {
          const recovery = path.join(lease, 'recovery');
          try { await fs.mkdir(recovery); }
          catch (recoveryError) {
            if (recoveryError.code === 'ENOENT') continue;
            if (recoveryError.code !== 'EEXIST') throw recoveryError;
            if (Date.now() >= deadline) throw new SurveyWriterLeaseError('Survey stale-writer recovery is already reserved; interrupted recovery requires inspection');
            await new Promise(resolve => setTimeout(resolve, 20)); continue;
          }
          const orphan = path.join(this.directory, '.writer-recovery-' + randomUUID());
          try {
            const latest = await fs.readFile(path.join(lease, 'owner.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
            if (latest?.token !== owner?.token || latest?.pid !== owner?.pid) { await fs.rm(recovery, { recursive: true, force: true }); continue; }
            await fs.rename(lease, orphan); await fs.rm(orphan, { recursive: true, force: true });
          }
          catch (recoveryError) { if (recoveryError.code !== 'ENOENT') throw recoveryError; }
          continue;
        }
        if (Date.now() >= deadline) throw new SurveyWriterLeaseError('Survey evidence writer lease is busy');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    try { await this._cleanOrphanStaging(); this.bytes = await this._countBytes(); return await action(); }
    finally {
      const owner = JSON.parse(await fs.readFile(path.join(lease, 'owner.json'), 'utf8'));
      if (owner.token === token) await fs.rm(lease, { recursive: true, force: true });
    }
  }
  _file(name) {
    const target = path.resolve(this.directory, name);
    if (!target.startsWith(this.directory + path.sep) || !/^[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Invalid survey evidence path');
    return target;
  }
  async read(name) {
    const record = await this._readEnvelope(name); return record?.value ?? null;
  }
  async _readEnvelope(name) {
    try {
      const record = JSON.parse(await fs.readFile(this._file(name), 'utf8'));
      if (record.schemaVersion !== 1 || record.checksum !== digest(record.value)) throw new Error('Survey evidence checksum mismatch: ' + name);
      return record;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async derivativeGeneration(name) {
    if (!derivativePath(name)) throw new SurveyDerivativeConflictError('Original evidence cannot be replaced by a derivative: ' + name);
    const record = await this._readEnvelope(name);
    if (!record) return null;
    if (!Number.isSafeInteger(record.generation) || record.generation < 0) return 0;
    return record.generation;
  }
  async _retainConflict(name, previous, value) {
    const attemptedChecksum = digest(value), conflict = { target: name, originalChecksum: previous.checksum, attemptedChecksum, value };
    const conflictReference = 'conflicts/' + digest(conflict) + '.json';
    const record = { schemaVersion: 1, kind: 'conflict', checksum: digest(conflict), value: conflict };
    const data = JSON.stringify(record) + '\n', size = Buffer.byteLength(data);
    let retained = null;
    if (this.bytes + size <= this.maxBytes) {
      const file = this._file(conflictReference), temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, data, { flag: 'wx' });
        try { await fs.link(temporary, file); this.bytes += size; } catch (error) { if (error.code !== 'EEXIST') throw error; await this._readEnvelope(conflictReference); }
        retained = conflictReference;
      } finally { await fs.rm(temporary, { force: true }); }
    }
    throw new SurveyImmutableConflictError(name, previous.checksum, attemptedChecksum, retained);
  }
  writeImmutable(name, value, { signal } = {}) {
    if (derivativePath(name)) throw new SurveyDerivativeConflictError('Derived report path requires generation publication: ' + name);
    const operation = this.tail.then(() => this._withWriterLease(async () => {
      signal?.throwIfAborted();
      const previous = await this._readEnvelope(name);
      if (previous) { if (previous.checksum !== digest(value)) return this._retainConflict(name, previous, value); return previous.value; }
      const data = JSON.stringify({ schemaVersion: 1, kind: 'original', checksum: digest(value), value }) + '\n';
      const size = Buffer.byteLength(data);
      if (this.bytes + size > this.maxBytes) throw new SurveyStorageLimitError('Survey storage cap reached; required originals retained');
      const file = this._file(name), temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, data, { flag: 'wx' });
        signal?.throwIfAborted();
        try { await fs.link(temporary, file); this.bytes += size; }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const competing = await this._readEnvelope(name);
          if (competing?.checksum !== digest(value)) throw new Error('Conflicting immutable survey evidence: ' + name);
          return competing.value;
        }
      } finally { await fs.rm(temporary, { force: true }); }
      return value;
    }));
    this.tail = operation.catch(() => {}); return operation;
  }
  writeDerivative(name, value, { expectedGeneration = null, signal } = {}) {
    if (!derivativePath(name)) throw new SurveyDerivativeConflictError('Original evidence cannot be replaced by a derivative: ' + name);
    if (expectedGeneration !== null && (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0)) throw new RangeError('Invalid survey derivative generation');
    const operation = this.tail.then(() => this._withWriterLease(async () => {
      signal?.throwIfAborted();
      const file = this._file(name), previous = await this._readEnvelope(name);
      if (previous?.kind && previous.kind !== 'derivative') throw new SurveyDerivativeConflictError('Original evidence cannot be replaced by a derivative: ' + name);
      const actualGeneration = previous ? previous.generation ?? 0 : null;
      if (actualGeneration !== expectedGeneration) throw new SurveyDerivativeConflictError('Stale survey derivative generation: ' + name);
      const data = JSON.stringify({ schemaVersion: 1, kind: 'derivative', generation: (actualGeneration ?? -1) + 1, checksum: digest(value), value }) + '\n';
      const previousBytes = previous ? (await fs.stat(file)).size : 0;
      const size = Buffer.byteLength(data);
      if (this.bytes + size > this.maxBytes) throw new SurveyStorageLimitError('Survey storage peak staging cap reached while exporting derived report; originals retained');
      const temporary = file + '.' + randomUUID() + '.tmp';
      try { await fs.writeFile(temporary, data, { flag: 'wx' }); signal?.throwIfAborted(); await fs.rename(temporary, file); this.bytes += size - previousBytes; }
      finally { await fs.rm(temporary, { force: true }); }
      return value;
    }));
    this.tail = operation.catch(() => {}); return operation;
  }
  async completed(trialId) {
    const result = await this.read('results/' + trialId + '.json'); return result && verifiedEpisode(result) ? result : null;
  }
  async commitResult(result, attempt, { signal } = {}) {
    await this.writeImmutable('attempts/' + result.trialId + '-' + attempt.id + '.json', { result, attempt }, { signal });
    if (!verifiedEpisode(result)) return result;
    const previous = await this.completed(result.trialId);
    if (previous) {
      if (digest(stableOutcome(previous)) !== digest(stableOutcome(result))) throw new Error('Determinism defect: duplicate survey attempts disagree for ' + result.trialId);
      return previous;
    }
    await this.writeImmutable('results/' + result.trialId + '.json', result, { signal }); return result;
  }
  async exemplar(selection, result, replayManifest, context = [], qualification = null) {
    return this.writeImmutable('exemplars/' + result.trialId + '.json', { schemaVersion: 1, selection, original: result, replayManifest, context, qualification });
  }
  snapshot() { return { bytes: this.bytes, maxBytes: this.maxBytes, remainingBytes: this.maxBytes - this.bytes,
    durability: 'atomic-namespace-publication; no power-loss flush guarantee', publication: 'same-filesystem hard-link no-replace' }; }
}
export { SurveyEvidenceStore, SurveyStorageLimitError, SurveyWriterLeaseError, SurveyDerivativeConflictError, SurveyImmutableConflictError, stableOutcome, verifiedEpisode };
