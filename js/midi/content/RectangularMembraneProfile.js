import { cloneData, freezeData, canonicalDataText, encodeUtf8 } from '../../core/CanonicalData.js';

export const RECTANGULAR_MEMBRANE_REVISION = 'owned-dirichlet-membrane-fd5-energy-v1';
export const MEMBRANE_CONTROLS = Object.freeze(['strikeX01', 'strikeY01', 'pickupLeftX01', 'pickupLeftY01', 'pickupRightX01', 'pickupRightY01', 'damp01']);
export function prepareRectangularMembraneProfile(raw, sampleRate = 48000) {
  const p = cloneData(raw, { maxBytes: 8192, maxNodes: 128 }), finite = (x, a, b) => Number.isFinite(x) && x >= a && x <= b;
  if (![44100, 48000, 96000].includes(sampleRate) || !p || Object.getPrototypeOf(p) !== Object.prototype ||
      Object.keys(p).some(key => !['gridSize', 'fundamentalHz', 'decaySeconds', 'excitationGain01', ...MEMBRANE_CONTROLS].includes(key)) ||
      ![8, 16].includes(p.gridSize) || !finite(p.fundamentalHz, 40, 1000) || !finite(p.decaySeconds, 0.05, 4) || !finite(p.excitationGain01, 0, 1) ||
      MEMBRANE_CONTROLS.some(key => !finite(p[key], 0, 1))) throw new TypeError('Invalid bounded rectangular membrane profile.');
  const size = p.gridSize, minimumEigenvalue = 8 * Math.sin(Math.PI / (2 * (size + 1))) ** 2, maximumEigenvalue = 8 - minimumEigenvalue;
  const lambdaSquared = 4 * Math.sin(Math.PI * p.fundamentalHz / sampleRate) ** 2 / minimumEigenvalue;
  if (!(lambdaSquared > 0 && lambdaSquared <= 0.49)) throw new RangeError('Membrane tuning exceeds the five-point two-dimensional Courant domain.');
  const loss = seconds => { const ratio = Math.exp(-2 * Math.log(1000) / (seconds * sampleRate)); return (1 - ratio) / (1 + ratio); };
  const positivityMargin = 1 - lambdaSquared * maximumEigenvalue / 4;
  const displacementBound = Math.sqrt(2 / (lambdaSquared * minimumEigenvalue)) + 0.5 * Math.sqrt(2 / positivityMargin);
  const profile = { revision: RECTANGULAR_MEMBRANE_REVISION, sampleRate, parameters: p, nodeCount: size * size, stride: size + 2,
    lambdaSquared, minimumEigenvalue, maximumEigenvalue, positivityMargin, displacementBound, outputScale: 0.8 / displacementBound,
    longLoss: loss(p.decaySeconds), shortLoss: loss(Math.max(0.01, p.decaySeconds / 12)), maximumEnergy: 1,
    stateBytes: ((size + 2) ** 2 * 3 + MEMBRANE_CONTROLS.length * 2 + 10) * 8,
    maximumTailFrames: Math.ceil(p.decaySeconds * 2 * sampleRate), processingLatencyFrames: 0, maximumLinearGain: 1, maximumOutputAmplitude: 0.800001,
    gainBoundDomain: 'absolute-pickup-peak-under-discrete-energy-cap;not-linear-input-gain',
    formulation: 'centered-time-five-point-laplacian-with-centered-velocity-positive-loss', boundary: 'fixed-zero-Dirichlet-one-cell-halo',
    surfaceUnits: 'normalized-interior-grid-coordinate;not-meters-or-force', stereoInput: 'arithmetic-mean-L-plus-R;opposite-polarity-cancels',
    excitationPolicy: 'bilinear-L1-one;normalized-audio-drive;energy-norm-triangle-cap-before-injection',
    pickupPolicy: 'independent-bilinear-L1-one-observation;no-state-or-energy-change',
    tuningPolicy: 'prepared-revision-only;old-body-keeps-tail;no-unmatched-state-projection',
    controlPolicy: 'eight-millisecond-coordinate-and-positive-loss-slew',
    cost: { gridUpdatesPerFrame: size * size, energyEdgeProductsPerFrame: 2 * size * (size + 1), substeps: 1, updateRate: sampleRate },
    qualification: 'implementation-awaiting-independent-dispersion-energy-deadline-and-listening-qualification' };
  profile.configurationBytes = encodeUtf8(rectangularMembraneIdentity(profile)).length; profile.stateBytes += profile.configurationBytes;
  return freezeData(profile);
}
export const rectangularMembraneIdentity = p => canonicalDataText({ revision: p.revision, sampleRate: p.sampleRate, parameters: p.parameters,
  realization: [p.lambdaSquared, p.longLoss, p.shortLoss, p.outputScale], boundary: p.boundary }).text;
