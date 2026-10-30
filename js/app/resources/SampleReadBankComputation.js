import { SAMPLE_READ_TAPS as TAPS, SAMPLE_READ_PHASES as PHASES, SAMPLE_READ_RATE_STEPS as STEPS, SAMPLE_READ_LEVELS as LEVELS, SAMPLE_READ_QUANTIZATION as SCALE, SAMPLE_READ_TABLE_SAMPLES } from '../../midi/content/SampleReadProfile.js';

// Original Blackman-windowed sinc rows. Quantization and exact DC repair make
// the generated artifact independent of irrelevant last-bit transcendental noise.
function fillRow(plane, row, workspace) {
  const level = Math.floor(row / (PHASES + 1)), phase = row % (PHASES + 1) / PHASES, cutoff = 0.4 / 2 ** (level / STEPS), first = row * TAPS, half = TAPS / 2;
  let sum = 0;
  for (let tap = 0; tap < TAPS; tap++) {
    const x = tap - (half - 1) - phase, angle = Math.PI * x / half, window = Math.abs(x) >= half ? 0 : 0.42 + 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
    const value = (x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)) * window; workspace[tap] = value; sum += value;
  }
  if (!Number.isFinite(sum) || Math.abs(sum) < 0.5) throw new Error('Invalid sample read filter normalization.');
  let integers = 0;
  for (let tap = 0; tap < TAPS; tap++) { const value = Math.round(workspace[tap] / sum * SCALE); integers += value; plane[first + tap] = value / SCALE || 0; }
  const center = first + half - 1 + Math.round(phase); plane[center] += (SCALE - integers) / SCALE;
}
export function createSampleReadBankSync() {
  const plane = new Float32Array(SAMPLE_READ_TABLE_SAMPLES), workspace = new Float64Array(TAPS);
  for (let row = 0; row < LEVELS * (PHASES + 1); row++) fillRow(plane, row, workspace); return plane;
}
export async function computeSampleReadBank({ signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) throw new Error('Sample read coefficient owner changed.'); };
  check(); const plane = new Float32Array(SAMPLE_READ_TABLE_SAMPLES), workspace = new Float64Array(TAPS);
  for (let row = 0; row < LEVELS * (PHASES + 1); row++) { fillRow(plane, row, workspace); if ((row & 15) === 15) { check(); await yieldControl(); } }
  check(); return plane;
}
export function sampleReadMaximumL1(plane) {
  if (!(plane instanceof Float32Array) || plane.length !== SAMPLE_READ_TABLE_SAMPLES) throw new TypeError('Invalid sample read coefficient storage.');
  let maximum = 0;
  for (let row = 0; row < LEVELS * (PHASES + 1); row++) { let sum = 0; for (let tap = 0; tap < TAPS; tap++) { const value = plane[row * TAPS + tap]; if (!Number.isFinite(value)) throw new Error('Nonfinite sample read coefficient.'); sum += Math.abs(value); } maximum = Math.max(maximum, sum); }
  return maximum;
}
