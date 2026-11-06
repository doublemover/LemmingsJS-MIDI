import { readBrowserRuntimeCapabilities } from '../../runtime/BrowserDeploymentPolicy.js';
import { normalizeAudioRuntimeConfig, audioRuntimeContextOptions, audioRuntimeSinkMatches } from './AudioRuntimeConfig.js';
import { createAudioRuntimeObservation } from './AudioRuntimeObservation.js';
import { createAudioRuntimeTransition } from './AudioRuntimeTransition.js';
import { createAudioOutputWatch } from './AudioOutputWatch.js';
import { createLiveLaneSourceBuses } from './LiveLaneSourceBuses.js';
import { workloadVoiceCount, inspectVoiceInterval, inspectVoiceExtensions } from './AudioVoiceAdmission.js';
import { nativeVoiceFinished, nativeRenderVoiceCount, releaseNativeVoice, destroyNativeVoice } from './NativeVoiceLifetime.js';
import { createNativeOscillatorBackend } from './nativeOscillatorBackend.js';
import { createAudioObservationLeases } from './AudioObservationLeases.js';
import { createAudioResourceLeases, releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';
import { createProcgenRetirementScope, afterProcgenRetirement } from '../procgen/ProcgenRetirement.js';
import { getBrowserPerformanceLease } from './BrowserPerformanceLease.js';
import { createSoundMaterialProvider } from './SoundMaterialProvider.js';
import { createOwnedCueRouting } from './OwnedCueRouting.js';
import { createForegroundAuditionOwner } from './ForegroundAuditionOwner.js';
import { createAudioIntervalAdmission, audioIntervalStorageBytes } from './AudioIntervalAdmission.js';
import { createPreparedInstrumentPreview } from './PreparedInstrumentPreview.js';
import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';
const retirementState = receipt => receipt ? { state: receipt.state, outcome: receipt.outcome,
  failures: receipt.resources.filter(resource => ['failed', 'unknown'].includes(resource.status)).map(resource => ({ name: resource.name, status: resource.status, error: resource.error })) } : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const MAX_SCHEDULED_VOICES = 64;
const MAX_AUDIO_SESSIONS = 4;
const MAX_RENDER_VOICES = 64;
const MAX_RELEASE_TAILS = 32;
const MASTER_VOLUME_RAMP_SECONDS = 0.015;
const MAX_MASTER_VOLUME = 4;
// Unity correction for this profile's measured fixed Web Audio makeup gain, independent of voice count.
const MIX_MAKEUP_COMPENSATION = 0.647;
const MIX_LOOKAHEAD_SECONDS = 0.006;
let captureScopeSequence = 0;
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
    createMediaElement = tag => globalThis.document?.createElement(tag), mediaDevices = globalThis.navigator?.mediaDevices, permissions = globalThis.navigator?.permissions, performanceCoordinator, runtimeConfig = {} } = {}) {
    const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
    this._createContext = createAudioContext === undefined
      ? (AudioContextType ? options => new AudioContextType(options) : null)
      : createAudioContext;
    this._nowMs = nowMs || (() => globalThis.performance?.now?.() ?? Date.now());
    this._runtimeConfig = normalizeAudioRuntimeConfig(runtimeConfig);
    this._runtimeObservation = createAudioRuntimeObservation({ nowMs: this._nowMs });
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
    this._permissions = permissions; this._runtimeOutputWatch = null;
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
    this._instrumentBackends = new Set(); this._instrumentBackendSequence = 0;
    this._preparedPreviews = new Set(); this._preparedRootSession = null; this._lastPreparedPreview = null;
    this._voiceSequence = 0;
    this._onPlayback = onPlayback;
    this.capture = null;
    this._observers = createAudioObservationLeases();
    this._captureReleases = new Map();
    this._captureScope = 'audio-' + (++captureScopeSequence);
    this._audioResources = createAudioResourceLeases({ resourceBudget, ownerPrefix: this._captureScope });
    this._soundMaterialBudget = resourceBudget; this._soundMaterialProvider = null;
    this._graphResourceLease = null;
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
    this._onContextState = () => {
      if (this._disposed || !this._enabled || this._context?.state === 'running') return;
      this.stop();
      this._setStatus('interrupted', 'Browser audio was interrupted. Enable preview again.');
    };
    this.outputIdentity = this._createOutputIdentity();
    this._performanceCoordinator = performanceCoordinator === undefined ? getBrowserPerformanceLease({ resourceBudget }) : performanceCoordinator;
    this._performanceToken = null; this._performanceStopReceipt = null; this._performanceContextClosing = null; this._performanceDisposalStopReceipt = null; this._performanceReleaseCompletion = null; this._performanceRolesKey = null;
    this._performanceStops = new Set();
    this._performanceSource = this._performanceCoordinator?.register({ scope: this._captureScope, role: 'live',
      stop: (reason, receipt) => this._stopForPerformanceLease(reason, receipt) }) || null;
    this._performanceUnsubscribe = this._performanceCoordinator?.subscribe(() => { if (!this._disposed) this._setStatus(this._status, this._status === 'performance-busy' ? this._performanceMessage() : this._message); }) || null;
    this._runtimeBlocked = false; this._runtimeClosing = null; this._runtimeCleanupDepth = 0;
    this._runtimeTransition = createAudioRuntimeTransition({ getConfig: () => this._runtimeConfig, getContext: () => this._context,
      isRetired: () => this._disposed,
      quiesce: async () => {
        // Any native change attempt invalidates old clock calibration, even if rejected.
        this._contextEpoch++;
        const receipt = this._stopForPerformanceLease('audio-runtime-change'); await receipt.completion;
        if (receipt.outcome !== 'complete') return false;
        if (this._performanceSource) {
          this._performanceReleaseCompletion = this._performanceSource.release({ receipt });
          if (!await this._performanceReleaseCompletion) return false;
        }
        return true;
      }, retireContext: context => this._retireRuntimeContext(context),
      commit: config => { this._runtimeConfig = config; this._runtimeBlocked = false; this._contextEpoch++;
        this._setStatus('idle', 'Audio settings applied. Enable browser audio to continue.'); },
      chooseOutput: typeof mediaDevices?.selectAudioOutput === 'function' ? async () => {
        const selected = await mediaDevices.selectAudioOutput(); return selected.deviceId;
      } : undefined,
      onChange: () => { if (!this._disposed) this._setStatus(this._status, this._message); }
    });
    this._onRuntimeRouteChange = () => {
      if (this._disposed || this._runtimeTransition.state().pending) return;
      this._contextEpoch++; this.stop(); this._setStatus('interrupted', 'Audio output changed. Review the output and enable browser audio again.');
    };
    this._onRuntimeRouteError = () => {
      if (this._disposed) return;
      const phase = this._runtimeTransition.state().phase, ownedChange = phase === 'switching' || phase === 'closing';
      if (!ownedChange) this._runtimeTransition.invalidate();
      this._contextEpoch++; this.stop({ runtimeChange: ownedChange });
      this._setStatus('interrupted', 'Audio output is unavailable. Choose an available output and enable browser audio again.');
    };
  }

  _createOutputIdentity(owner = null) {
    return Object.freeze({ id: 'browser-audio' + (owner == null ? '' : ':' + owner), captureScope: this._captureScope + (owner == null ? '' : ':' + owner),
      name: 'Local instrument audio' + (owner == null ? '' : ' (' + owner + ')'), backend: 'semantic-local-instrument' });
  }

  _ownerTransferPending(owner) { return !!this._sessions.get(owner)?.audioOperation; }

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
      for (const entry of this._preparedPreviews) if (entry.owner === id && entry.player.state().phase === 'preparing') pendingNotes += entry.noteCount;
      return { ...state, preparedPreview: session.preparedPreview || null, owner: label, ownerId: id, sharedMix: true, activeVoices, pendingNotes, enabled: session.enabled && state.enabled && !this._retirementFaults.has(id),
        audioContinuation: session.audioOperation?.phase || 'idle', laneSources: this._laneSourceBuses.get(id)?.buses.diagnostics() || null, effectRetirement: retirementState(this._effectRetirements.get(id)?.scope.getReceipt()), retirement: retirementState(retirement.getReceipt()),
        status: session.disposed ? 'disposed' : this._retirementFaults.has(id) ? 'error' : session.starting ? 'unlocking' : session.enabled ? state.status : ['error', 'unsupported', 'interrupted'].includes(state.status) ? state.status : 'idle',
        message: session.disposed ? 'Local audio session is closed.' : session.enabled || session.starting ? state.message : 'Local audio session is off.' };
    };
    session.report = () => { this._syncPerformanceRoles(); for (const listener of session.listeners) { try { listener(getState()); } catch { /* Session observers do not own audio. */ } } this._reportCaptureProvenance(); };
    session.cancel = () => {
      session.audioOperation?.controller.abort(new Error('The audio owner stopped during continuation transfer.'));
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
    const instrumentSources = () => [...this._instrumentBackends].filter(entry => entry.owner === id).map(entry => ({ sourceId: entry.sourceId, backend: entry.backend }));
    const runContinuation = async (phase, options, execute) => {
      if (session.disposed || session.audioOperation || !this._ownerReady(id)) throw new Error('This audio owner is unavailable or already transferring a continuation.');
      const controller = new AbortController(), generation = session.generation, context = this._context;
      const operation = { phase, controller }; session.audioOperation = operation;
      const abort = () => controller.abort(options.signal.reason);
      options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
      const current = () => !session.disposed && generation === session.generation && context === this._context && session.audioOperation === operation && (!options.isCurrent || options.isCurrent());
      try { session.report(); return await execute({ context, signal: controller.signal, isCurrent: current }); }
      finally { options.signal?.removeEventListener('abort', abort); if (session.audioOperation === operation) session.audioOperation = null; session.report(); }
    };
    const detachAudioState = options => runContinuation('capturing', options, async operation => {
      const { captureOwnedAudioContinuation } = await import('./OwnedAudioContinuation.js');
      const registered = instrumentSources(), sources = registered.filter(row => typeof row.backend.detachSourceState === 'function'), excluded = registered.filter(row => !sources.includes(row)), allowed = new Set(registered.map(row => row.backend)), effects = this._channels.get(id + ':0')?.effects, rackState = effects?.state();
      if (rackState && (rackState.preparing || rackState.retiringGraphs || ['staged', 'armed', 'capturing'].includes(rackState.continuation?.phase))) throw new Error('Capture requires a stable rack after retained graph transitions have finished.');
      const assertCoverage = () => {
        operation.signal.throwIfAborted(); if (!operation.isCurrent() || operation.context.state !== 'running') throw new Error('The audio continuation owner changed.');
        if (excluded.some(row => row.backend.sourceCaptureStatus?.().quiescent !== true) || instrumentSources().some(row => !allowed.has(row.backend)) || [...this._preparedPreviews].some(entry => entry.owner === id) ||
            [...this._voices].some(voice => voice.owner === id && !sources.some(source => source.backend.ownsSourceVoice?.(voice)))) throw new Error('This owner has a native, preview or uncaptured source outside the owned DSP cone.');
      };
      assertCoverage();
      return captureOwnedAudioContinuation({ resourceBudget: this._soundMaterialBudget, ...options, ...operation, sources, rack: rackState?.activeGraph ? effects : null, assertCoverage });
    });
    const restoreAudioState = options => runContinuation('restoring', options, async operation => {
      if (workloadClass !== 'cue' && options.route !== 'owner-live') throw new Error('Use the isolated cue owner for scrub restoration, or explicitly select owner-live routing.');
      const { restoreOwnedAudioContinuation } = await import('./OwnedAudioContinuation.js');
      const registered = instrumentSources(), destinations = registered.filter(row => typeof row.backend.restoreSourceState === 'function'), selected = options.sources;
      if (registered.some(row => !destinations.includes(row) && row.backend.sourceCaptureStatus?.().quiescent !== true)) throw new Error('The restore owner has a native or unsupported source that is not quiescent.');
      if (!Array.isArray(selected) || selected.length !== destinations.length || new Set(selected.map(row => row.backend)).size !== destinations.length ||
          destinations.some(row => !selected.some(input => input.backend === row.backend)) || [...this._voices].some(voice => voice.owner === id)) throw new Error('Restoration requires the complete fresh prepared source inventory for this owner.');
      return restoreOwnedAudioContinuation({ ...options, ...operation, stageRack: (continuation, rackState, stageOptions) =>
        session.api.prepareEffectGraph(continuation.definition(), { ...stageOptions, continuation, rackState }) });
    });
    session.api = {
      outputIdentity: this._createOutputIdentity(id), getState, enable, stop, panic: stop, instrumentSources,
      detachAudioState: (options = {}) => detachAudioState(options), restoreAudioState: (options = {}) => restoreAudioState(options),
      prepareAudioContinuation: async options => { const { prepareOwnedAudioContinuation } = await import('./OwnedAudioContinuation.js'); return prepareOwnedAudioContinuation({ resourceBudget: this._soundMaterialBudget, ...options }); },
      getAudioContext: () => this.getAudioContext(), getSoundMaterialProvider: () => this.getSoundMaterialProvider(),
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
        if (session.disposed || !this._ownerReady(id) || session.audioOperation && !options.continuation) throw new Error('Enable an available local audio owner before preparing its effect rack.');
        const { createOwnerEffectGraphHost } = await import('./OwnerEffectGraphHost.js');
        if (session.disposed || generation !== session.generation || context !== this._context) throw new Error('Effect owner changed during preparation.');
        const channel = this._channel(0, id);
        if (channel.effects && (channel.effects.state().generation !== generation || options.continuation && ['detached', 'failed'].includes(channel.effects.state().continuation?.phase))) {
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
      getEffectLatencyState: () => this._channels.get(id + ':0')?.effects?.latencyState() || Object.freeze({ latencyFrames: session.disposed ? null : 0, routes: 0, unresolved: session.disposed }),
      inspectEffectGraph: ({ requestHealth = false } = {}) => { const effects = this._channels.get(id + ':0')?.effects; if (requestHealth) effects?.requestInspection(); return effects?.state() || null; },
      preview: (notes, options) => { if (session.audioOperation) throw new Error('This owner is transferring an audio continuation.'); return this.preview(notes, { ...options, owner: id }); },
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
    return Object.freeze({ status: this._status, message: this._message, enabled: this._ready(), performanceLease: this._performanceCoordinator?.state() || null,
      contextState: this._context?.state || 'not-created', contextEpoch: this._contextEpoch, activeVoices: this._voices.size,
      pendingNotes: [...this._preparedPreviews].reduce((total, entry) => total + (entry.player.state().phase === 'preparing' ? entry.noteCount : 0), 0), masterVolume: this._masterVolume });
  }

  getState() {
    return {
      status: this._status,
      message: this._message,
      enabled: this._ready(), performanceLease: this._performanceCoordinator?.state() || null,
      contextEpoch: this._contextEpoch, contextState: this._context?.state || 'not-created',
      audioRuntime: this.getAudioRuntimeObservation(), deploymentCapabilities: readBrowserRuntimeCapabilities(globalThis, this._context),
      audioRuntimeTransition: this._runtimeTransition?.state() || null,
      resourceAccounting: this._audioResources.diagnostics(),
      retirement: retirementState(this._retirement.getReceipt()), retiredVoices: this._retiredVoices.size, unclosedContext: !!this._retiringContext,
      activeVoices: this._voices.size, sharedMix: this._sessions.size > 0, sessionCount: this._sessions.size,
      preparedPreview: this._lastPreparedPreview, preparedPreviews: this._preparedPreviews.size,
      instrumentBackends: this._instrumentBackends.size, maxInstrumentBackends: this._maxInstrumentBackends,
      maxVoices: this._maxVoices, maxScheduledVoices: this._maxScheduledVoices,
      workload: { liveCostUnits: this._maxVoices, cueCostUnits: this._maxCueCostUnits, aggregateCostUnits: this._maxVoices + this._maxCueCostUnits, liveVoices: this._maxVoices, cueVoices: this._maxCueVoices, aggregateVoices: this._maxVoices + this._maxCueVoices,
        liveSourceReservations: this._maxLiveScheduledVoices, cueSourceReservations: this._maxCueScheduledVoices,
        cueCanStealLive: false }, monitorRoute: this.getMonitorRouteState(),
      audition: this.getAuditionState(),
      voiceSteals: this._voiceSteals, voiceDrops: this._voiceDrops,
      mixCompression: !!this._compressor, mixLatencyMs: this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0, mixMakeupCompensation: this._compressor ? MIX_MAKEUP_COMPENSATION : 1, mixReductionDb: finite(this._compressor?.reduction, 0),
      pendingNotes: [...this._preparedPreviews].reduce((total, entry) => total + (entry.player.state().phase === 'preparing' ? entry.noteCount : 0), 0),
      masterVolume: this._masterVolume
    };
  }

  getAudioContext() { return this._context; }

  getAudioRuntimeObservation() { return this._runtimeObservation.read(this._context, this._contextEpoch, this._runtimeConfig); }
  resetAudioLatencyStatistics() { return this._runtimeObservation.resetLatency(); }
  getAudioRuntimeConfig() { return this._runtimeConfig; }
  _hasConfiguredAudioOutput() {
    if (this._runtimeConfig.sinkPreference && this._runtimeOutputWatch?.state().explicitPermissionRevoked) {
      this.stop(); this._setStatus('interrupted', 'Main output permission was revoked. Choose an available output or use the default before enabling audio.'); return false;
    }
    let sink; try { sink = this._context?.sinkId; } catch { /* Older/denied APIs keep an unknown observation. */ }
    const match = audioRuntimeSinkMatches(sink, this._runtimeConfig.sinkPreference);
    if (match !== false && (!this._runtimeConfig.sinkPreference || match === true)) return true;
    this.stop(); this._setStatus('interrupted', 'Confirm an available main audio output before enabling browser audio.'); return false;
  }
  configureAudioRuntime(config) { return this._runtimeTransition.request(config); }
  chooseAudioOutput() { return this._runtimeTransition.choose(); }
  getAudioRuntimeSettingsState() {
    return Object.freeze({ observation: this.getAudioRuntimeObservation(), transition: this._runtimeTransition.state(),
      chooserAvailable: typeof this._mediaDevices?.selectAudioOutput === 'function', masterLookaheadMs: this._context ? this._compressor ? MIX_LOOKAHEAD_SECONDS * 1000 : 0 : null,
      outputWatch: this._runtimeOutputWatch?.state() || null });
  }

  _closeAudioContext(context) {
    if (!context || context.state === 'closed') return Promise.resolve();
    if (this._runtimeClosing?.context === context) return this._runtimeClosing.promise;
    const promise = Promise.resolve().then(() => context.close()).then(() => {
      if (context.state !== 'closed') throw new Error('Audio context closure is unconfirmed.');
    });
    this._runtimeClosing = { context, promise };
    // Failed closure stays owned and can only be retried by another explicit request.
    const clear = () => { if (this._runtimeClosing?.promise === promise) this._runtimeClosing = null; };
    promise.then(clear, clear);
    return promise;
  }

  async _retireRuntimeContext(context) {
    let closing;
    try {
      closing = this._performanceContextClosing = this._closeAudioContext(context);
      await closing;
      if (this._disposed || context !== this._context) return false;
      const receipt = this._replaceClosedContext({ runtimeChange: true }); await receipt.completion;
      this._runtimeBlocked = receipt.outcome !== 'complete'; return !this._runtimeBlocked;
    } catch { if (this._performanceContextClosing === closing) this._performanceContextClosing = null; this._runtimeBlocked = true; return false; }
  }

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
    this._syncPerformanceRoles();
    try { tap.connect(node); }
    catch (error) {
      try { tap.disconnect(node); this._pcmCaptureTaps.delete(entry); this._syncPerformanceRoles(); } catch { /* An uncertain native connection keeps its tap slot. */ }
      throw error;
    }
    return Object.freeze({ release: () => {
      const receipt = retirement.retire([{ name: 'master-capture-tap', run: () => { tap.disconnect(node); this._pcmCaptureTaps.delete(entry); this._syncPerformanceRoles(); } }]);
      if (receipt.outcome !== 'complete') throw Object.assign(new Error('Master capture tap retirement is unresolved.'), { retirement: receipt });
      return true;
    } });
  }

  _registerInstrumentBackend(backend, owner) {
    if (this._disposed || this._sessions.get(owner)?.audioOperation || this._instrumentBackends.size >= this._maxInstrumentBackends || !Number.isSafeInteger(this._instrumentBackendSequence + 1)) { backend.dispose(); throw new RangeError('Local audio backend limit reached.'); }
    let metadata;
    try { metadata = this._audioResources.reserve({ kind: 'instrument-backend-host', owner, generation: this._generation, estimateBytes: 4096, consumerOwned: true }); }
    catch (error) { backend.dispose(); throw error; }
    const entry = { owner, sourceId: 'source-' + (++this._instrumentBackendSequence), backend: null };
    const retirement = createProcgenRetirementScope();
    entry.backend = Object.freeze({ ...backend, sourceId: entry.sourceId, dispose: () => {
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
    this._syncPerformanceRoles();
    this._reportCaptureProvenance();
    for (const listener of this._listeners) {
      try { listener(this.getState()); } catch { /* UI callbacks must not break audio cleanup. */ }
    }
    for (const session of this._sessions.values()) session.report();
  }

  _syncPerformanceRoles() {
    if (!this._performanceSource) return;
    const roles = new Set();
    if (this._defaultEnabled) roles.add('live');
    for (const session of this._sessions.values()) if (!session.disposed && session.enabled) roles.add(session.workloadClass);
    if (this._pcmCaptureTaps.size) roles.add('capture');
    const values = [...roles].sort(), key = values.join(':');
    if (key === this._performanceRolesKey) return;
    this._performanceRolesKey = key; this._performanceSource.setRoles(values);
  }

  async enable(owner = null, { takeOver = false } = {}) {
    if (this._stopping || this._runtimeBlocked || this._runtimeTransition.isPending()) return false;
    if (this._performanceStopReceipt?.state === 'retired' && this._performanceStopReceipt.outcome !== 'complete') return false;
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
          context = this._createContext(audioRuntimeContextOptions(this._runtimeConfig));
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
          context.addEventListener?.('sinkchange', this._onRuntimeRouteChange);
          context.addEventListener?.('error', this._onRuntimeRouteError);
          this._context = context;
          this._contextEpoch++;
          this._master = master;
          this._limiter = limiter;
          this._compressor = compressor;
          this._compressorOutput = compressorOutput;
          this._graphResourceLease = resourceLease;
          this._runtimeOutputWatch = createAudioOutputWatch({ mediaDevices: this._mediaDevices, permissions: this._permissions, watchPermission: typeof context.setSinkId === 'function',
            onChange: reason => {
              if (this._disposed || this._context !== context) return;
              // Speaker permission concerns non-default devices. A grant does
              // not confirm any particular selected device or the default route.
              if (reason === 'speaker-permission-revoked' && !this._runtimeConfig.sinkPreference && this._runtimeTransition.state().phase !== 'selecting') return;
              const choosing = reason === 'devices-changed' && this._runtimeTransition.state().phase === 'selecting';
              if (!choosing) this._runtimeTransition.invalidate();
              this._contextEpoch++; this.stop({ runtimeChange: choosing });
              this._setStatus('interrupted', reason === 'speaker-permission-revoked' ? 'Main output permission changed. Review the output and enable browser audio again.' : 'Device availability changed. Review the main output and enable browser audio again.');
            } });
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
      if (!this._hasConfiguredAudioOutput()) return false;
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
      if (this._performanceSource) {
        const controller = new AbortController(), cancel = () => controller.abort(); this._pendingEnables.add(cancel); this._sessions.get(owner)?.pending.add(cancel);
        try {
          if (this._performanceReleaseCompletion && !await this._performanceReleaseCompletion) return false;
          if (controller.signal.aborted || this._disposed || generation !== this._generation) return false;
          const token = await this._performanceSource.acquire({ signal: controller.signal, takeOver });
          if (!token || this._disposed || generation !== this._generation) {
            if (!this._disposed && generation === this._generation) this._setStatus('performance-busy', this._performanceMessage());
            return false;
          }
          this._performanceToken = token;
        } finally { this._pendingEnables.delete(cancel); this._sessions.get(owner)?.pending.delete(cancel); }
      }
      if (context.state === 'suspended' && this._performanceSource) await context.resume();
      if (this._disposed || generation !== this._generation) return false;
      if (context.state !== 'running') throw new Error('Audio context is not running.');
      if (!this._hasConfiguredAudioOutput()) return false;
      if (!this._enabled) this._setMixEnabled(true);
      this._enabled = true;
      if (owner == null) this._defaultEnabled = true;
      this._setStatus('ready', this._performanceCoordinator?.state().coordination === 'uncoordinated'
        ? 'Browser preview is on without tab coordination. Another tab may also be active.' : 'Browser preview is on. No MIDI is sent.');
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

  _replaceClosedContext({ runtimeChange = false } = {}) {
    if (this._context?.state !== 'closed') return;
    const context = this._context;
    let acknowledgment = null;
    this._lastClosedContextRetirement = createProcgenRetirementScope().retire([
      { name: 'stop', run: () => this.stop({ runtimeChange }) },
      { name: 'cue-routing', run: () => this._cueRouting?.dispose() },
      ...[...this._laneSourceBuses.keys()].map(owner => ({ name: 'lane-sources-' + owner, run: () => this._retireLaneSources(owner) })),
      { name: 'context-listener', run: () => context.removeEventListener?.('statechange', this._onContextState) },
      { name: 'output-availability-watch', run: () => this._runtimeOutputWatch?.dispose() },
      { name: 'context-route-listeners', run: () => { context.removeEventListener?.('sinkchange', this._onRuntimeRouteChange); context.removeEventListener?.('error', this._onRuntimeRouteError); } },
      ...[...this._channels].map(([key, channel]) => ({ name: 'channel-' + key, run: () => this._retireChannel(key, channel) })),
      ...['_master', '_limiter', '_compressor', '_compressorOutput', '_captureAnalyser'].map(field => ({ name: field, run: () => this[field]?.disconnect() })),
      { name: 'graph-reservation', run: () => this._graphResourceLease?.release() },
      { name: 'closed-context-acknowledgment', run: () => { acknowledgment = this._reconcileClosedContext(context); return acknowledgment; } },
      { name: 'context-references', run: () => {
        this._channels.clear(); this._master = null; this._limiter = null; this._compressor = null; this._compressorOutput = null;
        this._captureAnalyser = null; this._captureSamples = null; this._context = null; this._runtimeOutputWatch = null; this._graphResourceLease = null; this._cueRouting = null; this._intervalAdmission = null;
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

  _performanceMessage() {
    const state = this._performanceCoordinator?.state();
    if (['handoff-channel-unavailable', 'old-owner-stop-unconfirmed'].includes(state?.reason) || state?.otherOwner?.status === 'blocked') return 'The other tab could not confirm output shutdown. Stop or close it, then activate here.';
    return (state?.otherOwner?.clientId ? 'Tab ' + state.otherOwner.clientId.slice(-6) : 'Another tab') + ' owns browser performance output. Stop it or explicitly take over.';
  }

  _stopForPerformanceLease(_reason, priorStop = null) {
    if (this._performanceStopScope) return this._performanceStopScope.getReceipt();
    const stopsPerformance = ['cooperative-takeover', 'page-suspended', 'page-frozen', 'bfcache-revalidation', 'performance-owner-disposed', 'audio-runtime-change'].includes(_reason);
    const prior = this._performanceStopReceipt && (this._performanceStopReceipt.state !== 'retired' || this._performanceStopReceipt.outcome !== 'complete') ? this._performanceStopReceipt : null;
    if (prior && !stopsPerformance) return prior;
    const context = this._context || this._retiringContext;
    const prerequisite = prior || priorStop || (this._disposed ? this._performanceDisposalStopReceipt ||= this.stop({ performanceStop: true }) : this.stop({ performanceStop: true, runtimeChange: _reason === 'audio-runtime-change' }));
    const scope = createProcgenRetirementScope(); this._performanceStopScope = scope;
    try { return this._performanceStopReceipt = scope.retire([
      { name: 'owned-audio-stop', run: () => prerequisite },
      ...(stopsPerformance
        ? [...this._performanceStops].map((stop, index) => ({ name: 'performance-stop-' + index, run: () => {
          // Nested synchronous controller stops belong to this cleanup. User events
          // after an await still revoke the pending native configuration normally.
          if (_reason === 'audio-runtime-change') this._runtimeCleanupDepth++;
          try { return stop(_reason); } finally { if (_reason === 'audio-runtime-change') this._runtimeCleanupDepth--; }
        } })) : []),
      { name: 'context-stop-frontier', run: () => afterProcgenRetirement([prerequisite], async () => {
        if (this._pcmCaptureTaps.size) throw new Error('Master capture retirement is unconfirmed.');
        if (this._performanceContextClosing) await this._performanceContextClosing;
        if (!context || context.state === 'closed' || context.state === 'suspended') return;
        if (typeof context.suspend !== 'function') throw new Error('Audio suspension is not acknowledged.');
        try { await context.suspend(); } catch (error) { if (this._performanceContextClosing) await this._performanceContextClosing; if (context.state !== 'closed') throw error; }
        if (!['closed', 'suspended'].includes(context.state)) throw new Error('Audio suspension is not acknowledged.');
      }) }
    ]); } finally { this._performanceStopScope = null; }
  }

  takeOverPerformance() { return this.enable(null, { takeOver: true }); }
  setPerformanceDocumentIdentity(value) { this._performanceSource?.setDocumentIdentity(value); }
  canAdmitPerformanceOutput(cleanup = false) { return (!this._disposed || cleanup) && (this._performanceSource
    ? this._performanceSource.isCurrent(this._performanceToken) || cleanup && this._performanceSource.canRelease(this._performanceToken) : this._ready()); }
  createPerformanceOutputAdmission() {
    const token = this._performanceToken, generation = this._generation;
    return cleanup => (!this._disposed && generation === this._generation || cleanup) && (this._performanceSource
      ? this._performanceSource.isCurrent(token) || cleanup && this._performanceSource.canRelease(token) : this._ready());
  }
  registerPerformanceStop(stop) {
    if (this._disposed || typeof stop !== 'function' || this._performanceStops.size === 8) throw new Error('Performance stop registration is unavailable.');
    this._performanceStops.add(stop); return () => this._performanceStops.delete(stop);
  }

  stop({ performanceStop = false, runtimeChange = false } = {}) {
    if (this._stopping) return this._stopScope.getReceipt();
    if (!runtimeChange && !this._runtimeCleanupDepth) this._runtimeTransition?.invalidate();
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
    ]); } finally {
      this._stopping = false;
      if (!performanceStop && this._performanceSource) this._performanceReleaseCompletion = this._performanceSource.release({ receipt: this._stopScope.getReceipt() });
    }
  }

  panic() { this.stop(); }

  dispose() {
    if (this._retirement.getReceipt()) return this._retirement.getReceipt().completion;
    const context = this._context;
    const receipt = this._retirement.retire([
      { name: 'invalidate-audio', run: () => { this._disposed = true; } },
      ...[...this._sessions.values()].map(session => ({ name: `session-${session.name}`, run: () => session.api.dispose() })),
      ...[...this._instrumentBackends].map((entry, index) => ({ name: `backend-${index}`, run: () => entry.backend.dispose() })),
      { name: 'stop', run: () => this._performanceDisposalStopReceipt ||= this.stop({ performanceStop: true }) },
      { name: 'cue-routing', run: () => this._cueRouting?.dispose() },
      ...[...this._laneSourceBuses.keys()].map(owner => ({ name: 'lane-sources-' + owner, run: () => this._retireLaneSources(owner) })),
      { name: 'foreground-auditions', run: () => this._foregroundAuditions.dispose() },
      { name: 'sound-material', run: () => this._soundMaterialProvider?.dispose() },
      { name: 'context-listener', run: () => context?.removeEventListener?.('statechange', this._onContextState) },
      { name: 'output-availability-watch', run: () => this._runtimeOutputWatch?.dispose() },
      ...[...this._channels].map(([key, channel]) => ({ name: `channel-${key}`, run: () => this._retireChannel(key, channel) })),
      ...['_master', '_limiter', '_compressor', '_compressorOutput', '_captureAnalyser'].map(field => ({ name: field, run: () => { this[field]?.disconnect(); this[field] = null; } })),
      { name: 'buffers', run: () => { this._captureSamples = null; this._intervalAdmission = null; } },
      { name: 'resource-reservations', run: () => this._audioResources.dispose() },
      { name: 'runtime-observation', run: () => this._runtimeObservation.dispose() },
      { name: 'runtime-transition', run: () => this._runtimeTransition.dispose() },
      { name: 'context-route-listeners', run: () => { context?.removeEventListener?.('sinkchange', this._onRuntimeRouteChange); context?.removeEventListener?.('error', this._onRuntimeRouteError); } },
      { name: 'observers', run: () => this._observers.clear() },
      { name: 'context', run: () => {
        this._context = null; this._retiringContext = context;
        return this._performanceContextClosing = this._closeAudioContext(context).then(() => {
          this._retiringContext = null;
          if (context?.state === 'closed') return this._reconcileClosedContext(context);
        });
      } },
      { name: 'performance-ownership', run: async () => {
        if (this._performanceSource && !await this._performanceSource.dispose({ receipt: this._performanceDisposalStopReceipt })) throw new Error('Performance ownership retirement is unresolved.');
      } },
      { name: 'terminal-state', run: () => {
        this._setStatus('disposed', 'Browser preview is closed.'); this._listeners.clear(); this._captureProvenanceListeners.clear();
        for (const session of this._sessions.values()) session.listeners.clear();
        this._sessions.clear(); this._captureReleases.clear(); this._performanceStops.clear(); this.capture = null;
      } }
    ]);
    this._performanceUnsubscribe?.(); this._performanceUnsubscribe = null;
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
    const output = session?.api.outputIdentity || this.outputIdentity;
    if (session) fields = { captureScope: output.captureScope, ...fields };
    return this._observers.emit(stage, { captureScope: this._captureScope, ...fields,
      backend: 'local-synth', outputId: output.id, outputScope: output.captureScope });
  }

  async _previewPreparedInstruments(notes, { replace = true, owner = null } = {}) {
    if (this._disposed) return false;
    if (owner == null) { this._preparedRootSession ||= this.createSession('prepared-instrument-preview'); return this._preparedRootSession.preview(notes, { replace }); }
    const session = this._sessions.get(owner); if (!session || session.disposed) return false;
    if (replace) session.api.stop();
    if (this._preparedPreviews.size >= 8 || [...this._preparedPreviews].some(entry => entry.player.state().phase === 'retirement-unknown')) { this._setStatus('error', 'Finish or retire earlier prepared previews before starting another.'); return false; }
    const generation = session.generation, graphGeneration = this._generation, entry = { owner, player: null, noteCount: notes.length };
    const current = () => !this._disposed && !session.disposed && generation === session.generation && graphGeneration === this._generation;
    entry.player = createPreparedInstrumentPreview({ session: session.api, getContext: () => this._context, getMaterialProvider: () => this.getSoundMaterialProvider(), maxSeconds: this._maxNoteSeconds, current,
      onReceipt: receipt => { this._lastPreparedPreview = receipt; session.preparedPreview = receipt; if (receipt.phase === 'retired') this._preparedPreviews.delete(entry); this._observe('prepared-instrument-preview', { ...receipt, owner }); if (!receipt.voiceId) session.report(); } });
    this._preparedPreviews.add(entry);
    try { return await entry.player.play(notes); }
    catch (error) { const receipt = entry.player.dispose(); await receipt.completion; if (current()) this._setStatus('error', String(error?.message || 'The selected local instrument could not be prepared.').slice(0, 512)); return false; }
  }

  /** Every local phrase names its complete prepared instrument; MIDI encoding belongs to external outputs. */
  async preview(notes, { replace = true, durationMs = 220, stepMs = 160, owner = null } = {}) {
    if (this._disposed) return false;
    const requested = Array.isArray(notes) ? notes : [notes]; if (!requested.length) return false;
    if (requested.some(note => !note || typeof note !== 'object' || !note.instrumentRef)) { this._setStatus('error', 'Choose a local instrument or use native defaults before testing this sound.'); return false; }
    return this._previewPreparedInstruments(requested.map((note, index) => ({ ...note, durationMs: note.durationMs ?? durationMs, offsetMs: note.offsetMs ?? index * stepMs })), { replace, owner });
  }

  _ready() { return !this._disposed && !this._runtimeBlocked && this._enabled && this._context?.state === 'running' &&
    (!this._performanceSource || this._performanceSource.isCurrent(this._performanceToken)); }

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
    channel = { owner, number, sourceInput, gain, pan, effectInput, effectDry, destination, effects: null, resourceLease };
    this._channels.set(key, channel);
    return channel;
  }

  _voiceFinished(voice) { return nativeVoiceFinished.call(this, voice); }

  _renderVoiceCount(voices = this._voices) { return nativeRenderVoiceCount.call(this, voices); }

  _release(voice, time, force = false, reason = 'note-off') { return releaseNativeVoice.call(this, voice, time, force, reason); }

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
    return createProcgenRetirementScope().retire([
      ...(number == null ? [...this._preparedPreviews].filter(entry => owner === undefined || entry.owner === owner).map((entry, index) => ({ name: 'prepared-preview-' + index, run: () => entry.player.dispose() })) : []),
      ...(number == null ? [...this._instrumentBackends].filter(entry => owner === undefined || entry.owner === owner).map((entry, index) => ({ name: 'backend-stop-' + index, run: () => entry.backend.onOwnerStop?.() })) : []),
      ...[...this._voices].filter(owns).map(voice => ({ name: 'voice-' + voice.id, run: () => this._destroyVoice(voice, 'panic-or-stop') })),
      ...[...this._channels.values()].filter(owns).map(channel => ({ name: 'mix-bus-' + channel.number, run: () => {
        channel.effects?.panic(); channel.gain.gain.cancelScheduledValues(0); channel.gain.gain.value = 1;
        if (channel.pan) { channel.pan.pan.cancelScheduledValues(0); channel.pan.pan.value = 0; }
      } }))
    ]);
  }

}

const createBrowserNotePreview = options => new BrowserNotePreview(options);

export { BrowserNotePreview, createBrowserNotePreview };
