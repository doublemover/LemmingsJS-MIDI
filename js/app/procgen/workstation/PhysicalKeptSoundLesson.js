import { readLessonPickupCrossing } from './PhysicalLessonCause.js';
import { physicalLessonPolicy } from './PhysicalLessonPolicy.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

// This predicate observes existing edits/storage/causes; it executes no lesson actions.
export function createKeptSoundLessonObservation({ definition, graph, releaseGesture, soundIdentity, assists }) {
  if (definition.success.kind !== 'make-and-keep' || assists !== false) throw new Error('Make and keep requires the manual practice scene.');
  const physical = physicalLessonPolicy(graph, releaseGesture), baseline = [], changed = [];
  let phase = 'observe-baseline', reason = null, kept = null, saved = null, reopened = false, nextPrediction = '';
  const result = () => ({ phase, reason, baseline: [...baseline], changed: [...changed], journey: {
    kind: 'make-and-keep', forkKept: !!kept, projectSaved: !!saved, exactProjectReopened: reopened,
    definitionHash: kept?.definitionHash || null, packHash: kept?.packHash || null, documentId: saved?.documentId || null,
    storedRevision: saved?.storedRevision ?? null, nextPrediction, materialEvidence: 'exact-kept-reference-and-named-storage-commit;hearing-separate'
  } });
  const samePhysical = context => context.assists === false && physicalLessonPolicy(context.graph, context.releaseGesture) === physical;
  const exactMaterial = context => Array.isArray(context.soundReferences) && context.soundReferences.some(ref =>
    ref.laneId === kept?.laneId && ref.definitionHash === kept.definitionHash && ref.packHash === kept.packHash &&
    ref.patchId === kept.patchId && ref.revision === kept.revision);
  return Object.freeze({
    state: result,
    material(receipt, context) {
      if (phase !== 'keep-sound') return false;
      if (receipt?.kind !== 'kept-fork-applied' || !hash(receipt.definitionHash) || !hash(receipt.packHash) ||
          typeof receipt.patchId !== 'string' || !integer(receipt.revision) || receipt.revision < 1 || typeof receipt.laneId !== 'string' ||
          !samePhysical(context) || context.soundIdentity === soundIdentity ||
          !Array.isArray(context.soundReferences) || !context.soundReferences.some(ref => ref.laneId === receipt.laneId &&
            ref.definitionHash === receipt.definitionHash && ref.packHash === receipt.packHash && ref.patchId === receipt.patchId && ref.revision === receipt.revision)) return false;
      kept = { laneId: receipt.laneId, definitionHash: receipt.definitionHash, packHash: receipt.packHash, patchId: receipt.patchId, revision: receipt.revision,
        soundIdentity: context.soundIdentity };
      phase = 'await-project-save'; reason = 'The kept fork is applied. Save this named project through the ordinary Save control; a prepared download is a separate outcome.';
      return result();
    },
    document(receipt, context) {
      if (!['await-project-save', 'await-project-reopen'].includes(phase)) return false;
      if (!samePhysical(context) || !exactMaterial(context) || context.soundIdentity !== kept.soundIdentity) throw new Error('The saved/reopened project changed the physical lesson policy or exact kept sound. Reset, or return to the last playable project.');
      if (receipt?.kind === 'project-saved' && phase === 'await-project-save') {
        if (typeof receipt.documentId !== 'string' || !receipt.documentId || !integer(receipt.storedRevision) || receipt.storedRevision < 1 ||
            !integer(receipt.tick) || receipt.durable !== true) { reason = 'This host did not provide a named durable project commit. Keep the playable project; no save success was inferred.'; return result(); }
        saved = { documentId: receipt.documentId, storedRevision: receipt.storedRevision, tick: receipt.tick };
        phase = 'await-project-reopen'; reason = 'Open this exact named project revision with the ordinary Load control. Clicking Save alone does not prove reopen.'; return result();
      }
      if (receipt?.kind !== 'project-reopened' || phase !== 'await-project-reopen') return false;
      if (receipt.documentId !== saved.documentId || receipt.storedRevision !== saved.storedRevision || receipt.tick !== saved.tick || receipt.durable !== true)
        throw new Error('The opened document is not the exact saved lesson revision. Return to that project or reset this attempt.');
      reopened = true; phase = 'predict-next-contact'; reason = 'The exact kept patch survived reopen. Predict the next real contact, then explicitly continue the physical world.'; return result();
    },
    predictNext(value) {
      if (phase !== 'predict-next-contact' || typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error('Predict the next real contact after exact reopen.');
      nextPrediction = value.trim(); phase = 'observe-next-contact'; reason = null; return result();
    },
    observe({ batch, intents, context }) {
      if (!samePhysical(context)) throw new Error('Keep terrain mappings and the finite release policy unchanged. This journey changes sound alone.');
      if (phase === 'observe-baseline' && context.soundIdentity !== soundIdentity || kept && context.soundIdentity !== kept.soundIdentity)
        throw new Error('The lesson sound changed outside the declared kept-fork boundary.');
      if (!['observe-baseline', 'observe-next-contact'].includes(phase)) return result();
      if (phase === 'observe-next-contact' && (!reopened || !exactMaterial(context) || batch.tick <= saved.tick)) return result();
      const facts = new Map(batch.facts.map(fact => [fact.eventId, fact]));
      for (const intent of intents) {
        const cause = readLessonPickupCrossing(definition, batch, intent, facts);
        if (!cause || [...baseline, ...changed].some(value => value.intentId === cause.intentId)) continue;
        const record = { ...cause, ...(kept ? { definitionHash: kept.definitionHash, packHash: kept.packHash } : {}) };
        if (phase === 'observe-baseline') { baseline.push(record); phase = 'keep-sound'; reason = 'Record this real contact as a causal take if needed for A/B. Generate, compare, Keep and Apply one sound variation; leave the physical policy alone.'; }
        else { changed.push(record); phase = 'physical-evidence-observed'; reason = null; }
        break;
      }
      return result();
    }
  });
}
