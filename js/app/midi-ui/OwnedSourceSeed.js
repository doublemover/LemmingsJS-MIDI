import { instrumentVariationValue } from '../../midi/content/InstrumentIdentityVariation.js';

export function ownedSourceSeed(source, patch, intent, performance) {
  return source.extended ? Math.min(0xffffffff, Math.floor((instrumentVariationValue([source.seedDomain, patch.id, patch.revision,
    intent.actorId == null ? ['event-only', intent.onsetId ?? intent.voiceId] : [intent.worldId, intent.generation, intent.actorId],
    intent.onsetId ?? intent.voiceId, performance?.variation?.seed ?? 0]) + 1) * 2147483648)) : 0;
}
