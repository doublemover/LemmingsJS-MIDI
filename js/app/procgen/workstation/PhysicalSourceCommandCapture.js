import { createProcgenRetirementScope } from '../ProcgenRetirement.js';
const fail = message => Object.assign(new Error(message), { code: 'physical-source-command-capture' });
export async function preparePhysicalSourceCommandCapture({ sources, recorder, audioFrame, getBoundary, onGap = () => {} } = {}) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 16 || !recorder?.recordSinkOutcome || !Number.isSafeInteger(audioFrame) || typeof getBoundary !== 'function') throw fail('Capture the complete prepared source inventory at its aggregate activation frame.');
  const handles = [], scope = createProcgenRetirementScope(); let failed = false, activated = false;
  const gap = reason => { if (failed) return; failed = true; const boundary = getBoundary(); recorder.markGap({ kind: 'owned-source-commands', firstTick: boundary.tick, lastTick: boundary.tick, generation: boundary.generation, reason }); onGap(reason); };
  const record = (sourceId, event) => {
    if (event.type === 'source-transport-overflow') { gap('render-realm-source-command-overflow'); return false; }
    const data = event.data instanceof Float64Array ? Array.from(event.data) : null;
    const value = { ...event }; if (data) value.data = data;
    const receipt = recorder.recordSinkOutcome({ schema: 'lemmings-captured-source-transport/v1', sourceId, event: value }, getBoundary());
    if (receipt.status !== 'accepted') { gap('source-command-journal-refused'); return false; } return true;
  };
  const close = () => scope.retire(handles.map(({ handle, sourceId }) => ({ name: 'source-command-fence:' + sourceId, run: () => handle.close() })));
  const prepared = await Promise.allSettled(sources.map(async source => {
    if (typeof source.backend.observeSourceTransport !== 'function') throw fail('A prepared owned source lacks actual command ingress capture.');
    const handle = await source.backend.observeSourceTransport({ audioFrame, onPacket: event => record(source.sourceId, event) });
    handles.push({ sourceId: source.sourceId, handle });
    if (!record(source.sourceId, handle.receipt)) throw fail('The initial command capture fence was not admitted.');
  }));
  const rejected = prepared.find(result => result.status === 'rejected');
  if (rejected) { gap('source-command-capture-preparation-failed'); const receipt = close(); await receipt.completion; if (receipt.outcome !== 'complete') rejected.reason.retirement = receipt; throw rejected.reason; }
  return Object.freeze({ recorder, close, state: () => ({ sources: handles.length, failed, activated, retirement: scope.getReceipt()?.outcome || null }),
    activate(receipt) {
      if (activated || failed || scope.getReceipt() || receipt.audioFrame !== audioFrame) throw fail('Activate a complete current command capture exactly once.');
      for (const source of sources) if (!record(source.sourceId, { type: 'source-transport-activation', audioFrame, sourceFrame: source.metadata.cut.frame, sampleRate: source.metadata.cut.sampleRate,
        laneIdentities: source.backend.sourceTransportBindings().laneIdentities })) throw fail('The source activation binding was not admitted.'); activated = true; return true;
    } });
}
