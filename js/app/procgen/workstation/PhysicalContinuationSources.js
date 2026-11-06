import { resolveSoundContentReference } from '../../../midi/content/SoundContentReference.js';
import { getNativeInstrumentCatalog } from '../../midi-ui/NativeInstrumentSchema.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'physical-continuation-sources' }); };
const join = async receipt => { await receipt?.completion; if (receipt?.outcome && receipt.outcome !== 'complete') throw Object.assign(new Error('Continuation source retirement is unresolved.'), { retirement: receipt }); };
const sameReference = (a, b) => a?.packHash === b?.packHash && a?.definitionHash === b?.definitionHash;
export async function preparePhysicalContinuationSources({ owner, cut, lanes, signal, isCurrent = () => true, getCatalog = getNativeInstrumentCatalog } = {}) {
  const state = cut?.metadata?.()?.bindings?.physical, captured = cut?.sources?.();
  if (!owner?.prepareRestorationLane || !owner.audioContinuation?.createSource || !Array.isArray(lanes) || !Array.isArray(captured) || state?.schema !== 'lemmings-physical-body-continuation/v1' || state.routing?.schema !== 'lemmings-routed-source-continuation/v1' || state.routing.sources.length !== captured.length || state.routing.sources.length > 16) fail('Prepare the complete captured physical source/routing inventory in its staged owner.');
  const check = () => { signal?.throwIfAborted(); if (!isCurrent()) fail('The physical source/project changed during exact source preparation.'); };
  check(); if (!await owner.audioContinuation.enable()) fail('The fresh local audio context is unavailable.'); check();
  const sources = [], selected = new Set(), references = [], provider = owner.audioContinuation.provider(); let catalog = null;
  for (const source of state.routing.sources) {
    check(); const original = captured.find(row => row.sourceId === source.sourceId); if (!original) fail('A captured routed source has no complete DSP cut.');
    let backend = null;
    if (source.lanes.length) {
      for (const laneId of source.lanes) {
        const lane = lanes.find(row => row.id === laneId); if (!lane?.instrumentRef) fail('The captured owned lane lost its original requested patch.');
        const candidate = await owner.prepareRestorationLane(laneId, lane.instrumentRef, { signal, effectiveReference: source.reference, realizationDecision: source.realization, restorationSourceId: source.sourceId });
        try { check(); candidate.validateCommit(); candidate.commit(); } finally { const receipt = candidate.release(); await join(receipt); }
        const assigned = owner.audioContinuation.assignment(laneId); if (!assigned || backend && assigned !== backend) fail('One historical source must keep its exact shared lane ownership.'); backend = assigned;
      }
    } else {
      catalog ||= await getCatalog(); check();
      let material = null, retiring = null, failure = null; const retirement = createProcgenRetirementScope();
      const abort = () => { if (backend) retiring ||= backend.dispose(); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (source.reference.assetHashes.length) { if (!provider?.acquire) fail('The original tail source material loader is unavailable.'); material = await provider.acquire({ reference: source.reference, engineDescriptors: catalog.descriptors, owner: 'historical-tail:' + source.sourceId, generation: 0, signal, isCurrent }); check(); }
        const resolution = await resolveSoundContentReference(source.reference, { engineDescriptors: catalog.descriptors, availableHashes: material?.availableHashes || [], signal }); check();
        if (resolution.status !== 'ready') fail('The exact historical tail patch is unavailable.');
        backend = await owner.audioContinuation.createSource({ engineId: source.reference.engineRequirement.engineId, publicationMuted: true }); check();
        const ready = await backend.prepare(resolution, material?.assets || []); check(); if (ready?.status !== 'ready') fail('The historical tail source could not prepare its pinned renderer.');
      } catch (error) { failure = error; }
      signal?.removeEventListener('abort', abort);
      const producer = createProcgenRetirementScope();
      const receipt = retirement.retire([{ name: 'historical-tail-preparation', run: () => producer.retire(failure || retiring ? [{ name: 'renderer', run: () => retiring || backend?.dispose() }] : []) },
        { name: 'historical-tail-material', run: async () => { await join(producer.getReceipt()); if (material) await join(material.release()); } }]);
      await receipt.completion;
      if (receipt.outcome !== 'complete') failure ||= Object.assign(new Error('Historical source preparation retains unresolved ownership.'), { retirement: receipt });
      if (failure) { if (receipt.outcome !== 'complete') failure.retirement = receipt; throw failure; }
    }
    check(); const metadata = original.cut.metadata(), actual = backend?.sourceContentReference?.();
    if (!backend || selected.has(backend) || !sameReference(actual, source.reference) || backend.renderDiagnostics().preparedVoices !== metadata.cut.maxVoices) fail('The incoming source instance, patch or DSP dimensions differ from the exact image.');
    selected.add(backend); sources.push({ sourceId: source.sourceId, backend, metadata }); references.push({ sourceId: source.sourceId, reference: source.reference });
  }
  const registered = owner.audioContinuation.sources().filter(row => typeof row.backend.restoreSourceState === 'function');
  if (registered.length !== sources.length || registered.some(row => !selected.has(row.backend))) fail('A fresh source outside the retained image would make this restoration incomplete.');
  return Object.freeze({ state, sources: Object.freeze(sources), references: Object.freeze(references) });
}
