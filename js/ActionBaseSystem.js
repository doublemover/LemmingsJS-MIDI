import { Lemmings } from './LemmingsNamespace.js';

/**
 * Base class for all action systems.
 * Handles sprite and mask caching as well as common draw/trigger logic.
 */
class ActionBaseSystem {
    static spriteCache = new Map();
    static maskCache = new Map();
    /**
     * @param {Object} options
     * @param {*} options.sprites Sprite provider
     * @param {*} options.spriteType SpriteTypes enum value
     * @param {boolean} [options.singleSprite=false] true if only one sprite is used
     * @param {*} [options.masks] Mask provider
     * @param {*} [options.maskTypes] mask type or {left, right} pair
     */
    constructor({sprites=null, spriteType=null, singleSprite=false, masks=null, maskTypes=null, actionName=null} = {}) {
        this.sprites = null;
        this.masks   = null;
        this.actionName = actionName || '';

        if (sprites && spriteType !== null) {
            const cacheKey = this.actionName || spriteType;
            if (!ActionBaseSystem.spriteCache.has(cacheKey)) {
                const map = new Map();
                if (singleSprite) {
                    map.set('both', sprites.getAnimation(spriteType, false));
                } else {
                    map.set('left', sprites.getAnimation(spriteType, false));
                    map.set('right', sprites.getAnimation(spriteType, true));
                }
                ActionBaseSystem.spriteCache.set(cacheKey, map);
            }
            this.sprites = ActionBaseSystem.spriteCache.get(cacheKey);
        }

        if (masks && maskTypes !== null) {
            const cacheKey = this.actionName || JSON.stringify(maskTypes);
            if (!ActionBaseSystem.maskCache.has(cacheKey)) {
                const map = new Map();
                if (singleSprite) {
                    map.set('both', masks.GetMask(maskTypes));
                } else {
                    map.set('left', masks.GetMask(maskTypes.left));
                    map.set('right', masks.GetMask(maskTypes.right));
                }
                ActionBaseSystem.maskCache.set(cacheKey, map);
            }
            this.masks = ActionBaseSystem.maskCache.get(cacheKey);
        }
    }

    /** Default implementation simply returns configured actionName. */
    getActionName() {
        return this.actionName || '';
    }

    /**
     * Default trigger sets the action on the lemming and returns true.
     */
    triggerLemAction(lem) {
        lem.setAction(this);
        return true;
    }

    /**
     * Draw the sprite frame based on lemming direction.
     */
    draw(gameDisplay, lem) {
        if (!this.sprites) return;
        const key = this.sprites.has('both') ? 'both' : lem.getDirection();
        const ani = this.sprites.get(key);
        const frame = ani.getFrame(lem.frameIndex);
        gameDisplay.drawFrame(frame, lem.x, lem.y);
    }
}

Lemmings.ActionBaseSystem = ActionBaseSystem;
export { ActionBaseSystem };
