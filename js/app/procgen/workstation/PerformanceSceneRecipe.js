import { validateProjectJunctions } from './PhysicalJunctionProject.js';
import { validateSceneTerrainLayout } from '../SceneTerrainLayout.js';
import { normalizeLaneHeight } from '../ProcgenLaneGeometry.js';
import { validateReleaseGesture } from '../ReleaseGesture.js';
import { cloneData, freezeData, canonicalDataText, hashData } from '../../../core/CanonicalData.js';
import { normalizeWorkerLimits } from '../ProcgenWorkerLimits.js';
import { normalizePopulationPolicy } from '../ProcgenPopulationPolicy.js';
import { validatePerformanceScene, performanceSceneHash } from './PerformanceScene.js';

const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const fail = () => { throw Object.assign(new Error('The pinned physical score recipe or scene origin is invalid.'), { code: 'invalid-scene-score-recipe' }); };
const same = (a, b) => canonicalDataText(a).text === canonicalDataText(b).text;
export function validatePerformanceSceneRecipe(raw) {
  const value = cloneData(raw, { maxBytes: 131072, maxNodes: 8192 }), s = value?.settings;
  if (!keys(value, ['schema', 'id', 'revision', 'sourceHash', 'settings', 'terrainFamilies', 'seedPolicy', 'initialReleaseGesture', 'initialTerrainLayout', 'assistPolicy', 'initialJunctions']) || value.schema !== 'lemmings-physical-score-recipe/v1' || typeof value.id !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value.id) || !integer(value.revision, 1, 2147483647) || !hash(value.sourceHash) || value.seedPolicy !== 'scene-seed' ||
      !keys(s, ['laneCount', 'laneHeight', 'pack', 'speed', 'hazardSpacing', 'decoration', 'workerLimits', 'populationPolicy']) || !integer(s.laneCount, 1, 32) || !integer(s.laneHeight, 64, 512) || !integer(s.pack, 1, 3) || !Number.isFinite(s.speed) || s.speed < 0.1 || s.speed > 12 || !Number.isFinite(s.hazardSpacing) || s.hazardSpacing < 80 || s.hazardSpacing > 1024 || s.decoration !== 'none' ||
      !plain(s.workerLimits) || !same(s.workerLimits, normalizeWorkerLimits(s.workerLimits)) || !plain(s.populationPolicy) || !same(s.populationPolicy, normalizePopulationPolicy(s.populationPolicy)) || !Array.isArray(value.terrainFamilies) || value.terrainFamilies.length !== s.laneCount || value.terrainFamilies.some(family => !['rock', 'holiday-snow', 'brick', 'snow', 'bubble', 'dirt', 'fire', 'squasher', 'pillar', 'crystal'].includes(family))) fail();
  if (value.assistPolicy !== undefined && !['manual-only', 'standard'].includes(value.assistPolicy)) fail();
  if (value.initialJunctions !== undefined && !same(value.initialJunctions, validateProjectJunctions(value.initialJunctions))) fail();
  if (value.initialTerrainLayout !== undefined) { const layout = validateSceneTerrainLayout(value.initialTerrainLayout); if (layout.lanes.length !== s.laneCount || layout.laneHeight !== s.laneHeight || normalizeLaneHeight(layout.laneHeight) !== layout.laneHeight || !same(layout, value.initialTerrainLayout)) fail(); }
  if (value.initialReleaseGesture !== undefined && !same(value.initialReleaseGesture, validateReleaseGesture(value.initialReleaseGesture, s.laneCount))) fail();
  return freezeData(value);
}
export function validatePerformanceSceneOrigin(raw) {
  const value = cloneData(raw, { maxBytes: 1310720, maxNodes: 73728 });
  if (!keys(value, ['schema', 'manifest', 'sceneHash', 'recipe', 'variants']) || value.schema !== 'lemmings-performance-scene-origin/v1' || !hash(value.sceneHash) || !Array.isArray(value.variants) || value.variants.length > 256 || value.variants.some(id => typeof id !== 'string' || id.length > 128) || new Set(value.variants).size !== value.variants.length) fail();
  const manifest = validatePerformanceScene(value.manifest), recipe = validatePerformanceSceneRecipe(value.recipe);
  if (manifest.worldRecipeRef.id !== recipe.id || manifest.worldRecipeRef.revision !== recipe.revision || manifest.sourceVersion.hash !== recipe.sourceHash || manifest.cost.lanes !== recipe.settings.laneCount || value.variants.some(id => !manifest.requirements.substitutableWithNamedApproximation.some(entry => entry.variantId === id))) fail();
  return freezeData({ ...value, manifest, recipe });
}
export async function verifyPerformanceSceneOrigin(raw, { sourceHash = null } = {}) {
  const value = validatePerformanceSceneOrigin(raw);
  if (await performanceSceneHash(value.manifest) !== value.sceneHash || await hashData(value.recipe, { maxBytes: 131072, maxNodes: 8192 }) !== value.manifest.worldRecipeRef.hash || sourceHash !== null && value.recipe.sourceHash !== sourceHash) fail();
  return value;
}
