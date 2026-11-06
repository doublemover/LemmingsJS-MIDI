const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'owned-causal-take-arm' }); };
const join = async value => { const receipt = await value; await receipt?.completion; if (receipt === false || receipt?.outcome && receipt.outcome !== 'complete') throw Object.assign(new Error('Owned take preparation retains unresolved resources.'), { retirement: receipt }); };

export function createOwnedCausalTakeArm({ hold, isCurrent, sourceBoundary, captureSession, captureAudio, encodeAudio, prepareOwner, createRecorder, publishRecorder,
  retireRecorder, recordActivation, discardAudio, onState = () => {} } = {}) {
  if (!hold?.isCurrent || ![isCurrent, captureSession, captureAudio, encodeAudio, prepareOwner, createRecorder, publishRecorder, retireRecorder, recordActivation, discardAudio].every(value => typeof value === 'function')) fail('Owned take arming requires its exclusive physical/audio source transaction.');
  let capsule = null, captured = null, encoded = null, pending = null, controller = null, phase = 'ready', failure = null, unresolved = null, lastReceipt = null;
  const current = () => isCurrent() && hold.isCurrent();
  const state = () => Object.freeze({ phase, busy: !!pending, retained: !!captured, canRetry: !!captured && !pending && !unresolved && current(),
    failure: failure ? String(failure.message) : null, retirementUnknown: !!unresolved, image: encoded?.metadata() || captured?.metadata().image || null, lastReceipt });
  const notify = next => { if (next) phase = next; try { onState(state()); } catch {} };
  const check = () => { controller?.signal.throwIfAborted(); if (!current()) fail('The retained world, project or transport hold changed.'); };
  const releaseCapture = async () => {
    if (unresolved) fail('Retained source readers cannot retire while audio preparation ownership is unresolved.');
    if (encoded) { await join(encoded.release()); encoded = null; }
    if (captured) { await join(captured.release()); captured = null; }
    if (capsule) { if (!capsule.discard()) fail('The retained world checkpoint could not retire.'); capsule = null; }
  };
  const run = ({ record = true, takeName = 'Untitled take' } = {}) => {
    if (pending || unresolved || ['complete', 'discarded'].includes(phase) || typeof record !== 'boolean') fail('Finish the current owned take operation before retrying.');
    check(); controller = new AbortController(); failure = null;
    const execute = async () => {
      let owner = null, routing = null, continuation = null, recorder = null, resumed = false;
      const options = { signal: controller.signal, isCurrent: current };
      try {
        if (!capsule) { notify('capturing-world'); capsule = await captureSession(options); check(); }
        const session = capsule.session(); if (!session?.world || !session.physicalState || !session.physicalTimeline) fail('The exact physical source capsule is unavailable.');
        if (!captured) { notify('capturing-audio'); captured = await captureAudio({ ...options, session }); check(); }
        const cut = captured.cut(), metadata = cut.metadata(), physical = metadata?.bindings?.physical;
        if (!physical?.routing || metadata.semanticBoundary?.worldId !== sourceBoundary.worldId || metadata.semanticBoundary?.tick !== sourceBoundary.tick || metadata.semanticBoundary?.generation !== sourceBoundary.generation) fail('The common audio cut differs from its retained physical boundary.');
        if (record && !captured.image() && !encoded) {
          notify('encoding-image');
          encoded = await encodeAudio({ ...options, cut, sources: physical.routing.sources.map(row => ({ sourceId: row.sourceId, reference: row.reference })), includeCheckpointEnvelope: true }); check();
        }
        const image = encoded || captured.image();
        notify('preparing-sources'); owner = await prepareOwner({ ...options, semanticState: session.physicalState }); check();
        owner.prepareRestorationExecution({ worldId: sourceBoundary.worldId, generation: sourceBoundary.generation, fromExecutionEpoch: physical.sourceExecutionEpoch });
        const inventory = await owner.audioContinuation.prepareSources({ ...options, cut }); check();
        routing = owner.stageAudioRoutingContinuation({ state: inventory.state, sources: inventory.sources });
        continuation = await owner.audioContinuation.prepare({ ...options, cut, sources: inventory.references }); check();
        if (record) {
          notify('saving-initial-image');
          recorder = await createRecorder({ ...options, takeName, session, image, transport: hold.metadata() }); check();
          publishRecorder(recorder);
        }
        notify('restoring-audio');
        const activation = await owner.audioContinuation.restore({ ...options, continuation, sources: routing.sources(),
          restoreBindings: (bindings, frontier) => { check(); return owner.restorePreparedBodyContinuation(bindings.physical, { ...frontier, ...options, routingPlan: routing }); }, beforeArm: check });
        continuation = null; check(); routing.complete(); routing = null; owner.audioContinuation.activate();
        const anchor = owner.anchorAudioContinuation({ audioFrame: activation.audioFrame, bpm: hold.metadata().bpm });
        notify('activating-world');
        const transport = hold.resumeAt({ hostMs: anchor.hostMs, audioFrame: activation.audioFrame, sampleRate: activation.sampleRate,
          beforeResume: clock => recordActivation({ recorder, activation, clock, image: image?.metadata() || null, session }) });
        resumed = true; const { state: transportState, ...clockReceipt } = transport; lastReceipt = Object.freeze({ activation, transport: clockReceipt, takeId: recorder?.manifest().takeId || null, acousticReceipt: false });
        notify('retiring-capture'); await releaseCapture(); notify('complete'); return lastReceipt;
      } catch (error) {
        failure = error; controller.abort(error); owner ||= error.preparedPhysicalOwner || null;
        if (!resumed) {
          try { await join(owner?.stop()); } catch (retirementError) { unresolved ||= retirementError; }
          try { if (routing) await join(routing.cancel()); } catch (retirementError) { unresolved ||= retirementError; }
          try { if (continuation?.metadata()) await join(continuation.release()); } catch (retirementError) { unresolved ||= retirementError; }
          if (recorder) { try { await retireRecorder(recorder, error); } catch (retirementError) { unresolved ||= retirementError; } }
          if (error.retirement || error.retirementError || error.preparedRetirementError) unresolved ||= error;
          if (!captured) {
            try { await releaseCapture(); hold.cancel(); } catch (retirementError) { unresolved ||= retirementError; }
          }
        } else unresolved ||= error;
        notify(unresolved ? 'retirement-unknown' : captured ? 'recovery-held' : 'failed'); throw error;
      }
    };
    pending = execute().finally(() => { pending = null; controller = null; notify(); }); return pending;
  };
  return Object.freeze({ state, run, cancel() { if (!pending) return false; controller.abort(new Error('Owned take arming was canceled.')); return true; },
    async discard({ restoreSemantic = true } = {}) {
      if (pending) { controller.abort(new Error('Owned take preparation is being retired.')); await pending.catch(() => {}); }
      if (unresolved) fail('The retained sound state still has unresolved consumers.');
      if (phase === 'discarded') return true;
      await discardAudio({ restoreSemantic, session: capsule?.session() || null }); hold.cancel(); await releaseCapture(); notify('discarded'); return true;
    } });
}
