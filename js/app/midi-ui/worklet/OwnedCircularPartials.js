import { circularSpectrumWeight } from '../../../midi/content/CircularSpectrum.js';

// Ten fixed additive slots share the spectral source's prepared sine reader.
// Reindexing keeps in-band carrier phases and recycles only zero-weight guards.
export class OwnedCircularPartials {
  constructor(recipe, { state = null, partials = null } = {}) {
    this.recipe = { sampleRate: recipe.sampleRate, referenceFrequencyHz: recipe.referenceFrequencyHz, frequencyCenterHz: recipe.frequencyCenterHz, spectralWidthOctaves: recipe.spectralWidthOctaves, resolvedBandLowHz: recipe.resolvedBandLowHz, resolvedBandHighHz: recipe.resolvedBandHighHz, partialCountCap: recipe.partialCountCap, weight01: recipe.weight01, minimumIndex: recipe.minimumIndex, maximumIndex: recipe.maximumIndex };
    this.state = state || new Float64Array(12); this.partials = partials || new Float64Array(60);
    if (!(this.state instanceof Float64Array) || this.state.length !== 12 || !(this.partials instanceof Float64Array) || this.partials.length !== 60) throw new TypeError('Circular partials require their fixed prepared state planes.');
    this.state.fill(0); this.partials.fill(0);
  }
  configure(reference, center, width, low, high, count, weight) {
    const r = this.recipe, minimum = Math.floor(Math.log2(low / reference)) - 1;
    if (!Number.isFinite(reference) || !Number.isFinite(center) || !Number.isFinite(width) || !Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(weight) || reference <= 0 || center <= low || center >= high || width < 0.25 || width > 3 || low < 20 || high > this.recipe.sampleRate * 0.4 || high < low * 2 || !Number.isInteger(count) || count < 8 || count > 10 || weight < 0 || weight > 1 || count < Math.ceil(Math.log2(high / low)) + 3 || minimum + count - 1 < Math.ceil(Math.log2(high / reference))) return false;
    r.referenceFrequencyHz = reference; r.frequencyCenterHz = center; r.spectralWidthOctaves = width; r.resolvedBandLowHz = low; r.resolvedBandHighHz = high; r.partialCountCap = count; r.weight01 = weight; r.minimumIndex = minimum; r.maximumIndex = minimum + count - 1;
    return true;
  }
  reset(phase, seed = 0) {
    if (!Number.isFinite(phase) || Math.abs(phase) > 1000000 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Invalid circular phase origin or owned seed.');
    const s = this.state, p = this.partials, recipe = this.recipe; s.fill(0); p.fill(0); s[0] = s[1] = phase; s[4] = Math.floor(phase); s[5] = seed;
    for (let slot = 0; slot < recipe.partialCountCap; slot++) { const at = slot * 6; p[at] = recipe.minimumIndex + slot; p[at + 1] = this.seedPhase(p[at] - s[4]); }
    this.refresh(true);
  }
  seedPhase(index) {
    let value = (this.state[5] ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0; value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b); value ^= value >>> 13;
    return (value >>> 0) / 4294967296;
  }
  setSegment(from, to, frames, firstFrame = 0) {
    if (!Number.isFinite(from) || Math.abs(from) > 1000000 || !Number.isFinite(to) || Math.abs(to) > 1000000 || !Number.isSafeInteger(firstFrame) || firstFrame < 0 || !Number.isInteger(frames) || frames < 1 || frames > this.recipe.sampleRate * 2 ||
        Math.abs(from - this.state[0]) > 1e-7 || Math.abs(to - from) / frames * this.recipe.sampleRate > 4) return false;
    const s = this.state; s[1] = to; s[2] = frames; s[3] = (to - from) / frames; s[6] = 2 ** s[3]; s[9] = firstFrame; return true;
  }
  refresh(initial = false) {
    const s = this.state, p = this.partials, r = this.recipe, whole = Math.floor(s[0]), shift = whole - s[4], fraction = s[0] - whole;
    let total = 0;
    for (let slot = 0; slot < r.partialCountCap; slot++) {
      const at = slot * 6; let index = p[at] + shift;
      if (index < r.minimumIndex || index > r.maximumIndex) {
        // Segment admission limits motion to four cycles/second. The outer
        // guards are already outside the authored band at this handoff.
        index = r.minimumIndex + ((index - r.minimumIndex) % r.partialCountCap + r.partialCountCap) % r.partialCountCap;
        p[at + 1] = this.seedPhase(index - whole); p[at + 3] = 0;
      }
      p[at] = index; p[at + 2] = r.referenceFrequencyHz * 2 ** (index + fraction); p[at + 4] = circularSpectrumWeight(r, p[at + 2]); total += p[at + 4];
    }
    const gain = 0.8 * r.weight01 / Math.max(1e-20, total);
    for (let slot = 0; slot < r.partialCountCap; slot++) { const at = slot * 6; p[at + 4] *= gain; if (initial) p[at + 3] = p[at + 4]; }
    s[4] = whole; s[7] = 8;
  }
  sample(sineAt, frame = 0) {
    const s = this.state, p = this.partials, r = this.recipe;
    if (s[7] <= 0 || Math.floor(s[0]) !== s[4]) this.refresh();
    let output = 0, active = 0;
    for (let slot = 0; slot < r.partialCountCap; slot++) {
      const at = slot * 6; p[at + 3] += (p[at + 4] - p[at + 3]) / s[7];
      // The explicit cull also silences a slot that crossed a band edge between
      // coefficient refreshes, before it can be recycled at an octave wrap.
      if (p[at + 2] > r.resolvedBandLowHz && p[at + 2] < r.resolvedBandHighHz && p[at + 3] > 0) { output += sineAt(p[at + 1]) * p[at + 3]; active++; }
      const phase = p[at + 1] + p[at + 2] / r.sampleRate; p[at + 1] = phase - Math.floor(phase);
      if (s[2] && frame >= s[9]) p[at + 2] *= s[6];
    }
    s[7]--; s[8] = active;
    if (s[2] && frame >= s[9]) { s[0] += s[3]; if (--s[2] === 0) s[0] = s[1]; }
    return output;
  }
}
