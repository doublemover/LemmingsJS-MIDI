export function createSoundSpectrumPlan(size, { windowFrames = size, nonfinitePolicy = 'reject' } = {}) {
  if (!Number.isSafeInteger(size) || size < 16 || size > 32768 || (size & (size - 1)) || !Number.isSafeInteger(windowFrames) || windowFrames < 1 || windowFrames > size ||
      !['reject', 'zero-for-diagnostic'].includes(nonfinitePolicy)) throw new TypeError('Invalid bounded spectral transform plan.');
  const real = new Float64Array(size), imaginary = new Float64Array(size), window = new Float64Array(size), reverse = new Uint16Array(size), cosine = new Float64Array(size - 1), sine = new Float64Array(size - 1);
  let windowSumSquares = 0, offset = 0;
  for (let i = 0; i < windowFrames; i++) { const value = windowFrames === 1 ? 1 : 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (windowFrames - 1)); window[i] = value; windowSumSquares += value * value; }
  if (!windowSumSquares) throw new TypeError('Spectral window has no energy.');
  for (let i = 1, j = 0; i < size; i++) { let bit = size >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; reverse[i] = j; }
  for (let width = 2; width <= size; width <<= 1) { const angle = -2 * Math.PI / width;
    for (let j = 0; j < width / 2; j++) { cosine[offset + j] = Math.cos(angle * j); sine[offset + j] = Math.sin(angle * j); } offset += width / 2;
  }
  return Object.freeze({ size, windowFrames, bins: size / 2 + 1, windowSumSquares, mutableWorkspaceBytes: real.byteLength + imaginary.byteLength,
    writePower(samples, first, destination) {
      if (!(samples instanceof Float32Array || samples instanceof Float64Array) || !Number.isSafeInteger(first) || first < 0 || first > samples.length ||
          !(destination instanceof Float64Array) || destination.length !== size / 2 + 1 || destination.buffer === samples.buffer) throw new TypeError('Invalid spectral transform input or exclusive destination.');
      imaginary.fill(0);
      for (let i = 0; i < size; i++) {
        const value = first + i < samples.length ? samples[first + i] : 0;
        if (!Number.isFinite(value) && nonfinitePolicy === 'reject') throw new TypeError('Nonfinite spectral input.');
        real[i] = (Number.isFinite(value) ? value : 0) * window[i];
      }
      for (let i = 1; i < size; i++) if (i < reverse[i]) { const value = real[i]; real[i] = real[reverse[i]]; real[reverse[i]] = value; }
      let offset = 0;
      for (let width = 2; width <= size; width <<= 1) {
        for (let first = 0; first < size; first += width) for (let j = 0; j < width / 2; j++) {
          const at = first + j, other = at + width / 2, cos = cosine[offset + j], sin = sine[offset + j];
          const r = real[other] * cos - imaginary[other] * sin, im = real[other] * sin + imaginary[other] * cos;
          real[other] = real[at] - r; imaginary[other] = imaginary[at] - im; real[at] += r; imaginary[at] += im;
        }
        offset += width / 2;
      }
      for (let bin = 0; bin < destination.length; bin++) destination[bin] = real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
      return destination;
    }
  });
}
