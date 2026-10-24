const clamp01 = value => Math.max(0, Math.min(1, value));

export function nativeHeldEnvelopeLevel(voice, at) {
  const attackEnd = voice.start + voice.attack, decayEnd = attackEnd + voice.decay;
  return voice.peak * (at < attackEnd ? clamp01((at - voice.start) / voice.attack) : voice.decay > 0 && at < decayEnd
    ? 1 - (1 - voice.sustain) * (at - attackEnd) / voice.decay : voice.sustain);
}

// Removing a future linear endpoint also removes the interpolation before it.
// Recreate its truncated endpoint; AudioParam.value cannot predict that value.
export function truncateNativeEnvelope(voice, at, releaseEnd = voice.end) {
  const param = voice.gain.gain, attackEnd = voice.start + voice.attack, decayEnd = attackEnd + voice.decay;
  const releasing = voice.released && at >= voice.releaseAt;
  const level = releasing ? voice.releaseLevel * clamp01((releaseEnd - at) / Math.max(Number.EPSILON, releaseEnd - voice.releaseAt)) : nativeHeldEnvelopeLevel(voice, at);
  param.cancelScheduledValues(at);
  if (at > voice.start && !releasing && voice.attack > 0 && at === attackEnd && voice.decay === 0) {
    param.linearRampToValueAtTime(voice.peak, at); param.setValueAtTime(level, at);
  } else if (at > voice.start && (releasing || at <= attackEnd || voice.decay > 0 && at <= decayEnd))
    param.linearRampToValueAtTime(level, at);
  else param.setValueAtTime(level, at);
  return level;
}

export function scheduleNativeHeldEnvelope(voice, from = voice.start) {
  const param = voice.gain.gain, attackEnd = voice.start + voice.attack, decayEnd = attackEnd + voice.decay;
  const releaseAt = voice.releaseAt;
  truncateNativeEnvelope(voice, from);
  if (attackEnd > from && attackEnd <= releaseAt) param.linearRampToValueAtTime(voice.peak, attackEnd);
  if (decayEnd > from && decayEnd <= releaseAt) param.linearRampToValueAtTime(voice.peak * voice.sustain, decayEnd);
  if (releaseAt > from) {
    const level = nativeHeldEnvelopeLevel(voice, releaseAt);
    if (releaseAt < decayEnd) param.linearRampToValueAtTime(level, releaseAt);
    else param.setValueAtTime(level, releaseAt);
  }
  param.linearRampToValueAtTime(0, voice.end);
}
