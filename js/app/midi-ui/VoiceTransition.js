export const validVoiceTransition = value => value == null || value && Object.getPrototypeOf(value) === Object.prototype && value.kind === 'crossfade' &&
  Number.isFinite(value.seconds) && value.seconds >= 0 && value.seconds <= 4 && typeof value.fromVoiceId === 'string' && value.fromVoiceId.length > 0 && value.fromVoiceId.length <= 512;
export const transitionAttackSeconds = (intent, fallback) => intent.voiceTransition?.kind === 'crossfade' ? intent.voiceTransition.seconds : fallback;
