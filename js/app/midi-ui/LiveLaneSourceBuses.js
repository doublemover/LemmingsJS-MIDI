import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';
import { validateEffectVoiceSelection, sourceVoiceMatches } from '../../midi/content/EffectVoiceSelection.js';
import { LIVE_LANE_TAP_LIMIT, LIVE_LANE_ID_LIMIT } from './OwnedSourceLayout.js';
import { createNativeSourceLaneRoutes } from './NativeSourceLaneRoutes.js';
export { LIVE_LANE_TAP_LIMIT, LIVE_LANE_TAP_PROTOCOL } from './OwnedSourceLayout.js';
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 160;

// Source buses never connect to a destination, effect return or another owner.
export function createLiveLaneSourceBuses({ context, resources, owner, generation, isCurrent, maximumBuses = LIVE_LANE_TAP_LIMIT }) {
  if (!context?.createGain || !resources?.reserve || typeof isCurrent !== 'function' || !Number.isInteger(maximumBuses) || maximumBuses < 1 || maximumBuses > 32) throw new TypeError('Source buses require a live audio owner.');
  const metadata = resources.reserve({ kind: 'lane-source-index', owner, generation, estimateBytes: 8192, consumerOwned: true });
  const voices = new Set(), renderers = new Set(), buses = new Map(), retirement = createProcgenRetirementScope();
  const laneTokens = new Map(), tokenLeases = [];
  let declarationLease = null, declared = new Set(), disposed = false, fault = null;
  const active = () => !disposed && !fault && context.state !== 'closed' && isCurrent();
  const laneToken = id => {
    if (!active() || !validId(id)) throw new Error('The lane source identity owner is unavailable.');
    if (laneTokens.has(id)) return laneTokens.get(id);
    if (laneTokens.size >= LIVE_LANE_ID_LIMIT) throw new Error('Lane source identity capacity requires a new audio owner.');
    if (laneTokens.size % 64 === 0) tokenLeases.push(resources.reserve({ kind: 'lane-source-token-index', owner, generation, estimateBytes: 64 * 384, consumerOwned: true }));
    const token = laneTokens.size + 1; laneTokens.set(id, token); return token;
  };
  const protect = error => {
    fault ||= error; metadata.retainUnknown(error);
    for (const bus of buses.values()) { bus.available = false; for (const listener of [...bus.listeners]) { try { listener(); } catch { /* Notify every dependent graph before retaining unresolved ownership. */ } } bus.listeners.clear(); }
    throw error;
  };
  const matches = (voice, bus) => bus.voiceSelection ? sourceVoiceMatches(bus.voiceSelection, voice.voiceId, voice.sourceGeneration) : !!voice.routing?.pathFor(bus.laneId);
  const hasMember = member => { for (const voice of voices) if (voice.voiceId === member.voiceId && voice.sourceGeneration === member.generation) return true; for (const renderer of renderers) if (renderer.hasVoice?.(member)) return true; return false; };
  const attachVoice = (voice, bus) => {
    if (voice.buses.has(bus)) return;
    const path = bus.voiceSelection ? voice : voice.routing?.pathFor(bus.laneId); if (!path) return;
    const connection = { pre: false, post: false, preNode: path.pre, postNode: path.post }; voice.buses.set(bus, connection);
    path.pre.connect(bus.pre); connection.pre = true; path.post.connect(bus.post); connection.post = true;
  };
  const detachVoice = (voice, bus) => {
    const connection = voice.buses.get(bus); if (!connection) return;
    if (connection.pre) { connection.preNode.disconnect(bus.pre); connection.pre = false; }
    if (connection.post) { connection.postNode.disconnect(bus.post); connection.post = false; } voice.buses.delete(bus);
  };
  const retireBus = bus => {
    if (bus.retirement) return bus.retirement; bus.available = false;
    bus.retirement = createProcgenRetirementScope().retire([
      { name: 'source-unavailable', run: () => { for (const listener of [...bus.listeners]) listener(); bus.listeners.clear(); } },
      ...[...voices].filter(voice => voice.buses.has(bus)).map((voice, index) => ({ name: 'voice-' + index, run: () => detachVoice(voice, bus) })),
      ...[...renderers].map((renderer, index) => ({ name: 'renderer-' + index, run: () => renderer.detach(bus) })),
      { name: 'pre-fader', run: () => bus.pre?.disconnect() }, { name: 'post-fader', run: () => bus.post?.disconnect() }
    ]);
    try { releaseAudioResourceAfterRetirement(bus.lease, bus.retirement); } catch (error) { protect(error); }
    if (bus.retirement.outcome !== 'complete') protect(new Error('Source bus retirement remains unresolved.'));
    buses.delete(bus.key); return bus.retirement;
  };
  const refreshSources = () => { if (!active()) return; for (const bus of [...buses.values()]) if (bus.voiceSelection && !bus.voiceSelection.some(hasMember)) retireBus(bus); };
  const makeBus = (key, laneId, voiceSelection) => {
    if (buses.size >= maximumBuses) throw new Error((maximumBuses === 8 ? 'Eight' : maximumBuses) + ' distinct lane or voice-selection donors already own source taps.');
    const used = new Set([...buses.values()].map(bus => bus.index)); let index = 0; while (used.has(index)) index++;
    const identityToken = voiceSelection ? 0 : laneToken(laneId);
    const lease = resources.reserve({ kind: 'lane-source-bus', owner, generation, estimateBytes: 524288, consumerOwned: true });
    const bus = { key, laneId, laneToken: identityToken, voiceSelection, index, lease, pre: null, post: null, references: 0, available: true, listeners: new Set(), readiness: new Map(), retirement: null }; buses.set(key, bus);
    try {
      bus.pre = context.createGain(); bus.post = context.createGain();
      for (const voice of voices) if (matches(voice, bus)) attachVoice(voice, bus);
      for (const renderer of renderers) { const ready = renderer.attach(bus); if (ready) { const pending = Promise.resolve(ready); pending.catch(() => {}); bus.readiness.set(renderer, pending); } }
      return bus;
    } catch (error) { try { retireBus(bus); } catch (retirementError) { error.retirement = retirementError; } throw error; }
  };
  return Object.freeze({
    laneToken,
    declare(laneIds) {
      if (!Array.isArray(laneIds) || laneIds.length > 1024 || laneIds.some(id => !validId(id)) || new Set(laneIds).size !== laneIds.length) throw new TypeError('Lane source identities must be unique and bounded.');
      if (!active()) throw new Error('The source owner is unavailable.');
      if (laneTokens.size + laneIds.filter(id => !laneTokens.has(id)).length > LIVE_LANE_ID_LIMIT) throw new Error('Lane source identity capacity requires a new audio owner.');
      for (const id of laneIds) laneToken(id);
      const nextLease = resources.reserve({ kind: 'lane-source-identities', owner, generation, estimateBytes: laneIds.length * 384, consumerOwned: true });
      declared = new Set(laneIds); declarationLease?.release(); declarationLease = nextLease;
      for (const bus of [...buses.values()]) if (!bus.voiceSelection && !declared.has(bus.laneId)) retireBus(bus);
    },
    registerVoice({ laneId, pre, post, voiceId = null, sourceGeneration = null, start = context.currentTime }) {
      if (!active() || !validId(laneId) || !pre?.connect || !post?.connect || voices.size >= 256 || voiceId !== null && (typeof voiceId !== 'string' || !voiceId || voiceId.length > 512 || !Number.isSafeInteger(sourceGeneration) || sourceGeneration < 0)) throw new Error('Native source admission is unavailable.');
      const lease = resources.reserve({ kind: 'lane-source-voice', owner, generation, bytes: 512, consumerOwned: true }), voice = { laneId, pre, post, voiceId, sourceGeneration, buses: new Map(), lease }; voices.add(voice);
      try {
        voice.routing = createNativeSourceLaneRoutes({ context, resources, owner, generation, laneId, pre, post, start,
          onAdd: id => { for (const bus of buses.values()) if (!bus.voiceSelection && bus.laneId === id) attachVoice(voice, bus); },
          onRemove: id => { for (const bus of [...voice.buses.keys()]) if (!bus.voiceSelection && bus.laneId === id) detachVoice(voice, bus); } });
        for (const bus of buses.values()) if (matches(voice, bus)) attachVoice(voice, bus);
      } catch (error) { voices.delete(voice); try { for (const bus of [...voice.buses.keys()]) detachVoice(voice, bus); voice.routing?.dispose(); lease.release(); } catch (failure) { protect(failure); } if (error.retirement) protect(error); throw error; }
      const release = () => { if (!voices.has(voice)) return; try { for (const bus of [...voice.buses.keys()]) detachVoice(voice, bus); voice.routing.dispose(); lease.release(); voices.delete(voice); refreshSources(); } catch (error) { protect(error); } };
      release.scheduleLane = (id, frame) => { if (!active() || !voices.has(voice)) return false; try { return voice.routing.schedule(id, frame); } catch (error) { protect(error); } };
      return Object.freeze(release);
    },
    registerRenderer({ attach, detach, hasVoice = null }) {
      if (!active() || maximumBuses > LIVE_LANE_TAP_LIMIT || typeof attach !== 'function' || typeof detach !== 'function' || hasVoice !== null && typeof hasVoice !== 'function' || renderers.size >= 65) throw new Error('Owned source admission is unavailable.');
      const lease = resources.reserve({ kind: 'lane-source-renderer', owner, generation, bytes: 8192, consumerOwned: true }), renderer = { attach, detach, hasVoice, lease }; renderers.add(renderer);
      try { for (const bus of buses.values()) { const ready = attach(bus); if (ready) { const pending = Promise.resolve(ready); pending.catch(() => {}); bus.readiness.set(renderer, pending); } } }
      catch (error) { renderers.delete(renderer); for (const bus of buses.values()) { try { detach(bus); bus.readiness.delete(renderer); } catch (failure) { protect(failure); } } lease.release(); throw error; }
      return () => { if (!renderers.has(renderer)) return; try { for (const bus of buses.values()) { detach(bus); bus.readiness.delete(renderer); } lease.release(); renderers.delete(renderer); refreshSources(); } catch (error) { protect(error); } };
    }, refreshSources, hasVoice: member => active() && !!member && typeof member.voiceId === 'string' && Number.isSafeInteger(member.generation) && hasMember(member),
    pin({ sourceBusId, tap, inputLayout, voiceSelection = null }) {
      if (!active() || typeof sourceBusId !== 'string' || inputLayout !== 'audioStereo' || !['pre-fader', 'post-fader'].includes(tap)) return null;
      const selected = sourceBusId === 'voices:selected' ? validateEffectVoiceSelection(voiceSelection) : null, laneId = selected ? null : sourceBusId.startsWith('lane:') ? sourceBusId.slice(5) : null;
      if (selected ? !selected.every(hasMember) : !declared.has(laneId) || voiceSelection !== null) return null;
      const key = selected ? 'voices:' + JSON.stringify(selected) : 'lane:' + laneId, bus = buses.get(key) || makeBus(key, laneId, selected);
      if (!bus.available) return null; bus.references++; let released = false; const subscriptions = new Set();
      return Object.freeze({ node: tap === 'pre-fader' ? bus.pre : bus.post, context, owner, generation, sourceBusId, voiceSelection: selected, tap, layout: inputLayout,
        stage: 'upstream-owner-effects', faderScope: 'lane-gain-pan-mute-solo;owner-master-is-downstream', isActive: () => !released && bus.available && active(),
        confirmReady: async ({ signal } = {}) => {
          signal?.throwIfAborted(); let rejectAborted; const aborted = new Promise((_, reject) => { rejectAborted = reject; }), abort = () => rejectAborted(signal.reason);
          signal?.addEventListener('abort', abort, { once: true });
          try { const receipts = await Promise.race([Promise.all(bus.readiness.values()), aborted]); signal?.throwIfAborted(); if (released || !bus.available || !active()) throw new Error('Selected source ended during preparation.'); return Object.freeze({ nativeConnectionEvidence: 'native-node-routing-API', ownedRouting: Object.freeze(receipts.filter(receipt => receipt?.stage === 'rendered-source-routing')), acousticReceipt: false }); }
          finally { signal?.removeEventListener('abort', abort); }
        },
        onUnavailable(listener) { if (released || typeof listener !== 'function' || bus.listeners.size >= 128) throw new Error('Source observation admission is unavailable.'); const notify = () => { if (!released) listener(); }; subscriptions.add(notify); bus.listeners.add(notify); return () => { subscriptions.delete(notify); bus.listeners.delete(notify); }; },
        release() { if (released) return; released = true; for (const notify of subscriptions) bus.listeners.delete(notify); subscriptions.clear(); bus.references--; if (!bus.references && bus.available) retireBus(bus); } });
    },
    diagnostics: () => Object.freeze({ owner, generation, disposed, fault: fault?.message || null, declaredLanes: declared.size, retainedLaneIdentities: laneTokens.size, maximumLaneIdentities: LIVE_LANE_ID_LIMIT, voices: voices.size, renderers: renderers.size,
      donors: [...buses.values()].map(bus => ({ laneId: bus.laneId, selectedVoices: bus.voiceSelection?.length || 0, references: bus.references, available: bus.available, index: bus.index })), maximumDonorLanes: maximumBuses }),
    dispose() { return retirement.retire([{ name: 'source-admission', run: () => { disposed = true; } }, { name: 'source-buses', run: () => { for (const bus of [...buses.values()]) retireBus(bus); } },
      { name: 'source-index', run: () => { if (fault) throw fault; for (const voice of voices) { voice.routing.dispose(); voice.lease.release(); } for (const renderer of renderers) renderer.lease.release(); voices.clear(); renderers.clear(); declared.clear(); laneTokens.clear(); for (const lease of tokenLeases) lease.release(); tokenLeases.length = 0; declarationLease?.release(); metadata.release(); } }]); }
  });
}
