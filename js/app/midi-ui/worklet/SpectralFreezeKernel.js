import { prepareSpectralFreezeProfile, spectralFreezeIdentity } from '../../../midi/content/SpectralFreezeProfile.js';
import { OwnedRadix2FFT } from './OwnedRadix2FFT.js';
import { createOwnedEffectState } from './OwnedEffectState.js';

const TAU = 2 * Math.PI, wrap = value => value - TAU * Math.floor((value + Math.PI) / TAU);
export class SpectralFreezeKernel {
  constructor({ sampleRate = 48000, parameters = {}, startFrame = 0, sourceAvailable = true } = {}) {
    if (!Number.isSafeInteger(startFrame) || startFrame < 0 || typeof sourceAvailable !== 'boolean') throw new TypeError('Spectral state requires an exact frame and source presence.');
    this.profile = prepareSpectralFreezeProfile(parameters, sampleRate); this.parameters = this.profile.parameters; this.identity = spectralFreezeIdentity(this.profile);
    const n = this.parameters.fftSize, b = this.profile.bins; this.fft = new OwnedRadix2FFT(n);
    this.input = new Float64Array(2 * n); this.overlap = new Float64Array(2 * n); this.real = new Float64Array(n); this.imaginary = new Float64Array(n); this.window = new Float64Array(n);
    this.previousPhase = new Float64Array(2 * b); this.magnitude = new Float64Array(2 * b); this.phase = new Float64Array(2 * b); this.advance = new Float64Array(2 * b); this.analysis = new Float64Array(2 * b); this.capturePeaks = new Float64Array(2); this.captureScales = new Float64Array(2); this.captureScales.fill(1);
    for (let index = 0; index < n; index++) this.window[index] = Math.sqrt(0.5 - 0.5 * Math.cos(TAU * index / n));
    this.frame = startFrame; this.availableFrames = 0; this.capturedRequestFrame = this.captureRequestFrame = this.captureStartFrame = this.captureEndFrame = -1; this.captureSerial = this.faults = 0;
    this.mix = this.leftSample = this.rightSample = this.captureEnergy = 0; this.holdRequested = this.holding = this.muted = this.capturedSilence = false; this.sourceAvailable = sourceAvailable;
    this.stateTransfer = createOwnedEffectState({ kernel: this, identity: this.identity,
      arrays: [this.input, this.overlap, this.previousPhase, this.magnitude, this.phase, this.advance, this.analysis, this.capturePeaks, this.captureScales],
      scalars: [...['frame', 'availableFrames', 'captureRequestFrame', 'capturedRequestFrame', 'captureStartFrame', 'captureEndFrame', 'captureSerial', 'faults', 'mix', 'leftSample', 'rightSample', 'captureEnergy'].map(name => ({ name, type: 'number' })),
        ...['holdRequested', 'holding', 'muted', 'capturedSilence', 'sourceAvailable'].map(name => ({ name, type: 'boolean' }))], validate: data => {
        const frame = data.named('frame'), end = data.named('captureEndFrame'), request = data.named('captureRequestFrame');
        for (const key of ['frame', 'availableFrames', 'captureSerial', 'faults']) if (!Number.isSafeInteger(data.named(key)) || data.named(key) < 0) throw new Error('Invalid spectral frontier.');
        if (data.named('availableFrames') > n || data.named('mix') < 0 || data.named('mix') > 1 || data.named('captureEnergy') < 0 || data.named('captureEnergy') > 2048 * 1024 * 2) throw new Error('Invalid spectral energy or availability.');
        if (!Number.isSafeInteger(request) || request < -1 || request > frame || !Number.isSafeInteger(end) || end < -1 || end > frame || end !== -1 && (end % this.profile.hopFrames !== 0 || data.named('captureStartFrame') !== end - n) || end === -1 && data.named('captureStartFrame') !== -1) throw new Error('Invalid spectral capture interval.');
        const capturedRequest = data.named('capturedRequestFrame');
        if (!Number.isSafeInteger(capturedRequest) || capturedRequest < -1 || (data.named('captureSerial') === 0 ? capturedRequest !== -1 : capturedRequest < 0 || capturedRequest >= end)) throw new Error('Invalid acknowledged spectral request frontier.');
        if (data.named('holding') && (end < 0 || !data.named('holdRequested')) || data.named('captureSerial') === 0 && end !== -1) throw new Error('Unowned spectral hold.');
        for (let index = 0; index < 2 * n; index++) if (Math.abs(data.planes[0].read(index)) > 32 || Math.abs(data.planes[1].read(index)) > 128) throw new Error('Spectral PCM history exceeds its bound.');
        for (let index = 0; index < 2 * b; index++) if (Math.abs(data.planes[2].read(index)) > Math.PI + 1e-12 || data.planes[3].read(index) < 0 || data.planes[3].read(index) > n * 32 ||
            Math.abs(data.planes[4].read(index)) > Math.PI + 1e-12 || Math.abs(data.planes[5].read(index)) > Math.PI * (this.profile.hopFrames + 2) || Math.abs(data.planes[6].read(index)) > Math.PI * (this.profile.hopFrames + 2)) throw new Error('Invalid spectral phase or magnitude state.');
        for (let channel = 0; channel < 2; channel++) if (data.planes[7].read(channel) < 0 || data.planes[7].read(channel) > 32 || data.planes[8].read(channel) < 0 || data.planes[8].read(channel) > 1) throw new Error('Invalid spectral capture normalization.');
        if (Math.abs(data.named('leftSample')) > 64 || Math.abs(data.named('rightSample')) > 64) throw new Error('Invalid spectral output state.');
      } });
  }
  panic() { this.input.fill(0); this.overlap.fill(0); this.previousPhase.fill(0); this.magnitude.fill(0); this.phase.fill(0); this.advance.fill(0); this.analysis.fill(0);
    this.real.fill(0); this.imaginary.fill(0); this.leftSample = this.rightSample = this.mix = 0; this.captureRequestFrame = -1; this.holding = this.holdRequested = false; this.muted = true; }
  sample(left, right, hold = 0, sourceAvailable = this.sourceAvailable) {
    this.leftSample = this.rightSample = 0; if (this.muted) { this.frame++; return; }
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > 32 || Math.abs(right) > 32 || (hold !== 0 && hold !== 1) || typeof sourceAvailable !== 'boolean') { this.faults++; this.panic(); this.frame++; return; }
    const n = this.parameters.fftSize, at = this.frame % n, requested = hold === 1;
    this.sourceAvailable = sourceAvailable; this.availableFrames = sourceAvailable ? Math.min(n, this.availableFrames + 1) : 0;
    if (requested !== this.holdRequested) {
      this.holdRequested = requested;
      if (requested) this.captureRequestFrame = this.frame;
      else { this.holding = false; this.captureRequestFrame = -1; }
    }
    if (!sourceAvailable) this.captureRequestFrame = -1;
    this.leftSample = this.overlap[at]; this.rightSample = this.overlap[n + at]; this.overlap[at] = this.overlap[n + at] = 0;
    this.input[at] = left; this.input[n + at] = right; this.frame++;
    if (this.frame % this.profile.hopFrames === 0) this.processHop();
    if (!Number.isFinite(this.leftSample) || !Number.isFinite(this.rightSample) || Math.abs(this.leftSample) > 64 || Math.abs(this.rightSample) > 64) { this.faults++; this.panic(); }
  }
  processHop() {
    const n = this.parameters.fftSize, bins = this.profile.bins, hop = this.profile.hopFrames, first = this.frame % n;
    const capture = this.captureRequestFrame >= 0 && this.availableFrames === n && this.frame > this.captureRequestFrame;
    if (this.holding && this.frame - this.captureEndFrame >= Math.ceil(this.parameters.maximumHoldSeconds * this.profile.sampleRate)) this.holding = false;
    if (capture && !Number.isSafeInteger(this.captureSerial + 1)) { this.faults++; this.panic(); return; }
    if (capture) { this.capturedRequestFrame = this.captureRequestFrame; this.captureRequestFrame = -1; this.captureStartFrame = this.frame - n; this.captureEndFrame = this.frame; this.captureSerial++; this.captureEnergy = 0; this.capturePeaks.fill(0); this.holding = true; }
    const target = this.holding ? 1 : 0, step = hop / (this.parameters.thawSeconds * this.profile.sampleRate); this.mix += Math.max(-step, Math.min(step, target - this.mix));
    for (let channel = 0; channel < 2; channel++) {
      const base = channel * bins;
      for (let index = 0; index < n; index++) { const value = this.input[channel * n + (first + index) % n]; this.real[index] = value * this.window[index]; this.imaginary[index] = 0; if (capture) { this.captureEnergy += value * value; this.capturePeaks[channel] = Math.max(this.capturePeaks[channel], Math.abs(value)); } }
      this.fft.transform(this.real, this.imaginary);
      for (let bin = 0; bin < bins; bin++) {
        const phase = Math.atan2(this.imaginary[bin], this.real[bin]), expected = TAU * bin * hop / n;
        if (!Number.isFinite(phase)) { this.faults++; this.panic(); return; }
        this.analysis[base + bin] = expected + wrap(phase - this.previousPhase[base + bin] - expected); this.previousPhase[base + bin] = phase;
      }
      if (capture) for (let bin = 0; bin < bins; bin++) {
        const source = bin / this.parameters.pitchRatio, low = Math.floor(source), high = Math.min(bins - 1, low + 1), fraction = source - low, at = base + bin;
        if (low >= bins) { this.magnitude[at] = this.phase[at] = this.advance[at] = 0; continue; }
        let magnitude = Math.hypot(this.real[low], this.imaginary[low]) * (1 - fraction) + Math.hypot(this.real[high], this.imaginary[high]) * fraction;
        if (this.parameters.blur01) { const previous = Math.max(0, low - 1), next = Math.min(bins - 1, high + 1); magnitude = magnitude * (1 - this.parameters.blur01) + (Math.hypot(this.real[previous], this.imaginary[previous]) + magnitude + Math.hypot(this.real[next], this.imaginary[next])) / 3 * this.parameters.blur01; }
        const frequency = bin * this.profile.sampleRate / n; magnitude /= Math.sqrt(1 + (frequency / this.parameters.dampingHz) ** 4);
        const phase = this.previousPhase[base + low]; this.magnitude[at] = magnitude; this.phase[at] = wrap(phase + wrap(this.previousPhase[base + high] - phase) * fraction);
        this.advance[at] = ((1 - fraction) * this.analysis[base + low] + fraction * this.analysis[base + high]) * this.parameters.pitchRatio;
        if (Math.abs(this.advance[at]) > Math.PI * hop) this.magnitude[at] = this.advance[at] = 0;
      }
      if (capture) {
        let spectralPeak = 0; for (let bin = 0; bin < bins; bin++) spectralPeak += this.magnitude[base + bin] * (bin === 0 || bin === bins - 1 ? 1 : 2) / n;
        const scale = spectralPeak > 0 ? Math.min(1, this.capturePeaks[channel] / (2 * spectralPeak)) : 1; this.captureScales[channel] = scale;
        for (let bin = 0; bin < bins; bin++) this.magnitude[base + bin] *= scale;
      }
      if (this.mix > 0) for (let bin = 0; bin < bins; bin++) {
        const at = base + bin; if (!capture) this.phase[at] = wrap(this.phase[at] + this.advance[at]);
        this.real[bin] = this.real[bin] * (1 - this.mix) + Math.cos(this.phase[at]) * this.magnitude[at] * this.mix;
        this.imaginary[bin] = bin === 0 || bin === bins - 1 ? 0 : this.imaginary[bin] * (1 - this.mix) + Math.sin(this.phase[at]) * this.magnitude[at] * this.mix;
        if (bin > 0 && bin < bins - 1) { this.real[n - bin] = this.real[bin]; this.imaginary[n - bin] = -this.imaginary[bin]; }
      }
      this.fft.transform(this.real, this.imaginary, true);
      for (let index = 0; index < n; index++) {
        const at = channel * n + (first + index) % n, value = this.overlap[at] + this.real[index] * this.window[index] * this.profile.overlapNormalization;
        if (!Number.isFinite(value) || Math.abs(value) > 128) { this.faults++; this.panic(); return; } this.overlap[at] = Math.abs(value) < 1e-24 ? 0 : value;
      }
    }
    if (capture) this.capturedSilence = this.captureEnergy === 0;
  }
  captureReceipt() {
    if (!this.captureSerial) return null;
    return Object.freeze({ schema: 'lemmings-spectral-capture/v1', revision: this.profile.revision, configurationKey: this.identity, sampleRate: this.profile.sampleRate, fftSize: this.parameters.fftSize, hopFrames: this.profile.hopFrames,
      serial: this.captureSerial, requestFrame: this.capturedRequestFrame, startFrame: this.captureStartFrame, endFrame: this.captureEndFrame, processedThroughFrame: this.frame, sourceWindowFrames: this.parameters.fftSize, captureEnergy: this.captureEnergy, capturedSilence: this.capturedSilence, capturePeaks: Object.freeze(Array.from(this.capturePeaks)), captureScales: Object.freeze(Array.from(this.captureScales)), acousticReceipt: false });
  }
  snapshotInto(bytes) { return this.stateTransfer.write(bytes); }
  restoreFrom(bytes) { return this.stateTransfer.restore(bytes); }
  get snapshotBytes() { return this.stateTransfer.byteLength; }
  diagnostics() { return { revision: this.profile.revision, frame: this.frame, captureSerial: this.captureSerial, capturedRequestFrame: this.capturedRequestFrame, captureRequestFrame: this.captureRequestFrame,
    captureStartFrame: this.captureStartFrame, captureEndFrame: this.captureEndFrame, capturedSilence: this.capturedSilence, sourceAvailable: this.sourceAvailable,
    state: this.muted ? 'quarantined' : this.holding ? 'frozen' : this.mix > 0 ? 'releasing' : !this.sourceAvailable ? 'source-unavailable' : this.captureRequestFrame >= 0 ? 'capture-pending' : this.availableFrames < this.parameters.fftSize ? 'warming' : 'ready',
    captureNormalization: this.profile.captureNormalization, capturePeaks: Array.from(this.capturePeaks), captureScales: Array.from(this.captureScales), mix: this.mix, faults: this.faults, latencyFrames: this.profile.processingLatencyFrames, phaseMode: this.profile.phaseMode, portableMaterial: false }; }
}
