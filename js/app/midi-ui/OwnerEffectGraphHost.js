import { cloneData, freezeData } from '../../core/CanonicalData.js';
import { prepareNativeEffectGraph } from './NativeEffectGraph.js';
import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'EffectGraphError', code });
const summary = receipt => receipt ? { state: receipt.state, outcome: receipt.outcome } : null;

export function createOwnerEffectGraphHost({ context, input, dry, destination, resources, owner, generation = 0, isCurrent = () => true,
  onChange = () => {}, onBodyReceipt = () => {}, onEffectReceipt = () => {}, resolveSidechainSource = null, getMaterialProvider = null, prepareGraph = prepareNativeEffectGraph, transitionSeconds = 0.02 } = {}) {
  if (!context?.createGain || !input?.connect || !dry?.gain || !destination || !resources?.reserve || typeof isCurrent !== 'function' ||
      typeof onChange !== 'function' || typeof onBodyReceipt !== 'function' || typeof onEffectReceipt !== 'function' || resolveSidechainSource !== null && typeof resolveSidechainSource !== 'function' || typeof prepareGraph !== 'function' || !Number.isFinite(transitionSeconds) || transitionSeconds < 0.005 || transitionSeconds > 0.2)
    throw new TypeError('An owner effect host needs the existing source, dry route, destination and shared resource owner.');
  const metadata = resources.reserve({ kind: 'effect-host-metadata', owner, generation, bytes: 8192, consumerOwned: true });
  const dryAutomation = createSmoothedAudioParameter({ param: dry.gain, initialValue: 1, startTime: context.currentTime, smoothingSeconds: transitionSeconds, maxEvents: 32, valueMinimum: 0, valueMaximum: 1 });
  const retirement = createProcgenRetirementScope({ deadlineMs: 15000 }), arms = new Set(), pending = new Set(), unknown = new Set();
  let current = null, disposed = false, revision = 0, serial = 0, timer = null, mode = 'neutral', error = null, continuationPhase = 'idle', stagedContinuation = null;
  const state = () => Object.freeze({ schema: 'lemmings-owner-effect-state/v1', owner, generation, revision, mode, disposed, preparing: pending.size,
    continuation: { phase: continuationPhase, image: current?.continuation || null }, activeGraph: current?.graph.diagnostics() || null, retiringGraphs: [...arms].filter(arm => arm !== current).length, maximumConcurrentGraphs: 2,
    unresolvedRetirement: unknown.size, error, sourceScope: 'one-owner-channel-stereo', tailClock: 'audio-context-time',
    protection: 'existing-shared-master-or-explicit-cue-route', retirement: summary(retirement.getReceipt()) });
  const report = () => { try { onChange(state()); } catch { /* Display cannot own effect routing. */ } };
  const guard = () => { if (disposed || context.state === 'closed' || !isCurrent() || unknown.size) throw failure('effect-owner-unavailable', 'This effect owner is unavailable or has unresolved retirement.'); };
  const retireArm = arm => {
    arm.retirement ||= createProcgenRetirementScope({ deadlineMs: 12000 });
    return arm.retirement.retire([{ name: 'owned-effect-arm', run: async () => {
      try {
        const errors = [], attempt = action => { try { action(); } catch (caught) { errors.push(caught); } };
        attempt(() => { arm.output?.gain.cancelScheduledValues(context.currentTime); arm.output?.gain.setValueAtTime(0, context.currentTime); });
        attempt(() => { if (arm.connectedSource) { input.disconnect(arm.input); arm.connectedSource = false; } });
        const graphReceipt = arm.graph.dispose(); await graphReceipt.completion;
        if (graphReceipt.outcome !== 'complete') throw failure('effect-retirement-unknown', 'The old effect graph producer remains owned.');
        attempt(() => arm.input?.disconnect()); attempt(() => arm.output?.disconnect());
        if (errors.length) throw errors[0]; arm.lease.release(); arms.delete(arm);
      } catch (caught) { arm.lease.retainUnknown(caught); unknown.add(arm); error = caught.message; throw caught; }
      finally { report(); }
    } }]);
  };
  const poll = () => {
    if (timer != null) clearTimeout(timer); timer = null;
    for (const arm of arms) if (arm !== current && !arm.retirement && (context.state === 'closed' || arm.retireAt <= context.currentTime)) retireArm(arm);
    if (!disposed && [...arms].some(arm => arm !== current && !arm.retirement)) timer = setTimeout(poll, context.state === 'running' ? 50 : 250);
  };
  const tail = (arm, time = context.currentTime) => { if (!arm) return; if (arm.graph.gateSidechains) arm.graph.gateSidechains(0, time, transitionSeconds); else arm.graph.deactivateSidechains?.(); arm.inAutomation.insert(0, time, time);
    arm.retireAt = Math.max(time + transitionSeconds, (arm.graph.lastBodyDriveFrame?.() || 0) / context.sampleRate) + arm.graph.plan.maximumTailFrames / context.sampleRate; };
  const assertMutable = () => { if (continuationPhase !== 'idle') throw failure('effect-rack-state-fenced', 'This rack is transferring or staging an owned continuation.'); };
  const detachState = async (options = {}) => {
    guard(); assertMutable(); options.signal?.throwIfAborted();
    const member = current;
    if (!member || !['active', 'mute'].includes(mode) || pending.size || arms.size !== 1 || member.retirement ||
        context.currentTime * context.sampleRate < member.publication.startFrame + member.publication.transitionFrames) throw failure('effect-rack-cut-boundary', 'A rack cut requires one stable prepared revision after its transition, with no retained older tail.');
    const cutLease = resources.reserve({ kind: 'effect-rack-state-cut', owner, generation, bytes: 65536, consumerOwned: true });
    let image = null, graphCut = null; continuationPhase = 'capturing'; report();
    try {
      const priorTarget = options.onTargetAudioFrame;
      graphCut = await member.graph.detachState({ ...options, onTargetAudioFrame: audioFrame => {
        priorTarget?.(audioFrame);
        image = freezeData(cloneData({ schema: 'lemmings-owner-effect-cut/v1', graphHash: member.graph.hash, sampleRate: context.sampleRate, audioFrame,
          sourceOwnerRouteRevision: member.routeRevision, mode, dry: dryAutomation.snapshot(audioFrame / context.sampleRate), input: member.inAutomation.snapshot(audioFrame / context.sampleRate),
          outputGain01: mode === 'mute' ? 0 : 1, supportedBoundary: 'one-stable-owner-rack;no-retained-topology-transition' }, { maxBytes: 65536, maxNodes: 8192 }));
      } });
      if (!image || image.audioFrame !== graphCut.metadata().audioFrame) throw failure('effect-rack-cut-frontier', 'Rack and processors did not agree on one output frontier.');
      current = null; mode = 'neutral';
      const receipt = retireArm(member); await receipt.completion;
      if (receipt.outcome !== 'complete') throw Object.assign(failure('effect-rack-cut-retirement', 'The old rack retains unresolved routing ownership.'), { retirement: receipt });
      continuationPhase = 'detached'; report(); let released = false;
      return Object.freeze({ schema: 'lemmings-owner-effect-cut/v1', metadata: () => image, definition: () => member.graph.plan.definition, graphCut: () => { if (released) throw failure('effect-rack-cut-released', 'Rack cut ownership was released.'); return graphCut; },
        release() { if (released) return false; released = true; image = null; graphCut.release(); graphCut = null; return cutLease.release(); } });
    } catch (caught) {
      continuationPhase = 'failed'; if (current === member) current = null;
      const receipt = retireArm(member); await receipt.completion; if (receipt.outcome !== 'complete') caught.retirement = receipt;
      graphCut?.release(); cutLease.release(); error = caught.message; report(); throw caught;
    }
  };
  const prepare = async (definition, { signal, isCurrent: requestCurrent = () => true, continuation = null, rackState: rawRackState = null } = {}) => {
    guard(); assertMutable();
    const rackState = rawRackState === null ? null : cloneData(rawRackState, { maxBytes: 65536, maxNodes: 8192 });
    if (continuation && (current || arms.size || revision || !rackState) || !continuation && rackState) throw failure('fresh-effect-rack-restore-required', 'Stage an owned image only into a fresh owner rack.'); signal?.throwIfAborted();
    if (pending.size || arms.size >= 2) throw failure('effect-transition-capacity', 'Two effect revisions already own their transition or tails. Clear tails or wait before preparing another.');
    const controller = new AbortController(), request = ++serial, operation = { controller, promise: null, published: false };
    const abort = () => { if (!operation.published) { controller.abort(signal.reason); void operation.staged?.cancel().catch(() => {}); } }; signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    let graph = null, ownedGraph = null, arm = null, lease = null, published = false;
    const check = () => { guard(); controller.signal.throwIfAborted(); if (request !== serial || !requestCurrent()) throw failure('stale-effect-graph', 'A later effect request superseded this preparation.'); };
    operation.promise = (async () => {
      try {
        graph = await prepareGraph(definition, { resolveSidechainSource: request => {
          if (resolveSidechainSource) return resolveSidechainSource(request);
          if (request.sourceBusId !== 'owner' || request.tap !== 'post-fader' || request.inputLayout !== 'audioStereo') return null;
          return { node: input, context, owner, generation, sourceBusId: 'owner', tap: 'post-fader', layout: 'audioStereo', stage: 'upstream-owner-effects',
            isActive: () => !disposed && context.state !== 'closed' && isCurrent(), release() {} };
        }, stagedRestore: !!continuation, context, resources, owner, generation, getMaterialProvider, signal: controller.signal, isCurrent: () => !disposed && isCurrent() && (published || requestCurrent() && request === serial),
        onEffectReceipt: receipt => { const member = [...arms].find(candidate => candidate.graph === ownedGraph && (candidate === current || candidate.continuationArmed)); if (!disposed && member) { try { onEffectReceipt(Object.freeze({ ...receipt, owner, ownerGeneration: generation, ownerRouteRevision: member.routeRevision })); } catch {} } },
        onBodyReceipt: receipt => { const member = [...arms].find(candidate => candidate.graph === ownedGraph); if (member) { try { onBodyReceipt(Object.freeze({ ...receipt, owner, ownerGeneration: generation, ownerRouteRevision: member.routeRevision })); } catch {} } },
        onFault: caught => {
          error = caught.message;
          for (const member of arms) if (member.graph === ownedGraph) { if (current === member) { current = null; dryAutomation.insert(1, context.currentTime, context.currentTime); mode = 'neutral'; revision++; } retireArm(member); }
          report();
        } }); ownedGraph = graph; check();
        await graph.confirmReady(); check(); graph.checkPublication?.();
        if (graph.plan.inputs.length !== 1 || graph.plan.outputs.length !== 1) throw failure('effect-route-boundary', 'This owner rack requires exactly one stereo source bus and one output bus.');
        lease = resources.reserve({ kind: 'effect-route-arm', owner, generation, estimateBytes: 16384, consumerOwned: true });
        arm = { graph, input: null, output: null, lease, retireAt: Infinity, retirement: null, connectedSource: false, inAutomation: null }; arms.add(arm);
        arm.input = context.createGain(); arm.output = context.createGain(); arm.input.gain.setValueAtTime(0, context.currentTime); arm.output.gain.setValueAtTime(0, context.currentTime);
        arm.inAutomation = createSmoothedAudioParameter({ param: arm.input.gain, initialValue: 0, startTime: context.currentTime, smoothingSeconds: transitionSeconds, maxEvents: 32, valueMinimum: 0, valueMaximum: 1 });
        input.connect(arm.input); arm.connectedSource = true; arm.input.connect(graph.getInput(graph.plan.inputs[0])); graph.getOutput(graph.plan.outputs[0]).connect(arm.output); arm.output.connect(destination); check();
        await graph.activateSidechains?.({ silent: true }); check(); graph.checkPublication?.();
        if (continuation) {
          const prepared = await graph.stageState(continuation, { signal: controller.signal }); check();
          if (rackState?.schema !== 'lemmings-owner-effect-cut/v1' || rackState.graphHash !== graph.hash || rackState.sampleRate !== context.sampleRate ||
              rackState.audioFrame !== prepared.sourceAudioFrame || !Number.isSafeInteger(rackState.sourceOwnerRouteRevision) || rackState.sourceOwnerRouteRevision < 1 ||
              !Number.isSafeInteger(rackState.sourceOwnerRouteRevision + 1) || !['active', 'mute'].includes(rackState.mode) || rackState.outputGain01 !== (rackState.mode === 'mute' ? 0 : 1) ||
              rackState.dry?.sourceTimeSeconds !== rackState.audioFrame / context.sampleRate || rackState.input?.sourceTimeSeconds !== rackState.audioFrame / context.sampleRate) throw failure('effect-rack-restore-identity', 'The rack image differs from the exact worker-prepared graph frontier.');
          dryAutomation.validateSnapshot(rackState.dry); arm.inAutomation.validateSnapshot(rackState.input);
          const member = arm, restoredGraph = graph; member.routeRevision = rackState.sourceOwnerRouteRevision + 1;
          member.continuation = Object.freeze({ sourceAudioFrame: rackState.audioFrame, sourceOwnerRouteRevision: rackState.sourceOwnerRouteRevision, state: 'worker-validated-staged-owned-DSP-image' });
          let phase = 'staged', activation = null, cancellation = null;
          const cleanupSignal = () => signal?.removeEventListener('abort', abort);
          const cancel = () => {
            if (cancellation) return cancellation;
            phase = 'canceled'; continuationPhase = 'failed'; stagedContinuation = null; cleanupSignal(); controller.abort(failure('effect-rack-staging-canceled', 'The staged rack retired.'));
            if (current === member) current = null;
            dry.gain.cancelScheduledValues(context.currentTime); dry.gain.setValueAtTime(0, context.currentTime);
            cancellation = (async () => { const receipt = retireArm(member); await receipt.completion; if (receipt.outcome !== 'complete') throw Object.assign(failure('effect-rack-staging-retirement', 'The staged rack retains unresolved ownership.'), { retirement: receipt }); report(); })(); cancellation.catch(() => {}); return cancellation;
          };
          const activate = frame => {
            if (activation) return activation;
            activation = (async () => {
              try {
                check(); if (phase !== 'staged') throw failure('effect-rack-not-staged', 'The continuation rack is no longer staged.');
                phase = 'armed'; continuationPhase = 'armed';
                dryAutomation.restore(rackState.dry, frame / context.sampleRate); member.inAutomation.restore(rackState.input, frame / context.sampleRate);
                member.output.gain.setValueAtTime(rackState.outputGain01, frame / context.sampleRate); member.continuationArmed = true;
                const receipt = await prepared.activate(frame); check();
                current = member; revision = member.routeRevision; mode = rackState.mode; published = operation.published = true; continuationPhase = 'idle'; stagedContinuation = null; phase = 'active'; error = null;
                member.publication = Object.freeze({ schema: 'lemmings-effect-route-transition/v1', startFrame: frame, transitionFrames: 0, previous: null });
                member.continuation = Object.freeze({ sourceAudioFrame: rackState.audioFrame, activationFrame: frame, sourceOwnerRouteRevision: rackState.sourceOwnerRouteRevision, state: 'worker-validated-owned-DSP-image', scope: 'owner-creative-rack-before-shared-master-protection', qualification: 'awaiting-consolidated-validation' });
                restoredGraph.reconcileSourcePresence?.(); cleanupSignal(); poll(); report();
                return Object.freeze({ ...receipt, owner, ownerGeneration: generation, ownerRouteRevision: revision, sourceOwnerRouteRevision: rackState.sourceOwnerRouteRevision, mode, bindingPolicy: 'fresh-playback-execution-required' });
              } catch (caught) { try { await cancel(); } catch (retirementError) { caught.retirementError = retirementError; } throw caught; }
            })(); activation.catch(() => {}); return activation;
          };
          operation.staged = Object.freeze({ schema: 'lemmings-staged-owner-effects/v1', graphHash: restoredGraph.hash, sourceAudioFrame: rackState.audioFrame,
            grids: prepared.grids, activate, cancel, ownerRouteRevision: member.routeRevision });
          stagedContinuation = operation.staged; graph = null; arm = null; lease = null; continuationPhase = 'staged'; report(); return operation.staged;
        }
        const previous = current, publicationTime = context.currentTime, publicationFrame = Math.ceil(publicationTime * context.sampleRate), transitionFrames = Math.ceil(transitionSeconds * context.sampleRate);
        arm.graph.gateSidechains?.(1, publicationTime, transitionSeconds); arm.inAutomation.insert(1, publicationTime, publicationTime); arm.output.gain.setValueAtTime(1, publicationTime); dryAutomation.insert(0, publicationTime, publicationTime);
        tail(previous, publicationTime); current = arm; published = operation.published = true; pending.delete(operation);
        mode = 'active'; error = null; revision++; current.routeRevision = revision;
        current.publication = Object.freeze({ schema: 'lemmings-effect-route-transition/v1', startFrame: publicationFrame, transitionFrames,
          previous: previous ? Object.freeze({ ownerRouteRevision: previous.routeRevision, graphDefinitionHash: previous.graph.hash, retireAtFrame: Math.ceil(previous.retireAt * context.sampleRate), lastBodyDriveFrame: previous.graph.lastBodyDriveFrame?.() || 0 }) : null });
        graph = null; arm = null; lease = null; poll(); report(); return state();
      } catch (caught) {
        if (arm) { if (current === arm) current = null; const receipt = retireArm(arm); await receipt.completion; if (receipt.outcome !== 'complete') caught.retirement = receipt; }
        else if (graph) { const receipt = graph.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') { unknown.add({ graph, receipt }); caught.retirement = receipt; } lease?.release(); }
        if (caught.retirement?.outcome !== 'complete' && caught.retirement) unknown.add({ receipt: caught.retirement });
        error = caught.message; report(); throw caught;
      } finally { if (!operation.staged) signal?.removeEventListener('abort', abort); pending.delete(operation); report(); }
    })();
    pending.add(operation); report(); return operation.promise;
  };
  const bypass = (selected, expected = null) => {
    if (selected === 'panic' && continuationPhase !== 'idle') {
      serial++; for (const operation of pending) operation.controller.abort(failure('effect-panic', 'Panic interrupted continuation preparation.'));
      void stagedContinuation?.cancel().catch(() => {});
      current = null; continuationPhase = 'failed'; mode = 'panic'; revision++;
      dry.gain.cancelScheduledValues(context.currentTime); dry.gain.setValueAtTime(0, context.currentTime);
      for (const arm of arms) {
        arm.output.gain.cancelScheduledValues(context.currentTime); arm.output.gain.setValueAtTime(0, context.currentTime);
        try { arm.graph.panic(); } catch {} retireArm(arm);
      }
      report(); return state();
    }
    assertMutable();
    if (expected && (expected.ownerRouteRevision !== revision || expected.graphDefinitionHash !== current?.graph.hash)) throw failure('stale-effect-control', 'The effect bypass belongs to an earlier owner route.');
    if (!['neutral', 'tail', 'mute', 'panic'].includes(selected)) throw new TypeError('Unknown effect bypass mode.');
    if (disposed) throw failure('effect-owner-disposed', 'The effect owner is closed.');
    serial++; for (const operation of pending) if (!operation.published) operation.controller.abort(failure('effect-preparation-canceled', 'Effect bypass canceled the pending preparation.'));
    if (selected === 'mute') {
      dryAutomation.insert(0, context.currentTime, context.currentTime);
      for (const arm of arms) { arm.output.gain.cancelScheduledValues(context.currentTime); arm.output.gain.setValueAtTime(0, context.currentTime); }
      mode = 'mute'; report(); return state();
    }
    const previous = current; current = null;
    dryAutomation.insert(1, context.currentTime, context.currentTime);
    if (selected === 'tail') tail(previous);
    else for (const arm of arms) { arm.graph.deactivateSidechains?.(); arm.graph.panic(); arm.inAutomation.insert(0, context.currentTime, context.currentTime); arm.retireAt = context.currentTime + transitionSeconds; }
    mode = selected; revision++; poll(); report(); return state();
  };
  const preparedArm = expected => {
    guard(); assertMutable(); const arm = [...arms].find(arm => !arm.retirement && arm.routeRevision === expected?.ownerRouteRevision && arm.graph.hash === expected?.graphDefinitionHash);
    if (!arm) throw failure('stale-prepared-body', 'The exact prepared body revision has retired or was superseded.'); return arm;
  };
  return Object.freeze({ prepare, bypass, detachState,
    stageContinuation: (continuation, rackState, options = {}) => prepare(continuation?.definition?.() || options.definition, { ...options, continuation, rackState }),
    preparedBodyInventory: () => [...arms].flatMap(arm => arm.graph.plan.nodes.filter(node => node.membrane || node.pairedBody || node.blendBody || node.network?.lossMasks.length || node.network?.pickupGrid).map(node => Object.freeze({ owner, ownerGeneration: generation, ownerRouteRevision: arm.routeRevision, graphDefinitionHash: arm.graph.hash, nodeId: node.id,
      processorRevision: (node.membrane || node.pairedBody || node.blendBody || node.network).revision, bodyKind: node.membrane ? 'membrane' : node.pairedBody ? 'paired-synthetic-modal-body' : node.blendBody ? 'prepared-two-endpoint-blend' : 'authored-modal-network', preparationKinds: node.membrane ? ['touch', 'pickup-left', 'pickup-right'] : node.pairedBody || node.blendBody ? ['morph'] : [...(node.network.lossMasks.length ? ['mode-loss'] : []), ...(node.network.pickupGrid ? ['pickup-left', 'pickup-right'] : [])],
      bodyCount: node.blendBody ? 2 : 1, morph: node.pairedBody || node.blendBody ? { mapHash: node.blendBody ? node.parameters.profile.mapHash : node.parameters.map.hash, profileIdentity: node.blendBody ? node.parameters.profile.identity : node.parameters.profileIdentity, transitionPolicy: node.blendBody ? node.parameters.profile.transitionPolicy : node.parameters.map.transitionPolicy, control: 'morph01' } : null, pickupGrid: node.network?.pickupGrid ? { id: node.network.pickupGrid.id, units: node.network.pickupGrid.units, controls: arm.graph.bodyPickupControls?.(node.id) || null } : null,
      lossMasks: (node.network?.lossMasks || []).map((mask, index) => ({ id: mask.id, index, target01: arm.graph.bodyLossTargets?.(node.id)[index] ?? 0, pendingFuture: arm.graph.bodyLossFuture?.(node.id)[index] === true })),
      continuation: arm.continuation || null, pendingStrikeTokens: arm.graph.bodyPendingStrikeTokens?.(node.id) || [], strikeTokenFloor: arm.graph.bodyStrikeTokenFloor?.(node.id) || 0, pulses: (node.membrane?.pulses || []).map(pulse => ({ milliseconds: pulse.milliseconds, frames: pulse.frames })), quarantined: arm.graph.isBodyQuarantined?.(node.id) === true, sampleRate: context.sampleRate, active: arm === current && ['active', 'mute'].includes(mode), retiring: !!arm.retirement || arm !== current, retireAtFrame: Number.isFinite(arm.retireAt) ? Math.ceil(arm.retireAt * context.sampleRate) : null }))),
    enqueueBodyStrike(nodeId, command, expected) {
      const arm = preparedArm(expected);
      if (arm !== current || !['active', 'mute'].includes(mode)) throw failure('stale-prepared-body', 'New exciters require the active prepared body.');
      return Object.freeze({ ...arm.graph.enqueueBodyStrike(nodeId, command), ownerRouteRevision: arm.routeRevision });
    },
    updatePreparedBody(nodeId, values, targetFrame, expected) { const arm = preparedArm(expected); if (!arm.graph.plan.nodes.some(node => node.id === nodeId && (node.membrane || node.pairedBody || node.blendBody || node.network?.lossMasks.length || node.network?.pickupGrid))) throw failure('stale-prepared-body', 'The named node has no owned preparation contract.');
      if (Number.isFinite(arm.retireAt) && targetFrame >= Math.ceil(arm.retireAt * context.sampleRate)) throw failure('stale-prepared-body', 'The command falls after the retained body deadline.');
      return Object.freeze({ ...arm.graph.update(nodeId, values, targetFrame), ownerRouteRevision: arm.routeRevision, bodyLifecycle: arm === current ? 'active' : 'retained-tail' }); },
    panicPreparedBody(nodeId, expected) { const arm = preparedArm(expected); return arm.graph.panicBody(nodeId); },
    captureSnapshot: () => Object.freeze({ revision, mode, graphDefinitionHash: current?.graph.hash ?? null,
      transitionFrames: Math.ceil(transitionSeconds * context.sampleRate), appliedFrame: null }),
    performanceSnapshot: () => !disposed && current ? Object.freeze({ definition: current.graph.plan.definition, graphDefinitionHash: current.graph.hash, ownerRouteRevision: revision,
      mode, continuation: current.continuation || null, sampleRate: context.sampleRate, targetFrame: Math.ceil(context.currentTime * context.sampleRate), routeTransition: current.publication }) : null,
    latencyState: () => {
      let frames = 0, routes = 0, unresolved = disposed || unknown.size > 0;
      for (const arm of arms) {
        if (!arm.publication) continue;
        routes++;
        const value = arm.graph.plan.latencyFrames;
        if (!Number.isSafeInteger(value) || value < 0) unresolved = true;
        else frames = Math.max(frames, value);
      }
      return Object.freeze({ latencyFrames: unresolved ? null : frames, routes, unresolved });
    },
    requestInspection: () => current?.graph.requestInspection?.() || false,
    update(nodeId, values, targetFrame, expected = null) { guard(); assertMutable(); if (expected && (expected.ownerRouteRevision !== revision || expected.graphDefinitionHash !== current?.graph.hash)) throw failure('stale-effect-control', 'The effect control belongs to an earlier owner route.'); if (!current || !['active', 'mute'].includes(mode)) throw failure('effect-not-active', 'Prepare an active owner rack before performing its controls.'); return Object.freeze({ ...current.graph.update(nodeId, values, targetFrame), ownerRouteRevision: revision }); }, panic: () => bypass('panic'), state,
    dispose() {
      return retirement.retire([{ name: 'effect-host-retirement', run: async () => {
        disposed = true; serial++; if (timer != null) clearTimeout(timer); timer = null;
        dry.gain.cancelScheduledValues(context.currentTime); dry.gain.setValueAtTime(0, context.currentTime);
        for (const arm of arms) { try { arm.output.gain.cancelScheduledValues(context.currentTime); arm.output.gain.setValueAtTime(0, context.currentTime); } catch (caught) { error = caught.message; } }
        await stagedContinuation?.cancel();
        const preparations = [...pending]; for (const operation of preparations) operation.controller.abort(failure('effect-owner-disposed', 'Effect owner retired.'));
        await Promise.allSettled(preparations.map(operation => operation.promise));
        const receipts = [...arms].map(retireArm); await Promise.all(receipts.map(receipt => receipt.completion));
        if (unknown.size || receipts.some(receipt => receipt.outcome !== 'complete')) { metadata.retainUnknown(failure('effect-retirement-unknown', 'Effect host retirement is unresolved.')); throw failure('effect-retirement-unknown', 'Effect host retirement is unresolved.'); }
        metadata.release(); report();
      } }]);
    } });
}
