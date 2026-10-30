import { createInstrumentExecutionLifecycle } from './InstrumentExecutionLifecycle.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';

const reject = reason => Object.freeze({ status: 'rejected', reason, stage: 'none' });
const keyFor = (epoch, voiceId) => JSON.stringify([epoch, voiceId]);
const validLane = lane => typeof lane === 'string' && lane.length > 0 && lane.length <= 160;
let nextRouter = 0;

export function createRoutedInstrumentBackend({ defaultBackend, getContext, getGeneration, resolveLane = value => String(value), maxChildren = 17, maxVoices = 512,
  defaultReleaseSeconds = null, defaultOneShotTailSeconds = null, maxLanes = 1024, resourceBudget = null, requiredInstrumentKey = () => null, getLaneMix = () => ({ gain: 1, pan: 0 }), resolveSharedTopologyBody = null, onTopologyBody = null } = {}) {
  if (!defaultBackend?.registerExecution || !defaultBackend?.inspectExecution || typeof getContext !== 'function' || typeof getGeneration !== 'function' || typeof resolveLane !== 'function' ||
      !Number.isInteger(maxChildren) || maxChildren < 2 || maxChildren > 65 || !Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > 2048 ||
      !Number.isSafeInteger(maxLanes) || maxLanes < 1 || maxLanes > 1024 || typeof requiredInstrumentKey !== 'function' || [resolveSharedTopologyBody, onTopologyBody].some(callback => callback != null && typeof callback !== 'function')) throw new TypeError('Invalid routed instrument owner.');
  if ([defaultReleaseSeconds, defaultOneShotTailSeconds].some(value => value != null && (!Number.isFinite(value) || value < 0 || value > 4))) throw new TypeError('Invalid default release policy.');
  const defaults = { key: 'default', backend: defaultBackend, retirement: null, assignedLanes: 0, releaseSeconds: defaultReleaseSeconds, oneShotTailSeconds: defaultOneShotTailSeconds },
    children = new Map([['default', defaults]]), assignments = new Map(), assignmentVersions = new Map(), executions = new Map(), voices = new Map();
  const retirement = createProcgenRetirementScope(), displayObservers = new Set();
  const metadata = createOwnedResourceReservation({ budget: resourceBudget, owner: 'routed-instruments-' + (++nextRouter), kind: 'routed-instrument-metadata', category: 'audio', bytes: 4096 });
  const metadataBytes = ({ lanes = 0, renderers = 0, voices: extraVoices = 0, epochs = 0, displays = 0 } = {}) => 4096 +
    (assignments.size + lanes) * 512 + (children.size + renderers) * 17408 + (voices.size + extraVoices) * 512 +
    (executions.size + epochs) * (maxChildren * 256 + 1024) + (displayObservers.size + displays) * (maxChildren * 128 + 1024);
  const reserveMetadata = extra => metadata.resize(metadataBytes(extra));
  let disposed = false, voiceCursor = voices.entries(), collected = 0, routeRevision = 0, assignmentSerial = 0, displayContext = null;
  const attachDisplay = (observer, child, handle) => {
    if (!observer.active || observer.children.has(child) || typeof child.backend.observeDisplaySamples !== 'function') return;
    try {
      const release = child.backend.observeDisplaySamples(observer.listener, { ...observer.options, execution: handle });
      if (typeof release !== 'function') throw new Error('Renderer display lease is unavailable.'); observer.children.set(child, release);
    } catch { observer.failures++; }
  };
  const stateFor = (child, execution, voiceId = null) => {
    try { const result = child.backend.inspectExecution(execution, voiceId); return result?.status === 'accepted' ? result : null; } catch { return null; }
  };
  const collectVoices = (limit = 16) => {
    for (let index = 0; index < limit && voices.size; index++) {
      let item = voiceCursor.next(); if (item.done) { voiceCursor = voices.entries(); item = voiceCursor.next(); if (item.done) break; }
      const [key, voice] = item.value;
      if (stateFor(voice.child, voice.execution, voice.voiceId)?.voiceSettled === true) { voices.delete(key); collected++; }
    }
  };
  const childSettled = child => {
    for (const execution of executions.values()) {
      const handle = execution.children.get(child);
      if (handle && stateFor(child, handle)?.settled !== true) return false;
    }
    return true;
  };
  const retireChild = child => {
    if (child.retirementScope) return child.retirementScope.getReceipt();
    child.retirementScope = createProcgenRetirementScope();
    const handles = [...executions.values()].filter(execution => execution.children.has(child));
    child.retirement = child.retirementScope.retire([
      ...[...displayObservers].filter(observer => observer.children.has(child)).map((observer, index) => ({ name: 'display-' + index, run: () => {
        const release = observer.children.get(child); release(); observer.children.delete(child);
      } })),
      ...handles.map((execution, index) => ({ name: 'execution-' + index, run: () => child.backend.retireExecution(execution.children.get(child)) })),
      { name: 'renderer', run: () => child.backend.dispose() }
    ]);
    const acknowledge = receipt => { if (receipt.outcome === 'complete') { children.delete(child.key); for (const execution of handles) execution.children.delete(child); } };
    acknowledge(child.retirement); if (child.retirement.state !== 'retired') child.retirement.completion.then(acknowledge);
    return child.retirement;
  };
  const collect = () => {
    collectVoices();
    for (const child of children.values()) if (child !== defaults && !child.pins && !child.assignedLanes && !child.retirementScope && childSettled(child)) retireChild(child);
    if (!disposed && metadataBytes() < metadata.receipt().declaredBytes) reserveMetadata();
  };
  const executionFor = (child, epoch, generation) => {
    let execution = executions.get(epoch);
    if (!execution) { if (executions.size >= 64) return null; try { reserveMetadata({ epochs: 1 }); } catch { return null; }
      execution = { generation, children: new Map(), leaseUntil: null }; executions.set(epoch, execution); }
    if (execution.generation !== generation || child.retirementScope) return null;
    if (!execution.children.has(child)) {
      const registered = child.backend.registerExecution({ executionEpoch: epoch, generation }); if (registered?.status !== 'accepted') return null;
      execution.children.set(child, registered.execution);
      for (const observer of displayObservers) if (observer.active && observer.epoch === epoch) attachDisplay(observer, child, registered.execution);
      if (execution.leaseUntil != null && child.backend.renewExecutionLease(generation, registered.execution, execution.leaseUntil)?.status !== 'accepted') return null;
    }
    return execution.children.get(child);
  };
  const begin = (intent, targetFrame, epoch) => {
    if (disposed) return reject('disposed');
    if (!Number.isSafeInteger(intent?.generation) || intent.generation < 0 || typeof intent.voiceId !== 'string' || !intent.voiceId || intent.voiceId.length > 512) return reject('invalid-intent');
    collectVoices();
    if (voices.size >= maxVoices) collectVoices(voices.size);
    if (voices.size >= maxVoices || voices.has(keyFor(epoch, intent?.voiceId))) return reject('routed-voice-capacity-or-duplicate');
    let lane; try { lane = resolveLane(intent.laneId); } catch { return reject('lane-unavailable'); }
    const assigned = assignments.get(lane), child = assigned || defaults; if (child.blocked) return reject(child.reason);
    let expected; try { expected = requiredInstrumentKey(lane, intent.laneId); } catch { return reject('lane-requirement-unavailable'); }
    if (expected && assigned?.key !== expected) return reject('pinned-instrument-not-prepared');
    let sharedBody = null;
    if (intent.topologyBinding && (intent.topologyBinding.bodyId !== child.bodyId || intent.topologyBinding.dampingMacroId && !child.macroIds?.includes(intent.topologyBinding.dampingMacroId))) {
      try { sharedBody = resolveSharedTopologyBody?.(intent, targetFrame); } catch {}
      if (!sharedBody || sharedBody.bodyId !== intent.topologyBinding.bodyId || sharedBody.boundTopologyRevision !== intent.topologyBinding.boundTopologyRevision || !Number.isSafeInteger(sharedBody.bodyRevision) || sharedBody.bodyRevision < 1 || !Number.isSafeInteger(sharedBody.ownerRouteRevision) || sharedBody.ownerRouteRevision < 0 || !/^[a-f0-9]{64}$/.test(sharedBody.graphDefinitionHash) || !/^[a-f0-9]{64}$/.test(sharedBody.bodyIdentityHash) || intent.topologyBinding.dampingMacroId) return reject('topology-body-or-macro-unavailable');
    }
    const execution = executionFor(child, epoch, intent.generation); if (!execution) return reject('renderer-execution-unavailable');
    try { reserveMetadata({ voices: 1 }); } catch { return reject('audio-resource-budget'); }
    const laneMix = getLaneMix(lane, intent.laneId); if (!laneMix) return reject('lane-unavailable');
    if (laneMix.muted || laneMix.soloSuppressed || laneMix.gain === 0) return reject(laneMix.muted ? 'lane-muted' : laneMix.soloSuppressed ? 'lane-solo-suppressed' : 'lane-zero-gain');
    const outcome = child.backend.begin({ ...intent, laneMix, audioLaneId: lane }, targetFrame, execution);
    if (outcome?.status === 'accepted') voices.set(keyFor(epoch, intent.voiceId), { child, execution, epoch, laneId: lane, sourceLaneId: intent.laneId, mix: laneMix, mixFault: false, voiceId: intent.voiceId, articulation: outcome.articulation || child });
    if (sharedBody) try { onTopologyBody?.(Object.freeze({ status: outcome?.status || 'rejected', stage: 'shared-topology-body-excitation', intentId: intent.intentId, sourceEventIds: intent.sourceEventIds, generation: intent.generation, voiceId: intent.voiceId, targetFrame, topologyBody: Object.freeze({ ...sharedBody }), acousticReceipt: false })); } catch {}
    return outcome;
  };
  const voiceCall = (method, voiceId, value, frame, epoch, rampSeconds) => {
    if (disposed) return reject('disposed'); const voice = voices.get(keyFor(epoch, voiceId));
    if (!voice) return reject('voice-unavailable');
    if (method === 'end' && value?.transitionPolicy !== 'crossfade' && voice.articulation.releaseSeconds != null) value = { ...value, seconds: voice.articulation.releaseSeconds,
      ...(value?.mode === 'one-shot' && value.durationSource !== 'physical-interval' && voice.articulation.oneShotTailSeconds != null ? { tailSeconds: voice.articulation.oneShotTailSeconds } : {}) };
    if (method === 'updateCanonicalTravel' && typeof voice.child.backend.updateCanonicalTravel !== 'function') return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false, reason: 'no-canonical-travel-binding' });
    if (method === 'updateSampleTravel' && typeof voice.child.backend.updateSampleTravel !== 'function') return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false, reason: 'no-sample-travel-binding' });
    if (method === 'updateSamplePosition' && typeof voice.child.backend.updateSamplePosition !== 'function') return reject('sample-position-unavailable');
    if (method === 'updatePhysical' && typeof voice.child.backend.updatePhysical !== 'function') return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false, reason: 'no-continuous-binding' });
    return voice.child.backend[method](voiceId, value, frame, voice.execution, rampSeconds);
  };
  const applyMix = (voice, frame, laneId = voice.laneId, sourceLaneId = voice.sourceLaneId) => {
    if (!Number.isSafeInteger(frame) || frame < 0) return reject('lane-mix-clock-unavailable');
    const mix = getLaneMix(laneId, sourceLaneId), transferred = laneId !== voice.laneId;
    if (voice.mixFault) return reject('lane-mix-owner-ended');
    if (!transferred && mix && ['gain', 'pan'].every(key => voice.mix?.[key] === mix[key])) { voice.mix = mix; voice.sourceLaneId = sourceLaneId; return { status: 'accepted', stage: 'unchanged' }; }
    frame = Math.max(frame, voice.mixFrame ?? 0);
    let outcome; try { outcome = mix && voice.child.backend.updateLaneMix?.(voice.voiceId, mix, frame, voice.execution, laneId); } catch { outcome = null; }
    if (outcome?.status === 'accepted') { voice.mix = mix; voice.laneId = laneId; voice.sourceLaneId = sourceLaneId; voice.mixFrame = outcome.targetFrame ?? frame; return outcome; }
    voice.mixFault = true;
    const termination = voice.child.backend.end(voice.voiceId, { seconds: 0.005, force: true }, frame, voice.execution);
    return { status: 'degraded', reason: mix ? 'lane-mix-failed-owner-ended' : 'lane-removed-owner-ended', termination };
  };
  const synchronizeLaneMix = frame => {
    if (!Number.isSafeInteger(frame) || frame < 0 || disposed) return { status: 'rejected', reason: 'lane-mix-clock-unavailable' };
    collectVoices(maxVoices); const outcomes = [...voices.values()].map(voice => Object.freeze({ voiceId: voice.voiceId, laneId: voice.laneId, ...applyMix(voice, frame) }));
    return Object.freeze({ status: outcomes.every(value => value.status === 'accepted') ? 'accepted' : 'degraded', outcomes: Object.freeze(outcomes) });
  };
  const transferVoiceLane = (voiceId, laneId, frame, epoch) => {
    const voice = voices.get(keyFor(epoch, voiceId)); if (!voice) return reject('voice-unavailable');
    let resolved; try { resolved = resolveLane(laneId); } catch { return reject('lane-unavailable'); }
    if (!validLane(resolved)) return reject('lane-unavailable'); return applyMix(voice, frame, resolved, laneId);
  };
  const cancelGenerationWithReceipt = (generation, epoch) => {
    const execution = executions.get(epoch), outcomes = [];
    const receipt = createProcgenRetirementScope().retire(execution && execution.generation === generation ? [...execution.children].map(([child, handle]) => ({ name: child.key, run: () => {
      const outcome = child.backend.cancelGenerationWithReceipt(generation, handle); outcomes.push(outcome);
      return outcome?.retirement?.schema === 'lemmings-retirement/v1' ? outcome.retirement : outcome;
    } })) : []);
    return Object.freeze({ status: receipt.outcome === 'partial' ? 'degraded' : 'accepted', count: outcomes.reduce((sum, outcome) => sum + (outcome?.count || 0), 0), retirement: receipt });
  };
  const renewExecutionLease = (generation, epoch, until) => {
    if (disposed || !Number.isSafeInteger(generation) || generation < 0 || !Number.isSafeInteger(until) || until < 0) return reject('invalid-execution-lease');
    let execution = executions.get(epoch); if (!execution) { if (executions.size >= 64) return reject('execution-identity-capacity');
      try { reserveMetadata({ epochs: 1 }); } catch { return reject('audio-resource-budget'); }
      execution = { generation, children: new Map(), leaseUntil: null }; executions.set(epoch, execution); }
    if (execution.generation !== generation || execution.leaseUntil != null && until <= execution.leaseUntil) return reject('stale-execution-lease');
    const outcomes = [...execution.children].map(([child, handle]) => child.backend.renewExecutionLease(generation, handle, until));
    if (outcomes.some(outcome => outcome?.status !== 'accepted')) return reject('renderer-lease-rejected'); execution.leaseUntil = until; return Object.freeze({ status: 'accepted' });
  };
  const backend = { begin, transferVoiceLane, update: (...args) => voiceCall('update', ...args), updatePhysical: (...args) => voiceCall('updatePhysical', ...args), updateSamplePosition: (...args) => voiceCall('updateSamplePosition', ...args), updateSampleTravel: (...args) => voiceCall('updateSampleTravel', ...args), updateCanonicalTravel: (...args) => voiceCall('updateCanonicalTravel', ...args), end: (...args) => voiceCall('end', ...args), renewExecutionLease,
    setDisplayContext(value) {
      if (!value || typeof value.worldId !== 'string' || !Number.isSafeInteger(value.graphRevision) || value.graphRevision < 0 ||
          !Number.isSafeInteger(value.routeRevision) || value.routeRevision < 0) throw new TypeError('Invalid routed display context.');
      displayContext = Object.freeze({ worldId: value.worldId, graphRevision: value.graphRevision, routeRevision: value.routeRevision });
      for (const child of children.values()) { try { child.backend.setDisplayContext?.(displayContext); } catch { /* Display admission cannot affect sound routing. */ } }
    },
    observeDisplaySamples(listener, options = {}) {
      const epoch = options.identity?.executionEpoch, execution = executions.get(epoch);
      if (disposed || !execution || typeof listener !== 'function' || displayObservers.size >= 4 || execution.generation !== options.identity?.generation) throw new TypeError('Routed display observation is unavailable.');
      reserveMetadata({ displays: 1 });
      const observer = { epoch, listener, options, children: new Map(), active: true, failures: 0, retirement: createProcgenRetirementScope() };
      const release = () => {
        observer.active = false;
        const receipt = observer.retirement.retire([...observer.children].map(([child, stop]) => ({ name: child.key, run: stop })));
        if (receipt.outcome !== 'complete') throw Object.assign(new Error('Routed display retirement is incomplete.'), { retirement: receipt });
        observer.children.clear(); displayObservers.delete(observer);
      };
      observer.release = release; displayObservers.add(observer);
      for (const [child, handle] of execution.children) attachDisplay(observer, child, handle); return release;
    },
    cancelGenerationWithReceipt, cancelGeneration: (...args) => cancelGenerationWithReceipt(...args).count,
    capabilities: Object.freeze({ routedInstruments: true, independentSamePitch: true, ownedGates: true, renderAcknowledgment: false }),
    renderDiagnostics: () => { collect(); return Object.freeze({ children: children.size, assignments: assignments.size, retainedVoices: voices.size,
      maxLanes, maxChildren, maxVoices, metadata: metadata.receipt(), collectedVoices: collected, routeRevision, displayObservers: displayObservers.size, displayFailures: [...displayObservers].reduce((sum, observer) => sum + observer.failures, 0),
      unknownRetirement: [...children.values()].filter(child => child.retirement?.outcome === 'partial').length,
      renderers: Object.freeze([...children.values()].map(child => Object.freeze({ key: child.key, assignedLanes: child.assignedLanes, retirement: child.retirement?.outcome || null,
        diagnostics: child.backend.renderDiagnostics() }))) }); },
    dispose: () => { disposed = true; let sources; return retirement.retire([
      { name: 'owned-renderers', run: () => sources = createProcgenRetirementScope().retire([
        ...[...displayObservers].map((observer, index) => ({ name: 'display-' + index, run: observer.release })),
        ...[...children.values()].map(child => ({ name: child.key, run: () => retireChild(child) }))]) },
      { name: 'routing-metadata', run: async () => { await sources.completion; if (sources.outcome !== 'complete') throw new Error('Routed renderer metadata still has unresolved owners.');
        assignments.clear(); assignmentVersions.clear(); voices.clear(); executions.clear(); displayObservers.clear(); metadata.release(); } }
    ]); }
  };
  const lifecycle = createInstrumentExecutionLifecycle(backend, { getContext, getGeneration,
    isSettled: epoch => { const execution = executions.get(epoch); return !execution || [...execution.children].every(([child, handle]) => stateFor(child, handle)?.settled === true); },
    isVoiceSettled: (voiceId, epoch) => { const voice = voices.get(keyFor(epoch, voiceId)); return !voice || stateFor(voice.child, voice.execution, voiceId)?.voiceSettled === true; },
    forget: epoch => {
      const execution = executions.get(epoch);
      const receipt = createProcgenRetirementScope().retire(execution ? [...execution.children].map(([child, handle]) => ({ name: child.key, run: () => {
        const result = child.backend.retireExecution(handle);
        if (result?.status !== 'accepted') throw new Error('Child execution retirement was not accepted.'); return result.retirement;
      } })) : []);
      if (receipt.outcome !== 'complete') throw Object.assign(new Error('Routed execution retirement is incomplete.'), { retirement: receipt });
      executions.delete(epoch); for (const [key, voice] of voices) if (voice.epoch === epoch) voices.delete(key); collect();
    }
  });
  return Object.freeze({ backend: lifecycle.api,
    canAssign(key) { collect(); const child = children.get(key); return !disposed && (child ? !child.retirementScope : children.size < maxChildren); },
    assign(lane, key, renderer, { releaseSeconds = null, oneShotTailSeconds = null, bodyId = null, macroIds = [] } = {}) {
      if (!validLane(lane) || typeof key !== 'string' || !key || key.length > 256 || key === 'default' || disposed || !renderer?.inspectExecution) throw new TypeError('Invalid lane instrument assignment.');
      if ([releaseSeconds, oneShotTailSeconds].some(value => value != null && (!Number.isFinite(value) || value < 0 || value > 4))) throw new TypeError('Invalid authored release policy.');
      if (bodyId != null && (typeof bodyId !== 'string' || bodyId.length > 128) || !Array.isArray(macroIds) || macroIds.length > 4 || macroIds.some(id => typeof id !== 'string' || id.length > 128)) throw new TypeError('Invalid prepared body identity.');
      collect(); if (!assignments.has(lane) && assignments.size >= maxLanes) throw new Error('Routed lane capacity exceeded.'); let child = children.get(key);
      if (child && (child.backend !== renderer || child.retirementScope || child.bodyId !== bodyId || JSON.stringify(child.macroIds) !== JSON.stringify(macroIds)) || !child && children.size >= maxChildren) throw new Error('Lane instrument replacement exceeds retained renderer capacity.');
      if (!Number.isSafeInteger(assignmentSerial + 1)) throw new Error('Lane assignment identity exhausted.');
      reserveMetadata({ lanes: assignments.has(lane) ? 0 : 1, renderers: child ? 0 : 1 });
      if (!child) { child = { key, backend: renderer, retirement: null, assignedLanes: 0, pins: 0, releaseSeconds, oneShotTailSeconds, bodyId, macroIds: [...macroIds] }; children.set(key, child);
        if (displayContext) { try { renderer.setDisplayContext?.(displayContext); } catch { /* Presentation cannot prevent prepared sound assignment. */ } }
      }
      const previous = assignments.get(lane);
      if (previous !== child) { if (previous && !previous.blocked) previous.assignedLanes--; child.assignedLanes++; routeRevision++; } assignments.set(lane, child); assignmentVersions.set(lane, ++assignmentSerial); return Object.freeze({ laneId: lane, key, revision: assignmentSerial });
    },
    find: key => children.get(key)?.retirementScope ? null : children.get(key)?.backend || null,
    retain(key) { const child = children.get(key); if (!child || child.retirementScope || disposed) return null; child.pins = (child.pins || 0) + 1; let released = false;
      return Object.freeze({ backend: child.backend, release() { if (!released) { released = true; child.pins--; collect(); } } }); },
    assignment: lane => assignments.get(lane)?.key || null,
    retainAssignment(lane) {
      if (!validLane(lane) || disposed) throw new Error('Lane assignment owner is unavailable.');
      const previous = assignments.get(lane) || null; if (previous && !previous.blocked) previous.pins = (previous.pins || 0) + 1;
      let released = false;
      return Object.freeze({ key: previous?.key || null,
        restore(receipt) {
          if (released || disposed) throw new Error('Previous lane assignment lease is retired.');
          if (receipt?.laneId !== lane || assignmentVersions.get(lane) !== receipt.revision || assignments.get(lane)?.key !== receipt.key) return Object.freeze({ status: 'superseded', restoresNewerSelection: false });
          if (!Number.isSafeInteger(assignmentSerial + 1) || previous?.retirementScope) throw new Error('Previous lane renderer cannot be restored.');
          const current = assignments.get(lane); if (current && !current.blocked) current.assignedLanes--;
          if (previous) { if (!previous.blocked) previous.assignedLanes++; assignments.set(lane, previous); assignmentVersions.set(lane, ++assignmentSerial); }
          else { assignments.delete(lane); assignmentVersions.delete(lane); assignmentSerial++; }
          routeRevision++; collect(); return Object.freeze({ status: 'restored', key: previous?.key || null });
        },
        release() { if (released) return; released = true; if (previous && !previous.blocked) previous.pins--; collect(); }
      });
    },
    unassign(lane) { const previous = assignments.get(lane); if (assignments.delete(lane)) { assignmentVersions.delete(lane); if (!previous.blocked) previous.assignedLanes--; routeRevision++; } collect(); },
    block(lane, reason) { if (!validLane(lane) || typeof reason !== 'string' || !reason || reason.length > 128 || disposed || !assignments.has(lane) && assignments.size >= maxLanes) throw new TypeError('Invalid lane requirement failure.');
      if (!Number.isSafeInteger(assignmentSerial + 1)) throw new Error('Lane assignment identity exhausted.');
      reserveMetadata({ lanes: assignments.has(lane) ? 0 : 1 });
      const previous = assignments.get(lane); if (previous && !previous.blocked) previous.assignedLanes--;
      if (!assignments.get(lane)?.blocked || assignments.get(lane).reason !== reason) routeRevision++; assignments.set(lane, { blocked: true, reason }); assignmentVersions.set(lane, ++assignmentSerial); collect(); },
    synchronizeLaneMix, routeRevision: () => routeRevision,
    collect, dispose: lifecycle.api.dispose
  });
}
