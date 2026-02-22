import { Animation } from '../render/Animation.js';
import { Frame } from '../render/Frame.js';
import { SoundEventTypes, SoundEffectIds, getSoundBus } from '../game/SoundEvents.js';
import { TriggerTypes } from './TriggerTypes.js';
import { getAppContext } from '../core/dependencies.js';

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
      // Keep sourceScale consistent with GroundRenderer so hi-res object frames
      // can be sampled down into classic world-space sprite sizes once at load time.
      const srcScaleX = Math.max(1, (objectImg.sourceScaleX | 0) || 1);
      const srcScaleY = Math.max(1, (objectImg.sourceScaleY | 0) || 1);
      for (let i = 0, len = frames.length; i < len; ++i) {
        const src = objectImg.frames[i];
        if (src instanceof Frame && srcScaleX === 1 && srcScaleY === 1) {
          frames[i] = src;
          continue;
        }

        const srcWidth = (src instanceof Frame ? src.width : objectImg.width) | 0;
        const srcHeight = (src instanceof Frame ? src.height : objectImg.height) | 0;
        const outWidth = Math.max(1, Math.floor(srcWidth / srcScaleX));
        const outHeight = Math.max(1, Math.floor(srcHeight / srcScaleY));
        const f = new Frame(outWidth, outHeight);
        f.clear();

        const sample = (x, y) => (y * srcWidth) + x;
        if (src instanceof Frame) {
          const srcBuf = src.getBuffer();
          const srcMask = src.getMask();
          for (let y = 0; y < outHeight; y += 1) {
            const srcY = y * srcScaleY;
            for (let x = 0; x < outWidth; x += 1) {
              const idx = sample(x * srcScaleX, srcY);
              if (!srcMask[idx]) continue;
              f.setPixel(x, y, srcBuf[idx]);
            }
          }
        } else {
          const pal = objectImg.palette;
          if (!pal) {
            frames[i] = f;
            continue;
          }
          const palLookup = pal._rgbaCache ||= Uint32Array.from({ length: 128 }, (_, j) => pal.getColor(j));
          for (let y = 0; y < outHeight; y += 1) {
            const srcY = y * srcScaleY;
            for (let x = 0; x < outWidth; x += 1) {
              const idx = sample(x * srcScaleX, srcY);
              const ci = src[idx];
              if (ci & 0x80) continue;
              f.setPixel(x, y, palLookup[ci]);
            }
          }
        }
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
      const history = getAppContext()?.game?.history ?? null;
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
