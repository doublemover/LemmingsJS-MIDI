import { canonicalDataText, cloneData, freezeData, hashData } from '../../core/CanonicalData.js';
import { assignBoundedMinimumCosts } from '../../core/BoundedMinimumAssignment.js';

export const RESONATOR_MORPH_REVISION = 'named-mode-log-frequency-decay-signature-global-assignment-v1';
const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,95}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const fail = message => { throw Object.assign(new Error('Resonator morph: ' + message), { code: 'invalid-resonator-morph' }); };
const preparedMorphs = new WeakSet(), inspectedMorphs = new WeakSet();
export const isInspectedResonatorMorph = value => inspectedMorphs.has(value);
const roles = ['excitation', 'pickupLeft', 'pickupRight'];
const before = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function validateResonatorMorphEndpoint(raw) {
  const body = cloneData(raw, { maxBytes: 65536, maxNodes: 8192 });
  if (!keys(body, ['schema', 'id', 'revision', 'sourceAssetHash', 'modelKind', 'sites', 'modes', 'amplitudeConvention']) || body.schema !== 'lemmings-resonator-morph-endpoint/v1' || !id(body.id) || !Number.isSafeInteger(body.revision) || body.revision < 1 || !hash(body.sourceAssetHash) || !['synthetic-modal', 'fitted-modal', 'shape-modal'].includes(body.modelKind) || body.amplitudeConvention !== 'fixed-signed-L1-per-site;no-per-endpoint-renormalization' || !keys(body.sites, roles) || Object.keys(body.sites).length !== 3 || roles.some(role => !id(body.sites[role])) || !Array.isArray(body.modes) || !body.modes.length || body.modes.length > 32) fail('Use a bounded named modal endpoint and exact source hash; distributed membrane state is not a mode-table endpoint.');
  const seen = new Set();
  for (const mode of body.modes) {
    if (!keys(mode, ['id', 'frequencyHz', 't60Seconds', ...roles]) || !id(mode.id) || seen.has(mode.id) || !finite(mode.frequencyHz, 20, 16000) || !finite(mode.t60Seconds, 0.02, 8) || roles.some(role => mode[role] !== null && !finite(mode[role], -1, 1))) fail('Modes need stable unique IDs, positive frequency/T60 and explicit signed or unknown site weights.'); seen.add(mode.id);
  }
  for (const role of roles) if (body.modes.every(mode => mode[role] !== null) && body.modes.reduce((sum, mode) => sum + Math.abs(mode[role]), 0) > 1 + 1e-12) fail('A site exceeds its declared common fixed signed L1 reference.');
  return body;
}
const validateSites = (raw, a, b, required = false) => {
  if (!keys(raw, roles) || required && Object.keys(raw).length !== 3) fail('Declare explicit role-compatible endpoint site correspondence.');
  for (const [role, mapping] of Object.entries(raw)) if (!keys(mapping, ['a', 'b']) || mapping.a !== a.sites[role] || mapping.b !== b.sites[role]) fail('Site correspondence differs from its exact endpoint role.');
  return raw;
};
const validatePairs = (raw, a, b) => {
  if (!Array.isArray(raw) || raw.length > Math.min(a.modes.length, b.modes.length)) fail('Pair count exceeds the bounded endpoint modes.');
  const aIds = new Set(a.modes.map(mode => mode.id)), bIds = new Set(b.modes.map(mode => mode.id)), usedA = new Set(), usedB = new Set();
  for (const pair of raw) { if (!keys(pair, ['aId', 'bId']) || !aIds.has(pair.aId) || !bIds.has(pair.bId) || usedA.has(pair.aId) || usedB.has(pair.bId)) fail('Resolved pairs must use unique exact endpoint mode IDs.'); usedA.add(pair.aId); usedB.add(pair.bId); }
  return { usedA, usedB };
};
const nearDegenerate = (mode, body) => body.modes.some(other => other.id !== mode.id && Math.abs(other.frequencyHz - mode.frequencyHz) / Math.max(mode.frequencyHz, other.frequencyHz) < 0.01);
const distance = (a, b, sites) => {
  const frequency = Math.min(1, Math.abs(Math.log2(a.frequencyHz / b.frequencyHz)) / 2), decay = Math.min(1, Math.abs(Math.log(a.t60Seconds / b.t60Seconds)) / Math.log(16));
  let signature = 0, observed = 0; const missing = [];
  for (const role of roles) { if (!sites[role] || a[role] === null || b[role] === null) missing.push(role); else { signature += Math.abs(a[role] - b[role]) / 2; observed++; } }
  return { cost: frequency + 0.25 * decay + (observed ? 0.5 * signature / observed : 0), frequency, decay, signature: observed ? signature / observed : null, missing };
};
export async function analyzeResonatorMorph(input, { signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('The endpoint/mapping revision changed.'); };
  check(); if (!keys(input, ['a', 'b', 'anchors', 'siteCorrespondence'])) fail('Unknown candidate-analysis input.');
  const a = validateResonatorMorphEndpoint(input.a), b = validateResonatorMorphEndpoint(input.b), anchors = cloneData(input.anchors ?? [], { maxBytes: 16384, maxNodes: 1024 }), sites = validateSites(cloneData(input.siteCorrespondence ?? {}, { maxBytes: 4096, maxNodes: 128 }), a, b), anchored = validatePairs(anchors, a, b), left = a.modes.filter(mode => !anchored.usedA.has(mode.id)).sort((a, b) => before(a.id, b.id)), right = b.modes.filter(mode => !anchored.usedB.has(mode.id)).sort((a, b) => before(a.id, b.id));
  const columns = right.length + left.length, costs = new Float64Array(left.length * columns), rows = [];
  for (let row = 0; row < left.length; row++) {
    check(); const alternatives = right.map(mode => ({ bId: mode.id, ...distance(left[row], mode, sites) })).sort((a, b) => a.cost - b.cost || before(a.bId, b.bId)); rows.push(alternatives);
    for (let column = 0; column < right.length; column++) costs[row * columns + column] = distance(left[row], right[column], sites).cost;
    for (let column = right.length; column < columns; column++) costs[row * columns + column] = 0.9;
    onProgress({ stage: 'mode-correspondence', completed: row + 1, total: left.length }); await yieldControl();
  }
  check(); const assignments = left.length ? assignBoundedMinimumCosts(costs, left.length, columns) : [], pairs = anchors.map(pair => ({ ...pair, method: 'authored-anchor', confidence: 'explicit-anchor;still-requires-publication-review', alternatives: [] })), usedB = new Set(anchored.usedB), unmatchedA = [];
  for (let row = 0; row < left.length; row++) {
    const chosen = right[assignments[row]]; if (!chosen) { unmatchedA.push(left[row].id); continue; }
    usedB.add(chosen.id); const metric = distance(left[row], chosen, sites), alternatives = rows[row].slice(0, 3), next = rows[row].find(entry => entry.bId !== chosen.id), ambiguous = nearDegenerate(left[row], a) || nearDegenerate(chosen, b) || !!next && Math.abs(next.cost - metric.cost) <= 0.1;
    pairs.push({ aId: left[row].id, bId: chosen.id, method: 'estimated-global-assignment', confidence: ambiguous ? 'ambiguous;review-subspace-or-prepared-blend' : metric.missing.length ? 'incomplete-signatures;review-required' : 'candidate-only;review-required', metric, alternatives });
  }
  const result = { schema: 'lemmings-resonator-morph-candidate/v1', revision: RESONATOR_MORPH_REVISION, endpointAHash: await hashData(a), endpointBHash: await hashData(b), sourceAHash: a.sourceAssetHash, sourceBHash: b.sourceAssetHash, siteCorrespondence: sites, pairs: pairs.sort((a, b) => before(a.aId, b.aId)), unmatchedAIds: unmatchedA.sort(before), unmatchedBIds: b.modes.filter(mode => !usedB.has(mode.id)).map(mode => mode.id).sort(before),
    method: 'bounded-global-cost=log-frequency+log-decay+declared-signed-site-signatures;dummy-unmatched-cost-0.9', qualified: false, publication: 'explicit-resolved-pair-review-required;not-a-perceptual-or-mechanical-identity-claim' };
  check(); return freezeData(result);
}
const mapBody = ({ a, b, pairs, siteCorrespondence, reviewed, transitionPolicy = 'next-onset-only', id: mapId = 'authored.resonator-morph', revision = 1, endpointAHash, endpointBHash }) => {
  const used = validatePairs(pairs, a, b), sites = validateSites(cloneData(siteCorrespondence, { maxBytes: 4096, maxNodes: 128 }), a, b, true);
  if (reviewed !== true || !id(mapId) || !Number.isSafeInteger(revision) || revision < 1 || !['next-onset-only', 'prepared-dual-body-blend', 'paired-synthetic-held'].includes(transitionPolicy) || !hash(endpointAHash) || !hash(endpointBHash)) fail('Review the actual resolved pairs and choose an explicit transition capability before publication.');
  return { schema: 'lemmings-resonator-morph-map/v1', id: mapId, revision, algorithmRevision: RESONATOR_MORPH_REVISION, endpointAHash, endpointBHash, sourceAHash: a.sourceAssetHash, sourceBHash: b.sourceAssetHash,
    pairs: pairs.map(pair => ({ aId: pair.aId, bId: pair.bId })), unmatchedAIds: a.modes.filter(mode => !used.usedA.has(mode.id)).map(mode => mode.id), unmatchedBIds: b.modes.filter(mode => !used.usedB.has(mode.id)).map(mode => mode.id), siteCorrespondence: sites,
    parameterCurves: { frequency: 'positive-log', amplitudeT60: 'positive-log', signedWeights: 'raised-cosine-fixed-common-reference', unmatched: 'sine-squared-observation-and-excitation-contribution' }, transitionPolicy, review: 'explicit-resolved-mapping', qualification: 'pending;no-continuous-renderer-or-perceptual-qualification-receipt' };
};
export async function createResonatorMorphMap({ a: rawA, b: rawB, ...options } = {}) {
  const a = validateResonatorMorphEndpoint(rawA), b = validateResonatorMorphEndpoint(rawB), body = mapBody({ ...options, a, b, endpointAHash: await hashData(a), endpointBHash: await hashData(b) });
  return freezeData({ ...body, hash: await hashData(body) });
}
// Synchronous Worklet admission checks structure; its publishing host must also
// call prepareResonatorMorphMap to verify the source and mapping SHA identities.
export function inspectResonatorMorphMap(raw, rawA, rawB) {
  const map = cloneData(raw, { maxBytes: 65536, maxNodes: 8192 }), a = validateResonatorMorphEndpoint(rawA), b = validateResonatorMorphEndpoint(rawB);
  if (!map || map.schema !== 'lemmings-resonator-morph-map/v1' || !hash(map.hash)) fail('Choose a complete resolved map.');
  const rebuilt = { ...mapBody({ a, b, pairs: map.pairs, siteCorrespondence: map.siteCorrespondence, reviewed: true, transitionPolicy: map.transitionPolicy, id: map.id, revision: map.revision, endpointAHash: map.endpointAHash, endpointBHash: map.endpointBHash }), hash: map.hash };
  if (canonicalDataText(rebuilt).text !== canonicalDataText(map).text) fail('Map curves, unmatched modes, review or source identity differs.');
  if (a.modes.some(mode => roles.some(role => mode[role] === null)) || b.modes.some(mode => roles.some(role => mode[role] === null))) fail('Missing excitation/pickup signatures cannot be invented for a playable body.');
  const byA = new Map(a.modes.map(mode => [mode.id, mode])), byB = new Map(b.modes.map(mode => [mode.id, mode])), slots = [...map.pairs.map(pair => ({ id: 'pair:' + pair.aId + ':' + pair.bId, a: byA.get(pair.aId), b: byB.get(pair.bId) })), ...map.unmatchedAIds.map(id => ({ id: 'death:' + id, a: byA.get(id), b: null })), ...map.unmatchedBIds.map(id => ({ id: 'birth:' + id, a: null, b: byB.get(id) }))];
  const inspected = freezeData({ schema: 'lemmings-prepared-resonator-morph/v1', map, a, b, slots, maximumModes: slots.length, continuousRendererQualified: false, meaning: map.transitionPolicy === 'prepared-dual-body-blend' ? 'two-independent-admitted-body-states;not-a-mode-morph' : 'synthetic-parameter-interpolation;not-mechanical-energy-or-perceptual-equivalence' }); inspectedMorphs.add(inspected); return inspected;
}
export async function prepareResonatorMorphMap(raw, rawA, rawB) {
  const prepared = inspectResonatorMorphMap(raw, rawA, rawB), { map, a, b } = prepared, { hash: expectedHash, ...body } = map;
  if (await hashData(body) !== expectedHash || await hashData(a) !== map.endpointAHash || await hashData(b) !== map.endpointBHash) fail('Endpoint or mapping hash changed; prepare a new revision.');
  preparedMorphs.add(prepared); return prepared;
}
export function evaluateResonatorMorph(prepared, u, sampleRate = 48000) {
  if (!preparedMorphs.has(prepared) || prepared?.schema !== 'lemmings-prepared-resonator-morph/v1' || !finite(u, 0, 1) || ![44100, 48000, 96000].includes(sampleRate) || prepared.map.transitionPolicy === 'prepared-dual-body-blend') fail('Choose prepared paired parameters at a supported rate; a blend cannot be reported as an intermediate body.');
  const fadeIn = u === 0 ? 0 : u === 1 ? 1 : Math.sin(Math.PI * u * 0.5) ** 2, fadeOut = 1 - fadeIn, modes = prepared.slots.map(slot => {
    const a = slot.a, b = slot.b, fallback = a || b, frequencyHz = a && b ? u === 0 ? a.frequencyHz : u === 1 ? b.frequencyHz : Math.exp((1 - u) * Math.log(a.frequencyHz) + u * Math.log(b.frequencyHz)) : fallback.frequencyHz, t60Seconds = a && b ? u === 0 ? a.t60Seconds : u === 1 ? b.t60Seconds : Math.exp((1 - u) * Math.log(a.t60Seconds) + u * Math.log(b.t60Seconds)) : fallback.t60Seconds;
    if (!(frequencyHz > 0 && frequencyHz < sampleRate * 0.4 && t60Seconds > 0)) fail('An intermediate mode exceeds the declared output band or positive loss.');
    const value = { id: slot.id, sourceAId: a?.id ?? null, sourceBId: b?.id ?? null, frequencyHz, t60Seconds };
    for (const role of roles) value[role] = a && b ? fadeOut * a[role] + fadeIn * b[role] : fallback[role] * (a ? fadeOut : fadeIn);
    return value;
  });
  return freezeData({ schema: 'lemmings-resonator-morph-parameters/v1', mapHash: prepared.map.hash, u, sampleRate, modes, transitionPolicy: prepared.map.transitionPolicy, continuousRendererQualified: false, semanticOnsetsAdded: 0, physicalTimingChanged: false });
}
