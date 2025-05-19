import { Lemmings } from './LemmingsNamespace.js';

class ObjectManager {
        constructor(gameTimer) {
            this.gameTimer = gameTimer;
            this.objects = [];
        }
        /** render all Objects to the GameDisplay */
        render(gameDisplay) {
            let objs = this.objects;
            let tick = this.gameTimer.getGameTicks();
            for (let i = 0; i < objs.length; i++) {
                let obj = objs[i];
                gameDisplay.drawFrameFlags(obj.animation.getFrame(tick+1), obj.x, obj.y, obj.drawProperties);
            }
        }
        /** add map objects to manager */
        addRange(mapObjects) {
            for (let i = 0; i < mapObjects.length; i++) {
                this.objects.push(mapObjects[i]);
            }
        }
    }
    Lemmings.ObjectManager = ObjectManager;

export { ObjectManager };
