// @ts-check
import { SoundEventTypes, SoundEffectIds } from '../SoundEvents.js';

const MIDI_FLAG_OWNER_KIND = 'midi_flag';

const clonePlainObject = (value) => {
  if (!value || typeof value !== 'object') return null;
  return { ...value };
};

const createMidiFlagTriggerOwner = (game, snap = {}) => {
  const data = clonePlainObject(snap.ownerData) || {};
  const midiFlagId = data.midiFlagId ?? null;
  const triggerType = data.triggerType ?? snap.triggerType ?? null;
  const pieceId = data.pieceId ?? null;
  return {
    id: snap.ownerId ?? data.ownerId ?? `midi_flag_${midiFlagId ?? 'unknown'}`,
    __historyKind: MIDI_FLAG_OWNER_KIND,
    __historyData: { midiFlagId, triggerType, pieceId },
    onTrigger: (_tick, lemming, trigger, x, y) => {
      game?.soundEvents?.emit?.({
        type: SoundEventTypes.TRAP_TRIGGER,
        sfxId: SoundEffectIds.NONE,
        triggerType,
        midiFlagId,
        pieceId,
        x,
        y,
        lemmingId: lemming?.id ?? null,
        triggerBounds: {
          x1: trigger?.x1 ?? snap.x1,
          y1: trigger?.y1 ?? snap.y1,
          x2: trigger?.x2 ?? snap.x2,
          y2: trigger?.y2 ?? snap.y2
        }
      });
    }
  };
};

export { MIDI_FLAG_OWNER_KIND, clonePlainObject, createMidiFlagTriggerOwner };
