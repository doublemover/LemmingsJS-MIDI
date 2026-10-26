import { DISPLAY_PROTOCOL, DISPLAY_WIDTH, DISPLAY_VOICES, MAX_VOICES, PROTOCOL } from './worklet/OwnedSineProcessor.js';

const natural = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
const keyFor = (slot, token) => slot + ':' + token;
const identityKeys = ['worldId', 'generation', 'executionEpoch', 'contextEpoch', 'graphRevision', 'routeRevision'];
const validIdentity = value => value && text(value.worldId) && natural(value.generation) && text(value.executionEpoch) &&
  natural(value.contextEpoch) && natural(value.graphRevision) && natural(value.routeRevision);

// The host allocates bounded presentation objects only for active observers.
// Musical receipts and commands never wait for this latest-wins mailbox.
export function createAudioDisplayTelemetry({ owner, engineId = 'worklet-sine', getContext, getContextEpoch, getVoices, getRouteState = null, send, resources } = {}) {
  if (!['worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-seed-layers'].includes(engineId)) throw new TypeError('Unknown audio display source.');
  const sinePhase = engineId === 'worklet-sine';
  const observers = new Set(), routes = new Map(), latest = new Map();
  let contextStamp = null, resourceLease = null, tokens = null, sentTokens = null, sentInterval = 0, revision = 0, selected = 0, eligible = 0, stopped = false;
  const stats = { packets: 0, samples: 0, rejected: 0, stale: 0, observerErrors: 0, transportErrors: 0, droppedWindows: 0, identityUnavailable: 0 };
  const post = message => { try { if (send(message) !== false) return true; } catch { /* Display failure cannot fault the audio engine. */ } stats.transportErrors++; return false; };
  const matches = (observer, identity) => identityKeys.every(key => identity[key] === observer.identity[key]) &&
    (!observer.actorIds || observer.actorIds.has(identity.actorId)) && (!observer.voiceIds || observer.voiceIds.has(identity.voiceId));
  const setContext = value => {
    if (!value || !text(value.worldId) || !natural(value.graphRevision) || !natural(value.routeRevision)) throw new TypeError('Invalid audio display admission context.');
    contextStamp = Object.freeze({ worldId: value.worldId, graphRevision: value.graphRevision, routeRevision: value.routeRevision });
  };
  const admit = (voice, intent) => {
    if (!contextStamp || !natural(intent.actorId) || !text(intent.onsetId) || !text(voice.voiceId)) { stats.identityUnavailable++; return; }
    voice.displayIdentity = Object.freeze({ ...contextStamp, owner, generation: voice.semanticGeneration, executionEpoch: voice.semanticEpoch,
      contextEpoch: getContextEpoch(), actorId: intent.actorId, onsetId: intent.onsetId, voiceId: voice.voiceId,
      nodeId: engineId + '.voice-output', patchId: voice.patchId, patchRevision: voice.patchRevision });
    if (observers.size) routes.set(keyFor(voice.slot, voice.slotToken), { voice, identity: voice.displayIdentity, active: true });
  };
  const configure = (force = false) => {
    if (!tokens) return;
    tokens.fill(0); selected = 0; eligible = 0;
    if (observers.size) {
      for (const voice of getVoices()) if (voice.displayIdentity) routes.set(keyFor(voice.slot, voice.slotToken), { voice, identity: voice.displayIdentity, active: true });
      while (routes.size > 128) { const expired = [...routes].find(([, route]) => !route.active); if (!expired) break; routes.delete(expired[0]); }
      const candidates = [...routes.values()].filter(route => route.active && [...observers].some(observer => matches(observer, route.identity)))
        .sort((a, b) => a.identity.actorId - b.identity.actorId || (a.identity.voiceId < b.identity.voiceId ? -1 : a.identity.voiceId > b.identity.voiceId ? 1 : 0));
      eligible = candidates.length;
      for (const observer of observers) {
        let count = 0; observer.admitted.clear(); observer.eligible = candidates.filter(route => matches(observer, route.identity)).length;
        for (const route of candidates) if (matches(observer, route.identity)) {
          if (count++ >= observer.maxVoices) break;
          if (!tokens[route.voice.slot] && selected < DISPLAY_VOICES) { tokens[route.voice.slot] = route.voice.slotToken; selected++; }
          if (tokens[route.voice.slot] === route.voice.slotToken) observer.admitted.add(keyFor(route.voice.slot, route.voice.slotToken));
        }
      }
    }
    const rate = Math.max(4, ...[...observers].map(observer => observer.rateHz)), context = getContext();
    const intervalFrames = Math.ceil((context?.sampleRate || 48000) / rate);
    if (!force && intervalFrames === sentInterval && tokens.every((value, slot) => value === sentTokens[slot])) return;
    post({ type: 'display-config', protocol: PROTOCOL, displayProtocol: DISPLAY_PROTOCOL, revision: ++revision,
      intervalFrames, tokens }); sentTokens.set(tokens); sentInterval = intervalFrames;
  };
  const retire = voice => { const route = routes.get(keyFor(voice.slot, voice.slotToken)); if (route) route.active = false; configure(); };
  const observe = (listener, { identity, actorIds = null, voiceIds = null, maxVoices = 16, rateHz = 20 } = {}) => {
    if (stopped || !text(owner) || !getContext() || typeof listener !== 'function' || !validIdentity(identity) || identity.contextEpoch !== getContextEpoch() || observers.size >= 8 ||
        !natural(maxVoices) || maxVoices < 1 || maxVoices > DISPLAY_VOICES || !Number.isFinite(rateHz) || rateHz < 4 || rateHz > 30 ||
        actorIds != null && (!Array.isArray(actorIds) || actorIds.length > 64 || actorIds.some(id => !natural(id))) ||
        voiceIds != null && (!Array.isArray(voiceIds) || voiceIds.length > 64 || voiceIds.some(id => !text(id)))) throw new TypeError('Invalid audio display observation lease.');
    if (!tokens) {
      resourceLease = resources?.reserve({ kind: 'audio-display-host', owner, bytes: MAX_VOICES * 8, estimateBytes: 192 * 1024 }) || null;
      tokens = new Uint32Array(MAX_VOICES); sentTokens = new Uint32Array(MAX_VOICES); sentInterval = 0;
    }
    const observer = { listener, identity: Object.freeze(Object.fromEntries(identityKeys.map(key => [key, identity[key]]))),
      actorIds: actorIds ? new Set(actorIds) : null, voiceIds: voiceIds ? new Set(voiceIds) : null, maxVoices, rateHz,
      sinceFrame: Math.ceil((getContext()?.currentTime || 0) * (getContext()?.sampleRate || 48000)), last: new Map(), admitted: new Set(), eligible: 0 };
    observers.add(observer); configure(); let active = true;
    const release = () => {
      if (!active) return; active = false; observers.delete(observer); configure();
      if (!observers.size) { routes.clear(); latest.clear(); tokens = null; sentTokens = null; resourceLease?.release(); resourceLease = null; }
    };
    observer.release = release; return release;
  };
  const consume = packet => {
    const serial = packet?.sequence;
    try {
      if (!observers.size) return;
      if (packet.displayProtocol !== DISPLAY_PROTOCOL || packet.protocol !== PROTOCOL || !natural(serial) || serial < 1 || !natural(packet.count) || packet.count > DISPLAY_VOICES ||
          !(packet.data instanceof Float64Array) || packet.data.length !== DISPLAY_VOICES * DISPLAY_WIDTH || !natural(packet.droppedWindows)) { stats.rejected++; return; }
      stats.packets++; stats.droppedWindows = Math.max(stats.droppedWindows, packet.droppedWindows);
      const context = getContext(), now = Math.ceil(context.currentTime * context.sampleRate);
      let routeState = Object.freeze({ muted: null, evidenceClass: 'unknown', scope: 'pre-owner-bus', outputAudibility: 'unknown' });
      try {
        const observed = getRouteState?.();
        if (typeof observed?.muted === 'boolean' && observed.evidenceClass === 'owner-routing-state') routeState = Object.freeze({ muted: observed.muted,
          evidenceClass: 'owner-routing-state', scope: 'current-owner-and-master-route', observedAtFrame: now, outputAudibility: 'unknown' });
      } catch { /* Missing route evidence cannot become an unmuted assertion. */ }
      for (let index = 0; index < packet.count; index++) {
        const at = index * DISPLAY_WIDTH, data = packet.data, slot = data[at], token = data[at + 1], route = routes.get(keyFor(slot, token));
        if (!route || route.voice.epochToken !== data[at + 2] || route.identity.generation !== data[at + 3] || route.identity.contextEpoch !== getContextEpoch()) { stats.stale++; continue; }
        let valid = true; for (let n = 0; n < DISPLAY_WIDTH; n++) if (!Number.isFinite(data[at + n])) valid = false;
        const first = data[at + 4], last = data[at + 5], frames = data[at + 6], applied = data[at + 7], flags = data[at + 15];
        if (!valid || !natural(first) || !natural(last) || last <= first || !natural(frames) || frames < 1 || frames > last - first ||
            !natural(applied) || applied >= last || !natural(flags) || flags > 7 || data[at + 8] < 0 || data[at + 9] < 0 || sinePhase && data[at + 9] > 1 ||
            data[at + 8] > data[at + 9] + 1e-12 || last - first > context.sampleRate / 4 + 1) { stats.rejected++; continue; }
        if (data[at + 11] <= 0 || data[at + 11] >= context.sampleRate / 2 || data[at + 12] < 0 || data[at + 12] > 1 || Math.abs(data[at + 13]) > 1 || data[at + 10] < 0 || data[at + 10] > Math.PI * 2) { stats.rejected++; continue; }
        if (last < now - context.sampleRate / 2 || last > now + context.sampleRate / 2) { stats.stale++; continue; }
        const key = keyFor(slot, token), prior = latest.get(key);
        if (prior && serial <= prior.sequence) { stats.stale++; continue; }
        const quantity = (name, unit, value, evidenceClass) => Object.freeze({ name, unit, value, evidenceClass });
        const quantities = [quantity('rms', 'linear-amplitude', data[at + 8], 'measured'), quantity('peak', 'linear-amplitude', data[at + 9], 'measured'),
          quantity('amplitude-envelope', 'normalized', Math.min(1, data[at + 9]), 'measured'), quantity('frequency', 'Hz', data[at + 11], 'applied-parameter'),
          quantity('pressure', 'normalized', data[at + 12], 'applied-parameter'), quantity('pan', 'normalized-signed', data[at + 13], 'applied-parameter')];
        if (sinePhase && !(flags & 6)) quantities.push(quantity('oscillator-phase', 'radians', data[at + 10], 'kernel-state'));
        const sample = Object.freeze({ ...route.identity, scope: 'actorVoice', sequence: serial, appliedFrame: applied,
          effectiveFrame: last - 1, windowStartFrame: first, windowEndFrame: last, validUntilFrame: last + Math.ceil(context.sampleRate / 2),
          quantities: Object.freeze(quantities), processingState: Object.freeze({ bypassed: false, tail: !!(flags & 1), ended: !!(flags & 2), faulted: !!(flags & 4), pending: false, unsupported: false }),
          routeState, coverage: 'complete',
          selectionCoverage: Object.freeze({ eligible, selected, omitted: Math.max(0, eligible - selected), droppedWindows: stats.droppedWindows }),
          detector: Object.freeze({ tap: 'voice-pre-pan-pre-owner-bus', channels: route.voice.sourceChannels || 1,
            channelReduction: route.voice.sourceChannels === 2 ? 'mean-channel-power-and-max-peak' : 'mono-source', sampledFrames: frames, window: 'half-open-output-frames',
            normalization: 'unity-full-scale', envelope: sinePhase ? 'window-peak' : 'clamped-window-peak', responseDelayFrames: last - first, detectorDelayFrames: last - first }), acousticReceipt: false });
        latest.set(key, sample); while (latest.size > DISPLAY_VOICES) latest.delete(latest.keys().next().value); stats.samples++;
        for (const observer of observers) if (observers.has(observer) && observer.admitted.has(key) && matches(observer, route.identity) && last > observer.sinceFrame &&
            last - (observer.last.get(key) ?? -Infinity) >= context.sampleRate / observer.rateHz) {
          observer.last.set(key, last); while (observer.last.size > DISPLAY_VOICES) observer.last.delete(observer.last.keys().next().value);
          try { observer.listener(Object.freeze({ ...sample, selectionCoverage: Object.freeze({ eligible: observer.eligible, selected: observer.admitted.size, omitted: Math.max(0, observer.eligible - observer.admitted.size), droppedWindows: stats.droppedWindows }) })); } catch { stats.observerErrors++; }
        }
      }
    } finally { if (natural(serial) && serial > 0) post({ type: 'display-ack', protocol: PROTOCOL, sequence: serial }); }
  };
  const stop = () => { for (const observer of observers) observer.release(); routes.clear(); latest.clear(); };
  return Object.freeze({ setContext, admit, configure, retire, observe, consume, stop,
    inspect: () => Object.freeze([...latest.values()]),
    diagnostics: () => Object.freeze({ ...stats, observers: observers.size, routes: routes.size, selected, eligible, maxVoices: DISPLAY_VOICES,
      maxRateHz: 30, maximumInFlightPackets: 1, tap: 'voice-pre-pan-pre-owner-bus', outputAudibility: 'unknown' }),
    dispose: () => { stop(); stopped = true; contextStamp = null; } });
}
