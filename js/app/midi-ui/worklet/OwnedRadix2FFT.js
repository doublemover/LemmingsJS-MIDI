export class OwnedRadix2FFT {
  constructor(size, { offlineMaximumSize = 2048 } = {}) {
    if (!Number.isSafeInteger(offlineMaximumSize) || offlineMaximumSize < 2048 || offlineMaximumSize > 65536 || (offlineMaximumSize & (offlineMaximumSize - 1)) ||
        !Number.isSafeInteger(size) || size < 512 || size > offlineMaximumSize || (size & (size - 1))) throw new RangeError('The prepared FFT size is unavailable.');
    this.size = size; this.reverse = new Uint32Array(size); this.cos = new Float64Array(size / 2); this.sin = new Float64Array(size / 2);
    const bits = Math.log2(size);
    for (let index = 0; index < size; index++) { let value = index, reversed = 0; for (let bit = 0; bit < bits; bit++) { reversed = reversed * 2 + (value & 1); value >>>= 1; } this.reverse[index] = reversed; }
    for (let index = 0; index < size / 2; index++) { const angle = 2 * Math.PI * index / size; this.cos[index] = Math.cos(angle); this.sin[index] = Math.sin(angle); }
  }
  transform(real, imaginary, inverse = false) {
    const n = this.size;
    for (let index = 0; index < n; index++) { const target = this.reverse[index]; if (target > index) {
      let value = real[index]; real[index] = real[target]; real[target] = value; value = imaginary[index]; imaginary[index] = imaginary[target]; imaginary[target] = value;
    } }
    for (let width = 2; width <= n; width *= 2) {
      const half = width / 2, step = n / width;
      for (let first = 0; first < n; first += width) for (let offset = 0; offset < half; offset++) {
        const at = first + offset, other = at + half, twiddle = offset * step, c = this.cos[twiddle], s = inverse ? this.sin[twiddle] : -this.sin[twiddle];
        const x = real[other] * c - imaginary[other] * s, y = real[other] * s + imaginary[other] * c, a = real[at], b = imaginary[at];
        real[at] = a + x; imaginary[at] = b + y; real[other] = a - x; imaginary[other] = b - y;
      }
    }
    if (inverse) for (let index = 0; index < n; index++) { real[index] /= n; imaginary[index] /= n; }
  }
}
