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
  const dryAutomation = createSmoothedAudioParameter({ param: dry.gain, initialValue: 1, startTime: context.currentTime, smoothingSeconds: transitionSeconds, maxEvents: 32 });
  const retirement = createProcgenRetirementScope({ deadlineMs: 15000 }), arms = new Set(), pending = new Set(), unknown = new Set();
  let current = null, disposed = false, revision = 0, serial = 0, timer = null, mode = 'neutral', error = null;
  const state = () => Object.freeze({ schema: 'lemmings-owner-effect-state/v1', owner, generation, revision, mode, disposed, preparing: pending.size,
    activeGraph: current?.graph.diagnostics() || null, retiringGraphs: [...arms].filter(arm => arm !== current).length, maximumConcurrentGraphs: 2,
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
  const tail = arm => { if (!arm) return; if (arm.graph.gateSidechains) arm.graph.gateSidechains(0, context.currentTime, transitionSeconds); else arm.graph.deactivateSidechains?.(); arm.inAutomation.insert(0, context.currentTime, context.currentTime);
    arm.retireAt = Math.max(context.currentTime + transitionSeconds, (arm.graph.lastBodyDriveFrame?.() || 0) / context.sampleRate) + arm.graph.plan.maximumTailFrames / context.sampleRate; };
  const prepare = async (definition, { signal, isCurrent: requestCurrent = () => true } = {}) => {
    guard(); signal?.throwIfAborted();
    if (pending.size || arms.size >= 2) throw failure('effect-transition-capacity', 'Two effect revisions already own their transition or tails. Clear tails or wait before preparing another.');
    const controller = new AbortController(), request = ++serial, operation = { controller, promise: null, published: false };
    const abort = () => { if (!operation.published) controller.abort(signal.reason); }; signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    let graph = null, ownedGraph = null, arm = null, lease = null, published = false;
    const check = () => { guard(); controller.signal.throwIfAborted(); if (request !== serial || !requestCurrent()) throw failure('stale-effect-graph', 'A later effect request superseded this preparation.'); };
    operation.promise = (async () => {
      try {
        graph = await prepareGraph(definition, { resolveSidechainSource: request => {
          if (resolveSidechainSource) return resolveSidechainSource(request);
          if (request.sourceBusId !== 'owner' || request.tap !== 'post-fader' || request.inputLayout !== 'audioStereo') return null;
          return { node: input, context, owner, generation, sourceBusId: 'owner', tap: 'post-fader', layout: 'audioStereo', stage: 'upstream-owner-effects',
            isActive: () => !disposed && context.state !== 'closed' && isCurrent(), release() {} };
        }, context, resources, owner, generation, getMaterialProvider, signal: controller.signal, isCurrent: () => !disposed && isCurrent() && (published || requestCurrent() && request === serial),
        onEffectReceipt: receipt => { const member = current; if (!disposed && member?.graph === ownedGraph) { try { onEffectReceipt(Object.freeze({ ...receipt, owner, ownerGeneration: generation, ownerRouteRevision: member.routeRevision })); } catch {} } },
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
        arm.inAutomation = createSmoothedAudioParameter({ param: arm.input.gain, initialValue: 0, startTime: context.currentTime, smoothingSeconds: transitionSeconds, maxEvents: 32 });
        input.connect(arm.input); arm.connectedSource = true; arm.input.connect(graph.getInput(graph.plan.inputs[0])); graph.getOutput(graph.plan.outputs[0]).connect(arm.output); arm.output.connect(destination); check();
        await graph.activateSidechains?.({ silent: true }); check(); graph.checkPublication?.();
        const previous = current;
        arm.graph.gateSidechains?.(1, context.currentTime, transitionSeconds); arm.inAutomation.insert(1, context.currentTime, context.currentTime); arm.output.gain.setValueAtTime(1, context.currentTime); dryAutomation.insert(0, context.currentTime, context.currentTime);
        tail(previous); current = arm; published = operation.published = true; pending.delete(operation);
        mode = 'active'; error = null; revision++; current.routeRevision = revision; graph = null; arm = null; lease = null; poll(); report(); return state();
      } catch (caught) {
        if (arm) { if (current === arm) current = null; const receipt = retireArm(arm); await receipt.completion; if (receipt.outcome !== 'complete') caught.retirement = receipt; }
        else if (graph) { const receipt = graph.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') { unknown.add({ graph, receipt }); caught.retirement = receipt; } lease?.release(); }
        if (caught.retirement?.outcome !== 'complete' && caught.retirement) unknown.add({ receipt: caught.retirement });
        error = caught.message; report(); throw caught;
      } finally { signal?.removeEventListener('abort', abort); pending.delete(operation); report(); }
    })();
    pending.add(operation); report(); return operation.promise;
  };
  const bypass = (selected, expected = null) => {
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
    guard(); const arm = [...arms].find(arm => !arm.retirement && arm.routeRevision === expected?.ownerRouteRevision && arm.graph.hash === expected?.graphDefinitionHash);
    if (!arm) throw failure('stale-prepared-body', 'The exact prepared body revision has retired or was superseded.'); return arm;
  };
  return Object.freeze({ prepare, bypass,
    preparedBodyInventory: () => [...arms].flatMap(arm => arm.graph.plan.nodes.filter(node => node.membrane || node.pairedBody || node.blendBody || node.network?.lossMasks.length || node.network?.pickupGrid).map(node => Object.freeze({ owner, ownerGeneration: generation, ownerRouteRevision: arm.routeRevision, graphDefinitionHash: arm.graph.hash, nodeId: node.id,
      processorRevision: (node.membrane || node.pairedBody || node.blendBody || node.network).revision, bodyKind: node.membrane ? 'membrane' : node.pairedBody ? 'paired-synthetic-modal-body' : node.blendBody ? 'prepared-two-endpoint-blend' : 'authored-modal-network', preparationKinds: node.membrane ? ['touch', 'pickup-left', 'pickup-right'] : node.pairedBody || node.blendBody ? ['morph'] : [...(node.network.lossMasks.length ? ['mode-loss'] : []), ...(node.network.pickupGrid ? ['pickup-left', 'pickup-right'] : [])],
      bodyCount: node.blendBody ? 2 : 1, morph: node.pairedBody || node.blendBody ? { mapHash: node.blendBody ? node.parameters.profile.mapHash : node.parameters.map.hash, profileIdentity: node.blendBody ? node.parameters.profile.identity : node.parameters.profileIdentity, transitionPolicy: node.blendBody ? node.parameters.profile.transitionPolicy : node.parameters.map.transitionPolicy, control: 'morph01' } : null, pickupGrid: node.network?.pickupGrid ? { id: node.network.pickupGrid.id, units: node.network.pickupGrid.units, controls: arm.graph.bodyPickupControls?.(node.id) || null } : null,
      lossMasks: (node.network?.lossMasks || []).map((mask, index) => ({ id: mask.id, index, target01: arm.graph.bodyLossTargets?.(node.id)[index] ?? 0, pendingFuture: arm.graph.bodyLossFuture?.(node.id)[index] === true })),
      pulses: (node.membrane?.pulses || []).map(pulse => ({ milliseconds: pulse.milliseconds, frames: pulse.frames })), quarantined: arm.graph.isBodyQuarantined?.(node.id) === true, sampleRate: context.sampleRate, active: arm === current && ['active', 'mute'].includes(mode), retiring: !!arm.retirement || arm !== current, retireAtFrame: Number.isFinite(arm.retireAt) ? Math.ceil(arm.retireAt * context.sampleRate) : null }))),
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
      mode, sampleRate: context.sampleRate, targetFrame: Math.ceil(context.currentTime * context.sampleRate) }) : null,
    requestInspection: () => current?.graph.requestInspection?.() || false,
    update(nodeId, values, targetFrame, expected = null) { guard(); if (expected && (expected.ownerRouteRevision !== revision || expected.graphDefinitionHash !== current?.graph.hash)) throw failure('stale-effect-control', 'The effect control belongs to an earlier owner route.'); if (!current || !['active', 'mute'].includes(mode)) throw failure('effect-not-active', 'Prepare an active owner rack before performing its controls.'); return Object.freeze({ ...current.graph.update(nodeId, values, targetFrame), ownerRouteRevision: revision }); }, panic: () => bypass('panic'), state,
    dispose() {
      return retirement.retire([{ name: 'effect-host-retirement', run: async () => {
        disposed = true; serial++; if (timer != null) clearTimeout(timer); timer = null;
        dry.gain.cancelScheduledValues(context.currentTime); dry.gain.setValueAtTime(0, context.currentTime);
        for (const arm of arms) { try { arm.output.gain.cancelScheduledValues(context.currentTime); arm.output.gain.setValueAtTime(0, context.currentTime); } catch (caught) { error = caught.message; } }
        const preparations = [...pending]; for (const operation of preparations) operation.controller.abort(failure('effect-owner-disposed', 'Effect owner retired.'));
        await Promise.allSettled(preparations.map(operation => operation.promise));
        const receipts = [...arms].map(retireArm); await Promise.all(receipts.map(receipt => receipt.completion));
        if (unknown.size || receipts.some(receipt => receipt.outcome !== 'complete')) { metadata.retainUnknown(failure('effect-retirement-unknown', 'Effect host retirement is unresolved.')); throw failure('effect-retirement-unknown', 'Effect host retirement is unresolved.'); }
        metadata.release(); report();
      } }]);
    } });
}
