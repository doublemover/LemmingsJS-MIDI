import { freezeData } from '../../../core/CanonicalData.js';
import { verifyPerformanceSceneOrigin, validatePerformanceSceneOrigin } from './PerformanceSceneRecipe.js';
import { checkPerformanceSceneRequirements } from './PerformanceSceneRequirements.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'scene-recipe-unavailable' }); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateSceneRecipeShareIdentity(raw) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['id', 'version', 'hash', 'sourceHash', 'recipeHash'].includes(key)) ||
      typeof raw.id !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,159}$/.test(raw.id) || !Number.isSafeInteger(raw.version) || raw.version < 1 || raw.version > 2147483647 ||
      !hash(raw.hash) || !hash(raw.sourceHash) || !hash(raw.recipeHash)) fail('This authored scene recipe requires its exact identity, revision, scene, score and source hashes.');
  return freezeData({ id: raw.id, version: raw.version, hash: raw.hash, sourceHash: raw.sourceHash, recipeHash: raw.recipeHash });
}
export function sceneRecipeShareIdentity(raw) {
  const origin = validatePerformanceSceneOrigin(raw);
  if (origin.variants.length) fail('This scene uses a named replacement. Export its project or selected take until that replacement has a portable recipe.');
  return validateSceneRecipeShareIdentity({ id: origin.manifest.id, version: origin.manifest.version, hash: origin.sceneHash,
    sourceHash: origin.manifest.sourceVersion.hash, recipeHash: origin.manifest.worldRecipeRef.hash });
}
export async function resolveSceneRecipeShare(raw, { catalog, signal } = {}) {
  signal?.throwIfAborted(); const identity = validateSceneRecipeShareIdentity(raw);
  if (!catalog?.available || !catalog.registry?.resolve || typeof catalog.origin !== 'function' || typeof catalog.resolveDependency !== 'function') fail('The installed scene catalog is unavailable. Open its project or take artifact with the required source and assets.');
  if (catalog.sourceHash !== identity.sourceHash) fail('This starting scene recipe belongs to a different application build. Open its matching build or project/take artifact; exact replay is not established.');
  let scene;
  try { scene = catalog.registry.resolve(identity); } catch { fail('The exact authored scene revision and content are not installed. Open its matching project or take artifact.'); }
  if (scene.sourceVersion.hash !== identity.sourceHash || scene.worldRecipeRef.hash !== identity.recipeHash) fail('The installed scene source or physical score differs from this starting recipe.');
  const origin = await verifyPerformanceSceneOrigin(await catalog.origin(scene, []), { sourceHash: identity.sourceHash }); signal?.throwIfAborted();
  if (origin.sceneHash !== identity.hash || origin.manifest.id !== identity.id || origin.manifest.version !== identity.version || origin.manifest.worldRecipeRef.hash !== identity.recipeHash || origin.variants.length) fail('The installed scene changed while resolving its starting recipe.');
  const preflight = await checkPerformanceSceneRequirements(scene, { resolveDependency: catalog.resolveDependency, signal, variants: [] }); signal?.throwIfAborted();
  if (preflight.status !== 'ready') fail('Required starting scene assets are unavailable: ' + preflight.blocked.map(entry => entry.dependency.description + ': ' + entry.reason).join('; ').slice(0, 2048));
  return Object.freeze({ identity, origin, preflight, catalog });
}
