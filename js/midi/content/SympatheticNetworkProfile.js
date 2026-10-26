import { cloneData, freezeData, canonicalDataText, encodeUtf8 } from '../../core/CanonicalData.js';

export const SYMPATHETIC_NETWORK_REVISION = 'owned-contractive-complex-modal-network-signed-reference-input-v4';
export const NETWORK_LOSS_CONTROLS = Object.freeze(Array.from({ length: 4 }, (_, index) => 'modeLoss' + index + 'Amount01'));
export const NETWORK_PICKUP_CONTROLS = Object.freeze(['pickupLeftX01', 'pickupLeftY01', 'pickupRightX01', 'pickupRightY01']);
export const NETWORK_POINT_LOSS_OPERATOR = 'signed-rank-one-modal-velocity-v1';
export function prepareSympatheticNetworkProfile(raw, sampleRate = 48000) {
  const p = cloneData(raw, { maxBytes: 262144, maxNodes: 16384 }), allowed = ['bodies', 'edges', 'couple01', 'damp01', 'lossMasks', 'pickupGrid', 'excitationWeights', 'excitationReferenceNorm'];
  const id = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9._:-]{0,95}$/.test(value), finite = (x, a, b) => Number.isFinite(x) && x >= a && x <= b;
  const keys = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => names.includes(key));
  if (![44100, 48000, 96000].includes(sampleRate) || !keys(p, allowed) || !Array.isArray(p.bodies) || p.bodies.length < 1 || p.bodies.length > 64 || !Array.isArray(p.edges) || p.edges.length > 512 || !finite(p.couple01, 0, 1) || !finite(p.damp01, 0, 1)) throw new TypeError('Invalid bounded sympathetic network.');
  const ids = new Map(), modes = []; let excitationNorm = 0, pickupNorm = 0, longest = 0, maximumRadius = 0;
  for (const [bodyIndex, body] of p.bodies.entries()) {
    if (!keys(body, ['id', 'modes', 'excitation01', 'pickup01']) || !id(body.id) || ids.has(body.id) || !finite(body.excitation01, 0, 1) || !finite(body.pickup01, 0, 1) || !Array.isArray(body.modes) || !body.modes.length || body.modes.length > 8) throw new TypeError('Invalid sympathetic body identity, routes or modes.');
    const first = modes.length;
    for (const [modeIndex, mode] of body.modes.entries()) {
      if (!keys(mode, ['frequencyHz', 'decaySeconds', 'gain01']) || !finite(mode.frequencyHz, 20, sampleRate * 0.2) || !finite(mode.decaySeconds, 0.05, 4) || !finite(mode.gain01, 0, 1)) throw new RangeError('Sympathetic mode exceeds its frequency, loss or gain domain.');
      const angle = 2 * Math.PI * mode.frequencyHz / sampleRate, longRadius = Math.exp(-Math.log(1000) / (mode.decaySeconds * 1.5 * sampleRate)), shortRadius = Math.exp(-Math.log(1000) / (mode.decaySeconds * 0.25 * sampleRate));
      const excitation = body.excitation01 * mode.gain01, pickup = body.pickup01 * mode.gain01; excitationNorm += excitation * excitation; pickupNorm += pickup * pickup;
      maximumRadius = Math.max(maximumRadius, longRadius); longest = Math.max(longest, mode.decaySeconds * 1.5);
      modes.push({ bodyIndex, bodyId: body.id, modeIndex, frequencyHz: mode.frequencyHz, cosine: Math.cos(angle), sine: Math.sin(angle), longRadius, shortRadius, excitation, pickup });
    }
    ids.set(body.id, { first, count: body.modes.length });
  }
  if (modes.length > 512 || excitationNorm === 0 || pickupNorm === 0) throw new RangeError('A shared body requires bounded audible excitation and pickup routes.');
  if (p.excitationWeights != null) {
    if (!Array.isArray(p.excitationWeights) || p.excitationWeights.length !== modes.length || p.excitationWeights.some(value => !finite(value, -1, 1)) || !finite(p.excitationReferenceNorm, 1e-12, Math.sqrt(512))) throw new TypeError('A signed excitation field needs one bounded weight per mode and an explicit common reference norm.');
    excitationNorm = 0;
    for (let index = 0; index < modes.length; index++) { const value = p.excitationWeights[index]; modes[index].excitation = value; excitationNorm += value * value; }
    if (excitationNorm === 0 || Math.sqrt(excitationNorm) > p.excitationReferenceNorm * (1 + 1e-12)) throw new RangeError('The selected signed excitation exceeds its common reference or has no response.');
  } else if (p.excitationReferenceNorm != null) throw new TypeError('An excitation reference requires the explicit signed vector.');
  let pickupGrid = null;
  if (p.pickupGrid != null) {
    const grid = p.pickupGrid, point = value => keys(value, ['x01', 'y01']) && finite(value.x01, 0, 1) && finite(value.y01, 0, 1);
    if (!keys(grid, ['id', 'width', 'height', 'weights', 'leftPosition', 'rightPosition', 'fieldRevision', 'sourceAssetHash', 'sourceFieldHash']) || !id(grid.id) || !Number.isInteger(grid.width) || grid.width < 2 || grid.width > 4 || !Number.isInteger(grid.height) || grid.height < 2 || grid.height > 4 ||
        !point(grid.leftPosition) || !point(grid.rightPosition) || !Array.isArray(grid.weights) || grid.weights.length !== grid.width * grid.height * modes.length || grid.weights.some(value => !finite(value, -1, 1))) throw new TypeError('Pickup observation needs a bounded authored grid of signed mode weights and two normalized positions.');
    if (grid.fieldRevision != null || grid.sourceAssetHash != null || grid.sourceFieldHash != null) {
      if (!['solved-tet4-edge-v1', 'solved-tet4-surface-v1'].includes(grid.fieldRevision) || !/^[a-f0-9]{64}$/.test(grid.sourceAssetHash) || !/^[a-f0-9]{64}$/.test(grid.sourceFieldHash)) throw new TypeError('A solved pickup field requires its exact source asset and generated field hashes.');
    }
    let maximumSquaredNorm = 0;
    for (let at = 0; at < grid.weights.length; at += modes.length) { let sum = 0; for (let mode = 0; mode < modes.length; mode++) sum += grid.weights[at + mode] ** 2; maximumSquaredNorm = Math.max(maximumSquaredNorm, sum); }
    if (maximumSquaredNorm === 0 || maximumSquaredNorm > 1) throw new RangeError('Each authored pickup vector must retain its declared relative gain within the unit L2 observation bound.');
    pickupGrid = { ...grid, maximumSquaredNorm, interpolation: grid.fieldRevision === 'solved-tet4-surface-v1' ? 'piecewise-affine-on-qualified-Tet4-boundary-triangles' : 'bilinear-convex-signed-mode-weights', units: grid.fieldRevision ? 'normalized-projection-of-solved-nodal-displacements;referenced-field-receipt;not-acoustic-calibration' : 'normalized-authored-observation-field;not-a-solved-geometric-mode-shape' };
  }
  if (p.lossMasks != null && (!Array.isArray(p.lossMasks) || p.lossMasks.length > 4 || new Set(p.lossMasks.map(mask => mask?.id)).size !== p.lossMasks.length)) throw new TypeError('Prepare at most four unique authored mode-loss masks.');
  const lossMasks = (p.lossMasks || []).map(mask => {
    if (mask?.operator === NETWORK_POINT_LOSS_OPERATOR) {
      if (!keys(mask, ['id', 'operator', 'extraAmplitudeT60Seconds', 'weights']) || !id(mask.id) || !finite(mask.extraAmplitudeT60Seconds, 0.02, 4) || !Array.isArray(mask.weights) || mask.weights.length !== modes.length || mask.weights.some(value => !finite(value, -1, 1))) throw new TypeError('Point loss needs an exact signed modal site vector and positive additional amplitude-T60 seconds.');
      const squaredNorm = mask.weights.reduce((sum, value) => sum + value * value, 0);
      if (!(squaredNorm > 1e-24 && squaredNorm <= 1)) throw new RangeError('Point loss must retain its common-reference site gain inside the unit L2 bound.');
      return { id: mask.id, operator: NETWORK_POINT_LOSS_OPERATOR, extraAmplitudeT60Seconds: mask.extraAmplitudeT60Seconds, weights: mask.weights, squaredNorm,
        projectionDepth: -Math.expm1(-Math.log(1000) * squaredNorm / (mask.extraAmplitudeT60Seconds * sampleRate)) / squaredNorm };
    }
    if (!keys(mask, ['id', 'extraAmplitudeT60Seconds', 'weights']) || !id(mask.id) || !finite(mask.extraAmplitudeT60Seconds, 0.02, 4) || !Array.isArray(mask.weights) || mask.weights.length !== modes.length || mask.weights.some(value => !finite(value, 0, 1)) || !mask.weights.some(value => value > 0)) throw new TypeError('A mode-loss mask needs explicit nonnegative weights and additional amplitude-T60 seconds.');
    return { id: mask.id, extraAmplitudeT60Seconds: mask.extraAmplitudeT60Seconds, weights: mask.weights, poleDepths: mask.weights.map(weight => -Math.expm1(-Math.log(1000) * weight / (mask.extraAmplitudeT60Seconds * sampleRate))) };
  });
  const degree = new Uint8Array(modes.length), seen = new Set(), edges = p.edges.map(edge => {
    if (!keys(edge, ['fromBody', 'fromMode', 'toBody', 'toMode', 'amount']) || !ids.has(edge.fromBody) || !ids.has(edge.toBody) || !Number.isInteger(edge.fromMode) || !Number.isInteger(edge.toMode) || edge.fromMode < 0 || edge.toMode < 0 || edge.fromMode >= ids.get(edge.fromBody).count || edge.toMode >= ids.get(edge.toBody).count || !finite(edge.amount, 0, 0.1)) throw new TypeError('Invalid sparse sympathetic edge.');
    const from = ids.get(edge.fromBody).first + edge.fromMode, to = ids.get(edge.toBody).first + edge.toMode, key = Math.min(from, to) + ':' + Math.max(from, to);
    if (from === to || seen.has(key) || ++degree[from] > 4 || ++degree[to] > 4) throw new RangeError('Duplicate/self coupling or maximum degree exceeded.'); seen.add(key);
    const angle = edge.amount * 300 / sampleRate;
    return { from, to, cosineDelta: Math.cos(angle) - 1, sine: Math.sin(angle), amount: edge.amount };
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  const inputScale = (1 - maximumRadius) / (p.excitationReferenceNorm ?? Math.sqrt(excitationNorm)), outputScale = 1 / Math.sqrt(pickupNorm);
  for (const mode of modes) { mode.excitation *= inputScale; mode.pickup *= outputScale; }
  const profile = { revision: SYMPATHETIC_NETWORK_REVISION, sampleRate, parameters: p, modes, edges, lossMasks, pickupGrid, maximumRadius, inputScale, outputScale,
    stateBytes: (10 * modes.length + 2 * edges.length + 16 + (lossMasks.length + Number(lossMasks.length > 0)) * modes.length + (pickupGrid ? pickupGrid.weights.length + 2 * modes.length : 0)) * 8 + edges.length * 8, bodyCount: p.bodies.length, modeCount: modes.length, maximumDegree: 4,
    processingLatencyFrames: 0, maximumTailFrames: Math.ceil(longest * 2 * sampleRate), maximumLinearGain: 1, maximumOutputAmplitude: 32.000001,
    gainBoundDomain: 'bounded-input-history-to-complex-state-L2-to-pickup-peak;not-one-sample-energy',
    stability: 'damped-unitary-mode-rotations;canonical-sequential-contractive-I-to-Givens-edge-interpolants',
    excitationPolicy: p.excitationWeights ? 'signed-input-vector-divided-by-common-reference;scaled-by-one-minus-maximum-prepared-radius' : 'L2-normalized-input-vector-scaled-by-one-minus-maximum-prepared-radius',
    couplingPolicy: 'same-frame-canonical-sequential-scattering;no-graph-cycle-or-physical-feedback',
    tuningPolicy: 'prepared-revision-only;old-network-keeps-admitted-tail', tailPolicy: 'hard-two-T60-ceiling-at-longest-prepared-damping',
    preparation: { kind: lossMasks.some(mask => mask.operator) ? 'signed-site-rank-one-modal-velocity-loss;normalized-modal-energy-model' : 'authored-selected-mode-positive-loss;not-spatial-mode-shapes', overlap: lossMasks.some(mask => mask.operator) ? 'diagonal-maximum-then-canonical-sequential-point-contractions;prepared-slot-order' : 'maximum-additional-pole-depth-per-mode', slots: lossMasks.length, slewSeconds: 0.008, release: 'future-decay-returns;dissipated-energy-not-restored',
      ...(lossMasks.some(mask => mask.operator) ? { equation: 'p <- p - amount * (1-exp(-ln(1000)*dot(v,v)/(T60*sampleRate)))/dot(v,v) * v * dot(v,p);q-unchanged', quadratures: 'real=normalized-modal-velocity;imaginary=frequency-scaled-modal-displacement', interpretation: 'positive-rank-one-loss-flow-within-split-complex-modal-audio-model;not-force-or-material-calibration', gainPolicy: 'one-common-site-reference;no-per-site-renormalization' } : {}) },
    pickupPreparation: { kind: pickupGrid ? pickupGrid.fieldRevision ? pickupGrid.fieldRevision === 'solved-tet4-surface-v1' ? 'two-independent-solved-surface-observation-positions' : 'two-independent-solved-edge-observation-positions' : 'two-independent-authored-observation-positions' : 'fixed-normalized-pickup-vector', energyPolicy: 'read-existing-modal-state;no-excitation-or-damping-change', slewSeconds: 0.008, maximumL2Norm: 1, release: 'hold-last-observation-position' },
    cost: { modeUpdatesPerStereoFrame: modes.length * 2, complexEdgeRotationsPerStereoFrame: edges.length * 2, modeMaskComparisonsPerFrame: lossMasks.length * modes.length, ...(lossMasks.some(mask => mask.operator) ? { pointLossProductsPerFrame: lossMasks.filter(mask => mask.operator).length * modes.length * 4 } : {}), pickupWeightProductsPerFrame: pickupGrid ? modes.length * 8 : 0 },
    qualification: 'implementation-awaiting-decay-mode-cost-and-listening-qualification' };
  profile.configurationBytes = encodeUtf8(sympatheticNetworkIdentity(profile)).length; profile.stateBytes += profile.configurationBytes;
  return freezeData(profile);
}
export const sympatheticNetworkIdentity = p => canonicalDataText({ revision: p.revision, sampleRate: p.sampleRate, parameters: p.parameters,
  realization: p.modes.map(m => [m.cosine, m.sine, m.longRadius, m.shortRadius, m.excitation, m.pickup]), edges: p.edges, lossMasks: p.lossMasks, pickupGrid: p.pickupGrid }).text;
