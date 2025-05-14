import { Lemmings } from './LemmingsNamespace.js';

class DrawProperties {
        constructor(isUpsideDown, noOverwrite, onlyOverwrite, isErase) {
            this.isUpsideDown = isUpsideDown;
            this.noOverwrite = noOverwrite;
            this.onlyOverwrite = onlyOverwrite;
            this.isErase = isErase;
            //- the original game does not allow the combination: (noOverwrite | isErase)
            if (noOverwrite)
                this.isErase = false;
        }
    }
    Lemmings.DrawProperties = DrawProperties;

export { DrawProperties };
