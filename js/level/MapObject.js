import { Animation } from '../render/Animation.js';
import { Frame } from '../render/Frame.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from '../game/SoundEvents.js';
import { TriggerTypes } from './TriggerTypes.js';

class MapObject {
  /** WeakMap<objectImg, Frame[]> – shared across all MapObject instances. */
  static _frameCache = new WeakMap();
  constructor (ob, objectImg, animation = new Animation(), triggerType = TriggerTypes.NO_TRIGGER) {
    this.ob              = ob;
    this.obID            = ob.id;
    this.x               = ob.x;
    this.y               = ob.y;
    this.drawProperties  = ob.drawProperties;
    this.triggerType     = triggerType;

    let frames = MapObject._frameCache.get(objectImg);
    if (!frames) {
      frames = new Array(objectImg.frames.length);
      for (let i = 0, len = frames.length; i < len; ++i) {
        const f = new Frame(objectImg.width, objectImg.height);
        f.clear();
        // Draw once (palette → RGBA). This cost is now paid ONE time per sprite
        f.drawPaletteImage(objectImg.frames[i], objectImg.width, objectImg.height,
          objectImg.palette, 0, 0);
        frames[i] = f;
      }
      MapObject._frameCache.set(objectImg, frames);
    }

    this.animation                 = animation;
    this.animation.loop            = objectImg.animationLoop;
    this.animation.firstFrameIndex = objectImg.firstFrameIndex;
    this.animation.objectImg       = objectImg;
    this.animation.frames          = frames;
  }

  /** Called when a lemming collides with this object's trigger zone. */
  onTrigger (globalTick, lemming = null, trigger = null, x = null, y = null) {
    // 1. restart visual cue
    if (this.animation && !this.animation.loop) {
      const history = globalThis?.lemmings?.game?.history ?? null;
      if (history?.recordObjectAnimation) {
        const prev = {
          firstFrameIndex: this.animation.firstFrameIndex,
          isFinished: this.animation.isFinished
        };
        this.animation.restart(globalTick);
        const next = {
          firstFrameIndex: this.animation.firstFrameIndex,
          isFinished: this.animation.isFinished
        };
        history.recordObjectAnimation(this, prev, next);
      } else {
        this.animation.restart(globalTick);
      }
    }
    // 2. play sound, spawn particles
    const triggerType = trigger?.type ?? this.triggerType;
    let sfxId = null;
    let eventType = null;

    if (triggerType === TriggerTypes.TRAP) {
      sfxId = trigger?.soundIndex ?? null;
      eventType = SoundEventTypes.TRAP_TRIGGER;
    } else if (triggerType === TriggerTypes.KILL ||
               triggerType === TriggerTypes.FRYING) {
      sfxId = SoundEffectIds.TRAP_FIRE;
      eventType = SoundEventTypes.LEMMING_FIRE;
    }

    if (eventType && Number.isFinite(sfxId) && sfxId > 0) {
      const soundBus = getSoundBus();
      soundBus?.emitSfx?.(
        eventType,
        sfxId,
        {
          objectId: this.obID,
          triggerType,
          trapSoundId: trigger?.soundIndex ?? null,
          lemmingId: lemming?.id ?? null,
          x: x ?? lemming?.x ?? this.x,
          y: y ?? lemming?.y ?? this.y
        }
      );
    }
  }
}
export { MapObject };
