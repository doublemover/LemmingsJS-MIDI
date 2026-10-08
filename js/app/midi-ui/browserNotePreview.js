const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const ATTACK_SECONDS = 0.008;
const RELEASE_SECONDS = 0.04;
const MAX_SCHEDULED_VOICES = 64;
const MAX_CONTROL_EVENTS = 128;
const MASTER_VOLUME_RAMP_SECONDS = 0.015;
const MAX_MASTER_VOLUME = 4;
const createOutputCeiling = context => {
  const limiter = context.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let index = 0; index < curve.length; index += 1) {
    const sample = index * 2 / (curve.length - 1) - 1;
    const magnitude = Math.abs(sample);
    curve[index] = magnitude <= 0.7 ? sample : Math.sign(sample) * (0.7 + 0.2 * (1 - Math.exp(-(magnitude - 0.7) / 0.2)));
  }
  limiter.curve = curve;
  limiter.connect(context.destination);
  return limiter;
};

/** A local tone monitor. It owns its audio context and never opens a MIDI device. */
class BrowserNotePreview {
  constructor({ createAudioContext, nowMs, onStateChange, maxVoices = 16, maxNoteSeconds = 8, volume = 0.15, masterVolume = 0.7 } = {}) {
    const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
    this._createContext = createAudioContext === undefined
      ? (AudioContextType ? () => new AudioContextType({ sampleRate: 48000 }) : null)
      : createAudioContext;
    this._nowMs = nowMs || (() => globalThis.performance?.now?.() ?? Date.now());
    this._listeners = new Set();
    if (typeof onStateChange === 'function') this._listeners.add(onStateChange);
    this._maxVoices = clamp(Math.trunc(finite(maxVoices, 16)), 1, 32);
    this._maxNoteSeconds = clamp(finite(maxNoteSeconds, 8), 0.1, 16);
    this._volume = clamp(finite(volume, 0.15), 0, 0.15) / Math.sqrt(this._maxVoices);
    this._masterVolume = clamp(finite(masterVolume, 0.7), 0, MAX_MASTER_VOLUME);
    this._context = null;
    this._master = null;
    this._limiter = null;
    this._resumePromise = null;
    this._pendingEnables = new Set();
    this._disposePromise = null;
    this._generation = 0;
    this._enabled = false;
    this._disposed = false;
    this._status = this._createContext ? 'idle' : 'unsupported';
    this._message = this._createContext ? 'Browser preview is off.' : 'Browser audio is not supported.';
    this._voices = new Set();
    this._channels = new Map();
    this._onContextState = () => {
      if (this._disposed || !this._enabled || this._context?.state === 'running') return;
      this.stop();
      this._setStatus('interrupted', 'Browser audio was interrupted. Enable preview again.');
    };
    const channels = {};
    for (let number = 1; number <= 16; number += 1) {
      channels[number] = Object.freeze({
        sendNoteOn: (note, options) => this._noteOn(number, note, options),
        sendNoteOff: (note, options) => this._noteOff(number, note, options),
        sendControlChange: (control, value, options) => this._safeSend(() => this._control(number, control, value, options)),
        sendPitchBend: (value, options) => this._safeSend(() => this._pitchBend(number, value, options)),
        sendPitchBendRange: (semitones, cents) => this._safeSend(() => this._pitchBendRange(number, semitones, cents)),
        sendAllNotesOff: () => this._clearVoices(number)
      });
    }
    this.output = Object.freeze({
      id: 'browser-note-preview',
      name: 'Browser audio preview',
      supportsPerNotePan: true,
      channels: Object.freeze(channels),
      clear: () => this._clearVoices()
    });
  }

  getState() {
    return {
      status: this._status,
      message: this._message,
      enabled: this._enabled && this._context?.state === 'running',
      activeVoices: this._voices.size,
      masterVolume: this._masterVolume
    };
  }

  setMasterVolume(value) {
    if (this._disposed) return this._masterVolume;
    const next = clamp(finite(value, this._masterVolume), 0, MAX_MASTER_VOLUME);
    if (next === this._masterVolume) return next;
    this._masterVolume = next;
    if (this._master && this._context) {
      const gain = this._master.gain;
      const now = this._context.currentTime;
      const target = this._volume * next;
      if (!this._ready()) {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(target, now);
      } else if (typeof gain.cancelAndHoldAtTime === 'function') {
        gain.cancelAndHoldAtTime(now);
        gain.linearRampToValueAtTime(target, now + MASTER_VOLUME_RAMP_SECONDS);
      } else {
        const current = gain.value;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(current, now);
        gain.linearRampToValueAtTime(target, now + MASTER_VOLUME_RAMP_SECONDS);
      }
    }
    this._setStatus(this._status, this._message);
    return next;
  }

  subscribe(listener) {
    if (typeof listener !== 'function' || this._disposed) return () => {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _setStatus(status, message) {
    this._status = status;
    this._message = message;
    for (const listener of this._listeners) {
      try { listener(this.getState()); } catch { /* UI callbacks must not break audio cleanup. */ }
    }
  }

  async enable() {
    if (this._disposed) return false;
    if (!this._createContext) {
      this._setStatus('unsupported', 'Browser audio is not supported.');
      return false;
    }
    const generation = this._generation;
    let cancelEnable = null;
    try {
      // Creation and resume happen before the first await, inside the caller's gesture.
      if (!this._context) {
        let context;
        let master;
        let limiter;
        try {
          context = this._createContext();
          master = context.createGain();
          master.gain.value = this._volume * this._masterVolume;
          limiter = createOutputCeiling(context);
          master.connect(limiter);
          context.addEventListener?.('statechange', this._onContextState);
          this._context = context;
          this._master = master;
          this._limiter = limiter;
        } catch (error) {
          master?.disconnect();
          limiter?.disconnect();
          try { Promise.resolve(context?.close?.()).catch(() => {}); } catch { /* Failed audio initialization. */ }
          throw error;
        }
      }
      const context = this._context;
      if (context.state !== 'running') {
        this._setStatus('unlocking', 'Starting browser audio…');
        if (!this._resumePromise) {
          const resumed = Promise.resolve(context.resume());
          this._resumePromise = resumed;
          const clear = () => { if (this._resumePromise === resumed) this._resumePromise = null; };
          resumed.then(clear, clear);
        }
        const cancelled = new Promise(resolve => { cancelEnable = () => resolve(false); });
        this._pendingEnables.add(cancelEnable);
        const resumed = await Promise.race([this._resumePromise.then(() => true), cancelled]);
        this._pendingEnables.delete(cancelEnable);
        cancelEnable = null;
        if (!resumed) return false;
      }
      if (this._disposed || generation !== this._generation) return false;
      if (context.state !== 'running') throw new Error('Audio context is not running.');
      this._enabled = true;
      this._setStatus('ready', 'Browser preview is on. No MIDI is sent.');
      return true;
    } catch {
      if (this._disposed || generation !== this._generation) return false;
      this._enabled = false;
      this._clearVoices();
      this._setStatus('error', 'Browser audio could not start. Try enabling preview again.');
      return false;
    } finally {
      if (cancelEnable) this._pendingEnables.delete(cancelEnable);
    }
  }

  stop() {
    this._generation += 1;
    this._enabled = false;
    for (const cancel of this._pendingEnables) cancel();
    this._pendingEnables.clear();
    this._resumePromise = null;
    this._clearVoices();
    if (!this._disposed) this._setStatus(this._createContext ? 'idle' : 'unsupported',
      this._createContext ? 'Browser preview is off.' : 'Browser audio is not supported.');
  }

  panic() { this.stop(); }

  dispose() {
    if (this._disposePromise) return this._disposePromise;
    this._disposed = true;
    this.stop();
    const context = this._context;
    context?.removeEventListener?.('statechange', this._onContextState);
    for (const channel of this._channels.values()) {
      channel.gain.disconnect();
      channel.pan?.disconnect();
    }
    this._channels.clear();
    this._master?.disconnect();
    this._limiter?.disconnect();
    this._limiter = null;
    this._master = null;
    this._context = null;
    this._setStatus('disposed', 'Browser preview is closed.');
    this._listeners.clear();
    try {
      this._disposePromise = Promise.resolve(context?.close?.()).catch(() => {});
    } catch {
      this._disposePromise = Promise.resolve();
    }
    return this._disposePromise;
  }

  /** Notes use {note, velocity, durationMs, offsetMs, channel}; numbers are also accepted. */
  async preview(notes, { replace = true, durationMs = 220, stepMs = 160 } = {}) {
    if (this._disposed) return false;
    if (replace) this.stop();
    const generation = this._generation;
    const specs = (Array.isArray(notes) ? notes : [notes]).slice(0, MAX_SCHEDULED_VOICES)
      .map((entry, index) => typeof entry === 'number'
        ? { note: entry, offsetMs: index * finite(stepMs, 160) }
        : { ...entry });
    if (!specs.some(spec => this._validNote(spec.note))) return false;
    if (!await this.enable() || generation !== this._generation) return false;
    const baseTime = this._nowMs();
    let played = false;
    for (const spec of specs) {
      if (!this._validNote(spec.note)) continue;
      const channel = this.output.channels[clamp(Math.trunc(finite(spec.channel, 1)), 1, 16)];
      const offset = finite(spec.offsetMs, 0);
      if (offset < 0 || offset > this._maxNoteSeconds * 1000) continue;
      const time = baseTime + offset;
      const length = clamp(finite(spec.durationMs, durationMs), 30, this._maxNoteSeconds * 1000);
      if (Number.isFinite(spec.pitchBend)) channel.sendPitchBend(spec.pitchBend, { time });
      if (channel.sendNoteOn(spec.note, { rawAttack: finite(spec.velocity, 80), time,
        ...(Number.isFinite(spec.pan) ? { pan: clamp(spec.pan / 127, -1, 1) } : {}) })) {
        channel.sendNoteOff(spec.note, { time: time + length });
        played = true;
      }
    }
    return played;
  }

  _validNote(note) { return Number.isInteger(note) && note >= 0 && note <= 127; }

  _audioTime(options = {}) {
    const current = this._context.currentTime;
    const now = this._nowMs();
    const ahead = (finite(options?.time, now) - now) / 1000;
    return current + Math.max(0, ahead);
  }

  _ready() { return !this._disposed && this._enabled && this._context?.state === 'running'; }

  _channel(number) {
    let channel = this._channels.get(number);
    if (channel) return channel;
    const gain = this._context.createGain();
    let pan;
    try {
      pan = this._context.createStereoPanner?.() || null;
      gain.connect(pan || this._master);
      pan?.connect(this._master);
    } catch (error) {
      gain.disconnect();
      pan?.disconnect();
      throw error;
    }
    channel = { gain, pan, bendRange: 2, bends: [], volume: 1, expression: 1 };
    this._channels.set(number, channel);
    return channel;
  }

  _noteOn(number, note, options = {}) {
    if (!this._ready() || !this._validNote(note)) return false;
    if (options?.rawAttack === 0) return this._noteOff(number, note, options);
    const context = this._context;
    const start = this._audioTime(options);
    if (start - context.currentTime > this._maxNoteSeconds) return false;
    const simultaneous = [...this._voices].filter(voice => !voice.stolen && voice.start <= start && voice.end > start);
    if (simultaneous.length >= this._maxVoices) {
      const oldest = simultaneous[0];
      if (start - context.currentTime <= RELEASE_SECONDS || start - oldest.start <= RELEASE_SECONDS) {
        this._destroyVoice(oldest);
      } else {
        this._release(oldest, start - RELEASE_SECONDS, true);
      }
    }
    while (this._voices.size >= MAX_SCHEDULED_VOICES) this._destroyVoice(this._voices.values().next().value);
    let voice;
    let oscillator;
    let gain;
    try {
      const channel = this._channel(number);
      oscillator = context.createOscillator();
      gain = context.createGain();
      voice = { oscillator, gain, number, note, start, end: start + this._maxNoteSeconds, released: false, peak: clamp(finite(options?.rawAttack, 80), 1, 127) / 127 };
      this._voices.add(voice);
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(440 * (2 ** ((note - 69) / 12)), start);
      this._pruneBends(channel);
      let initialBend = 0;
      for (const bend of channel.bends) if (bend.time <= start) initialBend = bend.value;
      oscillator.detune.setValueAtTime(initialBend * channel.bendRange * 100, start);
      for (const bend of channel.bends) {
        if (bend.time > start) oscillator.detune.setValueAtTime(bend.value * channel.bendRange * 100, bend.time);
      }
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(voice.peak, start + ATTACK_SECONDS);
      gain.gain.setValueAtTime(voice.peak, voice.end - RELEASE_SECONDS);
      gain.gain.linearRampToValueAtTime(0, voice.end);
      oscillator.connect(gain);
      if (Number.isFinite(options.pan) && context.createStereoPanner) {
        voice.pan = context.createStereoPanner();
        voice.pan.pan.setValueAtTime(clamp(options.pan, -1, 1), start);
        gain.connect(voice.pan);
        voice.pan.connect(channel.gain);
      } else {
        gain.connect(channel.gain);
      }
      oscillator.onended = () => this._destroyVoice(voice);
      oscillator.start(start);
      oscillator.stop(voice.end);
      this._setStatus(this._status, this._message);
      return true;
    } catch {
      if (voice) this._destroyVoice(voice);
      else {
        try { oscillator?.stop(); } catch { /* A partially constructed oscillator never started. */ }
        oscillator?.disconnect();
        gain?.disconnect();
      }
      this._setStatus('error', 'Browser audio could not play this note.');
      return false;
    }
  }

  _release(voice, time, force = false) {
    if (!this._voices.has(voice) || (!force && voice.released)) return;
    const releaseAt = Math.max(voice.start, Math.min(time, voice.end - RELEASE_SECONDS));
    const end = Math.min(voice.end, releaseAt + RELEASE_SECONDS);
    const param = voice.gain.gain;
    param.cancelScheduledValues(releaseAt);
    const attackLevel = voice.peak * clamp((releaseAt - voice.start) / ATTACK_SECONDS, 0, 1);
    param.setValueAtTime(attackLevel, releaseAt);
    param.linearRampToValueAtTime(0, end);
    voice.oscillator.stop(end);
    voice.end = end;
    voice.released = true;
    if (force) voice.stolen = true;
  }

  _noteOff(number, note, options = {}) {
    if (!this._ready() || !this._validNote(note)) return false;
    const time = this._audioTime(options);
    const candidates = [...this._voices].filter(voice => voice.number === number && voice.note === note && !voice.released && voice.start <= time + 0.001);
    // A scheduled release belongs to one note-on, including repeated same-pitch phrases.
    if (Number.isFinite(options?.time)) {
      if (candidates.length) this._release(candidates[0], time);
    } else {
      for (const voice of this._voices) {
        if (voice.number === number && voice.note === note) this._destroyVoice(voice);
      }
    }
    return candidates.length > 0;
  }

  _destroyVoice(voice) {
    if (!voice || !this._voices.delete(voice)) return;
    voice.oscillator.onended = null;
    try { voice.oscillator.stop(); } catch { /* Already ended or failed to start. */ }
    voice.oscillator.disconnect();
    voice.gain.disconnect();
    voice.pan?.disconnect();
    this._setStatus(this._status, this._message);
  }

  _clearVoices(number = null) {
    for (const voice of this._voices) {
      if (number == null || voice.number === number) this._destroyVoice(voice);
    }
    for (const [key, channel] of this._channels) {
      if (number != null && key !== number) continue;
      channel.bends.length = 0;
      channel.gain.gain.cancelScheduledValues(0);
      channel.gain.gain.value = 1;
      channel.volume = 1;
      channel.expression = 1;
      if (channel.pan) {
        channel.pan.pan.cancelScheduledValues(0);
        channel.pan.pan.value = 0;
      }
    }
  }

  _control(number, control, value, options = {}) {
    if (!this._ready() || !Number.isFinite(control) || !Number.isFinite(value)) return false;
    if (control === 120 || control === 123) { this._clearVoices(number); return true; }
    const channel = this._channel(number);
    const time = this._audioTime(options);
    const normalized = clamp(value, 0, 127) / 127;
    if (control === 10) channel.pan?.pan.setValueAtTime(normalized * 2 - 1, time);
    if (control === 7 || control === 11) {
      channel[control === 7 ? 'volume' : 'expression'] = normalized;
      channel.gain.gain.setValueAtTime(channel.volume * channel.expression, time);
    }
    // Sustain and synth-specific CCs are intentionally ignored by this short-tone monitor.
    return true;
  }

  _safeSend(action) {
    try { return action(); } catch {
      this._setStatus('error', 'Browser audio could not play this control.');
      return false;
    }
  }

  _pruneBends(channel) {
    const now = this._context.currentTime;
    while (channel.bends.length > 1 && channel.bends[1].time <= now) channel.bends.shift();
    while (channel.bends.length > MAX_CONTROL_EVENTS) channel.bends.shift();
  }

  _pitchBend(number, value, options = {}) {
    if (!this._ready() || !Number.isFinite(value)) return false;
    const channel = this._channel(number);
    const time = this._audioTime(options);
    const bend = clamp(value, -1, 1);
    channel.bends.push({ time, value: bend });
    channel.bends.sort((a, b) => a.time - b.time);
    this._pruneBends(channel);
    for (const voice of this._voices) {
      if (voice.number === number && time >= voice.start && time < voice.end) {
        voice.oscillator.detune.setValueAtTime(bend * channel.bendRange * 100, time);
      }
    }
    return true;
  }

  _pitchBendRange(number, semitones, cents = 0) {
    if (!this._ready() || !Number.isFinite(semitones)) return false;
    this._channel(number).bendRange = clamp(semitones + finite(cents, 0) / 100, 0, 48);
    return true;
  }
}

const createBrowserNotePreview = options => new BrowserNotePreview(options);

export { BrowserNotePreview, createBrowserNotePreview };
