import { Animation } from '../render/Animation.js';
import { Frame } from '../render/Frame.js';
import { SoundEventTypes, SoundEffectIds } from '../game/SoundEvents.js';
import { TriggerTypes } from './TriggerTypes.js';
import { getRuntimeHistory, getRuntimeSoundEvents } from '../game/GameRuntime.js';

class MapObject {
  /** WeakMap<objectImg, Frame[]> – shared across all MapObject instances. */
  static _frameCache = new WeakMap();
  static _characterFrameCache = new WeakMap();
  static _characterSupportCache = new WeakMap();
  constructor (ob, objectImg, animation = new Animation(), triggerType = TriggerTypes.NO_TRIGGER, runtime = null) {
    this.ob              = ob;
    this.obID            = ob.id;
    this.x               = ob.x;
    this.y               = ob.y;
    this.drawProperties  = ob.drawProperties;
    this.triggerType     = triggerType;
    this.runtime         = runtime;

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
    const firstFrame = frames[0];
    if (Number.isFinite(firstFrame?.width) && Number.isFinite(firstFrame?.height)) {
      this._frameWidth = firstFrame.width;
      this._frameHeight = firstFrame.height;
    }
  }

  setRuntime(runtime = null) {
    this.runtime = runtime;
  }

  characterContact(lem, tick, kind) {
    if (kind === 'crush' && this.animation.objectImg?.characterVictim) {
      const info = this.animation.objectImg;
      let support = MapObject._characterSupportCache.get(info);
      if (support == null) {
        support = -1;
        const pixels = info.frames[1];
        if (pixels && !(pixels instanceof Frame)) for (let i = 0; i < pixels.length; i++) {
          if (pixels[i] === 1 || pixels[i] === 2) support = Math.max(support, Math.floor(i / info.width) + 2);
        }
        MapObject._characterSupportCache.set(info, support);
      }
      if (support >= 0) return { y: this.y + support, surfaceY: this.y + support - 1 };
    }
    if (!['water', 'acid', 'lava'].includes(kind)) return { y: lem.y, surfaceY: lem.y - 1 };
    const surfaceY = this.liquidSurface(lem.x, tick + 1) ?? lem.y - 1;
    return { y: surfaceY + 1, surfaceY, surfaceOwner: this, surfaceTick: tick + 1 };
  }

  liquidSurface(x, tick) {
    const frame = this.animation.getFrame(tick), column = Math.round(x - this.x);
    if (!frame || column < 0 || column >= frame.width) return null;
    this._surfaceColumns ||= new WeakMap();
    let columns = this._surfaceColumns.get(frame);
    if (!columns) { columns = new Int16Array(frame.width).fill(-1); this._surfaceColumns.set(frame, columns); }
    if (columns[column] >= 0) return this.y + columns[column];
    for (let y = 0; y < frame.height; y++) {
      const sourceY = this.drawProperties?.isUpsideDown ? frame.height - y - 1 : y;
      if (!frame.mask[sourceY * frame.width + column]) continue;
      columns[column] = y;
      return this.y + y;
    }
    return null;
  }

  getFrame(tick) {
    const original = this.animation.getFrame(tick), owner = this.characterVictimPresentation;
    if (!original || !owner || owner.epoch !== owner.pool?.epoch || !owner.provider.hasCustomCharacters?.()) return original;
    const info = this.animation.objectImg;
    let cache = MapObject._characterFrameCache.get(info);
    if (!cache) { cache = new WeakMap(); MapObject._characterFrameCache.set(info, cache); }
    if (cache.has(original)) return cache.get(original);
    const index = this.animation.frames.indexOf(original), pixels = info.frames[index], neutral = info.frames[0];
    if (!pixels || pixels instanceof Frame || info.sourceScaleX > 1 || info.sourceScaleY > 1) return original;
    const victim = new Set(), queue = [], width = original.width, height = original.height;
    const visit = offset => {
      if (victim.has(offset) || offset < 0 || offset >= pixels.length || ![1, 2, 3].includes(pixels[offset]) || pixels[offset] === neutral[offset]) return;
      victim.add(offset); queue.push(offset);
    };
    // Only connected changed actor-color pixels; static lettering and trap art stay intact.
    for (let i = 0; i < pixels.length; i++) if (pixels[i] === 1 || pixels[i] === 2) visit(i);
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i] % width, y = Math.floor(queue[i] / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) visit((y + dy) * width + x + dx);
      }
    }
    if (!victim.size) { cache.set(original, original); return original; }
    const frame = new Frame(width, height, original.offsetX, original.offsetY);
    frame.data.set(original.data); frame.mask.set(original.mask);
    for (const offset of victim) { frame.data[offset] = 0; frame.mask[offset] = 0; }
    frame.enableSpanCache(); cache.set(original, frame);
    return frame;
  }

  /** Called when a lemming collides with this object's trigger zone. */
  onTrigger (globalTick, lemming = null, trigger = null, x = null, y = null) {
    // 1. restart visual cue
    if (this.animation && !this.animation.loop) {
      const history = getRuntimeHistory(this.runtime);
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
    if ([TriggerTypes.TRAP, TriggerTypes.DROWN, TriggerTypes.KILL, TriggerTypes.FRYING].includes(triggerType)) {
      const provider = lemming?.action?.spriteProvider;
      const kind = this.animation?.objectImg?.characterHazard;
      const contact = lemming && provider?.recordHazardContact ? this.characterContact(lemming, globalTick, kind) : null;
      const custom = provider?.recordHazardContact?.(lemming, kind, contact);
      const pool = lemming?.action?.characterParticles;
      this.characterVictimPresentation = custom && this.animation?.objectImg?.characterVictim ? { provider, pool, epoch: pool?.epoch } : null;
    }
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
      const soundBus = getRuntimeSoundEvents(this.runtime);
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
