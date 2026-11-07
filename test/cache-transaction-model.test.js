import { expect } from 'chai';
import { readFile } from 'node:fs/promises';
import { FileProvider } from '../js/data/FileProvider.js';
import { generateCacheScenario, replayCacheTrace } from './support/cache-transaction-model.js';
import { shrinkModelTrace } from './support/model-trace.js';

describe('generated persistent-cache serial publication schedules', function() {
  this.timeout(30000);
  for (const seed of [1, 2, 3, 17, 101, 997, 4201, 9991186, 0xc47a31, 0x7fffffff, 0x80000000, 0xffffffff])
    it('keeps paired generations and totals across two native owners seed=' + seed, async () => {
      const result = await replayCacheTrace(generateCacheScenario(seed, { steps: 64 })); expect(result).to.include({ valid: true, complete: true });
    });
  it('preserves coherent reads when a newer writer queues between metadata and payload responses', async () => {
    const trace = [
      { kind: 'write', id: 'original', owner: 0, url: '/asset', value: 'old bytes' }, { kind: 'drain' },
      { kind: 'read', id: 'old-read', owner: 0, url: '/asset' }, { kind: 'native-step' },
      { kind: 'write', id: 'newer', owner: 1, url: '/asset', value: 'é/🙂 new bytes' }, { kind: 'drain' },
      { kind: 'read', id: 'new-read', owner: 0, url: '/asset' }, { kind: 'drain' },
      { kind: 'prune', id: 'delayed-prune', owner: 0 }, { kind: 'drain' },
      { kind: 'dispose', owner: 0 }, { kind: 'dispose', owner: 1 }
    ];
    expect(await replayCacheTrace(trace)).to.include({ valid: true, complete: true, committedEntries: 1 });
  });
  it('aborts only the clearing/disposed owner while a queued peer publishes its own transaction', async () => {
    for (const interruption of ['clear', 'dispose']) {
      const trace = [
        { kind: 'write', id: 'retired', owner: 0, url: '/asset', value: 'never commit' }, { kind: 'native-step' },
        { kind: 'write', id: 'peer', owner: 1, url: '/asset', value: 'accepted peer' }, { kind: interruption, owner: 0 },
        { kind: 'drain' }, ...(interruption === 'clear' ? [{ kind: 'dispose', owner: 0 }] : []), { kind: 'dispose', owner: 1 }
      ];
      expect(await replayCacheTrace(trace)).to.include({ valid: true, complete: true, committedEntries: 1 });
    }
  });
  it('shrinks an injected stale provider total without accepting invalid native-event deletions', async () => {
    class StaleTotalProvider extends FileProvider {
      async _storeInIndexedDb(...args) { const result = await super._storeInIndexedDb(...args); if (result) this._cacheStats.indexedDbBytes = 0; return result; }
    }
    const fixture = JSON.parse(await readFile(new URL('./fixtures/cache-transaction-stale-total.json', import.meta.url)));
    let original;
    try { await replayCacheTrace(fixture.trace, { providerFactory: options => new StaleTotalProvider('/', options) }); }
    catch (error) { expect(error.message).to.include('cache-model:provider-observed-total'); original = error.modelTrace; }
    expect(original).to.be.an('array');
    const fails = async trace => { try { await replayCacheTrace(trace, { providerFactory: options => new StaleTotalProvider('/', options) }); return false; } catch (error) { if (!error.message.includes('cache-model:provider-observed-total')) throw error; return true; } };
    const reduced = await shrinkModelTrace(original, fails);
    expect(reduced.trace.length).to.be.lessThan(original.length); expect(await fails(reduced.trace)).to.equal(true);
    expect(await replayCacheTrace(reduced.trace)).to.include({ valid: true });
    for (let index = 0; index < reduced.trace.length; index++) expect(await fails(reduced.trace.filter((_value, at) => at !== index))).to.equal(false);
  });
  it('refuses empty schedules and native completions without an owned transaction', async () => {
    expect(await replayCacheTrace([])).to.include({ valid: false });
    expect(await replayCacheTrace([{ kind: 'native-step' }])).to.include({ valid: false });
  });
});
