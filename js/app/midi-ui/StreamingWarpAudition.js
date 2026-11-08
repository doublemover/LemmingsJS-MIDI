import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const fail = message => Object.assign(new Error(message), { code: 'streaming-warp-audition-unavailable' });
let nextAudition = 0;
export function createStreamingWarpAudition({ audio, materials, resourceBudget = null, onState = () => {}, onReveal } = {}) {
  let active = null, disposed = false, last = null;
  const state = () => Object.freeze({ active: !!active, phase: active?.phase || 'idle', last, disposed });
  const report = () => { try { onState(state()); } catch {} };
  const close = record => {
    if (!record) return createProcgenRetirementScope().retire(); if (record.scope.getReceipt()) return record.scope.getReceipt();
    record.phase = 'retiring'; clearInterval(record.timer);
    const producers = createProcgenRetirementScope({ deadlineMs: 15000 });
    const receipt = record.scope.retire([{ name: 'streaming-cue-cancel', run: () => record.controller.abort() }, { name: 'streaming-cue-producers', run: () => producers.retire([
      { name: 'streaming-cue-session', run: () => record.session?.dispose() },
      { name: 'streaming-cue-source', run: async () => { if (record.preparing) await Promise.allSettled([record.preparing]); if (record.voice) { const receipt = record.voice.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('The streaming source retains unresolved output ownership.'); } } },
      { name: 'live-preview-input-source', run: async () => { if (record.inputNode) { try { record.inputNode.stop(); } catch (error) { if (error.name !== 'InvalidStateError') throw error; } } if (record.preparing) await Promise.allSettled([record.preparing]); if (record.voice) { const retired = record.voice.dispose(); await retired.completion; if (retired.outcome !== 'complete') throw fail('The live preview retains its input or output processor.'); } record.inputNode?.disconnect(); if (record.inputNode) record.inputNode.buffer = null; record.inputNode = null; record.inputLease?.release(); } },
      { name: 'streaming-cue-material-reader', run: async () => { if (record.preparing) await Promise.allSettled([record.preparing]); record.loan?.release(); record.loan = null; } }
    ]) }, { name: 'streaming-cue-finish', run: async () => { const receipt = producers.getReceipt(); await receipt.completion;
      record.audition?.close(receipt); if (active === record && receipt.outcome === 'complete') active = null;
      last = Object.freeze({ ...record.receipt, retirement: receipt.outcome }); report(); if (receipt.outcome !== 'complete') throw fail('Streaming Prelisten cleanup remains unresolved.');
    } }]); report(); return receipt;
  };
  return Object.freeze({ state,
    async play({ seconds = 3, sourceMode = 'buffered', isCurrent = () => true } = {}) {
      if (disposed || !['buffered', 'live-input'].includes(sourceMode) || sourceMode === 'live-input' && !resourceBudget || typeof isCurrent !== 'function' || !Number.isFinite(seconds) || seconds <= 0 || seconds > 8) throw fail('Choose one explicit preview of at most eight seconds.');
      if (active) { const receipt = close(active); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('The previous streaming audition is not retired.'); }
      const context = audio.getAudioContext(), monitor = audio.getMonitorRouteState(), source = materials.state(), id = ++nextAudition;
      if (!source.plan || source.phase !== 'ready' || !audio.getState().enabled || context?.state !== 'running' || source.plan.outputRate !== context.sampleRate ||
          !['rehearsal', 'separate-device'].includes(monitor.mode) || !['ready', 'playing-route'].includes(monitor.state)) throw fail('Enable browser audio, prepare material at its actual sample rate and choose an explicit Prelisten route.');
      if (sourceMode === 'live-input' && source.plan.rateRatio !== 1) throw fail('Actual live input supports independent pitch shifting at 1× input/output rate. Choose 1× traversal explicitly.');
      const record = { id, controller: new AbortController(), scope: createProcgenRetirementScope({ deadlineMs: 15000 }), phase: 'preparing', session: null,
        audition: null, loan: null, voice: null, inputNode: null, inputLease: null, preparing: null, timer: null, receipt: null }; active = record; report();
      const current = () => !disposed && isCurrent() && active === record && !record.controller.signal.aborted && materials.state().planHash === source.planHash && audio.getAudioContext() === context && context.state === 'running' && audio.getMonitorRouteState().revision === monitor.revision;
      const check = () => { record.controller.signal.throwIfAborted(); if (!current()) throw fail('The streaming source, Prelisten route or audio clock changed.'); };
      record.controller.signal.addEventListener('abort', () => close(record), { once: true });
      try {
        record.audition = await audio.acquireAudition({ source: { name: sourceMode === 'live-input' ? 'Actual-input pitch shift · finite seed preview' : 'Streaming original seed · fixed preview', kind: sourceMode === 'live-input' ? 'causal-live-input-pitch-preview' : 'streaming-buffered-source-preview', revision: source.planHash, sourceRef: source.sourceAssetHash },
          routeRevision: monitor.revision, signal: record.controller.signal, onReveal, onStop: reason => record.controller.abort(fail(reason)) }); check();
        record.session = audio.createSession('streaming-seed-preview', { workloadClass: 'cue' }); if (!await record.session.enable()) throw fail('The selected Prelisten owner is unavailable.'); check();
        record.loan = materials.borrow();
        if (sourceMode === 'live-input') {
          const material = record.loan.value, frames = Math.max(2, Math.min(material.pcm.planes[0].length, Math.round(seconds * context.sampleRate)));
          record.inputLease = createOwnedResourceReservation({ budget: resourceBudget, owner: 'live-warp-preview-' + id, kind: 'finite-original-native-input-and-copy', category: 'candidate', bytes: frames * 8 + 65536 });
          record.preparing = (async () => { const buffer = context.createBuffer(2, frames, context.sampleRate);
            for (let channel = 0; channel < 2; channel++) for (let first = 0; first < frames; first += 16384) { check(); const end = Math.min(frames, first + 16384); buffer.getChannelData(channel).set(material.pcm.planes[channel].subarray(first, end), first); await new Promise(resolve => setTimeout(resolve, 0)); }
            check(); const inputNode = context.createBufferSource(); inputNode.buffer = buffer; return inputNode; })(); record.inputNode = await record.preparing; check();
          record.preparing = record.session.prepareLiveInputPitchShift({ sourceNode: record.inputNode, material: { image: material.image }, pitchRatio: source.plan.pitchRatio, rateRatio: 1, pipelineFrames: 1024, signal: record.controller.signal, isCurrent: current });
          record.voice = await record.preparing; check(); record.loan.release(); record.loan = null; record.audition.markReady(); record.audition.markPlaying();
          const rate = context.sampleRate, start = Math.ceil((context.currentTime * rate + rate * 0.15) / 128) * 128, end = start + frames, admitted = await record.voice.startLiveInput({ inputFrame: start, endInputFrame: end }); check();
          if (context.currentTime * rate >= start) throw fail('The explicitly scheduled input deadline expired before its source start.');
          record.inputNode.start(start / rate); record.inputNode.stop(end / rate);
          record.receipt = Object.freeze({ schema: 'lemmings-live-input-seed-preview/v1', sourceMode, planHash: source.planHash, sourceAssetHash: source.sourceAssetHash, sampleRate: rate, rateRatio: 1, pitchRatio: source.plan.pitchRatio,
            startInputFrame: start, endInputFrame: end, startOutputFrame: admitted.firstTransportOutputFrame, declaredSignalLatencyFrames: admitted.declaredSignalLatencyFrames, pipelineFrames: 1024, futureInputAvailableToCore: false,
            scope: 'actual-node-input-observed-after-render;hypothetical-source-preview;no-world-or-project-change', acousticEvidence: false });
          record.phase = 'playing'; record.timer = setInterval(() => { if (!current()) close(record); }, 25); record.voice.outputCompletion().then(() => close(record), () => close(record)); report(); return record.receipt;
        }
        record.preparing = record.session.prepareBufferedWarpVoice({ material: record.loan.value, signal: record.controller.signal, isCurrent: current });
        record.voice = await record.preparing; check(); record.loan.release(); record.loan = null;
        record.audition.markReady(); record.audition.markPlaying();
        const rate = context.sampleRate, start = Math.ceil((context.currentTime * rate + source.plan.algorithm.requiredPreparationLeadFrames + rate * 0.1) / 128) * 128,
          duration = Math.min(seconds, (source.plan.sourceFrameRegion[1] - source.plan.sourceFrameRegion[0]) / source.plan.sourceRate / source.plan.rateRatio), end = start + Math.max(1, Math.round(duration * rate)),
          identity = { voiceId: 'streaming-seed-preview-' + id, onsetId: 'streaming-seed-preview-' + id, generation: 0, epoch: 'streaming-seed-preview-' + id, sequence: 0 };
        const admitted = await record.voice.begin({ identity, onsetOutputFrame: start, endOutputFrame: end, segment: { outputFrame: start, active: true } }); check();
        const done = end + Math.ceil(source.plan.algorithm.inputLatencyFrames / source.plan.rateRatio + source.plan.algorithm.outputLatencyFrames) + 256;
        record.receipt = Object.freeze({ schema: 'lemmings-streaming-seed-preview/v1', planHash: source.planHash, sourceAssetHash: source.sourceAssetHash, startOutputFrame: start,
          endOutputFrame: end, sampleRate: rate, preparation: admitted.preparation, scope: 'explicit-hypothetical-one-voice-preview;no-world-or-project-change', acousticEvidence: false });
        record.phase = 'playing'; record.timer = setInterval(() => { if (!current() || context.currentTime * rate >= done) close(record); }, 25); report(); return record.receipt;
      } catch (error) { const receipt = close(record); await receipt.completion; if (receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
    },
    stop: () => close(active), dispose() { disposed = true; return close(active); }
  });
}
