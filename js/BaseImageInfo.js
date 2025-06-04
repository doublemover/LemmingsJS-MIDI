import { Lemmings } from './LemmingsNamespace.js';

class BaseImageInfo {
  constructor() {
    this.width = 0;
    this.height = 0;
    /// normal case
    ///           +------------+
    /// imageLoc: |            | 1st Bits
    ///           |            | 2th Bits
    /// vgaLoc:   |            | 3th Bits
    /// maskLoc:  |            | 4th Bits
    ///           +------------+
    /** position of the image in the file */
    this.imageLoc = 0;
    /** position of the (alpha) mask in the file */
    this.maskLoc = 0;
    /** position of the vga bits in the file */
    this.vgaLoc = 0;
    /** size of one frame in the file */
    this.frameDataSize = 0;
    /** number of frames used by this image */
    this.frameCount = 0;
    /** the color palette to be used for this image */
    this.palette = null;
  }
}
Lemmings.BaseImageInfo = BaseImageInfo;

export { BaseImageInfo };
