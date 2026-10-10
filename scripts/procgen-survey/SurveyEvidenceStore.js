import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableOutcome = result => ({ status: result.status, lastTick: result.lastTick, initialStateHash: result.initialStateHash,
  finalStateHash: result.finalStateHash, eventHash: result.eventHash, initialScenarioStateHash: result.initialScenarioStateHash, accounting: result.accounting, metrics: result.metrics, provenance: result.provenance, episodeComplete: result.episodeComplete });
const verifiedEpisode = result => ['completed', 'failed', 'timed-out', 'timeout', 'unsupported'].includes(result.status);
class SurveyStorageLimitError extends Error {}
class SurveyEvidenceStore {
  constructor(directory, { maxBytes = 32 * 1048576 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 32768 || maxBytes > 128 * 1048576) throw new RangeError('Survey storage bytes must be an integer between 32 KiB and 128 MiB');
    this.directory = path.resolve(directory); this.maxBytes = Math.max(32768, Math.min(128 * 1048576, maxBytes));
    this.bytes = 0; this.tail = Promise.resolve();
  }
  async initialize(manifest) {
    await fs.mkdir(this.directory, { recursive: true });
    for (const name of ['results', 'attempts', 'exemplars', 'verification']) await fs.mkdir(path.join(this.directory, name), { recursive: true });
    const count = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await count(file); else if (entry.isFile()) this.bytes += (await fs.stat(file)).size;
      }
    };
    await count(this.directory); await this.writeImmutable('manifest.json', manifest); return this;
  }
  _file(name) {
    const target = path.resolve(this.directory, name);
    if (!target.startsWith(this.directory + path.sep) || !/^[a-zA-Z0-9_./-]+$/.test(name)) throw new Error('Invalid survey evidence path');
    return target;
  }
  async read(name) {
    try {
      const record = JSON.parse(await fs.readFile(this._file(name), 'utf8'));
      if (record.schemaVersion !== 1 || record.checksum !== digest(record.value)) throw new Error('Survey evidence checksum mismatch: ' + name);
      return record.value;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  writeImmutable(name, value) {
    const operation = this.tail.then(async () => {
      const previous = await this.read(name);
      if (previous) { if (digest(previous) !== digest(value)) throw new Error('Conflicting immutable survey evidence: ' + name); return previous; }
      const data = JSON.stringify({ schemaVersion: 1, checksum: digest(value), value }) + '\n';
      const size = Buffer.byteLength(data);
      if (this.bytes + size > this.maxBytes) throw new SurveyStorageLimitError('Survey storage cap reached; required originals retained');
      const file = this._file(name), temporary = file + '.' + randomUUID() + '.tmp';
      await fs.writeFile(temporary, data, { flag: 'wx' });
      try { await fs.rename(temporary, file); this.bytes += size; } finally { await fs.rm(temporary, { force: true }); }
      return value;
    });
    this.tail = operation.catch(() => {}); return operation;
  }
  writeDerivative(name, value) {
    const operation = this.tail.then(async () => {
      const file = this._file(name), data = JSON.stringify({ schemaVersion: 1, checksum: digest(value), value }) + '\n';
      let previousBytes = 0;
      try { previousBytes = (await fs.stat(file)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const size = Buffer.byteLength(data);
      if (this.bytes - previousBytes + size > this.maxBytes) throw new SurveyStorageLimitError('Survey storage cap reached while exporting derived report; originals retained');
      const temporary = file + '.' + randomUUID() + '.tmp';
      await fs.writeFile(temporary, data, { flag: 'wx' });
      try { await fs.rename(temporary, file); this.bytes += size - previousBytes; } finally { await fs.rm(temporary, { force: true }); }
      return value;
    });
    this.tail = operation.catch(() => {}); return operation;
  }
  async completed(trialId) {
    const result = await this.read('results/' + trialId + '.json'); return result && verifiedEpisode(result) ? result : null;
  }
  async commitResult(result, attempt) {
    await this.writeImmutable('attempts/' + result.trialId + '-' + attempt.id + '.json', { result, attempt });
    if (!verifiedEpisode(result)) return result;
    const previous = await this.completed(result.trialId);
    if (previous) {
      if (digest(stableOutcome(previous)) !== digest(stableOutcome(result))) throw new Error('Determinism defect: duplicate survey attempts disagree for ' + result.trialId);
      return previous;
    }
    await this.writeImmutable('results/' + result.trialId + '.json', result); return result;
  }
  async exemplar(selection, result, replayManifest, context = [], qualification = null) {
    return this.writeImmutable('exemplars/' + result.trialId + '.json', { schemaVersion: 1, selection, original: result, replayManifest, context, qualification });
  }
  snapshot() { return { bytes: this.bytes, maxBytes: this.maxBytes, remainingBytes: this.maxBytes - this.bytes }; }
}
export { SurveyEvidenceStore, SurveyStorageLimitError, stableOutcome, verifiedEpisode };
