import { createLiveLaneSourceBuses } from './LiveLaneSourceBuses.js';
import { scheduleNativeHeldEnvelope } from './NativeAdsrEnvelope.js';
import { workloadVoiceCount, inspectVoiceInterval, inspectVoiceExtensions } from './AudioVoiceAdmission.js';
import { nativeVoiceFinished, nativeRenderVoiceCount, releaseNativeVoice, destroyNativeVoice } from './NativeVoiceLifetime.js';
import { selectLocalAudioVoice } from '../../midi/scheduler/LocalAudioVoiceBudget.js';
import { createNativeOscillatorBackend } from './nativeOscillatorBackend.js';
import { createTimedControlTimeline } from './TimedControlTimeline.js';
import { createAudioObservationLeases } from './AudioObservationLeases.js';
import { createAudioResourceLeases, releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { createSoundMaterialProvider } from './SoundMaterialProvider.js';
import { createOwnedCueRouting } from './OwnedCueRouting.js';
import { createForegroundAuditionOwner } from './ForegroundAuditionOwner.js';
import { createAudioIntervalAdmission, audioIntervalStorageBytes } from './AudioIntervalAdmission.js';
import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';
const retirementState = receipt => receipt ? { state: receipt.state, outcome: receipt.outcome,
  failures: receipt.resources.filter(resource => ['failed', 'unknown'].includes(resource.status)).map(resource => ({ name: resource.name, status: resource.status, error: resource.error })) } : null;
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
    volume = 0.15, masterVolume = 0.7, resourceBudget = null, cueVoices = 0, cueCostUnits = cueVoices, maxInstrumentBackends = 20,
    createMediaElement = tag => globalThis.document?.createElement(tag), mediaDevices = globalThis.navigator?.mediaDevices } = {}) {
    const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
    this._createContext = createAudioContext === undefined
      ? (AudioContextType ? () => new AudioContextType({ sampleRate: 48000 }) : null)
      : createAudioContext;
    this._nowMs = nowMs || (() => globalThis.performance?.now?.() ?? Date.now());
    this._listeners = new Set();
    this._captureProvenanceListeners = new Set();
    if (typeof onStateChange === 'function') this._listeners.add(onStateChange);
    this._maxVoices = clamp(Math.trunc(finite(maxVoices, 32)), 1, MAX_RENDER_VOICES);
    if (!Number.isSafeInteger(cueVoices) || cueVoices < 0 || cueVoices > 8 || !Number.isSafeInteger(cueCostUnits) || cueCostUnits < cueVoices ||
        !cueVoices && cueCostUnits !== 0 || this._maxVoices + cueCostUnits > MAX_RENDER_VOICES) throw new RangeError('Cue workload requires an explicit spare voice quota.');
    if (!Number.isSafeInteger(maxInstrumentBackends) || maxInstrumentBackends < 1 || maxInstrumentBackends > 65) throw new RangeError('Invalid instrument backend bound.');
    this._maxInstrumentBackends = maxInstrumentBackends; this._maxCueCostUnits = cueCostUnits;
    this._maxCueVoices = cueVoices;
    this._maxLiveScheduledVoices = Math.max(MAX_SCHEDULED_VOICES, this._maxVoices + MAX_RELEASE_TAILS);
    this._maxCueScheduledVoices = cueCostUnits * 2;
    this._maxScheduledVoices = this._maxLiveScheduledVoices + this._maxCueScheduledVoices;
    this._cueRouting = null; this._createMediaElement = createMediaElement; this._mediaDevices = mediaDevices;
    this._intervalAdmission = null;
    this._foregroundAuditions = createForegroundAuditionOwner({ onChange: () => this._setStatus(this._status, this._message) });
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
    this._retirement = createProcgenRetirementScope();
    this._retiredVoices = new Map();
    this._retirementFaults = new Set(); this._effectRetirements = new Map();
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
    this._soundMaterialBudget = resourceBudget; this._soundMaterialProvider = null;
    this._graphResourceLease = null; this._noiseResourceLease = null;
    this._captureContext = null;
    this._captureAnalyser = null;
    this._captureSamples = null;
    this._channels = new Map();
    this._sessions = new Map();
    this._laneSourceBuses = new Map();
    this._pcmCaptureTaps = new Set();
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
      canAllocateVoice: () => this._workloadVoiceCount(owner) < (this._workloadClass(owner) === 'cue' ? this._maxCueScheduledVoices : this._maxLiveScheduledVoices) ||
        [...this._voices].some(voice => (voice.workloadClass || 'live') === this._workloadClass(owner) && this._voiceFinished(voice)),
      supportsPlaybackMetadata: true, channels: Object.freeze(channels),
      clear: () => this._clearVoices(null, owner)
    });
  }

  _ownerReady(owner) { return this._ready() && !this._retirementFaults.has(owner) && (!this._effectRetirements.has(owner) || this._effectRetirements.get(owner).scope.getReceipt()?.outcome === 'complete') && (owner == null || this._sessions.get(owner)?.enabled === true) &&
    (this._workloadClass(owner) !== 'cue' || this._cueRouting?.state().state === 'playing-route'); }

  _workloadClass(owner) { return this._sessions.get(owner)?.workloadClass || 'live'; }

  _workloadVoiceCount(owner, voices = this._voices) { return workloadVoiceCount.call(this, owner, voices); }

  _inspectVoiceInterval(owner, options = {}) { return inspectVoiceInterval.call(this, owner, options); }

  _inspectVoiceExtensions(changes, options = {}) { return inspectVoiceExtensions.call(this, changes, options); }

  getMonitorRouteState() { return this._cueRouting?.state() || Object.freeze({ state: 'muted', mode: 'muted', muted: true, revision: 0,
    cueIncludedInMasterCapture: false, physicalSeparation: 'not-claimed', cueGain: 0.5, message: 'Choose an explicit prelisten route.' }); }

  getAuditionState() { return this._foregroundAuditions.state(); }
  acquireAudition(options) { return this._foregroundAuditions.acquire(options); }
  revealAuditionSource() { return this._foregroundAuditions.revealSource(); }

  prepareCueRoute(options) {
    if (!this._maxCueVoices) return Promise.reject(new Error('The current workload has no reserved cue voices.'));
    if (options?.mode === 'separate-device' && !this._ready()) return Promise.reject(new Error('Enable browser audio before selecting a separate output.'));
    void this._foregroundAuditions.stop('cue-route-change');
    const prepare = () => {
      if (!this._cueRouting) this._cueRouting = createOwnedCueRouting({ context: this._context, masterInput: this._master, resources: this._audioResources,
        createElement: this._createMediaElement, mediaDevices: this._mediaDevices, onChange: route => {
          if (route.state === 'requires-revalidation') void this._foregroundAuditions.stop('cue-route-requires-revalidation');
          this._setStatus(this._status, this._message);
        } });
      return this._cueRouting.prepare(options);
    };
    return this._ready() ? prepare() : this.enable().then(ready => { if (!ready) throw new Error('Browser audio is unavailable.'); return prepare(); });
  }

  stopCue() {
    const receipt = createProcgenRetirementScope().retire([
      { name: 'foreground-source', run: () => this._foregroundAuditions.stop() },
      { name: 'cue-route-mute', run: () => this._cueRouting?.stop() },
      ...[...this._sessions.values()].filter(session => session.workloadClass === 'cue').map(session => ({ name: session.id, run: () => session.api.stop() }))
    ]);
    return receipt;
  }

  setCueGain(value) { this._cueRouting?.setLevel(value); }
  _tokenKey(token, owner = null) { return owner == null ? token : owner + ':' + token; }
  _hasEnabledOwners() { return this._defaultEnabled || this._defaultEnableRequests > 0 || [...this._sessions.values()].some(session => session.enabled || session.starting); }

  // Sessions partition controls/gates, but all voices use this graph's one budget and final mix.
  createSession(name, { onStateChange, onPlayback, workloadClass = 'live' } = {}) {
    const label = String(name || '').trim().slice(0, 48);
    if (!label || this._disposed || !['live', 'cue'].includes(workloadClass)) return null;
    if (this._retiredVoices.size >= MAX_RENDER_VOICES + MAX_RELEASE_TAILS) throw new RangeError('Unresolved audio retirement capacity reached.');
    for (const session of this._sessions.values()) {
      if (session.name === label) { if (session.workloadClass !== workloadClass) throw new Error('Session workload cannot change.'); return session.api; }
      if (workloadClass === 'cue' && session.workloadClass === 'cue') throw new Error('Another foreground prelisten session still owns cue.');
    }
    if (this._sessions.size >= MAX_AUDIO_SESSIONS) throw new RangeError('Local audio supports at most four owner sessions.');
    const id = label + '#' + (++this._sessionSequence);
    const session = { id, name: label, workloadClass, enabled: false, starting: false, disposed: false, generation: 0, pending: new Set(), listeners: new Set(), bodyListeners: new Set(), effectListeners: new Set(), onPlayback };
    const retirement = createProcgenRetirementScope();
    if (typeof onStateChange === 'function') session.listeners.add(onStateChange);
    const getState = () => {
      const state = this.getState(); let activeVoices = 0, pendingNotes = 0;
      for (const voice of this._voices) if (voice.owner === id) activeVoices++;
      for (const entry of this._previewPending) if (entry.spec.owner === id) pendingNotes++;
      return { ...state, owner: label, ownerId: id, sharedMix: true, activeVoices, pendingNotes, enabled: session.enabled && state.enabled && !this._retirementFaults.has(id),
        laneSources: this._laneSourceBuses.get(id)?.buses.diagnostics() || null, effectRetirement: retirementState(this._effectRetirements.get(id)?.scope.getReceipt()), retirement: retirementState(retirement.getReceipt()),
        status: session.disposed ? 'disposed' : this._retirementFaults.has(id) ? 'error' : session.starting ? 'unlocking' : session.enabled ? state.status : ['error', 'unsupported', 'interrupted'].includes(state.status) ? state.status : 'idle',
        message: session.disposed ? 'Local audio session is closed.' : session.enabled || session.starting ? state.message : 'Local audio session is off.' };
    };
    session.report = () => { for (const listener of session.listeners) { try { listener(getState()); } catch { /* Session observers do not own audio. */ } } this._reportCaptureProvenance(); };
    session.cancel = () => {
      session.generation++; session.enabled = false; session.starting = false;
      const operation = session.enableOperation; session.enableOperation = null; session.enablePromise = null;
      operation?.resolve(false);
      for (const cancel of session.pending) cancel(); session.pending.clear();
    };
    const stop = () => {
      if (session.stopping) return session.stopReceipt;
      session.stopping = true;
      try { return session.stopReceipt = createProcgenRetirementScope().retire([
        { name: 'cue-mute', run: () => { if (workloadClass === 'cue') this._cueRouting?.stop(); } },
        { name: 'session-admission', run: () => session.cancel() },
        { name: 'owned-voices', run: () => this._clearVoices(null, id) },
        { name: 'owner-effects', run: () => this._retireOwnerEffects(id) },
        { name: 'lane-sources', run: () => this._retireLaneSources(id) },
        { name: 'mix-state', run: () => { if (!this._hasEnabledOwners()) return this.stop(); session.report(); } }
      ]); } finally { session.stopping = false; }
    };
    const enable = () => {
      this._replaceClosedContext();
      if (session.disposed || session.stopping || this._disposed || this._retirementFaults.has(id)) return Promise.resolve(false);
      if (session.enablePromise) return session.enablePromise;
      if (session.enabled && this._ownerReady(id)) return Promise.resolve(true);
      if (workloadClass === 'cue') {
        if (!this._maxCueVoices || !this._cueRouting) return Promise.resolve(false);
        try { this._cueRouting.getInput(); } catch { return Promise.resolve(false); }
      }
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const operation = { generation: session.generation, promise, resolve };
      session.enableOperation = operation; session.enablePromise = promise; session.starting = true;
      const settle = ready => {
        if (session.enableOperation !== operation) { resolve(false); return; }
        const accepted = ready === true && !session.disposed && !this._disposed && operation.generation === session.generation;
        session.enabled = accepted; session.starting = false;
        if (!accepted && workloadClass === 'cue') this._cueRouting?.stop();
        // Retain the operation through notification so reentrant callers share it.
        session.report();
        if (session.enableOperation === operation) { session.enableOperation = null; session.enablePromise = null; }
        resolve(accepted && operation.generation === session.generation);
      };
      try {
        if (workloadClass === 'cue') this._cueRouting.activate();
        session.report();
        if (session.enableOperation !== operation || session.disposed) { settle(false); return promise; }
        // Invoke directly: AudioContext creation/resume must retain the caller's gesture.
        Promise.resolve(this.enable(id)).then(async ready => {
          const receipts = [this._effectRetirements.get(id)?.scope.getReceipt(), this._laneSourceBuses.get(id)?.retirement];
          for (const receipt of receipts) if (receipt) { await receipt.completion; ready = ready && receipt.outcome === 'complete'; }
          settle(ready);
        }, () => settle(false)).catch(() => settle(false));
      } catch { settle(false); }
      return promise;
    };
    session.api = {
      output: this._createOutput(id), getState, enable, stop, panic: stop,
      setCaptureContext: ({ worldId, graphRevision, routeRevision, scoreMapping = null } = {}) => {
        if (session.disposed) return false;
        const previous = session.captureContext;
        if (previous?.worldId === worldId && previous.graphRevision === graphRevision && previous.routeRevision === routeRevision && session.captureAnchor === scoreMapping) return false;
        const data = { worldId, graphRevision, routeRevision, scoreMapping };
        session.captureContext = freezeData(JSON.parse(canonicalDataText(data, { maxBytes: 4096, maxNodes: 128, domain: 'Capture score mapping' }).text));
        session.captureAnchor = scoreMapping; this._reportCaptureProvenance(); return true;
      },
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
      preparePcmCue: async options => {
        const generation = session.generation, context = this._context;
        const { prepareOwnedPcmCue } = await import('./OwnedPcmCue.js');
        if (workloadClass !== 'cue' || session.disposed || generation !== session.generation || context !== this._context) throw new Error('PCM cue preparation was canceled.');
        return this._registerInstrumentBackend(await prepareOwnedPcmCue(this, id, options), id);
      },
      configureLaneSources: laneIds => {
        if (!Array.isArray(laneIds) || laneIds.length > 1024 || laneIds.some(value => typeof value !== 'string' || !value || value.length > 160) || new Set(laneIds).size !== laneIds.length) throw new TypeError('Invalid lane source declaration.');
        if (session.disposed) throw new Error('The lane source session has retired.');
        if (this._laneSourceBuses.has(id)) this._laneSourcesFor(id, this._context).declare(laneIds);
        session.laneSourceIds = laneIds.slice();
      },
      prepareEffectGraph: async (definition, options = {}) => {
        const generation = session.generation, context = this._context;
        if (session.disposed || !this._ownerReady(id)) throw new Error('Enable this local audio owner before preparing its effect rack.');
        const { createOwnerEffectGraphHost } = await import('./OwnerEffectGraphHost.js');
        if (session.disposed || generation !== session.generation || context !== this._context) throw new Error('Effect owner changed during preparation.');
        const channel = this._channel(0, id);
        if (channel.effects && channel.effects.state().generation !== generation) {
          const previous = channel.effects, receipt = previous.dispose(); await receipt.completion;
          if (receipt.outcome !== 'complete') throw new Error('The previous effect epoch has unresolved producer retirement.');
          if (channel.effects === previous) channel.effects = null;
          if (session.disposed || generation !== session.generation || context !== this._context) throw new Error('Effect owner changed during retirement.');
        }
        channel.effects ||= createOwnerEffectGraphHost({ context, input: channel.effectInput, dry: channel.effectDry, destination: channel.destination,
          resources: this._audioResources, owner: id, generation, getMaterialProvider: () => this.getSoundMaterialProvider(), isCurrent: () => !session.disposed && generation === session.generation && context === this._context,
          resolveSidechainSource: request => {
            if (request.sourceBusId !== 'owner') return this._laneSourcesFor(id, context).pin(request);
            if (request.inputLayout !== 'audioStereo') return null;
            return { node: request.tap === 'pre-fader' ? channel.sourceInput : channel.effectInput, context, owner: id, generation, sourceBusId: 'owner', tap: request.tap,
              layout: 'audioStereo', stage: 'upstream-owner-effects', isActive: () => !session.disposed && generation === session.generation && context === this._context && context.state !== 'closed', release() {} };
          },
          onEffectReceipt: receipt => { for (const listener of session.effectListeners) { try { listener(receipt); } catch {} } },
          onBodyReceipt: receipt => { for (const listener of session.bodyListeners) { try { listener(receipt); } catch {} } }, onChange: () => session.report() });
        return channel.effects.prepare(definition, { ...options, isCurrent: () => generation === session.generation && !session.disposed && (!options.isCurrent || options.isCurrent()) });
      },
      updateEffectGraph: (nodeId, values, frame, expected) => {
        if (session.disposed || !this._ownerReady(id)) throw new Error('This local effect owner is not active.');
        const host = this._channels.get(id + ':0')?.effects; if (!host) throw new Error('Prepare an owner effect rack first.'); return host.update(nodeId, values, frame, expected);
      },
      preparedBodyInventory: () => this._channels.get(id + ':0')?.effects?.preparedBodyInventory() || [],
      observeEffectReceipts: listener => { if (session.disposed || typeof listener !== 'function' || session.effectListeners.size >= 8) throw new Error('The effect receipt observer is unavailable.'); session.effectListeners.add(listener); return () => session.effectListeners.delete(listener); },
      observeBodyReceipts: listener => { if (session.disposed || typeof listener !== 'function' || session.bodyListeners.size >= 8) throw new Error('The body receipt observer is unavailable.'); session.bodyListeners.add(listener); return () => session.bodyListeners.delete(listener); },
      enqueueBodyStrike: (nodeId, command, expected) => {
        if (session.disposed || !this._ownerReady(id)) throw new Error('The prepared body owner is not active.');
        const effects = this._channels.get(id + ':0')?.effects; if (!effects) throw new Error('The prepared body owner is unavailable.'); return effects.enqueueBodyStrike(nodeId, command, expected);
      },
      updatePreparedBody: (nodeId, values, frame, expected) => {
        if (session.disposed || !this._ownerReady(id)) throw new Error('The prepared body owner is not active.');
        const effects = this._channels.get(id + ':0')?.effects; if (!effects) throw new Error('The prepared body owner is unavailable.'); return effects.updatePreparedBody(nodeId, values, frame, expected);
      },
      panicPreparedBody: (nodeId, expected) => { const effects = this._channels.get(id + ':0')?.effects; if (!effects) throw new Error('The prepared body owner is unavailable.'); return effects.panicPreparedBody(nodeId, expected); },
      setEffectBypass: (mode, expected) => this._channels.get(id + ':0')?.effects?.bypass(mode, expected) || null,
      isSourceVoiceAvailable: member => this._laneSourceBuses.get(id)?.buses.hasVoice(member) || false,
      getEffectPerformanceState: () => this._channels.get(id + ':0')?.effects?.performanceSnapshot() || null,
      inspectEffectGraph: ({ requestHealth = false } = {}) => { const effects = this._channels.get(id + ':0')?.effects; if (requestHealth) effects?.requestInspection(); return effects?.state() || null; },
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
        if (retirement.getReceipt()) return retirement.getReceipt().completion;
        const backends = [...this._instrumentBackends].filter(entry => entry.owner === id), channels = [...this._channels].filter(([, channel]) => channel.owner === id);
        const receipt = retirement.retire([
          { name: 'invalidate-session', run: () => { session.disposed = true; session.cancel(); } },
          { name: 'stop-session', run: stop },
          ...backends.map((entry, index) => ({ name: `backend-${index}`, run: () => entry.backend.dispose() })),
          { name: 'observers', run: () => this._observers.revokeOwner(id) },
          { name: 'capture-registration', run: () => this._captureReleases.delete(id) },
          ...channels.map(([key, channel]) => ({ name: `channel-${channel.number}`, run: () => this._retireChannel(key, channel) })),
          { name: 'resource-reservations', run: () => this._audioResources.retireOwner(id) },
          { name: 'session-state', run: () => { session.report(); session.listeners.clear(); session.bodyListeners.clear(); session.effectListeners.clear(); this._sessions.delete(id); } }
        ]);
        return receipt.completion;
      }
    };
    this._sessions.set(id, session);
    return session.api;
  }

  getOperationalState() {
    return Object.freeze({ status: this._status, message: this._message, enabled: this._enabled && this._context?.state === 'running',
      contextState: this._context?.state || 'not-created', contextEpoch: this._contextEpoch, activeVoices: this._voices.size,
      pendingNotes: this._previewPending.length, masterVolume: this._masterVolume });
  }

  getState() {
    return {
      status: this._status,
      message: this._message,
      enabled: this._enabled && this._context?.state === 'running',
      contextEpoch: this._contextEpoch, contextState: this._context?.state || 'not-created',
      resourceAccounting: this._audioResources.diagnostics(),
      retirement: retirementState(this._retirement.getReceipt()), retiredVoices: this._retiredVoices.size, unclosedContext: !!this._retiringContext,
      activeVoices: this._voices.size, sharedMix: this._sessions.size > 0, sessionCount: this._sessions.size,
      instrumentBackends: this._instrumentBackends.size, maxInstrumentBackends: this._maxInstrumentBackends,
      maxVoices: this._maxVoices, maxScheduledVoices: this._maxScheduledVoices,
      workload: { liveCostUnits: this._maxVoices, cueCostUnits: this._maxCueCostUnits, aggregateCostUnits: this._maxVoices + this._maxCueCostUnits, liveVoices: this._maxVoices, cueVoices: this._maxCueVoices, aggregateVoices: this._maxVoices + this._maxCueVoices,
        liveSourceReservations: this._maxLiveScheduledVoices, cueSourceReservations: this._maxCueScheduledVoices,
        cueCanStealLive: false }, monitorRoute: this.getMonitorRouteState(),
      audition: this.getAuditionState(),
      voiceSteals: this._voiceSteals, voiceDrops: this._voiceDrops,
      mixCompression: !!this._compressor, mixLatencyMs: this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0, mixMakeupCompensation: this._compressor ? MIX_MAKEUP_COMPENSATION : 1, mixReductionDb: finite(this._compressor?.reduction, 0),
      pendingNotes: this._previewPending.length,
      masterVolume: this._masterVolume
    };
  }

  getAudioContext() { return this._context; }

  getCaptureProvenance() {
    const context = this._context;
    return { contextEpoch: this._contextEpoch, sampleRate: context?.sampleRate,
      observedFrame: Math.ceil((context?.currentTime ?? 0) * (context?.sampleRate ?? 0)),
      routeRevision: this.getMonitorRouteState().revision ?? null,
      owners: [...this._sessions.values()].filter(session => !session.disposed && session.workloadClass === 'live').map(session => ({
        ownerId: session.id, generation: session.generation, enabled: session.enabled,
        graph: session.captureContext ?? null, effects: this._channels.get(session.id + ':0')?.effects?.captureSnapshot() ?? null
      })), unscoredMasterSourcesPossible: true };
  }

  subscribeCaptureProvenance(listener) {
    if (typeof listener !== 'function' || this._disposed || this._captureProvenanceListeners.size) throw new Error('Capture provenance observer is unavailable.');
    this._captureProvenanceListeners.add(listener);
    return () => this._captureProvenanceListeners.delete(listener);
  }

  _reportCaptureProvenance() {
    if (!this._captureProvenanceListeners.size) return;
    for (const listener of this._captureProvenanceListeners) { try { listener(this.getCaptureProvenance()); } catch { /* Capture contains its own failure policy. */ } }
  }

  getSoundMaterialProvider() {
    if (this._disposed) throw new Error('Local sound material owner is closed.');
    return this._soundMaterialProvider ||= createSoundMaterialProvider({ getContext: () => this._context, resourceBudget: this._soundMaterialBudget });
  }

  acquireMasterCaptureTap({ context, contextEpoch, node, onRetire } = {}) {
    if (!this._ready() || context !== this._context || contextEpoch !== this._contextEpoch || !node ||
        typeof onRetire !== 'function' || this._pcmCaptureTaps.size) throw new Error('The browser master capture tap is unavailable.');
    const tap = this._limiter, entry = { onRetire, context }, retirement = createProcgenRetirementScope();
    this._pcmCaptureTaps.add(entry);
    try { tap.connect(node); }
    catch (error) {
      try { tap.disconnect(node); this._pcmCaptureTaps.delete(entry); } catch { /* An uncertain native connection keeps its tap slot. */ }
      throw error;
    }
    return Object.freeze({ release: () => {
      const receipt = retirement.retire([{ name: 'master-capture-tap', run: () => { tap.disconnect(node); this._pcmCaptureTaps.delete(entry); } }]);
      if (receipt.outcome !== 'complete') throw Object.assign(new Error('Master capture tap retirement is unresolved.'), { retirement: receipt });
      return true;
    } });
  }

  _registerInstrumentBackend(backend, owner) {
    if (this._disposed || this._instrumentBackends.size >= this._maxInstrumentBackends) { backend.dispose(); throw new RangeError('Local audio backend limit reached.'); }
    let metadata;
    try { metadata = this._audioResources.reserve({ kind: 'instrument-backend-host', owner, generation: this._generation, estimateBytes: 4096, consumerOwned: true }); }
    catch (error) { backend.dispose(); throw error; }
    const entry = { owner, backend: null };
    const retirement = createProcgenRetirementScope();
    entry.backend = Object.freeze({ ...backend, dispose: () => {
      let native;
      const receipt = retirement.retire([{ name: 'backend', run: () => native = createProcgenRetirementScope().retire([{ name: 'native-backend', run: () => backend.dispose() }]) },
        { name: 'backend-host-storage', run: () => releaseAudioResourceAfterRetirement(metadata, native) }]);
      receipt.completion.then(value => { if (value.outcome === 'complete') this._instrumentBackends.delete(entry); });
      return receipt;
    } });
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
    this._reportCaptureProvenance();
    for (const listener of this._listeners) {
      try { listener(this.getState()); } catch { /* UI callbacks must not break audio cleanup. */ }
    }
    for (const session of this._sessions.values()) session.report();
  }

  async enable(owner = null) {
    if (this._stopping) return false;
    if (this._retirementFaults.has(owner)) return false;
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
            bytes: 4097 * 4 + audioIntervalStorageBytes(this._maxScheduledVoices + 1), estimateBytes: 65536 });
          this._intervalAdmission = createAudioIntervalAdmission({ maxIntervals: this._maxScheduledVoices + 1 });
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
          this._intervalAdmission = null;
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
    const context = this._context;
    let acknowledgment = null;
    this._lastClosedContextRetirement = createProcgenRetirementScope().retire([
      { name: 'stop', run: () => this.stop() },
      { name: 'cue-routing', run: () => this._cueRouting?.dispose() },
      ...[...this._laneSourceBuses.keys()].map(owner => ({ name: 'lane-sources-' + owner, run: () => this._retireLaneSources(owner) })),
      { name: 'context-listener', run: () => context.removeEventListener?.('statechange', this._onContextState) },
      ...[...this._channels].map(([key, channel]) => ({ name: 'channel-' + key, run: () => this._retireChannel(key, channel) })),
      ...['_master', '_limiter', '_compressor', '_compressorOutput', '_captureAnalyser'].map(field => ({ name: field, run: () => this[field]?.disconnect() })),
      { name: 'graph-reservation', run: () => this._graphResourceLease?.release() },
      { name: 'noise-reservation', run: () => this._noiseResourceLease?.release() },
      { name: 'closed-context-acknowledgment', run: () => { acknowledgment = this._reconcileClosedContext(context); return acknowledgment; } },
      { name: 'context-references', run: () => {
        this._channels.clear(); this._noiseBuffer = null; this._master = null; this._limiter = null; this._compressor = null; this._compressorOutput = null;
        this._captureAnalyser = null; this._captureSamples = null; this._context = null; this._graphResourceLease = null; this._noiseResourceLease = null; this._cueRouting = null; this._intervalAdmission = null;
        if (acknowledgment?.outcome === 'complete') this._retirementFaults.clear();
      } }
    ]);
    return this._lastClosedContextRetirement;
  }

  _reconcileClosedContext(context) {
    if (context?.state !== 'closed') throw new Error('Native audio retirement needs a closed context acknowledgment.');
    for (const tap of this._pcmCaptureTaps) if (tap.context === context) this._pcmCaptureTaps.delete(tap);
    const retired = [...this._retiredVoices.values()].filter(voice => voice.nativeContext === context);
    const receipt = createProcgenRetirementScope().retire([
      ...retired.map(voice => ({ name: 'closed-voice-' + voice.id, run: () => {
        voice.closedContextRetirement ||= createProcgenRetirementScope();
        return voice.closedContextRetirement.retire([{ name: 'held-native-assets', run: () => voice.onContextClosed?.() }]);
      } })),
      { name: 'native-reservations', run: () => this._audioResources.confirmClosedContext() }
    ]);
    const acknowledge = result => {
      if (result.outcome !== 'complete') return;
      for (const voice of retired) this._retiredVoices.delete(voice.id);
      for (const owner of [...this._retirementFaults]) if (![...this._retiredVoices.values()].some(voice => voice.owner === owner)) this._retirementFaults.delete(owner);
    };
    if (receipt.state === 'retired') acknowledge(receipt); else receipt.completion.then(acknowledge);
    return receipt;
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
    if (this._stopping) return this._stopScope.getReceipt();
    this._stopping = true; this._stopScope = createProcgenRetirementScope();
    this._generation += 1;
    this._enabled = false; this._defaultEnabled = false;
    const sessions = [...this._sessions.values()], pending = [...this._pendingEnables];
    this._pendingEnables.clear();
    this._resumePromise = null;
    try { return this._stopScope.retire([
      { name: 'foreground-source-cancel', run: () => { void this._foregroundAuditions.stop('global-panic-or-audio-stop'); } },
      ...[...this._pcmCaptureTaps].map((tap, index) => ({ name: 'pcm-capture-' + index, run: () => tap.onRetire(this._disposed ? 'owner-retired' : 'panic') })),
      { name: 'cue-mute', run: () => this._cueRouting?.stop() },
      ...sessions.map(session => ({ name: `session-${session.name}`, run: session.cancel })),
      { name: 'mute-mix', run: () => this._setMixEnabled(false) },
      ...pending.map((cancel, index) => ({ name: `pending-enable-${index}`, run: cancel })),
      { name: 'voices', run: () => this._clearVoices() },
      { name: 'status', run: () => { if (!this._disposed) this._setStatus(this._createContext ? 'idle' : 'unsupported',
        this._createContext ? 'Browser preview is off.' : 'Browser audio is not supported.'); } }
    ]); } finally { this._stopping = false; }
  }

  panic() { this.stop(); }

  dispose() {
    if (this._retirement.getReceipt()) return this._retirement.getReceipt().completion;
    const context = this._context;
    const receipt = this._retirement.retire([
      { name: 'invalidate-audio', run: () => { this._disposed = true; } },
      ...[...this._sessions.values()].map(session => ({ name: `session-${session.name}`, run: () => session.api.dispose() })),
      ...[...this._instrumentBackends].map((entry, index) => ({ name: `backend-${index}`, run: () => entry.backend.dispose() })),
      { name: 'stop', run: () => this.stop() },
      { name: 'cue-routing', run: () => this._cueRouting?.dispose() },
      ...[...this._laneSourceBuses.keys()].map(owner => ({ name: 'lane-sources-' + owner, run: () => this._retireLaneSources(owner) })),
      { name: 'foreground-auditions', run: () => this._foregroundAuditions.dispose() },
      { name: 'sound-material', run: () => this._soundMaterialProvider?.dispose() },
      { name: 'context-listener', run: () => context?.removeEventListener?.('statechange', this._onContextState) },
      ...[...this._channels].map(([key, channel]) => ({ name: `channel-${key}`, run: () => this._retireChannel(key, channel) })),
      ...['_master', '_limiter', '_compressor', '_compressorOutput', '_captureAnalyser'].map(field => ({ name: field, run: () => { this[field]?.disconnect(); this[field] = null; } })),
      { name: 'buffers', run: () => { this._noiseBuffer = null; this._captureSamples = null; this._intervalAdmission = null; } },
      { name: 'resource-reservations', run: () => this._audioResources.dispose() },
      { name: 'observers', run: () => this._observers.clear() },
      { name: 'context', run: () => {
        this._context = null; this._retiringContext = context;
        return Promise.resolve(context?.close?.()).then(() => {
          this._retiringContext = null;
          if (context?.state === 'closed') return this._reconcileClosedContext(context);
        });
      } },
      { name: 'terminal-state', run: () => {
        this._setStatus('disposed', 'Browser preview is closed.'); this._listeners.clear(); this._captureProvenanceListeners.clear();
        for (const session of this._sessions.values()) session.listeners.clear();
        this._sessions.clear(); this._captureReleases.clear(); this.capture = null;
      } }
    ]);
    this._disposePromise = receipt.completion;
    return this._disposePromise;
  }

  _retireLaneSources(owner) {
    const entry = this._laneSourceBuses.get(owner); if (!entry) return;
    let receipt;
    try { receipt = entry.retirement ||= entry.buses.dispose(); }
    catch (error) { this._retirementFaults.add(owner); throw error; }
    const reconcile = () => {
      if (receipt.outcome === 'complete') { if (this._laneSourceBuses.get(owner) === entry) this._laneSourceBuses.delete(owner); }
      else this._retirementFaults.add(owner);
    };
    if (receipt.state === 'retired') reconcile();
    else if (!entry.retirementObserved) { entry.retirementObserved = true; receipt.completion.then(reconcile, () => this._retirementFaults.add(owner)); }
    return receipt;
  }

  _laneSourcesFor(owner, context) {
    const session = this._sessions.get(owner), generation = session?.generation ?? this._generation;
    if (!session || session.disposed || context !== this._context || context.state === 'closed') throw new Error('The lane source owner is unavailable.');
    let entry = this._laneSourceBuses.get(owner);
    if (entry && (entry.context !== context || entry.generation !== generation)) {
      if (this._retireLaneSources(owner)?.outcome !== 'complete') throw new Error('Prior lane source retirement is unresolved.'); entry = null;
    }
    if (!entry) {
      const buses = createLiveLaneSourceBuses({ context, resources: this._audioResources, owner, generation,
        isCurrent: () => !session.disposed && session.generation === generation && this._context === context });
      try { buses.declare(session.laneSourceIds || []); } catch (error) { buses.dispose(); throw error; }
      entry = { context, generation, buses }; this._laneSourceBuses.set(owner, entry);
    }
    return entry.buses;
  }

  _retireOwnerEffects(owner) {
    const current = this._effectRetirements.get(owner); if (current) return current.scope.getReceipt();
    const members = [...this._channels.values()].filter(channel => channel.owner === owner && channel.effects).map(channel => ({ channel, effects: channel.effects }));
    if (!members.length) return null;
    const scope = createProcgenRetirementScope({ deadlineMs: 16000 }), entry = { scope }; this._effectRetirements.set(owner, entry);
    const receipt = scope.retire(members.map(({ channel, effects }, index) => ({ name: 'owner-effect-' + index, run: async () => {
      const retired = effects.dispose(); await retired.completion;
      if (retired.outcome !== 'complete') throw new Error('Owner effect producer retirement is unresolved.');
      if (channel.effects === effects) { channel.effects = null; if (this._context?.state !== 'closed') channel.effectDry.gain.setValueAtTime(1, this._context.currentTime); }
    } })));
    receipt.completion.then(() => { if (receipt.outcome === 'complete' && this._effectRetirements.get(owner) === entry) this._effectRetirements.delete(owner); else if (receipt.outcome !== 'complete') this._retirementFaults.add(owner); });
    return receipt;
  }

  _retireChannel(key, channel) {
    channel.retirement ||= createProcgenRetirementScope({ deadlineMs: 16000 });
    const receipt = channel.retirement.retire([{ name: 'channel-lifetime', run: () => {
      const effects = channel.effects?.dispose();
      const finish = () => {
        if (effects && effects.outcome !== 'complete') {
          const error = new Error('Effect graph retirement remains unresolved.'); channel.resourceLease.retainUnknown(error); throw error;
        }
        const native = createProcgenRetirementScope().retire([
          { name: 'source-input', run: () => channel.sourceInput?.disconnect() }, { name: 'gain', run: () => channel.gain.disconnect() }, { name: 'pan', run: () => channel.pan?.disconnect() },
          { name: 'effect-input', run: () => channel.effectInput?.disconnect() }, { name: 'effect-dry', run: () => channel.effectDry?.disconnect() }
        ]);
        const released = releaseAudioResourceAfterRetirement(channel.resourceLease, native);
        return released?.then ? released.then(() => native) : native;
      };
      return effects && effects.state !== 'retired' ? effects.completion.then(finish) : finish();
    } }]);
    const settle = value => { if (value.outcome === 'complete' && this._channels.get(key) === channel) this._channels.delete(key); };
    if (receipt.state === 'retired') settle(receipt); else receipt.completion.then(settle);
    return receipt;
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
    if (this._channels.size >= 128) throw new RangeError('Audio channel retirement capacity reached.');
    const resourceLease = this._audioResources.reserve({ kind: 'channel-graph', owner, generation: this._generation, estimateBytes: 40960, consumerOwned: true });
    let gain;
    let sourceInput;
    let pan;
    let effectInput;
    let effectDry;
    let destination;
    try {
      gain = this._context.createGain(); sourceInput = this._context.createGain(); sourceInput.connect(gain);
      pan = this._context.createStereoPanner?.() || null;
      destination = this._workloadClass(owner) === 'cue' ? this._cueRouting?.getInput() : this._master;
      if (!destination) throw new Error('Cue input is unavailable.');
      effectInput = this._context.createGain(); effectDry = this._context.createGain(); effectDry.gain.value = 1;
      gain.connect(pan || effectInput); pan?.connect(effectInput); effectInput.connect(effectDry); effectDry.connect(destination);
    } catch (error) {
      const native = createProcgenRetirementScope().retire([
        { name: 'channel-source-input', run: () => sourceInput?.disconnect() }, { name: 'channel-gain', run: () => gain?.disconnect() }, { name: 'channel-pan', run: () => pan?.disconnect() },
        { name: 'effect-input', run: () => effectInput?.disconnect() }, { name: 'effect-dry', run: () => effectDry?.disconnect() }
      ]);
      try { releaseAudioResourceAfterRetirement(resourceLease, native); } catch (retirementError) { this._retirementFaults.add(owner); error.retirement = retirementError.retirement || native; }
      throw error;
    }
    channel = { owner, number, sourceInput, gain, pan, effectInput, effectDry, destination, effects: null, resourceLease, bendRange: 2, volume: 1, expression: 1, program: null,
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
    scheduleNativeHeldEnvelope(voice);
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

  _voiceFinished(voice) { return nativeVoiceFinished.call(this, voice); }

  _renderVoiceCount(voices = this._voices) { return nativeRenderVoiceCount.call(this, voices); }

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
    const incoming = { priority: finite(options.priority, 1), laneIndex: options.laneIndex ?? options.playback?.laneIndex ?? 0, owner: options.owner ?? null };
    const drop = reason => {
      this._voiceDrops += 1;
      this._observe('drop', { ...options.capture, type: 'noteOn', note, channel: number, owner: options.owner, ...incoming, reason });
      return false;
    };
    if (this._renderVoiceCount() >= this._maxScheduledVoices) return drop('scheduled-voice-cap');
    let resourceLease;
    try { resourceLease = this._audioResources.reserveNativeVoice(options.owner ?? null, this._generation); }
    catch { return drop('audio-resource-budget'); }
    let victim = null;
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
      const end = start + Math.min(this._maxNoteSeconds, profile.seconds || this._maxNoteSeconds);
      profile.release = Math.min(profile.release, end - start);
      const reservation = { start, end, releaseAt: end - profile.release };
      let admission = this._inspectVoiceInterval(options.owner, reservation);
      if (!admission.accepted) {
        victim = selectLocalAudioVoice([...this._voices].filter(value => !value.stolen && !value.requestRelease && !value.nativeNodesOwnedByBackend &&
          value.semanticKey == null && value.semanticEpoch == null &&
          value.oscillator && value.start <= start && value.releaseAt > start && (value.workloadClass || 'live') === this._workloadClass(options.owner)), incoming);
        if (victim) {
          const releaseAt = Math.max(victim.start, Math.min(Math.max(context.currentTime, start - RELEASE_SECONDS), victim.end - victim.release));
          admission = this._inspectVoiceInterval(options.owner, { ...reservation,
            overrides: new Map([[victim, { releaseAt, end: Math.min(victim.end, releaseAt + victim.release) }]]) });
        }
        if (!admission.accepted) { resourceLease.release(); return drop(admission.reason || 'local-voice-priority'); }
      }
      const noise = profile.noise && this._percussionNoise();
      oscillator = noise ? context.createBufferSource() : context.createOscillator();
      if (noise) { oscillator.buffer = noise; oscillator.loop = true; }
      gain = context.createGain();
      voice = { oscillator, gain, resourceLease, number, owner: options.owner ?? null, workloadClass: this._workloadClass(options.owner), note, start, id: ++this._voiceSequence, playback: options.playback, startMs: this._nowMs() + (start - context.currentTime) * 1000, end, released: false, captureMeta: this._captureMetadata(options.capture, options.owner ?? null),
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
      scheduleNativeHeldEnvelope(voice);
      oscillator.connect(gain);
      if (Number.isFinite(options.pan) && context.createStereoPanner) {
        voice.pan = context.createStereoPanner();
        voice.pan.pan.setValueAtTime(clamp(options.pan, -1, 1), start);
        gain.connect(voice.pan);
        voice.pan.connect(channel.sourceInput || channel.gain);
      } else {
        gain.connect(channel.sourceInput || channel.gain);
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

  _release(voice, time, force = false, reason = 'note-off') { return releaseNativeVoice.call(this, voice, time, force, reason); }

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

  _destroyVoice(voice, reason = 'source-ended') { return destroyNativeVoice.call(this, voice, reason); }

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
    const owns = value => (owner === undefined || value.owner === owner) && (number == null || value.number === number);
    const pending = this._previewPending.filter(entry => (owner === undefined || (entry.spec.owner ?? null) === owner) &&
      (number == null || clamp(Math.trunc(finite(entry.spec.channel, 1)), 1, 16) === number));
    const removed = new Set(pending);
    this._previewPending = this._previewPending.filter(entry => !removed.has(entry));
    return createProcgenRetirementScope().retire([
      ...(number == null ? [...this._instrumentBackends].filter(entry => owner === undefined || entry.owner === owner).map((entry, index) =>
        ({ name: `backend-stop-${index}`, run: () => entry.backend.onOwnerStop?.() })) : []),
      { name: 'preview-timer', run: () => { if (this._previewTimer != null) clearTimeout(this._previewTimer); this._previewTimer = null; } },
      ...pending.map((entry, index) => ({ name: `pending-note-${index}`, run: () => this._observe('cancelled',
        { ...entry.spec.capture, owner: entry.spec.owner, type: 'noteOn', reason: 'audition-stop' }) })),
      ...[...this._voices].filter(owns).map(voice => ({ name: `voice-${voice.id}`, run: () => this._destroyVoice(voice, 'panic-or-stop') })),
      ...[...this._channels.values()].filter(owns).map(channel => ({ name: `channel-state-${channel.number}`, run: () => {
        channel.effects?.panic();
        channel.gain.gain.cancelScheduledValues(0); channel.gain.gain.value = 1;
        channel.volume = 1; channel.expression = 1; channel.program = null; channel.bendRange = 2; channel.controls.clear();
        if (channel.pan) { channel.pan.pan.cancelScheduledValues(0); channel.pan.pan.value = 0; }
      } })),
      { name: 'remaining-preview', run: () => { if (this._previewPending.length && this._ready()) this._drainPreviewQueue(); } }
    ]);
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
