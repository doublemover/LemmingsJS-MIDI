import { normalizeActorEffectVisualProfile } from './ActorEffectVisualProfile.js';

const MAX_ACTORS = 256, MAX_SOURCES = 12, MAX_TRAILS = 3, MAILBOX_BYTES = 65536;
const TARGET_CHANNELS = Object.freeze(['x', 'y', 'scale', 'inner', 'outer']);
const EMPTY = Object.freeze({ state: 'unknown', x: 0, y: 0, scale: 1, inner: 0, outer: 0, trails: Object.freeze([]), sources: Object.freeze([]) });
const string = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
const natural = value => Number.isSafeInteger(value) && value >= 0;
const epochId = value => natural(value) || string(value);
const keyFor = sample => JSON.stringify([sample.effectId, sample.quantity, sample.voiceId, sample.onsetId, sample.tapId ?? null]);
const shape = (value, curve) => Math.sign(value) * (curve === 'square' ? value * value : curve === 'sqrt' ? Math.sqrt(Math.abs(value)) : Math.abs(value));

// A renderer-side admission boundary for a future AudioDisplaySample adapter.
// It does not derive actor measurements from a shared mix or create a clock.
class ProcgenActorEffectDisplay {
  constructor({ maxActors = MAX_ACTORS, budget = null, onChange = null, motionPolicy = null } = {}) {
    this.maxActors = Math.max(1, Math.min(MAX_ACTORS, Math.trunc(maxActors) || MAX_ACTORS)); this.budget = budget; this.onChange = onChange;
    this.motionPolicy = motionPolicy;
    this.mailboxes = new Map(); this.actorProfiles = new Map(); this.patchProfiles = new Map(); this.profile = normalizeActorEffectVisualProfile({ version: 1 });
    this.profileToken = {}; this.profileEstimatedBytes = 0;
    this.epoch = null; this.revision = 0; this.skipped = 0; this.rejected = 0; this.retired = false; this.aggregateSamples = 0; this.visible = true; this.subscription = null; this.inspectedActorId = null;
  }
  setEpoch(epoch) {
    if (this.retired) return false;
    if (!epoch || !string(epoch.worldId) || !natural(epoch.generation) || !epochId(epoch.executionEpoch) || !natural(epoch.graphRevision) || !natural(epoch.routeRevision)) throw new TypeError('A complete display execution epoch is required.');
    const next = Object.freeze({ worldId: epoch.worldId, generation: epoch.generation, executionEpoch: epoch.executionEpoch, graphRevision: epoch.graphRevision, routeRevision: epoch.routeRevision, contextEpoch: epochId(epoch.contextEpoch) ? epoch.contextEpoch : null, owner: string(epoch.owner) ? epoch.owner : null });
    if (this.epoch && Object.keys(next).every(key => next[key] === this.epoch[key])) return;
    this.subscription?.(); this.subscription = null;
    this.clear({ profiles: !this.epoch || this.epoch.worldId !== next.worldId || this.epoch.generation !== next.generation }); this.epoch = next; this._changed();
  }
  invalidateEpoch() { this.subscription?.(); this.subscription = null; this.clear(); this.epoch = null; this._changed(); }
  _changed() { this.revision++; try { this.onChange?.(); } catch { /* Display listeners cannot change audio admission. */ } }
  attachSubscription(release) {
    this.subscription?.(); this.subscription = null;
    if (typeof release !== 'function') return false;
    if (this.retired || !this.visible) { release(); return false; }
    let active = true; this.subscription = () => { if (!active) return; active = false; try { release(); } catch { this.rejected++; } }; return true;
  }
  setVisible(visible) {
    if (this.retired || this.visible === !!visible) return; this.visible = !!visible;
    if (!this.visible) { this.subscription?.(); this.subscription = null; this.clear({ profiles: false }); } this._changed();
  }
  _shrinkProfiles() { if (this.profileEstimatedBytes) { try { this._reserveProfiles(); } catch { /* A conservative older reservation still covers a smaller profile set. */ } } }
  setInspectedActor(actorId) {
    if (actorId != null && !natural(actorId)) throw new TypeError('Invalid inspected actor identity.');
    if (this.retired || actorId === this.inspectedActorId) return; this.inspectedActorId = actorId; this._changed();
  }
  _reserveProfiles(actorCount = this.actorProfiles.size, patchCount = this.patchProfiles.size) {
    const bytes = 4096 * (1 + actorCount + patchCount); this.budget?.retain(this.profileToken, bytes, 'effect-profile'); this.profileEstimatedBytes = bytes;
  }
  setProfile(profile, { actorId = null, patchId = null } = {}) {
    if (this.retired) return false;
    const normalized = normalizeActorEffectVisualProfile(profile);
    if (actorId != null) { if (!natural(actorId) || this.actorProfiles.size >= MAX_ACTORS && !this.actorProfiles.has(actorId)) return false; try { this._reserveProfiles(this.actorProfiles.size + (this.actorProfiles.has(actorId) ? 0 : 1)); } catch { this.skipped++; return false; } this.actorProfiles.set(actorId, normalized); }
    else if (patchId != null) { if (!string(patchId) || this.patchProfiles.size >= 64 && !this.patchProfiles.has(patchId)) return false; try { this._reserveProfiles(this.actorProfiles.size, this.patchProfiles.size + (this.patchProfiles.has(patchId) ? 0 : 1)); } catch { this.skipped++; return false; } this.patchProfiles.set(patchId, normalized); }
    else { try { this._reserveProfiles(); } catch { this.skipped++; return false; } this.profile = normalized; }
    this._changed(); return true;
  }
  getProfile(actorId, patchId = null) { return this.actorProfiles.get(actorId) || this.patchProfiles.get(patchId ?? this.mailboxes.get(actorId)?.patchId) || this.profile; }
  getConfiguration() { return Object.freeze({ version: 1, global: this.profile, patches: Object.freeze([...this.patchProfiles].map(([patchId, profile]) => Object.freeze({ patchId, profile }))), actors: Object.freeze([...this.actorProfiles].map(([actorId, profile]) => Object.freeze({ actorId, generation: this.epoch?.generation ?? null, profile }))) }); }
  restoreConfiguration(configuration) {
    if (this.retired) return false;
    if (!configuration || configuration.version !== 1 || !Array.isArray(configuration.patches) || configuration.patches.length > 64 || !Array.isArray(configuration.actors) || configuration.actors.length > MAX_ACTORS) throw new TypeError('Invalid actor effect visual configuration.');
    const profile = normalizeActorEffectVisualProfile(configuration.global), patches = new Map(), actors = new Map();
    for (const entry of configuration.patches) { if (!string(entry.patchId)) throw new TypeError('Invalid visual patch identity.'); patches.set(entry.patchId, normalizeActorEffectVisualProfile(entry.profile)); }
    for (const entry of configuration.actors) { if (!natural(entry.actorId)) throw new TypeError('Invalid visual actor identity.'); if (entry.generation === this.epoch?.generation) actors.set(entry.actorId, normalizeActorEffectVisualProfile(entry.profile)); }
    this._reserveProfiles(actors.size, patches.size); this.profile = profile; this.patchProfiles = patches; this.actorProfiles = actors; this._changed();
  }
  ingestAudioDisplaySample(sample, correlation) {
    const epoch = this.epoch;
    if (this.retired || !this.visible || !epoch || !epoch.owner || !sample || sample.owner !== epoch.owner || sample.worldId != null && sample.worldId !== epoch.worldId || !['generation', 'executionEpoch', 'contextEpoch', 'graphRevision', 'routeRevision'].every(key => sample[key] === epoch[key]) || epoch.contextEpoch == null || correlation?.contextEpoch !== epoch.contextEpoch || sample.scope !== 'actorVoice' || !natural(sample.sequence) || !natural(sample.validUntilFrame) ||
        !string(sample.nodeId) || !Array.isArray(sample.quantities) || sample.quantities.length > MAX_SOURCES || !Number.isFinite(correlation?.uncertaintyMs) || correlation.uncertaintyMs < 0 || correlation.uncertaintyMs > 50) {
      if (sample?.scope === 'bus' || sample?.scope === 'output') this.aggregateSamples++; this.rejected++; return false;
    }
    const validUntilMs = correlation.presentationMs + (sample.validUntilFrame - correlation.audioFrame) / correlation.sampleRate * 1000;
    if (!natural(sample.appliedFrame) || sample.validUntilFrame < sample.appliedFrame || !Number.isFinite(validUntilMs)) { this.rejected++; return false; }
    let accepted = false;
    for (const quantity of sample.quantities) {
      if (!quantity || typeof quantity !== 'object') { this.rejected++; continue; }
      accepted = this.ingest({ version: 1, ...epoch, ...sample, worldId: sample.worldId ?? epoch.worldId, owner: { kind: 'actor', actorId: sample.actorId }, effectId: sample.nodeId, effectRevision: sample.effectRevision ?? sample.graphRevision,
        quantity: quantity.name, units: quantity.unit, value: quantity.value, evidenceClass: quantity.evidenceClass, appliedAudioFrame: sample.appliedFrame,
        window: { firstFrame: sample.windowStartFrame ?? sample.appliedFrame, lastFrame: sample.windowEndFrame ?? sample.appliedFrame }, validUntilMs,
        muted: typeof sample.routeState?.muted === 'boolean' ? sample.routeState.muted : null, bypassed: sample.processingState?.bypassed === true, tail: sample.processingState?.tail === true,
        pending: sample.processingState?.pending === true, rejected: sample.processingState?.faulted === true || sample.processingState?.unsupported === true,
        tap: quantity.tap ?? sample.detector?.tap, detectorDelayFrames: quantity.detectorDelayFrames ?? sample.detector?.detectorDelayFrames, tapId: quantity.tapId, sourcePosition: quantity.sourcePosition }, correlation) || accepted;
    }
    return accepted;
  }
  ingest(sample, correlation) {
    if (this.retired || !this.visible) return false;
    const epoch = this.epoch;
    if (!epoch || !sample || sample.version !== 1 || !['worldId', 'generation', 'executionEpoch', 'graphRevision', 'routeRevision'].every(key => sample[key] === epoch[key]) ||
        !string(sample.effectId) || !natural(sample.effectRevision) || !string(sample.units) || !string(sample.quantity) || !Number.isFinite(sample.value) ||
        !['measured', 'kernel-state', 'applied-parameter', 'admitted-onset', 'configured-parameter'].includes(sample.evidenceClass) || !['complete', 'partial', 'unknown'].includes(sample.coverage)) { this.rejected++; return false; }
    if (sample.owner?.kind === 'bus') { this.aggregateSamples++; this.skipped++; return false; }
    if (sample.owner?.kind !== 'actor' || !natural(sample.actorId) || sample.owner.actorId !== sample.actorId || !string(sample.voiceId) || !string(sample.onsetId)) { this.rejected++; return false; }
    const configured = sample.evidenceClass === 'configured-parameter';
    if (!configured && (!correlation || correlation.executionEpoch !== epoch.executionEpoch || !natural(correlation.audioFrame) || !Number.isFinite(correlation.presentationMs) ||
        !Number.isFinite(correlation.sampleRate) || correlation.sampleRate <= 0 || !natural(sample.appliedAudioFrame) || !natural(sample.window?.firstFrame) || !natural(sample.window?.lastFrame) ||
        sample.window.lastFrame < sample.window.firstFrame || sample.appliedAudioFrame > sample.window.lastFrame || sample.window.lastFrame - sample.window.firstFrame > correlation.sampleRate * 2 || Math.abs(sample.window.lastFrame - correlation.audioFrame) > correlation.sampleRate * 2)) { this.rejected++; return false; }
    const presentationMs = configured ? Number(sample.presentationMs) : correlation.presentationMs + (sample.window.lastFrame - correlation.audioFrame) / correlation.sampleRate * 1000 + Math.max(0, Math.min(2000, Number(correlation.outputLatencyMs) || 0));
    if (!Number.isFinite(presentationMs) || !configured && (presentationMs > correlation.presentationMs + 250 || presentationMs < correlation.presentationMs - 2000)) { this.rejected++; return false; }
    const receipt = Object.freeze({ effectId: sample.effectId, effectRevision: sample.effectRevision, quantity: sample.quantity, value: sample.value, units: sample.units,
      evidenceClass: sample.evidenceClass, coverage: sample.coverage, presentationMs, patchId: string(sample.patchId) ? sample.patchId : null, sequence: natural(sample.sequence) ? sample.sequence : null, validUntilMs: Number.isFinite(sample.validUntilMs) ? sample.validUntilMs : Infinity, actorId: sample.actorId, voiceId: sample.voiceId, onsetId: sample.onsetId,
      muted: typeof sample.muted === 'boolean' ? sample.muted : null, tap: string(sample.tap) ? sample.tap : null,
      windowFirstFrame: sample.window?.firstFrame ?? null, windowLastFrame: sample.window?.lastFrame ?? null, detectorDelayFrames: natural(sample.detectorDelayFrames) ? sample.detectorDelayFrames : null, bypassed: sample.bypassed === true, tail: sample.tail === true, pending: sample.pending === true, rejected: sample.rejected === true,
      tapId: string(sample.tapId) ? sample.tapId : null, sourcePosition: Number.isFinite(sample.sourcePosition?.x) && Number.isFinite(sample.sourcePosition?.y) ? Object.freeze({ x: sample.sourcePosition.x, y: sample.sourcePosition.y }) : null });
    let box = this.mailboxes.get(sample.actorId);
    if (!box) {
      while (this.mailboxes.size >= this.maxActors) { this.removeActor(this.mailboxes.keys().next().value); this.skipped++; }
      box = { sources: new Map(), trails: [], result: EMPTY, resultMs: null, smoothMs: null, smooth: { x: 0, y: 0, scale: 1, inner: 0, outer: 0 }, reservation: {} };
      try { this.budget?.retain(box.reservation, MAILBOX_BYTES, 'presentation'); } catch { this.skipped++; return false; }
      this.mailboxes.set(sample.actorId, box);
    }
    const key = keyFor(sample), previous = box.sources.get(key);
    if (previous && (receipt.presentationMs < previous.presentationMs || receipt.effectRevision < previous.effectRevision || receipt.sequence != null && previous.sequence != null && receipt.sequence <= previous.sequence)) { this.skipped++; return false; }
    if (!previous && box.sources.size >= MAX_SOURCES) { this.skipped++; return false; }
    box.patchId = receipt.patchId; box.sources.set(key, receipt); box.resultMs = null;
    if (sample.quantity === 'delay-tap-envelope' && receipt.tapId && receipt.sourcePosition) {
      const existing = box.trails.findIndex(tap => tap.tapId === receipt.tapId);
      if (existing >= 0) box.trails[existing] = receipt; else box.trails.push(receipt); if (box.trails.length > MAX_TRAILS) box.trails.shift();
    }
    this._changed(); return true;
  }
  evaluate(actorId, now, { reducedMotion = false, dense = false, patchId = null } = {}) {
    const box = this.mailboxes.get(actorId), profile = this.getProfile(actorId, patchId);
    if (!box || !Number.isFinite(now)) return EMPTY;
    if (!profile.enabled) {
      for (const key of box.motionKeys || []) this.motionPolicy?.release(key);
      for (const channel of TARGET_CHANNELS) box.smooth[channel] = EMPTY[channel];
      box.policyStatic = true; box.result = EMPTY; box.resultMs = null; return EMPTY;
    }
    reducedMotion ||= this.motionPolicy?.matches === true;
    const resultKey = `${now}:${this.revision}:${reducedMotion}:${dense}:${patchId}`;
    if (box.resultMs === resultKey) return box.result;
    const still = reducedMotion || dense;
    if (box.policyStatic && !reducedMotion) {
      for (const channel of TARGET_CHANNELS) box.smooth[channel] = box.result[channel];
      for (const key of box.motionKeys || []) this.motionPolicy?.release(key);
      box.smoothMs = now;
    }
    box.policyStatic = reducedMotion;
    const target = { x: 0, y: 0, scale: 1, inner: 0, outer: 0 }, sources = [], trails = []; let state = 'unknown';
    for (const binding of profile.bindings) {
      const matches = [...box.sources.values()].filter(source => source.effectId === binding.effectId && source.quantity === binding.quantity);
      const source = matches.sort((a, b) => Number(b.muted === false && !b.rejected && now <= b.validUntilMs) - Number(a.muted === false && !a.rejected && now <= a.validUntilMs) ||
        Math.abs(b.value) - Math.abs(a.value) || b.presentationMs - a.presentationMs || a.voiceId.localeCompare(b.voiceId))[0]; if (!source) continue;
      const age = now - source.presentationMs, strength = age < -50 || now > source.validUntilMs ? 0 : Math.max(0, Math.min(1, 1 - Math.max(0, age - profile.holdMs) / profile.decayMs));
      const blocked = source.pending || source.rejected || source.muted || source.bypassed && !source.tail || source.coverage !== 'complete';
      const configured = source.evidenceClass === 'configured-parameter';
      const moving = ['x', 'y', 'scale', 'trail'].includes(binding.channel), routeUnknown = source.muted == null;
      const qualified = binding.channel === 'scale' ? ['measured', 'admitted-onset'].includes(source.evidenceClass) && (['amplitude-envelope', 'onset-envelope'].includes(source.quantity) && source.units === 'normalized' && source.value >= 0 && source.value <= 1 || ['rms', 'peak'].includes(source.quantity) && source.units === 'linear-amplitude' && source.value >= 0) :
        ['x', 'y'].includes(binding.channel) ? ['measured', 'kernel-state'].includes(source.evidenceClass) && source.units === 'normalized-signed' : binding.channel === 'trail' ? source.evidenceClass === 'measured' && source.units === 'normalized' && source.tapId && source.sourcePosition : source.quantity === 'wet-tail-envelope' ? source.evidenceClass === 'measured' && source.units === 'normalized' : true;
      const status = blocked ? source.rejected ? 'rejected' : source.pending ? 'pending' : source.muted ? 'muted' : source.bypassed ? 'bypassed' : 'unknown' : strength <= 0 ? 'stale' : routeUnknown ? 'route-unknown' : configured ? 'configured' : !qualified ? 'unqualified' : source.tail ? 'tail' : 'applied';
      sources.push(Object.freeze({ voiceId: source.voiceId, onsetId: source.onsetId, reduction: 'maximum-magnitude-qualified-voice', contributors: matches.length, effectId: source.effectId, quantity: source.quantity, channel: binding.channel, value: source.value, units: source.units, evidenceClass: source.evidenceClass, routeMuted: source.muted, tap: source.tap, windowFirstFrame: source.windowFirstFrame, windowLastFrame: source.windowLastFrame, detectorDelayFrames: source.detectorDelayFrames, state: status }));
      if (blocked || !qualified || strength <= 0 || (configured || routeUnknown) && moving) { if (state === 'unknown') state = status; continue; }
      state = routeUnknown ? 'route-unknown' : configured ? 'configured' : source.tail ? 'tail' : 'applied';
      const min = binding.inputMin, max = binding.inputMax > min ? binding.inputMax : min + 1;
      const input = ['x', 'y'].includes(binding.channel) ? Math.max(-1, Math.min(1, (source.value - (max + min) / 2) * 2 / (max - min))) : Math.max(0, Math.min(1, (source.value - min) / (max - min))), value = shape(input, binding.curve) * binding.gain * (binding.invert ? -1 : 1), amount = value * strength * profile.intensity;
      if (binding.channel === 'x' || binding.channel === 'y') target[binding.channel] += Math.max(-binding.cap, Math.min(binding.cap, amount * 3));
      else if (binding.channel === 'scale') target.scale += Math.max(-0.04, Math.min(0.08, amount * binding.cap * 0.08));
      else if (binding.channel === 'inner' || binding.channel === 'outer') target[binding.channel] = Math.max(target[binding.channel], Math.min(binding.cap, Math.abs(amount)));
      else if (binding.channel === 'trail') for (const tap of box.trails) if (tap.effectId === binding.effectId && tap.muted === false && !tap.pending && !tap.rejected && tap.evidenceClass === 'measured' && tap.units === 'normalized' && (!tap.bypassed || tap.tail) && tap.coverage === 'complete' && now <= tap.validUntilMs) {
        const fade = Math.max(0, Math.min(1, 1 - Math.max(0, now - tap.presentationMs - profile.holdMs) / profile.decayMs));
        if (fade && now >= tap.presentationMs - 50) trails.push(Object.freeze({ x: tap.sourcePosition.x, y: tap.sourcePosition.y, alpha: Math.max(0, Math.min(0.2, tap.value * fade * profile.intensity * 0.2)), tapId: tap.tapId }));
      }
    }
    if (this.motionPolicy) {
      box.motionKeys ||= TARGET_CHANNELS.map(() => ({}));
      box.motionOptions ||= { from: 0, durationMs: 0, timestamp: 0 }; box.motionOptions.durationMs = profile.smoothingMs; box.motionOptions.timestamp = now;
      for (let index = 0; index < TARGET_CHANNELS.length; index++) {
        const channel = TARGET_CHANNELS[index], key = box.motionKeys[index];
        box.motionOptions.from = box.smooth[channel]; box.smooth[channel] = this.motionPolicy.retarget(key, target[channel], box.motionOptions);
      }
    } else {
      const delta = box.smoothMs == null ? Infinity : Math.max(0, Math.min(50, now - box.smoothMs)), alpha = profile.smoothingMs ? 1 - Math.exp(-delta / profile.smoothingMs) : 1;
      for (const channel of TARGET_CHANNELS) box.smooth[channel] += (target[channel] - box.smooth[channel]) * alpha;
    }
    box.smoothMs = Math.max(box.smoothMs ?? now, now); box.resultMs = resultKey;
    const staticSignal = target.x !== 0 || target.y !== 0 || target.scale !== 1 || trails.length > 0;
    box.result = Object.freeze({ state, x: still ? 0 : Math.max(-3, Math.min(3, box.smooth.x)), y: still ? 0 : Math.max(-3, Math.min(3, box.smooth.y)), scale: still ? 1 : Math.max(0.96, Math.min(1.08, box.smooth.scale)),
      inner: still ? target.inner > 0 || staticSignal ? 0.5 : 0 : Math.max(0, Math.min(1, box.smooth.inner)), outer: still ? target.outer > 0 ? 0.5 : 0 : Math.max(0, Math.min(1, box.smooth.outer)),
      trails: Object.freeze(still ? [] : trails.slice(-MAX_TRAILS)), sources: Object.freeze(sources) }); return box.result;
  }
  frameKey(now, visibleActors = null) {
    let active = false, fresh = 0;
    for (const [actorId, box] of this.mailboxes) {
      const profile = this.getProfile(actorId);
      let last = -Infinity; for (const source of box.sources.values()) { last = Math.max(last, source.presentationMs); if (now >= source.presentationMs - 50 && now <= Math.min(source.validUntilMs, source.presentationMs + profile.holdMs + profile.decayMs)) fresh++; }
      if (now > last + profile.holdMs + profile.decayMs + 1000) { this.removeActor(actorId); continue; }
      if (profile.enabled && (!visibleActors || visibleActors.has(actorId)) && now <= last + profile.holdMs + profile.decayMs + 1000) active = true;
    }
    return `${this.revision}:${this.motionPolicy?.revision ?? 0}:${fresh}:${active ? Math.floor(now / (this.motionPolicy?.frameIntervalMs ?? 16)) : 'quiet'}`;
  }
  removeActor(actorId, { profile = false } = {}) { const box = this.mailboxes.get(actorId); if (box) { for (const key of box.motionKeys || []) this.motionPolicy?.release(key); this.budget?.release(box.reservation); this.mailboxes.delete(actorId); this.revision++; } if (profile && this.actorProfiles.delete(actorId)) this._shrinkProfiles(); }
  clear({ profiles = true } = {}) { for (const actorId of this.mailboxes.keys()) this.removeActor(actorId); if (profiles) { this.actorProfiles.clear(); this._shrinkProfiles(); } }
  getDiagnostics() { return Object.freeze({ epoch: this.epoch, visible: this.visible, revision: this.revision, actors: this.mailboxes.size, maxActors: this.maxActors, sources: [...this.mailboxes.values()].reduce((count, box) => count + box.sources.size, 0), skipped: this.skipped, rejected: this.rejected, aggregateSamples: this.aggregateSamples, estimatedHistoryBytes: this.mailboxes.size * MAILBOX_BYTES, profileEstimatedBytes: this.profileEstimatedBytes, acousticReceipt: false }); }
  dispose() { if (this.retired) return; this.subscription?.(); this.subscription = null; this.clear(); this.patchProfiles.clear(); this.budget?.release(this.profileToken); this.profileEstimatedBytes = 0; this.retired = true; this.motionPolicy = this.budget = this.onChange = this.epoch = null; }
}
export { ProcgenActorEffectDisplay, EMPTY as EMPTY_ACTOR_EFFECT_VISUAL };
