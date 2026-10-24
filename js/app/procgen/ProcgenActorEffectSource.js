// The backend owns observation and the clock owner supplies #972 correlation.
// This bridge never samples AudioContext or invents a second audio clock.
export function connectProcgenActorEffectSource({ renderer, backend, identity, owner, getCorrelation, actorIds, voiceIds, maxVoices = 16, rateHz = 20 } = {}) {
  const manager = renderer?.actorEffects;
  if (!manager || typeof backend?.observeDisplaySamples !== 'function' || typeof getCorrelation !== 'function' || typeof owner !== 'string' || !owner || !identity) return null;
  manager.setEpoch({ ...identity, owner });
  let active = true, releaseError = null;
  const receive = sample => {
    if (!active || !manager.visible || manager.retired || !renderer.world || renderer.world.worldId !== identity.worldId || renderer.world.generation !== identity.generation) return;
    let correlation; try { correlation = getCorrelation(sample); } catch { return; }
    manager.ingestAudioDisplaySample(sample, correlation);
  };
  let unsubscribe;
  try { unsubscribe = backend.observeDisplaySamples(receive, { identity, actorIds, voiceIds, maxVoices: Math.max(1, Math.min(32, maxVoices)), rateHz: Math.max(4, Math.min(30, rateHz)) }); }
  catch { return null; }
  if (typeof unsubscribe !== 'function') return null;
  const release = () => { if (!active) { if (releaseError) throw releaseError; return; } active = false;
    try { unsubscribe(); } catch (error) { releaseError = error; throw error; }
  };
  manager.attachSubscription(release); return release;
}
