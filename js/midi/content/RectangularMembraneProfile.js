import { cloneData, freezeData, canonicalDataText, encodeUtf8 } from '../../core/CanonicalData.js';

export const RECTANGULAR_MEMBRANE_REVISION = 'owned-dirichlet-membrane-fd5-finite-strikes-v3';
export const MEMBRANE_STRIKE_QUEUE_CAPACITY = 64, MEMBRANE_STRIKE_VOICES = 4, MEMBRANE_STRIKE_RECEIPTS = 128, MEMBRANE_STRIKE_WIDTH = 8, MEMBRANE_STRIKE_RECEIPT_WIDTH = 4;
export const MEMBRANE_CONTROLS = Object.freeze(['strikeX01', 'strikeY01', 'pickupLeftX01', 'pickupLeftY01', 'pickupRightX01', 'pickupRightY01', 'damp01']);
export const MEMBRANE_TOUCH_CONTROLS = Object.freeze(Array.from({ length: 4 }, (_, index) => ['X01', 'Y01', 'Radius01', 'Amount01'].map(suffix => 'touch' + index + suffix)).flat());
export const MEMBRANE_LIVE_CONTROLS = Object.freeze([...MEMBRANE_CONTROLS, ...MEMBRANE_TOUCH_CONTROLS]);
export const membraneControlValid = (name, value) => MEMBRANE_LIVE_CONTROLS.includes(name) && Number.isFinite(value) && value >= (name.endsWith('Radius01') ? 0.08 : 0) && value <= (name.endsWith('Radius01') ? 0.18 : 1);
export const membraneControlTarget = (name, value) => name.endsWith('Radius01') ? Math.max(0.08, Math.min(0.18, Math.fround(value))) : Math.fround(value);
export const membraneTouchSupported = (size, x, y, radius) => { const n = size - 1, dx = x - Math.round(x * n) / n, dy = y - Math.round(y * n) / n; return dx * dx + dy * dy < radius * radius; };
export const membraneInitialControl = (name, parameters) => MEMBRANE_CONTROLS.includes(name) ? parameters[name] : name.endsWith('Radius01') ? 0.12 : name.endsWith('Amount01') ? 0 : 0.5;
export function prepareRectangularMembraneProfile(raw, sampleRate = 48000) {
  const p = { ...cloneData(raw, { maxBytes: 8192, maxNodes: 128 }) }, finite = (x, a, b) => Number.isFinite(x) && x >= a && x <= b;
  if (![44100, 48000, 96000].includes(sampleRate) || !p || Object.getPrototypeOf(p) !== Object.prototype ||
      Object.keys(p).some(key => !['gridSize', 'fundamentalHz', 'decaySeconds', 'excitationGain01', ...MEMBRANE_CONTROLS].includes(key)) ||
      ![8, 16].includes(p.gridSize) || !finite(p.fundamentalHz, 40, 1000) || !finite(p.decaySeconds, 0.05, 4) || !finite(p.excitationGain01, 0, 1) ||
      MEMBRANE_CONTROLS.some(key => !finite(p[key], 0, 1))) throw new TypeError('Invalid bounded rectangular membrane profile.');
  for (const key of MEMBRANE_CONTROLS) p[key] = Math.fround(p[key]);
  const size = p.gridSize, minimumEigenvalue = 8 * Math.sin(Math.PI / (2 * (size + 1))) ** 2, maximumEigenvalue = 8 - minimumEigenvalue;
  const lambdaSquared = 4 * Math.sin(Math.PI * p.fundamentalHz / sampleRate) ** 2 / minimumEigenvalue;
  if (!(lambdaSquared > 0 && lambdaSquared <= 0.49)) throw new RangeError('Membrane tuning exceeds the five-point two-dimensional Courant domain.');
  const loss = seconds => { const ratio = Math.exp(-2 * Math.log(1000) / (seconds * sampleRate)); return (1 - ratio) / (1 + ratio); };
  const positivityMargin = 1 - lambdaSquared * maximumEigenvalue / 4;
  const displacementBound = Math.sqrt(2 / (lambdaSquared * minimumEigenvalue)) + 0.5 * Math.sqrt(2 / positivityMargin);
  const pulses = [4, 8, 12].map(milliseconds => { const frames = Math.ceil(sampleRate * milliseconds / 1000), coefficients = Array.from({ length: frames }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (frames - 1))), sum = coefficients.reduce((a, b) => a + b, 0); return { milliseconds, frames, coefficients: coefficients.map(value => value / sum) }; });
  const pulseBytes = pulses.reduce((sum, pulse) => sum + pulse.frames * 8, 0), strikeStateBytes = ((MEMBRANE_STRIKE_QUEUE_CAPACITY + MEMBRANE_STRIKE_VOICES) * MEMBRANE_STRIKE_WIDTH + MEMBRANE_STRIKE_RECEIPTS * MEMBRANE_STRIKE_RECEIPT_WIDTH + 16) * 8;
  const profile = { revision: RECTANGULAR_MEMBRANE_REVISION, sampleRate, parameters: p, nodeCount: size * size, stride: size + 2,
    lambdaSquared, minimumEigenvalue, maximumEigenvalue, positivityMargin, displacementBound, outputScale: 0.8 / displacementBound,
    longLoss: loss(p.decaySeconds), shortLoss: loss(Math.max(0.01, p.decaySeconds / 12)), touchLoss: loss(0.01), maximumEnergy: 1, pulses, pulseBytes, strikeStateBytes,
    stateBytes: ((size + 2) ** 2 * 3 + MEMBRANE_CONTROLS.length * 2 + 11 + 16 + size * size * 3) * 8 + pulseBytes + strikeStateBytes,
    maximumTailFrames: Math.ceil(p.decaySeconds * 2 * sampleRate), processingLatencyFrames: 0, maximumLinearGain: 1, maximumOutputAmplitude: 0.800001,
    gainBoundDomain: 'absolute-pickup-peak-under-discrete-energy-cap;not-linear-input-gain',
    formulation: 'centered-time-five-point-laplacian-with-centered-velocity-positive-loss', boundary: 'fixed-zero-Dirichlet-one-cell-halo',
    surfaceUnits: 'normalized-interior-grid-coordinate;not-meters-or-force', stereoInput: 'arithmetic-mean-L-plus-R;opposite-polarity-cancels',
    excitationPolicy: 'bilinear-L1-one;combined-spatial-force-L2-triangle-cap;normalized-audio-or-finite-model-force',
    strikeInput: { revision: 'frame-addressed-area-normalized-raised-cosine-v1', maximumExciters: MEMBRANE_STRIKE_VOICES, queueCapacity: MEMBRANE_STRIKE_QUEUE_CAPACITY, receiptCapacity: MEMBRANE_STRIKE_RECEIPTS, pulseMilliseconds: [4, 8, 12], units: 'normalized-model-impulse-area;not-Newtons', tailReference: 'after-last-admitted-finite-exciter;no-new-semantic-onsets-from-envelope-frames', frameRounding: 'ceil-duration-to-source-sample-grid' },
    pickupPolicy: 'independent-bilinear-L1-one-observation;no-state-or-energy-change',
    tuningPolicy: 'prepared-revision-only;old-body-keeps-tail;no-unmatched-state-projection',
    controlPolicy: 'float32-targets;sample-frame-step-targets;eight-millisecond-coordinate-and-positive-loss-field-slew',
    preparation: { maximumTouches: 4, radius01: [0.08, 0.18], aggregation: 'maximum-of-normalized-parabolic-disc-loss-fields', effect: 'centered-velocity-loss-only;no-stiffness-mass-or-excitation', underresolvedPolicy: 'decline-active-patch-with-no-interior-grid-support', maximumLossAmplitudeT60Seconds: 0.01 },
    cost: { gridUpdatesPerFrame: size * size, energyEdgeProductsPerFrame: 2 * size * (size + 1), touchFieldSlewsPerFrame: size * size, touchDistanceProductsPerFieldRebuild: size * size * 4, maximumTouchFieldRebuildsPerFrame: 1, touchParameterReadsPerFrameWhenVarying: 16, maximumFiniteExcitersPerFrame: MEMBRANE_STRIKE_VOICES, maximumStrikeHeapDepth: 6, forceNormAndInjectionNodesPerFrame: size * size, substeps: 1, updateRate: sampleRate },
    qualification: 'implementation-awaiting-independent-dispersion-energy-deadline-and-listening-qualification' };
  profile.configurationBytes = encodeUtf8(rectangularMembraneIdentity(profile)).length; profile.stateBytes += profile.configurationBytes;
  return freezeData(profile);
}
export const rectangularMembraneIdentity = p => canonicalDataText({ revision: p.revision, sampleRate: p.sampleRate, parameters: p.parameters,
  realization: [p.lambdaSquared, p.longLoss, p.shortLoss, p.touchLoss, p.outputScale], pulses: p.pulses, boundary: p.boundary }).text;
