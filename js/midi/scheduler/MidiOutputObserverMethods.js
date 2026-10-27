import { resolveScale } from '../midi-mapping/MidiMappingDomain.js';
import { observeMidiByteSubmission } from './MidiByteSubmission.js';
let scopeSequence = 0;
const midiByte = value => Math.min(127, Math.max(0, Math.round(Number(value) || 0)));
const submittedMidiBytes = (method, channel, args) => {
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) return null;
  const status = (channel - 1) & 15, [a, b] = args;
  if (method === 'sendNoteOn') return [0x90 | status, midiByte(a), midiByte(b?.rawAttack)];
  if (method === 'sendNoteOff') return [0x80 | status, midiByte(a), midiByte(b?.rawRelease ?? 64)];
  if (method === 'sendControlChange') return [0xb0 | status, midiByte(a), midiByte(b)];
  if (method === 'sendAllNotesOff') return [0xb0 | status, 123, 0];
  if (method === 'sendProgramChange') return [0xc0 | status, midiByte(a)];
  if (method === 'sendChannelAftertouch') return [0xd0 | status, midiByte(b?.rawValue ? a : Number(a) * 127)];
  if (method === 'sendPitchBend') {
    const bend = Math.round((Math.max(-1, Math.min(1, Number(a) || 0)) + 1) * 16383 / 2);
    return [0xe0 | status, bend & 127, bend >> 7];
  }
  return null;
};
const midiOutputObserverMethods = {
  addSubmissionObserver(listener) {
    if (typeof listener !== 'function') return () => {};
    this._submissionObservers.add(listener);
    return () => this._submissionObservers.delete(listener);
  },

  setCapture(capture = null) {
    this.capture = typeof capture?.record === 'function' ? capture : null;
    if (!this._captureScope) this._captureScope = 'scheduler-' + (++scopeSequence);
  },

  _captureEnabled() {
    try { return !!this.capture && (typeof this.capture.isActive !== 'function' || this.capture.isActive()); } catch { return false; }
  },

  _captureScaleFields() {
    if (!this._captureEnabled()) return {};
    if (this._captureScaleSource !== this.config.scale || !this._captureScale) {
      this._captureScaleSource = this.config.scale;
      const scale = resolveScale(this.config.scale);
      this._captureScale = { scaleRoot: scale.root, scaleDegrees: [...scale.degrees], scaleName: this.config.scale?.name || 'custom' };
    }
    return this._captureScale;
  },

  _sendAccountedCleanup(output, channel, method, args = [], meta = {}) {
    const result = this._submitAccountedOutput(output, channel, method, args, meta, { phase: 'off' });
    if (result.error) throw result.error;
    return result.ok;
  },

  _submitAccountedOutput(output, channel, method, args = [], meta = {}, rateMeta = {}) {
    let count = 0, bytes = 0;
    const remove = this.addSubmissionObserver(event => {
      if (event.output !== output || event.channel !== channel || event.method !== method || !event.accepted || !event.midiBytes && !output?.supportsPerNoteInstrument) return;
      count++; bytes += event.midiBytes?.length ?? 3;
    });
    try { return { ok: this._sendOutput(output, channel, method, args, meta) !== false, acceptedMessages: count, acceptedBytes: bytes, error: null }; }
    catch (error) { return { ok: false, acceptedMessages: count, acceptedBytes: bytes, error }; }
    finally {
      remove();
      if (count) this._recordSent({ ...rateMeta, timeMs: this._nowMs(), outputId: output?.id ?? null, count, bytes }, this._nowMs());
    }
  },

  _observe(stage, fields) {
    if (!this._captureEnabled()) return null;
    try { return this.capture?.record(stage, { ...this._captureScaleFields(), ...fields, captureScope: this._captureScope }) ?? null; } catch { return null; }
  },

  _sendOutput(output, channel, method, args = [], meta = {}) {
    const scope = this._outputChannelScopes?.get(output);
    if (channel != null && scope && !scope.has(channel)) return false;
    const target = channel == null ? output : output?.channels?.[channel];
    const send = target?.[method];
    if (typeof send !== 'function' || output?.state === 'disconnected') return false;
    const capturing = this._captureEnabled();
    const observing = this._submissionObservers?.size > 0;
    const invoke = () => {
      this._outputCallbackDepth = (this._outputCallbackDepth || 0) + 1;
      try { return send.apply(target, args); } finally { this._outputCallbackDepth--; }
    };
    if (!capturing && !observing) return invoke();
    if (output?.supportsPerNoteInstrument && capturing && (method === 'sendNoteOn' || method === 'sendNoteOff')) {
      args = [args[0], { ...args[1], capture: { ...meta, observedByScheduler: true } }];
    }
    const [a, b, c] = args;
    const options = method === 'sendControlChange' ? c : b;
    const fields = { ...this._outputLeases.get(output), ...meta, outputId: output?.id ?? null, outputScope: output?.captureScope ?? output?.id ?? null, channel,
      backend: output?.supportsPerNoteInstrument ? 'local-synth-api' : 'midi-output-api',
      scheduledMs: Number.isFinite(options?.time) ? options.time : Number.isFinite(meta?.scheduledMs) ? meta.scheduledMs : this._nowMs() };
    if (method === 'sendNoteOn' || method === 'sendNoteOff') Object.assign(fields, {
      type: method === 'sendNoteOn' ? 'noteOn' : 'noteOff', note: a,
      velocity: options?.rawAttack, releaseVelocity: options?.rawRelease });
    else if (method === 'sendProgramChange') Object.assign(fields, { type: 'programChange', program: a, value: a });
    else if (method === 'sendControlChange') Object.assign(fields, { type: 'controlChange', cc: a, value: b });
    else if (method === 'sendPitchBend') Object.assign(fields, { type: 'pitchBend', value: a });
    else if (method === 'sendPitchBendRange') Object.assign(fields, { type: 'pitchBendRange', value: a, cents: b });
    else fields.type = method;
    const midiBytes = observing && !output?.supportsPerNoteInstrument ? submittedMidiBytes(method, channel, args) : null;
    const notify = event => {
      if (!observing) return;
      const receipt = Object.freeze({ output, ...fields, method, midiBytes: event.data ? Object.freeze([...event.data]) : null,
        submittedMs: this._nowMs(), accepted: event.accepted, encodingEvidence: event.encodingEvidence,
        ...(event.reason ? { reason: event.reason } : {}),
        ...(Number.isFinite(event.options?.time) ? { scheduledMs: event.options.time } : {}) });
      for (const listener of this._submissionObservers) {
        try { listener(receipt); } catch { /* An observer cannot alter output admission. */ }
      }
    };
    const byteObservation = observing && !output?.supportsPerNoteInstrument ? observeMidiByteSubmission(output,
      event => notify({ ...event, encodingEvidence: 'adapter-byte-boundary' })) : null;
    try {
      const result = invoke();
      if (capturing) this._observe('api-dispatch', { ...fields, accepted: result !== false,
        ...(result === false ? { reason: 'returned-false' } : {}) });
      if (!byteObservation?.observed) notify({ data: midiBytes, accepted: result !== false, encodingEvidence: 'adapter-method-contract' });
      return byteObservation?.rejected ? false : result;
    } catch (error) {
      if (error?.midiSubmissionRejected) {
        if (capturing) this._observe('api-dispatch', { ...fields, accepted: false, reason: 'returned-false' });
        return false;
      }
      if (capturing) this._observe('api-failed', { ...fields, accepted: false, reason: error?.message || String(error) });
      if (!byteObservation?.observed) notify({ data: midiBytes, accepted: false, reason: error?.message || String(error), encodingEvidence: 'adapter-method-contract' });
      throw error;
    } finally { byteObservation?.dispose(); }
  }
};
export { midiOutputObserverMethods };
