import { resolveScale } from '../midi-mapping/MidiMappingDomain.js';
let scopeSequence = 0;
const midiByte = value => Math.min(127, Math.max(0, Math.round(Number(value) || 0)));
const submittedMidiBytes = (method, channel, args) => {
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) return null;
  const status = (channel - 1) & 15, [a, b] = args;
  if (method === 'sendNoteOn') return [0x90 | status, midiByte(a), midiByte(b?.rawAttack)];
  if (method === 'sendNoteOff') return [0x80 | status, midiByte(a), midiByte(b?.rawRelease)];
  if (method === 'sendControlChange') return [0xb0 | status, midiByte(a), midiByte(b)];
  if (method === 'sendProgramChange') return [0xc0 | status, midiByte(a)];
  if (method === 'sendPitchBend') {
    const bend = Math.min(16383, Math.max(0, Math.round(Math.max(-1, Math.min(1, Number(a) || 0)) * 8192 + 8192)));
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

  _observe(stage, fields) {
    if (!this._captureEnabled()) return null;
    try { return this.capture?.record(stage, { ...this._captureScaleFields(), ...fields, captureScope: this._captureScope }) ?? null; } catch { return null; }
  },

  _sendOutput(output, channel, method, args = [], meta = {}) {
    const target = channel == null ? output : output?.channels?.[channel];
    const send = target?.[method];
    if (typeof send !== 'function') return undefined;
    const capturing = this._captureEnabled();
    const observing = this._submissionObservers?.size > 0;
    if (!capturing && !observing) return send.apply(target, args);
    if (output?.supportsPerNoteInstrument && capturing && (method === 'sendNoteOn' || method === 'sendNoteOff')) {
      args = [args[0], { ...args[1], capture: { ...meta, observedByScheduler: true } }];
    }
    const [a, b, c] = args;
    const options = method === 'sendControlChange' ? c : b;
    const fields = { ...meta, outputId: output?.id ?? null, outputScope: output?.captureScope ?? output?.id ?? null, channel,
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
    try {
      const result = send.apply(target, args);
      if (capturing) this._observe('api-dispatch', { ...fields, accepted: result !== false,
        ...(result === false ? { reason: 'returned-false' } : {}) });
      if (observing) for (const listener of this._submissionObservers) {
        try { listener({ output, ...fields, method, args, midiBytes, submittedMs: this._nowMs(), accepted: result !== false }); } catch { /* An observer cannot alter output admission. */ }
      }
      return result;
    } catch (error) {
      if (capturing) this._observe('api-failed', { ...fields, accepted: false, reason: error?.message || String(error) });
      if (observing) for (const listener of this._submissionObservers) {
        try { listener({ output, ...fields, method, args, midiBytes, submittedMs: this._nowMs(), accepted: false, reason: error?.message || String(error) }); } catch { /* Preserve the original output failure. */ }
      }
      throw error;
    }
  }
};
export { midiOutputObserverMethods };
