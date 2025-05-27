import { Lemmings } from './LemmingsNamespace.js';

/**
 * A single animated level object (trap, entrance, exit, …).
 *
 *  — Cache pre‑rendered animation frames per object image so identical objects
 *    share memory & avoid expensive palette blits during construction.
 *  — Use const / let scoping & micro‑optimise hot loops.
 */
class MapObject {
  /** WeakMap<objectImg, Frame[]> – shared across ALL MapObject instances. */
  static #frameCache = new WeakMap();

  constructor (ob, objectImg, animation = new Lemmings.Animation(), triggerType = Lemmings.TriggerTypes.NO_TRIGGER) {
    this.ob              = ob;
    this.obID            = ob.id;
    this.x               = ob.x;
    this.y               = ob.y;
    this.drawProperties  = ob.drawProperties;
    this.triggerType     = triggerType;

    let frames = MapObject.#frameCache.get(objectImg);
    if (!frames) {
      frames = new Array(objectImg.frames.length);
      for (let i = 0, len = frames.length; i < len; ++i) {
        const f = new Lemmings.Frame(objectImg.width, objectImg.height);
        f.clear();
        // Draw once (palette → RGBA). This cost is now paid ONE time per sprite
        f.drawPaletteImage(objectImg.frames[i], objectImg.width, objectImg.height,
                           objectImg.palette, 0, 0);
        frames[i] = f;
      }
      MapObject.#frameCache.set(objectImg, frames);
    }

    this.animation                 = animation;
    this.animation.loop            = objectImg.animationLoop;
    this.animation.firstFrameIndex = objectImg.firstFrameIndex;
    this.animation.objectImg       = objectImg;
    this.animation.frames          = frames;
  }

  /** Called when a lemming collides with this object's trigger zone. */
  onTrigger (globalTick, lemming = null) {
    // 1. restart visual cue
    if (this.animation && !this.animation.loop) {
      this.animation.restart(globalTick);
    }
    // 2. play sound, spawn particles 
  }
}
Lemmings.MapObject = MapObject;
export { MapObject };