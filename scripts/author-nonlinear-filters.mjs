import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const tables = [2, 4].map(factor => {
  const taps = factor * 16 + 1, center = (taps - 1) / 2, cutoff = 0.45 / factor;
  const coefficients = Array.from({ length: taps }, (_, index) => {
    const t = index - center, sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    return sinc * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (taps - 1)));
  });
  const sum = coefficients.reduce((a, b) => a + b, 0);
  for (let i = 0; i < taps; i++) coefficients[i] /= sum;
  return { factor, designRevision: 'hann-sinc-16-output-frames-v1', cutoffCyclesPerInternalSample: cutoff, coefficients,
    coefficientHash: createHash('sha256').update(JSON.stringify(coefficients)).digest('hex'), l1: coefficients.reduce((a, b) => a + Math.abs(b), 0),
    filterPairGroupDelayFrames: (taps - 1) / factor, precision: 'binary64-source-coefficients' };
});
await writeFile(new URL('../js/midi/content/NonlinearFilterTables.js', import.meta.url),
  '// Authored by scripts/author-nonlinear-filters.mjs; fixed original Hann-windowed sinc designs.\nexport const NONLINEAR_FILTER_TABLES = Object.freeze(' + JSON.stringify(tables, null, 2) + '.map(entry => Object.freeze({ ...entry, coefficients: Object.freeze(entry.coefficients) })));\n');
