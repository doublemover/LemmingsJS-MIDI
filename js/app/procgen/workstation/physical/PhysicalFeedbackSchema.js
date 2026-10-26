import { validateCausalProbabilityPolicy } from '../CausalProbabilityPolicy.js';
import { plain, identity, integer, bounds, freeze, copy } from './PhysicalSchema.js';
import { validateReleaseGesture } from '../../ReleaseGesture.js';
export const FEEDBACK_COMMANDS = Object.freeze(['assign-worker', 'place-blocker', 'release-blocker', 'set-release-policy', 'set-release-gesture', 'junction-request']);
const KINDS = ['ActorBorn', 'ActionEntered', 'TerrainWorkCommitted', 'ContactResolved', 'PickupCrossing', 'RouteLap', 'EncounterBegan', 'RendezvousCompleted', 'MotifCompleted', 'RestStarted', 'RestEnded', 'RouteCompleted', 'CargoDelivered'];
const id = value => identity(value) && value.length <= 96;
export function validateFeedbackCausality(value) {
  if (!plain(value) || !identity(value.feedbackRootId) || !integer(value.hopCount, 8) || !value.hopCount || !Array.isArray(value.parentCauseIds) || !value.parentCauseIds.length || value.parentCauseIds.length > 64 || value.parentCauseIds.some(key => !identity(key)) || !Array.isArray(value.rulePath) || value.rulePath.length !== value.hopCount || value.rulePath.some(key => !identity(key)) || new Set(value.rulePath).size !== value.rulePath.length || !identity(value.ownerId) || !integer(value.ruleRevision) || !identity(value.epoch)) throw new Error('Invalid bounded physical feedback ancestry.');
  if (value.sourceOccurrenceId != null && (!identity(value.sourceOccurrenceId) || !KINDS.includes(value.sourceKind))) throw new Error('Invalid physical feedback occurrence identity.');
  return freeze({ ...(value.sourceOccurrenceId ? { sourceOccurrenceId: value.sourceOccurrenceId, sourceKind: value.sourceKind } : {}), feedbackRootId: value.feedbackRootId, hopCount: value.hopCount, parentCauseIds: [...new Set(value.parentCauseIds)], rulePath: [...value.rulePath], ruleRevision: value.ruleRevision, ownerId: value.ownerId, epoch: value.epoch });
}
export function validateFeedbackTemplate(value) {
  if (!plain(value) || !FEEDBACK_COMMANDS.includes(value.kind) || !plain(value.parameters || {})) throw new Error('Unsupported physical feedback command family.');
  const p = value.parameters || {}; let parameters;
  if (value.kind === 'assign-worker') { if (!['builders', 'bashers', 'diggers', 'miners'].includes(p.workerKind) || p.targetX != null && (!Number.isFinite(p.targetX) || Math.abs(p.targetX) > 1e9) || p.trackCrew != null && typeof p.trackCrew !== 'boolean') throw new Error('Invalid feedback worker template.'); parameters = { workerKind: p.workerKind, ...(p.targetX == null ? {} : { targetX: p.targetX }), ...(p.trackCrew === true ? { trackCrew: true } : {}) }; }
  else if (value.kind === 'set-release-gesture') parameters = { gesture: validateReleaseGesture(p.gesture) };
  else if (value.kind === 'set-release-policy') { if (!integer(p.spawnSpreadTicks ?? 0, 53) || !Number.isFinite(p.spawnBeatTicks ?? 0) || (p.spawnBeatTicks ?? 0) < 0 || (p.spawnBeatTicks ?? 0) > 4096 || p.spawnBeatTicks == null && p.spawnSpreadTicks == null) throw new Error('Invalid release template.'); parameters = { ...(p.spawnSpreadTicks == null ? {} : { spawnSpreadTicks: p.spawnSpreadTicks }), ...(p.spawnBeatTicks == null ? {} : { spawnBeatTicks: p.spawnBeatTicks }) }; }
  else if (value.kind === 'junction-request') { if (!plain(p.request) || !identity(p.request.junctionId) || !identity(p.request.configurationId) || JSON.stringify(p.request).length > 4096) throw new Error('Invalid approved junction request template.'); parameters = { request: copy(p.request) }; }
  else parameters = {};
  const probability = validateCausalProbabilityPolicy(value.probability); if (probability && !['assign-worker', 'place-blocker', 'release-blocker', 'junction-request'].includes(value.kind)) throw new Error('Probability cannot choose unapproved physical branch families.');
  if (probability?.conditions.some(condition => !['crowdCellCount', 'actorAction', 'terrainSolidBelow'].includes(condition.descriptor))) throw new Error('Physical branches cannot borrow unrelated work or motion descriptors.');
  return freeze({ kind: value.kind, parameters, ...(probability ? { probability } : {}) });
}
const target = value => {
  if (!plain(value) || value.version !== 1 || !['source-actor', 'stable-actor', 'motif-role', 'cohort-rank', 'global'].includes(value.kind)) throw new Error('Unknown versioned physical target selector.');
  if (value.kind === 'stable-actor' && (!integer(value.actorId) || !integer(value.generation))) throw new Error('Stable targets require actor and generation.');
  if (value.kind === 'motif-role' && !id(value.role)) throw new Error('Target role is unresolved.');
  if (value.kind === 'cohort-rank' && (!integer(value.rank, 63) || value.cohortId != null && !identity(value.cohortId))) throw new Error('Invalid cohort role selector.');
  return { version: 1, kind: value.kind, ...(value.kind === 'stable-actor' ? { actorId: value.actorId, generation: value.generation } : {}), ...(value.kind === 'motif-role' ? { role: value.role } : {}), ...(value.kind === 'cohort-rank' ? { rank: value.rank, cohortId: value.cohortId ?? null, order: 'stable-actor-id', requireComplete: true } : {}) };
};
export function validatePhysicalFeedback(value, domain = {}) {
  if (value == null) return null;
  if (!plain(value) || value.version !== 1 || !Array.isArray(value.conductors || []) || !Array.isArray(value.layers || []) || (value.conductors || []).length > 32 || (value.layers || []).length > 16) throw new Error('Physical feedback definition capacity exceeded.');
  let rules = 0; const unique = new Set();
  const read = (input, layer = null) => {
    if (!plain(input) || !id(input.id) || !integer(input.revision) || ++rules > 64 || unique.has(`${layer?.id || 'conductor'}:${input.id}`)) throw new Error('Invalid feedback rule identity.'); unique.add(`${layer?.id || 'conductor'}:${input.id}`);
    const source = input.source;
    if (!plain(source) || !['occurrences', 'participants'].includes(source.measure ?? 'occurrences') || !KINDS.includes(source.kind) || layer && !['PickupCrossing', 'MotifCompleted'].includes(source.kind)) throw new Error('Feedback requires a supported committed physical source.');
    for (const [field, collection] of [['pickupId', 'pickups'], ['motifId', 'motifs'], ['ensembleId', 'ensembles'], ['routeId', 'routes'], ['cargoStationId', 'cargoStations']]) if (source[field] != null && (!identity(source[field]) || !(domain[collection] || []).some(item => item.id === source[field]))) throw new Error(`Unresolved feedback ${field}.`);
    if (source.kind === 'PickupCrossing' && !source.pickupId || source.kind === 'MotifCompleted' && !source.motifId || !['either', 'positive', 'negative'].includes(source.direction ?? 'either')) throw new Error('Missing physical feedback anchor.');
    const selector = target(input.target), template = validateFeedbackTemplate(input.command), global = ['set-release-gesture', 'set-release-policy', 'junction-request'].includes(template.kind);
    if (global !== (selector.kind === 'global')) throw new Error('Feedback target and command family disagree.');
    if (selector.kind === 'motif-role' && (source.kind !== 'MotifCompleted' || !domain.motifs?.find(item => item.id === source.motifId)?.roles.some(role => role.id === selector.role))) throw new Error('Feedback motif role is unavailable.');
    const windowTicks = input.windowTicks ?? 1, threshold = input.threshold ?? 1, hysteresis = input.hysteresis ?? 0, refractoryTicks = input.refractoryTicks ?? 1, fuel = input.fuel ?? 16, eligibilityTicks = input.eligibilityTicks ?? 0, every = input.every ?? 1, offset = input.offset ?? 0;
    if (!integer(windowTicks, 600) || !windowTicks || !integer(threshold, 128) || !threshold || !integer(hysteresis, threshold - 1) || !integer(refractoryTicks, 36000) || !refractoryTicks || !integer(fuel, 256) || !integer(eligibilityTicks, 600) || !integer(every, 4096) || !every || !integer(offset, every - 1)) throw new Error('Invalid feedback window, recurrence or fuel budget.');
    return { id: input.id, revision: input.revision, enabled: input.enabled !== false, source: { kind: source.kind, measure: source.measure ?? 'occurrences', direction: source.direction ?? 'either', ...(source.region ? { region: bounds(source.region) } : {}), ...Object.fromEntries(['pickupId', 'motifId', 'ensembleId', 'routeId', 'cargoStationId', 'operationKind', 'action'].filter(key => source[key] != null).map(key => { if (!identity(source[key])) throw new Error('Invalid predicate identity.'); return [key, source[key]]; })) }, target: selector, command: template, windowTicks, threshold, hysteresis, refractoryTicks, fuel, eligibilityTicks, every, offset };
  };
  const conductors = (value.conductors || []).map(input => read(input));
  const layers = (value.layers || []).map(layer => {
    if (!plain(layer) || !id(layer.id) || !integer(layer.revision) || !Array.isArray(layer.rules) || layer.rules.length > 16 || !Array.isArray(layer.baseReferences || []) || (layer.baseReferences || []).length > 32) throw new Error('Invalid intervention layer.');
    const baseReferences = (layer.baseReferences || []).map(ref => { if (!plain(ref) || !['route', 'fragment'].includes(ref.kind) || !identity(ref.id) || !integer(ref.revision)) throw new Error('Invalid layer base reference.'); if (ref.kind === 'route' && !domain.routes?.some(route => route.id === ref.id)) throw new Error('Unresolved layer route.'); return { kind: ref.kind, id: ref.id, revision: ref.revision }; });
    if (layer.humanCapture != null && (!plain(layer.humanCapture) || layer.humanCapture.version !== 1 || layer.humanCapture.anchorChoice !== 'explicit-user-binding' || JSON.stringify(layer.humanCapture).length * 2 > 16384)) throw new Error('Invalid bounded human intervention capture.');
    return { id: layer.id, revision: layer.revision, enabled: layer.enabled !== false, baseReferences, rules: layer.rules.map(rule => read(rule, layer)), ...(layer.humanCapture ? { humanCapture: copy(layer.humanCapture) } : {}) };
  });
  if (new Set(layers.map(layer => layer.id)).size !== layers.length) throw new Error('Duplicate intervention layer.');
  return freeze({ version: 1, conductors, layers, policy: { load: 'disarmed', replay: 'authoritative-command-tape', minimumDelayTicks: 1, maximumCommandsPerTick: 16, globalFuel: 1024, maximumActorProposals: 16, maximumProposalsPer54Ticks: 32, missedAnchors: 'no-catch-up', rejectedAttempts: 'consume-fuel', maximumHopCount: 8 } });
}
export function planPhysicalFeedback(value) {
  const rows = [...(value?.conductors || []).map(rule => ({ owner: 'conductor', rule })), ...(value?.layers || []).flatMap(layer => layer.rules.map(rule => ({ owner: layer.id, rule })))];
  return freeze({ version: 1, liveByDefault: false, exactTapeReevaluates: false, batchAdmission: 'all-or-none-up-to-16-canonical-commands', maximumProposalsPerOccurrence: 1, maximumProposalsPerEpoch: Math.min(1024, rows.reduce((sum, { rule }) => sum + rule.fuel, 0)), rules: rows.map(({ owner, rule }) => ({ owner, ruleId: rule.id, source: rule.source, target: rule.target, command: rule.command.kind, resource: ['set-release-policy', 'set-release-gesture'].includes(rule.command.kind) ? 'release-policy' : rule.command.kind === 'junction-request' ? 'terrain-authoring' : 'actor-and-worker-inventory', eligibilityTicks: rule.eligibilityTicks, fuel: rule.fuel })) });
}
