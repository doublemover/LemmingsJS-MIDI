import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FileProvider } from '../../js/data/FileProvider.js';
import { createScheduledCacheDatabase } from './scheduled-cache-database.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
const entryFor = command => ({ type: 'text', data: command.value, generation: command.id, hash: createHash('sha256').update(command.value).digest('hex') });

export const generateCacheScenario = (seed, { steps = 64 } = {}) => ({ schema: 'cache-transaction-model-scenario/v1', seed, steps });
export async function replayCacheTrace(input, { checkBudget = () => {}, providerFactory = options => new FileProvider('/', options) } = {}) {
  const scenario = !Array.isArray(input);
  if (scenario && (input?.schema !== 'cache-transaction-model-scenario/v1' || !Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff || !Number.isSafeInteger(input.steps) || input.steps < 1 || input.steps > 128)) throw new TypeError('Invalid cache transaction scenario.');
  if (!scenario && (!input.length || input.length > 4096)) return { valid: false, step: 0 };
  const expected = new Map(), jobs = new Map(), states = [{ disposed: false, bytes: 0 }, { disposed: false, bytes: 0 }], trace = [], observations = [];
  let spawning = null, serial = 0, autoSerial = 0, index = 0, cursor = 0, word = scenario ? input.seed || 1 : 1;
  const draw = count => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % count; };
  const total = () => [...expected.values()].reduce((sum, value) => sum + Buffer.byteLength(value.data), 0);
  const database = createScheduledCacheDatabase({
    onCreate(tx) {
      let job = spawning;
      if (!job) { assert.deepEqual(tx.scopes, ['entries'], 'cache-model:unexpected-automatic-scope'); job = { id: 'touch-' + autoSerial++, owner: tx.owner, kind: 'touch', phase: 'pending', automatic: true }; jobs.set(job.id, job); }
      job.tx = tx; tx.job = job;
    },
    onActivate(tx) { tx.job.expectedRead = structuredClone(expected.get(tx.job.url)); },
    onCommit(tx) {
      const job = tx.job; job.phase = 'committed';
      if (job.kind === 'write') expected.set(job.url, entryFor(job));
      if (job.kind === 'write' || job.kind === 'prune') states[job.owner].bytes = total();
    },
    onAbort(tx) { if (tx.job) tx.job.phase = 'aborted'; }
  });
  const providers = states.map((_state, owner) => providerFactory({ indexedDB: database.indexedDB(owner), localStorage: null, cacheProbeMs: 10000 }));
  const inspect = () => {
    const entries = database.stores.get('entries'), payloads = database.stores.get('payloads'), meta = database.stores.get('meta');
    assert.equal(entries.size, expected.size, 'cache-model:committed-metadata-count'); assert.equal(payloads.size, expected.size, 'cache-model:committed-payload-count');
    for (const [url, value] of expected) {
      const actual = entries.get(url), payload = payloads.get(url);
      assert.deepEqual({ type: actual.type, hash: actual.hash, generation: actual.generation, size: actual.size },
        { type: value.type, hash: value.hash, generation: value.generation, size: Buffer.byteLength(value.data) }, 'cache-model:committed-metadata');
      assert.deepEqual(payload, { url, formatVersion: 2, generation: value.generation, data: value.data }, 'cache-model:committed-payload');
      assert.ok(Number.isFinite(actual.lastAccess) && Number.isFinite(actual.fetchedAt), 'cache-model:metadata-time');
    }
    if (meta.has('totalBytes')) assert.deepEqual(meta.get('totalBytes'), { key: 'totalBytes', accountingVersion: 2, value: total() }, 'cache-model:committed-byte-total');
    else assert.equal(expected.size, 0, 'cache-model:missing-byte-total');
    for (let owner = 0; owner < providers.length; owner++) {
      assert.equal(providers[owner]._disposed, states[owner].disposed, 'cache-model:provider-retirement');
      assert.equal(providers[owner].getCacheStats().indexedDbBytes, states[owner].bytes, 'cache-model:provider-observed-total');
      assert.equal(providers[owner]._cacheTransactions.size, database.pending().filter(tx => tx.owner === owner).length, 'cache-model:transaction-ownership');
    }
    for (const job of jobs.values()) {
      if (job.automatic || job.phase === 'pending') continue;
      assert.equal(job.settled, true, 'cache-model:terminal-request-liveness');
      if (job.kind === 'write') assert.equal(job.valueResult, job.phase === 'committed', 'cache-model:write-acknowledgment');
      if (job.kind === 'read') {
        const wanted = job.phase === 'committed' ? job.expectedRead : undefined;
        assert.equal(job.valueResult?.value ?? null, wanted?.data ?? null, 'cache-model:read-snapshot');
        if (wanted && job.valueResult) assert.equal(job.valueResult.entry.generation, wanted.generation, 'cache-model:read-generation');
      }
      if (job.error) throw job.error;
    }
    observations.push({ index, committed: expected.size, bytes: total(), nativePending: database.pending().map(tx => ({ id: tx.id, owner: tx.owner, kind: tx.job.kind, state: tx.state, requests: tx.requests.length })), providers: states.map(s => ({ ...s })) });
  };
  const choose = () => {
    const choices = [];
    if (database.pending().length) choices.push({ kind: 'native-step' }, { kind: 'native-step' }, { kind: 'native-step' });
    for (let owner = 0; owner < states.length; owner++) if (!states[owner].disposed) {
      if (serial < 24) {
        const url = '/cache-' + draw(3), value = ['old', 'new payload', 'é/🙂'][draw(3)] + serial;
        choices.push({ kind: 'write', id: 'write-' + serial, owner, url, value }, { kind: 'read', id: 'read-' + serial, owner, url }, { kind: 'prune', id: 'prune-' + serial, owner });
      }
      if (database.pending().some(tx => tx.owner === owner)) choices.push({ kind: 'clear', owner });
      if (index > input.steps / 2) choices.push({ kind: 'dispose', owner });
    }
    return choices.length ? choices[draw(choices.length)] : null;
  };
  const apply = async command => {
    const owner = command.owner, provider = providers[owner];
    if (command.kind !== 'native-step' && owner !== 0 && owner !== 1) return false;
    if (command.kind === 'native-step') { if (!database.step()) return false; }
    else if (command.kind === 'clear' || command.kind === 'dispose') {
      if (!provider || states[owner].disposed) return false;
      if (command.kind === 'clear') provider.clearCache(); else { states[owner].disposed = true; provider.dispose(); }
    } else {
      if (!['write', 'read', 'prune'].includes(command.kind) || !provider || states[owner].disposed || typeof command.id !== 'string' || !command.id || command.id.length > 80 || command.id.startsWith('touch-') || jobs.has(command.id) || serial >= 24 || command.kind !== 'prune' && (typeof command.url !== 'string' || !command.url.startsWith('/') || command.url.length > 80) || command.kind === 'write' && (typeof command.value !== 'string' || Buffer.byteLength(command.value) > 256)) return false;
      const job = { ...command, phase: 'pending', settled: false }; jobs.set(job.id, job); spawning = job; serial++;
      const pending = command.kind === 'write' ? provider._storeInIndexedDb(command.url, entryFor(command)) : command.kind === 'read' ? provider._loadFromIndexedDb(command.url, 'text') : provider._pruneIndexedDb();
      job.promise = pending.then(value => { job.settled = true; job.valueResult = value; }, error => { job.settled = true; job.error = error; });
    }
    await flush(); spawning = null; return true;
  };
  try {
    if (scenario && input.seed % 2) {
      const bootstrap = { kind: 'write', id: 'bootstrap', owner: 0, url: '/cache-0', value: 'bootstrap-' + input.seed };
      trace.push(bootstrap); await apply(bootstrap); inspect(); index++;
      for (let guard = 0; database.pending().length; guard++) {
        if (guard >= 2048) throw new Error('cache-model:bounded-native-drain'); checkBudget(); const native = { kind: 'native-step' }; trace.push(native); await apply(native); inspect(); index++;
      }
    }
    while (scenario ? index < input.steps : cursor < input.length) {
      checkBudget(); const command = scenario ? choose() : input[cursor++]; if (!command) break;
      if (command.kind === 'drain') {
        if (!database.pending().length) return { valid: false, step: index };
        for (let guard = 0; database.pending().length; guard++) {
          if (guard >= 2048) throw new Error('cache-model:bounded-native-drain'); checkBudget(); const native = { kind: 'native-step' }; trace.push(native); await apply(native); inspect(); index++;
        }
        continue;
      }
      trace.push(command); if (!await apply(command)) return { valid: false, step: index }; inspect(); index++;
    }
    if (scenario) {
      for (let guard = 0; database.pending().length; guard++) {
        if (guard >= 2048) throw new Error('cache-model:bounded-native-drain'); checkBudget(); const command = { kind: 'native-step' }; trace.push(command); await apply(command); inspect(); index++;
      }
      for (let owner = 0; owner < providers.length; owner++) if (!states[owner].disposed) { const command = { kind: 'dispose', owner }; trace.push(command); await apply(command); inspect(); index++; }
    }
    return { valid: true, trace, transitions: trace.length, observations, complete: states.every(s => s.disposed) && !database.pending().length, committedEntries: expected.size, committedBytes: total() };
  } catch (error) { error.modelTrace = trace; error.modelStep = index; error.modelObservations = observations; throw error; }
  finally { for (const provider of providers) provider.dispose(); for (const tx of database.pending()) tx.abort(); await flush(); await Promise.all([...jobs.values()].map(job => job.promise)); await flush(); assert.equal(database.pending().length, 0, 'cache-model:final-native-transactions'); for (const provider of providers) assert.equal(provider._cacheTransactions.size, 0, 'cache-model:final-owner-transactions'); }
}
