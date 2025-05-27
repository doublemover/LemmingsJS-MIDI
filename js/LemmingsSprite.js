import { Lemmings } from './LemmingsNamespace.js';

class LemmingsSprite {
        constructor(fr, colorPalette) {
            //- Lookup table from ActionType -> this.animations();
            // First Element: left-move, Second: right-move
            this.lemmingAnimation = [];  
            this.colorPalette = colorPalette;
            this.registerAnimation(Lemmings.SpriteTypes.WALKING, 1, fr, 2, 16, 10, -8, -10, 8); //- walking (r)
            this.registerAnimation(Lemmings.SpriteTypes.JUMPING, 1, fr, 2, 16, 10, -8, -10, 1); //- jumping (r)
            this.registerAnimation(Lemmings.SpriteTypes.WALKING, -1, fr, 2, 16, 10, -8, -10, 8); //- walking (l)
            this.registerAnimation(Lemmings.SpriteTypes.JUMPING, -1, fr, 2, 16, 10, -8, -10, 1); //- jumping (l)
            this.registerAnimation(Lemmings.SpriteTypes.DIGGING, 0, fr, 3, 16, 14, -8, -12, 16); //- digging
            this.registerAnimation(Lemmings.SpriteTypes.CLIMBING, 1, fr, 2, 16, 12, -8, -12, 8); //- climbing (r)
            this.registerAnimation(Lemmings.SpriteTypes.CLIMBING, -1, fr, 2, 16, 12, -8, -12, 8); //- climbing (l)
            this.registerAnimation(Lemmings.SpriteTypes.DROWNING, 0, fr, 2, 16, 10, -8, -10, 16); //- drowning
            this.registerAnimation(Lemmings.SpriteTypes.POSTCLIMBING, 1, fr, 2, 16, 12, -8, -12, 8); //- post-climb (r)
            this.registerAnimation(Lemmings.SpriteTypes.POSTCLIMBING, -1, fr, 2, 16, 12, -8, -12, 8); //- post-climb (l)
            this.registerAnimation(Lemmings.SpriteTypes.BUILDING, 1, fr, 3, 16, 13, -8, -13, 16); //- brick-laying (r)
            this.registerAnimation(Lemmings.SpriteTypes.BUILDING, -1, fr, 3, 16, 13, -8, -13, 16); //- brick-laying (l)
            this.registerAnimation(Lemmings.SpriteTypes.BASHING, 1, fr, 3, 16, 10, -8, -10, 32); //- bashing (r)
            this.registerAnimation(Lemmings.SpriteTypes.BASHING, -1, fr, 3, 16, 10, -8, -10, 32); //- bashing (l)
            this.registerAnimation(Lemmings.SpriteTypes.MINING, 1, fr, 3, 16, 13, -8, -12, 24); //- mining (r)
            this.registerAnimation(Lemmings.SpriteTypes.MINING, -1, fr, 3, 16, 13, -8, -12, 24); //- mining (l)
            this.registerAnimation(Lemmings.SpriteTypes.FALLING, 1, fr, 2, 16, 10, -8, -10, 4); //- falling (r)
            this.registerAnimation(Lemmings.SpriteTypes.FALLING, -1, fr, 2, 16, 10, -8, -10, 4); //- falling (l)
            this.registerAnimation(Lemmings.SpriteTypes.UMBRELLA, 1, fr, 3, 16, 16, -8, -16, 8); //- pre-umbrella (r)
            this.registerAnimation(Lemmings.SpriteTypes.UMBRELLA, -1, fr, 3, 16, 16, -8, -16, 8); //- umbrella (r)
            this.registerAnimation(Lemmings.SpriteTypes.SPLATTING, 0, fr, 2, 16, 10, -8, -10, 16); //- splatting
            this.registerAnimation(Lemmings.SpriteTypes.EXITING, 0, fr, 2, 16, 13, -8, -13, 8); //- exiting
            this.registerAnimation(Lemmings.SpriteTypes.FRYING, 0, fr, 4, 16, 14, -8, -10, 14); //- fried
            this.registerAnimation(Lemmings.SpriteTypes.BLOCKING, 0, fr, 2, 16, 10, -8, -10, 16); //- blocking
            this.registerAnimation(Lemmings.SpriteTypes.SHRUGGING, 1, fr, 2, 16, 10, -8, -10, 8); //- shrugging (r)
            this.registerAnimation(Lemmings.SpriteTypes.SHRUGGING, 0, fr, 2, 16, 10, -8, -10, 8); //- shrugging (l)
            this.registerAnimation(Lemmings.SpriteTypes.OHNO, 0, fr, 2, 16, 10, -8, -10, 16); //- oh-no-ing
            this.registerAnimation(Lemmings.SpriteTypes.EXPLODING, 0, fr, 3, 32, 32, -8, -10, 1); //- explosion
        }
        /** return the animation for a given animation type */
        getAnimation(state, right) {
            return this.lemmingAnimation[this.typeToIndex(state, right)];
        }
        typeToIndex(state, right) {
            return state * 2 + (right ? 0 : 1);
        }
        registerAnimation(state, dir, fr, bitsPerPixel, width, height, offsetX, offsetY, frames) {
            //- load animation frames from file (fr)
            var animation = new Lemmings.Animation();
            animation.loadFromFile(fr, bitsPerPixel, width, height, frames, this.colorPalette, offsetX, offsetY);
            //- add animation to cache -add unidirectional (dir == 0) animations to both lists
            if (dir >= 0) {
                this.lemmingAnimation[this.typeToIndex(state, true)] = animation;
            }
            if (dir <= 0) {
                this.lemmingAnimation[this.typeToIndex(state, false)] = animation;
            }
        }
    }
    Lemmings.LemmingsSprite = LemmingsSprite;

export { LemmingsSprite };
