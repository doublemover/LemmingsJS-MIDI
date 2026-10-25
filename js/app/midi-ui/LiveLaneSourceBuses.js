import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';

import { LIVE_LANE_TAP_LIMIT } from './OwnedSourceLayout.js';
export { LIVE_LANE_TAP_LIMIT, LIVE_LANE_TAP_PROTOCOL } from './OwnedSourceLayout.js';
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 160;

// These buses only collect upstream sources. They never connect to an audible
// destination, an effect return or another owner's session.
export function createLiveLaneSourceBuses({ context, resources, owner, generation, isCurrent }) {
  if (!context?.createGain || !resources?.reserve || typeof isCurrent !== 'function') throw new TypeError('Lane sources require a live audio owner.');
  const metadata = resources.reserve({ kind: 'lane-source-index', owner, generation, estimateBytes: 8192, consumerOwned: true });
  const voices = new Set(), renderers = new Set(), buses = new Map(), retirement = createProcgenRetirementScope();
  let declarationLease = null, declared = new Set(), disposed = false, fault = null;
  const active = () => !disposed && !fault && context.state !== 'closed' && isCurrent();
  const protect = error => { fault ||= error; metadata.retainUnknown(error); throw error; };
  const attachVoice = (voice, bus) => {
    voice.bus = bus; voice.pre.connect(bus.pre); voice.preConnected = true; voice.post.connect(bus.post); voice.postConnected = true;
  };
  const detachVoice = voice => {
    const bus = voice.bus; if (!bus) return;
    if (voice.preConnected) { voice.pre.disconnect(bus.pre); voice.preConnected = false; }
    if (voice.postConnected) { voice.post.disconnect(bus.post); voice.postConnected = false; } voice.bus = null;
  };
  const retireBus = bus => {
    if (bus.retirement) return bus.retirement;
    bus.available = false;
    bus.retirement = createProcgenRetirementScope().retire([
      { name: 'source-unavailable', run: () => { for (const listener of [...bus.listeners]) listener(); bus.listeners.clear(); } },
      ...[...voices].filter(voice => voice.bus === bus).map((voice, index) => ({ name: 'voice-' + index, run: () => detachVoice(voice) })),
      ...[...renderers].map((renderer, index) => ({ name: 'renderer-' + index, run: () => renderer.detach(bus) })),
      { name: 'pre-fader', run: () => bus.pre?.disconnect() }, { name: 'post-fader', run: () => bus.post?.disconnect() }
    ]);
    try { releaseAudioResourceAfterRetirement(bus.lease, bus.retirement); }
    catch (error) { protect(error); }
    if (bus.retirement.outcome !== 'complete') protect(new Error('Lane source retirement remains unresolved.'));
    buses.delete(bus.laneId); return bus.retirement;
  };
  const makeBus = laneId => {
    if (buses.size >= LIVE_LANE_TAP_LIMIT) throw new Error('Eight distinct donor lanes already own live source taps.');
    const used = new Set([...buses.values()].map(bus => bus.index)); let index = 0; while (used.has(index)) index++;
    const lease = resources.reserve({ kind: 'lane-source-bus', owner, generation, estimateBytes: 24576, consumerOwned: true });
    const bus = { laneId, index, lease, pre: null, post: null, references: 0, available: true, listeners: new Set(), retirement: null }; buses.set(laneId, bus);
    try {
      bus.pre = context.createGain(); bus.post = context.createGain();
      for (const voice of voices) if (voice.laneId === laneId) attachVoice(voice, bus);
      for (const renderer of renderers) renderer.attach(bus);
      return bus;
    } catch (error) { try { retireBus(bus); } catch (retirementError) { error.retirement = retirementError; } throw error; }
  };
  return Object.freeze({
    declare(laneIds) {
      if (!Array.isArray(laneIds) || laneIds.length > 1024 || laneIds.some(id => !validId(id)) || new Set(laneIds).size !== laneIds.length) throw new TypeError('Lane source identities must be unique and bounded.');
      if (!active()) throw new Error('The lane source owner is unavailable.');
      const nextLease = resources.reserve({ kind: 'lane-source-identities', owner, generation, estimateBytes: laneIds.length * 384, consumerOwned: true });
      declared = new Set(laneIds); declarationLease?.release(); declarationLease = nextLease;
      for (const bus of [...buses.values()]) if (!declared.has(bus.laneId)) retireBus(bus);
    },
    registerVoice({ laneId, pre, post }) {
      if (!active() || !validId(laneId) || !pre?.connect || !post?.connect || voices.size >= 256) throw new Error('Native lane source admission is unavailable.');
      const lease = resources.reserve({ kind: 'lane-source-voice', owner, generation, bytes: 512, consumerOwned: true });
      const voice = { laneId, pre, post, bus: null, lease, preConnected: false, postConnected: false }; voices.add(voice);
      try { const bus = buses.get(laneId); if (bus) attachVoice(voice, bus); }
      catch (error) { voices.delete(voice); try { detachVoice(voice); lease.release(); } catch (failure) { protect(failure); } throw error; }
      return () => { if (!voices.has(voice)) return; try { detachVoice(voice); lease.release(); voices.delete(voice); } catch (error) { protect(error); } };
    },
    registerRenderer({ attach, detach }) {
      if (!active() || typeof attach !== 'function' || typeof detach !== 'function' || renderers.size >= 65) throw new Error('Owned lane source admission is unavailable.');
      const lease = resources.reserve({ kind: 'lane-source-renderer', owner, generation, bytes: 2048, consumerOwned: true });
      const renderer = { attach, detach, lease }; renderers.add(renderer);
      try { for (const bus of buses.values()) attach(bus); }
      catch (error) { renderers.delete(renderer); for (const bus of buses.values()) { try { detach(bus); } catch (failure) { protect(failure); } } lease.release(); throw error; }
      return () => { if (!renderers.has(renderer)) return; try { for (const bus of buses.values()) detach(bus); lease.release(); renderers.delete(renderer); } catch (error) { protect(error); } };
    },
    pin({ sourceBusId, tap, inputLayout }) {
      if (!active() || typeof sourceBusId !== 'string' || !sourceBusId.startsWith('lane:') || inputLayout !== 'audioStereo' || !['pre-fader', 'post-fader'].includes(tap)) return null;
      const laneId = sourceBusId.slice(5); if (!declared.has(laneId)) return null;
      const bus = buses.get(laneId) || makeBus(laneId); bus.references++; let released = false; const subscriptions = new Set();
      return Object.freeze({ node: tap === 'pre-fader' ? bus.pre : bus.post, context, owner, generation, sourceBusId, tap, layout: inputLayout,
        stage: 'upstream-owner-effects', faderScope: 'lane-gain-pan-mute-solo;owner-master-is-downstream',
        isActive: () => !released && bus.available && active(),
        onUnavailable(listener) { if (released || typeof listener !== 'function' || bus.listeners.size >= 128) throw new Error('Source observation admission is unavailable.'); const notify = () => { if (!released) listener(); }; subscriptions.add(notify); bus.listeners.add(notify); return () => { subscriptions.delete(notify); bus.listeners.delete(notify); }; },
        release() { if (released) return; released = true; for (const notify of subscriptions) bus.listeners.delete(notify); subscriptions.clear(); bus.references--; if (!bus.references && bus.available) retireBus(bus); } });
    },
    diagnostics: () => Object.freeze({ owner, generation, disposed, fault: fault?.message || null, declaredLanes: declared.size, voices: voices.size, renderers: renderers.size,
      donors: [...buses.values()].map(bus => ({ laneId: bus.laneId, references: bus.references, available: bus.available, index: bus.index })), maximumDonorLanes: LIVE_LANE_TAP_LIMIT }),
    dispose() {
      return retirement.retire([{ name: 'source-admission', run: () => { disposed = true; } },
        { name: 'lane-buses', run: () => { for (const bus of [...buses.values()]) retireBus(bus); } },
        { name: 'source-index', run: () => { if (fault) throw fault; for (const voice of voices) voice.lease.release(); for (const renderer of renderers) renderer.lease.release(); voices.clear(); renderers.clear(); declared.clear(); declarationLease?.release(); metadata.release(); } }]);
    }
  });
}
