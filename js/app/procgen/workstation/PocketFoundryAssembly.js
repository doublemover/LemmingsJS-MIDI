import { createShapeFoundryOwner } from '../../midi-ui/ShapeFoundryOwner.js';
import { ORIGINAL_SHAPE_BODY_IDS } from '../../../midi/content/OriginalShapeMeshes.js';
import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export function createPocketFoundryAssembly({ audio, resourceBudget, jobs, getCatalog, onState = () => {} } = {}) {
  const scope = createProcgenRetirementScope(), foundry = createShapeFoundryOwner({ audio, resourceBudget, jobs, getCatalog, onApply() { throw new Error('Foundry score assembly does not apply lane instruments.'); }, onState });
  let disposed = false, operation = null, unresolved = false, retainedStorage = null;
  return Object.freeze({
    prepare({ modeCount = 8, sampleRate = 48000, signal, isCurrent = () => true } = {}) {
      if (disposed || operation || unresolved || retainedStorage || ![8, 16, 32].includes(modeCount) || ![44100, 48000, 96000].includes(sampleRate)) return Promise.reject(new Error('Choose one admitted foundry tier/rate and finish the previous assembly.'));
      const controller = new AbortController(), abort = () => { controller.abort(signal?.reason || new Error('Foundry score assembly canceled.')); foundry.stop(); }, storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'pocket-foundry-assembly', kind: 'three-verified-scene-source-references', category: 'candidate', bytes: 2 * 1048576 });
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      const current = () => !disposed && !controller.signal.aborted && isCurrent();
      const work = { controller, promise: null }; operation = work;
      work.promise = (async () => {
        try {
          const sources = [];
          for (const shapeId of ORIGINAL_SHAPE_BODY_IDS) {
            controller.signal.throwIfAborted(); if (!current()) throw new Error('The score assembly document changed.');
            await foundry.prepare({ shapeId, modeCount, sampleRate, seconds: 2 }, { isCurrent: current });
            const source = await foundry.saveSceneSource({ isCurrent: current }); controller.signal.throwIfAborted(); if (!current()) throw new Error('The score assembly document changed.'); sources.push(source);
            canonicalDataText(sources, { maxBytes: 262144, maxNodes: 32768 });
          }
          const value = freezeData({ schema: 'lemmings-pocket-foundry-sources/v1', modeCount, sampleRate, sources, sourcePolicy: 'three-original-solids;verified-durable-site-banks;no-audition-or-lane-application' }); retainedStorage = storage; return value;
        } finally { signal?.removeEventListener('abort', abort); try { if (retainedStorage !== storage) storage.release(); } catch (error) { retainedStorage = storage; unresolved = true; throw error; } finally { operation = null; } }
      })(); return work.promise;
    },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; operation?.controller.abort(new Error('Foundry score owner retired.')); foundry.stop(); const pending = operation?.promise, source = foundry.dispose();
      return scope.retire([{ name: 'foundry-score-source', run: () => source }, { name: 'foundry-score-assembly', run: async () => { try { await pending; } catch {} await source.completion; if (unresolved || source.outcome !== 'complete') throw new Error('Foundry assembly/source storage remains unresolved.'); retainedStorage?.release(); retainedStorage = null; } }]); }
  });
}
