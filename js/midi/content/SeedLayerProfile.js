import { validateSampleTraversalBinding } from './SampleTraversal.js';
import { cloneData, freezeData, canonicalDataText } from '../../core/CanonicalData.js';

export const SEED_LAYER_SCHEMA = 'lemmings-decomposed-seed-layers/v1';
export const SEED_LAYER_REVISION = 'one-source-three-aligned-seed-children-v1';
export const SEED_LAYER_ROLES = Object.freeze(['transient-like', 'sustained-like', 'residual']);
export const SEED_LAYER_FAMILIES = Object.freeze(['hammer-cloud', 'bowed-scrap', 'hollow-tool']);
export const SEED_LAYER_NEUTRAL_TOLERANCE = 0.000002;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const fail = message => { throw new TypeError('Seed layers: ' + message); };

export function validateSeedLayerProfile(raw, sampleRefs) {
  const value = structuredClone(cloneData(raw, { maxBytes: 65536, maxNodes: 8192 }));
  if (!keys(value, ['schema', 'revision', 'family', 'parentAssetHash', 'decompositionRevision', 'decompositionRecipeHash', 'parentRegionFrames', 'components', 'reconstruction', 'motionBinding', 'bodyFit']) || value.schema !== SEED_LAYER_SCHEMA || value.revision !== SEED_LAYER_REVISION || !SEED_LAYER_FAMILIES.includes(value.family) || !hash(value.parentAssetHash) || value.decompositionRevision !== 'linked-stereo-median-masks-v1' || !hash(value.decompositionRecipeHash) || !Array.isArray(value.parentRegionFrames) || value.parentRegionFrames.length !== 2 || !integer(value.parentRegionFrames[0], 0) || !integer(value.parentRegionFrames[1], value.parentRegionFrames[0] + 2, 524288) || !Array.isArray(value.components) || value.components.length !== 3) fail('Choose one exact linked-stereo decomposition and three ordered component assets.');
  const [first] = value.components, frames = value.parentRegionFrames[1] - value.parentRegionFrames[0];
  for (const [index, component] of value.components.entries()) if (!keys(component, ['role', 'assetHash', 'sourceFrames', 'sourceRate', 'channels']) || component.role !== SEED_LAYER_ROLES[index] || !hash(component.assetHash) || component.assetHash === value.parentAssetHash || component.sourceFrames !== frames || !integer(component.sourceFrames, 2, 524288) || !integer(component.sourceRate, 8000, 192000) || component.sourceFrames > component.sourceRate * 8 || component.sourceRate !== first.sourceRate || component.channels !== 2) fail('Component material must retain identical stereo frame/rate coordinates and its own exact hash.');
  const assets = value.components.map(component => component.assetHash);
  if (new Set(assets).size !== 3 || !Array.isArray(sampleRefs) || sampleRefs.length !== 3 || new Set(sampleRefs.map(ref => ref?.sha256)).size !== 3 || sampleRefs.some(ref => !assets.includes(ref?.sha256))) fail('The complete source inventory is exactly the three components; the frozen parent is ancestry, never a backing layer.');
  const r = value.reconstruction;
  if (!keys(r, ['comparedFrames', 'channels', 'maximumAbsoluteError', 'rmsError', 'sourceRms', 'relativeRmsError', 'evidence']) || r.comparedFrames !== frames || r.channels !== 2 || !finite(r.maximumAbsoluteError, 0, SEED_LAYER_NEUTRAL_TOLERANCE) || !finite(r.rmsError, 0, SEED_LAYER_NEUTRAL_TOLERANCE) || !finite(r.sourceRms, 0, 16) || !Number.isFinite(r.relativeRmsError) || r.relativeRmsError < 0 || r.evidence !== 'measured-neutral-Float32-sum-after-declared-crop;not-perceptual-source-isolation') fail('Neutral reconstruction must have its measured bounded error receipt before a creative layered recipe.');
  if (value.family === 'bowed-scrap') {
    value.motionBinding = validateSampleTraversalBinding(value.motionBinding);
    if (value.motionBinding.mode !== 'one-way-rubbing' || value.motionBinding.lifetimeScope !== 'contactSpan' || value.motionBinding.originPixels !== 0) fail('Bowed Scrap requires actual contact-span motion, including its rests and end.');
  } else if (value.motionBinding != null) fail('A strike family cannot silently acquire a continuous motion source.');
  else value.motionBinding = null;
  if (value.family === 'hollow-tool') {
    const fit = value.bodyFit;
    if (!keys(fit, ['parentAssetHash', 'recipeHash', 'algorithmRevision', 'referenceHz', 'modes']) || fit.parentAssetHash !== assets[1] || !hash(fit.recipeHash) || fit.algorithmRevision !== 'coarse-local-stereo-decay-fit-v1' || !finite(fit.referenceHz, 20, 2000) || !Array.isArray(fit.modes) || !fit.modes.length || fit.modes.length > 8 || fit.modes.some(mode => !keys(mode, ['frequencyHz', 't60Seconds', 'amplitude']) || !finite(mode.frequencyHz, 20, Math.min(17640, fit.referenceHz * 16)) || mode.frequencyHz < fit.referenceHz * 0.125 || !finite(mode.t60Seconds, 0.03, 2.5) || !finite(mode.amplitude, 0, 16)) || !fit.modes.some(mode => mode.amplitude > 0)) fail('Hollow Tool needs the exact positive-loss fit of its sustained component and an independently declared body root.');
  } else if (value.bodyFit != null) fail('A fitted replacement is a separately named hybrid, not an undeclared layer.');
  else value.bodyFit = null;
  canonicalDataText(value, { maxBytes: 65536, maxNodes: 8192 }); return freezeData(value);
}
