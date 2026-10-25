import { causalRandomDecision, CAUSAL_RANDOM_VERSION, CAUSAL_RANDOM_NAMESPACES } from './CausalRandom.js';
import { plain, freeze, integer } from './physical/PhysicalSchema.js';
const name = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const seed = value => Number.isSafeInteger(value) || name(value);
const clamp = value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
const DESCRIPTORS = ['crowdCellCount', 'actorAction', 'changedSolidCells', 'attemptedCells', 'travelPixels', 'terrainSolidBelow'];
export function validateCausalSeedSet(value, allowed = CAUSAL_RANDOM_NAMESPACES) {
  if (value == null) return null;
  if (!plain(value) || value.version !== 1 || !plain(value.seeds) || Object.entries(value.seeds).some(([namespace, value]) => !allowed.includes(namespace) || !seed(value))) throw new Error('Invalid explicit causal namespace seeds.');
  return freeze({ version: 1, seeds: Object.fromEntries(Object.entries(value.seeds).sort(([a], [b]) => a < b ? -1 : 1)) });
}
export const causalNamespaceSeed = (set, namespace, fallback) => { if (!CAUSAL_RANDOM_NAMESPACES.includes(namespace) || !seed(fallback)) throw new Error('Invalid causal namespace seed lookup.'); return set?.seeds?.[namespace] ?? fallback; };
export function validateCausalProbabilityPolicy(value) {
  if (value == null) return null;
  if (!plain(value) || value.version !== 1 || value.algorithmVersion != null && value.algorithmVersion !== CAUSAL_RANDOM_VERSION || !['cause', 'actor', 'cohort', 'encounter'].includes(value.identity ?? 'cause') || !['generation', 'stable'].includes(value.reseed ?? 'generation') || value.seed != null && !seed(value.seed) || !name(value.drawPurpose ?? 'respond') || (value.drawPurpose?.length || 0) > 64 || !Array.isArray(value.conditions ?? []) || (value.conditions?.length || 0) > 8) throw new Error('Invalid causal probability policy.');
  const conditions = (value.conditions || []).map(condition => {
    if (!plain(condition) || !DESCRIPTORS.includes(condition.descriptor) || !['eq', 'gte', 'lte'].includes(condition.operator) || condition.descriptor === 'actorAction' && (condition.operator !== 'eq' || !name(condition.value) || condition.value.length > 32) || condition.descriptor !== 'actorAction' && (!Number.isFinite(condition.value) || condition.value < 0 || condition.value > 1000000) || !Number.isFinite(condition.multiply) || condition.multiply < 0 || condition.multiply > 8) throw new Error('Invalid bounded local probability condition.');
    return { descriptor: condition.descriptor, operator: condition.operator, value: condition.value, multiply: condition.multiply };
  });
  return freeze({ version: 1, algorithmVersion: CAUSAL_RANDOM_VERSION, identity: value.identity ?? 'cause', reseed: value.reseed ?? 'generation', ...(value.seed != null ? { seed: value.seed } : {}), drawPurpose: value.drawPurpose ?? 'respond', probability01: clamp(value.probability01 ?? 1), conditions });
}
export function createCausalProbabilityContext(batch, { terrainSolidBelow = null } = {}) {
  const source = batch.snapshot?.actors, actors = new Map(), cells = new Map(), duplicates = new Set(), complete = Array.isArray(source) && source.length <= 16384;
  if (complete) for (const actor of source) {
    const id = actor.actorId ?? actor.id;
    if (!integer(id) || !Number.isFinite(actor.x) || !Number.isFinite(actor.y) || actor.removed || actor.disabled) continue;
    if (actors.has(id)) duplicates.add(id); actors.set(id, actor); const key = `${Math.floor(actor.x / 64)}:${Math.floor(actor.y / 64)}`; cells.set(key, (cells.get(key) || 0) + 1);
  }
  return fact => {
    const actor = duplicates.has(fact?.actorId) ? null : actors.get(fact?.actorId), payload = fact?.physicalPayload || {}, before = fact?.positionBefore, after = fact?.positionAfter;
    let solid = null; if (actor && terrainSolidBelow) try { solid = terrainSolidBelow(actor) ? 1 : 0; } catch { /* Unknown geometry cannot become a probability advantage. */ }
    const distance = before && after && [before.x, before.y, after.x, after.y].every(Number.isFinite) ? Math.hypot(after.x - before.x, after.y - before.y) : null;
    return { worldId: batch.worldId, generation: batch.generation, actorId: integer(fact?.actorId) ? fact.actorId : null, cohortId: actor?.birthCohortId ?? fact?.birthCohortId ?? null, encounterId: fact?.episodeId ?? fact?.responseDescriptor?.episodeId ?? (fact?.encounterId ? fact.observationId : null), descriptors: { crowdCellCount: actor && complete && !duplicates.size ? cells.get(`${Math.floor(actor.x / 64)}:${Math.floor(actor.y / 64)}`) : null, actorAction: name(actor?.action ?? fact?.action) && (actor?.action ?? fact?.action).length <= 32 ? actor?.action ?? fact?.action : null, changedSolidCells: Number.isFinite(payload.changedSolidCells) && payload.changedSolidCells >= 0 && payload.changedSolidCells <= 1000000 ? payload.changedSolidCells : null, attemptedCells: Number.isFinite(payload.attemptedCells) && payload.attemptedCells >= 0 && payload.attemptedCells <= 1000000 ? payload.attemptedCells : null, travelPixels: distance != null && distance <= 1000000 ? distance : null, terrainSolidBelow: solid } };
  };
}
export function causalPolicyDecision({ policy = null, namespace = 'musical-response', seed: fallback = 0, mappingId, generation, stableCauseId, drawPurpose = 'respond', probability01 = 1, context = {} }) {
  const threshold = clamp(policy?.probability01 ?? probability01), identity = policy?.identity ?? 'cause', reseed = policy?.reseed ?? 'generation';
  const identityCause = identity === 'cause' ? stableCauseId : identity === 'actor' && integer(context.actorId) ? `actor:${context.worldId}:${context.actorId}` : identity === 'cohort' ? context.cohortId : identity === 'encounter' ? context.encounterId : null;
  const applied = [], base = { version: 1, algorithmVersion: CAUSAL_RANDOM_VERSION, namespace, mappingId, sourceCauseId: stableCauseId ?? null, identityPolicy: identity, reseedPolicy: reseed, actualGeneration: generation, baseProbability01: threshold };
  if (!name(identityCause)) return freeze({ ...base, probability01: 0, accepted: false, reason: `missing-${identity}-identity`, drawUint32: null, inputs: [] });
  let probability = threshold;
  for (const condition of policy?.conditions || []) {
    const value = context.descriptors?.[condition.descriptor];
    if (value == null || typeof value === 'number' && !Number.isFinite(value)) return freeze({ ...base, probability01: 0, accepted: false, reason: 'unknown-local-descriptor', descriptor: condition.descriptor, drawUint32: null, inputs: applied });
    const matches = condition.operator === 'eq' ? value === condition.value : condition.operator === 'gte' ? value >= condition.value : value <= condition.value;
    applied.push({ descriptor: condition.descriptor, value, operator: condition.operator, threshold: condition.value, matches, multiply: condition.multiply }); if (matches) probability = clamp(probability * condition.multiply);
  }
  const decision = causalRandomDecision({ seed: policy?.seed ?? fallback, namespace, mappingId, generation: reseed === 'stable' ? 0 : generation, stableCauseId: identityCause, drawPurpose: policy?.drawPurpose ?? drawPurpose, probability01: probability });
  return freeze({ ...base, ...decision, reason: decision.accepted ? 'selected' : 'probability-not-selected', inputs: applied, securityRandomness: false });
}
