import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const envelopeMetadata = record => ({ schemaVersion: record.schemaVersion, envelopeVersion: record.envelopeVersion,
  kind: record.kind, generation: record.generation ?? null, checksum: record.checksum });
const createEnvelope = (value, kind, generation) => {
  const record = { schemaVersion: 1, envelopeVersion: 2, kind, checksum: digest(value), value };
  if (generation !== undefined) record.generation = generation;
  record.metadataChecksum = digest(envelopeMetadata(record)); return record;
};
const stableOutcome = result => ({ schemaVersion: result.schemaVersion, scenarioId: result.scenarioId, candidateId: result.candidateId, policySeed: result.policySeed,
  status: result.status, terminationReason: result.terminationReason, lastTick: result.lastTick, initialStateHash: result.initialStateHash,
  finalStateHash: result.finalStateHash, finalPhysicalStateHash: result.finalPhysicalStateHash, eventHash: result.eventHash,
  initialScenarioStateHash: result.initialScenarioStateHash, initialPhysicalStateHash: result.initialPhysicalStateHash, accounting: result.accounting, metrics: result.metrics, crew: result.crew,
  provenance: result.provenance, episodeComplete: result.episodeComplete,
  validity: result.validity && { accountingComplete: result.validity.accountingComplete, protectedTerrain: result.validity.protectedTerrain, legitimateActions: result.validity.legitimateActions } });
const verifiedEpisode = result => ['completed', 'failed', 'timed-out', 'timeout'].includes(result?.status) &&
  (result.episodeComplete === true || result.episodeComplete === undefined && result.schemaVersion === undefined);
const evidenceIdentity = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(value)) throw new TypeError('Invalid survey trial or attempt identity'); return value; };
const publicationDurability = 'atomic-namespace-publication; no power-loss flush guarantee';
const derivativePath = name => name === 'report.json' || /^verification\/[a-zA-Z0-9_-]+-qualification-summary\.json$/.test(name);
class SurveyStorageLimitError extends Error { constructor(message) { super(message); this.name = 'SurveyStorageLimitError'; this.kind = 'storage-quota'; } }
class SurveyWriterLeaseError extends Error { constructor(message) { super(message); this.name = 'SurveyWriterLeaseError'; this.kind = 'writer-lease'; } }
class SurveyDerivativeConflictError extends Error { constructor(message) { super(message); this.name = 'SurveyDerivativeConflictError'; this.kind = 'derivative-conflict'; } }
class SurveyEvidenceIntegrityError extends Error {
  constructor(name, reason, options) { super(reason + ': ' + name, options); this.name = 'SurveyEvidenceIntegrityError'; this.kind = 'evidence-integrity'; this.reference = name; }
}
class SurveyManifestRecoveryError extends SurveyEvidenceIntegrityError {
  constructor() { super('manifest.json', 'Original survey manifest is missing; restore its verified report or original backup before writing'); this.name = 'SurveyManifestRecoveryError'; this.kind = 'manifest-recovery-required'; }
}
class SurveyImmutableConflictError extends Error {
  constructor(name, originalChecksum, attemptedChecksum, conflictReference = null) {
    super('Conflicting immutable survey evidence: ' + name); this.name = 'SurveyImmutableConflictError';
    this.originalChecksum = originalChecksum; this.attemptedChecksum = attemptedChecksum; this.conflictReference = conflictReference;
  }
}
class SurveyOutcomeConflictError extends Error {
  constructor(trialId, originalReference, attemptedReference, originalChecksum, attemptedChecksum) {
    super('Determinism defect: duplicate survey attempts disagree for ' + trialId); this.name = 'SurveyOutcomeConflictError'; this.kind = 'determinism-defect';
    Object.assign(this, { trialId, originalReference, attemptedReference, originalChecksum, attemptedChecksum });
  }
}
class SurveyEvidenceStore {
  constructor(directory, { maxBytes = 32 * 1048576 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 32768 || maxBytes > 128 * 1048576) throw new RangeError('Survey storage bytes must be an integer between 32 KiB and 128 MiB');
    this.directory = path.resolve(directory); this.maxBytes = Math.max(32768, Math.min(128 * 1048576, maxBytes));
    this.bytes = 0; this.tail = Promise.resolve();
  }
  async initialize(manifest, { signal } = {}) {
    signal?.throwIfAborted();
    await fs.mkdir(this.directory, { recursive: true });
    for (const name of ['results', 'attempts', 'exemplars', 'verification', 'conflicts']) await fs.mkdir(path.join(this.directory, name), { recursive: true });
    await this._enqueue(async () => {
      const previous = await this._readEnvelope('manifest.json');
      if (!previous) {
        const report = await this._readEnvelope('report.json');
        if (report || await this._hasOriginalEvidence(signal)) {
          if (!report?.value?.manifest || digest(report.value.manifest) !== digest(manifest)) throw new SurveyManifestRecoveryError();
        }
      }
      await this._publishImmutable('manifest.json', manifest, signal);
    }, { signal, allowMissingManifest: true });
    return this;
  }
  async _hasOriginalEvidence(signal) {
    const visit = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        signal?.throwIfAborted();
        if (entry.isFile() && entry.name.endsWith('.json') || entry.isDirectory() && await visit(path.join(directory, entry.name))) return true;
      }
      return false;
    };
    for (const name of ['results', 'attempts', 'exemplars', 'verification', 'conflicts']) if (await visit(path.join(this.directory, name))) return true;
    return false;
  }
  _enqueue(action, { signal, allowMissingManifest = false } = {}) {
    const operation = this.tail.then(() => this._withWriterLease(async () => {
      if (!allowMissingManifest && !await this._readEnvelope('manifest.json')) throw new SurveyManifestRecoveryError();
      return action();
    }, { signal }));
    this.tail = operation.catch(() => {}); return operation;
  }
  async _countBytes(signal) {
    let bytes = 0;
    const count = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        signal?.throwIfAborted();
        if (entry.name === '.writer-lease' || entry.name.startsWith('.writer-recovery-')) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await count(file); else if (entry.isFile()) bytes += (await fs.stat(file)).size;
      }
    };
    await count(this.directory); return bytes;
  }
  async _cleanOrphanStaging(signal) {
    const appTemporary = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;
    const visit = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        signal?.throwIfAborted();
        if (entry.name === '.writer-lease' || entry.name.startsWith('.writer-recovery-')) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile() && appTemporary.test(entry.name)) await fs.rm(file);
      }
    };
    await visit(this.directory);
  }
  async _withWriterLease(action, { signal } = {}) {
    const lease = path.join(this.directory, '.writer-lease'), token = randomUUID(), deadline = Date.now() + 10000;
    for (;;) {
      signal?.throwIfAborted();
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
            await delay(20, undefined, { signal }); continue;
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
        await delay(20, undefined, { signal });
      }
    }
    try { signal?.throwIfAborted(); await this._cleanOrphanStaging(signal); this.bytes = await this._countBytes(signal); return await action(); }
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
      if (!record || typeof record !== 'object' || Array.isArray(record) || record.schemaVersion !== 1 || !Object.hasOwn(record, 'value')) throw new SurveyEvidenceIntegrityError(name, 'Invalid survey evidence envelope');
      if (record.checksum !== digest(record.value)) throw new SurveyEvidenceIntegrityError(name, 'Survey evidence checksum mismatch');
      if (record.kind !== undefined && !['original', 'derivative', 'conflict'].includes(record.kind) ||
          record.envelopeVersion !== undefined && record.envelopeVersion !== 2 ||
          record.envelopeVersion === 2 && record.metadataChecksum !== digest(envelopeMetadata(record))) throw new SurveyEvidenceIntegrityError(name, 'Survey evidence metadata checksum mismatch');
      if (record.kind === 'derivative' && !Number.isSafeInteger(record.generation) || record.generation !== undefined &&
          (!Number.isSafeInteger(record.generation) || record.generation < 0 || record.kind && record.kind !== 'derivative')) throw new SurveyEvidenceIntegrityError(name, 'Invalid survey derivative generation');
      return record;
    } catch (error) { if (error.code === 'ENOENT') return null; if (error instanceof SyntaxError) throw new SurveyEvidenceIntegrityError(name, 'Malformed survey evidence JSON', { cause: error }); throw error; }
  }
  async derivativeGeneration(name) {
    if (!derivativePath(name)) throw new SurveyDerivativeConflictError('Original evidence cannot be replaced by a derivative: ' + name);
    const record = await this._readEnvelope(name);
    if (!record) return null;
    return record.generation ?? 0;
  }
  async _retainConflict(name, previous, value, signal) {
    signal?.throwIfAborted();
    const attemptedChecksum = digest(value), conflict = { target: name, originalChecksum: previous.checksum, attemptedChecksum, value };
    const conflictReference = 'conflicts/' + digest(conflict) + '.json';
    const record = createEnvelope(conflict, 'conflict');
    const data = JSON.stringify(record) + '\n', size = Buffer.byteLength(data);
    let retained = null;
    if (this.bytes + size <= this.maxBytes) {
      const file = this._file(conflictReference), temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, data, { flag: 'wx' });
        signal?.throwIfAborted();
        try { await fs.link(temporary, file); this.bytes += size; } catch (error) { if (error.code !== 'EEXIST') throw error; await this._readEnvelope(conflictReference); }
        retained = conflictReference;
      } finally { await fs.rm(temporary, { force: true }); }
    }
    throw new SurveyImmutableConflictError(name, previous.checksum, attemptedChecksum, retained);
  }
  writeImmutable(name, value, { signal } = {}) {
    if (derivativePath(name)) throw new SurveyDerivativeConflictError('Derived report path requires generation publication: ' + name);
    return this._enqueue(() => this._publishImmutable(name, value, signal), { signal });
  }
  async _publishImmutable(name, value, signal) {
    signal?.throwIfAborted();
    const previous = await this._readEnvelope(name);
    if (previous) { if (previous.checksum !== digest(value)) return this._retainConflict(name, previous, value, signal); return previous.value; }
    const data = JSON.stringify(createEnvelope(value, 'original')) + '\n', size = Buffer.byteLength(data);
    if (this.bytes + size > this.maxBytes) throw new SurveyStorageLimitError('Survey storage cap reached; required originals retained');
    const file = this._file(name), temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, data, { flag: 'wx' }); signal?.throwIfAborted();
      try { await fs.link(temporary, file); this.bytes += size; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const competing = await this._readEnvelope(name);
        if (!competing) throw new SurveyEvidenceIntegrityError(name, 'Concurrent survey publication disappeared; reconcile original identity before retrying');
        if (competing.checksum !== digest(value)) return this._retainConflict(name, competing, value, signal);
        return competing.value;
      }
    } finally { await fs.rm(temporary, { force: true }); }
    return value;
  }
  writeDerivative(name, value, { expectedGeneration = null, signal } = {}) {
    if (!derivativePath(name)) throw new SurveyDerivativeConflictError('Original evidence cannot be replaced by a derivative: ' + name);
    if (expectedGeneration !== null && (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0)) throw new RangeError('Invalid survey derivative generation');
    return this._enqueue(async () => {
      signal?.throwIfAborted();
      const file = this._file(name), previous = await this._readEnvelope(name);
      if (previous?.kind && previous.kind !== 'derivative') throw new SurveyDerivativeConflictError('Original evidence cannot be replaced by a derivative: ' + name);
      const actualGeneration = previous ? previous.generation ?? 0 : null;
      if (actualGeneration !== expectedGeneration) throw new SurveyDerivativeConflictError('Stale survey derivative generation: ' + name);
      if (actualGeneration === Number.MAX_SAFE_INTEGER) throw new SurveyDerivativeConflictError('Survey derivative generation exhausted: ' + name);
      const data = JSON.stringify(createEnvelope(value, 'derivative', (actualGeneration ?? -1) + 1)) + '\n';
      const previousBytes = previous ? (await fs.stat(file)).size : 0;
      const size = Buffer.byteLength(data);
      if (this.bytes + size > this.maxBytes) throw new SurveyStorageLimitError('Survey storage peak staging cap reached while exporting derived report; originals retained');
      const temporary = file + '.' + randomUUID() + '.tmp';
      try { await fs.writeFile(temporary, data, { flag: 'wx' }); signal?.throwIfAborted(); await fs.rename(temporary, file); this.bytes += size - previousBytes; }
      finally { await fs.rm(temporary, { force: true }); }
      return value;
    }, { signal });
  }
  async completed(trialId) {
    const result = await this.read('results/' + evidenceIdentity(trialId) + '.json'); return result && verifiedEpisode(result) ? result : null;
  }
  async _publishEpisode(result, attemptReference, signal) {
    const reference = 'results/' + result.trialId + '.json', previous = await this._readEnvelope(reference);
    if (previous) {
      if (!verifiedEpisode(previous.value)) throw new SurveyEvidenceIntegrityError(reference, 'An incomplete original occupies a completed-result identity');
      if (digest(stableOutcome(previous.value)) !== digest(stableOutcome(result))) throw new SurveyOutcomeConflictError(result.trialId, reference, attemptReference, previous.checksum, digest(result));
      return previous.value;
    }
    return this._publishImmutable(reference, result, signal);
  }
  async commitResult(result, attempt, { signal, withReceipt = false } = {}) {
    const trialId = evidenceIdentity(result?.trialId), attemptId = evidenceIdentity(attempt?.id);
    return this._enqueue(async () => {
      const attemptReference = 'attempts/' + trialId + '-' + attemptId + '.json', retained = { result, attempt };
      await this._publishImmutable(attemptReference, retained, signal);
      const original = verifiedEpisode(result) ? await this._publishEpisode(result, attemptReference, signal) : null;
      const publication = { schemaVersion: 1, status: original ? 'original-and-attempt-published' : 'attempt-published',
        attemptReference, attemptChecksum: digest(retained), originalReference: original ? 'results/' + trialId + '.json' : null,
        originalChecksum: original ? digest(original) : null, durability: publicationDurability };
      return withReceipt ? { result: original || result, publication } : original || result;
    }, { signal });
  }
  async recoverCompleted(trialId, { signal } = {}) {
    evidenceIdentity(trialId);
    signal?.throwIfAborted();
    const published = await this._readEnvelope('results/' + trialId + '.json');
    if (published) {
      if (!verifiedEpisode(published.value)) throw new SurveyEvidenceIntegrityError('results/' + trialId + '.json', 'An incomplete original occupies a completed-result identity');
      return { status: 'already-published', result: published.value, originalReference: 'results/' + trialId + '.json', originalChecksum: published.checksum, durability: publicationDurability };
    }
    const prefix = trialId + '-'; let retainedAttempt = false;
    for await (const entry of await fs.opendir(path.join(this.directory, 'attempts'))) {
      signal?.throwIfAborted();
      if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.json')) { retainedAttempt = true; break; }
    }
    if (!retainedAttempt) return { status: 'no-complete-attempt', result: null, originalReference: 'results/' + trialId + '.json', durability: publicationDurability };
    return this._enqueue(async () => {
      const reference = 'results/' + trialId + '.json', existing = await this._readEnvelope(reference);
      if (existing) {
        if (!verifiedEpisode(existing.value)) throw new SurveyEvidenceIntegrityError(reference, 'An incomplete original occupies a completed-result identity');
        return { status: 'already-published', result: existing.value, originalReference: reference, originalChecksum: existing.checksum, durability: publicationDurability };
      }
      let first = null, outcomeChecksum = null;
      for await (const entry of await fs.opendir(path.join(this.directory, 'attempts'))) {
        signal?.throwIfAborted();
        if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.json')) continue;
        const attemptReference = 'attempts/' + entry.name, record = await this._readEnvelope(attemptReference), retained = record?.value;
        if (!retained || typeof retained.result?.trialId !== 'string' || typeof retained.attempt?.id !== 'string' || entry.name !== retained.result.trialId + '-' + retained.attempt.id + '.json') throw new SurveyEvidenceIntegrityError(attemptReference, 'Retained survey attempt identity mismatch');
        if (retained.result.trialId !== trialId) continue;
        if (!verifiedEpisode(retained.result)) continue;
        const checksum = digest(stableOutcome(retained.result));
        if (first && checksum !== outcomeChecksum) throw new SurveyOutcomeConflictError(trialId, first.attemptReference, attemptReference, first.record.checksum, record.checksum);
        if (!first || attemptReference < first.attemptReference) first = { attemptReference, record };
        outcomeChecksum = checksum;
      }
      if (!first) return { status: 'no-complete-attempt', result: null, originalReference: reference, durability: publicationDurability };
      const result = first.record.value.result;
      await this._publishEpisode(result, first.attemptReference, signal);
      return { status: 'recovered-from-complete-attempt', result, attempt: first.record.value.attempt, attemptReference: first.attemptReference, attemptChecksum: first.record.checksum,
        originalReference: reference, originalChecksum: digest(result), durability: publicationDurability };
    }, { signal });
  }
  async exemplar(selection, result, replayManifest, context = [], qualification = null) {
    return this.writeImmutable('exemplars/' + result.trialId + '.json', { schemaVersion: 1, selection, original: result, replayManifest, context, qualification });
  }
  snapshot() { return { bytes: this.bytes, maxBytes: this.maxBytes, remainingBytes: this.maxBytes - this.bytes,
    durability: publicationDurability, publication: 'same-filesystem hard-link no-replace' }; }
}
export { SurveyEvidenceStore, SurveyStorageLimitError, SurveyWriterLeaseError, SurveyDerivativeConflictError, SurveyImmutableConflictError, SurveyOutcomeConflictError, SurveyEvidenceIntegrityError, SurveyManifestRecoveryError, stableOutcome, verifiedEpisode };
