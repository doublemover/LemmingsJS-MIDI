import { freezeData, hashData } from '../../../core/CanonicalData.js';
import { validatePerformanceScene, sceneDependencyKey, performanceSceneHash } from './PerformanceScene.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'PerformanceSceneError', code });
const storageKinds = ['embedded', 'pinned-external', 'frozen-derived-pcm', 'rebuildable-source-lineage', 'installed-runtime'];
export async function checkPerformanceSceneRequirements(raw, { resolveDependency, variants = [], signal, isCurrent = () => true } = {}) {
  if (typeof resolveDependency !== 'function' || typeof isCurrent !== 'function' || !Array.isArray(variants) || variants.length > 256 || new Set(variants).size !== variants.length || variants.some(value => typeof value !== 'string')) throw new TypeError('Scene requirements need a bounded explicit variant selection and dependency resolver.');
  const scene = validatePerformanceScene(raw), selected = new Set(variants), substitutions = scene.requirements.substitutableWithNamedApproximation;
  if (variants.some(id => !substitutions.some(entry => entry.variantId === id))) throw failure('scene-variant-unavailable', 'The selected approximation is not authored by this scene.');
  const check = () => { signal?.throwIfAborted(); if (!isCurrent()) throw failure('stale-scene-operation', 'The selected scene or live document changed.'); };
  check();
  const dependencies = new Map(), add = (value, scope, optional = false) => {
    const key = sceneDependencyKey(value), previous = dependencies.get(key);
    if (previous) { previous.optional &&= optional; if (!previous.scopes.includes(scope)) previous.scopes.push(scope); }
    else { if (dependencies.size >= 2048) throw failure('scene-dependency-capacity', 'The enabled scene variant exceeds the dependency limit.'); dependencies.set(key, { dependency: value, scopes: [scope], optional }); }
  };
  const pin = (kind, value, scope) => add({ kind, id: value.id, revision: value.revision, hash: value.hash, description: scope }, scope);
  pin('world-source', scene.sourceVersion, 'world source'); pin('score-recipe', scene.worldRecipeRef, 'authored physical score');
  if (scene.tutorialRef) pin('tutorial', scene.tutorialRef, 'lesson');
  for (const value of scene.requirements.required) add(value, 'required');
  for (const value of scene.requirements.optional) add(value, 'optional', true);
  for (const entry of substitutions) add(selected.has(entry.variantId) ? entry.approximation : entry.requirement, selected.has(entry.variantId) ? entry.variantId : 'original:' + entry.variantId);
  for (const patch of scene.patchRefs) {
    const ref = patch.reference, engine = ref.engineRequirement;
    if (await hashData(ref.definition, { maxBytes: 65536, maxNodes: 8192 }) !== ref.definitionHash) throw failure('scene-patch-mismatch', 'The pinned scene patch definition has changed.'); check();
    pin('patch', { id: ref.patchId, revision: ref.revision, hash: ref.definitionHash }, patch.laneId);
    pin('engine', { id: engine.engineId, revision: engine.engineVersion, hash: engine.artifactHash }, patch.laneId);
    pin('parameter-schema', { id: engine.engineId, revision: engine.engineVersion, hash: engine.parameterSchemaHash }, patch.laneId);
    for (const hash of ref.assetHashes) pin('asset', { id: 'sha256:' + hash, revision: 1, hash }, patch.laneId);
  }
  if (dependencies.size > 2048) throw failure('scene-dependency-capacity', 'The complete enabled scene variant exceeds the dependency limit.');
  const entries = [...dependencies.values()], receipts = new Array(entries.length); let next = 0;
  // Bounded metadata resolution; decoding and candidate resources belong to preparation.
  const resolve = async () => { while (next < entries.length) { const index = next++, entry = entries[index]; check();
    let result; try { result = await resolveDependency(entry.dependency, { signal, scene, variants: Object.freeze([...variants]) }); } catch (error) { check(); result = { status: 'unavailable', reason: error?.message || 'Dependency lookup failed.' }; } check();
    const available = result?.status === 'available' && sceneDependencyKey(result) === sceneDependencyKey(entry.dependency) && storageKinds.includes(result.storage);
    receipts[index] = { dependency: entry.dependency, scopes: entry.scopes, optional: entry.optional, status: available ? 'available' : 'unavailable',
      reason: available ? null : typeof result?.reason === 'string' ? result.reason.slice(0, 1024) : 'Exact version, hash or usable material is unavailable.',
      storage: available ? result.storage : null, regeneration: available ? result.regeneration === 'available' ? 'available' : 'not-proven' : null };
  } };
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, entries.length) }, resolve));
  const rejected = results.find(result => result.status === 'rejected'); if (rejected) throw rejected.reason; check();
  const blocked = receipts.filter(entry => !entry.optional && entry.status !== 'available'), missingOptional = receipts.filter(entry => entry.optional && entry.status !== 'available');
  const sceneHash = await performanceSceneHash(scene); check();
  return freezeData({ schema: 'lemmings-performance-scene-preflight/v1', sceneId: scene.id, sceneVersion: scene.version, sceneHash,
    variants: [...selected].sort(), status: blocked.length ? 'unavailable' : 'ready', blocked, missingOptional, dependencies: receipts,
    changedBehavior: substitutions.filter(entry => selected.has(entry.variantId)).map(entry => ({ variantId: entry.variantId, label: entry.label, description: entry.changedBehavior })),
    cost: scene.cost, transport: 'paused-local-unarmed', acousticReceipt: false, capacityEvidence: 'authored-bound;candidate-admission-required' });
}
