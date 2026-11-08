import { canonicalDataText, freezeData, hashData } from '../../../core/CanonicalData.js';
import { validateSceneCavityBody } from './SceneCavityBody.js';
import { compileCavitySoundMap, validateCavitySoundRegion } from './physical/CavitySoundMap.js';
import { topologyResultMatchesRegion } from './physical/TopologyInstrumentRegion.js';

const fail = message => Object.assign(new Error(message), { code: 'scene-cavity-rehearsal-unavailable' });
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
export function sceneCavityRehearsalProfile(raw, scene) {
  const mechanism = validateSceneCavityBody(raw), region = scene.causalMappings.topologyRegions?.find(region => region.id === mechanism.map.topologyRegionRef.id);
  if (!region) throw fail('The private cavity prefix needs its exact authored region.');
  validateCavitySoundRegion(mechanism.map, region);
  const b = region.bounds, bodyCount = mechanism.map.bodyRecipe === 'throat-duet' ? 2 : 1;
  if ((b.x2 - b.x1) * (b.y2 - b.y1) > 4096 || scene.cost.sharedBodies !== bodyCount * 2) throw fail('The private cavity profile supports up to4096square pixels and the complete declared active/retained body bound.');
  return Object.freeze({ mechanism, region, bodyCount, modeCount: bodyCount * 4, retainedBodies: bodyCount * 2, strategy: 'initial-cavity-static-geometry' });
}
const geometryKey = result => canonicalDataText({ definition: result.definitionSignature, worldId: result.worldId, generation: result.generation, coverage: result.coverage, maskDigest: result.maskDigest, runs: result.runs,
  components: result.components.map(({ geometryChanged, lineage, ...component }) => component) }, { maxBytes: 1048576, maxNodes: 65536 }).text;
export function createSceneCavityRehearsalObservation(profile) {
  let initial = null, previous = null, key = null; const revisions = [];
  return Object.freeze({
    observe(batch) {
      const result = batch.snapshot?.topology?.regions?.find(entry => entry.regionId === profile.region.id)?.current;
      if (!topologyResultMatchesRegion(result, profile.region) || result.coverage !== 'complete' || result.worldId !== batch.worldId || result.generation !== batch.generation || result.sourceRevision !== batch.snapshot.terrainRevision || result.tick > batch.tick) throw fail('Every private cavity prefix tick requires actual complete geometry.');
      if (!initial) { initial = result; key = geometryKey(result); }
      else if (result !== previous && geometryKey(result) !== key) throw fail('This private cavity preview supports unchanged initial geometry; changing-body history needs its captured graph render.');
      if (!revisions.length || revisions.at(-1).sourceRevision !== result.sourceRevision) { if (revisions.length >= 512 || revisions.length && (result.sourceRevision <= revisions.at(-1).sourceRevision || batch.tick <= revisions.at(-1).tick)) throw fail('The private cavity geometry revision order is unavailable.'); revisions.push(Object.freeze({ sourceRevision: result.sourceRevision, tick: batch.tick })); }
      previous = result;
    },
    snapshot() { if (!initial || !revisions.length) throw fail('The private cavity prefix has no observed geometry.'); return freezeData({ schema: 'lemmings-private-cavity-geometry/v1', policy: 'complete-invariant-initial-geometry', initial, revisions: [...revisions], semanticOnsetsAdded: 0 }); }
  });
}
export async function prepareSceneCavityRehearsal({ scene, mechanism, source, sampleRate }) {
  const profile = sceneCavityRehearsalProfile(mechanism, scene), evidence = source.cavity, initial = evidence?.initial;
  if (!keys(evidence, ['schema', 'policy', 'initial', 'revisions', 'semanticOnsetsAdded']) || evidence.schema !== 'lemmings-private-cavity-geometry/v1' || evidence.policy !== 'complete-invariant-initial-geometry' || evidence.semanticOnsetsAdded !== 0 || !Array.isArray(evidence.revisions) || !evidence.revisions.length || evidence.revisions.length > 512 || !topologyResultMatchesRegion(initial, profile.region) || initial.coverage !== 'complete' || initial.worldId !== source.worldId || initial.generation !== source.generation || !integer(initial.tick) || initial.tick > source.ticks) throw fail('The private cavity render needs the complete observed initial geometry and bounded source revision ledger.');
  const revisions = new Map(); let lastTick = -1, lastRevision = -1;
  for (const entry of evidence.revisions) { if (!keys(entry, ['sourceRevision', 'tick']) || !integer(entry.sourceRevision) || !integer(entry.tick) || entry.tick < initial.tick || entry.tick > source.ticks || entry.tick <= lastTick || entry.sourceRevision <= lastRevision) throw fail('Private cavity geometry revisions must be complete, ordered and inside the actual prefix.'); revisions.set(entry.sourceRevision, entry.tick); lastTick = entry.tick; lastRevision = entry.sourceRevision; }
  if (evidence.revisions[0].sourceRevision !== initial.sourceRevision || evidence.revisions[0].tick !== source.initialTick + 1) throw fail('The initial geometry does not begin its observed revision ledger.');
  const model = await compileCavitySoundMap(profile.mechanism.map, profile.region, initial, { sampleRate });
  if (model.status !== 'ready') throw fail(model.reason);
  const selected = initial.components.find(component => component.id === model.excitationComponentId);
  const begins = source.intents.filter(intent => intent.kind === 'begin');
  if (!begins.length || begins.some(intent => { const binding = intent.topologyBinding, mapping = scene.causalMappings.instruments.find(mapping => mapping.id === intent.mappingId); return !mapping || mapping.sourceKind !== intent.physicalSourceKind || mapping.topologyRegionId !== profile.region.id || mapping.topologyAnchorId !== profile.mechanism.map.componentSelector.anchorIds[0] || intent.worldId !== source.worldId || intent.generation !== source.generation || !['TerrainWorkCommitted', 'ContactResolved', 'ContactSpanBegan'].includes(intent.physicalSourceKind) || !Array.isArray(intent.sourceEventIds) || !intent.sourceEventIds.length || binding?.regionId !== profile.region.id || binding.regionRevision !== profile.region.revision || binding.bodyId !== profile.mechanism.map.id || binding.mappingRevision !== profile.region.mapping.revision || binding.componentId !== model.excitationComponentId || !revisions.has(binding.boundTopologyRevision) || !integer(intent.scoreTime?.simTick) || intent.scoreTime.simTick < revisions.get(binding.boundTopologyRevision) || intent.scoreTime.simTick > source.ticks || binding.pitchCents !== selected.musical.pitchCents || intent.pitch?.cents !== binding.pitchCents || intent.pitch.referenceHz !== 440 || binding.bindingPolicy !== 'endOfTick' || !integer(binding.sourceEditRevision) || binding.sourceEditRevision > binding.boundTopologyRevision; })) throw fail('Every private cavity onset must retain its actual selected work/contact cause and an observed completed topology revision.');
  return Object.freeze({ profile, model, geometryHash: await hashData(evidence, { maxBytes: 2 * 1048576, maxNodes: 131072 }), sourceOnsets: begins.length });
}
