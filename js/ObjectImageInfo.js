import { Lemmings } from './LemmingsNamespace.js';

class ObjectImageInfo extends Lemmings.BaseImageInfo {
    constructor() {
        super(...arguments);
        this.animationLoop = false;
        this.firstFrameIndex = 0;
        this.unknown1 = 0;
        this.unknown2 = 0;
        this.trigger_left = 0;
        this.trigger_top = 0;
        this.trigger_width = 0;
        this.trigger_height = 0;
        this.trigger_effect_id = 0;
        this.preview_image_index = 0;
        this.unknown = 0;
        this.trap_sound_effect_id = 0;
    }
}
Lemmings.ObjectImageInfo = ObjectImageInfo;

export { ObjectImageInfo };
