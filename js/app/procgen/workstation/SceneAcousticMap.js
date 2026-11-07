import { canonicalDataText } from '../../../core/CanonicalData.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export function createSceneAcousticMap({ getGraph, getContext, session, onState = () => {} } = {}) {
  const scope = createProcgenRetirementScope(); let pending = null, disposed = false, failedContext = null, failedSignature = null, error = null;
  let cachedMap = null, cachedSignature = null;
  const signature = map => { if (map === cachedMap) return cachedSignature; cachedSignature = map ? canonicalDataText(map, { maxBytes: 131072, maxNodes: 16384 }).text : null; cachedMap = map; return cachedSignature; };
  return Object.freeze({
    ensure() {
      const map = getGraph()?.acousticMap, context = getContext(); if (disposed || !map || context?.state !== 'running') return Promise.resolve(false);
      if (typeof session?.prepareAcousticMap !== 'function') { error = 'This audio owner cannot prepare shared acoustic zones.'; return Promise.resolve(false); }
      const key = signature(map); if (session.acousticMapMatches?.(map)) return Promise.resolve(true);
      if (pending) { if (pending.context !== context || pending.key !== key) pending.controller.abort(new Error('The acoustic map changed.')); return pending.completion; }
      if (failedContext === context && failedSignature === key) return Promise.resolve(false);
      const token = { key, context, controller: new AbortController(), completion: null }; pending = token;
      token.completion = session.prepareAcousticMap(map, { signal: token.controller.signal, isCurrent: () => !disposed && getContext() === context && signature(getGraph()?.acousticMap || null) === key }).then(() => { error = null; return true; }, failure => { if (!token.controller.signal.aborted) { failedContext = context; failedSignature = key; error = failure.message; try { onState({ laneId: 'acoustic-map', state: 'unavailable', code: error }); } catch {} } return false; }).finally(() => { if (pending === token) pending = null; });
      return token.completion;
    },
    reset() { pending?.controller.abort(new Error('Acoustic-map preparation stopped.')); failedContext = failedSignature = error = null; }, retry() { failedContext = failedSignature = error = null; },
    state: () => Object.freeze({ preparing: !!pending, error, owner: session?.acousticMapState?.() || null }),
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; const work = pending; work?.controller.abort(new Error('Acoustic-map source retired.')); return scope.retire([{ name: 'acoustic-map-preparation', run: () => work?.completion }]); }
  });
}
