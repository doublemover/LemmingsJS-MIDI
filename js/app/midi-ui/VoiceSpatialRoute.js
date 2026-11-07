import { validateSpatialState } from '../../midi/content/SpatialState.js';
import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';

export function createVoiceSpatialRoute({ context, resources, owner, generation, start, state: raw, zoneOwner } = {}) {
  const initial = validateSpatialState(raw);
  if (context.state === 'closed' || !context.createBiquadFilter || !context.createStereoPanner || !zoneOwner?.pin) throw new Error('This source has no prepared native world spatial renderer.');
  const lease = resources.reserve({ kind: 'voice-world-spatial-route', owner, generation, estimateBytes: 262144, consumerOwned: true }), scope = createProcgenRetirementScope(), nodes = [], retained = [];
  let pin = null, sends = new Map(), input = null, gain = null, filter = null, pan = null, stale = null, post = null, disposed = false, frame = -1, expiry = start, gainCurve, panCurve, filterCurve;
  const node = value => { nodes.push(value); return value; };
  const releaseSet = group => {
    for (const send of group.sends.values()) { if (send.connected) { post.disconnect(send.node); send.connected = false; } send.node.disconnect(); const index = nodes.indexOf(send.node); if (index >= 0) nodes.splice(index, 1); }
    group.pin.release();
  };
  const collect = now => { for (let index = retained.length - 1; index >= 0; index--) if (now >= retained[index].until) { releaseSet(retained[index]); retained.splice(index, 1); } };
  const buildSet = (selected, at, smoothingSeconds) => {
    const result = new Map();
    try {
      for (const row of selected.returns) if (row.node) {
        const send = node(context.createGain()), entry = { node: send, curve: null, connected: false }; result.set(row.id, entry);
        entry.curve = createSmoothedAudioParameter({ param: send.gain, initialValue: 0, startTime: at, smoothingSeconds }); send.connect(row.node);
        if (post) { post.connect(send); entry.connected = true; }
      }
      return result;
    } catch (error) { releaseSet({ pin: selected, sends: result }); throw error; }
  };
  const dispose = () => { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; const receipt = scope.retire([
    { name: 'spatial-send-inputs', run: () => { for (const group of [{ sends }, ...retained]) for (const send of group.sends.values()) if (send.connected) post.disconnect(send.node); } },
    { name: 'spatial-native-nodes', run: () => { for (const node of nodes) node.disconnect(); } },
    { name: 'spatial-map-pins', run: () => { pin?.release(); for (const group of retained) group.pin.release(); retained.length = 0; } }
  ]); const released = releaseAudioResourceAfterRetirement(lease, receipt); return released?.then ? released.then(() => receipt) : receipt; };
  const update = (raw, targetFrame) => {
    if (disposed || !Number.isSafeInteger(targetFrame) || targetFrame < frame) return { status: 'rejected', reason: 'spatial-frame-or-owner-unavailable' };
    let state; try { state = validateSpatialState(raw); } catch { return { status: 'rejected', reason: 'invalid-spatial-state' }; }
    if (state.voiceId !== initial.voiceId || state.worldId !== initial.worldId || state.generation !== initial.generation || state.sourceAttachment.kind !== initial.sourceAttachment.kind || state.sourceAttachment.bodyId !== initial.sourceAttachment.bodyId || state.panMode !== initial.panMode) return { status: 'rejected', reason: 'spatial-source-attachment-or-layout-changed' };
    const now = context.currentTime, at = Math.max(start, targetFrame / context.sampleRate, now), entries = new Map(state.zoneSends.map(send => [send.returnId, send.amount01])); let transition = null, staged = null;
    try {
      collect(now);
      if ([gainCurve, panCurve, filterCurve, ...[...sends.values()].map(send => send.curve)].some(curve => !curve.canInsert(now))) return { status: 'rejected', reason: 'spatial-control-capacity' };
      if (state.mapId !== pin.mapId || state.mapRevision !== pin.mapRevision || zoneOwner.isPinnedCurrent?.(pin) === false) {
        if (retained.length >= 2) return { status: 'rejected', reason: 'spatial-map-transition-capacity' };
        const candidate = zoneOwner.pin(state), next = buildSet(candidate, at, state.smoothingSeconds); staged = { pin: candidate, sends: next };
        if ([...entries].some(([id, amount]) => amount > 0 && !next.has(id))) { releaseSet(staged); staged = null; return { status: 'rejected', reason: 'spatial-return-unavailable' }; }
        for (const send of sends.values()) if (!send.curve.insert(0, at, now, 0.02)) throw new Error('Outgoing spatial send refused its bounded fade.');
        transition = { outgoingMapHash: pin.mapHash, incomingMapHash: candidate.mapHash, firstFrame: targetFrame, fadeFrames: Math.ceil(0.02 * context.sampleRate), tailPolicy: 'retain-outgoing-shared-return' };
        retained.push({ pin, sends, until: at + 0.02 }); pin = candidate; sends = next; staged = null;
      }
      if ([...entries].some(([id, amount]) => amount > 0 && !sends.has(id))) return { status: 'rejected', reason: 'spatial-return-unavailable' };
      if (!gainCurve.insert(state.gain01, at, now) || !panCurve.insert(state.pan01, at, now) || !filterCurve.insert(Math.min(context.sampleRate * 0.4, state.lowpassHz), at, now)) throw new Error('Spatial source smoothing refused.');
      for (const [id, send] of sends) if (!send.curve.insert(entries.get(id) || 0, at, now, transition ? 0.02 : state.smoothingSeconds)) throw new Error('Spatial send smoothing refused.');
      const previous = at <= expiry ? 1 : Math.max(0, 1 - (at - expiry) / 0.02);
      stale.gain.cancelScheduledValues(at); stale.gain.setValueAtTime(previous, at); stale.gain.linearRampToValueAtTime(1, at + 0.008);
      expiry = state.sourceAttachment.kind === 'actor' ? at + (state.validUntil.sourceTick - state.sourceTick) * state.sourceTickDurationMs / 1000 : Infinity;
      if (Number.isFinite(expiry)) { stale.gain.setValueAtTime(1, Math.max(at + 0.008, expiry)); stale.gain.linearRampToValueAtTime(0, Math.max(at + 0.008, expiry) + 0.02); } frame = targetFrame;
      return Object.freeze({ status: 'accepted', stage: 'spatial-controls-scheduled', voiceId: state.voiceId, generation: state.generation, sourceTick: state.sourceTick, targetFrame, appliedFrame: null, mapHash: pin.mapHash, state, transition,
        stalePolicy: state.sourceAttachment.kind === 'actor' ? 'hold-then20ms-fade;no-position-extrapolation' : 'fixed-world-source-through-owned-tail;no-actor-follow', acousticReceipt: false });
    } catch { if (staged) { try { releaseSet(staged); } catch {} } return { status: 'rejected', reason: 'spatial-native-automation-failed' }; }
  };
  try {
    pin = zoneOwner.pin(initial); input = node(context.createGain()); gain = node(context.createGain()); filter = node(context.createBiquadFilter()); pan = node(context.createStereoPanner()); stale = node(context.createGain());
    if (initial.panMode === 'mono') { input.channelCount = 1; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers'; }
    filter.type = 'lowpass'; filter.Q.setValueAtTime(Math.SQRT1_2, start); input.connect(gain); gain.connect(filter); filter.connect(pan); pan.connect(stale);
    gainCurve = createSmoothedAudioParameter({ param: gain.gain, initialValue: initial.gain01, startTime: start, smoothingSeconds: initial.smoothingSeconds });
    panCurve = createSmoothedAudioParameter({ param: pan.pan, initialValue: initial.pan01, startTime: start, smoothingSeconds: initial.smoothingSeconds });
    filterCurve = createSmoothedAudioParameter({ param: filter.frequency, initialValue: Math.min(context.sampleRate * 0.4, initial.lowpassHz), startTime: start, smoothingSeconds: initial.smoothingSeconds });
    const selected = pin; pin = null; sends = buildSet(selected, start, initial.smoothingSeconds); pin = selected;
    const result = update(initial, Math.round(start * context.sampleRate)); if (result.status !== 'accepted') throw new Error(result.reason);
    return { input, output: stale, update, dispose, get mapHash() { return pin.mapHash; }, connectSends(source) { if (post) throw new Error('Spatial sends already have their owning lane source.'); post = source; for (const send of sends.values()) { post.connect(send.node); send.connected = true; } } };
  } catch (error) { const receipt = dispose(); if (receipt?.outcome && receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
