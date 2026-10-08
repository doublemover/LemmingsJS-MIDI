const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const DEFAULT_MIDI_ENSEMBLE_TENSION = Object.freeze({ enabled: true, amount: 1, healthyPopulation: 8, healthyTicks: 120,
  collapseRatio: 0.25, recoveryRatio: 0.6, fadeTicks: 90, breakthroughPixels: 48, breakthroughHoldTicks: 180 });
const sanitizeMidiEnsembleTension = value => {
  const settings = value && typeof value === 'object' ? value : {};
  const collapseRatio = clamp(number(settings.collapseRatio, 0.25), 0.05, 0.8);
  return { enabled: settings.enabled === true, amount: clamp(number(settings.amount, 1), 0, 1),
    healthyPopulation: clamp(Math.round(number(settings.healthyPopulation, 8)), 2, 256),
    healthyTicks: clamp(Math.round(number(settings.healthyTicks, 120)), 0, 3600), collapseRatio,
    recoveryRatio: clamp(number(settings.recoveryRatio, 0.6), collapseRatio + 0.05, 1),
    fadeTicks: clamp(Math.round(number(settings.fadeTicks, 90)), 1, 3600),
    breakthroughPixels: clamp(Math.round(number(settings.breakthroughPixels, 48)), 8, 4096),
    breakthroughHoldTicks: clamp(Math.round(number(settings.breakthroughHoldTicks, 180)), 1, 3600) };
};
export { DEFAULT_MIDI_ENSEMBLE_TENSION, sanitizeMidiEnsembleTension };
