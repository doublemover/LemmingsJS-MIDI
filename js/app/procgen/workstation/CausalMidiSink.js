import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

const reject = reason => Object.freeze({ status: 'rejected', reason });
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const quantize = value => Math.round(value * 127);

export function createCausalMidiSink({ ports, getLanes, isEnabled, now, onReceipt = () => {}, maxVoices = 64, delayMs = 24 } = {}) {
  if (!ports || typeof getLanes !== 'function' || typeof isEnabled !== 'function' || typeof now !== 'function' ||
      !Number.isSafeInteger(maxVoices) || maxVoices < 1 || maxVoices > 256 || !Number.isFinite(delayMs) || delayMs < 1 || delayMs > 1000) throw new Error('Invalid causal MIDI sink configuration.');
  const executions = new Map(), retirement = createProcgenRetirementScope();
  let disposed = false, anchor = null, latestReceipt = null;
  const enabled = () => { try { return !disposed && isEnabled() === true; } catch { return false; } };
  const currentMicroseconds = () => {
    const value = Math.floor(now() * 1000); return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const report = (entry, outcome) => {
    const receipt = Object.freeze({ ...outcome, worldId: entry.intent.worldId ?? null, onsetId: entry.intent.onsetId ?? null,
      eventId: entry.intent.eventId ?? (entry.intent.sourceEventIds?.length === 1 ? entry.intent.sourceEventIds[0] : null), ...entry.routeIdentity,
      intentId: entry.intent.intentId, batchId: entry.intent.batchId,
      generation: entry.intent.generation, voiceId: entry.intent.voiceId, sourceEventIds: entry.intent.sourceEventIds,
      sourceBoundary: Object.freeze({ tick: entry.intent.scoreTime.simTick, generation: entry.intent.generation }),
      sinkId: entry.sinkId, executionEpoch: entry.executionEpoch, targetTimeDomain: 'performance-microseconds', submittedAtMs: now() });
    latestReceipt = receipt;
    if (outcome.status === 'accepted' && (['submitted', 'expression-submission', 'initial-expression-submission'].includes(outcome.stage) || entry.terminalIntent && outcome.terminal?.state === 'release-submitted')) entry.admission?.acknowledge({ ackState: 'driver-submitted', acknowledgedTime: receipt.submittedAtMs, acknowledgementTimeDomain: 'performance-ms' });
    try { onReceipt(receipt); } catch { /* Diagnostics cannot change output ownership. */ }
  };
  const laneFor = id => typeof id === 'number' ? getLanes()[id] : getLanes().find(lane => lane.id === id);
  const stateFor = execution => executions.get(execution);
  const ownedCount = () => { let count = 0; for (const state of executions.values()) count += state.voices.size; return count; };
  const expressionFor = (entry, expression) => {
    if (!expression || Object.getPrototypeOf(expression) !== Object.prototype) return { error: 'invalid-midi-expression' };
    const patch = {}, losses = [];
    for (const [key, value] of Object.entries(expression)) {
      if (key === 'pitchOffsetCents') {
        if (!Number.isFinite(value)) return { error: 'invalid-midi-expression' };
        if (!entry.mpe) { if (value !== entry.initialOffset) losses.push({ kind: 'per-note-pitch-unavailable', requestedCents: value }); continue; }
        const delta = entry.baseCents + value - entry.note * 100;
        const bend = entry.memberRange === 0 && Math.abs(delta) < 1e-8 ? 0 : delta / (entry.memberRange * 100);
        if (!Number.isFinite(bend) || bend < -1 || bend > 1) return { error: 'mpe-pitch-range-exceeded' };
        patch.bend = bend;
      } else if (['pan01', 'pressure01', 'timbre01', 'gain01'].includes(key)) {
        if (!unit(value)) return { error: 'invalid-midi-expression' };
        if (!entry.mpe) { losses.push({ kind: 'per-note-expression-unavailable', parameter: key }); continue; }
        patch[{ pan01: 'pan', pressure01: 'pressure', timbre01: 'timbre', gain01: 'gain' }[key]] = quantize(value);
      } else losses.push({ kind: 'midi-expression-unrepresented', parameter: key });
    }
    return { patch, losses };
  };
  const retireExecution = execution => {
    const state = stateFor(execution);
    if (!state) return createProcgenRetirementScope().retire([]);
    state.closed = true;
    state.retirement ||= createProcgenRetirementScope();
    return state.retirement.retire([...state.voices.values()].map(entry => ({ name: entry.intent.voiceId, run: () => {
      const outcome = ports.endOwnedVoice(entry.handle, { timeMs: now(), reason: 'physical-execution-retired' });
      if (outcome.status !== 'accepted') throw new Error(outcome.reason || 'MIDI terminal ownership is unresolved.');
      state.voices.delete(entry.intent.voiceId);
    } })).concat({ name: 'execution-state', run: () => {
      if (state.voices.size) throw new Error('MIDI voice ownership remains unresolved.');
      executions.delete(execution); if (!executions.size) anchor = null;
    } }));
  };
  const backend = {
    executionIncarnation: () => ports.getRouteRevision(),
    registerExecution({ executionEpoch, generation }) {
      if (!enabled()) return reject('midi-output-disabled');
      if ([...executions.values()].some(state => state.closed && state.voices.size || [...state.voices.values()].some(entry => entry.uncertain))) return reject('midi-retirement-unknown');
      if (typeof executionEpoch !== 'string' || !executionEpoch || !Number.isSafeInteger(generation) || generation < 0) return reject('invalid-midi-execution');
      for (const [execution, state] of executions) if (state.epoch === executionEpoch && state.generation === generation && !state.closed) return { status: 'accepted', execution };
      if (executions.size >= 2) return reject('midi-execution-capacity');
      const execution = Object.freeze({ schema: 'causal-midi-execution/v1', epoch: executionEpoch, generation });
      executions.set(execution, { epoch: executionEpoch, generation, voices: new Map(), closed: false, retirement: null });
      return { status: 'accepted', execution };
    },
    begin(intent, targetMicroseconds, execution, admission) {
      const state = stateFor(execution), lane = laneFor(intent.laneId);
      if (!state || state.closed || !enabled() || intent.generation !== state.generation || !lane) return reject('midi-execution-unavailable');
      if ([...executions.values()].some(owner => [...owner.voices.values()].some(entry => entry.uncertain))) return reject('midi-retirement-unknown');
      if (state.voices.has(intent.voiceId)) return reject('duplicate-midi-voice');
      if (ownedCount() >= maxVoices) return reject('causal-midi-voice-capacity');
      const route = ports.getNoteRoute(lane.outputId);
      if (route.status !== 'accepted' || !route.ownedVoices || route.mpeReady === false) return reject(route.mpeFailure || route.reason || 'midi-route-unavailable');
      const reference = intent.pitch?.referenceHz ?? 440, offset = intent.expression?.pitchOffsetCents ?? 0;
      const baseCents = intent.pitch?.cents + 1200 * Math.log2(reference / 440), cents = baseCents + offset, note = Math.round(cents / 100);
      if (!Number.isFinite(baseCents) || !Number.isFinite(offset) || reference <= 0 || !Number.isInteger(note) || note < 0 || note > 127 || !unit(intent.velocity01) || intent.velocity01 === 0) return reject('midi-pitch-or-velocity-unrepresentable');
      const memberRange = route.mpeZone?.memberRange ? route.mpeZone.memberRange.semitones + route.mpeZone.memberRange.cents / 100 : null;
      const entry = { intent, handle: null, note, baseCents, initialOffset: offset, mpe: !!route.mpeZone && !lane.externalPercussion, memberRange, outputId: route.outputId, uncertain: false,
        sinkId: 'physical-midi:' + intent.route, executionEpoch: state.epoch, admission,
        routeIdentity: ports.getOutputAdmissionIdentity?.(route.outputId) ?? { connectionEpoch: null, routeRevision: ports.getRouteRevision() } };
      const expression = expressionFor(entry, intent.expression || {});
      if (expression.error) return reject(expression.error);
      const losses = [...expression.losses];
      if (!entry.mpe && Math.abs(cents - note * 100) > 1e-8) losses.push({ kind: 'midi1-semitone-quantization', requestedCents: cents, representedCents: note * 100 });
      const initialBend = entry.mpe ? memberRange === 0 && Math.abs(cents - note * 100) < 1e-8 ? 0 : (cents - note * 100) / (memberRange * 100) : null;
      if (entry.mpe && (!Number.isFinite(initialBend) || Math.abs(initialBend) > 1)) return reject('mpe-pitch-range-exceeded');
      const outcome = ports.beginOwnedVoice({ note, velocity: Math.max(1, quantize(intent.velocity01)), timeMs: targetMicroseconds / 1000,
        channel: lane.channel, outputId: route.outputId, ...(lane.externalProgram == null ? {} : { program: lane.externalProgram }),
        ...(lane.externalPercussion ? { percussion: true } : {}),
        ...(lane.bankMSB == null ? {} : { bankMSB: lane.bankMSB }), ...(lane.bankLSB == null ? {} : { bankLSB: lane.bankLSB }),
        ...(entry.mpe ? { mpe: true, pitchBend: initialBend } : {}) },
      { intentId: intent.intentId, onsetId: intent.onsetId, batchId: intent.batchId, voiceId: intent.voiceId, sourceEventIds: intent.sourceEventIds,
        generation: intent.generation, laneIndex: getLanes().indexOf(lane), laneCount: getLanes().length, source: 'physical-intent' },
      { canSubmit: enabled, onSubmitted: receipt => report(entry, receipt), onTerminal: terminal => {
        entry.uncertain = terminal.state === 'uncertain';
        if (!entry.uncertain) state.voices.delete(intent.voiceId);
        const failed = entry.uncertain || terminal.state === 'cancelled' && !state.closed && !entry.terminalIntent;
        report(entry.terminalIntent ? { ...entry, intent: entry.terminalIntent, admission: entry.terminalAdmission } : entry, { status: failed ? 'rejected' : 'accepted', stage: 'voice-terminal', terminal, reason: entry.uncertain ? 'release-unconfirmed' : failed ? terminal.reason : null });
      } });
      if (outcome.status !== 'accepted') {
        if (outcome.handle && outcome.terminal?.state === 'uncertain') { entry.handle = outcome.handle; entry.uncertain = true; state.voices.set(intent.voiceId, entry); }
        return outcome;
      }
      entry.handle = outcome.handle; state.voices.set(intent.voiceId, entry);
      const extra = { ...expression.patch }; delete extra.bend;
      if (Object.keys(extra).length) {
        const applied = ports.updateOwnedVoice(entry.handle, extra, { timeMs: targetMicroseconds / 1000, onResult: result => report(entry, { ...result, stage: 'initial-expression-submission' }) });
        if (applied.status !== 'accepted') {
          const stopped = ports.endOwnedVoice(entry.handle, { timeMs: now(), reason: 'initial-expression-rejected' });
          if (stopped.status === 'accepted') state.voices.delete(intent.voiceId);
          return reject(applied.reason || 'midi-initial-expression-rejected');
        }
      }
      return Object.freeze({ status: losses.length ? 'degraded' : 'accepted', stage: outcome.stage,
        ...(losses.length ? { reason: 'midi-representation-loss', losses: Object.freeze(losses) } : {}), outputId: route.outputId, channel: outcome.channel });
    },
    update(voiceId, expression, targetMicroseconds, execution, slewSeconds, causeIntent, admission) {
      const state = stateFor(execution), entry = state && !state.closed && state.voices.get(voiceId);
      if (!entry || entry.uncertain || !enabled()) return reject('midi-voice-unavailable');
      const mapped = expressionFor(entry, expression); if (mapped.error) return reject(mapped.error);
      const source = causeIntent ? { ...entry, intent: causeIntent, admission } : entry;
      const outcome = ports.updateOwnedVoice(entry.handle, mapped.patch, { timeMs: targetMicroseconds / 1000, onResult: result => report(source, { ...result, stage: 'expression-submission' }) });
      if (outcome.status !== 'accepted') return outcome;
      return mapped.losses.length ? Object.freeze({ status: 'degraded', stage: outcome.stage, reason: 'midi-representation-loss', losses: Object.freeze(mapped.losses), outputRequested: Object.keys(mapped.patch).length > 0 }) : outcome;
    },
    updatePhysical() { return Object.freeze({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'physical-audio-control-unrepresented-in-midi' }); },
    updateCanonicalTravel() { return Object.freeze({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'travel-audio-realization-unrepresented-in-midi' }); },
    transferVoiceLane(voiceId, laneId, targetMicroseconds, execution) {
      const entry = stateFor(execution)?.voices.get(voiceId), lane = laneFor(laneId);
      if (!entry || !lane) return reject('midi-voice-unavailable');
      const route = ports.getNoteRoute(lane.outputId);
      if (route.status !== 'accepted' || route.outputId !== entry.outputId) return Object.freeze({ status: 'degraded', stage: 'semantic-observation', outputRequested: false, reason: 'held-midi-route-pinned-until-release' });
      return Object.freeze({ status: 'accepted', stage: 'semantic-observation', outputRequested: false });
    },
    end(voiceId, options, targetMicroseconds, execution, causeIntent, admission) {
      const state = stateFor(execution), entry = state?.voices.get(voiceId);
      if (!entry) return Object.freeze({ status: 'accepted', stage: 'already-retired', outputRequested: false });
      entry.terminalIntent = causeIntent || entry.intent; entry.terminalAdmission = admission;
      const timeMs = targetMicroseconds / 1000 + (options?.mode === 'one-shot' ? options.tailSeconds * 1000 : 0);
      return ports.endOwnedVoice(entry.handle, { timeMs, reason: options?.mode === 'one-shot' ? 'physical-one-shot-ended' : 'physical-voice-ended' });
    },
    cancelGenerationWithReceipt(generation, execution) {
      const state = stateFor(execution);
      return state && state.generation !== generation ? reject('foreign-midi-generation') : retireExecution(execution);
    },
    retireExecution
  };
  const latePolicy = ({ intent, targetFrame }) => {
    const current = currentMicroseconds(); if (current == null || !enabled()) return reject('midi-clock-unavailable');
    if (targetFrame > current) return { status: 'accepted', targetFrame };
    return intent.kind === 'end' ? { status: 'accepted', targetFrame: current, repair: 'late-release' } : reject(intent.kind === 'begin' ? 'late-attack' : 'stale-expression');
  };
  return {
    enabled,
    lastOutcome: () => latestReceipt,
    observe(score, { bpm, executionEpoch }) {
      if (!enabled()) return;
      if (!Number.isFinite(score?.beat) || !Number.isFinite(bpm) || bpm <= 0 || typeof executionEpoch !== 'string') { anchor = null; throw new Error('Invalid causal MIDI clock anchor.'); }
      if (!anchor || anchor.executionEpoch !== executionEpoch || anchor.scoreEpoch !== score.epoch || anchor.bpm !== bpm) anchor = { executionEpoch, scoreEpoch: score.epoch, beat: score.beat, hostMs: now() + delayMs, bpm };
    },
    sinks: ['local', 'prepared-body'].map(route => Object.freeze({ id: 'physical-midi:' + route, route, backend, enabled,
      getAdmissionIdentity: intent => ports.getOutputAdmissionIdentity?.(laneFor(intent.laneId)?.outputId) ?? { connectionEpoch: null, routeRevision: ports.getRouteRevision() },
      executionLease: false, timeDomain: 'performance-microseconds', latePolicy, toTargetFrame: score => {
        if (!enabled() || !anchor || score?.epoch !== anchor.scoreEpoch || !Number.isFinite(score.beat)) return null;
        const timeMs = anchor.hostMs + (score.beat - anchor.beat) * 60000 / anchor.bpm;
        const value = Math.round(timeMs * 1000); return Number.isSafeInteger(value) && value >= 0 && timeMs - now() <= 5000 ? value : null;
      } })),
    diagnostics: () => Object.freeze({ disposed, enabled: enabled(), executions: executions.size, ownedVoices: ownedCount(), latestReceipt, clock: anchor ? Object.freeze({ ...anchor }) : null }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; return retirement.retire([...executions.keys()].map(execution => ({ name: execution.epoch, run: () => retireExecution(execution) }))); }
  };
}
