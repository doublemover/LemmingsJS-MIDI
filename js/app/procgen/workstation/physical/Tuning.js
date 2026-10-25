import { plain, identity, finite, freeze } from './PhysicalSchema.js';

export function validatePhysicalTuning(value) {
  if (!plain(value) || value.version !== 1 || !identity(value.id) || !['cents', 'ratios'].includes(value.kind) ||
      !Array.isArray(value.values) || !value.values.length || value.values.length > 128 ||
      !finite(value.referenceCents ?? 6900, 24000) || !finite(value.referenceHz ?? 440, 20000) || (value.referenceHz ?? 440) <= 0) throw new Error('Invalid physical tuning identity or reference.');
  const values = value.values.map(item => {
    if (value.kind === 'cents') { if (!finite(item, 24000)) throw new Error('Invalid tuning cents.'); return item; }
    if (!Array.isArray(item) || item.length !== 2 || !item.every(part => Number.isSafeInteger(part) && part > 0 && part <= 1000000)) throw new Error('Tuning ratios require bounded positive integer numerator/denominator.');
    return [...item];
  });
  const cents = values.map(item => value.kind === 'cents' ? item : 1200 * Math.log2(item[0] / item[1]));
  const periodCents = value.periodCents ?? 1200;
  if (!finite(periodCents, 24000) || periodCents <= 0 || cents.some((item, index) => item < 0 || item >= periodCents || index && item <= cents[index - 1])) throw new Error('Tuning degrees must ascend within a positive period.');
  return freeze({ version: 1, id: value.id, kind: value.kind, values, cents, periodCents, referenceCents: value.referenceCents ?? 6900, referenceHz: value.referenceHz ?? 440 });
}
export function tuningDegree(tuning, degree, rootCents = tuning.referenceCents) {
  if (!Number.isSafeInteger(degree) || Math.abs(degree) > 4096 || !finite(rootCents, 24000)) throw new Error('Invalid tuning degree.');
  const index = ((degree % tuning.cents.length) + tuning.cents.length) % tuning.cents.length, period = Math.floor(degree / tuning.cents.length);
  const cents = rootCents + period * tuning.periodCents + tuning.cents[index];
  if (!finite(cents, 24000)) throw new Error('Tuned pitch exceeds semantic range.');
  return freeze({ cents, referenceHz: tuning.referenceHz, tuningId: tuning.id, degree, period, ...(tuning.kind === 'ratios' ? { ratio: tuning.values[index] } : {}) });
}
export function nearestTuningPitch(tuning, cents, rootCents = tuning.referenceCents) {
  const period = Math.floor((cents - rootCents) / tuning.periodCents); let best = null;
  for (let octave = period - 1; octave <= period + 1; octave++) for (let index = 0; index < tuning.cents.length; index++) {
    const value = rootCents + octave * tuning.periodCents + tuning.cents[index]; if (Math.abs(value) > 24000) continue;
    const distance = Math.abs(value - cents);
    if (!best || distance < best.distance || distance === best.distance && value < best.pitch.cents) best = { distance, pitch: tuningDegree(tuning, octave * tuning.cents.length + index, rootCents) };
  }
  if (!best) throw new Error('No tuning pitch in semantic range.'); return best.pitch;
}
