import { createCausalTakeAudioRenderer } from './CausalTakeAudioRender.js';
import { createPreparedWavePrelisten } from './PreparedWavePrelisten.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { cloneData, freezeData } from '../../core/CanonicalData.js';

const fail = message => Object.assign(new Error(message), { code: 'causal-take-seek-unavailable' });
let nextOwner = 0;
export function createCausalTakeSeekOwner({ audio, journal, resourceBudget, jobs, getMaterialProvider = null, onState = () => {}, onReveal } = {}) {
  if (!audio?.createSession || !journal?.queryOwned || !resourceBudget) throw new TypeError('Take seek needs the existing causal journal, isolated audio and shared resource owners.');
  const id = 'causal-seek-' + (++nextOwner), scope = createProcgenRetirementScope(), retained = new Set(); let current = null, active = null, queued = null, pumping = null, stopping = null, disposed = false, serial = 0, phase = 'idle', failure = null, last = null;
  const state = () => Object.freeze({ phase, active: !!active || !!queued, playing: !!current?.prelisten.state().playing, request: active?.request.serial ?? queued?.serial ?? null,
    last, error: failure, retainedCandidates: retained.size, source: current?.receipt || null, disposed });
  const report = () => { try { onState(state()); } catch {} };
  const close = record => {
    if (!record) return createProcgenRetirementScope().retire(); if (record.retirement.getReceipt()) return record.retirement.getReceipt(); record.controller.abort(); record.renderer?.cancel();
    const receipt = record.retirement.retire([{ name: 'seek-source-preparation', run: () => record.preparation?.catch(() => {}) },
      { name: 'seek-cue-producer', run: async () => { await record.preparation?.catch(() => {}); const retired = record.prelisten?.dispose() || createProcgenRetirementScope().retire(); await retired.completion; if (retired.outcome !== 'complete') throw fail('The seek cue retains unresolved output ownership.'); } },
      { name: 'seek-prepared-history', run: async () => { await record.preparation?.catch(() => {}); const retired = record.prelisten?.dispose() || createProcgenRetirementScope().retire(); await retired.completion; if (retired.outcome !== 'complete') throw fail('The seek source remains pinned behind its cue.'); const rendered = record.renderer?.dispose() || createProcgenRetirementScope().retire(); await rendered.completion; if (rendered.outcome !== 'complete') throw fail('The seek renderer retains unresolved source ownership.'); record.workspace.release(); retained.delete(record); } }]);
    receipt.completion.then(value => { if (value.outcome !== 'complete') { failure = 'Seek retirement remains unresolved.'; phase = 'retirement-unknown'; } else if (current === record) current = null; report(); }); return receipt;
  };
  const run = async request => {
    if (retained.size >= 2) throw fail('The playing and preparing seek slots are still owned.');
    const record = { request, controller: new AbortController(), retirement: createProcgenRetirementScope(), renderer: null, prelisten: null, preparation: null, receipt: null,
      workspace: createOwnedResourceReservation({ budget: resourceBudget, owner: id, generation: request.serial, kind: 'take-seek-definition-receipt-and-cue-overlap', category: 'candidate', bytes: 2 * 1048576 }) };
    const currentRequest = () => !disposed && !stopping && active === record && serial === request.serial && request.isCurrent() && !record.controller.signal.aborted;
    const check = () => { record.controller.signal.throwIfAborted(); if (!currentRequest()) throw fail('The seek target or source revision was superseded.'); };
    retained.add(record); active = record; phase = 'reconstructing-history'; report();
    try {
      record.renderer = createCausalTakeAudioRenderer({ journal, resourceBudget, jobs, getMaterialProvider, onState: () => report() });
      record.prelisten = createPreparedWavePrelisten({ audio, resourceBudget, onState: () => report() });
      record.preparation = (request.options.restorationMode === 'initial-owned-image' ? record.renderer.prepareCaptured : record.renderer.prepare)({ ...request.options, signal: record.controller.signal, isCurrent: currentRequest }); await record.preparation; check();
      const bundle = record.renderer.getPrepared(), file = bundle?.files.find(entry => entry.id === 'master') || bundle?.files[0], manifest = file?.manifest;
      if (!file?.artifact.metadata().retained || manifest?.takeId !== request.options.takeId || manifest.takeRevision !== request.options.takeRevision || manifest.sampleRate !== request.options.sampleRate || manifest.frames > request.options.sampleRate * 3 || !manifest.restoration || manifest.timelineZeroSourceFrame !== Math.round(request.options.startSeconds * request.options.sampleRate)) throw fail('The seek source omitted its exact reconstructed history, crop boundary or restoration receipt.');
      phase = 'staging-private-cue'; report();
      const playback = await record.prelisten.play({ file, source: { name: 'Take seek · ' + request.options.startSeconds.toFixed(3) + ' s', kind: 'causal-take-seek', revision: manifest.pcmHash, sourceRef: manifest.sourceCanonicalHash },
        isCurrent: () => !disposed && !record.controller.signal.aborted && (active === record && serial === request.serial || current === record) && request.isCurrent(), onReveal }); check();
      record.receipt = freezeData({ schema: 'lemmings-causal-take-seek/v1', takeId: manifest.takeId, takeRevision: manifest.takeRevision, sourceCanonicalHash: manifest.sourceCanonicalHash, pcmHash: manifest.pcmHash,
        targetSourceFrame: manifest.timelineZeroSourceFrame, startSeconds: request.options.startSeconds, endSeconds: request.options.endSeconds, sampleRate: manifest.sampleRate, engineRequirement: manifest.engineRequirement || null, imageSha256: manifest.imageSha256 || null,
        restoration: manifest.restoration, effectGraphHash: manifest.effectGraph?.hash || manifest.realization?.creativeRack?.graphHash || null, playback, scope: request.options.restorationMode === 'initial-owned-image' ? manifest.realization.scope : 'new-isolated-revoice-from-captured-history;original-logical-intents-and-physical-times-unchanged',
        returnPolicy: 'stop-or-complete-returns-to-existing-live-performance;no-world-restore-or-external-MIDI', acousticReceipt: false });
      const prior = current; current = record; last = record.receipt; phase = 'playing-private-seek'; if (prior) { const retired = close(prior); await retired.completion; if (retired.outcome !== 'complete') throw fail('The previous seek remains owned.'); } check(); return record.receipt;
    } catch (error) { const retired = close(record); await retired.completion; if (retired.outcome !== 'complete') error.retirement = retired; throw error; }
    finally { if (active === record) active = null; report(); }
  };
  const pump = () => {
    if (pumping || stopping || disposed) return;
    pumping = (async () => { while (queued && !disposed && !stopping) { const request = queued; queued = null; failure = null;
      try { const result = await run(request); request.resolve(result); } catch (error) { if (request.serial !== serial || disposed || stopping) request.resolve(Object.freeze({ status: 'superseded', request: request.serial })); else { failure = error.message; phase = current ? 'previous-seek-retained' : 'failed'; request.reject(error); } } }
    })().finally(() => { pumping = null; report(); if (queued && !disposed && !stopping) pump(); });
  };
  const stop = () => {
    if (stopping) return stopping; ++serial; if (queued) { queued.resolve(Object.freeze({ status: 'canceled', request: queued.serial })); queued = null; } active?.controller.abort(); active?.renderer?.cancel(); active?.prelisten?.stop();
    const pending = pumping, records = [...retained]; phase = 'stopping'; stopping = createProcgenRetirementScope().retire([{ name: 'seek-request-producer', run: () => pending }, { name: 'seek-candidates', run: async () => { await pending; const receipts = records.map(close); await Promise.all(receipts.map(receipt => receipt.completion)); if (receipts.some(receipt => receipt.outcome !== 'complete') || retained.size) throw fail('Take seek sources or cue producers remain owned.'); } }]);
    const receipt = stopping; receipt.completion.then(value => { if (value.outcome === 'complete') { stopping = null; current = null; phase = 'idle'; } else { failure = 'Take seek retirement remains unresolved.'; phase = 'retirement-unknown'; } report(); }); report(); return receipt;
  };
  return Object.freeze({ state, stop,
    seek({ isCurrent = () => true, ...options } = {}) {
      if (disposed || stopping || typeof isCurrent !== 'function' || !isCurrent()) return Promise.reject(fail('The seek owner or selected source is unavailable.'));
      let data; try { data = cloneData(options, { maxBytes: 262144, maxNodes: 32768 }); } catch (error) { return Promise.reject(error); }
      if (typeof data.takeId !== 'string' || !Number.isSafeInteger(data.takeRevision) || ![44100, 48000, 96000].includes(data.sampleRate) || !Number.isFinite(data.startSeconds) || !Number.isFinite(data.endSeconds) || data.startSeconds < 0 || data.endSeconds <= data.startSeconds || data.endSeconds - data.startSeconds > 3 + 0.5 / data.sampleRate || data.endSeconds > 120 || !['initial-owned-image', 'forward-preroll', 'owned-state-cut'].includes(data.restorationMode)) return Promise.reject(fail('Seek needs an exact take revision, bounded three-second crop and declared reconstruction policy.'));
      if (queued) queued.resolve(Object.freeze({ status: 'superseded', request: queued.serial })); active?.controller.abort(); active?.renderer?.cancel(); active?.prelisten?.stop(); const request = { serial: ++serial, options: { ...data, tail: { mode: 'exact-crop' }, includeAllLaneStems: false, stemLaneIds: [], includeCapturedReturn: false, effectReturnNodeIds: [] }, isCurrent, resolve: null, reject: null };
      const promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; }); queued = request; report(); pump(); return promise;
    },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; const retired = stop(); return scope.retire([{ name: 'take-seek-owner', run: () => retired }]); }
  });
}
