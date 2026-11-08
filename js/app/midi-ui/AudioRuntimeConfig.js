// @ts-check
/** @typedef {import('./AudioRuntimeContracts.js').AudioRuntimeConfig} AudioRuntimeConfig */
/** @type {Readonly<Record<import('./AudioRuntimeContracts.js').AudioLatencyProfile, AudioContextLatencyCategory>>} */
const profiles = Object.freeze({ performance: 'interactive', balanced: 'balanced', robust: 'playback' });
/** @param {import('./AudioRuntimeContracts.js').AudioRuntimeConfigInput} [value] @returns {AudioRuntimeConfig} */
export function normalizeAudioRuntimeConfig(value = {}) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !['latencyProfile', 'preferredSampleRate', 'sinkPreference'].includes(key))) throw new TypeError('Invalid audio runtime configuration.');
  const { latencyProfile = 'performance', preferredSampleRate = null, sinkPreference = '' } = value;
  if (typeof latencyProfile !== 'string' || !Object.hasOwn(profiles, latencyProfile) || preferredSampleRate !== null && ![44100, 48000, 96000].includes(preferredSampleRate) ||
      typeof sinkPreference !== 'string' || sinkPreference.length > 256 || /[\u0000-\u001f]/.test(sinkPreference)) throw new TypeError('Invalid audio runtime profile, rate or output preference.');
  return Object.freeze({ latencyProfile, preferredSampleRate, sinkPreference });
}
/** @param {AudioRuntimeConfig} config @returns {import('./AudioRuntimeContracts.js').AudioRuntimeContextRequest} */
export function audioRuntimeContextOptions(config) {
  return { latencyHint: profiles[config.latencyProfile], ...(config.preferredSampleRate === null ? {} : { sampleRate: config.preferredSampleRate }),
    ...(config.sinkPreference ? { sinkId: config.sinkPreference } : {}) };
}
/** Compare a native sink observation without exposing its identifier.
 * @param {unknown} sink @param {string} preference @returns {boolean | null}
 */
export function audioRuntimeSinkMatches(sink, preference) {
  if (typeof sink === 'string') return sink === preference;
  try { if (sink && typeof sink === 'object' && Reflect.get(sink, 'type') === 'none') return false; } catch { /* An unavailable observation remains unknown. */ }
  return null;
}
