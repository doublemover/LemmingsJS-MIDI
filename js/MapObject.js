import { Lemmings } from './LemmingsNamespace.js';

class MapObject {
        constructor(ob, objectImg, animation = new Lemmings.Animation(), triggerType = Lemmings.TriggerTypes.NO_TRIGGER) {
            this.x = ob.x;
            this.y = ob.y;
            this.drawProperties = ob.drawProperties;
            this.animation = animation;
            this.animation.loop = objectImg.animationLoop;
            this.animation.firstFrameIndex = objectImg.firstFrameIndex;
            this.animation.objectImg = objectImg;
            this.triggerType = triggerType;
            for (let i = 0; i < objectImg.frames.length; i++) {
                let newFrame = new Lemmings.Frame(objectImg.width, objectImg.height);
                newFrame.clear();
                newFrame.drawPaletteImage(objectImg.frames[i], objectImg.width, objectImg.height, objectImg.palette, 0, 0);
                this.animation.frames.push(newFrame);
            }
        }
        onTrigger(globalTick, lemming = null) {
            // 1. Restart visual cue (blade swings, trap door slams, …)
            if (this.animation && !this.animation.loop) { 
                this.animation.restart(globalTick);
            }
            
            // 2. Play sound (optional)
            // if (this.soundId !== undefined) {
            //   soundSystem.playSound(lemming, this.soundId);
            // }

            // 3. Anything else that should happen exactly once per trigger
            //    e.g. spawn particles, increment stats, etc.
        }
    }
    Lemmings.MapObject = MapObject;

export { MapObject };
