import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';
import { validatePhysicalTuning } from '../../app/procgen/workstation/physical/Tuning.js';

const limits = { maxBytes: 131072, maxNodes: 8192 }, id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,95}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value),
  hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high,
  fail = message => { throw Object.assign(new Error(message), { code: 'timbre-tuning-invalid' }); };
const ref = value => value && id(value.id) && Number.isSafeInteger(value.revision) && value.revision > 0 && hash(value.hash);
export function validateTimbreTuningSet(raw) {
  const value = JSON.parse(canonicalDataText(raw, limits).text);
  if (value.schema !== 'lemmings-timbre-tuning-set/v1' || !id(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      Object.keys(value).some(key => !['schema', 'id', 'revision', 'name', 'spectrumRef', 'partialRatios', 'partialGains', 'partialT60Seconds', 'partialProvenance', 'tuningRef', 'degreeRatios', 'periodRatio', 'referenceHz', 'referenceCents', 'registerDomain', 'coupledMorph', 'heldPolicy', 'renderer', 'analysisReceipt'].includes(key)) ||
      typeof value.name !== 'string' || !value.name || value.name.length > 160 || !ref(value.spectrumRef) || !ref(value.tuningRef) ||
      !Array.isArray(value.partialRatios) || !value.partialRatios.length || value.partialRatios.length > 16 || !value.partialRatios.every(ratio => finite(ratio, 0.125, 32)) ||
      !Array.isArray(value.partialGains) || value.partialGains.length !== value.partialRatios.length || !value.partialGains.every(gain => finite(gain, 0, 1)) ||
      !Array.isArray(value.partialT60Seconds) || value.partialT60Seconds.length !== value.partialRatios.length || !value.partialT60Seconds.every(seconds => finite(seconds, 0.04, 4)) ||
      !Array.isArray(value.partialProvenance) || value.partialProvenance.length !== value.partialRatios.length ||
      value.partialProvenance.some(item => !item || !['authored', 'estimated', 'disabled'].includes(item.kind) || Object.keys(item).some(key => !['kind', 'fitRef'].includes(key)) || (item.kind === 'estimated' ? !ref(item.fitRef) : item.fitRef != null)) ||
      !value.partialGains.some((gain, index) => gain > 0 && value.partialProvenance[index].kind !== 'disabled')) fail('Use one to16 finite positive partial ratios, declared amplitude gains, T60 seconds and exact provenance.');
  if (!finite(value.periodRatio, 1 + 1e-9, 16) || !finite(value.referenceHz, 20, 2000) || !finite(value.referenceCents, -24000, 24000) ||
      !Array.isArray(value.degreeRatios) || !value.degreeRatios.length || value.degreeRatios.length > 128 || value.degreeRatios[0] !== 1 ||
      value.degreeRatios.some((ratio, index) => !finite(ratio, 1, value.periodRatio) || ratio >= value.periodRatio || index && ratio <= value.degreeRatios[index - 1]) ||
      !value.registerDomain || Object.keys(value.registerDomain).some(key => !['minimumHz', 'maximumHz'].includes(key)) || !finite(value.registerDomain.minimumHz, 20, 2000) || !finite(value.registerDomain.maximumHz, value.registerDomain.minimumHz, 2000)) fail('Use ascending exact ratio degrees inside a known positive period and a20–2000Hz fundamental register.');
  if (!['onset-only', 'retune-held'].includes(value.heldPolicy) || value.renderer?.engineId !== 'worklet-spectrum' || value.renderer.engineVersion !== 1 || Object.keys(value.renderer).some(key => !['engineId', 'engineVersion'].includes(key)) ||
      !value.coupledMorph || typeof value.coupledMorph.linked !== 'boolean' || value.coupledMorph.kind !== 'power-stretch' || !finite(value.coupledMorph.stretch, 0.94, 1.1) || Object.keys(value.coupledMorph).some(key => !['linked', 'kind', 'stretch'].includes(key))) fail('Declare the existing spectrum renderer, held-note policy and explicit bounded power-stretch link.');
  if (value.analysisReceipt != null && (!value.analysisReceipt || Object.keys(value.analysisReceipt).some(key => !['model', 'setHash', 'requestHash', 'resultHash'].includes(key)) ||
      value.analysisReceipt.model !== 'sethares-min-amplitude-total-pair-v1' || !['setHash', 'requestHash', 'resultHash'].every(key => hash(value.analysisReceipt[key])))) fail('Analysis evidence requires exact model/input/result hashes.');
  return freezeData(value);
}
export const timbreSpectrumData = set => ({ ratios: set.partialRatios, gains: set.partialGains, t60Seconds: set.partialT60Seconds, provenance: set.partialProvenance });
export const timbreTuningData = set => ({ degreeRatios: set.degreeRatios, periodRatio: set.periodRatio, referenceHz: set.referenceHz, referenceCents: set.referenceCents });
export const timbreTuningIdentity = set => ({ ...set, analysisReceipt: null });
export async function stampTimbreTuningSet(raw) {
  const value = JSON.parse(canonicalDataText(raw, limits).text);
  value.spectrumRef = { id: value.spectrumRef?.id || value.id + '.spectrum', revision: value.spectrumRef?.revision || value.revision, hash: await hashData(timbreSpectrumData(value), limits) };
  value.tuningRef = { id: value.tuningRef?.id || value.id + '.tuning', revision: value.tuningRef?.revision || value.revision, hash: await hashData(timbreTuningData(value), limits) };
  return validateTimbreTuningSet(value);
}
export async function verifyTimbreTuningSet(raw) {
  const set = validateTimbreTuningSet(raw);
  if (await hashData(timbreSpectrumData(set), limits) !== set.spectrumRef.hash || await hashData(timbreTuningData(set), limits) !== set.tuningRef.hash) fail('The saved spectrum or tuning differs from its immutable reference.');
  return set;
}
export function physicalTuningForTimbreSet(set) {
  return validatePhysicalTuning({ version: 1, id: set.tuningRef.id, kind: 'cents', values: set.degreeRatios.map(ratio => 1200 * Math.log2(ratio)), periodCents: 1200 * Math.log2(set.periodRatio), referenceCents: set.referenceCents, referenceHz: set.referenceHz });
}
export async function createTimbreTuningRecipe(kind = 'harmonic', { stretch = 1.04, referenceHz = 220, revision = 1 } = {}) {
  if (!['harmonic', 'stretched', 'metal'].includes(kind) || !finite(stretch, 0.94, 1.1)) fail('Choose harmonic, stretched or metal with a bounded exponent.');
  const exponent = kind === 'stretched' ? stretch : 1, ratios = kind === 'metal' ? [1, 2.32, 4.25, 6.63] : Array.from({ length: kind === 'harmonic' ? 6 : 8 }, (_, index) => (index + 1) ** exponent),
    gains = kind === 'harmonic' ? [1, 0.45, 0.25, 0.18, 0.12, 0.08] : kind === 'metal' ? [1, 0.45, 0.25, 0.15] : [1, 0.45, 0.25, 0.18, 0.12, 0.08, 0.06, 0.04];
  return stampTimbreTuningSet({ schema: 'lemmings-timbre-tuning-set/v1', id: 'lab.' + kind, revision, name: kind === 'harmonic' ? 'Harmonic reference' : kind === 'stretched' ? 'Stretched lattice' : 'Metal islands',
    partialRatios: ratios, partialGains: gains, partialT60Seconds: ratios.map((_, index) => kind === 'metal' ? [2.4, 0.7, 0.3, 0.16][index] : 1.6), partialProvenance: ratios.map(() => ({ kind: 'authored' })),
    degreeRatios: (kind === 'metal' ? [1, 1.16, 1.5] : [1, 1.25, 1.5]).map(ratio => ratio ** exponent), periodRatio: 2 ** exponent, referenceHz, referenceCents: 6900,
    registerDomain: { minimumHz: 110, maximumHz: 440 }, coupledMorph: { linked: kind === 'stretched', kind: 'power-stretch', stretch: exponent }, heldPolicy: 'onset-only', renderer: { engineId: 'worklet-spectrum', engineVersion: 1 }, analysisReceipt: null });
}

export function validateTimbreTuningBinding(raw, reference) {
  const set = validateTimbreTuningSet(raw), definition = reference?.definition, parameters = definition?.parameters, t60 = Math.max(...set.partialT60Seconds);
  if (reference?.patchId !== set.id || reference.revision !== set.revision || definition?.engineId !== set.renderer.engineId || definition.engineVersion !== set.renderer.engineVersion ||
      parameters.sourceMode !== 1 || parameters.partialCount !== set.partialRatios.length || parameters.partialDecaySeconds !== t60 ||
      set.partialRatios.some((ratio, index) => parameters['partial' + index + 'Ratio'] !== ratio || parameters['partial' + index + 'Gain'] !== (set.partialProvenance[index].kind === 'disabled' ? 0 : set.partialGains[index]) || parameters['partial' + index + 'T60Scale'] !== set.partialT60Seconds[index] / t60)) throw new Error('The saved pair differs from its exact prepared spectrum definition.');
  return set;
}
