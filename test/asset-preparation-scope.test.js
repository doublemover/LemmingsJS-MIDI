import assert from 'node:assert/strict';
import { prepareAssetCollections } from '../js/data/file-provider/AssetPreparationScope.js';
import { ResourceLoadError } from '../js/data/file-provider/ResourceLoadError.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('asset preparation acquisition scope', () => {
  it('bounds collection concurrency and reports useful collection completion', async () => {
    const gates = [], progress = []; let running = 0, peak = 0;
    const tasks = Array.from({ length: 7 }, (_, id) => ({ id: String(id), prepare: async () => {
      running++; peak = Math.max(peak, running);
      await new Promise(resolve => { gates.push(() => { running--; resolve(); }); });
      return id;
    } }));
    const pending = prepareAssetCollections(tasks, { concurrency: 2, operationId: 'candidate-7', onProgress: state => progress.push(state) });
    await settle(); assert.equal(running, 2);
    for (let i = 0; i < tasks.length; i++) { gates.shift()(); await settle(); }
    assert.deepEqual((await pending).map(result => result.value), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(peak, 2); assert.equal(progress.at(-1).completed, 7);
    assert.equal(progress.at(-1).operationId, 'candidate-7');
  });

  it('cancels failed siblings, retires already acquired resources and reconciles a late acquisition', async () => {
    let finishLate, cleanedReady = 0, cleanedLate = 0, siblingSignal;
    const pending = prepareAssetCollections([
      { id: 'ready', prepare: async ({ registerCleanup }) => { registerCleanup(() => { cleanedReady++; }); return 'ready'; } },
      { id: 'late', prepare: async ({ signal, registerCleanup }) => {
        siblingSignal = signal;
        await new Promise(resolve => { finishLate = resolve; });
        registerCleanup(() => { cleanedLate++; });
        return 'too late';
      } },
      { id: 'missing', prepare: async () => { throw new ResourceLoadError('not-found', 'required-file'); } }
    ], { concurrency: 3 });
    await assert.rejects(pending, error => error.kind === 'not-found' && error.collection === 'missing');
    assert.equal(siblingSignal.aborted, true); assert.equal(cleanedReady, 1);
    finishLate(); await settle(); assert.equal(cleanedLate, 1);
  });

  it('allows an optional failure while preserving required work and its transferred resource', async () => {
    let requiredCleanup = 0, optionalCleanup = 0;
    const results = await prepareAssetCollections([
      { id: 'required', prepare: async ({ registerCleanup }) => { registerCleanup(() => { requiredCleanup++; }); return 'playable'; } },
      { id: 'optional', required: false, prepare: async ({ registerCleanup }) => {
        registerCleanup(() => { optionalCleanup++; }); throw new Error('Optional collection unavailable');
      } }
    ]);
    assert.equal(results[0].value, 'playable'); assert.equal(results[1].status, 'rejected');
    assert.equal(requiredCleanup, 0); assert.equal(optionalCleanup, 1);
  });

  it('awaits an already started asynchronous sibling cleanup before rejecting', async () => {
    let finishCleanup, cleanupStarted = false, rejected = false;
    const pending = prepareAssetCollections([
      { id: 'owned', prepare: async ({ registerCleanup }) => {
        registerCleanup(() => { cleanupStarted = true; return new Promise(resolve => { finishCleanup = resolve; }); });
        return 'owned';
      } },
      { id: 'failed', prepare: async () => { throw new Error('Required failure'); } }
    ]).catch(error => { rejected = true; throw error; });
    await settle(); assert.equal(cleanupStarted, true); assert.equal(rejected, false);
    finishCleanup(); await assert.rejects(pending, error => error.collection === 'failed');
  });

  it('cancels before any acquisition and prevents progress observers from owning the operation', async () => {
    const controller = new AbortController(); controller.abort(); let started = 0;
    await assert.rejects(prepareAssetCollections([{ id: 'unused', prepare: async () => { started++; } }],
      { signal: controller.signal }), error => error.kind === 'cancelled');
    assert.equal(started, 0);
    const results = await prepareAssetCollections([{ id: 'live', prepare: async () => 'live' }],
      { onProgress: () => { throw new Error('Broken observer'); } });
    assert.equal(results[0].value, 'live');
  });
});
