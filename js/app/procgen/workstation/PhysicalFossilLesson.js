import { canonicalDataText } from '../../../core/CanonicalData.js';
import { cropCausalOnsetCoverage } from '../../../midi/content/CausalOnsetCoverage.js';
import { readLessonPickupCrossing } from './PhysicalLessonCause.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = value => canonicalDataText(value, { maxBytes: 262144, maxNodes: 16384 }).text;
export function createFossilLessonObservation({ definition, graph, releaseGesture, soundIdentity, assists }) {
  if (definition.success.kind !== 'hear-fossil' || assists !== false) throw new Error('Hear the fossil requires the manual one-contact practice scene.');
  const physical = stamp({ graph, releaseGesture }), baseline = [], changed = [];
  let phase = 'observe-baseline', reason = null, seed = null;
  const result = () => ({ phase, reason, baseline: [...baseline], changed: [...changed], journey: {
    kind: 'hear-fossil', assetSaved: !!seed, seedRegionContainsBaseline: !!seed, assetHash: seed?.assetHash || null,
    definitionHash: seed?.definitionHash || null, bakedOnsetsInRegion: seed?.bakedOnsets ?? null, newSemanticOnsets: changed.length,
    summary: 'Saved frozen asset: ' + (seed ? 'yes' : 'pending') + '; original contact in selected material: ' + (seed ? 'source-linked' : 'unverified') +
      '; new physical playback onsets: ' + changed.length + '/2. Baked sample transients are ancestry, not additional new notes.'
  } });
  const samePhysical = context => context.assists === false && stamp({ graph: context.graph, releaseGesture: context.releaseGesture }) === physical;
  return Object.freeze({
    state: result,
    material(receipt, context) {
      if (phase !== 'prepare-fossil' || receipt?.kind !== 'saved-seed-applied') return false;
      if (!samePhysical(context)) throw new Error('This journey keeps the physical pickup and finite release policy unchanged.');
      if (receipt.durable !== true || receipt.transform !== 'hammer-seed' || !hash(receipt.assetHash) || !hash(receipt.definitionHash) ||
          !hash(receipt.packHash) || !receipt.assetHashes?.includes(receipt.assetHash) ||
          receipt.bakedCausePolicy !== 'new-actor-owns-playback;old-events-are-baked-ancestry-only' ||
          !context.soundReferences?.some(ref => ref.laneId === receipt.laneId && ref.definitionHash === receipt.definitionHash && ref.packHash === receipt.packHash)) return false;
      let coverage = null;
      try { if (receipt.causalOnsets) coverage = cropCausalOnsetCoverage(receipt.causalOnsets, 0, receipt.causalOnsets.frames); } catch { /* An unusable annotation cannot grade the source. */ }
      const original = baseline[0], entry = coverage?.entries.find(value => value.intentId === original.intentId &&
        value.worldId === original.worldId && value.generation === original.generation && original.sourceEventIds.every(id => value.sourceEventIds.includes(id)));
      if (!coverage?.complete || coverage.takeId !== original.recordedTakeId || !entry) {
        reason = 'The applied seed lacks complete source-linked coverage of this observed contact. Keep it playable, or render the matching recorded take and freeze a range containing that onset. A general master capture cannot prove isolated cause identity.';
        return result();
      }
      seed = { assetHash: receipt.assetHash, definitionHash: receipt.definitionHash, packHash: receipt.packHash, laneId: receipt.laneId,
        soundIdentity: context.soundIdentity, bakedOnsets: coverage.total };
      phase = 'observe-fossil-contacts'; reason = 'The exact saved seed includes the original contact. Explicitly perform two new physical pickup crossings; its baked transients do not add semantic onsets.'; return result();
    },
    observe({ batch, intents, context }) {
      if (!samePhysical(context) || phase === 'observe-baseline' && context.soundIdentity !== soundIdentity ||
          seed && context.soundIdentity !== seed.soundIdentity) throw new Error('The physical policy or selected frozen source changed outside the declared lesson action.');
      if (!['observe-baseline', 'observe-fossil-contacts'].includes(phase)) return result();
      const facts = new Map(batch.facts.map(fact => [fact.eventId, fact]));
      for (const intent of intents) {
        const record = readLessonPickupCrossing(definition, batch, intent, facts);
        if (!record || [...baseline, ...changed].some(value => value.intentId === record.intentId ||
            value.sourceEventIds.some(id => record.sourceEventIds.includes(id)))) continue;
        if (phase === 'observe-baseline') {
          if (typeof context.causalTakeId !== 'string' || !context.causalTakeId || context.causalTakeId.length > 512) {
            reason = 'Start a causal take explicitly, then perform a fresh contact. The lesson needs the recorded source identity before it can recognize that contact in frozen material.'; continue;
          }
          baseline.push({ ...record, recordedTakeId: context.causalTakeId }); phase = 'prepare-fossil';
          reason = 'Stop and save this causal take. Render it, harvest a short range containing the contact, compile Hammer seed, audition, save and Apply it through Seed Lab.'; break;
        }
        changed.push({ ...record, assetHash: seed.assetHash, definitionHash: seed.definitionHash, packHash: seed.packHash });
        if (changed.length === definition.success.minimumContacts) { phase = 'physical-evidence-observed'; reason = null; break; }
      }
      return result();
    }
  });
}
