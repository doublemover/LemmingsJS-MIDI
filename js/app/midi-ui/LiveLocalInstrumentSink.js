import { createRoutedInstrumentBackend } from './RoutedInstrumentBackend.js';
import { resolveLocalDrumArticulation } from './LocalDrumArticulation.js';
import { createLaneInstrumentPreparation } from './LaneInstrumentPreparation.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { getLocalAudioNotePan } from '../../midi/scheduler/LocalAudioVoiceBudget.js';
import { createProcgenRetirementScope, afterProcgenRetirement } from '../procgen/ProcgenRetirement.js';

const failure = (code, message) => Object.assign(new Error(message), { code });
const defaultResolution = Object.freeze({ status: 'ready', patch: Object.freeze({ id: 'local-instrument-routing-default', revision: 1, engineId: 'native-oscillator', engineVersion: 1,
  parameters: Object.freeze({ waveform: 1, gain01: 0, attackSeconds: 0.004, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.04 }), sampleRefs: Object.freeze([]),
  voicePolicy: Object.freeze({ maxVoices: 64, steal: 'reject' }), mix: Object.freeze({ gain01: 0, pan01: 0 }) }), receipt: Object.freeze({ patchId: 'local-instrument-routing-default', revision: 1 }) });
const keyFor = reference => reference ? reference.packHash + ':' + reference.definitionHash : null;
let ownerSequence = 0;

export function localInstrumentTracks(config) {
  const tracks = new Map();
  for (const mapping of [...Object.values(config?.sfx || {}), ...Object.values(config?.triggers || {})]) if (mapping?.instrumentRef && mapping.trackId) tracks.set(mapping.trackId, { id: mapping.trackId, instrumentRef: mapping.instrumentRef, instrumentControls: mapping.instrumentControls });
  for (const entry of config?.localInstruments || []) if (entry?.instrumentRef && entry.trackId) tracks.set(entry.trackId, { id: entry.trackId, instrumentRef: entry.instrumentRef, instrumentControls: entry.instrumentControls });
  for (const role of config?.ensemble?.roles || []) if (role.track?.instrumentRef) tracks.set(role.track.id, { id: role.track.id, instrumentRef: role.track.instrumentRef, instrumentControls: role.track.instrumentControls });
  return [...tracks.values()];
}

export function createLiveLocalInstrumentSink({ audio, resourceBudget = null, now = () => performance.now(), onState = () => {}, onReceipt = () => {}, isCurrent = () => true } = {}) {
  if (!audio?.getAudioContext || !audio?.getSoundMaterialProvider || typeof now !== 'function') throw new TypeError('Live local instruments require the shared audio owner.');
  const ownerOrdinal = ++ownerSequence, ownerId = 'live-local-instruments:' + ownerOrdinal, ownedSession = !audio.createInstrumentBackend, session = ownedSession ? audio.createSession(ownerId) : audio;
  if (!session?.createInstrumentBackend) throw new TypeError('The live local instrument session is unavailable.');
  const retirement = createProcgenRetirementScope(), initializedRetirement = createProcgenRetirementScope(), voices = new Map(), trackInstances = new Map(); let config = null, tracks = [], native = null, routed = null, instruments = null, initialized = null;
  let disposed = false, generation = 0, serial = 0, execution = null, leaseUntil = 0, context = null, preparing = 0, admitted = 0, refused = 0, latest = null, nextTrackInstance = 0;
  const report = fields => { latest = Object.freeze({ schema: 'live-local-instrument-state/v1', ownerId, preparing, admitted, refused, ...fields }); try { onState(latest); } catch {} };
  const observe = receipt => { try { onReceipt(Object.freeze({ ...receipt, ownerId, acousticReceipt: false })); } catch {} };
  const check = () => { if (disposed || !isCurrent()) throw failure('stale-local-instrument-owner', 'The game or local instrument owner changed.'); };
  const initialize = () => initialized ||= (async () => {
    native = session.createInstrumentBackend({ gateMode: 'owned' });
    const prepared = await native.prepare(defaultResolution); check(); if (prepared.status !== 'ready') throw failure(prepared.reason, 'Local instrument routing could not be prepared.');
    routed = createRoutedInstrumentBackend({ defaultBackend: native, resourceBudget, maxChildren: 17, maxVoices: 128, getContext: () => audio.getAudioContext(), getGeneration: () => native.executionIncarnation(),
      resolveLane: laneId => String(laneId), getPerformanceControls: laneId => tracks.find(track => track.id === laneId)?.instrumentControls || {}, requiredInstrumentKey: laneId => keyFor(tracks.find(track => track.id === laneId)?.instrumentRef) });
    instruments = createLaneInstrumentPreparation({ session, routed, resourceBudget, getCatalog: () => audio.getInstrumentCatalog?.() ?? getNativeInstrumentCatalog(), getMaterialProvider: () => audio.getSoundMaterialProvider(), onState: value => report({ status: value.state, trackId: value.laneId, reason: value.code }) });
  })();
  const prepare = async next => {
    check(); config = next; tracks = localInstrumentTracks(next); if (!tracks.length && !initialized) return true; if (tracks.length > 1024 || new Set(tracks.map(track => keyFor(track.instrumentRef))).size > 16) throw failure('local-instrument-capacity', 'Use at most sixteen distinct local instruments across the active tracks.');
    const liveTrackIds = new Set(tracks.map(track => track.id)); for (const id of trackInstances.keys()) if (!liveTrackIds.has(id)) trackInstances.delete(id);
    for (const track of tracks) if (!trackInstances.has(track.id)) trackInstances.set(track.id, ++nextTrackInstance);
    preparing++; report({ status: 'preparing' });
    try {
      const enabled = session.enable(); await initialize(); if (!await enabled) throw failure('audio-not-ready', session.getState().message); check();
      context = audio.getAudioContext(); const results = await instruments.synchronize(tracks); check();
      const unavailable = results.filter(value => value.state !== 'ready');
      if (unavailable.length) throw failure(unavailable[0].code, 'A selected local instrument is unavailable: ' + unavailable.map(value => value.laneId + ' (' + value.code + ')').join(', '));
      routed.synchronizePerformance(Math.ceil((context.currentTime + 0.005) * context.sampleRate)); report({ status: 'ready' }); return true;
    } finally { preparing--; }
  };
  const collect = () => {
    if (!routed || !context) return;
    for (const [voiceId, voice] of voices) if (voice.endFrame <= context.currentTime * context.sampleRate || routed.backend.inspectExecution(voice.execution, voiceId)?.voiceSettled === true) voices.delete(voiceId);
  };
  const stop = () => {
    const previous = execution; execution = null; leaseUntil = 0; voices.clear();
    if (!previous || !routed) return null;
    return routed.backend.retireExecution(previous).retirement || null;
  };
  const submit = (spec, meta = {}, tickMs = 60) => {
    const reject = reason => { refused++; observe({ status: 'rejected', reason, trackId: spec?.trackId, sourceEventIds: meta.sourceEventIds || [] }); return false; };
    if (disposed || !isCurrent() || !routed || !context || context !== audio.getAudioContext() || context.state !== 'running' || !session.getState().enabled) return reject('local-instrument-not-ready');
    if (!spec?.instrumentRef || !spec.trackId || keyFor(tracks.find(track => track.id === spec.trackId)?.instrumentRef) !== keyFor(spec.instrumentRef)) return reject('local-instrument-revision-changed');
    const durationMs = spec.durationMs ?? spec.durationTicks * tickMs, when = Number.isFinite(spec.timeMs) ? spec.timeMs : now(), offset = (when - now()) / 1000;
    const pitch = spec.pitch?.cents ?? spec.note * 100, velocity01 = spec.velocity01 ?? (spec.reverse ? spec.releaseVelocity ?? spec.velocity ?? 64 : spec.velocity ?? 64) / 127;
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 16000 || !Number.isFinite(offset) || offset > 5 || offset < -0.12 || !Number.isFinite(pitch) || !Number.isFinite(velocity01) || velocity01 < 0 || velocity01 > 1) return reject('invalid-local-instrument-note');
    collect(); if (voices.size >= 128 || voices.size && [...voices.values()].filter(voice => voice.trackId === spec.trackId).length >= (spec.voiceBudget ?? 32)) return reject('local-track-voice-budget');
    const backend = routed.backend;
    if (!execution) { const registered = backend.registerExecution({ executionEpoch: ownerId + ':' + (++generation), generation }); if (registered.status !== 'accepted') return reject(registered.reason); execution = registered.execution; }
    const targetFrame = Math.ceil((context.currentTime + Math.max(0, offset) + 0.005) * context.sampleRate), endFrame = targetFrame + Math.max(1, Math.round(durationMs * context.sampleRate / 1000)), until = endFrame + Math.ceil(8.1 * context.sampleRate);
    if (until > leaseUntil) { const renewed = backend.renewExecutionLease(generation, execution, until); if (renewed.status !== 'accepted') return reject(renewed.reason); leaseUntil = until; }
    const instanceId = 'g' + ownerOrdinal.toString(36) + 'l' + Math.max(0, Math.min(1023, Math.trunc(meta.laneIndex || 0))).toString(36) + 't' + trackInstances.get(spec.trackId).toString(36);
    let drum; try { drum = resolveLocalDrumArticulation(spec.instrumentRef, { note: spec.note, velocity01, instanceId }); } catch (error) { return reject(error.code || 'invalid-drum-articulation'); }
    const voiceId = ownerId + ':voice:' + (++serial), bendRange = config.mpe?.enabled ? (config.mpe.pitchBendRange?.semitones ?? 2) + (config.mpe.pitchBendRange?.cents ?? 0) / 100 : 2;
    const intent = { version: 1, kind: 'begin', generation, voiceId, onsetId: voiceId, intentId: voiceId + ':begin', laneId: spec.trackId, actorId: meta.lemmingId ?? null,
      sourceEventIds: meta.sourceEventIds || [], ...(drum ? { sampleGesture: drum.sampleGesture, sampleKitId: drum.sampleKitId } : {}), pitch: { cents: drum?.pitchCents ?? pitch, referenceHz: spec.pitch?.referenceHz ?? 440 }, velocity01,
      performanceControls: spec.instrumentControls || { macros: {} }, expression: { pressure01: 1, pitchOffsetCents: spec.expression?.pitchOffsetCents ?? (spec.pitchBend ?? 0) * bendRange * 100, pan01: getLocalAudioNotePan(spec, meta, config.position) / 127 } };
    const begun = backend.begin(intent, targetFrame, execution); if (begun.status !== 'accepted') return reject(begun.reason);
    const ended = backend.end(voiceId, { ...(spec.percussion || drum ? { mode: 'one-shot' } : {}) }, endFrame, execution);
    if (ended.status !== 'accepted') { backend.end(voiceId, { seconds: 0.008, force: true }, targetFrame, execution); return reject(ended.reason); }
    voices.set(voiceId, { execution, endFrame, trackId: spec.trackId, phraseVoiceKey: spec.phraseVoiceKey, meta }); admitted++;
    observe({ status: 'accepted', stage: 'scheduled', voiceId, targetFrame, endFrame, trackId: spec.trackId, patchId: spec.instrumentRef.patchId, patchRevision: spec.instrumentRef.revision, ...(drum ? { percussion: drum } : {}), performance: begun.performance || null }); return true;
  };
  return Object.freeze({ handles: spec => !!spec?.instrumentRef, prepare, submit, stop,
    isPhraseBusy: key => { collect(); return [...voices.values()].some(voice => voice.phraseVoiceKey === key); },
    cancelPhrase(key) { let count = 0; for (const [id, voice] of voices) if (voice.phraseVoiceKey === key) { routed.backend.end(id, { seconds: 0.008, force: true }, Math.ceil(context.currentTime * context.sampleRate), voice.execution); voices.delete(id); count++; } return count; },
    activity: () => Object.freeze({ activeNotes: voices.size, pendingNotes: 0 }), state: () => latest,
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
      return retirement.retire([{ name: 'execution', run: stop }, { name: 'preparation', run: () => instruments?.dispose() },
        { name: 'initialization', run: () => initializedRetirement.retire([{ name: 'initialized-resources', run: async () => { try { await initialized; } catch {} const retired = createProcgenRetirementScope().retire([{ name: 'routing', run: () => routed?.backend.dispose() }, { name: 'default-renderer', run: () => native?.dispose() }, { name: 'late-preparation', run: () => instruments?.dispose() }]); await retired.completion; return retired; } }]) },
        { name: 'owned-session', run: () => ownedSession ? afterProcgenRetirement([initializedRetirement.getReceipt()], () => session.dispose()) : null }]);
    } });
}
