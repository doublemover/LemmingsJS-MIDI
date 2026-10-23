import { selectLocalAudioVoice } from '../../midi/scheduler/LocalAudioVoiceBudget.js';
import { createNativeOscillatorBackend } from './nativeOscillatorBackend.js';
import { createTimedControlTimeline } from './TimedControlTimeline.js';
import { createAudioObservationLeases } from './AudioObservationLeases.js';
import { createAudioResourceLeases } from './AudioResourceLeases.js';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const ATTACK_SECONDS = 0.008;
const RELEASE_SECONDS = 0.04;
const MAX_SCHEDULED_VOICES = 64;
const MAX_CONTROL_EVENTS = 128;
const MAX_AUDIO_SESSIONS = 4;
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
  constructor({ createAudioContext, nowMs, onStateChange, onPlayback, maxVoices = 32, maxNoteSeconds = 8,
    volume = 0.15, masterVolume = 0.7, resourceBudget = null } = {}) {
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
    this._contextEpoch = 0;
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
    this._semanticVoiceOwners = new Map();
    this._instrumentBackends = new Set();
    this._previewPending = [];
    this._previewTimer = null;
    this._voiceSequence = 0;
    this._onPlayback = onPlayback;
    this.capture = null;
    this._observers = createAudioObservationLeases();
    this._captureReleases = new Map();
    this._captureScope = 'audio-' + (++captureScopeSequence);
    this._audioResources = createAudioResourceLeases({ resourceBudget, ownerPrefix: this._captureScope });
    this._graphResourceLease = null; this._noiseResourceLease = null;
    this._captureContext = null;
    this._captureAnalyser = null;
    this._captureSamples = null;
    this._channels = new Map();
    this._sessions = new Map();
    this._sessionSequence = 0;
    this._defaultEnabled = false;
    this._defaultEnableRequests = 0;
    this._noiseBuffer = null;
    this._onContextState = () => {
      if (this._disposed || !this._enabled || this._context?.state === 'running') return;
      this.stop();
      this._setStatus('interrupted', 'Browser audio was interrupted. Enable preview again.');
    };
    this.output = this._createOutput();
  }

  _createOutput(owner = null) {
    const optionsForOwner = options => ({ ...options, owner });
    const ready = action => this._ownerReady(owner) ? action() : false;
    const channels = {};
    for (let number = 1; number <= 16; number += 1) {
      channels[number] = Object.freeze({
        sendNoteOn: (note, options) => ready(() => this._noteOn(number, note, optionsForOwner(options))),
        sendProgramChange: (program, options) => ready(() => this._safeSend(() => this._program(number, program, options, owner))),
        sendNoteOff: (note, options) => ready(() => this._noteOff(number, note, optionsForOwner(options))),
        sendControlChange: (control, value, options) => ready(() => this._safeSend(() => this._control(number, control, value, options, owner))),
        sendPitchBend: (value, options) => ready(() => this._safeSend(() => this._pitchBend(number, value, options, owner))),
        sendPitchBendRange: (semitones, cents, options) => ready(() => this._safeSend(() => this._pitchBendRange(number, semitones, cents, options, owner))),
        sendAllNotesOff: () => this._clearVoices(number, owner)
      });
    }
    return Object.freeze({
      id: 'browser-note-preview' + (owner == null ? '' : ':' + owner),
      captureScope: this._captureScope + (owner == null ? '' : ':' + owner),
      name: 'Browser audio preview' + (owner == null ? '' : ' (' + owner + ')'),
      supportsPerNotePan: true, supportsPerNoteInstrument: true, supportsIndependentNoteGates: true,
      isVoiceActive: token => this._isVoiceActive(token, owner),
      canAllocateVoice: () => this._renderVoiceCount() < this._maxScheduledVoices || [...this._voices].some(voice => this._voiceFinished(voice)),
      supportsPlaybackMetadata: true, channels: Object.freeze(channels),
      clear: () => this._clearVoices(null, owner)
    });
  }

  _ownerReady(owner) { return this._ready() && (owner == null || this._sessions.get(owner)?.enabled === true); }
  _tokenKey(token, owner = null) { return owner == null ? token : owner + ':' + token; }
  _hasEnabledOwners() { return this._defaultEnabled || this._defaultEnableRequests > 0 || [...this._sessions.values()].some(session => session.enabled || session.starting); }

  // Sessions partition controls/gates, but all voices use this graph's one budget and final mix.
  createSession(name, { onStateChange, onPlayback } = {}) {
    const label = String(name || '').trim().slice(0, 48);
    if (!label || this._disposed) return null;
    for (const session of this._sessions.values()) if (session.name === label) return session.api;
    if (this._sessions.size >= MAX_AUDIO_SESSIONS) throw new RangeError('Local audio supports at most four owner sessions.');
    const id = label + '#' + (++this._sessionSequence);
    const session = { id, name: label, enabled: false, starting: false, disposed: false, generation: 0, pending: new Set(), listeners: new Set(), onPlayback };
    if (typeof onStateChange === 'function') session.listeners.add(onStateChange);
    const getState = () => {
      const state = this.getState(); let activeVoices = 0, pendingNotes = 0;
      for (const voice of this._voices) if (voice.owner === id) activeVoices++;
      for (const entry of this._previewPending) if (entry.spec.owner === id) pendingNotes++;
      return { ...state, owner: label, ownerId: id, sharedMix: true, activeVoices, pendingNotes, enabled: session.enabled && state.enabled,
        status: session.disposed ? 'disposed' : session.starting ? 'unlocking' : session.enabled ? state.status : ['error', 'unsupported', 'interrupted'].includes(state.status) ? state.status : 'idle',
        message: session.disposed ? 'Local audio session is closed.' : session.enabled || session.starting ? state.message : 'Local audio session is off.' };
    };
    session.report = () => { for (const listener of session.listeners) { try { listener(getState()); } catch { /* Session observers do not own audio. */ } } };
    session.cancel = () => { session.generation++; session.enabled = false; session.starting = false; session.enablePromise = null; for (const cancel of session.pending) cancel(); session.pending.clear(); };
    const stop = () => {
      session.cancel(); this._clearVoices(null, id);
      if (!this._hasEnabledOwners()) this.stop(); else session.report();
    };
    const enable = () => {
      if (session.disposed || this._disposed) return Promise.resolve(false);
      if (session.enablePromise) return session.enablePromise;
      this._replaceClosedContext();
      const generation = session.generation; session.starting = true; session.report();
      const pending = (async () => {
        try {
          const ready = await this.enable(id);
          if (!ready || session.disposed || generation !== session.generation) return false;
          session.enabled = true; return true;
        } finally {
          if (generation === session.generation) { session.starting = false; session.report(); }
        }
      })();
      session.enablePromise = pending;
      const clear = () => { if (session.enablePromise === pending) session.enablePromise = null; };
      pending.then(clear, clear);
      return pending;
    };
    session.api = {
      output: this._createOutput(id), getState, enable, stop, panic: stop,
      createInstrumentBackend: options => {
        if (session.disposed || this._disposed) throw new Error('Local audio session is closed.');
        return this._registerInstrumentBackend(createNativeOscillatorBackend(this, id, options), id);
      },
      createWorkletInstrumentBackend: async options => {
        const generation = session.generation;
        const { createWorkletInstrumentBackend } = await import('./workletInstrumentBackend.js');
        if (session.disposed || this._disposed || generation !== session.generation) throw new Error('Audio backend selection was cancelled.');
        return this._registerInstrumentBackend(createWorkletInstrumentBackend(this, id, options), id);
      },
      createSampleInstrumentBackend: async options => {
        const generation = session.generation;
        const { createSampleInstrumentBackend } = await import('./sampleInstrumentBackend.js');
        if (session.disposed || this._disposed || generation !== session.generation) throw new Error('Audio backend selection was cancelled.');
        return this._registerInstrumentBackend(createSampleInstrumentBackend(this, id, options), id);
      },
      preview: (notes, options) => this.preview(notes, { ...options, owner: id }),
      setMasterVolume: value => this.setMasterVolume(value),
      setCapture: (capture, context) => { if (!session.disposed) this.setCapture(capture, context, id); },
      observeCapture: (capture, context) => session.disposed ? () => {} : this._observers.attach(capture, context, id),
      inspectRender: () => this.inspectRender(),
      reserveDecodedBuffer: options => {
        if (session.disposed || this._disposed) throw new Error('Local audio session is closed.');
        return this._audioResources.reserveDecodedBuffer({ ...options, owner: id, generation: session.generation });
      },
      subscribe: listener => { if (typeof listener !== 'function' || session.disposed) return () => {}; session.listeners.add(listener); return () => session.listeners.delete(listener); },
      dispose: () => {
        if (session.disposed) return Promise.resolve();
        session.disposed = true; stop(); session.report(); session.listeners.clear(); this._sessions.delete(id);
        for (const entry of this._instrumentBackends) if (entry.owner === id) entry.backend.dispose();
        this._observers.revokeOwner(id); this._captureReleases.delete(id);
        for (const [key, channel] of this._channels) if (channel.owner === id) { channel.gain.disconnect(); channel.pan?.disconnect(); channel.resourceLease?.release(); this._channels.delete(key); }
        this._audioResources.releaseOwner(id);
        return Promise.resolve();
      }
    };
    this._sessions.set(id, session);
    return session.api;
  }

  getState() {
    return {
      status: this._status,
      message: this._message,
      enabled: this._enabled && this._context?.state === 'running',
      contextEpoch: this._contextEpoch,
      resourceAccounting: this._audioResources.diagnostics(),
      activeVoices: this._voices.size, sharedMix: this._sessions.size > 0, sessionCount: this._sessions.size,
      maxVoices: this._maxVoices, maxScheduledVoices: this._maxScheduledVoices,
      voiceSteals: this._voiceSteals, voiceDrops: this._voiceDrops,
      mixCompression: !!this._compressor, mixLatencyMs: this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0, mixMakeupCompensation: this._compressor ? MIX_MAKEUP_COMPENSATION : 1, mixReductionDb: finite(this._compressor?.reduction, 0),
      pendingNotes: this._previewPending.length,
      masterVolume: this._masterVolume
    };
  }

  getAudioContext() { return this._context; }

  _registerInstrumentBackend(backend, owner) {
    if (this._disposed || this._instrumentBackends.size >= 8) { backend.dispose(); throw new RangeError('Local audio backend limit reached.'); }
    const entry = { owner, backend: null };
    entry.backend = Object.freeze({ ...backend, dispose: () => { backend.dispose(); this._instrumentBackends.delete(entry); } });
    this._instrumentBackends.add(entry); return entry.backend;
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
    for (const session of this._sessions.values()) session.report();
  }

  async enable(owner = null) {
    if (this._disposed) return false;
    if (!this._createContext) {
      this._setStatus('unsupported', 'Browser audio is not supported.');
      return false;
    }
    this._replaceClosedContext();
    const generation = this._generation;
    if (owner == null) this._defaultEnableRequests++;
    let cancelEnable = null;
    try {
      // Creation and resume happen before the first await, inside the caller's gesture.
      if (!this._context) {
        let context;
        let master;
        let limiter;
        let compressor;
        let compressorOutput;
        let resourceLease;
        try {
          resourceLease = this._audioResources.reserve({ kind: 'mix-graph', generation: this._generation,
            bytes: 4097 * 4, estimateBytes: 65536 });
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
          this._contextEpoch++;
          this._master = master;
          this._limiter = limiter;
          this._compressor = compressor;
          this._compressorOutput = compressorOutput;
          this._graphResourceLease = resourceLease;
        } catch (error) {
          resourceLease?.release();
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
        const cancelled = new Promise(resolve => { cancelEnable = () => {
          this._pendingEnables.delete(cancelEnable); this._sessions.get(owner)?.pending.delete(cancelEnable); resolve(false);
        }; });
        this._pendingEnables.add(cancelEnable); this._sessions.get(owner)?.pending.add(cancelEnable);
        const resumed = await Promise.race([this._resumePromise.then(() => true), cancelled]);
        this._pendingEnables.delete(cancelEnable); this._sessions.get(owner)?.pending.delete(cancelEnable);
        cancelEnable = null;
        if (!resumed) return false;
      }
      if (this._disposed || generation !== this._generation) return false;
      if (context.state !== 'running') throw new Error('Audio context is not running.');
      if (!this._enabled) this._setMixEnabled(true);
      this._enabled = true;
      if (owner == null) this._defaultEnabled = true;
      this._setStatus('ready', 'Browser preview is on. No MIDI is sent.');
      return true;
    } catch (error) {
      if (this._disposed || generation !== this._generation) return false;
      this._enabled = false;
      this._clearVoices();
      this._setStatus(error?.name === 'ResourceBudgetError' ? 'resource-limited' : 'error', error?.name === 'ResourceBudgetError'
        ? 'Browser audio memory budget is full. Stop another workload and retry.' : 'Browser audio could not start. Try enabling preview again.');
      return false;
    } finally {
      if (cancelEnable) { this._pendingEnables.delete(cancelEnable); this._sessions.get(owner)?.pending.delete(cancelEnable); }
      if (owner == null) this._defaultEnableRequests--;
    }
  }

  _replaceClosedContext() {
    if (this._context?.state !== 'closed') return;
    this.stop();
    this._context.removeEventListener?.('statechange', this._onContextState);
    for (const channel of this._channels.values()) { channel.gain.disconnect(); channel.pan?.disconnect(); channel.resourceLease?.release(); }
    this._channels.clear(); this._noiseBuffer = null;
    this._master?.disconnect(); this._limiter?.disconnect(); this._compressor?.disconnect();
    this._compressorOutput?.disconnect(); this._captureAnalyser?.disconnect();
    this._master = null; this._limiter = null; this._compressor = null; this._compressorOutput = null;
    this._captureAnalyser = null; this._captureSamples = null; this._context = null;
    this._graphResourceLease?.release(); this._graphResourceLease = null;
    this._noiseResourceLease?.release(); this._noiseResourceLease = null;
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
    this._enabled = false; this._defaultEnabled = false;
    for (const session of this._sessions.values()) session.cancel();
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
    for (const entry of this._instrumentBackends) entry.backend.dispose();
    for (const session of this._sessions.values()) session.disposed = true;
    this.stop();
    const context = this._context;
    context?.removeEventListener?.('statechange', this._onContextState);
    for (const channel of this._channels.values()) {
      channel.gain.disconnect();
      channel.pan?.disconnect();
      channel.resourceLease?.release();
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
    for (const session of this._sessions.values()) session.listeners.clear();
    this._sessions.clear();
    this._audioResources.dispose();
    this._observers.clear(); this._captureReleases.clear(); this.capture = null;
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
        localMasterGain: this._masterVolume, mixActiveVoices: this._voices.size, mixOwners: [...this._sessions.values()].filter(session => session.enabled).map(session => session.name), mixLatencyMs: this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0, mixMakeupCompensation: this._compressor ? MIX_MAKEUP_COMPENSATION : 1, mixReductionDb: finite(this._compressor?.reduction, 0), audioTime: this._context.currentTime, sampleRate: this._context.sampleRate, frames: this._captureSamples.length,
        reason: 'demand-inspection', scope: 'output', evidenceClass: 'digital-pcm-window',
        measurementTap: 'post-protection-shared-mix', acousticReceipt: false };
      this._observe('synth-render-sample', sample);
      return sample;
    } catch { return null; }
  }

  setCapture(capture = null, context = undefined, owner = undefined) {
    if (this._disposed) return;
    this._captureReleases.get(owner)?.();
    this._captureReleases.delete(owner);
    if (owner === undefined) {
      this.capture = typeof capture?.record === 'function' ? capture : null;
      if (context !== undefined) this._captureContext = context;
    }
    if (typeof capture?.record === 'function') this._captureReleases.set(owner,
      this._observers.attach(capture, context ?? (owner === undefined ? this._captureContext : null), owner));
  }

  observeMix(capture, context) { return this._disposed ? () => {} : this._observers.attach(capture, context); }

  _captureEnabled(owner = undefined) { return this._observers.enabled(owner); }

  _captureMetadata(fields, owner = null) { return this._observers.stamp(fields, owner); }

  _observe(stage, fields) {
    if (!this._captureEnabled()) return null;
    const session = fields.owner == null ? null : this._sessions.get(fields.owner);
    const output = session?.api.output || this.output;
    if (session) fields = { captureScope: output.captureScope, ...fields };
    return this._observers.emit(stage, { captureScope: this._captureScope, ...fields,
      backend: 'local-synth', outputId: output.id, outputScope: output.captureScope });
  }

  /** Notes use {note, velocity, durationMs, offsetMs, channel}; numbers are also accepted. */
  async preview(notes, { replace = true, durationMs = 220, stepMs = 160, owner = null } = {}) {
    if (this._disposed) return false;
    const session = owner == null ? null : this._sessions.get(owner);
    if (owner != null && (!session || session.disposed)) return false;
    if (replace) { if (session) session.api.stop(); else this.stop(); }
    const generation = session ? session.generation : this._generation;
    const specs = (Array.isArray(notes) ? notes : [notes]).slice(0, MAX_SCHEDULED_VOICES)
      .map((entry, index) => typeof entry === 'number'
        ? { note: entry, offsetMs: index * finite(stepMs, 160) }
        : { ...entry });
    for (const spec of specs) spec.owner = owner;
    if (!specs.some(spec => this._validNote(spec.note))) return false;
    if (!await (session ? session.api.enable() : this.enable()) || generation !== (session ? session.generation : this._generation)) return false;
    const baseTime = this._nowMs();
    for (const spec of specs) {
      if (!this._validNote(spec.note)) continue;
      const offset = finite(spec.offsetMs, 0);
      if (offset < 0 || !Number.isFinite(baseTime + offset)) continue;
      const requestId = this._observe('request', { ...spec.playback, ...(session ? { captureScope: session.api.output.captureScope, outputScope: session.api.output.captureScope } : {}), type: 'audition', owner, note: spec.note,
        channel: spec.channel ?? 1, program: spec.program, intendedMs: baseTime + offset, eventType: 'audition' });
      this._previewPending.push({ spec: { ...spec, capture: this._captureMetadata({ ...spec.playback, requestId, captureScope: session?.api.output.captureScope || this._captureScope, outputScope: session?.api.output.captureScope || this._captureScope, eventType: 'audition',
        note: spec.note, channel: spec.channel ?? 1, program: spec.program, ensembleRole: spec.ensembleRole,
        percussion: spec.percussion, intendedMs: baseTime + offset }, owner) }, time: baseTime + offset, durationMs });
    }
    this._previewPending.sort((a, b) => a.time - b.time);
    if (this._previewPending.length > MAX_SCHEDULED_VOICES) this._previewPending.splice(0, this._previewPending.length - MAX_SCHEDULED_VOICES);
    const played = this._drainPreviewQueue(this._generation, owner);
    return played || this._previewPending.some(entry => entry.spec.owner === owner);
  }

  _drainPreviewQueue(generation = this._generation, reportOwner = undefined) {
    if (this._previewTimer != null) clearTimeout(this._previewTimer);
    this._previewTimer = null;
    if (generation !== this._generation || !this._ready()) return false;
    const now = this._nowMs(), horizon = this._maxNoteSeconds * 500;
    let played = false;
    while (this._previewPending.length && this._previewPending[0].time <= now + horizon) {
      const { spec, time, durationMs } = this._previewPending.shift();
      const output = spec.owner == null ? this.output : this._sessions.get(spec.owner)?.api.output;
      if (!output) continue;
      const channel = output.channels[clamp(Math.trunc(finite(spec.channel, 1)), 1, 16)];
      const length = clamp(finite(spec.durationMs, durationMs), 30, this._maxNoteSeconds * 1000);
      if (time + length <= now) { this._observe('drop', { ...spec.capture, owner: spec.owner, type: 'noteOn', reason: 'expired-audition' }); continue; }
      if (Number.isFinite(spec.pitchBendRange)) channel.sendPitchBendRange(spec.pitchBendRange);
      if (Number.isFinite(spec.pitchBend)) channel.sendPitchBend(spec.pitchBend, { time });
      if (channel.sendNoteOn(spec.note, { rawAttack: finite(spec.velocity, 80), time, capture: spec.capture, playback: spec.playback, priority: spec.priority, laneIndex: spec.laneIndex, instrument: { program: spec.program, percussion: spec.percussion, role: spec.ensembleRole, legacy: !spec.ensembleRole && spec.percussion !== true },
        ...(Number.isFinite(spec.pan) ? { pan: clamp(spec.pan / 127, -1, 1) } : {}) })) {
        channel.sendNoteOff(spec.note, { time: time + length, capture: spec.capture });
        if (reportOwner === undefined || spec.owner === reportOwner) played = true;
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

  _channel(number, owner = null) {
    const key = owner == null ? number : owner + ':' + number;
    let channel = this._channels.get(key);
    if (channel) return channel;
    const resourceLease = this._audioResources.reserve({ kind: 'channel-graph', owner, generation: this._generation, estimateBytes: 8192 });
    let gain;
    let pan;
    try {
      gain = this._context.createGain();
      pan = this._context.createStereoPanner?.() || null;
      gain.connect(pan || this._master);
      pan?.connect(this._master);
    } catch (error) {
      resourceLease.release(); gain?.disconnect();
      pan?.disconnect();
      throw error;
    }
    channel = { owner, number, gain, pan, resourceLease, bendRange: 2, volume: 1, expression: 1, program: null,
      controls: createTimedControlTimeline({ maxEvents: MAX_CONTROL_EVENTS }) };
    this._channels.set(key, channel);
    return channel;
  }

  _program(number, value, options, owner = null) {
    if (!this._ready() || !Number.isInteger(value) || value < 0 || value > 127) return false;
    const channel = this._channel(number, owner);
    channel.controls.retainFrom(this._context.currentTime);
    if (!channel.controls.insert(this._audioTime(options), 'program', value)) return false;
    channel.program = channel.controls.at(this._context.currentTime).program;
    for (const voice of this._voices) if (voice.owner === owner && voice.number === number && voice.implicitProgram) {
      this._rescheduleFutureProgram(channel, voice);
    }
    return true;
  }

  _rescheduleFutureProgram(channel, voice) {
    if (voice.start <= this._context.currentTime || voice.released || voice.number === 10) return;
    const controlState = channel.controls.at(voice.start);
    const program = controlState.program;
    if (program === voice.programAtStart && controlState.timbre === voice.timbreAtStart) return;
    const source = voice.sourceInstrument || {};
    const profile = instrumentProfile(program, source.percussion === true, voice.note, source.legacy !== true);
    if (controlState.timbre != null && !profile.noise) profile.waveform = controlState.timbre < 1 / 3 ? 'sine' : controlState.timbre > 2 / 3 ? 'sawtooth' : 'triangle';
    if (profile.noise) return;
    for (const key of ['attack', 'decay', 'sustain', 'release']) {
      if (Number.isFinite(source.envelope?.[key])) profile[key] = clamp(source.envelope[key], 0, key === 'sustain' ? 1 : 2);
    }
    if (source.resumed === true) { profile.attack = 0; profile.decay = 0; }
    voice.oscillator.type = profile.waveform;
    voice.programAtStart = program;
    voice.timbreAtStart = controlState.timbre;
    voice.instrument = { ...source, program };
    voice.peak = voice.velocity / 127 * profile.gain;
    voice.attack = profile.attack; voice.decay = profile.decay; voice.sustain = profile.sustain; voice.release = profile.release;
    voice.releaseAt = voice.end - voice.release;
    const param = voice.gain.gain;
    param.cancelScheduledValues(voice.start);
    param.setValueAtTime(source.resumed === true ? voice.peak * voice.sustain : 0, voice.start);
    if (source.resumed !== true) param.linearRampToValueAtTime(voice.peak, voice.start + voice.attack);
    const sustainAt = Math.min(voice.end - voice.release, voice.start + voice.attack + voice.decay);
    if (voice.decay > 0) param.linearRampToValueAtTime(voice.peak * voice.sustain, sustainAt);
    param.setValueAtTime(voice.peak * voice.sustain, voice.end - voice.release);
    param.linearRampToValueAtTime(0, voice.end);
    this._observe('synth-revised', { ...voice.captureMeta, type: 'noteOn', voiceId: voice.id,
      channel: voice.number, note: voice.note, program, waveform: profile.waveform, audioTime: voice.start });
  }

  _percussionNoise() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const context = this._context;
    if (!context.createBuffer || !context.createBufferSource) return null;
    const length = Math.ceil((context.sampleRate || 48000) * 0.2);
    const resourceLease = this._audioResources.reserveDecodedBuffer({ frames: length, channels: 1,
      sampleRate: context.sampleRate || 48000, generation: this._generation });
    let buffer;
    try { buffer = context.createBuffer(1, length, context.sampleRate || 48000); }
    catch (error) { resourceLease.release(); throw error; }
    const samples = buffer.getChannelData(0);
    let seed = 0x45b9;
    for (let index = 0; index < length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[index] = seed / 2147483648 - 1;
    }
    this._noiseBuffer = buffer;
    this._noiseResourceLease = resourceLease;
    return buffer;
  }

  _voiceFinished(voice) {
    const now = this._context?.currentTime ?? 0;
    if (voice.isFinished) return voice.isFinished(now);
    return voice.end <= now || (voice.released && voice.releaseLevel === 0 && voice.releaseAt <= now) || (voice.sustain === 0 && now >= voice.start + voice.attack + voice.decay);
  }

  _renderVoiceCount(voices = this._voices) {
    let count = 0; for (const voice of voices) count += voice.renderCost || 1; return count;
  }

  _isVoiceActive(token, owner = null) {
    const voice = this._voicesByToken.get(this._tokenKey(token, owner)), now = this._context?.currentTime ?? 0;
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
      this._observe('drop', { ...options.capture, type: 'noteOn', note, channel: number, owner: options.owner, ...incoming, reason });
      return false;
    };
    if (this._renderVoiceCount() >= this._maxScheduledVoices) return drop('scheduled-voice-cap');
    let resourceLease;
    try { resourceLease = this._audioResources.reserveNativeVoice(options.owner ?? null, this._generation); }
    catch { return drop('audio-resource-budget'); }
    const simultaneous = [...this._voices].filter(voice => !voice.stolen && (voice.renderCost > 1 || voice.start <= start && voice.releaseAt > start));
    let victim = null;
    if (this._renderVoiceCount(simultaneous) >= this._maxVoices) {
      victim = selectLocalAudioVoice(simultaneous, incoming);
      if (!victim) { resourceLease.release(); return drop('local-voice-priority'); }
    }
    let voice;
    let oscillator;
    let gain;
    try {
      const channel = this._channel(number, options.owner);
      const controlState = channel.controls.at(start);
      const profile = instrumentProfile(options.instrument?.program ?? controlState.program, options.instrument?.percussion === true || number === 10, note, options.instrument?.legacy !== true);
      if (controlState.timbre != null && !profile.noise) profile.waveform = controlState.timbre < 1 / 3 ? 'sine' : controlState.timbre > 2 / 3 ? 'sawtooth' : 'triangle';
      for (const key of ['attack', 'decay', 'sustain', 'release']) {
        const value = options.instrument?.envelope?.[key];
        if (Number.isFinite(value)) profile[key] = clamp(value, 0, key === 'sustain' ? 1 : 2);
      }
      const resumed = options.instrument?.resumed === true;
      if (resumed) { profile.attack = 0; profile.decay = 0; }
      const noise = profile.noise && this._percussionNoise();
      oscillator = noise ? context.createBufferSource() : context.createOscillator();
      if (noise) { oscillator.buffer = noise; oscillator.loop = true; }
      gain = context.createGain();
      voice = { oscillator, gain, resourceLease, number, owner: options.owner ?? null, note, start, id: ++this._voiceSequence, playback: options.playback, startMs: this._nowMs() + (start - context.currentTime) * 1000, end: start + Math.min(this._maxNoteSeconds, profile.seconds || this._maxNoteSeconds), released: false, captureMeta: this._captureMetadata(options.capture, options.owner ?? null),
        ...incoming, startedAt: start,
        token: Number.isInteger(options.voiceToken) && options.voiceToken > 0 ? options.voiceToken : null,
        implicitProgram: options.instrument?.program == null, programAtStart: controlState.program, timbreAtStart: controlState.timbre,
        sourceInstrument: options.instrument || null,
        peak: clamp(finite(options?.rawAttack, 80), 1, 127) / 127 * profile.gain, attack: profile.attack, decay: profile.decay,
        sustain: profile.sustain, release: profile.release, instrument: options.instrument, velocity: clamp(finite(options?.rawAttack, 80), 1, 127) };
      voice.releaseAt = voice.end - voice.release;
      this._voices.add(voice);
      if (voice.token != null) this._voicesByToken.set(this._tokenKey(voice.token, voice.owner), voice);
      if (!noise) {
        oscillator.type = profile.waveform;
        oscillator.frequency.setValueAtTime(profile.frequency || 440 * (2 ** ((note - 69) / 12)), start);
        if (profile.endFrequency) oscillator.frequency.linearRampToValueAtTime(profile.endFrequency, start + profile.decay);
      }
      this._scheduleBend(channel, voice);
      gain.gain.setValueAtTime(resumed ? voice.peak * voice.sustain : 0, start);
      if (!resumed) gain.gain.linearRampToValueAtTime(voice.peak, start + voice.attack);
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
      if (victim) { this._voiceSteals++; this._release(victim, Math.max(context.currentTime, start - RELEASE_SECONDS), true); }
      const futureOff = channel.controls.from(start).find(event => event.kind === 'allNotesOff' && event.time < voice.end);
      if (futureOff) this._release(voice, futureOff.time, false, 'scheduled-all-notes-off');
      this._observe('synth-scheduled', { ...voice.captureMeta, type: 'noteOn', voiceId: voice.id, channel: number,
        note, velocity: voice.velocity, program: options.instrument?.program, ensembleRole: options.instrument?.role,
        percussion: options.instrument?.percussion, scheduledMs: voice.startMs, audioTime: start,
        endAudioTime: voice.end, mixLatencyMs: this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0, durationMs: (voice.end - start) * 1000, waveform: noise ? 'noise' : oscillator.type });
      if (this._captureEnabled() && !options.capture?.observedByScheduler) this._observe('api-dispatch', { ...voice.captureMeta, type: 'noteOn',
        voiceId: voice.id, channel: number, note, velocity: voice.velocity, scheduledMs: voice.startMs, accepted: true });
      this._emitPlayback(voice, 'start');
      this._setStatus(this._status, this._message);
      return true;
    } catch (error) {
      if (voice) this._destroyVoice(voice);
      else {
        resourceLease.release();
        try { oscillator?.stop(); } catch { /* A partially constructed oscillator never started. */ }
        oscillator?.disconnect();
        gain?.disconnect();
      }
      if (error?.name === 'ResourceBudgetError') return drop('audio-resource-budget');
      this._setStatus('error', 'Browser audio could not play this note.');
      return false;
    }
  }

  _release(voice, time, force = false, reason = 'note-off') {
    if (voice.requestRelease) { voice.requestRelease(time, force, reason); return; }
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
    voice.terminationCause = force && reason === 'note-off' ? 'voice-budget' : reason;
    if (force && reason === 'note-off') voice.stolen = true;
    this._observe('synth-release', { ...voice.captureMeta, type: 'noteOff', voiceId: voice.id, channel: voice.number,
      note: voice.note, scheduledMs: voice.startMs + (releaseAt - voice.start) * 1000, audioTime: releaseAt,
      endAudioTime: end, reason: voice.terminationCause });
    this._emitPlayback(voice, 'release', releaseAt);
    if (force && attackLevel === 0) this._destroyVoice(voice, 'inaudible-voice-reuse');
  }

  _noteOff(number, note, options = {}) {
    if (!this._ready() || !this._validNote(note)) return false;
    const time = this._audioTime(options);
    const candidates = [...this._voices].filter(voice => voice.owner === (options.owner ?? null) && voice.number === number && voice.note === note && (!voice.released || (options.voiceToken != null && time < voice.releaseAt)) && voice.start <= time + 0.001 &&
      (options.voiceToken == null || voice.token === options.voiceToken));
    // A scheduled release belongs to one note-on, including repeated same-pitch phrases.
    if (Number.isFinite(options?.time) || options.voiceToken != null) {
      if (candidates.length) {
        if (options.reason === 'local-voice-budget') this._voiceSteals += 1;
        this._release(candidates[0], time, false, options.reason);
      }
    } else {
      for (const voice of this._voices) {
        if (voice.owner === (options.owner ?? null) && voice.number === number && voice.note === note) this._destroyVoice(voice, 'immediate-note-off');
      }
    }
    if (this._captureEnabled() && !options.capture?.observedByScheduler && candidates.length) this._observe('api-dispatch', {
      ...(options.capture || candidates[0].captureMeta), type: 'noteOff', voiceId: candidates[0].id, channel: number,
      note, scheduledMs: finite(options.time, this._nowMs()), accepted: true });
    return candidates.length > 0;
  }

  _destroyVoice(voice, reason = 'source-ended') {
    if (!voice || !this._voices.delete(voice)) return;
    voice.onDestroy?.(reason);
    voice.resourceLease?.release();
    if (voice.token != null && this._voicesByToken.get(this._tokenKey(voice.token, voice.owner)) === voice) this._voicesByToken.delete(this._tokenKey(voice.token, voice.owner));
    this._observe('synth-end', { ...voice.captureMeta, type: 'noteEnd', voiceId: voice.id, channel: voice.number,
      note: voice.note, audioTime: this._context?.currentTime, scheduledMs: voice.startMs + (voice.end - voice.start) * 1000,
      matchedDurationMs: Math.max(0, ((this._context?.currentTime ?? voice.start) - voice.start) * 1000), reason });
    this._emitPlayback(voice, 'end');
    if (voice.oscillator) {
      voice.oscillator.onended = null;
      try { voice.oscillator.stop(); } catch { /* Already ended or failed to start. */ }
      voice.oscillator.disconnect();
    }
    voice.gain?.disconnect();
    voice.pan?.disconnect();
    this._setStatus(this._status, this._message);
  }

  _emitPlayback(voice, phase, releaseAt = voice.end - voice.release) {
    const callback = voice.owner == null ? this._onPlayback : this._sessions.get(voice.owner)?.onPlayback;
    if (!voice.playback || typeof callback !== 'function') return;
    try {
      callback({ ...voice.playback, id: voice.id, phase, note: voice.note, velocity: Math.round(voice.velocity),
        startMs: voice.startMs, releaseMs: voice.startMs + (releaseAt - voice.start) * 1000,
        endMs: voice.startMs + (voice.end - voice.start) * 1000,
        attackMs: voice.attack * 1000, decayMs: voice.decay * 1000, sustain: voice.sustain,
        releaseDurationMs: voice.release * 1000, ...(voice.released ? { releaseLevel: voice.releaseLevel / voice.peak } : {}),
        mixLatencyMs: this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0 });
    } catch { /* Display observers must never interrupt audio. */ }
  }

  _clearVoices(number = null, owner = undefined) {
    if (number == null) for (const entry of this._instrumentBackends) if (owner === undefined || entry.owner === owner) entry.backend.onOwnerStop?.();
    if (this._previewTimer != null) clearTimeout(this._previewTimer);
    this._previewTimer = null;
    for (const entry of this._previewPending) {
      if ((owner === undefined || (entry.spec.owner ?? null) === owner) && (number == null || clamp(Math.trunc(finite(entry.spec.channel, 1)), 1, 16) === number)) {
        this._observe('cancelled', { ...entry.spec.capture, owner: entry.spec.owner, type: 'noteOn', reason: 'audition-stop' });
      }
    }
    this._previewPending = this._previewPending.filter(entry => !((owner === undefined || (entry.spec.owner ?? null) === owner) && (number == null || clamp(Math.trunc(finite(entry.spec.channel, 1)), 1, 16) === number)));
    if (this._previewPending.length && this._ready()) this._drainPreviewQueue();
    for (const voice of this._voices) {
      if ((owner === undefined || voice.owner === owner) && (number == null || voice.number === number)) this._destroyVoice(voice, 'panic-or-stop');
    }
    for (const channel of this._channels.values()) {
      if ((owner !== undefined && channel.owner !== owner) || (number != null && channel.number !== number)) continue;
      channel.gain.gain.cancelScheduledValues(0);
      channel.gain.gain.value = 1;
      channel.volume = 1;
      channel.expression = 1;
      channel.program = null;
      channel.bendRange = 2;
      channel.controls.clear();
      if (channel.pan) {
        channel.pan.pan.cancelScheduledValues(0);
        channel.pan.pan.value = 0;
      }
    }
  }

  _control(number, control, value, options = {}, owner = null) {
    if (!this._ready() || !Number.isFinite(control) || !Number.isFinite(value)) return false;
    const channel = this._channel(number, owner);
    const time = this._audioTime(options);
    if (control === 120 || control === 123) {
      if (!Number.isFinite(options?.time) || time <= this._context.currentTime) { this._clearVoices(number, owner); return true; }
      channel.controls.retainFrom(this._context.currentTime);
      if (!channel.controls.insert(time, 'allNotesOff', null)) return false;
      for (const voice of this._voices) if (voice.owner === owner && voice.number === number &&
          voice.start <= time && time < voice.end) this._release(voice, time, false, 'scheduled-all-notes-off');
      return true;
    }
    const normalized = clamp(value, 0, 127) / 127;
    if (![7, 10, 11, 74].includes(control)) return false;
    channel.controls.retainFrom(this._context.currentTime);
    if (!channel.controls.insert(time, control === 7 ? 'volume' : control === 11 ? 'expression' : control === 74 ? 'timbre' : 'pan',
      control === 10 ? normalized * 2 - 1 : normalized)) return false;
    if (control === 74) for (const voice of this._voices) if (voice.owner === owner && voice.number === number && voice.implicitProgram) this._rescheduleFutureProgram(channel, voice);
    if (control === 10) this._scheduleChannelPan(channel);
    if (control === 7 || control === 11) {
      const effective = channel.controls.at(this._context.currentTime);
      channel.volume = effective.volume; channel.expression = effective.expression;
      this._scheduleChannelGain(channel);
    }
    return true;
  }

  _safeSend(action) {
    try { return action(); } catch {
      this._setStatus('error', 'Browser audio could not play this control.');
      return false;
    }
  }

  _scheduleChannelGain(channel) {
    const now = this._context.currentTime, param = channel.gain.gain;
    const state = channel.controls.at(now);
    param.cancelScheduledValues(now);
    param.setValueAtTime(state.volume * state.expression, now);
    for (const event of channel.controls.from(now)) if (event.kind === 'volume' || event.kind === 'expression') {
      state[event.kind] = event.value;
      param.setValueAtTime(state.volume * state.expression, event.time);
    }
  }

  _scheduleChannelPan(channel) {
    if (!channel.pan) return;
    const now = this._context.currentTime, param = channel.pan.pan;
    const state = channel.controls.at(now);
    param.cancelScheduledValues(now);
    param.setValueAtTime(state.pan, now);
    for (const event of channel.controls.from(now)) if (event.kind === 'pan') param.setValueAtTime(event.value, event.time);
  }

  _scheduleBend(channel, voice) {
    const from = Math.max(this._context.currentTime, voice.start), param = voice.oscillator.detune;
    const state = channel.controls.at(from);
    param.cancelScheduledValues(from);
    param.setValueAtTime(state.bend * state.bendRange * 100, from);
    for (const event of channel.controls.from(from)) if (event.time < voice.end &&
        (event.kind === 'bend' || event.kind === 'bendRange')) {
      state[event.kind] = event.value;
      param.setValueAtTime(state.bend * state.bendRange * 100, event.time);
    }
  }

  _pitchBend(number, value, options = {}, owner = null) {
    if (!this._ready() || !Number.isFinite(value)) return false;
    const channel = this._channel(number, owner);
    const time = this._audioTime(options);
    const bend = clamp(value, -1, 1);
    channel.controls.retainFrom(this._context.currentTime);
    if (!channel.controls.insert(time, 'bend', bend)) return false;
    for (const voice of this._voices) if (voice.owner === owner && voice.number === number && !voice.stolen) this._scheduleBend(channel, voice);
    return true;
  }

  _pitchBendRange(number, semitones, cents = 0, options = {}, owner = null) {
    if (!this._ready() || !Number.isFinite(semitones)) return false;
    const channel = this._channel(number, owner);
    channel.controls.retainFrom(this._context.currentTime);
    if (!channel.controls.insert(this._audioTime(options), 'bendRange', clamp(semitones + finite(cents, 0) / 100, 0, 48))) return false;
    channel.bendRange = channel.controls.at(this._context.currentTime).bendRange;
    for (const voice of this._voices) if (voice.owner === owner && voice.number === number && !voice.stolen) this._scheduleBend(channel, voice);
    return true;
  }
}

const createBrowserNotePreview = options => new BrowserNotePreview(options);

export { BrowserNotePreview, createBrowserNotePreview };
