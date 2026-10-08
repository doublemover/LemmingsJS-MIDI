import { resolveScale } from '../midi-mapping/MidiMappingDomain.js';
let scopeSequence = 0;
const midiOutputObserverMethods = {
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
    if (!this._captureEnabled()) return send.apply(target, args);
    if (output?.supportsPerNoteInstrument && this.capture && (method === 'sendNoteOn' || method === 'sendNoteOff')) {
      args = [args[0], { ...args[1], capture: { ...meta, observedByScheduler: true } }];
    }
    const [a, b, c] = args;
    const options = method === 'sendControlChange' ? c : b;
    const fields = { ...meta, outputId: output?.id ?? null, outputScope: output?.captureScope ?? output?.id ?? null, channel,
      backend: output?.supportsPerNoteInstrument ? 'local-synth-api' : 'midi-output-api',
      scheduledMs: Number.isFinite(options?.time) ? options.time : this._nowMs() };
    if (method === 'sendNoteOn' || method === 'sendNoteOff') Object.assign(fields, {
      type: method === 'sendNoteOn' ? 'noteOn' : 'noteOff', note: a,
      velocity: options?.rawAttack, releaseVelocity: options?.rawRelease });
    else if (method === 'sendProgramChange') Object.assign(fields, { type: 'programChange', program: a, value: a });
    else if (method === 'sendControlChange') Object.assign(fields, { type: 'controlChange', cc: a, value: b });
    else if (method === 'sendPitchBend') Object.assign(fields, { type: 'pitchBend', value: a });
    else if (method === 'sendPitchBendRange') Object.assign(fields, { type: 'pitchBendRange', value: a, cents: b });
    else fields.type = method;
    try {
      const result = send.apply(target, args);
      this._observe('api-dispatch', { ...fields, accepted: result !== false,
        ...(result === false ? { reason: 'returned-false' } : {}) });
      return result;
    } catch (error) {
      this._observe('api-failed', { ...fields, accepted: false, reason: error?.message || String(error) });
      throw error;
    }
  }
};
export { midiOutputObserverMethods };
