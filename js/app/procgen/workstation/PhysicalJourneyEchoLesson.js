import { physicalLessonPolicy } from './PhysicalLessonPolicy.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
export function createJourneyEchoLessonObservation({ definition, graph, releaseGesture, soundIdentity, assists }) {
  if (definition.success.kind !== 'journey-versus-echo' || assists !== false) throw new Error('The journey/echo lesson needs the manual Quarry carrier score.');
  const policy = physicalLessonPolicy(graph, releaseGesture), baseline = [], changed = [];
  let phase = 'observe-baseline', reason = null, route = null, delivery = null, press = null, releasedTick = null;
  const samePhysical = context => context.assists === false && context.soundIdentity === soundIdentity && physicalLessonPolicy(context.graph, context.releaseGesture) === policy;
  const result = () => ({ phase, reason, baseline: [...baseline], changed: [...changed], journey: {
    kind: 'journey-versus-echo', physicalRouteCommandId: route?.id ?? null, cargoTokenId: delivery?.tokenId ?? null,
    captureTick: delivery?.captureTick ?? null, deliveryTick: delivery?.deliveryTick ?? null,
    physicalTravelTicks: delivery ? delivery.deliveryTick - delivery.captureTick : null,
    audioDelaySeconds: press?.delaySeconds ?? null, echoControlSubmitted: !!press, addedEchoSemanticOnsets: 0,
    echoPcm: 'unmeasured;submitted-control-and-cause-observation-only',
    summary: 'Actual carrier arrival: ' + (baseline.length === 2 ? 'observed' : 'pending') + '; held echo input: ' +
      (changed.length > baseline.length ? 'source-linked' : 'pending') + '; released send and quiet physical batch: ' +
      (phase === 'physical-evidence-observed' ? 'observed' : 'pending') + '. Travel ticks and audio-delay seconds are separate domains.'
  } });
  return Object.freeze({
    state: result,
    effect(receipt, context) {
      if (!samePhysical(context)) throw new Error('Keep the physical score and sound unchanged while comparing the explicit audio return.');
      if (receipt?.status !== 'accepted' || receipt.stage !== 'native-control-submitted' || !hash(receipt.graphDefinitionHash) ||
          !integer(receipt.ownerRouteRevision) || !integer(receipt.targetFrame) || !integer(context.tick) ||
          receipt.sourceScope !== 'physical-owner-sum' || receipt.space01 !== 0 || !(receipt.return01 > 0) ||
          !(receipt.delaySeconds >= 0.07 && receipt.delaySeconds <= 0.75)) return false;
      if (receipt.kind === 'echo-throw-pressed' && phase === 'perform-echo' && receipt.throw01 > 0) {
        press = { hash: receipt.graphDefinitionHash, routeRevision: receipt.ownerRouteRevision, delaySeconds: receipt.delaySeconds, tick: context.tick };
        changed.length = 0; releasedTick = null; phase = 'echo-held'; reason = 'Perform a fresh finite physical arrival while holding THROW. The control submission alone does not prove source input or heard repeats.'; return result();
      }
      if (receipt.kind !== 'echo-throw-released' || phase !== 'echo-held') return false;
      if (receipt.graphDefinitionHash !== press.hash || receipt.ownerRouteRevision !== press.routeRevision) throw new Error('The echo route changed during this throw. Prepare and compare a fresh attempt.');
      if (!changed.length) { press = null; phase = 'perform-echo'; reason = 'No new source-linked physical input was observed during that throw. Repeat with a fresh real arrival; no silent input was invented.'; return result(); }
      releasedTick = context.tick; phase = 'observe-echo-tail'; reason = 'The zero-baseline send was released. Observe a later complete physical batch with no onset: stored echo state can decay without generating another semantic note.'; return result();
    },
    observe({ batch, intents, context }) {
      if (!samePhysical(context)) throw new Error('The lesson changes the safe junction and explicit audio send, not the sound source or release timing policy.');
      const facts = new Map(batch.facts.map(fact => [fact.eventId, fact]));
      for (const fact of batch.facts) {
        const command = fact.requestedCommand;
        if (fact.worldId === batch.worldId && fact.generation === batch.generation && fact.batchId === batch.batchId && fact.kind === 'CommandApplied' && fact.status === 'accepted' && ['manual', 'live-controller'].includes(fact.origin) &&
            command?.id === fact.commandId && command.kind === 'junction-request' &&
            command.parameters?.request?.junctionId === definition.success.junctionId &&
            command.parameters.request.configurationId === definition.success.configurationId &&
            fact.terrain?.junction?.commandId === command.id && fact.terrain.junction.junctionId === definition.success.junctionId &&
            fact.terrain.junction.configurationId === definition.success.configurationId) {
          if (baseline.length) throw new Error('Keep the observed physical route fixed during the audio-echo comparison.');
          route = { id: command.id, tick: batch.tick };
        }
      }
      if (phase === 'observe-baseline') {
        if (!route) { reason = 'Request stepped in Junctions and observe its actual safe application before releasing the carrier. A pending request changes no physical path.'; return result(); }
        const replies = intents.filter(intent => {
          const d = intent.responseDescriptor;
          return intent.kind === 'begin' && intent.mappingId === definition.success.deliveryMappingId &&
            intent.physicalSourceKind === 'CargoDelivery' && intent.worldId === batch.worldId && intent.generation === batch.generation &&
            intent.batchId === batch.batchId && typeof intent.intentId === 'string' && typeof d?.tokenId === 'string' &&
            d.kind === 'physical-cargo-delivery' && d.timedSequence === false && d.deliveryTick === batch.tick &&
            integer(d.captureTick) && d.captureTick >= route.tick && d.captureTick < d.deliveryTick &&
            Array.isArray(intent.sourceEventIds) && intent.sourceEventIds.length > 0 && intent.sourceEventIds.length <= 64 &&
            intent.sourceEventIds.some(id => { const fact = facts.get(id); return fact?.kind === 'MotionCommitted' && fact.actorId === intent.actorId &&
              fact.worldId === batch.worldId && fact.generation === batch.generation && fact.batchId === batch.batchId; });
        });
        if (replies.length !== 2 || replies[0].intentId === replies[1].intentId || replies[0].actorId !== replies[1].actorId ||
            replies[0].responseDescriptor.tokenId !== replies[1].responseDescriptor.tokenId) return result();
        delivery = { ...replies[0].responseDescriptor };
        for (const intent of replies) baseline.push({ intentId: intent.intentId, batchId: batch.batchId, actorId: intent.actorId, sourceEventIds: [...intent.sourceEventIds],
          tokenId: delivery.tokenId, captureTick: delivery.captureTick, deliveryTick: delivery.deliveryTick });
        phase = 'perform-echo'; reason = 'That actual arrival delivered one simultaneous two-note response. Now prepare plain Quarry Echo with SPACE0 and a positive RETURN, then hold THROW over a fresh real arrival and release it.'; return result();
      }
      const begins = intents.filter(intent => intent.kind === 'begin');
      if (begins.some(intent => !Array.isArray(intent.sourceEventIds) || !intent.sourceEventIds.some(id => { const fact = facts.get(id); return !!fact && fact.actorId === intent.actorId && fact.worldId === batch.worldId && fact.generation === batch.generation && fact.batchId === batch.batchId; })))
        throw new Error('An onset without a current physical cause entered the echo comparison. Effect repeats must never become semantic notes.');
      if (phase === 'echo-held' && !changed.length && batch.tick > press.tick) {
        const input = begins.find(intent => intent.worldId === batch.worldId && intent.generation === batch.generation && intent.batchId === batch.batchId &&
          Array.isArray(intent.sourceEventIds) && intent.sourceEventIds.length > 0 && intent.sourceEventIds.length <= 64 &&
          intent.sourceEventIds.some(id => { const fact = facts.get(id); return fact?.actorId === intent.actorId && fact.kind === 'MotionCommitted'; }));
        if (input) changed.push(...baseline, { intentId: input.intentId, batchId: batch.batchId, actorId: input.actorId,
          sourceEventIds: [...input.sourceEventIds], evidenceRole: 'new-physical-input-to-explicit-echo-send' });
      }
      if (phase === 'observe-echo-tail' && batch.tick > releasedTick && !begins.length) { phase = 'physical-evidence-observed'; reason = null; }
      return result();
    }
  });
}
