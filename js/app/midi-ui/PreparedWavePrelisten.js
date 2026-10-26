import { cloneData, freezeData } from '../../core/CanonicalData.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { inspectOwnedCueWave } from './OwnedPcmCue.js';

let ordinal = 0;
const fail = message => Object.assign(new Error(message), { name: 'PreparedWavePrelistenError' });

export function createPreparedWavePrelisten({ audio, resourceBudget, onState = () => {} } = {}) {
  const ownerId = 'prepared-wave-prelisten-' + (++ordinal), retirement = createProcgenRetirementScope(), unknown = new Set();
  let disposed = false, current = null, phase = 'idle', error = null;
  const state = () => Object.freeze({ active: !!current, playing: !!current?.playing, phase, error, unresolvedRetirement: unknown.size, source: current?.source ?? null });
  const report = () => { if (!disposed) try { onState(state()); } catch {} };
  const close = record => {
    if (!record) return createProcgenRetirementScope().retire();
    if (record.scope.getReceipt()) return record.scope.getReceipt();
    record.stopping = true; record.controller.abort(fail('Prepared WAV prelisten stopped.')); clearInterval(record.fence); phase = 'stopping';
    const producers = createProcgenRetirementScope().retire([
      { name: 'prepared-wave-cue', run: async () => { await record.preparation; return record.cue?.dispose(); } },
      { name: 'prepared-wave-session', run: async () => { await record.preparation; return record.session?.dispose(); } }
    ]);
    const receipt = record.scope.retire([
      { name: 'prepared-wave-producers', run: () => producers },
      { name: 'prepared-wave-source-and-overlap', run: async () => {
        await record.preparation; await producers.completion;
        if (producers.outcome !== 'complete') throw fail('Prepared WAV producers retain unresolved ownership.');
        record.unwatch?.(); record.loan?.release(); record.loan = null; record.bytes = null; record.workspace.release();
      } }
    ]);
    receipt.completion.then(result => {
      record.audition?.close(result);
      if (result.outcome !== 'complete') { unknown.add(record); phase = 'retirement-unknown'; }
      else phase = 'stopped';
      if (current === record) current = null; report();
    }); report(); return receipt;
  };
  return Object.freeze({ state, stop: () => close(current),
    async play({ file, source, isCurrent = () => true, onReveal } = {}) {
      if (disposed || current || unknown.size || !audio?.acquireAudition || !audio?.createSession || typeof isCurrent !== 'function' || !file?.artifact?.borrow || !file.artifact.onDiscard || !file.manifest) throw fail('Stop the current preview and choose a retained rendered WAV.');
      const context = audio.getAudioContext(), route = audio.getMonitorRouteState(), metadata = file.artifact.metadata();
      if (!audio.getState().enabled || context?.state !== 'running' || !['rehearsal', 'separate-device'].includes(route.mode) || !['ready', 'playing-route'].includes(route.state)) throw fail('Enable audio and choose an explicit PRELISTEN route first.');
      if (!metadata.retained || !Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 64 || metadata.byteLength > 16 * 1048576) throw fail('Prelisten supports one retained WAV up to sixteen MiB.');
      const rawManifest = file.manifest;
      if (!Number.isSafeInteger(rawManifest.frames) || ![44100, 48000, 96000].includes(rawManifest.sampleRate) || rawManifest.frames < 1 || rawManifest.frames > rawManifest.sampleRate * 16) throw fail('Choose a render of at most sixteen seconds including its tail for PRELISTEN.');
      if (!source || Object.keys(source).some(key => !['name', 'kind', 'revision', 'sourceRef'].includes(key)) || !['name', 'kind', 'revision', 'sourceRef'].every(key => typeof source[key] === 'string' && source[key].length > 0 && source[key].length <= 256)) throw fail('The prepared WAV needs its exact named source revision.');
      const record = { source: Object.freeze({ ...source }), controller: new AbortController(), scope: createProcgenRetirementScope(), workspace: createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, kind: 'prepared-wave-read-hash-and-transfer-overlap', category: 'audio', bytes: metadata.byteLength * 2 + 4 * 1048576 }), cue: null, session: null, audition: null, loan: null, bytes: null, unwatch: null, fence: null, playing: false, stopping: false, preparation: null, prepared: null };
      record.preparation = new Promise(resolve => { record.prepared = resolve; }); current = record; phase = 'preparing'; error = null; report();
      const check = () => {
        record.controller.signal.throwIfAborted();
        if (disposed || current !== record || !isCurrent() || !file.artifact.metadata().retained || audio.getAudioContext() !== context || context.state !== 'running' || audio.getMonitorRouteState().revision !== route.revision || record.audition && !record.audition.isCurrent()) throw fail('The prepared file, source selection, cue route or audio clock changed.');
      };
      record.controller.signal.addEventListener('abort', () => { if (record.playing && !record.stopping) close(record); }, { once: true });
      try {
        const manifest = freezeData(cloneData(rawManifest, { maxBytes: 262144, maxNodes: 32768 }));
        check(); record.unwatch = file.artifact.onDiscard(() => { record.controller.abort(fail('The prepared WAV was discarded.')); });
        record.loan = file.artifact.borrow(); record.bytes = new Uint8Array(await record.loan.blob.arrayBuffer()); check();
        if (record.bytes.byteLength !== metadata.byteLength) throw fail('The prepared WAV byte inventory changed.'); inspectOwnedCueWave(record.bytes, manifest);
        record.audition = await audio.acquireAudition({ source: record.source, routeRevision: route.revision, signal: record.controller.signal, onReveal, onStop: reason => record.controller.abort(fail(String(reason))) }); check();
        record.session = audio.createSession(ownerId, { workloadClass: 'cue' }); if (!record.session || !await record.session.enable()) throw fail('The isolated PCM cue quota is unavailable.'); check();
        record.cue = await record.session.preparePcmCue({ bytes: record.bytes, manifest, signal: record.controller.signal, isCurrent: () => { try { check(); return true; } catch { return false; } } }); check();
        record.bytes = null; record.workspace.resize(4 * 1048576); record.audition.markReady();
        const playback = record.cue.play(); check(); if (playback?.status !== 'accepted') throw fail('The PCM cue declined playback.');
        record.playing = true; record.audition.markPlaying(); record.prepared(); phase = 'playing';
        record.cue.completion.then(() => close(record)); record.fence = setInterval(() => { try { check(); } catch (caught) { record.controller.abort(caught); } }, 50); report();
        return Object.freeze({ source: record.source, playback, pcmHash: manifest.pcmHash, sourceSampleRate: manifest.sampleRate, contextSampleRate: context.sampleRate, level: 'fixed-authored-gain;cue-level-and-8ms-edge-fades-only', acousticReceipt: false, physicalTakeEvidence: false });
      } catch (caught) {
        error = caught.message; phase = 'failed'; record.prepared(); const receipt = close(record); await receipt.completion; if (receipt.outcome !== 'complete') caught.retirement = receipt; throw caught;
      } finally { record.prepared(); }
    },
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; const stopped = close(current);
      return retirement.retire([{ name: 'prepared-wave-playback', run: () => stopped }, { name: 'prepared-wave-retained-faults', run: async () => { await stopped.completion; if (unknown.size || stopped.outcome !== 'complete') throw fail('Prepared WAV playback retirement remains unresolved.'); } }]); }
  });
}
