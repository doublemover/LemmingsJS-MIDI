import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const contexts = new WeakMap();
export function loadOwnedWorkletModule(context, source, resources = null) {
  if (!context?.audioWorklet?.addModule || context.state === 'closed') return Promise.reject(new Error('Owned source context is unavailable.'));
  let cache = contexts.get(context);
  if (!cache) {
    cache = { entries: new Map(), retirement: createProcgenRetirementScope(), close: null };
    cache.close = () => {
      if (context.state !== 'closed') return;
      return cache.retirement.retire([{ name: 'context-module-listener', run: () => context.removeEventListener?.('statechange', cache.close) },
        ...[...cache.entries.values()].map(entry => ({ name: entry.id, run: () => { entry.state = 'closed'; return entry.resource?.release(); } }))]);
    };
    context.addEventListener?.('statechange', cache.close); contexts.set(context, cache);
  }
  const url = source.runtime.workletUrl, known = cache.entries.get(url); if (known) return known.promise;
  const moduleClass = source.moduleClass === 'effect' ? 'effect' : 'source';
  const classCount = [...cache.entries.values()].filter(entry => entry.moduleClass === moduleClass).length;
  if (cache.entries.size >= 6 || classCount >= (moduleClass === 'effect' ? 1 : 5)) return Promise.reject(new Error('Owned source module capacity reached.'));
  if (source.heapEstimate && resources && typeof context.addEventListener !== 'function') return Promise.reject(new Error('Source module lifetime observation is unavailable.'));
  let resource = null;
  try { if (source.heapEstimate) resource = resources?.reserve({ kind: 'worklet-module-cache', owner: null, bytes: 0, estimateBytes: source.heapEstimate, consumerOwned: true }) || null; }
  catch (error) { return Promise.reject(error); }
  if (context.state === 'closed') { resource?.release(); return Promise.reject(new Error('Owned source context closed during admission.')); }
  const entry = { id: source.id, moduleClass, state: 'loading', resource, promise: null, estimatedBytes: source.heapEstimate }; cache.entries.set(url, entry);
  try { entry.promise = Promise.resolve(context.audioWorklet.addModule(url)); } catch (error) { entry.promise = Promise.reject(error); }
  entry.promise.then(() => { if (entry.state !== 'closed') entry.state = 'ready'; }, () => { if (entry.state !== 'closed') { entry.state = 'failed'; if (!entry.resource && cache.entries.get(url) === entry) cache.entries.delete(url); } });
  return entry.promise;
}
export function inspectOwnedWorkletModule(context, url) {
  const cache = contexts.get(context), entry = cache?.entries.get(url);
  return entry ? Object.freeze({ id: entry.id, state: entry.state, estimatedBytes: entry.estimatedBytes, ownership: 'context-lifetime-module-estimate',
    retirement: cache.retirement.getReceipt()?.outcome || null }) : null;
}

export function retireClosedOwnedWorkletContext(context) {
  if (context?.state !== 'closed') throw new Error('Module retirement requires the native context closed proof.');
  return contexts.get(context)?.close() || null;
}
