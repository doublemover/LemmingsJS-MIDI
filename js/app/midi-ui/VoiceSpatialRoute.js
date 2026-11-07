import { validateSpatialState } from '../../midi/content/SpatialState.js';
import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';

export function createVoiceSpatialRoute({ context, resources, owner, generation, start, state: raw, zoneOwner } = {}) {
  const initial = validateSpatialState(raw);
  if (context.state === 'closed' || !context.createBiquadFilter || !context.createStereoPanner || !zoneOwner?.pin) throw new Error('This source has no prepared native world spatial renderer.');
  const lease = resources.reserve({ kind: 'voice-world-spatial-route', owner, generation, estimateBytes: 131072, consumerOwned: true }), scope = createProcgenRetirementScope(), nodes = [], sends = new Map();
  let pin = null, input = null, gain = null, filter = null, pan = null, stale = null, post = null, disposed = false, frame = -1, expiry = start, gainCurve, panCurve, filterCurve;
  const node = value => { nodes.push(value); return value; };
  const dispose = () => { if (scope.getReceipt()) return scope.getReceipt(); disposed = true; const receipt = scope.retire([
    { name: 'spatial-send-inputs', run: () => { if (post) for (const send of sends.values()) post.disconnect(send.node); } },
    { name: 'spatial-native-nodes', run: () => { for (const node of nodes) node.disconnect(); } },
    { name: 'spatial-map-pin', run: () => pin?.release() }
  ]); const released = releaseAudioResourceAfterRetirement(lease, receipt); return released?.then ? released.then(() => receipt) : receipt; };
  const update = (raw, targetFrame) => {
    if (disposed || !Number.isSafeInteger(targetFrame) || targetFrame < frame) return { status: 'rejected', reason: 'spatial-frame-or-owner-unavailable' };
    let state; try { state = validateSpatialState(raw); } catch { return { status: 'rejected', reason: 'invalid-spatial-state' }; }
    if (state.voiceId !== initial.voiceId || state.worldId !== initial.worldId || state.generation !== initial.generation || state.mapId !== initial.mapId || state.mapRevision !== initial.mapRevision || state.sourceAttachment.kind !== initial.sourceAttachment.kind || state.sourceAttachment.bodyId !== initial.sourceAttachment.bodyId || state.panMode !== initial.panMode) return { status: 'rejected', reason: 'spatial-source-revision-changed' };
    const now = context.currentTime, at = Math.max(start, targetFrame / context.sampleRate, now), entries = new Map(state.zoneSends.map(send => [send.returnId, send.amount01]));
    if ([gainCurve, panCurve, filterCurve, ...[...sends.values()].map(send => send.curve)].some(curve => !curve.canInsert(now)) || [...entries].some(([id, amount]) => amount > 0 && !sends.has(id))) return { status: 'rejected', reason: 'spatial-control-or-return-capacity' };
    try {
      if (!gainCurve.insert(state.gain01, at, now) || !panCurve.insert(state.pan01, at, now) || !filterCurve.insert(Math.min(context.sampleRate * 0.4, state.lowpassHz), at, now)) throw new Error('Spatial source smoothing refused.');
      for (const [id, send] of sends) if (!send.curve.insert(entries.get(id) || 0, at, now)) throw new Error('Spatial send smoothing refused.');
      const previous = at <= expiry ? 1 : Math.max(0, 1 - (at - expiry) / 0.02);
      stale.gain.cancelScheduledValues(at); stale.gain.setValueAtTime(previous, at); stale.gain.linearRampToValueAtTime(1, at + 0.008);
      expiry = state.sourceAttachment.kind === 'actor' ? at + (state.validUntil.sourceTick - state.sourceTick) * state.sourceTickDurationMs / 1000 : Infinity;
      if (Number.isFinite(expiry)) { stale.gain.setValueAtTime(1, Math.max(at + 0.008, expiry)); stale.gain.linearRampToValueAtTime(0, Math.max(at + 0.008, expiry) + 0.02); } frame = targetFrame;
      return Object.freeze({ status: 'accepted', stage: 'spatial-controls-scheduled', voiceId: state.voiceId, generation: state.generation, sourceTick: state.sourceTick, targetFrame, appliedFrame: null, mapHash: pin.mapHash, state, stalePolicy: state.sourceAttachment.kind === 'actor' ? 'hold-then20ms-fade;no-position-extrapolation' : 'fixed-world-source-through-owned-tail;no-actor-follow', acousticReceipt: false });
    } catch { return { status: 'rejected', reason: 'spatial-native-automation-failed' }; }
  };
  try {
    pin = zoneOwner.pin(initial); input = node(context.createGain()); gain = node(context.createGain()); filter = node(context.createBiquadFilter()); pan = node(context.createStereoPanner()); stale = node(context.createGain());
    if (initial.panMode === 'mono') { input.channelCount = 1; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers'; }
    filter.type = 'lowpass'; filter.Q.setValueAtTime(Math.SQRT1_2, start); input.connect(gain); gain.connect(filter); filter.connect(pan); pan.connect(stale);
    gainCurve = createSmoothedAudioParameter({ param: gain.gain, initialValue: initial.gain01, startTime: start, smoothingSeconds: initial.smoothingSeconds });
    panCurve = createSmoothedAudioParameter({ param: pan.pan, initialValue: initial.pan01, startTime: start, smoothingSeconds: initial.smoothingSeconds });
    filterCurve = createSmoothedAudioParameter({ param: filter.frequency, initialValue: Math.min(context.sampleRate * 0.4, initial.lowpassHz), startTime: start, smoothingSeconds: initial.smoothingSeconds });
    for (const row of pin.returns) if (row.node) {
      const send = node(context.createGain()), curve = createSmoothedAudioParameter({ param: send.gain, initialValue: 0, startTime: start, smoothingSeconds: initial.smoothingSeconds }); send.connect(row.node); sends.set(row.id, { node: send, curve });
    }
    const result = update(initial, Math.round(start * context.sampleRate)); if (result.status !== 'accepted') throw new Error(result.reason);
    return { input, output: stale, update, dispose, mapHash: pin.mapHash, connectSends(source) { if (post) throw new Error('Spatial sends already have their owning lane source.'); post = source; for (const send of sends.values()) post.connect(send.node); } };
  } catch (error) { const receipt = dispose(); if (receipt?.outcome && receipt.outcome !== 'complete') error.retirement = receipt; throw error; }
}
