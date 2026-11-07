import { validateAcousticMap } from '../../midi/content/AcousticMap.js';
import { createAcousticZoneRecipe } from '../../midi/content/AcousticZoneRecipes.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';
import { prepareNativeEffectGraph } from './NativeEffectGraph.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createAcousticZoneAudioOwner({ context, resources, owner, generation, destination, getMaterialProvider, jobs, isCurrent = () => true, onState = () => {} } = {}) {
  if (!context?.createBiquadFilter || !resources?.reserve || !destination?.connect) throw new TypeError('Acoustic returns need an owned native context and output.');
  const groups = new Map(), scope = createProcgenRetirementScope(); let current = null, pending = null, disposed = false, fault = null;
  const state = ({ includeRealization = false } = {}) => Object.freeze({ ready: !!current && !disposed && !fault, mapId: current?.map.id || null, mapRevision: current?.map.revision ?? null, mapHash: current?.hash || null, preparing: !!pending, retainedMaps: groups.size,
    groups: [...groups.values()].map(group => ({ hash: group.hash, mapId: group.map.id, revision: group.map.revision, references: group.references, retirement: group.retirement?.outcome || null, returns: group.returns.map(row => ({ responseId: row.id, recipeId: row.recipe.id, graphHash: row.graph?.hash || null, lowpassHz: row.recipe.lowpassHz, highpassHz: row.recipe.highpassHz, realization: includeRealization ? row.graph?.diagnostics() || null : null })) })), fault: fault?.message || null });
  const report = () => { try { onState(state()); } catch {} };
  const retire = group => {
    if (group.retirement) return group.retirement;
    const nativeRetirement = createProcgenRetirementScope().retire([
      ...group.returns.filter(row => row.graph).map(row => ({ name: 'zone-return-' + row.id, run: () => row.graph.dispose() })),
      { name: 'zone-native-routing', run: () => { for (const row of group.returns) for (const node of row.nodes) node.disconnect(); } }
    ]);
    const retirement = createProcgenRetirementScope().retire([{ name: 'acoustic-native-and-storage', run: async () => {
      await nativeRetirement.completion;
      if (nativeRetirement.outcome !== 'complete') { const error = new Error('Acoustic return producer retirement is unresolved.'); group.lease.retainUnknown(error); throw error; }
      try { group.lease.release(); } catch (error) { group.lease.retainUnknown(error); throw error; }
    } }]); group.retirement = retirement;
    retirement.completion.then(receipt => { if (receipt.outcome === 'complete') groups.delete(group.hash); else fault ||= new Error('Acoustic return retirement remains unresolved.'); report(); }); return retirement;
  };
  const collect = () => { for (const group of groups.values()) if (group !== current && !group.references && context.currentTime >= group.retainUntil) retire(group); };
  const guard = (signal, check) => { signal?.throwIfAborted(); if (disposed || fault || !isCurrent() || context.state !== 'running' || check && !check()) throw new Error('The acoustic-map request changed before source publication.'); };
  return Object.freeze({ state, collect,
    matches(raw) { return !!current && !disposed && !fault && (raw === current.raw || canonicalDataText(raw, { maxBytes: 131072, maxNodes: 16384 }).text === current.signature); },
    async prepare(raw, { signal: externalSignal, isCurrent: check } = {}) {
      guard(externalSignal, check); if (pending) throw new Error('Another acoustic map is still preparing.'); collect();
      const map = validateAcousticMap(raw), signature = canonicalDataText(map, { maxBytes: 131072, maxNodes: 16384 }).text;
      if (current?.signature === signature) return state();
      const controller = new AbortController(), signal = controller.signal, abort = () => controller.abort(externalSignal.reason);
      externalSignal?.addEventListener('abort', abort, { once: true }); if (externalSignal?.aborted) abort();
      let settle; const token = { controller, completion: new Promise(resolve => { settle = resolve; }) }; pending = token; let group = null;
      try {
        const hash = await hashData(map, { maxBytes: 131072, maxNodes: 16384 }); guard(signal, check);
        const retained = groups.get(hash);
        if (retained) {
          if (retained.retirement) throw new Error('This acoustic map is still retiring; wait for its owned returns.');
          const previous = current; current = retained; retained.raw = raw; if (previous && previous !== retained) previous.retainUntil = Math.max(previous.retainUntil, context.currentTime + 3); report(); return state();
        }
        if (groups.size >= 3) throw new Error('Three acoustic-map revisions still own sources or bounded return tails. Retire them before another replacement.');
        group = { map, raw, signature, hash, references: 0, retainUntil: 0, returns: [], lease: resources.reserve({ kind: 'acoustic-map-routing', owner, generation, estimateBytes: 262144, consumerOwned: true }), retirement: null };
        groups.set(hash, group);
        for (const response of map.materialResponses) {
          guard(signal, check); const recipe = createAcousticZoneRecipe(response.effectRecipe.id, context.sampleRate, map.controls.absorb01), row = { id: response.id, recipe, graph: null, input: null, nodes: [] }; group.returns.push(row);
          if (!recipe.graph) continue;
          row.graph = await prepareNativeEffectGraph(recipe.graph, { context, resources, owner, generation, signal, getMaterialProvider, jobs, isCurrent: () => !disposed && isCurrent() && (!check || check()) }); guard(signal, check);
          row.input = row.graph.getInput('input');
          const low = context.createBiquadFilter(); row.nodes.push(low); const high = context.createBiquadFilter(); row.nodes.push(high);
          low.type = 'lowpass'; low.frequency.setValueAtTime(Math.min(context.sampleRate * 0.4, recipe.lowpassHz), context.currentTime); low.Q.setValueAtTime(Math.SQRT1_2, context.currentTime);
          high.type = 'highpass'; high.frequency.setValueAtTime(recipe.highpassHz, context.currentTime); high.Q.setValueAtTime(Math.SQRT1_2, context.currentTime);
          row.graph.getOutput('output').connect(high); high.connect(low); low.connect(destination);
          await row.graph.confirmReady(); guard(signal, check);
        }
        const previous = current; current = group; if (previous) previous.retainUntil = Math.max(previous.retainUntil, context.currentTime + 3); collect(); report(); return state();
      } catch (error) { if (group) { const receipt = retire(group); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; } throw error; }
      finally { externalSignal?.removeEventListener('abort', abort); if (pending === token) pending = null; settle(); report(); }
    },
    pin(state) {
      if (!current || disposed || fault || !isCurrent() || state.mapId !== current.map.id || state.mapRevision !== current.map.revision) throw new Error('The exact acoustic-map revision is not prepared.');
      const group = current; group.references++; let released = false;
      return Object.freeze({ mapHash: group.hash, returns: Object.freeze(group.returns.map(row => Object.freeze({ id: row.id, node: row.input, dry: !row.graph }))),
        release() { if (released) return; released = true; group.references--; group.retainUntil = Math.max(group.retainUntil, context.currentTime + 3); collect(); report(); } });
    },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; current = null; const preparation = pending; preparation?.controller.abort(new Error('Acoustic map owner retired.')); return scope.retire([{ name: 'acoustic-map-producers-and-returns', run: async () => { await preparation?.completion; const receipts = [...groups.values()].map(retire); await Promise.all(receipts.map(receipt => receipt.completion)); if (receipts.some(receipt => receipt.outcome !== 'complete') || groups.size) throw new Error('Acoustic return producer or storage ownership remains unresolved.'); } }]); }
  });
}
