import { cloneData, freezeData, canonicalDataText, encodeUtf8 } from '../../core/CanonicalData.js';

export const SYMPATHETIC_NETWORK_REVISION = 'owned-contractive-complex-modal-network-v1';
export function prepareSympatheticNetworkProfile(raw, sampleRate = 48000) {
  const p = cloneData(raw, { maxBytes: 262144, maxNodes: 16384 }), allowed = ['bodies', 'edges', 'couple01', 'damp01'];
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
  const degree = new Uint8Array(modes.length), seen = new Set(), edges = p.edges.map(edge => {
    if (!keys(edge, ['fromBody', 'fromMode', 'toBody', 'toMode', 'amount']) || !ids.has(edge.fromBody) || !ids.has(edge.toBody) || !Number.isInteger(edge.fromMode) || !Number.isInteger(edge.toMode) || edge.fromMode < 0 || edge.toMode < 0 || edge.fromMode >= ids.get(edge.fromBody).count || edge.toMode >= ids.get(edge.toBody).count || !finite(edge.amount, 0, 0.1)) throw new TypeError('Invalid sparse sympathetic edge.');
    const from = ids.get(edge.fromBody).first + edge.fromMode, to = ids.get(edge.toBody).first + edge.toMode, key = Math.min(from, to) + ':' + Math.max(from, to);
    if (from === to || seen.has(key) || ++degree[from] > 4 || ++degree[to] > 4) throw new RangeError('Duplicate/self coupling or maximum degree exceeded.'); seen.add(key);
    const angle = edge.amount * 300 / sampleRate;
    return { from, to, cosineDelta: Math.cos(angle) - 1, sine: Math.sin(angle), amount: edge.amount };
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  const inputScale = (1 - maximumRadius) / Math.sqrt(excitationNorm), outputScale = 1 / Math.sqrt(pickupNorm);
  for (const mode of modes) { mode.excitation *= inputScale; mode.pickup *= outputScale; }
  const profile = { revision: SYMPATHETIC_NETWORK_REVISION, sampleRate, parameters: p, modes, edges, maximumRadius, inputScale, outputScale,
    stateBytes: (10 * modes.length + 2 * edges.length) * 8 + edges.length * 8, bodyCount: p.bodies.length, modeCount: modes.length, maximumDegree: 4,
    processingLatencyFrames: 0, maximumTailFrames: Math.ceil(longest * 2 * sampleRate), maximumLinearGain: 1, maximumOutputAmplitude: 32.000001,
    gainBoundDomain: 'bounded-input-history-to-complex-state-L2-to-pickup-peak;not-one-sample-energy',
    stability: 'damped-unitary-mode-rotations;canonical-sequential-contractive-I-to-Givens-edge-interpolants',
    excitationPolicy: 'L2-normalized-input-vector-scaled-by-one-minus-maximum-prepared-radius',
    couplingPolicy: 'same-frame-canonical-sequential-scattering;no-graph-cycle-or-physical-feedback',
    tuningPolicy: 'prepared-revision-only;old-network-keeps-admitted-tail', tailPolicy: 'hard-two-T60-ceiling-at-longest-prepared-damping',
    cost: { modeUpdatesPerStereoFrame: modes.length * 2, complexEdgeRotationsPerStereoFrame: edges.length * 2 },
    qualification: 'implementation-awaiting-decay-mode-cost-and-listening-qualification' };
  profile.configurationBytes = encodeUtf8(sympatheticNetworkIdentity(profile)).length; profile.stateBytes += profile.configurationBytes;
  return freezeData(profile);
}
export const sympatheticNetworkIdentity = p => canonicalDataText({ revision: p.revision, sampleRate: p.sampleRate, parameters: p.parameters,
  realization: p.modes.map(m => [m.cosine, m.sine, m.longRadius, m.shortRadius, m.excitation, m.pickup]), edges: p.edges }).text;
