import { selectLocalAudioVoice } from '../../midi/scheduler/LocalAudioVoiceBudget.js';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const ATTACK_SECONDS = 0.008;
const RELEASE_SECONDS = 0.04;
const MAX_SCHEDULED_VOICES = 64;
const MAX_CONTROL_EVENTS = 128;
const MAX_RENDER_VOICES = 64;
const MAX_RELEASE_TAILS = 32;
const MASTER_VOLUME_RAMP_SECONDS = 0.015;
const MAX_MASTER_VOLUME = 4;
// Unity correction for this profile's measured fixed Web Audio makeup gain, independent of voice count.
const MIX_MAKEUP_COMPENSATION = 0.647;
const MIX_LOOKAHEAD_SECONDS = 0.006;
let captureScopeSequence = 0;
const instrumentProfile = (program, percussion, note, enabled = true) => {
  if (!enabled) return { waveform: 'triangle', attack: ATTACK_SECONDS, decay: 0, sustain: 1, release: RELEASE_SECONDS, gain: 1 };
  if (percussion) {
    if (note === 36) return { waveform: 'sine', attack: 0.002, decay: 0.16, sustain: 0, release: 0.025, gain: 0.9, seconds: 0.22, frequency: 120, endFrequency: 45 };
    return { waveform: 'square', noise: true, attack: 0.001, decay: note === 42 ? 0.055 : 0.12,
      sustain: 0, release: 0.015, gain: note === 42 ? 0.3 : 0.6, seconds: note === 42 ? 0.09 : 0.18, frequency: note === 42 ? 2500 : 180 };
  }
  if (program === 38 || (program >= 32 && program <= 39)) return { waveform: 'sine', attack: 0.006, decay: 0.05, sustain: 0.82, release: 0.06, gain: 0.9 };
  if (program === 29 || (program >= 24 && program <= 31)) return { waveform: 'square', attack: 0.004, decay: 0.09, sustain: 0.4, release: 0.04, gain: 0.48 };
  if (program === 81 || (program >= 80 && program <= 87)) return { waveform: 'sawtooth', attack: 0.012, decay: 0.08, sustain: 0.65, release: 0.055, gain: 0.45 };
  return { waveform: 'triangle', attack: ATTACK_SECONDS, decay: 0, sustain: 1, release: RELEASE_SECONDS, gain: 1 };
};
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

const createMixCompressor = context => {
  if (typeof context.createDynamicsCompressor !== 'function') return null;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -9;
  compressor.knee.value = 6;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.001;
  compressor.release.value = 0.08;
  return compressor;
};

/** A local tone monitor. It owns its audio context and never opens a MIDI device. */
class BrowserNotePreview {
  constructor({ createAudioContext, nowMs, onStateChange, onPlayback, maxVoices = 32, maxNoteSeconds = 8, volume = 0.15, masterVolume = 0.7 } = {}) {
    const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
    this._createContext = createAudioContext === undefined
      ? (AudioContextType ? () => new AudioContextType({ sampleRate: 48000 }) : null)
      : createAudioContext;
    this._nowMs = nowMs || (() => globalThis.performance?.now?.() ?? Date.now());
    this._listeners = new Set();
    if (typeof onStateChange === 'function') this._listeners.add(onStateChange);
    this._maxVoices = clamp(Math.trunc(finite(maxVoices, 32)), 1, MAX_RENDER_VOICES);
    this._maxScheduledVoices = Math.max(MAX_SCHEDULED_VOICES, this._maxVoices + MAX_RELEASE_TAILS);
    this._voiceSteals = 0;
    this._voiceDrops = 0;
    this._maxNoteSeconds = clamp(finite(maxNoteSeconds, 8), 0.1, 16);
    this._volume = clamp(finite(volume, 0.15), 0, 0.15);
    this._masterVolume = clamp(finite(masterVolume, 0.7), 0, MAX_MASTER_VOLUME);
    this._context = null;
    this._master = null;
    this._limiter = null;
    this._compressor = null;
    this._compressorOutput = null;
    this._resumePromise = null;
    this._pendingEnables = new Set();
    this._disposePromise = null;
    this._generation = 0;
    this._enabled = false;
    this._disposed = false;
    this._status = this._createContext ? 'idle' : 'unsupported';
    this._message = this._createContext ? 'Browser preview is off.' : 'Browser audio is not supported.';
    this._voices = new Set();
    this._voicesByToken = new Map();
    this._previewPending = [];
    this._previewTimer = null;
    this._voiceSequence = 0;
    this._onPlayback = onPlayback;
    this.capture = null;
    this._captureScope = 'audio-' + (++captureScopeSequence);
    this._captureContext = null;
    this._captureAnalyser = null;
    this._captureSamples = null;
    this._channels = new Map();
    this._noiseBuffer = null;
    this._onContextState = () => {
      if (this._disposed || !this._enabled || this._context?.state === 'running') return;
      this.stop();
      this._setStatus('interrupted', 'Browser audio was interrupted. Enable preview again.');
    };
    const channels = {};
    for (let number = 1; number <= 16; number += 1) {
      channels[number] = Object.freeze({
        sendNoteOn: (note, options) => this._noteOn(number, note, options),
        sendProgramChange: (program, options) => this._safeSend(() => this._program(number, program, options)),
        sendNoteOff: (note, options) => this._noteOff(number, note, options),
        sendControlChange: (control, value, options) => this._safeSend(() => this._control(number, control, value, options)),
        sendPitchBend: (value, options) => this._safeSend(() => this._pitchBend(number, value, options)),
        sendPitchBendRange: (semitones, cents) => this._safeSend(() => this._pitchBendRange(number, semitones, cents)),
        sendAllNotesOff: () => this._clearVoices(number)
      });
    }
    this.output = Object.freeze({
      id: 'browser-note-preview',
      captureScope: this._captureScope,
      name: 'Browser audio preview',
      supportsPerNotePan: true,
      supportsPerNoteInstrument: true,
      supportsIndependentNoteGates: true,
      isVoiceActive: token => this._isVoiceActive(token),
      canAllocateVoice: () => this._voices.size < this._maxScheduledVoices || [...this._voices].some(voice => this._voiceFinished(voice)),
      supportsPlaybackMetadata: true,
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
      maxVoices: this._maxVoices, maxScheduledVoices: this._maxScheduledVoices,
      voiceSteals: this._voiceSteals, voiceDrops: this._voiceDrops,
      mixCompression: !!this._compressor, mixLatencyMs: this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0, mixMakeupCompensation: this._compressor ? MIX_MAKEUP_COMPENSATION : 1, mixReductionDb: finite(this._compressor?.reduction, 0),
      pendingNotes: this._previewPending.length,
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
        let compressor;
        let compressorOutput;
        try {
          context = this._createContext();
          master = context.createGain();
          master.gain.value = this._volume * this._masterVolume;
          limiter = createOutputCeiling(context);
          compressor = createMixCompressor(context);
          master.connect(compressor || limiter);
          if (compressor) {
            compressorOutput = context.createGain();
            compressorOutput.gain.value = MIX_MAKEUP_COMPENSATION;
            compressor.connect(compressorOutput);
            compressorOutput.connect(limiter);
          }
          context.addEventListener?.('statechange', this._onContextState);
          this._context = context;
          this._master = master;
          this._limiter = limiter;
          this._compressor = compressor;
          this._compressorOutput = compressorOutput;
        } catch (error) {
          master?.disconnect();
          limiter?.disconnect();
          compressor?.disconnect();
          compressorOutput?.disconnect();
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
      this._setMixEnabled(true);
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

  _setMixEnabled(enabled) {
    if (!this._compressorOutput || !this._context) return;
    const now = this._context.currentTime, gain = this._compressorOutput.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);
    // Suppress the old lookahead buffer on stop/re-enable, using the existing audio clock.
    if (enabled) gain.setValueAtTime(MIX_MAKEUP_COMPENSATION, now + MIX_LOOKAHEAD_SECONDS);
  }

  stop() {
    this._generation += 1;
    this._enabled = false;
    this._setMixEnabled(false);
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
    this._noiseBuffer = null;
    this._master?.disconnect();
    this._limiter?.disconnect();
    this._compressor?.disconnect();
    this._compressorOutput?.disconnect();
    this._captureAnalyser?.disconnect();
    this._captureAnalyser = null;
    this._captureSamples = null;
    this._limiter = null;
    this._compressor = null;
    this._compressorOutput = null;
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

  inspectRender() {
    if (!this._ready() || !this._context?.createAnalyser || !this._limiter) return null;
    try {
      if (!this._captureAnalyser) {
        this._captureAnalyser = this._context.createAnalyser();
        this._captureAnalyser.fftSize = 2048;
        this._captureSamples = new Float32Array(2048);
        // A nonaudible measurement tap; the existing destination connection remains unchanged.
        this._limiter.connect(this._captureAnalyser);
      }
      this._captureAnalyser.getFloatTimeDomainData(this._captureSamples);
      let sum = 0, peak = 0;
      for (const value of this._captureSamples) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
      const sample = { type: 'waveform', rms: Math.sqrt(sum / this._captureSamples.length), peak,
        localMasterGain: this._masterVolume, mixLatencyMs: this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0, mixMakeupCompensation: this._compressor ? MIX_MAKEUP_COMPENSATION : 1, mixReductionDb: finite(this._compressor?.reduction, 0), audioTime: this._context.currentTime, sampleRate: this._context.sampleRate, frames: this._captureSamples.length,
        reason: 'demand-inspection', acousticReceipt: false };
      this._observe('synth-render-sample', sample);
      return sample;
    } catch { return null; }
  }

  setCapture(capture = null, context = undefined) {
    this.capture = typeof capture?.record === 'function' ? capture : null;
    if (context !== undefined) this._captureContext = context;
  }

  _captureEnabled() {
    try { return !!this.capture && (typeof this.capture.isActive !== 'function' || this.capture.isActive()); } catch { return false; }
  }

  _captureContextFields() {
    if (!this._captureEnabled()) return null;
    try {
      const context = typeof this._captureContext === 'function' ? this._captureContext() : this._captureContext;
      return context ? { ...context, ...(Array.isArray(context.scaleDegrees) ? { scaleDegrees: context.scaleDegrees.slice(0, 32) } : {}) } : null;
    } catch { return null; }
  }

  _observe(stage, fields) {
    if (!this._captureEnabled()) return null;
    try {
      const context = this._captureContextFields();
      return this.capture?.record(stage, { captureScope: this._captureScope, ...context, ...fields, backend: 'local-synth', outputId: this.output.id, outputScope: this._captureScope }) ?? null; } catch { return null; }
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
    const baseTime = this._nowMs(), captureContext = this._captureContextFields();
    for (const spec of specs) {
      if (!this._validNote(spec.note)) continue;
      const offset = finite(spec.offsetMs, 0);
      if (offset < 0 || !Number.isFinite(baseTime + offset)) continue;
      const requestId = this._observe('request', { ...spec.playback, type: 'audition', note: spec.note,
        channel: spec.channel ?? 1, program: spec.program, intendedMs: baseTime + offset, eventType: 'audition' });
      this._previewPending.push({ spec: { ...spec, capture: { ...captureContext, ...spec.playback, requestId, captureScope: this._captureScope, eventType: 'audition',
        note: spec.note, channel: spec.channel ?? 1, program: spec.program, ensembleRole: spec.ensembleRole,
        percussion: spec.percussion, intendedMs: baseTime + offset } }, time: baseTime + offset, durationMs });
    }
    this._previewPending.sort((a, b) => a.time - b.time);
    if (this._previewPending.length > MAX_SCHEDULED_VOICES) this._previewPending.splice(0, this._previewPending.length - MAX_SCHEDULED_VOICES);
    const played = this._drainPreviewQueue(generation);
    return played || this._previewPending.length > 0;
  }

  _drainPreviewQueue(generation = this._generation) {
    if (this._previewTimer != null) clearTimeout(this._previewTimer);
    this._previewTimer = null;
    if (generation !== this._generation || !this._ready()) return false;
    const now = this._nowMs(), horizon = this._maxNoteSeconds * 500;
    let played = false;
    while (this._previewPending.length && this._previewPending[0].time <= now + horizon) {
      const { spec, time, durationMs } = this._previewPending.shift();
      const channel = this.output.channels[clamp(Math.trunc(finite(spec.channel, 1)), 1, 16)];
      const length = clamp(finite(spec.durationMs, durationMs), 30, this._maxNoteSeconds * 1000);
      if (time + length <= now) { this._observe('drop', { ...spec.capture, type: 'noteOn', reason: 'expired-audition' }); continue; }
      if (Number.isFinite(spec.pitchBend)) channel.sendPitchBend(spec.pitchBend, { time });
      if (channel.sendNoteOn(spec.note, { rawAttack: finite(spec.velocity, 80), time, capture: spec.capture, playback: spec.playback, instrument: { program: spec.program, percussion: spec.percussion, role: spec.ensembleRole, legacy: !spec.ensembleRole && spec.percussion !== true },
        ...(Number.isFinite(spec.pan) ? { pan: clamp(spec.pan / 127, -1, 1) } : {}) })) {
        channel.sendNoteOff(spec.note, { time: time + length, capture: spec.capture });
        played = true;
      }
    }
    if (this._previewPending.length) {
      const delay = Math.max(1, Math.min(0x7fffffff, this._previewPending[0].time - now - horizon));
      this._previewTimer = setTimeout(() => this._drainPreviewQueue(generation), delay);
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
    channel = { gain, pan, bendRange: 2, bends: [], volume: 1, expression: 1, program: null };
    this._channels.set(number, channel);
    return channel;
  }

  _program(number, value) {
    if (!this._ready() || !Number.isInteger(value) || value < 0 || value > 127) return false;
    this._channel(number).program = value;
    return true;
  }

  _percussionNoise() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const context = this._context;
    if (!context.createBuffer || !context.createBufferSource) return null;
    const length = Math.ceil((context.sampleRate || 48000) * 0.2);
    const buffer = context.createBuffer(1, length, context.sampleRate || 48000);
    const samples = buffer.getChannelData(0);
    let seed = 0x45b9;
    for (let index = 0; index < length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[index] = seed / 2147483648 - 1;
    }
    this._noiseBuffer = buffer;
    return buffer;
  }

  _voiceFinished(voice) {
    const now = this._context?.currentTime ?? 0;
    return voice.end <= now || (voice.released && voice.releaseLevel === 0 && voice.releaseAt <= now) || (voice.sustain === 0 && now >= voice.start + voice.attack + voice.decay);
  }

  _isVoiceActive(token) {
    const voice = this._voicesByToken.get(token), now = this._context?.currentTime ?? 0;
    return !!voice && !voice.stolen && voice.releaseAt > now &&
      (voice.sustain > 0 || now < voice.start + voice.attack + voice.decay);
  }

  _noteOn(number, note, options = {}) {
    if (!this._ready() || !this._validNote(note)) return false;
    if (options?.rawAttack === 0) return this._noteOff(number, note, options);
    const context = this._context;
    const start = this._audioTime(options);
    if (start - context.currentTime > this._maxNoteSeconds) return false;
    for (const voice of this._voices) {
      if (this._voiceFinished(voice)) this._destroyVoice(voice, 'inaudible-voice-reuse');
    }
    const incoming = { priority: finite(options.priority, 1), laneIndex: options.laneIndex ?? options.playback?.laneIndex ?? 0 };
    const drop = reason => {
      this._voiceDrops += 1;
      this._observe('drop', { ...options.capture, type: 'noteOn', note, channel: number, ...incoming, reason });
      return false;
    };
    if (this._voices.size >= this._maxScheduledVoices) return drop('scheduled-voice-cap');
    const simultaneous = [...this._voices].filter(voice => !voice.stolen && voice.start <= start && voice.releaseAt > start);
    if (simultaneous.length >= this._maxVoices) {
      const victim = selectLocalAudioVoice(simultaneous, incoming);
      if (!victim) return drop('local-voice-priority');
      this._voiceSteals += 1;
      this._release(victim, Math.max(context.currentTime, start - RELEASE_SECONDS), true);
    }
    let voice;
    let oscillator;
    let gain;
    try {
      const channel = this._channel(number);
      const profile = instrumentProfile(options.instrument?.program ?? channel.program, options.instrument?.percussion === true || number === 10, note, options.instrument?.legacy !== true);
      const noise = profile.noise && this._percussionNoise();
      oscillator = noise ? context.createBufferSource() : context.createOscillator();
      if (noise) { oscillator.buffer = noise; oscillator.loop = true; }
      gain = context.createGain();
      voice = { oscillator, gain, number, note, start, id: ++this._voiceSequence, playback: options.playback, startMs: this._nowMs() + (start - context.currentTime) * 1000, end: start + Math.min(this._maxNoteSeconds, profile.seconds || this._maxNoteSeconds), released: false, captureMeta: options.capture || null,
        ...incoming, startedAt: start,
        token: Number.isInteger(options.voiceToken) && options.voiceToken > 0 ? options.voiceToken : null,
        peak: clamp(finite(options?.rawAttack, 80), 1, 127) / 127 * profile.gain, attack: profile.attack, decay: profile.decay,
        sustain: profile.sustain, release: profile.release, instrument: options.instrument, velocity: clamp(finite(options?.rawAttack, 80), 1, 127) };
      voice.releaseAt = voice.end - voice.release;
      this._voices.add(voice);
      if (voice.token != null) this._voicesByToken.set(voice.token, voice);
      if (!noise) {
        oscillator.type = profile.waveform;
        oscillator.frequency.setValueAtTime(profile.frequency || 440 * (2 ** ((note - 69) / 12)), start);
        if (profile.endFrequency) oscillator.frequency.linearRampToValueAtTime(profile.endFrequency, start + profile.decay);
      }
      this._pruneBends(channel);
      let initialBend = 0;
      for (const bend of channel.bends) if (bend.time <= start) initialBend = bend.value;
      oscillator.detune.setValueAtTime(initialBend * channel.bendRange * 100, start);
      for (const bend of channel.bends) {
        if (bend.time > start) oscillator.detune.setValueAtTime(bend.value * channel.bendRange * 100, bend.time);
      }
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(voice.peak, start + voice.attack);
      const sustainAt = Math.min(voice.end - voice.release, start + voice.attack + voice.decay);
      if (voice.decay > 0) gain.gain.linearRampToValueAtTime(voice.peak * voice.sustain, sustainAt);
      gain.gain.setValueAtTime(voice.peak * voice.sustain, voice.end - voice.release);
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
      this._observe('synth-scheduled', { ...voice.captureMeta, type: 'noteOn', voiceId: voice.id, channel: number,
        note, velocity: voice.velocity, program: options.instrument?.program, ensembleRole: options.instrument?.role,
        percussion: options.instrument?.percussion, scheduledMs: voice.startMs, audioTime: start,
        endAudioTime: voice.end, mixLatencyMs: this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0, durationMs: (voice.end - start) * 1000, waveform: noise ? 'noise' : oscillator.type });
      if (this._captureEnabled() && !options.capture?.observedByScheduler) this._observe('api-dispatch', { ...voice.captureMeta, type: 'noteOn',
        voiceId: voice.id, channel: number, note, velocity: voice.velocity, scheduledMs: voice.startMs, accepted: true });
      this._emitPlayback(voice, 'start');
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

  _release(voice, time, force = false, reason = 'note-off') {
    if (!this._voices.has(voice) || (!force && voice.released && time >= voice.releaseAt)) return;
    const releaseAt = Math.max(voice.start, Math.min(time, voice.end - voice.release));
    const end = Math.min(voice.end, releaseAt + voice.release);
    const param = voice.gain.gain;
    param.cancelScheduledValues(releaseAt);
    const elapsed = releaseAt - voice.start;
    const level = elapsed < voice.attack ? clamp(elapsed / voice.attack, 0, 1)
      : voice.decay > 0 && elapsed < voice.attack + voice.decay
        ? 1 - (1 - voice.sustain) * (elapsed - voice.attack) / voice.decay : voice.sustain;
    const attackLevel = voice.peak * level;
    voice.releaseLevel = attackLevel;
    param.setValueAtTime(attackLevel, releaseAt);
    param.linearRampToValueAtTime(0, end);
    voice.oscillator.stop(end);
    voice.end = end;
    voice.releaseAt = releaseAt;
    voice.released = true;
    if (force) voice.stolen = true;
    this._observe('synth-release', { ...voice.captureMeta, type: 'noteOff', voiceId: voice.id, channel: voice.number,
      note: voice.note, scheduledMs: voice.startMs + (releaseAt - voice.start) * 1000, audioTime: releaseAt,
      endAudioTime: end, reason: force ? 'voice-budget' : reason });
    this._emitPlayback(voice, 'release', releaseAt);
    if (force && attackLevel === 0) this._destroyVoice(voice, 'inaudible-voice-reuse');
  }

  _noteOff(number, note, options = {}) {
    if (!this._ready() || !this._validNote(note)) return false;
    const time = this._audioTime(options);
    const candidates = [...this._voices].filter(voice => voice.number === number && voice.note === note && (!voice.released || (options.voiceToken != null && time < voice.releaseAt)) && voice.start <= time + 0.001 &&
      (options.voiceToken == null || voice.token === options.voiceToken));
    // A scheduled release belongs to one note-on, including repeated same-pitch phrases.
    if (Number.isFinite(options?.time) || options.voiceToken != null) {
      if (candidates.length) {
        if (options.reason === 'local-voice-budget') this._voiceSteals += 1;
        this._release(candidates[0], time, false, options.reason);
      }
    } else {
      for (const voice of this._voices) {
        if (voice.number === number && voice.note === note) this._destroyVoice(voice, 'immediate-note-off');
      }
    }
    if (this._captureEnabled() && !options.capture?.observedByScheduler && candidates.length) this._observe('api-dispatch', {
      ...(options.capture || candidates[0].captureMeta), type: 'noteOff', voiceId: candidates[0].id, channel: number,
      note, scheduledMs: finite(options.time, this._nowMs()), accepted: true });
    return candidates.length > 0;
  }

  _destroyVoice(voice, reason = 'source-ended') {
    if (!voice || !this._voices.delete(voice)) return;
    if (voice.token != null && this._voicesByToken.get(voice.token) === voice) this._voicesByToken.delete(voice.token);
    this._observe('synth-end', { ...voice.captureMeta, type: 'noteEnd', voiceId: voice.id, channel: voice.number,
      note: voice.note, audioTime: this._context?.currentTime, scheduledMs: voice.startMs + (voice.end - voice.start) * 1000,
      matchedDurationMs: Math.max(0, ((this._context?.currentTime ?? voice.start) - voice.start) * 1000), reason });
    this._emitPlayback(voice, 'end');
    voice.oscillator.onended = null;
    try { voice.oscillator.stop(); } catch { /* Already ended or failed to start. */ }
    voice.oscillator.disconnect();
    voice.gain.disconnect();
    voice.pan?.disconnect();
    this._setStatus(this._status, this._message);
  }

  _emitPlayback(voice, phase, releaseAt = voice.end - voice.release) {
    if (!voice.playback || typeof this._onPlayback !== 'function') return;
    try {
      this._onPlayback({ ...voice.playback, id: voice.id, phase, note: voice.note, velocity: Math.round(voice.velocity),
        startMs: voice.startMs, releaseMs: voice.startMs + (releaseAt - voice.start) * 1000,
        endMs: voice.startMs + (voice.end - voice.start) * 1000,
        attackMs: voice.attack * 1000, decayMs: voice.decay * 1000, sustain: voice.sustain });
    } catch { /* Display observers must never interrupt audio. */ }
  }

  _clearVoices(number = null) {
    if (this._previewTimer != null) clearTimeout(this._previewTimer);
    this._previewTimer = null;
    for (const entry of this._previewPending) {
      if (number == null || clamp(Math.trunc(finite(entry.spec.channel, 1)), 1, 16) === number) {
        this._observe('cancelled', { ...entry.spec.capture, type: 'noteOn', reason: 'audition-stop' });
      }
    }
    this._previewPending = number == null ? [] : this._previewPending.filter(entry => clamp(Math.trunc(finite(entry.spec.channel, 1)), 1, 16) !== number);
    if (this._previewPending.length && this._ready()) this._drainPreviewQueue();
    for (const voice of this._voices) {
      if (number == null || voice.number === number) this._destroyVoice(voice, 'panic-or-stop');
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
