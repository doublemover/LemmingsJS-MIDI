const profiles = Object.freeze({ performance: 'interactive', balanced: 'balanced', robust: 'playback' });
export function normalizeAudioRuntimeConfig(value = {}) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !['latencyProfile', 'preferredSampleRate', 'sinkPreference'].includes(key))) throw new TypeError('Invalid audio runtime configuration.');
  const { latencyProfile = 'performance', preferredSampleRate = null, sinkPreference = '' } = value;
  if (typeof latencyProfile !== 'string' || !Object.hasOwn(profiles, latencyProfile) || preferredSampleRate !== null && ![44100, 48000, 96000].includes(preferredSampleRate) ||
      typeof sinkPreference !== 'string' || sinkPreference.length > 256 || /[\u0000-\u001f]/.test(sinkPreference)) throw new TypeError('Invalid audio runtime profile, rate or output preference.');
  return Object.freeze({ latencyProfile, preferredSampleRate, sinkPreference });
}
export function audioRuntimeContextOptions(config) {
  return { latencyHint: profiles[config.latencyProfile], ...(config.preferredSampleRate === null ? {} : { sampleRate: config.preferredSampleRate }),
    ...(config.sinkPreference ? { sinkId: config.sinkPreference } : {}) };
}
